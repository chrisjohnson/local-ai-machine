/**
 * Unit tests for workflow.ts — the generic Workflow interpreter (M-076).
 * Covers what doesn't need a live pi-web server:
 *   - `interpolate`/`recordStepEnvelope`: the {{stepName.field}} mechanism.
 *   - `buildLoopCorrectionMessage`: the chain-level correction builder.
 *   - `runWorkflow` end to end against a MOCKED `fetch` (matching
 *     run.test.ts's established pattern), covering: an agent step, a code
 *     step (pass and gate-failure), and a loop step (early-approval AND
 *     bounded-exhaustion paths) — scripting a "review" agent's response to
 *     be not-approved for N-1 rounds and approved on the last (or never
 *     approved through max_rounds, for exhaustion).
 *
 * Live end-to-end coverage (real model, real session, at least one genuine
 * review REJECTION for bounded-build-review) lives in
 * chains/workflow.integration.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ConfigError } from "./config.ts";
import { Tracer } from "./tracer.ts";
import { loadRolesConfigFromString, type RolesConfig } from "./roles.ts";
import { loadWorkflowsFromString, type Workflow } from "./workflowDef.ts";
import {
  buildLoopCorrectionMessage,
  interpolate,
  recordStepEnvelope,
  runWorkflow,
  WorkflowError,
  type InterpolationContext,
} from "./workflow.ts";
import type { ReviewOutput } from "./envelopes.ts";

const BASE_URL = "http://fake-pi-web.test/api";

// ── interpolate / recordStepEnvelope ────────────────────────────────────

describe("recordStepEnvelope + interpolate", () => {
  test("substitutes a {{stepName.field}} token from a previously-recorded envelope", () => {
    const ctx: InterpolationContext = new Map();
    recordStepEnvelope(ctx, "plan", { summary: "add a health endpoint", status: "success" });
    expect(interpolate("Plan summary: {{plan.summary}}", ctx)).toBe("Plan summary: add a health endpoint");
  });

  test("substitutes multiple distinct tokens in one string", () => {
    const ctx: InterpolationContext = new Map();
    recordStepEnvelope(ctx, "plan", { summary: "plan summary" });
    recordStepEnvelope(ctx, "build", { summary: "build summary" });
    expect(interpolate("{{plan.summary}} then {{build.summary}}", ctx)).toBe("plan summary then build summary");
  });

  test("non-string envelope fields stringify via JSON.stringify, not dropped", () => {
    const ctx: InterpolationContext = new Map();
    recordStepEnvelope(ctx, "review", { blocking: ["fix x", "fix y"], approved: false });
    expect(interpolate("{{review.blocking}}", ctx)).toBe('["fix x","fix y"]');
    expect(interpolate("{{review.approved}}", ctx)).toBe("false");
  });

  test("throws WorkflowError naming the exact unresolved token for an unknown step", () => {
    const ctx: InterpolationContext = new Map();
    expect(() => interpolate("{{nonexistent.field}}", ctx)).toThrow(WorkflowError);
    expect(() => interpolate("{{nonexistent.field}}", ctx)).toThrow(/\{\{nonexistent\.field\}\}/);
  });

  test("throws WorkflowError for a known step but unknown field", () => {
    const ctx: InterpolationContext = new Map();
    recordStepEnvelope(ctx, "plan", { summary: "x" });
    expect(() => interpolate("{{plan.nonexistent}}", ctx)).toThrow(/plan/);
  });

  test("text with no tokens passes through unchanged", () => {
    const ctx: InterpolationContext = new Map();
    expect(interpolate("no tokens here", ctx)).toBe("no tokens here");
  });
});

// ── buildLoopCorrectionMessage ──────────────────────────────────────────

describe("buildLoopCorrectionMessage", () => {
  test("names exactly what was wrong — blocking items and unmet findings, not a generic 'try again'", () => {
    const review: ReviewOutput = {
      status: "success",
      summary: "reviewed",
      artifacts: [],
      notes_for_next_agent: "",
      approved: false,
      findings: [
        { requirement: "endpoint returns 200", met: true, evidence: "confirmed" },
        { requirement: "endpoint validates input", met: false, evidence: "no validation found" },
      ],
      blocking: ["missing input validation"],
    };
    const message = buildLoopCorrectionMessage(review, "Implement the /health endpoint.");
    expect(message).toContain("NOT approved");
    expect(message).toContain("missing input validation");
    expect(message).toContain("endpoint validates input");
    expect(message).toContain("no validation found");
    // Met findings are not listed as problems.
    expect(message).not.toContain("endpoint returns 200");
    expect(message).toContain("Implement the /health endpoint.");
  });

  test("falls back to a placeholder when blocking/findings are both empty (still names the state clearly)", () => {
    const review: ReviewOutput = {
      status: "success",
      summary: "reviewed",
      artifacts: [],
      notes_for_next_agent: "",
      approved: false,
      findings: [],
      blocking: [],
    };
    const message = buildLoopCorrectionMessage(review, "do the task");
    expect(message).toContain("no specific blocking items listed");
    expect(message).toContain("no specific unmet requirements listed");
  });
});

// ── runWorkflow — full mocked end-to-end ────────────────────────────────

function testRolesConfig(): RolesConfig {
  return loadRolesConfigFromString(
    `
defaults:
  model: local-litellm/medium-moe
  thinking: medium
  protected_files: []
roles:
  - name: plan
    kind: agent
    model: local-litellm/medium-moe
    thinking: medium
    system_prompt: ${join(import.meta.dir, "..", "prompts", "plan.md")}
  - name: build
    kind: agent
    model: local-litellm/medium-moe
    thinking: medium
    system_prompt: ${join(import.meta.dir, "..", "prompts", "build.md")}
  - name: review
    kind: agent
    model: local-litellm/medium-moe
    thinking: medium
    writes: []
    system_prompt: ${join(import.meta.dir, "..", "prompts", "review.md")}
  - name: run-tests
    kind: code
    function: run-tests
`,
    "<test-config>",
  );
}

let dir: string;
let cwd: string;
let dbPath: string;
let tracer: Tracer;
let originalFetch: typeof fetch;

function git(args: string[], cwd_: string): void {
  spawnSync("git", args, { cwd: cwd_, encoding: "utf8" });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-web-factory-workflow-test-"));
  cwd = join(dir, "repo");
  spawnSync("mkdir", ["-p", cwd]);
  git(["init", "-q"], cwd);
  git(["config", "user.email", "test@example.com"], cwd);
  git(["config", "user.name", "Test"], cwd);
  git(["commit", "--allow-empty", "-q", "-m", "init"], cwd);

  dbPath = join(dir, "factory.db");
  tracer = new Tracer(dbPath);
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  tracer.close();
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Full mock covering every call `runWorkflow` makes for a fresh (non-resume)
 * run: project registration, worktree workspace resolution, session start,
 * plus run.ts's own model/prompt/status/messages sequence (mirrors
 * run.test.ts's mockFetchSequence, extended for the extra pre-session calls
 * workflow.ts itself makes via piwebProject.ts).
 *
 * `assistantTextsByRole` scripts each agent step's response by ROLE name, in
 * the order that role is called — so a role called multiple times (e.g.
 * "build" across loop rounds, "review" across loop rounds) gets its Nth
 * response on its Nth call.
 */
function mockWorkflowFetch(opts: { assistantTextsByRole: Record<string, string[]>; workspacePath: string }): {
  promptCallsByRole: Record<string, string[]>;
} {
  const promptCallsByRole: Record<string, string[]> = {};
  const roleCallIndex: Record<string, number> = {};
  let lastPromptedSessionRole = ""; // tracks which role's prompt is "in flight" so /messages can answer correctly

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.endsWith("/projects") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/projects") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "proj_1", name: "repo", path: cwd, createdAt: "2026-01-01T00:00:00Z" }), {
        status: 200,
      });
    }
    if (url.includes("/projects/") && url.endsWith("/workspaces")) {
      return new Response(
        JSON.stringify([
          { id: "ws_1", projectId: "proj_1", path: opts.workspacePath, label: "main", isMain: true, isGitRepo: true, isGitWorktree: false },
        ]),
        { status: 200 },
      );
    }
    if (url.endsWith("/sessions") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ id: "sess_1", path: "", cwd: opts.workspacePath, created: "2026-01-01T00:00:00Z", modified: "2026-01-01T00:00:00Z", messageCount: 0, firstMessage: "" }),
        { status: 200 },
      );
    }
    if (url.endsWith("/model") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
        { status: 200 },
      );
    }
    if (url.endsWith("/prompt") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { text: string };
      // Recover which role this prompt belongs to from the roleMarker prefix
      // (`[[pi-web-factory:role=<name>]]`) workflow.ts always prepends.
      const match = /\[\[pi-web-factory:role=([\w-]+)\]\]/.exec(body.text);
      const role = match?.[1] ?? "unknown";
      lastPromptedSessionRole = role;
      promptCallsByRole[role] = promptCallsByRole[role] ?? [];
      promptCallsByRole[role]?.push(body.text);
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    }
    if (url.endsWith("/status")) {
      return new Response(
        JSON.stringify({ isStreaming: false, tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, total: 20 }, cost: 0.001 }),
        { status: 200 },
      );
    }
    if (url.endsWith("/messages")) {
      const role = lastPromptedSessionRole;
      const idx = roleCallIndex[role] ?? 0;
      roleCallIndex[role] = idx + 1;
      const texts = opts.assistantTextsByRole[role] ?? [];
      const text = texts[idx] ?? texts[texts.length - 1] ?? "";
      return new Response(JSON.stringify([{ role: "assistant", content: [{ type: "text", text }] }]), { status: 200 });
    }

    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  return { promptCallsByRole };
}

function agentEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "success", summary: "did it", artifacts: [], notes_for_next_agent: "", ...overrides };
}

function reviewEnvelope(approved: boolean, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "success",
    summary: "reviewed",
    artifacts: [],
    notes_for_next_agent: "",
    approved,
    findings: approved ? [] : [{ requirement: "must validate input", met: false, evidence: "not found" }],
    blocking: approved ? [] : ["missing validation"],
    ...overrides,
  };
}

describe("runWorkflow — plain agent-step sequence (no loop)", () => {
  test("plan -> build -> review, all approved on first pass, succeeds and threads interpolation through", async () => {
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: plan-build-review
    steps:
      - kind: agent
        name: plan
        role: plan
        prompt: "Reply with a single valid JSON object matching the required schema."
      - kind: agent
        name: build
        role: build
        prompt: "Plan said: {{plan.summary}}. Reply with JSON."
      - kind: agent
        name: review
        role: review
        prompt: "Build said: {{build.summary}}. Reply with JSON."
`)[0] as Workflow;

    mockWorkflowFetch({
      assistantTextsByRole: {
        plan: [JSON.stringify(agentEnvelope({ summary: "plan: add health endpoint" }))],
        build: [JSON.stringify(agentEnvelope({ summary: "build: implemented it" }))],
        review: [JSON.stringify(reviewEnvelope(true, { summary: "review: looks good" }))],
      },
      workspacePath: cwd,
    });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow,
      cwd,
      taskPrompt: "add a /health endpoint",
      baseUrl: BASE_URL,
      adwId: "adw_wf_test1",
      sessionId: "sess_preexisting", // resume path: skip worktree creation, cwd used directly
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.steps["plan"]).toMatchObject({ summary: "plan: add health endpoint" });
    expect(result.steps["build"]).toMatchObject({ summary: "build: implemented it" });
    expect(result.steps["review"]).toMatchObject({ approved: true });

    // Interpolation actually threaded plan's summary into build's prompt, and
    // build's summary into review's prompt — confirms the {{...}} mechanism
    // ran for real end to end, not just in the isolated unit tests above.
    const phaseRow = tracer.db
      .query<{ status: string }, [string]>("select status from phases where phase_id=?")
      .get("adw_wf_test1_build");
    expect(phaseRow?.status).toBe("success");
  });

  test("a blocked-on-human agent step stops the whole workflow with a distinct outcome naming that step", async () => {
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: single
    steps:
      - kind: agent
        name: plan
        role: plan
        prompt: "Reply with JSON."
`)[0] as Workflow;

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/projects") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith("/projects") && init?.method === "POST")
        return new Response(JSON.stringify({ id: "proj_1", name: "repo", path: cwd, createdAt: "x" }), { status: 200 });
      if (url.includes("/workspaces")) return new Response(JSON.stringify([{ id: "ws_1", path: cwd, isMain: true }]), { status: 200 });
      if (url.endsWith("/model")) return new Response("{}", { status: 200 });
      if (url.endsWith("/prompt")) return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      if (url.endsWith("/status")) {
        return new Response(
          JSON.stringify({ isStreaming: false, pendingAsk: { askId: "ask_1", askedAt: "x", questions: [{ id: "q1", question: "which approach?", options: [] }] } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow,
      cwd,
      taskPrompt: "do something ambiguous",
      baseUrl: BASE_URL,
      adwId: "adw_wf_blocked",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("blocked-on-human");
    if (result.status !== "blocked-on-human") throw new Error(JSON.stringify(result));
    expect(result.step).toBe("plan");
  });
});

describe("runWorkflow — code step", () => {
  test("a passing code step traces gate_pass and lets the workflow succeed", async () => {
    writeFileSync(join(cwd, ".pi-web-factory.yaml"), "test: 'true'\n"); // shell 'true' always exits 0
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: code-only
    steps:
      - kind: code
        name: test
        role: run-tests
`)[0] as Workflow;

    // A code-step-only Workflow never calls run.ts's own network path, but
    // runWorkflow ALWAYS registers the pi-web Project / resolves a workspace
    // id first (same as planBuildTest.ts, unconditionally) — mock those
    // calls too, not just the ones code steps themselves need.
    mockWorkflowFetch({ assistantTextsByRole: {}, workspacePath: cwd });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow,
      cwd,
      taskPrompt: "run tests",
      baseUrl: BASE_URL,
      adwId: "adw_wf_code_pass",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("success");

    const gateRow = tracer.db
      .query<{ passed: number }, [string]>("select passed from gate_results where adw_id=? and gate='run-tests'")
      .get("adw_wf_code_pass");
    expect(gateRow?.passed).toBe(1);
  });

  test("a failing code step stops the workflow with a distinct 'gate-failed' outcome, not silently continuing", async () => {
    writeFileSync(join(cwd, ".pi-web-factory.yaml"), "test: 'false'\n"); // shell 'false' always exits 1
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: code-only
    steps:
      - kind: code
        name: test
        role: run-tests
`)[0] as Workflow;

    mockWorkflowFetch({ assistantTextsByRole: {}, workspacePath: cwd });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow,
      cwd,
      taskPrompt: "run tests",
      baseUrl: BASE_URL,
      adwId: "adw_wf_code_fail",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("gate-failed");
    if (result.status !== "gate-failed") throw new Error(JSON.stringify(result));
    expect(result.step).toBe("test");
    expect(result.report.checks.some((c) => !c.ok)).toBe(true);

    const phaseRow = tracer.db
      .query<{ status: string; output_summary: string | null }, [string]>(
        "select status, output_summary from phases where phase_id=?",
      )
      .get("adw_wf_code_fail_test");
    expect(phaseRow?.status).toBe("fail");
    expect(phaseRow?.output_summary).toBeTruthy();

    const gateRow = tracer.db
      .query<{ passed: number }, [string]>("select passed from gate_results where adw_id=? and gate='run-tests'")
      .get("adw_wf_code_fail");
    expect(gateRow?.passed).toBe(0);
  });
});

describe("runWorkflow — loop step", () => {
  const boundedWorkflow = (): Workflow =>
    loadWorkflowsFromString(`
workflows:
  - name: bounded
    steps:
      - kind: agent
        name: build
        role: build
        prompt: "Implement the task. Reply with JSON."
      - kind: loop
        name: build-review-loop
        max_rounds: 3
        until: {step: review, field: approved, equals: true}
        steps:
          - kind: agent
            name: review
            role: review
            prompt: "Review the build. Build said: {{build.summary}}. Reply with JSON."
          - kind: agent
            name: build-retry
            role: build
            prompt: "Fix it up. Reply with JSON."
`)[0] as Workflow;

  test("early approval: loop stops as soon as 'until' is satisfied, WITHOUT running the round's remaining steps", async () => {
    const { promptCallsByRole } = mockWorkflowFetch({
      assistantTextsByRole: {
        build: [JSON.stringify(agentEnvelope({ summary: "build v1" }))],
        // approved on round 1 -> build-retry must NEVER be called this round.
        review: [JSON.stringify(reviewEnvelope(true))],
      },
      workspacePath: cwd,
    });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow: boundedWorkflow(),
      cwd,
      taskPrompt: "implement the feature",
      baseUrl: BASE_URL,
      adwId: "adw_wf_loop_early",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.steps["review"]).toMatchObject({ approved: true });
    // build-retry never ran at all — no phase row for it.
    expect(result.steps["build-retry"]).toBeUndefined();
    expect(promptCallsByRole["build"]?.length).toBe(1); // only the outer "build" step's one call
  });

  test("rejected then approved: build-retry gets called with a correction folded in, then review approves on round 2", async () => {
    const { promptCallsByRole } = mockWorkflowFetch({
      assistantTextsByRole: {
        build: [JSON.stringify(agentEnvelope({ summary: "build v1" }))],
        review: [JSON.stringify(reviewEnvelope(false)), JSON.stringify(reviewEnvelope(true, { summary: "now approved" }))],
      },
      workspacePath: cwd,
    });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow: boundedWorkflow(),
      cwd,
      taskPrompt: "implement the feature",
      baseUrl: BASE_URL,
      adwId: "adw_wf_loop_retry",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.steps["review"]).toMatchObject({ approved: true, summary: "now approved" });

    // build-retry (the loop's OWN "build" role step) got exactly one call,
    // and its prompt carries the correction naming what was wrong.
    const buildCalls = promptCallsByRole["build"] ?? [];
    expect(buildCalls.length).toBe(2); // outer build (round-0) + build-retry (round 1's correction)
    expect(buildCalls[1]).toContain("NOT approved");
    expect(buildCalls[1]).toContain("missing validation");
  });

  test("bounded exhaustion: never approved through max_rounds stops with a distinct 'loop-exhausted' outcome, not folded into success or a generic failure", async () => {
    mockWorkflowFetch({
      assistantTextsByRole: {
        build: [JSON.stringify(agentEnvelope({ summary: "build v1" }))],
        review: [
          JSON.stringify(reviewEnvelope(false)),
          JSON.stringify(reviewEnvelope(false)),
          JSON.stringify(reviewEnvelope(false)),
        ],
      },
      workspacePath: cwd,
    });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow: boundedWorkflow(),
      cwd,
      taskPrompt: "implement the feature",
      baseUrl: BASE_URL,
      adwId: "adw_wf_loop_exhausted",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("loop-exhausted");
    if (result.status !== "loop-exhausted") throw new Error(JSON.stringify(result));
    expect(result.step).toBe("build-review-loop");
    expect(result.rounds).toBe(3);

    // The Workflow Run itself is traced as a failure, not a success.
    const sessionRow = tracer.db
      .query<{ status: string }, [string]>("select status from sessions where adw_id=?")
      .get("adw_wf_loop_exhausted");
    expect(sessionRow?.status).toBe("fail");
  });

  test("an inner step's own terminal outcome (e.g. blocked-on-human) stops the loop immediately, not folded into loop-exhausted", async () => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/projects") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith("/projects") && init?.method === "POST")
        return new Response(JSON.stringify({ id: "proj_1", name: "repo", path: cwd, createdAt: "x" }), { status: 200 });
      if (url.includes("/workspaces")) return new Response(JSON.stringify([{ id: "ws_1", path: cwd, isMain: true }]), { status: 200 });
      if (url.endsWith("/model")) return new Response("{}", { status: 200 });
      if (url.endsWith("/prompt")) return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      if (url.endsWith("/status")) {
        const match = /\[\[pi-web-factory:role=([\w-]+)\]\]/;
        void match;
        return new Response(
          JSON.stringify({ isStreaming: false, pendingAsk: { askId: "ask_1", askedAt: "x", questions: [{ id: "q1", question: "which fix?", options: [] }] } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow: boundedWorkflow(),
      cwd,
      taskPrompt: "implement the feature",
      baseUrl: BASE_URL,
      adwId: "adw_wf_loop_blocked",
      sessionId: "sess_preexisting",
    });

    // The FIRST step in this workflow is the outer "build" step, which will
    // itself hit the scripted blocked-on-human status before the loop is
    // ever entered — confirms an inner-step-shaped terminal outcome (the
    // same discriminated result the loop's own inner steps would produce)
    // propagates immediately rather than being swallowed by the loop's
    // round-counting.
    expect(result.status).toBe("blocked-on-human");
    if (result.status !== "blocked-on-human") throw new Error(JSON.stringify(result));
    expect(result.step).toBe("build");
  });

  test("regression: a Workflow whose FIRST step is a loop still injects taskPrompt into that loop's first inner agent step (neither shipped workflow exercises this — the interpreter must still be correct for one that would)", async () => {
    const loopFirstWorkflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: loop-first
    steps:
      - kind: loop
        name: build-review-loop
        max_rounds: 2
        until: {step: review, field: approved, equals: true}
        steps:
          - kind: agent
            name: build
            role: build
            prompt: "Implement it. Reply with JSON."
          - kind: agent
            name: review
            role: review
            prompt: "Review. Reply with JSON."
`)[0] as Workflow;

    const { promptCallsByRole } = mockWorkflowFetch({
      assistantTextsByRole: {
        build: [JSON.stringify(agentEnvelope({ summary: "build v1" }))],
        review: [JSON.stringify(reviewEnvelope(true))],
      },
      workspacePath: cwd,
    });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow: loopFirstWorkflow,
      cwd,
      taskPrompt: "THE-ORIGINAL-TASK-PROMPT-MARKER",
      baseUrl: BASE_URL,
      adwId: "adw_wf_loop_first",
      sessionId: "sess_preexisting",
    });

    expect(result.status).toBe("success");
    // The loop's first inner step ("build") is also the Workflow's first
    // agent step overall — its prompt must carry the original task prompt,
    // not just its own step-authored text (this is exactly what broke before
    // ctx.taskPromptInjected moved the check inside runAgentStep itself).
    const buildCalls = promptCallsByRole["build"] ?? [];
    expect(buildCalls.length).toBe(1);
    expect(buildCalls[0]).toContain("THE-ORIGINAL-TASK-PROMPT-MARKER");
  });
});

describe("runWorkflow — unknown role/config errors surface clearly", () => {
  test("an agent step naming a role with no matching envelope schema throws a clear WorkflowError at run time", async () => {
    const config = loadRolesConfigFromString(
      `
defaults: {model: local-litellm/medium-moe, thinking: medium, protected_files: []}
roles:
  - name: mystery
    kind: agent
    system_prompt: ${join(import.meta.dir, "..", "prompts", "build.md")}
`,
      "<test>",
    );
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: bad-role
    steps:
      - kind: agent
        name: step1
        role: mystery
        prompt: "do it"
`)[0] as Workflow;

    mockWorkflowFetch({ assistantTextsByRole: {}, workspacePath: cwd });

    await expect(
      runWorkflow({
        tracer,
        config,
        workflow,
        cwd,
        taskPrompt: "x",
        baseUrl: BASE_URL,
        adwId: "adw_wf_badrole",
        sessionId: "sess_preexisting",
      }),
    ).rejects.toThrow(WorkflowError);
  });

  test("a code step naming an unknown role throws a ConfigError (roles.ts's own lookup, not swallowed)", async () => {
    const config = testRolesConfig();
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: bad-code-role
    steps:
      - kind: code
        name: step1
        role: nonexistent-code-role
`)[0] as Workflow;

    mockWorkflowFetch({ assistantTextsByRole: {}, workspacePath: cwd });

    await expect(
      runWorkflow({
        tracer,
        config,
        workflow,
        cwd,
        taskPrompt: "x",
        baseUrl: BASE_URL,
        adwId: "adw_wf_badcoderole",
        sessionId: "sess_preexisting",
      }),
    ).rejects.toThrow(ConfigError);
  });
});

describe("runWorkflow — worktree-per-run (M-071 pattern, generalized)", () => {
  test("a fresh run (no sessionId) creates a real worktree and uses it as the session cwd", async () => {
    const workflow: Workflow = loadWorkflowsFromString(`
workflows:
  - name: single
    steps:
      - kind: agent
        name: plan
        role: plan
        prompt: "Reply with JSON."
`)[0] as Workflow;

    const worktreePath = join(cwd, ".pi-web-factory-worktrees", "adw_wf_fresh");
    mockWorkflowFetch({
      assistantTextsByRole: { plan: [JSON.stringify(agentEnvelope())] },
      workspacePath: worktreePath,
    });

    const result = await runWorkflow({
      tracer,
      config: testRolesConfig(),
      workflow,
      cwd, // main checkout, NOT a worktree — no sessionId means a fresh worktree gets created
      taskPrompt: "add a thing",
      baseUrl: BASE_URL,
      adwId: "adw_wf_fresh",
      mainCheckoutPath: cwd,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.link.cwd).toBe(worktreePath);
    expect(existsSync(worktreePath)).toBe(true);
  });
});
