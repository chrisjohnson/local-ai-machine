/**
 * Tracer: the write path into the shared trace db.
 *
 * TS/bun:sqlite port of upstream SSSF's `adws/adw_modules/tracer.py`. Every
 * event lands in `events`, and the ten event types additionally touch the
 * table observability.md describes for them:
 *   - phase_start  -> upserts a `phases` row (status "running")
 *   - phase_end    -> upserts the same `phases` row with the resolved status
 *   - agent_start  -> upserts an `agent_sessions` row for the agent
 *   - agent_end    -> adds usage/cost to `sessions`, refreshes `agent_sessions`
 *                     context occupancy
 *   - gate_pass / gate_fail -> also writes a `gate_results` row (mirrors the
 *     event payload, per observability.md: "the gate_results table and the
 *     event stream are equivalent sources")
 *   - handoff, tool_call, log, error -> `events` only
 *
 * `parent_id` nests spans exactly as upstream: the caller passes the parent
 * event's id (e.g. an `agent_start` event id as the `parent_id` for the
 * `tool_call` events that happen inside that agent's turn).
 */

import { Database } from "bun:sqlite";
import { PRAGMAS, SCHEMA } from "./schema.ts";

export type EventType =
  | "phase_start"
  | "agent_start"
  | "tool_call"
  | "handoff"
  | "gate_pass"
  | "gate_fail"
  | "log"
  | "agent_end"
  | "phase_end"
  | "error";

export type PhaseKind = "engineer" | "agent" | "code";
export type PhaseStatus = "queued" | "running" | "success" | "fail";
export type SessionStatus = "running" | "success" | "fail";

export interface EventRecord {
  adwId: string;
  phaseId?: string;
  type: EventType;
  name?: string;
  payload?: Record<string, unknown>;
  parentId?: string;
  tokens?: number | null;
  /** Set both for events that span real elapsed time (tool_call). */
  startedAt?: string;
  endedAt?: string;
}

export interface GateCheck {
  item: string;
  ok: boolean;
  note?: string;
}

export interface GateReport {
  checks: GateCheck[];
}

export interface AgentSessionInfo {
  adwId: string;
  agent: string;
  codingAgent?: string;
  model?: string;
  color?: string;
  sessionId?: string;
  contextTokens?: number;
  contextWindow?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  // 12 hex chars, matching upstream's `new_id(12)` shape closely enough for
  // uniqueness purposes — not required to be byte-identical to Python's impl.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export class Tracer {
  readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    for (const pragma of PRAGMAS) this.db.run(pragma);
    this.db.run(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ── sessions ────────────────────────────────────────────────────────────

  sessionStart(adwId: string, opts: { engineer?: string; projectCwd?: string; adwName?: string } = {}): void {
    this.db.run(
      `INSERT INTO sessions (adw_id, status, engineer, project_cwd, started_at)
       VALUES (?, 'running', ?, ?, ?)
       ON CONFLICT(adw_id) DO UPDATE SET status='running'`,
      [adwId, opts.engineer ?? null, opts.projectCwd ?? null, nowIso()],
    );
    if (!opts.adwName) return;
    const row = this.db
      .query<{ adw_name: string | null }, [string]>("SELECT adw_name FROM sessions WHERE adw_id=?")
      .get(adwId);
    const names = row?.adw_name ? row.adw_name.split(" + ") : [];
    if (!names.includes(opts.adwName)) {
      names.push(opts.adwName);
      this.db.run("UPDATE sessions SET adw_name=? WHERE adw_id=?", [names.join(" + "), adwId]);
    }
  }

  sessionRequest(adwId: string, request: string): void {
    this.db.run("UPDATE sessions SET request=? WHERE adw_id=?", [request.slice(0, 500), adwId]);
  }

  sessionFinish(adwId: string, ok: boolean): void {
    this.db.run("UPDATE sessions SET status=?, ended_at=? WHERE adw_id=?", [
      ok ? "success" : "fail",
      nowIso(),
      adwId,
    ]);
    this.processesEndAll(adwId);
  }

  sessionAddUsage(adwId: string, tokens: number, cost: number): void {
    this.db.run(
      "UPDATE sessions SET total_tokens=total_tokens+?, total_cost=total_cost+? WHERE adw_id=?",
      [tokens, cost, adwId],
    );
  }

  // ── processes ───────────────────────────────────────────────────────────

  processStart(adwId: string, kind: "adw" | "agent", name: string, pid: number, command: string): void {
    this.db.run(
      `INSERT INTO processes (adw_id, kind, name, pid, command, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [adwId, kind, name, pid, command.slice(0, 500), nowIso()],
    );
  }

  processEnd(adwId: string, pid: number): void {
    this.db.run(
      `UPDATE processes SET ended_at=? WHERE id = (
         SELECT id FROM processes WHERE adw_id=? AND pid=? AND ended_at IS NULL
         ORDER BY id DESC LIMIT 1)`,
      [nowIso(), adwId, pid],
    );
  }

  processesEndAll(adwId: string): void {
    this.db.run("UPDATE processes SET ended_at=? WHERE adw_id=? AND ended_at IS NULL", [
      nowIso(),
      adwId,
    ]);
  }

  // ── phases ──────────────────────────────────────────────────────────────

  maxPhaseSeq(adwId: string): number {
    const row = this.db
      .query<{ "MAX(seq)": number | null }, [string]>("SELECT MAX(seq) FROM phases WHERE adw_id = ?")
      .get(adwId);
    return row?.["MAX(seq)"] ?? 0;
  }

  phaseUpsert(phase: {
    phaseId: string;
    adwId: string;
    seq: number;
    name: string;
    kind: PhaseKind;
    owner: string;
    description: string;
    status: PhaseStatus;
    attempt?: number;
    retries?: number;
    error?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO phases (phase_id, adw_id, seq, name, kind, owner, description,
         status, attempt, retries, error, started_at, ended_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(phase_id) DO UPDATE SET status=excluded.status,
         attempt=excluded.attempt, error=excluded.error, ended_at=excluded.ended_at`,
      [
        phase.phaseId,
        phase.adwId,
        phase.seq,
        phase.name,
        phase.kind,
        phase.owner,
        phase.description,
        phase.status,
        phase.attempt ?? 0,
        phase.retries ?? 0,
        phase.error ?? null,
        phase.startedAt ?? null,
        phase.endedAt ?? null,
      ],
    );
  }

  // ── envelopes / gates / agent sessions ─────────────────────────────────

  envelopeRow(opts: {
    adwId: string;
    phaseId: string;
    agent: string;
    outputType: string;
    payloadJson: string;
    valid: boolean;
    attempt: number;
  }): void {
    this.db.run(
      `INSERT INTO envelopes (envelope_id, adw_id, phase_id, agent, output_type,
         payload_json, valid, attempt, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        newId("env"),
        opts.adwId,
        opts.phaseId,
        opts.agent,
        opts.outputType,
        opts.payloadJson,
        opts.valid ? 1 : 0,
        opts.attempt,
        nowIso(),
      ],
    );
  }

  gateRow(opts: { adwId: string; phaseId: string; gate: string; attempt: number; report: GateReport }): void {
    const violations = opts.report.checks
      .filter((c) => !c.ok)
      .map((c) => `${c.item}: ${c.note || "failed"}`);
    const passed = violations.length === 0;
    this.db.run(
      `INSERT INTO gate_results (adw_id, phase_id, attempt, gate, passed,
         violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [
        opts.adwId,
        opts.phaseId,
        opts.attempt,
        opts.gate,
        passed ? 1 : 0,
        JSON.stringify(violations),
        JSON.stringify(opts.report.checks),
        nowIso(),
      ],
    );
  }

  agentSessionRow(info: AgentSessionInfo): void {
    const ts = nowIso();
    this.db.run(
      `INSERT INTO agent_sessions (adw_id, agent, coding_agent, model, color,
         session_id, context_tokens, context_window, created_at, last_used_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(adw_id, agent) DO UPDATE SET model=excluded.model,
         color=excluded.color, session_id=excluded.session_id,
         context_tokens=excluded.context_tokens,
         context_window=excluded.context_window,
         last_used_at=excluded.last_used_at`,
      [
        info.adwId,
        info.agent,
        info.codingAgent ?? null,
        info.model ?? null,
        info.color ?? null,
        info.sessionId ?? null,
        info.contextTokens ?? 0,
        info.contextWindow ?? 0,
        ts,
        ts,
      ],
    );
  }

  // ── events (the ten types) ─────────────────────────────────────────────

  /**
   * Records one event of any of the ten types into `events`, plus whatever
   * side-table write that type implies (see module docstring). Returns the
   * new event's id, so callers can pass it as `parentId` for nested spans
   * (e.g. tool_call events nested under the agent_start that spawned them).
   */
  event(record: EventRecord): string {
    const eventId = newId("evt");
    const ts = nowIso();
    const payloadJson = JSON.stringify(record.payload ?? {});
    this.db.run(
      `INSERT INTO events (event_id, adw_id, phase_id, parent_id, type, name,
         payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        eventId,
        record.adwId,
        record.phaseId ?? "",
        record.parentId ?? "",
        record.type,
        record.name ?? "",
        payloadJson,
        record.tokens ?? null,
        record.startedAt ?? ts,
        record.endedAt ?? null,
      ],
    );

    this._sideEffects(eventId, record);
    return eventId;
  }

  private _sideEffects(eventId: string, record: EventRecord): void {
    const payload = record.payload ?? {};
    switch (record.type) {
      case "phase_start": {
        this._upsertPhaseFromEvent(record, "running", payload);
        break;
      }
      case "phase_end": {
        const status = (payload["status"] as PhaseStatus | undefined) ?? "fail";
        this._upsertPhaseFromEvent(record, status, payload);
        break;
      }
      case "agent_start": {
        if (record.phaseId) {
          this.agentSessionRow({
            adwId: record.adwId,
            agent: record.name ?? (payload["agent"] as string) ?? "",
            codingAgent: payload["coding_agent"] as string | undefined,
            model: payload["model"] as string | undefined,
            color: payload["color"] as string | undefined,
            sessionId: payload["session_id"] as string | undefined,
          });
        }
        break;
      }
      case "agent_end": {
        const usage = (payload["usage"] as Record<string, unknown> | undefined) ?? {};
        const cost = (payload["cost"] as number | undefined) ?? 0;
        const tokens = (payload["tokens"] as number | undefined) ?? record.tokens ?? 0;
        this.sessionAddUsage(record.adwId, tokens ?? 0, cost ?? 0);
        if (record.name || payload["agent"]) {
          this.agentSessionRow({
            adwId: record.adwId,
            agent: record.name ?? (payload["agent"] as string) ?? "",
            contextTokens: payload["context_tokens"] as number | undefined,
            contextWindow: payload["context_window"] as number | undefined,
            sessionId: payload["session_id"] as string | undefined,
          });
        }
        void usage; // usage breakdown is preserved verbatim in payload_json; not further decomposed here
        break;
      }
      case "gate_pass":
      case "gate_fail": {
        const checks = (payload["checks"] as GateCheck[] | undefined) ?? [];
        const attempt = (payload["attempt"] as number | undefined) ?? 0;
        this.gateRow({
          adwId: record.adwId,
          phaseId: record.phaseId ?? "",
          gate: record.name ?? "",
          attempt,
          report: { checks },
        });
        break;
      }
      case "handoff":
      case "tool_call":
      case "log":
      case "error":
        // events-table-only types — no side table beyond the events row itself.
        break;
    }
    void eventId;
  }

  private _upsertPhaseFromEvent(
    record: EventRecord,
    status: PhaseStatus,
    payload: Record<string, unknown>,
  ): void {
    if (!record.phaseId) return;
    const existing = this.db
      .query<{ seq: number }, [string]>("SELECT seq FROM phases WHERE phase_id=?")
      .get(record.phaseId);
    const seq = existing?.seq ?? this.maxPhaseSeq(record.adwId) + 1;
    this.phaseUpsert({
      phaseId: record.phaseId,
      adwId: record.adwId,
      seq,
      name: record.name ?? (payload["name"] as string) ?? "",
      kind: (payload["kind"] as PhaseKind | undefined) ?? "agent",
      owner: (payload["owner"] as string | undefined) ?? "",
      description: (payload["description"] as string | undefined) ?? "",
      status,
      attempt: payload["attempt"] as number | undefined,
      error: payload["error"] as string | undefined,
      startedAt: status === "running" ? (record.startedAt ?? nowIso()) : undefined,
      endedAt: status !== "running" ? nowIso() : undefined,
    });
  }
}
