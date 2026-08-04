/**
 * planBuildTest: plan -> build -> test -> done. The smallest chain that
 * exercises every module end to end (client, envelopes, gates, permissions,
 * config) — M-066 card, Plan item 2.
 *
 * Deliberately thin, mirroring upstream SSSF's own `adw_*.py` restraint
 * (40-180 lines, "don't let chains/ accumulate logic that belongs in one of
 * the four modules" — M-066 card). Sequencing/wiring only:
 *   - phase 1 ("plan", agent phase): the `plan` agent produces a PlanOutput
 *     envelope for a target task.
 *   - phase 2 ("build", agent phase): the `build` agent, continuing the SAME
 *     session (design doc §3.2: thread (sessionId, cwd) from phase N into
 *     phase N+1, don't mint a fresh session per phase), implements the task
 *     and produces a BuildOutput envelope.
 *   - phase 3 ("test", code phase — not an agent call): runs `testsPass`
 *     against the project's configured test command.
 *
 * `sessionStart`/`sessionFinish` bracket the whole chain at the adwId level,
 * per the design doc's execution pseudocode.
 */

import { randomUUID } from "node:crypto";
import { PlanOutputSchema, BuildOutputSchema, type BuildOutput, type PlanOutput } from "../modules/envelopes.ts";
import { testsPass } from "../modules/gates.ts";
import { DEFAULT_BASE_URL, startSession } from "../modules/piwebClient.ts";
import { agentConfigFor, type FactoryConfig } from "../modules/config.ts";
import { Tracer, type GateReport } from "../modules/tracer.ts";
import { runAgentPhase, type RunAgentPhaseResult } from "../modules/run.ts";
import type { PermissionsResult } from "../modules/permissions.ts";

export interface PlanBuildTestOptions {
  tracer: Tracer;
  config: FactoryConfig;
  /** Absolute path to the target project's working tree. */
  cwd: string;
  /** The task description handed to the `plan` agent. */
  taskPrompt: string;
  /** Test command to gate on. Falls back to `projectConfigFor(config, cwd).test` when omitted — pass explicitly for a project not registered in factory.config.yaml's `projects:` map (e.g. a scratch test repo). */
  testCmd?: string;
  /**
   * Local filesystem cwd for the `testsPass` gate's `sh -c` shell-out
   * (`gates.ts`'s `testsPass(cmd, cwd)` requires a real, LOCAL directory —
   * `Bun.spawn` refuses to spawn a shell at a nonexistent `cwd`). Defaults
   * to `cwd` (the co-located-deployment case: pi-web-factory runs as a
   * sibling process inside the same container as the target project, design
   * doc §2, so `cwd` is already local). Only needs overriding when the
   * agent's `cwd` is on a different machine than the factory process
   * itself (e.g. driving a container's project over the network from a dev
   * machine) and `testCmd` is itself a self-contained remote check (ssh/
   * docker exec/etc) that doesn't need a real local directory to run from.
   */
  testCwd?: string;
  baseUrl?: string;
  /** adwId to use; a fresh one is minted when omitted. */
  adwId?: string;
  /**
   * Existing pi-web session to resume (design doc §3.4's `WorkItem.session_id?`
   * — the seam a future ticket-queue worker/CLI `--session-id` flag threads
   * through). When provided, `startSession` is skipped entirely and this id is
   * used directly for both phases — piwebClient.ts's session routes resolve a
   * `(id, cwd)` pair generically regardless of which process minted it, so
   * resuming a session started by an earlier run (or even a different
   * process) works the same as continuing one just started in this call. A
   * fresh session is minted, as before, when omitted.
   */
  sessionId?: string;
  engineer?: string;
}

export type PlanBuildTestResult =
  | { status: "success"; adwId: string; sessionId: string; plan: PlanOutput; build: BuildOutput; testReport: GateReport }
  | { status: "blocked-on-human"; adwId: string; sessionId: string; phase: "plan" | "build"; pendingAsk: unknown }
  | { status: "failed"; adwId: string; sessionId: string; phase: "plan" | "build" | "test"; reason: string }
  | { status: "unparseable"; adwId: string; sessionId: string; phase: "plan" | "build"; lastReport: GateReport }
  | {
      status: "permissions-violation";
      adwId: string;
      sessionId: string;
      phase: "plan" | "build";
      permissions: PermissionsResult;
    };

function toChainOutcome<Phase extends "plan" | "build">(
  adwId: string,
  sessionId: string,
  phase: Phase,
  result: RunAgentPhaseResult<typeof PlanOutputSchema | typeof BuildOutputSchema>,
): PlanBuildTestResult | undefined {
  if (result.status === "blocked-on-human") {
    return { status: "blocked-on-human", adwId, sessionId, phase, pendingAsk: result.pendingAsk };
  }
  if (result.status === "error") {
    return { status: "failed", adwId, sessionId, phase, reason: result.reason };
  }
  if (result.status === "unparseable") {
    return { status: "unparseable", adwId, sessionId, phase, lastReport: result.lastReport };
  }
  if (result.status === "permissions-violation") {
    return { status: "permissions-violation", adwId, sessionId, phase, permissions: result.permissions };
  }
  return undefined; // "success" — caller continues
}

export async function planBuildTest(opts: PlanBuildTestOptions): Promise<PlanBuildTestResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const adwId = opts.adwId ?? `adw_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const testCmd = opts.testCmd;

  opts.tracer.sessionStart(adwId, { engineer: opts.engineer, projectCwd: opts.cwd, adwName: "planBuildTest" });
  opts.tracer.sessionRequest(adwId, opts.taskPrompt);

  const planAgent = agentConfigFor(opts.config, "plan");
  const buildAgent = agentConfigFor(opts.config, "build");
  const protectedFiles = opts.config.defaults.protectedFiles;

  const session = opts.sessionId
    ? { id: opts.sessionId }
    : await startSession(baseUrl, opts.cwd, `${adwId}:planBuildTest`);

  // ── phase 1: plan ──────────────────────────────────────────────────────
  const planResult = await runAgentPhase({
    tracer: opts.tracer,
    baseUrl,
    adwId,
    phaseId: `${adwId}_plan`,
    seq: 1,
    cwd: opts.cwd,
    agent: planAgent,
    sessionId: session.id,
    modelAlreadySet: false,
    promptText:
      `You are the "plan" agent. Task: ${opts.taskPrompt}\n\n` +
      `Reply with ONLY a single valid JSON object matching this schema (no prose, no markdown fences):\n` +
      `{"status": "success"|"fail", "summary": string, "artifacts": string[], ` +
      `"notes_for_next_agent": string, "commit_message": string}`,
    envelopeSchema: PlanOutputSchema,
    outputTypeName: "plan",
    protectedFiles,
  });

  const planOutcome = toChainOutcome(adwId, session.id, "plan", planResult);
  if (planOutcome) {
    opts.tracer.sessionFinish(adwId, false);
    return planOutcome;
  }
  if (planResult.status !== "success") throw new Error("unreachable: non-success plan result without an outcome");

  // ── phase 2: build (same session — continuation, not a fresh session) ──
  const buildResult = await runAgentPhase({
    tracer: opts.tracer,
    baseUrl,
    adwId,
    phaseId: `${adwId}_build`,
    seq: 2,
    cwd: opts.cwd,
    agent: buildAgent,
    sessionId: session.id,
    modelAlreadySet: false, // different agent identity => different model, must be (re-)set
    promptText:
      `You are the "build" agent, continuing from the plan you just produced. ` +
      `Using your available tools, actually implement the task now (write real files to disk). ` +
      `Plan summary: ${planResult.envelope.summary}\n\n` +
      `Once done, reply with ONLY a single valid JSON object matching this schema (no prose, no markdown fences):\n` +
      `{"status": "success"|"fail", "summary": string, "artifacts": string[], ` +
      `"notes_for_next_agent": string, "changed_files": string[], "commit_message": string}`,
    envelopeSchema: BuildOutputSchema,
    outputTypeName: "build",
    protectedFiles,
  });

  const buildOutcome = toChainOutcome(adwId, session.id, "build", buildResult);
  if (buildOutcome) {
    opts.tracer.sessionFinish(adwId, false);
    return buildOutcome;
  }
  if (buildResult.status !== "success") throw new Error("unreachable: non-success build result without an outcome");

  // ── phase 3: test (code phase — no agent call) ──────────────────────────
  const testPhaseId = `${adwId}_test`;
  opts.tracer.event({
    adwId,
    phaseId: testPhaseId,
    type: "phase_start",
    name: "test",
    payload: { kind: "code", owner: "gates.testsPass", description: testCmd ?? "(no test command configured)" },
  });

  if (!testCmd) {
    const reason = "no test command configured for this project (pass testCmd or add it to factory.config.yaml)";
    opts.tracer.event({
      adwId,
      phaseId: testPhaseId,
      type: "phase_end",
      name: "test",
      payload: { status: "fail", error: reason },
    });
    opts.tracer.sessionFinish(adwId, false);
    return { status: "failed", adwId, sessionId: session.id, phase: "test", reason };
  }

  const testReport = await testsPass(testCmd, opts.testCwd ?? opts.cwd);
  const testPassed = testReport.checks.every((c) => c.ok);

  opts.tracer.event({
    adwId,
    phaseId: testPhaseId,
    type: testPassed ? "gate_pass" : "gate_fail",
    name: "tests_pass",
    payload: { attempt: 1, checks: testReport.checks },
  });
  opts.tracer.event({
    adwId,
    phaseId: testPhaseId,
    type: "phase_end",
    name: "test",
    payload: { status: testPassed ? "success" : "fail" },
  });

  opts.tracer.sessionFinish(adwId, testPassed);

  if (!testPassed) {
    return {
      status: "failed",
      adwId,
      sessionId: session.id,
      phase: "test",
      reason: testReport.checks.find((c) => !c.ok)?.note ?? "tests failed",
    };
  }

  return {
    status: "success",
    adwId,
    sessionId: session.id,
    plan: planResult.envelope,
    build: buildResult.envelope,
    testReport,
  };
}
