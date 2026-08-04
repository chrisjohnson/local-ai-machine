---
id: M-076
title: pi-web-factory — generic Workflow interpreter (YAML step sequences + bounded loop)
initiative_id: null
claimed_by: null
claimed_at: null
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
1. [ ] Define the Workflow YAML shape: `name`, ordered `steps:` list, each
   `{name, kind: agent|code, role: <role-name>, ...}`. A native `loop` step kind:
   `{kind: loop, steps: [...], until: <condition-expression-or-field-check>,
   max_rounds: 3}` — keep the condition check narrow and concrete (e.g. "loop while
   the review step's `approved` field is false"), not a general expression language.
2. [ ] The interpreter itself: reads a Workflow definition, walks its steps in order,
   for each `agent` step calls `run.ts`'s `runAgentPhase` (already built, M-066) with
   the resolved Role's config; for each `code` step calls the resolved code Role's
   function (M-075's registry); for a `loop` step, repeats its inner steps up to
   `max_rounds`, checking the `until` condition after each round, and reports a real,
   distinct Workflow Run outcome if the cap is hit without satisfying it (not silently
   treated as success — same discipline `run.ts`'s own bounded retry loop already
   established for parse failures).
3. [ ] Session continuation across steps (already established by M-066's
   `planBuildTest.ts`, port the pattern into the generic interpreter rather than
   reinventing it): one session per Workflow Run by default, threaded through every
   step.
4. [ ] Populate `phases.output_summary`/token columns (M-074) from each step's actual
   result — the interpreter is the natural place for this now that it's the single
   caller of every step kind, superseding the ad hoc version M-074 asked to be added
   directly into `planBuildTest.ts`.
5. [ ] Ship the two Workflow YAML definitions themselves (plan-build-review,
   bounded-build-review) alongside the Roles config from M-075.
6. [ ] `chains/registry.ts` (M-067) or its successor: register Workflows by name for
   `cli.ts`'s `--chain`/`--workflow` flag (rename the flag too, per the new
   vocabulary — `--workflow` reads better now than `--chain`; update `cli.ts`'s own
   help text and `WorkItem` shape references in the design doc if the flag name
   changes).
7. [ ] Tests: unit tests for the loop step's bounded-exhaustion and early-success
   paths (mocked, matching `run.test.ts`'s established pattern), plus at least one
   live end-to-end test per shipped Workflow shape (matching the established
   `*.integration.test.ts` pattern).
8. [ ] Decide `chains/planBuildTest.ts`'s fate: leave it as a working, hand-written
   example alongside the new interpreter (harmless, already tested), or retire it now
   that a YAML Workflow can express the same shape — implementer's call, document
   whichever way it goes.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
