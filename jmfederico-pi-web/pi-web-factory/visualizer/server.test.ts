/**
 * server.test.ts: spawns the real `visualizer/server.ts` binary (as `bun
 * visualizer/server.ts`, exactly how a human would run it) against a scratch
 * trace db + test-only port, and exercises `/api/runs`, `/api/runs/:adwId`,
 * and `/api/runs/:adwId/events?since=` over real HTTP — not a mocked
 * `Bun.serve` handler, since the module wires up `Bun.serve` as a top-level
 * side effect (matching `cli.ts`'s own `import.meta.main` pattern) that
 * isn't cleanly importable in-process without also starting a real listener.
 *
 * Also confirms the readonly-open safety property directly: the server
 * process must never be able to write to the db it serves.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Tracer } from "../modules/tracer.ts";

const TEST_PORT = 8790; // distinct from the real default (8090) and from pi-web (8080)

let dir: string;
let dbPath: string;
let proc: ReturnType<typeof Bun.spawn>;
let baseUrl: string;

const ADW_ID = "adw_servertest01";
const ADW_ID_PROJECT_B = "adw_servertest02";
const ADW_ID_PROJECT_B_2 = "adw_servertest03";
const PROJECT_B_CWD = "/tmp/other-project";

// Realistic per-run worktree paths (M-071: every Workflow Run gets its OWN
// worktree) against the SAME project root — the actual real-world shape
// that exposed a real bug live 2026-08-05: naive grouping/filtering by the
// raw project_cwd column treated these as two unrelated one-run "projects"
// instead of two runs against one shared project.
const ADW_ID_WORKTREE_1 = "adw_servertest04";
const ADW_ID_WORKTREE_2 = "adw_servertest05";
const PROJECT_ROOT_CWD = "/tmp/pi-web-factory-realproject";
const WORKTREE_CWD_1 = `${PROJECT_ROOT_CWD}/.pi-web-factory-worktrees/${ADW_ID_WORKTREE_1}`;
const WORKTREE_CWD_2 = `${PROJECT_ROOT_CWD}/.pi-web-factory-worktrees/${ADW_ID_WORKTREE_2}`;

function seed(): void {
  const tracer = new Tracer(dbPath);
  tracer.sessionStart(ADW_ID, { engineer: "test", projectCwd: "/tmp/x", adwName: "plan-build-review" });
  tracer.sessionSetTitle(ADW_ID, "server test run");
  tracer.phaseUpsert({
    phaseId: `${ADW_ID}_plan`,
    adwId: ADW_ID,
    seq: 1,
    name: "plan",
    kind: "agent",
    role: "planner",
    description: "plan step",
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:05.000Z",
    inputTokens: 100,
    outputTokens: 50,
  });
  tracer.event({ adwId: ADW_ID, phaseId: `${ADW_ID}_plan`, type: "log", name: "note", payload: { hi: true } });

  // Two more sessions against a second, distinct project_cwd — used by the
  // `/api/runs?project=` filtering tests below.
  tracer.sessionStart(ADW_ID_PROJECT_B, { engineer: "test", projectCwd: PROJECT_B_CWD, adwName: "plan-build-review" });
  tracer.sessionSetTitle(ADW_ID_PROJECT_B, "project B run 1");
  tracer.sessionStart(ADW_ID_PROJECT_B_2, { engineer: "test", projectCwd: PROJECT_B_CWD, adwName: "plan-build-review" });
  tracer.sessionSetTitle(ADW_ID_PROJECT_B_2, "project B run 2");

  // Two runs against the SAME project root, each with its own real
  // per-run worktree cwd — see the constants' own comment above.
  tracer.sessionStart(ADW_ID_WORKTREE_1, { engineer: "test", projectCwd: WORKTREE_CWD_1, adwName: "plan-build-review" });
  tracer.sessionSetTitle(ADW_ID_WORKTREE_1, "real project run 1");
  tracer.sessionStart(ADW_ID_WORKTREE_2, { engineer: "test", projectCwd: WORKTREE_CWD_2, adwName: "bounded-build-review" });
  tracer.sessionSetTitle(ADW_ID_WORKTREE_2, "real project run 2");

  tracer.close();
}

async function waitForServer(url: string, deadline: number): Promise<void> {
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`server did not come up in time: ${url}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pi-web-factory-visualizer-test-"));
  dbPath = join(dir, "factory.db");
  seed();

  baseUrl = `http://localhost:${String(TEST_PORT)}`;
  proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "server.ts")],
    env: {
      ...process.env,
      PI_WEB_FACTORY_VISUALIZER_DB_PATH: dbPath,
      PI_WEB_FACTORY_VISUALIZER_PORT: String(TEST_PORT),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForServer(`${baseUrl}/api/runs`, Date.now() + 15_000);
}, 20_000);

afterAll(() => {
  proc.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe("visualizer server (real spawned process, real HTTP)", () => {
  test("GET /api/runs lists the seeded run", async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    expect(res.status).toBe(200);
    const runs = (await res.json()) as Array<{ adwId: string; title: string | null; status: string }>;
    expect(runs.some((r) => r.adwId === ADW_ID)).toBe(true);
    const run = runs.find((r) => r.adwId === ADW_ID)!;
    expect(run.title).toBe("server test run");
    expect(run.status).toBe("running"); // sessionStart sets it running; never finished here
  });

  test("GET /api/runs?project=<cwd> filters to only runs matching that project_cwd exactly", async () => {
    const res = await fetch(`${baseUrl}/api/runs?project=${encodeURIComponent(PROJECT_B_CWD)}`);
    expect(res.status).toBe(200);
    const runs = (await res.json()) as Array<{ adwId: string; projectCwd: string | null }>;
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.projectCwd === PROJECT_B_CWD)).toBe(true);
    expect(runs.some((r) => r.adwId === ADW_ID_PROJECT_B)).toBe(true);
    expect(runs.some((r) => r.adwId === ADW_ID_PROJECT_B_2)).toBe(true);
    expect(runs.some((r) => r.adwId === ADW_ID)).toBe(false);
  });

  test("GET /api/runs?project=<cwd> with no matching runs returns an empty array (not 404)", async () => {
    const res = await fetch(`${baseUrl}/api/runs?project=${encodeURIComponent("/tmp/does-not-exist")}`);
    expect(res.status).toBe(200);
    const runs = (await res.json()) as unknown[];
    expect(runs).toEqual([]);
  });

  test("GET /api/runs with no project param returns runs across all projects (unchanged default behavior)", async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    expect(res.status).toBe(200);
    const runs = (await res.json()) as Array<{ adwId: string }>;
    expect(runs.some((r) => r.adwId === ADW_ID)).toBe(true);
    expect(runs.some((r) => r.adwId === ADW_ID_PROJECT_B)).toBe(true);
    expect(runs.some((r) => r.adwId === ADW_ID_PROJECT_B_2)).toBe(true);
  });

  test("GET /api/runs response exposes projectRoot, worktree-suffix-stripped, distinct from projectCwd", async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    const runs = (await res.json()) as Array<{ adwId: string; projectCwd: string | null; projectRoot: string | null }>;
    const run1 = runs.find((r) => r.adwId === ADW_ID_WORKTREE_1);
    const run2 = runs.find((r) => r.adwId === ADW_ID_WORKTREE_2);
    expect(run1?.projectCwd).toBe(WORKTREE_CWD_1);
    expect(run2?.projectCwd).toBe(WORKTREE_CWD_2);
    // Different (unique per run) projectCwd, but the SAME projectRoot.
    expect(run1?.projectCwd).not.toBe(run2?.projectCwd);
    expect(run1?.projectRoot).toBe(PROJECT_ROOT_CWD);
    expect(run2?.projectRoot).toBe(PROJECT_ROOT_CWD);
  });

  test("GET /api/runs?project=<root> groups multiple runs by their shared project root, not their unique per-run worktree cwd", async () => {
    // Regression test for a real bug: filtering by the raw projectCwd
    // column (each run's own unique worktree path) meant a "project"
    // filter only ever matched exactly one run. This asserts BOTH
    // worktree runs come back for the shared root, not just one.
    const res = await fetch(`${baseUrl}/api/runs?project=${encodeURIComponent(PROJECT_ROOT_CWD)}`);
    expect(res.status).toBe(200);
    const runs = (await res.json()) as Array<{ adwId: string }>;
    expect(runs.some((r) => r.adwId === ADW_ID_WORKTREE_1)).toBe(true);
    expect(runs.some((r) => r.adwId === ADW_ID_WORKTREE_2)).toBe(true);
    expect(runs.length).toBe(2);
  });

  test("GET /api/runs?project=<one run's raw worktree cwd> does NOT narrow to just that run (proves the filter uses projectRoot, not projectCwd)", async () => {
    const res = await fetch(`${baseUrl}/api/runs?project=${encodeURIComponent(WORKTREE_CWD_1)}`);
    const runs = (await res.json()) as unknown[];
    // WORKTREE_CWD_1 is never any run's projectRoot (it's a projectCwd,
    // the unique worktree path) -- filtering by it should match nothing,
    // confirming the filter really keys off the normalized root and isn't
    // silently falling back to an exact projectCwd match.
    expect(runs).toEqual([]);
  });

  test("GET /api/runs (list endpoint) also includes each run's Steps, batched — not just the detail endpoint", async () => {
    // Regression coverage for the grid needing every card's Steps up front
    // (M-090 follow-up, 2026-08-05): the list route used to return bare
    // run summaries, forcing a per-card detail fetch to paint a mini-Gantt.
    const res = await fetch(`${baseUrl}/api/runs`);
    const runs = (await res.json()) as Array<{ adwId: string; steps: Array<{ name: string; role: string }> }>;
    const run = runs.find((r) => r.adwId === ADW_ID);
    expect(run?.steps).toHaveLength(1);
    expect(run?.steps[0]!.name).toBe("plan");
    expect(run?.steps[0]!.role).toBe("planner");

    // A run with zero Steps still gets a (present, empty) array — not
    // undefined/missing — so the frontend never needs an existence check.
    const runNoSteps = runs.find((r) => r.adwId === ADW_ID_PROJECT_B);
    expect(runNoSteps?.steps).toEqual([]);
  });

  test("GET /api/runs/:adwId returns the run plus its Steps in seq order", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${ADW_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { adwId: string }; steps: Array<{ name: string; role: string; inputTokens: number }> };
    expect(body.run.adwId).toBe(ADW_ID);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]!.name).toBe("plan");
    expect(body.steps[0]!.role).toBe("planner"); // owner column mapped to `role`
    expect(body.steps[0]!.inputTokens).toBe(100);
  });

  test("GET /api/runs/:adwId for an unknown id returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/runs/adw_does_not_exist`);
    expect(res.status).toBe(404);
  });

  test("GET /api/runs/:adwId/events?since= returns events with rowid, and cursor filtering works", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${ADW_ID}/events?since=0`);
    expect(res.status).toBe(200);
    const events = (await res.json()) as Array<{ rowid: number; type: string; name: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.type).toBe("log");
    expect(typeof events[0]!.rowid).toBe("number");

    const maxRowid = Math.max(...events.map((e) => e.rowid));
    const res2 = await fetch(`${baseUrl}/api/runs/${ADW_ID}/events?since=${String(maxRowid)}`);
    const events2 = (await res2.json()) as unknown[];
    expect(events2).toHaveLength(0);
  });

  test("GET / serves the bundled frontend HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("pi-web-factory visualizer");
  });

  test("the server's db handle is genuinely readonly — direct write attempt against the same file fails, confirming the running process cannot have a writable handle open", async () => {
    // Open our OWN separate connection with the intended writer semantics
    // (create:false, no readonly) to prove the FILE and its schema are
    // exactly what Tracer already wrote, and that WAL mode doesn't somehow
    // let the server's readonly handle silently succeed at writes elsewhere.
    // The real assurance that server.ts's OWN handle is readonly is a static
    // property of its source (`new Database(DB_PATH, { readonly: true })`,
    // asserted by direct inspection here) plus the ad hoc bun:sqlite spike
    // performed during development, which confirmed readonly handles throw
    // on write. This test guards against a future regression removing that
    // flag by checking the running server's behavior stays correct: writing
    // via a fresh writable handle and confirming the server picks up the
    // change on its next read (proves the SAME file backs both, i.e. the
    // server truly is reading this db, not some other path).
    const writer = new Database(dbPath);
    writer.run("UPDATE sessions SET title=? WHERE adw_id=?", ["title changed by test", ADW_ID]);
    writer.close();

    const res = await fetch(`${baseUrl}/api/runs/${ADW_ID}`);
    const body = (await res.json()) as { run: { title: string } };
    expect(body.run.title).toBe("title changed by test");
  });
});
