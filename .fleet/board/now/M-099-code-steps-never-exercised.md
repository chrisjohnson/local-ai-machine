---
id: M-099
title: "code" Steps exist end-to-end but have never actually run
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-06T00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-076]
---

# M-099 — "code" Steps exist end-to-end but have never actually run

## Context
Chris's direct feedback, 2026-08-06 (verbatim): "I'm also noticing that I
don't see automated tests anywhere. I'm not sure if we lost those tests or
if they're just not showing up on the visualizer, but one of my original
requirements was that the visualizer also be able to track 'code' steps
(that aren't active LLM sessions, but rather, time that the factory code
itself spends validating things, retrying things, running tests, maybe
directly managing git, etc)."

**Investigated before filing — this is NOT a lost feature or a visualizer
bug.** The `kind: code` Step is fully built and already reachable today:

- `modules/roles.ts` defines a real `kind: "code"` Code Role, `run-tests`,
  wired to `testsPass()`.
- `modules/workflow.ts`'s generic interpreter has a complete `runCodeStep()`
  dispatched via `step.kind === "code"`.
- `chains/planBuildTest.ts` — a real, working, hand-written chain (predates
  the generic YAML interpreter, kept deliberately per M-076's own decision
  log: "a genuinely different shape worth having available, not just a
  legacy leftover") — ends in a real `kind: "code"` Step that runs the
  target project's actual test command and emits a real trace event
  (`payload: { kind: "code", owner: "gates.testsPass", ... }`).
- It's registered in `chains/registry.ts` as Workflow name
  `plan-build-test`, and it has its own documented, user-facing entry point:
  `skills/plan-build-test/SKILL.md`, invokable directly as
  `/skill:plan-build-test <task>`. `skills/pi-web-factory/SKILL.md`'s own
  routing table describes it plainly: "The user wants a mechanical,
  code-based acceptance check instead of a judgment call... 'make sure the
  tests pass', 'TDD this'."

So the actual gap isn't missing capability, it's that **it has never been
exercised**, for two compounding reasons:
1. Both the general-purpose skill's routing table and its own default
   ("Default choice for most requests" in `skills/pi-web-factory/SKILL.md`)
   point at `plan-build-review`, not `plan-build-test`, unless the user's
   phrasing specifically calls for a mechanical test gate. Every real
   Workflow Run sampled from the live visualizer API to date used
   `plan-build-review` or `bounded-build-review` — zero used
   `plan-build-test`.
2. `plan-build-test` requires the target project to have a
   `.pi-web-factory.yaml` declaring a `test` command
   (`modules/config.ts:112`, `test: z.string().optional()`). Checked the box
   directly (`find / -iname '.pi-web-factory.yaml'`, 2026-08-06): **zero
   real projects on `local-ai-machine` currently have one.** Even a past
   `/skill:plan-build-test` invocation against any real target project so
   far would have hit the skill's own documented guard ("if it doesn't, say
   so rather than guessing a command") and refused to run, not silently
   skipped tracking anything.

In short: nothing was lost, nothing is broken, the visualizer has nothing to
render because no code Step has ever actually fired in a real run.

## Plan
**Decided, 2026-08-07 (Chris, direct):**
- Keep using scratch repos for testing — not ready to point pi-web-factory
  at a real durable project yet. This resolves Option 1's "zero real
  candidate projects" blocker: it's not a blocker, scratch repos are the
  intended test substrate for now, so Option 1's remaining friction (a
  worktree-safe `test:` command) can be validated with a scratch repo built
  for exactly that (e.g. a tiny throwaway repo with a trivial, self-
  contained test command — no real installs needed).
- Prefer explicit **workflow variants** over Option 2's conditional-step
  interpreter change: "Having a with and without test variant seems ok" —
  i.e. ship a `plan-build-review-with-tests` (or similarly named) Workflow
  YAML alongside the existing `plan-build-review`, rather than teaching the
  interpreter/schema a new conditional-step concept. Explicitly: "feel free
  to create workflow variants as needed and we'll settle that better over
  time" — this is a standing license to add more Workflow shapes going
  forward rather than trying to keep exactly two/three forever, and directly
  motivated filing [[M-104]] (a routing skill that picks the right variant
  given a prompt, since a human/hand-maintained routing table won't scale
  as variants multiply).

**Now concretely actionable, in order:**
1. Add a new Workflow YAML, `plan-build-review-with-tests` (or better name
   if one falls out during implementation): `plan -> build -> code(run-tests)
   -> review`, or `plan -> build -> code(run-tests)` if Chris would rather
   the mechanical test gate replace the agent review rather than precede it
   — implementer's call, document the reasoning either way. Register it in
   `chains/registry.ts` alongside the existing three.
2. Build a scratch repo fixture specifically for exercising this (a tiny
   throwaway git repo with a trivial, near-instant, dependency-free test
   command — e.g. a one-line shell script asserting a file's contents —
   living wherever this codebase's other test fixtures/scratch repos live)
   so the `test:` command has zero worktree-safety friction to prove the
   `kind: "code"` Step machinery end-to-end.
3. Run it for real via the new Workflow, confirm a real `kind: "code"` Step
   shows up correctly in the visualizer (this is the actual, original ask —
   verify visually, not just via the trace DB).
4. Fix the latent gap flagged in the 2026-08-06 decision-log entry while
   here: `runCodeStep`'s `project.test ?? ""` silently no-ops instead of
   erroring when `test:` is omitted — add the same explicit `if (!testCmd)`
   guard `planBuildTest.ts` already has.

Original options below, kept for context/history — (1) and (2) as originally
scoped are effectively superseded by the decisions above; (3)/(4) still
stand as-is (leave-as-is was not chosen; the visualizer-passive-indicator
idea (4) is still a reasonable independent addition, not in conflict with
the above, just not prioritized).


1. **Start giving real target projects a `.pi-web-factory.yaml` test
   command, then invoke `/skill:plan-build-test` for real.**
   - **There are currently zero "real" candidate projects, not just zero
     configs.** Re-checked live: every one of the 35 sampled Workflow Runs
     (`curl http://192.168.1.226:8090/api/runs`) has a `projectRoot` under
     `/tmp/...` — synthetic scratch repos for prior M-0xx smoke tests
     (`/tmp/pi-web-factory-*`, `/tmp/m095-*`) or throwaway demo repos
     (`/tmp/user-auth-service`, `/tmp/product-catalog-service`,
     `/tmp/api-gateway`) that no longer exist on disk (already swept from
     `/tmp` by the time this research ran). Zero runs targeted a durable,
     non-`/tmp` project. So "Option 1" isn't "write a YAML file into an
     existing target" — it first requires Chris to designate/create an
     actual persistent project for pi-web-factory to drive, or deliberately
     reuse one of the smoke-test scratch repos (cheapest, but proves
     nothing about a real codebase's test suite).
   - **The config format itself is trivial and confirmed exact**
     (`modules/config.ts`): a `<project-root>/.pi-web-factory.yaml` with
     `test:`/`typecheck:`/`lint:` all optional strings
     (`ProjectConfigFileSchema`). Missing file -> hard `ConfigError` naming
     the expected path (never silently skips). File present but `test:`
     key omitted -> **not an error** — see the interpreter gap noted in
     item 4 below, this is a real sharp edge for whoever writes the first
     one.
   - **Runnability constraint confirmed:** the `test` command is shelled
     out via `Bun.spawn(["sh", "-c", cmd], { cwd })` (`gates.ts:testsPass`)
     against the run's own ephemeral git worktree
     (`<project>/.pi-web-factory-worktrees/<adwId>/`, M-071), which is
     created fresh per run and never cleaned up automatically. So the `test:`
     command must (a) be runnable with zero interactive setup from a bare
     `git worktree add` checkout — no assumption that `node_modules`/venvs/
     build artifacts from the main checkout carry over, since a worktree
     shares git history but not untracked/gitignored install state, and
     (b) tolerate running concurrently across multiple worktrees of the
     same repo (parallel runs are possible; nothing serializes them). For a
     real project with a real test suite, that likely means the `test:`
     command itself needs to include (or the project needs to guarantee) a
     dependency-install step, or Chris needs to pre-provision installs in a
     way that's shared/symlinked across worktrees — this wasn't previously
     called out and is the main hidden cost of Option 1 beyond just writing
     one YAML line. `planBuildTest.ts`'s own `testCwd` escape hatch (see its
     doc comment) exists precisely for the case where the "test" is actually
     a remote/self-contained check (e.g. `ssh ... docker exec ... test -f
     ...`) rather than a real in-worktree test run — that's exactly the
     pattern `chains/planBuildTest.integration.test.ts` uses for ITS OWN
     "test command" (a file-existence check via ssh+docker exec, not a real
     test framework) — worth knowing that even the existing test coverage
     doesn't exercise a real `npm test`/`pytest`/etc invocation end to end.
   - Bottom line: cheap in isolation (one YAML file, `test: "npm test"` or
     similar), but "cheap" assumes a real target project already exists in
     a durable location with tests that are worktree-safe — neither is true
     today. First real use will surface whichever of those frictions bites.

2. **Give `plan-build-review` an optional trailing test gate when the
   project has a configured `test` command.**
   - **Confirmed: not expressible as a YAML-only change today.** Read
     `modules/workflowDef.ts`'s full Zod schema — `AgentStepSchema`,
     `CodeStepSchema`, `LoopStepSchema` are the only three shapes, combined
     via `z.discriminatedUnion("kind", ...)`. There is no `when`/`if`/
     `optional`/condition field anywhere in the schema, and `loop`'s only
     conditional primitive is `until` (repeat-until-approved), not
     "skip-if-absent". `bounded-build-review.yaml`'s loop shows what
     conditional logic already exists — round-count bounding and
     approval-gating — neither is the right shape for "include this step
     only if project config X is present"; that's a load-time/config-
     presence condition, not a runtime envelope-field condition, and the
     interpreter has no concept of the former at all.
   - **Bigger structural wrinkle beyond the schema:** `plan-build-review`
     and `plan-build-test` aren't just two YAML files sharing one engine —
     confirmed via `chains/registry.ts`'s own doc comment and code.
     `plan-build-review`/`bounded-build-review` run through the generic
     YAML interpreter (`modules/workflow.ts`'s `runWorkflow`); `plan-build-
     test` is `chains/planBuildTest.ts`, a separate hand-written TS chain
     that predates the interpreter and was deliberately kept independent
     (M-076 decision log). So "add a trailing code step to plan-build-
     review when configured" isn't a small YAML tweak even setting the
     schema gap aside — the code step's behavior (skip vs. run) would need
     to be decided in `modules/workflow.ts`'s interpreter (new schema field
     + new branch in `runWorkflow`'s step loop to conditionally skip a step
     based on `projectConfigFor(cwd)` at run time, since Workflow YAML is
     loaded once at module-init and can't itself know per-run project
     state) — a real interpreter change, not a content change.
   - **Concrete estimate:** touches `modules/workflowDef.ts` (add an
     `optional_if_configured`-style field to `CodeStepSchema`, or a new
     Step kind entirely, plus schema tests in `workflowDef.test.ts`),
     `modules/workflow.ts` (teach `runWorkflow`'s step loop to check
     project config before running/skipping a step it previously always
     ran, plus new test cases in `workflow.test.ts` mirroring the existing
     "code step" describe block for skip-when-unconfigured), and
     `workflows/plan-build-review.yaml` (add the trailing step + explanatory
     comment matching this file's existing documentation density). Rough
     order of magnitude: a half-day-to-a-day of focused work for someone
     already fluent in this codebase, mostly in test-writing given the
     project's testing discipline (every existing interpreter branch has
     matching unit tests) — not a trivial YAML edit, but not a rewrite
     either. The team consciously avoided building a "workflow DSL"
     (`workflowDef.ts`'s own doc comment: "two known shapes, not a workflow
     DSL") — adding conditional steps is a small step toward exactly the
     generality that comment says was deliberately avoided, worth flagging
     to Chris as a design-philosophy tradeoff, not just an implementation
     cost.

3. Leave the three-Workflow design as-is (deliberate per M-076) and just
   make sure Chris/future users know `/skill:plan-build-test` exists and
   when to reach for it.

4. **New option surfaced by this research: visualizer-side "no test gate"
   indicator, independent of which Workflow shape is used.** Checked
   `visualizer/src/detailView.ts:227` — the visualizer already renders
   whatever `step.kind` string comes through generically
   (`<dd>${escapeHtml(step.kind ?? "—")}</dd>`), so a real `kind: "code"`
   Step, once one ever fires, should render with zero visualizer changes
   needed (this hasn't been proven with real trace data yet — see Option 1
   — but the display path is generic, not hardcoded to agent-only kinds).
   There's currently no distinct "this run had no test gate configured"
   empty-state — a Workflow Run summary just doesn't show a `code` phase
   at all when none ran, which reads as "not applicable" rather than "a
   gate was skipped." A cheap middle ground between "always test" and
   "never test" (lighter than Option 2's interpreter change): keep
   `plan-build-review` exactly as-is, but have the visualizer surface,
   per Workflow Run, whether the target project HAS a `.pi-web-factory.yaml`
   `test:` command configured and wasn't run — i.e. a passive visibility
   feature rather than a routing/execution change. Not scoped/estimated in
   detail here since it's newly surfaced, but flagging because it sidesteps
   both Option 2's schema/interpreter cost and Option 1's "no real project
   uses this yet" problem — it's informational, not behavioral.

Recommend (1) as a cheap-in-isolation first step regardless of (2)/(3)/(4),
since it's the only way to actually verify the visualizer's `kind: "code"`
rendering works at all with real data — but per the research above, "cheap"
now has a concrete prerequisite (a durable real target project, not a
`/tmp` scratch repo) that didn't exist when this was first written.

## Signals

## Decision log
- 2026-08-06 (claude): filed after investigating Chris's report — traced
  through `roles.ts`/`workflow.ts`/`planBuildTest.ts`/`registry.ts`/
  `skills/*/SKILL.md`, confirmed the capability is fully built, documented,
  and user-invocable, and confirmed via a live box check that zero target
  projects currently have a `.pi-web-factory.yaml` test command — so the
  feature has simply never fired, not regressed or gone missing. Left the
  Plan as options rather than picking one, since this is a routing/default-
  behavior decision worth surfacing to Chris rather than assuming.
- 2026-08-06 (claude), deeper research pass at Chris's request: made all
  three options concrete rather than one-line sketches, and surfaced a
  fourth. Key new findings: (a) Option 1's real blocker isn't the missing
  YAML — it's that literally zero real (non-`/tmp`-scratch) target projects
  exist for pi-web-factory to drive at all today (re-sampled the live
  `/api/runs` endpoint, all 35 runs' `projectRoot`s are `/tmp/...`); also
  found the target's test command must be worktree-safe (runs in an
  ephemeral `git worktree`, no carried-over `node_modules`/installs), which
  the existing integration test sidesteps entirely by using a file-
  existence ssh/docker-exec check instead of a real test framework
  invocation — so even the "known-good" coverage hasn't proven a real
  `npm test`-shaped command works. (b) Option 2 is confirmed NOT a YAML-
  only change: `workflowDef.ts`'s Zod schema has no conditional/optional
  step concept at all (only `agent`/`code`/`loop`, no `when`/`if`), AND
  `plan-build-review` (generic YAML interpreter) and `plan-build-test`
  (hand-written `chains/planBuildTest.ts`) are structurally separate code
  paths per `chains/registry.ts`'s own doc comment — a real interpreter
  change in `modules/workflow.ts` plus schema/test additions, rough
  half-day-to-a-day estimate, and a deliberate step away from the "not a
  workflow DSL" restraint `workflowDef.ts` documents. (c) New Option 4:
  the visualizer already renders `step.kind` generically
  (`visualizer/src/detailView.ts:227`), so it needs no changes to display a
  real `kind: "code"` step once one fires — but there's no existing
  "no test gate configured" empty-state; a passive visibility feature here
  (show whether a project HAS a test command configured, independent of
  execution) is a cheaper middle ground than Option 2's interpreter change.
  (d) Also found and flagged a real (independent of this decision) latent
  gap: `modules/workflow.ts`'s `runCodeStep` computes `project.test ?? ""`
  and passes that straight to `testsPass`, so a `.pi-web-factory.yaml` that
  exists but omits `test:` silently runs `sh -c ""` (exit 0, always
  "passes") rather than erroring — unlike `planBuildTest.ts`'s own hand-
  written chain, which explicitly checks `if (!testCmd)` and fails with a
  named reason. Neither of `workflow.test.ts`'s two existing code-step
  tests cover this specific case (both write an explicit `test:` key).
  Worth a follow-up card if/when Option 1 or 2 moves forward, not filed
  separately yet since it's not yet live-impacting (nothing has hit this
  path in production).

## Handoff notes
No code changes needed to resolve the "did we lose this" question — that
part's answered. Whatever's decided next is a product/default-behavior call,
not a bug fix.
