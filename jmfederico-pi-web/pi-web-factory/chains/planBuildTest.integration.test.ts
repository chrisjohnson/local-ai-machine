/**
 * Live end-to-end integration test for the planBuildTest chain — M-066 card,
 * Plan item 5. Runs against the REAL, running `jmfederico-pi-web` instance
 * on `local-ai-machine` (http://192.168.1.21:8080/api), not a mock, same
 * pattern piwebClient.integration.test.ts already established (M-062).
 *
 * The scratch git repo this test targets lives inside the pi-web
 * CONTAINER's own filesystem (`/tmp/pi-web-factory-m066-test`, the
 * container's `/tmp`, not the host Mac's) — this test's own `cwd: "..."`
 * option is a real path from the perspective of the agent's tool calls
 * running server-side, reached over the network via piwebClient.ts's calls
 * to 192.168.1.21:8080. The scratch repo is created and inspected via
 * `ssh local-ai-machine "docker exec pi-web ..."` in beforeAll/afterAll —
 * see this file's companion setup/teardown below.
 *
 * `factory.db` (this test's OWN trace db, not the container's) is written
 * locally by this test's own `Tracer` instance and read back directly with
 * `bun:sqlite` to verify phase/event ordering and gate results — the same
 * approach tracer.test.ts already uses.
 *
 * Kept to ONE full end-to-end test case, same restraint as
 * piwebClient.integration.test.ts: this hits a real shared server and a
 * real local model across two full agent turns (plan, build) plus a code
 * gate — real wall-clock time is expected, not a bug.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tracer } from "../modules/tracer.ts";
import { loadConfig } from "../modules/config.ts";
import { DEFAULT_BASE_URL } from "../modules/piwebClient.ts";
import { planBuildTest } from "./planBuildTest.ts";

const SCRATCH_CWD = "/tmp/pi-web-factory-m066-test"; // path inside the pi-web CONTAINER
const TARGET_FILE = "hello.txt";
const CONFIG_PATH = join(import.meta.dir, "..", "factory.config.yaml");

function dockerExec(cmd: string): string {
  return execFileSync("ssh", ["local-ai-machine", `docker exec pi-web sh -c '${cmd}'`], {
    encoding: "utf8",
  });
}

let localDir: string;
let dbPath: string;
let tracer: Tracer;

beforeAll(() => {
  // Fresh scratch repo inside the container for this run (idempotent re-init
  // in case a prior run left state behind).
  dockerExec(
    `rm -rf ${SCRATCH_CWD} && mkdir -p ${SCRATCH_CWD} && cd ${SCRATCH_CWD} && ` +
      `git init -q && git config user.email test@example.com && git config user.name Test && ` +
      `git commit --allow-empty -q -m init`,
  );

  localDir = mkdtempSync(join(tmpdir(), "pi-web-factory-m066-"));
  dbPath = join(localDir, "factory.db");
  tracer = new Tracer(dbPath);
});

afterAll(() => {
  tracer.close();
  rmSync(localDir, { recursive: true, force: true });
  // Clean up the scratch repo inside the container so it doesn't linger.
  dockerExec(`rm -rf ${SCRATCH_CWD}`);
});

describe("planBuildTest chain (live pi-web server)", () => {
  test(
    "plan -> build -> test end to end against a real scratch repo in the pi-web container",
    async () => {
      const config = loadConfig(CONFIG_PATH);

      const taskPrompt =
        `In this git repository, create a new file named exactly "${TARGET_FILE}" containing ` +
        `exactly one line of text: "hello from pi-web-factory". Use your tools to actually write ` +
        `the file to disk — do not just describe it.`;

      // `gates.ts`'s `testsPass` shells out LOCALLY (by design — in the real
      // deployment pi-web-factory runs as a sibling process inside the same
      // container as pi-web itself, design doc §2, so a local shell-out is
      // the correct, reusable behavior). This test process, however, runs on
      // the dev Mac, not inside the container, so `cwd` (the container's
      // `/tmp/...`) isn't reachable as a local path here. Bridge that gap
      // the same way this test bridges every other container-side check —
      // wrap the check itself in `ssh ... docker exec ...` so `testsPass`'s
      // ordinary local `sh -c <cmd>` still runs unmodified, it just runs a
      // command whose real effect happens over that bridge. This is a
      // test-harness adaptation only; `gates.ts`/`run.ts`/`planBuildTest.ts`
      // are untouched.
      const testCmd = `ssh local-ai-machine "docker exec pi-web sh -c 'cd ${SCRATCH_CWD} && test -f ${TARGET_FILE}'"`;

      const result = await planBuildTest({
        tracer,
        config,
        cwd: SCRATCH_CWD,
        taskPrompt,
        testCmd,
        // testCmd above is a self-contained ssh/docker-exec check with no
        // need of a real local directory to run from — `localDir` (already
        // created for factory.db) just satisfies testsPass's requirement
        // that `Bun.spawn`'s cwd exist locally. See planBuildTest.ts's
        // `testCwd` doc comment for why this differs from `cwd` here.
        testCwd: localDir,
        baseUrl: DEFAULT_BASE_URL,
        engineer: "m066-integration-test",
      });

      // Clean up the pi-web session this chain started, regardless of
      // outcome, so this test doesn't leave scratch sessions on the shared
      // server — same archive-then-delete pattern
      // piwebClient.integration.test.ts already established (M-062).
      try {
        await fetch(`${DEFAULT_BASE_URL}/sessions/${result.sessionId}/archive`, { method: "POST" }).catch(
          () => undefined,
        );
        await fetch(`${DEFAULT_BASE_URL}/sessions/${result.sessionId}?cwd=${encodeURIComponent(SCRATCH_CWD)}`, {
          method: "DELETE",
        }).catch(() => undefined);
      } catch {
        // best-effort cleanup — never let it mask the real test result below
      }

      if (result.status !== "success") {
        // Surface whatever detail we have to make a failure diagnosable.
        throw new Error(`planBuildTest did not succeed: ${JSON.stringify(result, null, 2)}`);
      }

      expect(result.status).toBe("success");
      expect(result.plan.summary.length).toBeGreaterThan(0);
      expect(result.build.summary.length).toBeGreaterThan(0);
      expect(result.testReport.checks.every((c) => c.ok)).toBe(true);

      // ── verify the real file landed in the container's scratch repo ────
      const catOutput = dockerExec(`cd ${SCRATCH_CWD} && cat ${TARGET_FILE}`);
      expect(catOutput).toContain("hello from pi-web-factory");

      const gitLog = dockerExec(`cd ${SCRATCH_CWD} && git log --oneline`);
      expect(gitLog).toContain("init");

      // ── verify factory.db trace rows: phase/event ordering + gate result ──
      const adwId = result.adwId;

      const phases = tracer.db
        .query<
          {
            name: string;
            status: string;
            seq: number;
            kind: string;
            output_summary: string | null;
            input_tokens: number | null;
            output_tokens: number | null;
          },
          [string]
        >(
          "select name, status, seq, kind, output_summary, input_tokens, output_tokens from phases where adw_id=? order by seq",
        )
        .all(adwId);
      expect(phases.map((p) => p.name)).toEqual(["plan", "build", "test"]);
      expect(phases.every((p) => p.status === "success")).toBe(true);

      // M-074: agentic steps (plan, build) narrow to kind='agent'; the code
      // step (test) narrows to kind='code' — the narrowed StepKind type
      // round-tripping through a REAL run, not just a unit test.
      const [planPhase, buildPhase, testPhase] = phases;
      expect(planPhase?.kind).toBe("agent");
      expect(buildPhase?.kind).toBe("agent");
      expect(testPhase?.kind).toBe("code");

      // M-074: run.ts now populates output_summary (from the envelope's own
      // `summary` field) and per-step token columns for real agent steps —
      // confirmed here against a real agent turn, not a mocked one.
      expect(planPhase?.output_summary).toBe(result.plan.summary);
      expect(buildPhase?.output_summary).toBe(result.build.summary);
      expect(planPhase?.input_tokens).toBeGreaterThan(0);
      expect(planPhase?.output_tokens).toBeGreaterThan(0);
      expect(buildPhase?.input_tokens).toBeGreaterThan(0);
      expect(buildPhase?.output_tokens).toBeGreaterThan(0);

      const eventTypes = tracer.db
        .query<{ type: string; phase_id: string }, [string]>(
          "select type, phase_id from events where adw_id=? order by rowid",
        )
        .all(adwId);
      // phase_start must precede phase_end within each phase, in event order.
      const seenStart = new Set<string>();
      for (const e of eventTypes) {
        if (e.type === "phase_start") seenStart.add(e.phase_id);
        if (e.type === "phase_end") expect(seenStart.has(e.phase_id)).toBe(true);
      }
      expect(eventTypes.some((e) => e.type === "gate_pass")).toBe(true);
      expect(eventTypes.some((e) => e.type === "error")).toBe(false);

      const testGate = tracer.db
        .query<{ passed: number; gate: string }, [string]>(
          "select passed, gate from gate_results where adw_id=? and gate='tests_pass'",
        )
        .get(adwId);
      expect(testGate?.passed).toBe(1);

      const sessionRow = tracer.db
        .query<{ status: string; project_cwd: string }, [string]>(
          "select status, project_cwd from sessions where adw_id=?",
        )
        .get(adwId);
      expect(sessionRow?.status).toBe("success");
      expect(sessionRow?.project_cwd).toBe(SCRATCH_CWD);
    },
    { timeout: 600_000 },
  );
});
