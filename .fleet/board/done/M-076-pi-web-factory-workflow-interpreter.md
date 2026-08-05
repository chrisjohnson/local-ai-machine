---
id: M-076
title: pi-web-factory — generic Workflow interpreter (YAML step sequences + bounded loop)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T22:29:36Z
blocks: null
blocked_by: [M-074, M-075]
status: null
related_cards: [M-066, M-073, M-072, M-074, M-075]
---

# M-076 — pi-web-factory — generic Workflow interpreter (YAML step sequences + bounded loop)

## Context
`pi-web-adw-design.md` §7.1 (Workflow definition), §7.2 (Workflows YAML), §7.5
(supersedes M-073, withdrawn before work started — see that card's decision log).
Replaces "one hand-written TS file per chain shape" (M-066's approach, `done`, stays
as historical first implementation — not rewritten) with: Workflows are YAML data,
one generic interpreter executes any of them against the M-075 Roles registry.

Two Workflow shapes ship with this card (§7.1's original ask, restated with the new
vocabulary): a simple `plan → build → review` (no loop), and a fuller one with a
bounded build↔review correction loop (max 3 rounds — mirrors upstream SSSF's
`adw_build_review`, and M-066's *existing* single-phase retry-on-parse-failure loop in
`run.ts` is a different, already-built mechanism — don't confuse or duplicate it; this
loop operates at the Step-sequence level, not inside one Step).

## Plan
1. [x] Define the Workflow YAML shape: `name`, ordered `steps:` list, each
   `{name, kind: agent|code, role: <role-name>, ...}`. A native `loop` step kind:
   `{kind: loop, steps: [...], until: <condition-expression-or-field-check>,
   max_rounds: 3}` — keep the condition check narrow and concrete (e.g. "loop while
   the review step's `approved` field is false"), not a general expression language.
2. [x] The interpreter itself: reads a Workflow definition, walks its steps in order,
   for each `agent` step calls `run.ts`'s `runAgentPhase` (already built, M-066) with
   the resolved Role's config; for each `code` step calls the resolved code Role's
   function (M-075's registry); for a `loop` step, repeats its inner steps up to
   `max_rounds`, checking the `until` condition after each round, and reports a real,
   distinct Workflow Run outcome if the cap is hit without satisfying it (not silently
   treated as success — same discipline `run.ts`'s own bounded retry loop already
   established for parse failures).
3. [x] Session continuation across steps (already established by M-066's
   `planBuildTest.ts`, port the pattern into the generic interpreter rather than
   reinventing it): one session per Workflow Run by default, threaded through every
   step.
4. [x] Populate `phases.output_summary`/token columns (M-074) from each step's actual
   result — the interpreter is the natural place for this now that it's the single
   caller of every step kind, superseding the ad hoc version M-074 asked to be added
   directly into `planBuildTest.ts`.
5. [x] Ship the two Workflow YAML definitions themselves (plan-build-review,
   bounded-build-review) alongside the Roles config from M-075.
6. [x] `chains/registry.ts` (M-067) or its successor: register Workflows by name for
   `cli.ts`'s `--chain`/`--workflow` flag (rename the flag too, per the new
   vocabulary — `--workflow` reads better now than `--chain`; update `cli.ts`'s own
   help text and `WorkItem` shape references in the design doc if the flag name
   changes).
7. [x] Tests: unit tests for the loop step's bounded-exhaustion and early-success
   paths (mocked, matching `run.test.ts`'s established pattern), plus at least one
   live end-to-end test per shipped Workflow shape (matching the established
   `*.integration.test.ts` pattern).
8. [x] Decide `chains/planBuildTest.ts`'s fate: leave it as a working, hand-written
   example alongside the new interpreter (harmless, already tested), or retire it now
   that a YAML Workflow can express the same shape — implementer's call, document
   whichever way it goes.
   - **Decision: kept.** Registered in `chains/registry.ts` as `"plan-build-test"`,
     a third Workflow option alongside the two YAML ones. It ends in a code step
     (tests) rather than an agent review, a genuinely different shape worth having
     available, not just a legacy leftover.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T22:29Z — claiming, starting generic Workflow interpreter -->
<!-- signal: claude 2026-08-05T02:15Z — done, all tests green, pushed to main -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): implemented via Implement sub-agent per plan above; delivered
  `modules/workflowDef.ts` + `modules/workflow.ts` (571+ lines), two shipped YAML
  Workflows, `chains/registry.ts` rewritten with three registered Workflows, `cli.ts`
  `--chain`→`--workflow` rename with new exit codes 5 (`gate-failed`)/6
  (`loop-exhausted`), full unit + live-integration test coverage.
- 2026-08-05 (claude): independent review pass (not the implementing sub-agent) found
  and fixed a real latent bug: taskPrompt injection was tracked via a closure-local
  variable inside `runSteps`, never reachable from `runLoopStep`'s direct calls to
  `runAgentStep` — a Workflow whose first step is a `loop` would silently drop the
  task prompt. Neither shipped Workflow starts with a loop, so this never fired in
  testing, but the interpreter is meant to be correct for any valid Workflow shape,
  not just the two shipped ones. Fixed by moving the flag onto `RunContext`
  (`taskPromptInjected`), checked/set inside `runAgentStep` itself so both call sites
  share identical logic. Added a regression test with a synthetic loop-first workflow
  confirming the fix (`modules/workflow.test.ts`).
- 2026-08-05 (claude): review pass also caught the box's LAN IP had changed
  (192.168.1.21 → 192.168.1.226 — wired interface dropped, DHCP reassigned on WiFi),
  breaking `piwebClient.ts`'s hardcoded `DEFAULT_BASE_URL` and one hardcoded-IP test
  assertion in `chains/planBuildTest.integration.test.ts`. Fixed both: the default is
  now overridable via `PI_WEB_FACTORY_BASE_URL` (documented as dev-only — M-068's
  Docker build will use loopback), and the test derives its expected origin from the
  constant instead of a second hardcoded literal, so it can't drift out of sync again.
- 2026-08-05 (claude): full live-suite run (202 tests) hit one failure —
  `bounded-build-review`'s live integration test, `review` step's `waitForCompletion`
  timed out at the default 120s. Diagnosed via `/status` on the live session: unlike
  M-070's genuinely-stuck case (`isStreaming: true` even after checking), this session
  showed `isStreaming: false` with a real, valid completed envelope already in its
  message history — the turn finished, just slower than the 120s wait window allowed,
  most likely `big-moe` (used for `review`) running slow under today's cumulative
  hours of heavy concurrent live-testing load plus the `medium-moe` OOM/restart that
  happened around the same time. Retried the same live test cleanly afterward (system
  load settled, `medium-moe` healthy) — passed in 89s, comfortably under the timeout.
  Treated as confirmed transient flakiness under today's specific load conditions
  (same evidentiary bar already established for M-070), not a code defect — no
  timeout-config changes made, since there's no real caller/data yet to justify a new
  configuration surface (`run.ts` already has the plumbing for a configurable
  `waitOptions.timeoutMs` if a future default proves genuinely too tight).
- 2026-08-05 (claude): full suite green (202 pass / 0 fail), `tsc --noEmit` clean,
  committed and pushed directly to main (this repo's direct-push override applies).

## Handoff notes
Commit: `7916375` on `main`. Three Workflows now runnable via `cli.ts --workflow
<name>`: `plan-build-review`, `bounded-build-review`, `plan-build-test`. Next up per
the design doc: M-072 (Agent Skill trigger, blocked_by M-071 which is done) and M-077
(visualizer, lower priority). M-068 (Docker) stays last.
