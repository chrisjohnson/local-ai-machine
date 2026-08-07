/**
 * workflow.ts: the generic Workflow interpreter (M-076 card) — replaces
 * "one hand-written TS file per chain shape" (`chains/planBuildTest.ts`,
 * M-066, left in place as a historical/independent third option — see this
 * card's own decision log / report for why) with ONE runner that walks any
 * `Workflow` definition (`workflowDef.ts`) against the Roles registry
 * (`roles.ts`, M-075), generically.
 *
 * Does, generically, exactly what `planBuildTest.ts` does by hand:
 *   - registers the target repo as a pi-web Project, creates this run's own
 *     worktree (skipped on resume — `worktree.ts`/`piwebProject.ts` reused
 *     directly, not reimplemented, same as planBuildTest.ts).
 *   - starts (or resumes) ONE session, threaded through every Step in order.
 *   - for an `agent` Step: resolves the Role, builds the real prompt (task
 *     text + `{{stepName.field}}` interpolation from prior steps' envelopes +
 *     the M-069 role marker), calls `run.ts`'s `runAgentPhase`, and branches
 *     on its discriminated result exactly like `planBuildTest.ts`'s
 *     `toChainOutcome` does (ported/generalized here as `toRunOutcome`).
 *   - for a `code` Step: resolves the Role, calls `role.run(project, cwd)`,
 *     traces the GateReport as `gate_pass`/`gate_fail` (same pattern
 *     `planBuildTest.ts`'s hand-written test phase already established), and
 *     treats a failing gate as a distinct, real Workflow Run outcome — never
 *     silently continuing past it.
 *   - for a `loop` Step: runs its inner steps in order, up to `max_rounds`
 *     times, checking `until` against the named inner step's most-recently-
 *     parsed envelope after each full round. Satisfied -> continue past the
 *     loop. Exhausted -> a genuinely distinct outcome, `"loop-exhausted"`
 *     (never silently folded into "success" or a generic "failed" — same
 *     discipline `run.ts`'s own bounded parse-retry loop already
 *     established, and this card's own brief insists on by name).
 *
 * ── {{stepName.field}} interpolation ─────────────────────────────────────
 * Deliberately narrow: a flat `Record<string, string>` built up as steps
 * complete (`"<stepName>.<envelopeField>" -> stringified value`), substituted
 * via one `String.replace` pass over `{{...}}` tokens — NOT a general
 * template engine (no conditionals, no loops, no expressions, no nested
 * paths beyond one field). An unresolved token (unknown step, unknown field,
 * or a step that hasn't run yet — e.g. referencing a LATER step, or a step
 * inside a loop from OUTSIDE that loop on a round that hasn't happened)
 * throws a clear `WorkflowError` naming the token, rather than silently
 * leaving `{{...}}` literal text in a live prompt sent to a real model.
 *
 * ── Session continuation ──────────────────────────────────────────────────
 * One pi-web session per Workflow Run, threaded through every Step exactly
 * as `planBuildTest.ts` does (design doc §3.2) — including every round of a
 * loop's repeated inner steps (a loop step is NOT a fresh session per round,
 * it's the same session getting corrected and re-prompted, same spirit as
 * `run.ts`'s own retry-on-parse-failure loop operating within one session).
 *
 * ── Per-step tracing (M-074) ─────────────────────────────────────────────
 * Agent steps: `run.ts`'s `runAgentPhase` already writes phase_start/
 * agent_start/agent_end/gate_pass|fail/phase_end, including per-step
 * token/output_summary columns — nothing extra needed here beyond calling it
 * (confirmed by reading run.ts in full, module header there). Code steps:
 * THIS module is responsible for tracing (`phase_start`/`gate_pass|fail`/
 * `phase_end`, `output_summary` built from the GateReport's checks), since a
 * code Role's `run()` returns a bare `GateReport` with no tracing of its own.
 */

import { randomUUID } from "node:crypto";
import type { ReviewOutput } from "./envelopes.ts";
import { DEFAULT_BASE_URL, startSession, roleMarker } from "./piwebClient.ts";
import { agentRoleFor, codeRoleFor, type RolesConfig } from "./roles.ts";
import { Tracer, deriveTitleFromPrompt, type GateReport } from "./tracer.ts";
import { runAgentPhase, type RunAgentPhaseResult } from "./run.ts";
import type { PermissionsResult } from "./permissions.ts";
import { ensureProjectRegistered, resolveWorkspaceId } from "./piwebProject.ts";
import { createRunWorktree, resolveMainCheckoutPath } from "./worktree.ts";
import { envelopeSchemas, type AgentIdentity } from "./envelopes.ts";
import { projectConfigFor } from "./config.ts";
import type { Step, Workflow, AgentStep, CodeStep, LoopStep } from "./workflowDef.ts";

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

// ── Options / result shapes (generalizes PlanBuildTestOptions/Result) ─────

export interface WorkflowRunOptions {
  tracer: Tracer;
  config: RolesConfig;
  workflow: Workflow;
  /** Absolute path to the target project's working tree — main checkout or an existing worktree of it (see chains/planBuildTest.ts's identical option for full reasoning, ported verbatim here). */
  cwd: string;
  /** The task description handed to the FIRST agent step (subsequent agent steps get their own step-authored `prompt`, with interpolation applied). */
  taskPrompt: string;
  /** Local filesystem cwd for a code step's shell-out gate, when it must differ from the session cwd. Defaults to sessionCwd. See planBuildTest.ts's identical `testCwd` option. */
  testCwd?: string;
  baseUrl?: string;
  /** adwId to use; a fresh one is minted when omitted. */
  adwId?: string;
  /** Existing pi-web session to resume — worktree creation is skipped, exactly as planBuildTest.ts's sessionId option documents. */
  sessionId?: string;
  /** Overrides resolveMainCheckoutPath(opts.cwd) — see planBuildTest.ts's identical option. */
  mainCheckoutPath?: string;
  engineer?: string;
}

export interface WorkflowRunLinkInfo {
  projectId: string;
  workspaceId: string | undefined;
  cwd: string;
}

export type WorkflowRunResult =
  | {
      status: "success";
      adwId: string;
      sessionId: string;
      link: WorkflowRunLinkInfo;
      /** Every completed step's parsed envelope / gate report, by step name — the final state of the interpolation map's underlying data. */
      steps: Record<string, unknown>;
    }
  | {
      status: "blocked-on-human";
      adwId: string;
      sessionId: string;
      step: string;
      pendingAsk: unknown;
      link: WorkflowRunLinkInfo;
    }
  | {
      status: "failed";
      adwId: string;
      sessionId: string;
      step: string;
      reason: string;
      link: WorkflowRunLinkInfo;
    }
  | {
      status: "unparseable";
      adwId: string;
      sessionId: string;
      step: string;
      lastReport: GateReport;
      /** The agent's actual last-attempt response text that failed to parse (capped — see run.ts's truncateRawResponse) — what lets a human see roughly what the agent said and judge why it didn't parse. */
      rawResponse: string;
      link: WorkflowRunLinkInfo;
    }
  | {
      status: "permissions-violation";
      adwId: string;
      sessionId: string;
      step: string;
      permissions: PermissionsResult;
      link: WorkflowRunLinkInfo;
    }
  | {
      status: "gate-failed";
      adwId: string;
      sessionId: string;
      step: string;
      report: GateReport;
      link: WorkflowRunLinkInfo;
    }
  | {
      status: "loop-exhausted";
      adwId: string;
      sessionId: string;
      /** The loop step's own name. */
      step: string;
      rounds: number;
      link: WorkflowRunLinkInfo;
    };

// ── {{stepName.field}} interpolation ────────────────────────────────────

const INTERPOLATION_TOKEN = /\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}/g;

/**
 * Flat `"<stepName>.<field>" -> stringified value` map, built up as agent
 * steps complete. Deliberately flat/string-only (module header's "narrow,
 * NOT a general template engine" note) — an envelope field that's itself an
 * array/object stringifies via `JSON.stringify` rather than being excluded,
 * so referencing e.g. `{{review.blocking}}` still produces SOMETHING
 * readable in a corrective prompt, not a silent drop.
 */
export type InterpolationContext = Map<string, string>;

/** Records one completed step's envelope fields into the interpolation context, flattened one level deep. */
export function recordStepEnvelope(ctx: InterpolationContext, stepName: string, envelope: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(envelope)) {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    ctx.set(`${stepName}.${field}`, rendered);
  }
}

/**
 * Substitutes every `{{stepName.field}}` token in `text` against `ctx`.
 * Throws `WorkflowError` naming the exact unresolved token on any miss —
 * never silently leaves `{{...}}` literal text in a prompt sent to a real
 * model (module header comment).
 */
export function interpolate(text: string, ctx: InterpolationContext): string {
  return text.replace(INTERPOLATION_TOKEN, (full, stepName: string, field: string) => {
    const key = `${stepName}.${field}`;
    const value = ctx.get(key);
    if (value === undefined) {
      throw new WorkflowError(
        `unresolved interpolation token ${full} — no completed step named ${JSON.stringify(stepName)} ` +
          `has produced a ${JSON.stringify(field)} field yet (steps run in order; a token can only ` +
          `reference an EARLIER step, never a later one or itself)`,
      );
    }
    return value;
  });
}

// ── correction message for a loop's rejected round ─────────────────────

/**
 * Builds a correction message for the NEXT round of a loop, naming exactly
 * what the review found wrong — same "name exactly what was wrong"
 * discipline `run.ts`'s `buildCorrectionMessage` established for parse
 * failures, adapted here for a chain-level (Step-sequence) rejection rather
 * than a single phase's parse failure (module header comment: this is a
 * genuinely different mechanism, not a reuse of that one).
 */
export function buildLoopCorrectionMessage(reviewEnvelope: ReviewOutput, nextStepPrompt: string): string {
  const blocking = reviewEnvelope.blocking.length > 0 ? reviewEnvelope.blocking : ["(no specific blocking items listed)"];
  const unmetFindings = reviewEnvelope.findings.filter((f) => !f.met);
  const findingsText =
    unmetFindings.length > 0
      ? unmetFindings.map((f) => `- ${f.requirement}: ${f.evidence || "not met"}`).join("\n")
      : "(no specific unmet requirements listed)";
  return (
    `Your previous attempt was reviewed and NOT approved. Specifically:\n\n` +
    `Blocking:\n${blocking.map((b) => `- ${b}`).join("\n")}\n\n` +
    `Unmet requirements:\n${findingsText}\n\n` +
    `Address every item above, then continue with the task:\n\n${nextStepPrompt}`
  );
}

// ── outcome mapping (generalizes planBuildTest.ts's toChainOutcome) ───────

function toRunOutcome(
  adwId: string,
  sessionId: string,
  stepName: string,
  link: WorkflowRunLinkInfo,
  result: RunAgentPhaseResult<(typeof envelopeSchemas)[AgentIdentity]>,
): WorkflowRunResult | undefined {
  if (result.status === "blocked-on-human") {
    return { status: "blocked-on-human", adwId, sessionId, step: stepName, pendingAsk: result.pendingAsk, link };
  }
  if (result.status === "error") {
    return { status: "failed", adwId, sessionId, step: stepName, reason: result.reason, link };
  }
  if (result.status === "unparseable") {
    return { status: "unparseable", adwId, sessionId, step: stepName, lastReport: result.lastReport, rawResponse: result.rawResponse, link };
  }
  if (result.status === "permissions-violation") {
    return { status: "permissions-violation", adwId, sessionId, step: stepName, permissions: result.permissions, link };
  }
  return undefined; // "success" — caller continues
}

/** Resolves an agent step's envelope schema — every agent Role name in this codebase's shipped config also names an envelopeSchemas key (plan/build/review/scout/document); a step naming any other role fails clearly rather than guessing a schema. */
function envelopeSchemaForRole(roleName: string): (typeof envelopeSchemas)[AgentIdentity] {
  const schema = (envelopeSchemas as Record<string, (typeof envelopeSchemas)[AgentIdentity] | undefined>)[roleName];
  if (!schema) {
    throw new WorkflowError(
      `agent step names role ${JSON.stringify(roleName)}, which has no matching envelope schema in envelopes.ts's ` +
        `registry (available: ${Object.keys(envelopeSchemas).join(", ")}) — every agent Role's name must also be an ` +
        `envelopeSchemas key so the interpreter knows which schema to parse its output against`,
    );
  }
  return schema;
}

/** Builds a short output_summary for a code step's phase_end from its GateReport — "N/M checks passed" on success, the first failing check's note on failure. */
function summarizeGateReport(report: GateReport): string {
  const total = report.checks.length;
  const passed = report.checks.filter((c) => c.ok).length;
  if (passed === total) return `${String(passed)}/${String(total)} checks passed`;
  const firstFailure = report.checks.find((c) => !c.ok);
  return firstFailure ? `${firstFailure.item}: ${firstFailure.note ?? "failed"}` : `${String(passed)}/${String(total)} checks passed`;
}

// ── the interpreter ──────────────────────────────────────────────────────

interface RunContext {
  tracer: Tracer;
  config: RolesConfig;
  baseUrl: string;
  adwId: string;
  sessionId: string;
  sessionCwd: string;
  testCwd: string;
  link: WorkflowRunLinkInfo;
  interpolation: InterpolationContext;
  /** Every completed step's raw envelope/report, by step name — becomes WorkflowRunResult.steps on success. */
  stepResults: Record<string, unknown>;
  /** Tracks whether setModel has been called on this session yet (planBuildTest.ts's modelAlreadySet semantics, generalized: only the FIRST step to touch the session needs to set its model — every step after re-sets it too, since different steps commonly use different Roles/models; see runStepSeq below). */
  seq: number;
  /** The Workflow Run's original top-level task prompt — see taskPromptInjected below. */
  taskPrompt: string;
  /**
   * Whether `taskPrompt` has already been prefixed onto some agent step's
   * prompt yet. Lives on `ctx` (not a closure-local in `runSteps`, and NOT
   * re-derived per call site) specifically because `runAgentStep` is called
   * from TWO places — the top-level `runSteps` loop AND `runLoopStep`'s inner
   * loop — and the very first agent step of a Workflow could, in principle,
   * be inside a loop (neither of today's two shipped Workflows happens to
   * start that way, but the interpreter has to be correct for one that does,
   * not just for the two it ships with). Checked/set inside `runAgentStep`
   * itself so both call sites go through the exact same logic — see that
   * function, not here, for where the prefixing actually happens.
   */
  taskPromptInjected: boolean;
  /**
   * The phaseId of whatever Step is CURRENTLY open (a `phase_start` has been
   * traced but its terminal `phase_end` has not yet been written), or
   * `undefined` when no Step is open (between steps, or before the first
   * step has started). M-100 Fix 1: `runAgentStep`/`runCodeStep` both know
   * their own phaseId transiently, but a top-level catch-all around the
   * whole run (see `runWorkflow`'s try/catch) needs to know it too, to close
   * out whichever Step was open at the moment an uncaught exception hit —
   * e.g. a `PiWebClientError` thrown by `setModel`/`sendPrompt` BEFORE
   * `waitForCompletion` resolves, which today leaves the row `status:
   * 'running'` forever (see this card's Decision log for the full trace).
   * Set right before a Step's `phase_start` is traced, cleared right after
   * its `phase_end` is traced — so it's accurate at every point in between,
   * including inside `runLoopStep`'s inner steps.
   */
  openPhase: { phaseId: string; stepName: string } | undefined;
}

/**
 * Runs one `agent` Step. Returns either the next interpolation-ready prompt
 * outcome (envelope recorded, caller continues) or a terminal
 * `WorkflowRunResult` to return immediately.
 */
async function runAgentStep(
  ctx: RunContext,
  step: AgentStep,
  promptTextOverride?: string,
): Promise<{ envelope: Record<string, unknown> } | WorkflowRunResult> {
  const role = agentRoleFor(ctx.config, step.role);
  const schema = envelopeSchemaForRole(step.role);
  const protectedFiles = ctx.config.defaults.protectedFiles;

  let rawPrompt = promptTextOverride ?? step.prompt;
  // The very first agent step of the WHOLE Workflow Run (top-level or nested
  // inside a loop — see ctx.taskPromptInjected's doc comment) is seeded with
  // the run's original task prompt, mirroring planBuildTest.ts's plan phase
  // (the only phase there seeded directly from opts.taskPrompt). Checked here
  // rather than by the caller so both call sites (runSteps, runLoopStep) are
  // correct without either needing to know about the other.
  if (!ctx.taskPromptInjected) {
    rawPrompt = `Task: ${ctx.taskPrompt}\n\n${rawPrompt}`;
    ctx.taskPromptInjected = true;
  }
  const promptText = interpolate(rawPrompt, ctx.interpolation);

  ctx.seq += 1;
  const phaseId = `${ctx.adwId}_${step.name}`;
  // M-100 Fix 1: mark this Step "open" BEFORE runAgentPhase's own
  // phase_start write (it happens inside runAgentPhase, first thing) —
  // openPhase must already be accurate for the whole duration of this call,
  // including the window before phase_start lands, since runWorkflow's
  // catch-all needs to know which row to close out even if the very first
  // await inside runAgentPhase (setModel/sendPrompt) throws.
  //
  // Deliberately NOT cleared in a `finally` here: a `finally` in THIS
  // function would run (and clear ctx.openPhase) BEFORE an exception
  // propagates up to runWorkflow's own try/catch (inner finally always
  // finishes before an outer catch runs, per ordinary JS unwind order) —
  // which would blank out openPhase right before the one place that needs
  // to read it. Instead: cleared explicitly on every NON-throwing return
  // path below (both the terminal-outcome branch and the success branch),
  // so it's still accurate at the moment of a throw, and still correctly
  // reset to "nothing open" once this function returns normally.
  ctx.openPhase = { phaseId, stepName: step.name };
  const result = await runAgentPhase({
    tracer: ctx.tracer,
    baseUrl: ctx.baseUrl,
    adwId: ctx.adwId,
    phaseId,
    seq: ctx.seq,
    cwd: ctx.sessionCwd,
    agent: role,
    sessionId: ctx.sessionId,
    // Every step re-sets the model explicitly: unlike planBuildTest.ts's
    // fixed two-agent shape, a generic Workflow's steps commonly alternate
    // between DIFFERENT Roles/models (e.g. bounded-build-review's
    // build/review/build alternation) — always setting it is correct and,
    // per run.ts's own doc comment, only wasteful (never incorrect) on the
    // rare step that happens to reuse the same model as its predecessor.
    modelAlreadySet: false,
    promptText,
    promptPrefix: roleMarker(step.role),
    envelopeSchema: schema,
    outputTypeName: step.role,
    protectedFiles,
  });
  ctx.openPhase = undefined;

  const outcome = toRunOutcome(ctx.adwId, ctx.sessionId, step.name, ctx.link, result);
  if (outcome) return outcome;
  if (result.status !== "success") throw new WorkflowError(`unreachable: non-success agent step result without an outcome (step=${step.name})`);

  const envelope = result.envelope as Record<string, unknown>;
  recordStepEnvelope(ctx.interpolation, step.name, envelope);
  ctx.stepResults[step.name] = envelope;
  return { envelope };
}

/** Runs one `code` Step. Returns either its GateReport (caller decides pass/fail) or a terminal result if the Role/config itself is unusable. */
async function runCodeStep(ctx: RunContext, step: CodeStep): Promise<{ report: GateReport } | WorkflowRunResult> {
  const role = codeRoleFor(ctx.config, step.role);
  const phaseId = `${ctx.adwId}_${step.name}`;
  ctx.seq += 1;

  ctx.tracer.event({
    adwId: ctx.adwId,
    phaseId,
    type: "phase_start",
    name: step.name,
    payload: { kind: "code", owner: role.name, description: `code role: ${role.function}`, seq: ctx.seq },
  });
  // M-100 Fix 1: this Step is now open (phase_start just traced) — see
  // ctx.openPhase's doc comment. Deliberately NOT cleared via `finally`
  // here — same reasoning as runAgentStep above: an inner `finally` would
  // run (and blank ctx.openPhase) before an exception ever reaches
  // runWorkflow's own catch. Cleared explicitly on every non-throwing
  // return path below instead.
  ctx.openPhase = { phaseId, stepName: step.name };

  // A code Role's own function (e.g. run-tests) is what pulls testCmd out
  // of the project's config (see roles.ts's CODE_ROLE_REGISTRY:
  // `testsPass(project.test ?? "", cwd)`), so this interpreter only needs
  // to supply the ProjectConfig itself, via the SAME project-local lookup
  // cli.ts/planBuildTest.ts's own testCmd derivation already established
  // (M-070) — reused directly, not re-derived.
  const projectConfig = projectConfigFor(ctx.sessionCwd);

  const report = await role.run(projectConfig, ctx.testCwd);
  const passed = report.checks.every((c) => c.ok);
  const summary = summarizeGateReport(report);

  ctx.tracer.event({
    adwId: ctx.adwId,
    phaseId,
    type: passed ? "gate_pass" : "gate_fail",
    name: role.function,
    payload: { attempt: 1, checks: report.checks },
  });
  ctx.tracer.event({
    adwId: ctx.adwId,
    phaseId,
    type: "phase_end",
    name: step.name,
    payload: { status: passed ? "success" : "fail", outputSummary: summary, error: passed ? undefined : summary },
  });

  ctx.stepResults[step.name] = report;
  ctx.openPhase = undefined;

  if (!passed) {
    return {
      status: "gate-failed",
      adwId: ctx.adwId,
      sessionId: ctx.sessionId,
      step: step.name,
      report,
      link: ctx.link,
    };
  }
  return { report };
}

/**
 * Runs one `loop` Step. Returns undefined when the `until` condition was
 * satisfied (caller continues past the loop) or a terminal
 * `WorkflowRunResult` otherwise (loop-exhausted, or any inner step's own
 * terminal outcome).
 *
 * ── Condition check timing: after `until.step` runs, not only at round-end ──
 * The card's brief says "checking after each round" — this implementation
 * checks the moment `until.step` itself completes within a round (still
 * exactly ONE check per round, since `until.step` runs exactly once per
 * round) and, if satisfied, stops the round THERE rather than running the
 * rest of that round's steps pointlessly. Concretely, for
 * bounded-build-review's `[review, build-retry]` loop: if `review` approves
 * on round 1, `build-retry` never runs that round — re-implementing already-
 * approved work would be actively wrong, not merely wasteful. This is a
 * strictly more correct reading of "checking after each round," not a
 * looser one: the round's OUTCOME is still decided by `until.step`'s result
 * for that round, exactly once, in round order.
 *
 * ── Correction folding ────────────────────────────────────────────────────
 * Any agent step that runs AFTER `until.step` within a round, on a round
 * where the condition was NOT satisfied, gets `until.step`'s
 * blocking/unmet findings folded into its prompt as a correction (this
 * loop's own equivalent of run.ts's buildCorrectionMessage — see
 * buildLoopCorrectionMessage's doc comment for why it's a distinct
 * mechanism). Steps that run BEFORE `until.step` in a round (i.e. `until.step`
 * hasn't produced this round's verdict yet) never get a correction from a
 * round that hasn't happened yet — only from a PRIOR round's rejection.
 */
async function runLoopStep(ctx: RunContext, loop: LoopStep): Promise<WorkflowRunResult | undefined> {
  let pendingCorrection: ReviewOutput | undefined;

  for (let round = 1; round <= loop.max_rounds; round += 1) {
    let satisfiedThisRound = false;

    for (const inner of loop.steps) {
      if (inner.kind === "agent") {
        let promptOverride: string | undefined;
        if (pendingCorrection) {
          promptOverride = buildLoopCorrectionMessage(pendingCorrection, interpolate(inner.prompt, ctx.interpolation));
        }
        const result = await runAgentStep(ctx, inner, promptOverride);
        if ("status" in result) return result;
        // Once used, a correction only applies to the FIRST agent step that
        // runs after the rejection (e.g. bounded-build-review's
        // `build-retry`, immediately after `review`) — not re-applied to
        // every later step in the same round.
        pendingCorrection = undefined;
      } else {
        const result = await runCodeStep(ctx, inner);
        if ("status" in result) return result;
      }

      if (inner.name === loop.until.step) {
        const envelope = ctx.stepResults[loop.until.step] as Record<string, unknown> | undefined;
        const satisfied = envelope !== undefined && envelope[loop.until.field] === loop.until.equals;
        if (satisfied) {
          satisfiedThisRound = true;
          break; // stop this round's remaining steps — condition met
        }
        // Not satisfied: stash the until-step's envelope as the correction
        // source for whichever agent step runs next (this round or, if
        // until.step is the LAST inner step, the next round's first agent
        // step — same map either way, since pendingCorrection persists
        // across the round boundary until consumed).
        const asReview = envelope as unknown as ReviewOutput | undefined;
        if (asReview && Array.isArray(asReview.blocking) && Array.isArray(asReview.findings)) {
          pendingCorrection = asReview;
        }
      }
    }

    if (satisfiedThisRound) return undefined; // caller continues past the loop
  }

  return {
    status: "loop-exhausted",
    adwId: ctx.adwId,
    sessionId: ctx.sessionId,
    step: loop.name,
    rounds: loop.max_rounds,
    link: ctx.link,
  };
}

/**
 * Runs one Workflow end to end — the generic replacement for
 * `chains/planBuildTest.ts`'s hand-written sequencing (module header
 * comment has the full breakdown). `sessionStart`/`sessionFinish` bracket
 * the whole run at the adwId level, same as planBuildTest.ts.
 *
 * ── M-100 Fix 1: write-path catch-all ─────────────────────────────────────
 * `cli.ts` invokes this once per Workflow Run as a one-shot OS process (the
 * **job runner**, in this codebase's terminology — one job-runner process
 * per Workflow Run, no daemon/worker holds these runs once started). Before
 * this fix, ANY uncaught exception thrown before `runSteps` returns a
 * terminal result (e.g. the `PiWebClientError` 404 that triggered M-100's
 * investigation — a bad `--session-id` makes `setModel`/`sendPrompt` throw
 * before `waitForCompletion` is even reached) propagated all the way up to
 * `cli.ts`'s top-level `main().catch()`, which only logs and exits
 * non-zero — no `phase_end`/`sessionFinish` write anywhere in that chain.
 * Since `tracer.ts` writes status incrementally (`phase_start` sets
 * `phases.status='running'`; only a LATER `phase_end` resolves it), a killed
 * mid-flight run left its `phases`/`sessions` rows stuck at `'running'`
 * forever — exactly the stuck-card symptom M-100 reported.
 *
 * The `try/catch` below wraps this function's entire body from the moment
 * `ctx` (and therefore `ctx.openPhase`, threaded through `runAgentStep`/
 * `runCodeStep` — see `RunContext`'s doc comment) exists. On any uncaught
 * exception it writes a terminal `phase_end` (status `fail`) for whichever
 * Step was open at that moment, calls `tracer.sessionFinish(adwId, false)`
 * for the run, then RE-THROWS — `cli.ts`'s `main().catch()` still needs to
 * see the real error and exit non-zero (this is a write-path completeness
 * fix, not an error-swallowing one).
 *
 * This does NOT cover every way a process can die (SIGKILL, OOM-kill, a
 * container recreate killing the `docker exec` process, host reboot — none
 * of which give JS a chance to run a `catch` block at all). That class of
 * failure is M-100 Fix 2's job: `visualizer/server.ts`'s reconciliation
 * pass, which catches orphaned `running` rows from OUTSIDE the dead
 * process, on a timer, independent of whether any code here ever got to run.
 */
export async function runWorkflow(opts: WorkflowRunOptions): Promise<WorkflowRunResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const adwId = opts.adwId ?? `adw_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const mainCheckoutPath = opts.mainCheckoutPath ?? resolveMainCheckoutPath(opts.cwd);
  const { projectId } = await ensureProjectRegistered(baseUrl, mainCheckoutPath);

  let sessionCwd = opts.cwd;
  if (!opts.sessionId) {
    const worktree = createRunWorktree(mainCheckoutPath, adwId);
    sessionCwd = worktree.path;
  }

  const workspaceId = await resolveWorkspaceId(baseUrl, projectId, sessionCwd);
  const link: WorkflowRunLinkInfo = { projectId, workspaceId, cwd: sessionCwd };

  opts.tracer.sessionStart(adwId, { engineer: opts.engineer, projectCwd: sessionCwd, adwName: opts.workflow.name });
  opts.tracer.sessionRequest(adwId, opts.taskPrompt);
  opts.tracer.sessionSetTitle(adwId, deriveTitleFromPrompt(opts.taskPrompt));

  const ctx: RunContext = {
    tracer: opts.tracer,
    config: opts.config,
    baseUrl,
    adwId,
    // Placeholder until the real session exists below — overwritten before
    // any Step can run (nothing in this window can throw an error whose
    // catch-all handling depends on sessionId being real: openPhase is still
    // undefined here). Typed as a real `string` (not optional) because every
    // later reader of ctx.sessionId legitimately expects one.
    sessionId: opts.sessionId ?? "",
    sessionCwd,
    testCwd: opts.testCwd ?? sessionCwd,
    link,
    interpolation: new Map(),
    stepResults: {},
    seq: 0,
    taskPrompt: opts.taskPrompt,
    taskPromptInjected: false,
    openPhase: undefined,
  };

  try {
    const session = opts.sessionId
      ? { id: opts.sessionId }
      : await startSession(baseUrl, sessionCwd, `${adwId}:${opts.workflow.name}`);
    ctx.sessionId = session.id;

    // Task-prompt seeding for the Workflow's first agent step (top-level or
    // loop-nested) is handled inside runAgentStep itself via
    // ctx.taskPromptInjected — see that function and the field's own doc
    // comment. Every step after it uses its own authored `prompt`.
    const runSteps = async (steps: Step[]): Promise<WorkflowRunResult | undefined> => {
      for (const step of steps) {
        if (step.kind === "agent") {
          const result = await runAgentStep(ctx, step);
          if ("status" in result) return result;
        } else if (step.kind === "code") {
          const result = await runCodeStep(ctx, step);
          if ("status" in result) return result;
        } else {
          const result = await runLoopStep(ctx, step);
          if (result) return result;
        }
      }
      return undefined;
    };

    const terminal = await runSteps(opts.workflow.steps);
    if (terminal) {
      const ok = terminal.status === "success";
      opts.tracer.sessionFinish(adwId, ok);
      return terminal;
    }

    opts.tracer.sessionFinish(adwId, true);
    return { status: "success", adwId, sessionId: ctx.sessionId, link, steps: ctx.stepResults };
  } catch (error) {
    // M-100 Fix 1 — see this function's own doc comment above.
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.openPhase) {
      opts.tracer.event({
        adwId,
        phaseId: ctx.openPhase.phaseId,
        type: "phase_end",
        name: ctx.openPhase.stepName,
        payload: { status: "fail", error: message, outputSummary: message },
      });
    }
    opts.tracer.sessionFinish(adwId, false);
    throw error;
  }
}
