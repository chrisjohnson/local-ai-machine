import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tracer, deriveTitleFromPrompt } from "./tracer.ts";

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

// ── M-074: schema/terminology migration coverage ──────────────────────────
// SQL table/column names stay `sessions`/`phases`/`owner` (see schema.ts's
// and tracer.ts's header comments — the rename is TS-level only), so these
// tests still query those physical names directly; what's new is the
// columns themselves and the `role`-named TS call sites that populate them.
describe("Tracer — M-074 schema additions", () => {
  test("sessions.title is a new, nullable column, settable via sessionSetTitle", () => {
    const adwId = "adw_title001";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });

    const beforeRow = tracer.db
      .query<{ title: string | null }, [string]>("select title from sessions where adw_id=?")
      .get(adwId);
    expect(beforeRow?.title).toBeNull();

    tracer.sessionSetTitle(adwId, "add a /health endpoint");
    const afterRow = tracer.db
      .query<{ title: string | null }, [string]>("select title from sessions where adw_id=?")
      .get(adwId);
    expect(afterRow?.title).toBe("add a /health endpoint");
  });

  test("phases.kind is narrowed to 'agent' | 'code' — a code step round-trips correctly", () => {
    const adwId = "adw_kind001";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });
    tracer.event({
      adwId,
      phaseId: "phase_test",
      type: "phase_start",
      name: "test",
      payload: { kind: "code", owner: "gates.testsPass", description: "run the test suite" },
    });

    const row = tracer.db
      .query<{ kind: string }, [string]>("select kind from phases where phase_id=?")
      .get("phase_test");
    expect(row?.kind).toBe("code");
  });

  test("phases token columns (input/output/cached) populate from an agent_end event's usage payload, additive to sessions.total_tokens", () => {
    const adwId = "adw_tokens001";
    const phaseId = "phase_build_tok";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });

    tracer.event({
      adwId,
      phaseId,
      type: "phase_start",
      name: "build",
      payload: { kind: "agent", owner: "builder", description: "..." },
    });
    tracer.event({
      adwId,
      phaseId,
      type: "agent_end",
      name: "builder",
      tokens: 900,
      payload: {
        agent: "builder",
        cost: 0.05,
        tokens: 900,
        usage: { input: 600, output: 250, cached: 50 },
      },
    });

    const stepRow = tracer.db
      .query<
        { input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null },
        [string]
      >("select input_tokens, output_tokens, cached_tokens from phases where phase_id=?")
      .get(phaseId);
    expect(stepRow?.input_tokens).toBe(600);
    expect(stepRow?.output_tokens).toBe(250);
    expect(stepRow?.cached_tokens).toBe(50);

    // additive, not a replacement — sessions.total_tokens still accumulates
    // exactly as it did before M-074.
    const sessionRow = tracer.db
      .query<{ total_tokens: number }, [string]>("select total_tokens from sessions where adw_id=?")
      .get(adwId);
    expect(sessionRow?.total_tokens).toBe(900);
  });

  test("agent_end's token-column upsert never clobbers a terminal status back to 'running' — ordering-independence regression", () => {
    // run.ts always emits agent_end BEFORE phase_end, so this never manifests
    // through that caller — but the underlying phaseUpsert bug this guards
    // against was real: agent_end's side effect used to hardcode
    // `status: "running"` unconditionally, which would have silently reverted
    // an already-terminal Step back to non-terminal if a future caller (e.g.
    // M-076's generic Workflow interpreter) ever emitted these two events in
    // the other order. Simulate that other order directly here.
    const adwId = "adw_order001";
    const phaseId = "phase_order_test";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });

    tracer.event({
      adwId,
      phaseId,
      type: "phase_start",
      name: "build",
      payload: { kind: "agent", owner: "builder", description: "..." },
    });
    // phase_end BEFORE agent_end — the reversed order.
    tracer.event({
      adwId,
      phaseId,
      type: "phase_end",
      name: "build",
      payload: { status: "success" },
    });
    tracer.event({
      adwId,
      phaseId,
      type: "agent_end",
      name: "builder",
      tokens: 900,
      payload: { agent: "builder", cost: 0.05, tokens: 900, usage: { input: 600, output: 250, cached: 50 } },
    });

    const row = tracer.db
      .query<{ status: string; input_tokens: number | null }, [string]>(
        "select status, input_tokens from phases where phase_id=?",
      )
      .get(phaseId);
    // Status must still be "success" — NOT reverted to "running" by the
    // later agent_end upsert — while the token data still lands correctly.
    expect(row?.status).toBe("success");
    expect(row?.input_tokens).toBe(600);
  });

  test("phases.output_summary populates on a successful phase_end (code-step style, via payload.outputSummary)", () => {
    const adwId = "adw_summary_ok";
    const phaseId = "phase_test_ok";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });
    tracer.event({
      adwId,
      phaseId,
      type: "phase_start",
      name: "test",
      payload: { kind: "code", owner: "gates.testsPass", description: "run tests" },
    });
    tracer.event({
      adwId,
      phaseId,
      type: "phase_end",
      name: "test",
      payload: { status: "success", outputSummary: "3/3 checks passed" },
    });

    const row = tracer.db
      .query<{ output_summary: string | null; status: string }, [string]>(
        "select output_summary, status from phases where phase_id=?",
      )
      .get(phaseId);
    expect(row?.status).toBe("success");
    expect(row?.output_summary).toBe("3/3 checks passed");
  });

  test("phases.output_summary populates on a failing phase_end too — not left null on failure paths", () => {
    const adwId = "adw_summary_fail";
    const phaseId = "phase_test_fail";
    tracer.sessionStart(adwId, { projectCwd: "/tmp/proj" });
    tracer.event({
      adwId,
      phaseId,
      type: "phase_start",
      name: "test",
      payload: { kind: "code", owner: "gates.testsPass", description: "run tests" },
    });
    tracer.event({
      adwId,
      phaseId,
      type: "phase_end",
      name: "test",
      payload: { status: "fail", error: "2 failing", outputSummary: "2 failing" },
    });

    const row = tracer.db
      .query<{ output_summary: string | null; status: string }, [string]>(
        "select output_summary, status from phases where phase_id=?",
      )
      .get(phaseId);
    expect(row?.status).toBe("fail");
    expect(row?.output_summary).toBe("2 failing");
  });
});

// ── deriveTitleFromPrompt (used by workflow.ts/planBuildTest.ts to
// populate sessions.title at Workflow Run start — a real title, not the
// bare adwId or the full untruncated prompt) ──────────────────────────────
describe("deriveTitleFromPrompt", () => {
  test("takes the first sentence when the prompt has one, dropping everything after it", () => {
    const prompt =
      "Create a Python file named stack.py implementing a Stack class. " +
      "Include push, pop, peek, and is_empty methods with proper error handling.";
    expect(deriveTitleFromPrompt(prompt)).toBe("Create a Python file named stack.py implementing a Stack class.");
  });

  test("takes the first line when there's no sentence-ending punctuation before it", () => {
    const prompt = "Add a health endpoint\nThe endpoint should return 200 OK with a JSON body.";
    expect(deriveTitleFromPrompt(prompt)).toBe("Add a health endpoint");
  });

  test("hard-truncates with an ellipsis when the first sentence/line is itself too long", () => {
    const longSentence = "Implement a comprehensive inventory tracking system with add, remove, and query operations plus full audit logging.";
    const result = deriveTitleFromPrompt(longSentence);
    expect(result.length).toBeLessThanOrEqual(72);
    expect(result.endsWith("…")).toBe(true);
    expect(longSentence.startsWith(result.slice(0, -1))).toBe(true);
  });

  test("a short prompt with no punctuation at all returns the whole trimmed prompt", () => {
    expect(deriveTitleFromPrompt("  fix the bug  ")).toBe("fix the bug");
  });

  test("empty or whitespace-only input returns a real placeholder string, not an empty title", () => {
    expect(deriveTitleFromPrompt("")).toBe("(no task description)");
    expect(deriveTitleFromPrompt("   \n  ")).toBe("(no task description)");
  });

  test("question and exclamation marks count as sentence boundaries too, not just periods", () => {
    expect(deriveTitleFromPrompt("Can you fix the login bug? It happens on every retry.")).toBe("Can you fix the login bug?");
    expect(deriveTitleFromPrompt("Fix this now! It's breaking prod.")).toBe("Fix this now!");
  });
});
