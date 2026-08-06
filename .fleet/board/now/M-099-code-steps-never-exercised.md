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
<!-- open design question for Chris, not autonomously decided -->
Options, not yet chosen:
1. Start giving real target projects a `.pi-web-factory.yaml` test command
   and actually invoke `/skill:plan-build-test` (or the general-purpose
   skill with test-gate phrasing) on some real tasks — the fastest path to
   seeing a real `kind: "code"` Step and confirming the visualizer renders
   it correctly (untested in practice either way — worth a real smoke run
   regardless of which option below is also chosen).
2. Reconsider the routing default — e.g. `plan-build-review` should perhaps
   include an optional trailing test gate when the project has a configured
   `test` command, rather than requiring the user to explicitly ask for the
   separate `plan-build-test` shape.
3. Leave the three-Workflow design as-is (deliberate per M-076) and just
   make sure Chris/future users know `/skill:plan-build-test` exists and
   when to reach for it.
Recommend (1) as a cheap first step regardless of (2)/(3), since it's the
only way to actually verify the visualizer's `kind: "code"` rendering works
at all — it's never been exercised with real data, so this is unverified
even though the code path exists.

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

## Handoff notes
No code changes needed to resolve the "did we lose this" question — that
part's answered. Whatever's decided next is a product/default-behavior call,
not a bug fix.
