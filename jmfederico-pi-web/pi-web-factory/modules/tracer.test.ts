import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tracer } from "./tracer.ts";

let dir: string;
let dbPath: string;
let tracer: Tracer;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-web-factory-test-"));
  dbPath = join(dir, "factory.db");
  tracer = new Tracer(dbPath);
});

afterEach(() => {
  tracer.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The exact cursor-poll read query from the design doc / observability.md. */
function pollEvents(db: Database, adwId: string, cursor: number) {
  return db
    .query<
      { rowid: number; event_id: string; type: string; name: string; parent_id: string; phase_id: string },
      [string, number]
    >("select rowid, event_id, type, name, parent_id, phase_id from events where adw_id=? and rowid>? order by rowid")
    .all(adwId, cursor);
}

describe("Tracer", () => {
  test("schema creates all seven tables with WAL mode", () => {
    const tables = tracer.db
      .query<{ name: string }, []>("select name from sqlite_master where type='table' order by name")
      .all();
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "sessions",
        "phases",
        "events",
        "envelopes",
        "gate_results",
        "agent_sessions",
        "processes",
      ]),
    );

    const journalMode = tracer.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    expect(journalMode?.journal_mode).toBe("wal");
  });

  test("sessions table carries the project_cwd deviation column", () => {
    const cols = tracer.db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all();
    expect(cols.map((c) => c.name)).toContain("project_cwd");
  });

  test("records a representative phase/agent/tool/gate sequence and reads it back in order with correct parent_id nesting", () => {
    const adwId = "adw_smoke001";
    const phaseId = "phase_build";

    tracer.sessionStart(adwId, { engineer: "chris", projectCwd: "/home/chris/some-project" });
    tracer.sessionRequest(adwId, "add a /health endpoint");

    // phase_start -> creates a `phases` row
    const phaseStartId = tracer.event({
      adwId,
      phaseId,
      type: "phase_start",
      name: "build",
      payload: { kind: "agent", owner: "builder", description: "Implement the health endpoint" },
    });

    // agent_start -> nested under the phase_start span
    const agentStartId = tracer.event({
      adwId,
      phaseId,
      type: "agent_start",
      name: "builder",
      parentId: phaseStartId,
      payload: { coding_agent: "pi", model: "medium-moe", session_id: "sess_abc123" },
    });

    // two tool_calls, nested under agent_start
    const tool1Id = tracer.event({
      adwId,
      phaseId,
      type: "tool_call",
      name: "read: src/server.ts",
      parentId: agentStartId,
      payload: { tool: "read", args: { path: "src/server.ts" }, ok: true, duration_ms: 12 },
      startedAt: "2026-08-04T00:00:00.000Z",
      endedAt: "2026-08-04T00:00:00.012Z",
    });

    const tool2Id = tracer.event({
      adwId,
      phaseId,
      type: "tool_call",
      name: "bash: bun test",
      parentId: agentStartId,
      payload: { tool: "bash", args: { command: "bun test" }, ok: true, duration_ms: 850 },
      startedAt: "2026-08-04T00:00:01.000Z",
      endedAt: "2026-08-04T00:00:01.850Z",
    });

    // agent_end -> adds usage to sessions, refreshes agent_sessions
    const agentEndId = tracer.event({
      adwId,
      phaseId,
      type: "agent_end",
      name: "builder",
      parentId: phaseStartId,
      tokens: 1500,
      payload: {
        agent: "builder",
        cost: 0.0123,
        tokens: 1500,
        usage: { input: 1000, output: 500 },
        context_tokens: 4200,
        context_window: 128000,
      },
    });

    // gate_pass -> also writes a gate_results row
    const gatePassId = tracer.event({
      adwId,
      phaseId,
      type: "gate_pass",
      name: "artifacts_exist",
      parentId: phaseStartId,
      payload: {
        attempt: 1,
        checks: [{ item: "src/server.ts", ok: true, note: "exists, 1.2KB" }],
      },
    });

    // phase_end -> resolves the phases row to success
    const phaseEndId = tracer.event({
      adwId,
      phaseId,
      type: "phase_end",
      name: "build",
      payload: { status: "success" },
    });

    tracer.sessionFinish(adwId, true);

    // ── cursor-poll read: `select * from events where adw_id=? and rowid>? order by rowid` ──
    const rows = pollEvents(tracer.db, adwId, 0);

    expect(rows.map((r) => r.event_id)).toEqual([
      phaseStartId,
      agentStartId,
      tool1Id,
      tool2Id,
      agentEndId,
      gatePassId,
      phaseEndId,
    ]);
    expect(rows.map((r) => r.type)).toEqual([
      "phase_start",
      "agent_start",
      "tool_call",
      "tool_call",
      "agent_end",
      "gate_pass",
      "phase_end",
    ]);

    // parent_id span nesting: tool calls nest under agent_start; agent_start
    // and terminal events nest under the phase_start span.
    const byId = new Map(rows.map((r) => [r.event_id, r]));
    expect(byId.get(agentStartId)?.parent_id).toBe(phaseStartId);
    expect(byId.get(tool1Id)?.parent_id).toBe(agentStartId);
    expect(byId.get(tool2Id)?.parent_id).toBe(agentStartId);
    expect(byId.get(agentEndId)?.parent_id).toBe(phaseStartId);
    expect(byId.get(gatePassId)?.parent_id).toBe(phaseStartId);
    // phase_end has no explicit parent in this sequence — root span.
    expect(byId.get(phaseEndId)?.parent_id).toBe("");

    // cursor semantics: polling again from the last-seen rowid returns nothing new
    const maxRowid = Math.max(...rows.map((r) => r.rowid));
    const nextPoll = pollEvents(tracer.db, adwId, maxRowid);
    expect(nextPoll).toEqual([]);

    // a later event appears on the next poll past the old cursor
    const laterId = tracer.event({ adwId, phaseId, type: "log", name: "note", payload: { msg: "done" } });
    const afterMore = pollEvents(tracer.db, adwId, maxRowid);
    expect(afterMore.map((r) => r.event_id)).toEqual([laterId]);

    // ── side-table writes ──
    const phaseRow = tracer.db
      .query<{ status: string; name: string; owner: string }, [string]>(
        "select status, name, owner from phases where phase_id=?",
      )
      .get(phaseId);
    expect(phaseRow?.status).toBe("success");
    expect(phaseRow?.name).toBe("build");
    expect(phaseRow?.owner).toBe("builder");

    const gateRow = tracer.db
      .query<{ passed: number; gate: string }, [string]>("select passed, gate from gate_results where adw_id=?")
      .get(adwId);
    expect(gateRow?.passed).toBe(1);
    expect(gateRow?.gate).toBe("artifacts_exist");

    const sessionRow = tracer.db
      .query<
        { status: string; project_cwd: string; total_tokens: number; total_cost: number },
        [string]
      >("select status, project_cwd, total_tokens, total_cost from sessions where adw_id=?")
      .get(adwId);
    expect(sessionRow?.status).toBe("success");
    expect(sessionRow?.project_cwd).toBe("/home/chris/some-project");
    expect(sessionRow?.total_tokens).toBe(1500);
    expect(sessionRow?.total_cost).toBeCloseTo(0.0123, 6);

    const agentSessionRow = tracer.db
      .query<
        { context_tokens: number; context_window: number },
        [string, string]
      >("select context_tokens, context_window from agent_sessions where adw_id=? and agent=?")
      .get(adwId, "builder");
    expect(agentSessionRow?.context_tokens).toBe(4200);
    expect(agentSessionRow?.context_window).toBe(128000);
  });

  test("gate_fail records violations derived from failed checks", () => {
    const adwId = "adw_smoke002";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });
    tracer.event({
      adwId,
      phaseId: "phase_review",
      type: "gate_fail",
      name: "tests_pass",
      payload: {
        attempt: 1,
        checks: [
          { item: "npm test", ok: false, note: "2 failing" },
          { item: "lockfile", ok: true, note: "present" },
        ],
      },
    });

    const row = tracer.db
      .query<{ passed: number; violations_json: string }, [string]>(
        "select passed, violations_json from gate_results where adw_id=?",
      )
      .get(adwId);
    expect(row?.passed).toBe(0);
    expect(JSON.parse(row?.violations_json ?? "[]")).toEqual(["npm test: 2 failing"]);
  });
});
