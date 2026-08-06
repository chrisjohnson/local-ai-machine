---
id: M-080
title: pi-web-factory — plan-build-review's overall status doesn't reflect review's approved verdict
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-072, M-076]
---

# M-080 — pi-web-factory — plan-build-review's overall status doesn't reflect review's approved verdict

## Context
Found live, 2026-08-05, during M-072's own live verification of the triggering Agent
Skill (not a defect in the Skill itself — it faithfully relayed exactly what `cli.ts`
reported; this is a pre-existing gap in `plan-build-review`'s own Workflow shape,
M-076).

Real repro: triggered `plan-build-review` (via the new Skill, but the same happens
via `cli.ts` directly) against a scratch repo, asking the `build` agent to create
`skill-test.txt`. The `build` Step's agent turn reported `status: success` with a
summary claiming the file was "written to the repository root" — but it never
actually wrote or committed anything (`git status` in the worktree afterward: "nothing
to commit, working tree clean", no file present). The `review` Step correctly caught
this: its own `output_summary` says *"The build phase reported creating
skill-test.txt, but upon review, the file does not exist in the repository. This is
a critical discrepancy that blocks approval."* — almost certainly `approved: false`
in its envelope. But the review Step's own agent turn still parsed correctly (a
valid JSON envelope, matching its schema), so `phases.status` for the `review` row
is `"success"`, and — since `plan-build-review` has no loop and does no
post-processing on `review`'s `approved` field — the overall `WorkflowRunResult`
came back `status: "success"` too. `cli.ts`'s `describeResult` printed a bare
`SUCCESS`, and the Skill (correctly, faithfully) relayed that to the human as
"completed successfully! ✅".

This is misleading: a workflow whose last Step is a review agent that explicitly
rejected the work should not report top-level `SUCCESS`. Contrast with
`bounded-build-review`, which DOES treat `approved` as a real gate (its `until`
condition) — `plan-build-review` was deliberately built without a loop (a cheaper,
faster shape for when a correction round isn't wanted), but "no loop" and "the
verdict doesn't affect the outcome" are two different design choices that seem to
have been conflated here.

Not yet clear what the right fix is — flagging for a real decision, not picked
because it's ambiguous in a way worth a human call:
- Should `plan-build-review` (and any future no-loop-ending-in-review Workflow)
  surface a distinct status when the last Step's `approved` field is `false` — e.g.
  reusing something like `gate-failed`'s discriminated-union pattern, or a new
  `review-rejected` variant?
- Or is the review step in a no-loop Workflow meant to be purely advisory/
  informational (the human is expected to read `steps.review.approved`/`findings`/
  `blocking` themselves), in which case the real gap is just that `cli.ts`'s
  `describeResult` and the Skill's own relay logic don't surface that data at all
  right now (both currently print/report only the bare status word) — a smaller,
  UI/reporting-only fix rather than a new WorkflowRunResult variant?
- Separately, worth asking whether `build` hallucinating success without actually
  writing anything is itself worth investigating (a `permissions.ts`/gate-style
  after-the-fact check already exists for writes outside the allowlist — is there
  a gap for writes that never happened at all vs. claimed?), or was reasonably just
  one flaky live-model turn that the architecture's own review-Step design is
  already meant to catch (which it did, informationally).

## Plan
Design decision (resolved by reading `workflow.ts`/`workflowDef.ts`/`bounded-build-review.yaml`
in full): **any non-approved `review` step anywhere in the run's step history should flip the
whole run to a distinct failure-shaped status** — not just the last step, and not a
loop-vs-no-loop special case. Reasoning:
- `bounded-build-review` does NOT need a code change: its `until: {step: review, field:
  approved, equals: true}` loop (`workflowDef.ts` LoopStepSchema, `workflow.ts`
  `runLoopStep`) already makes `approved: false` unable to reach the "success" fallthrough —
  it either gets corrected in a later round or the run ends `loop-exhausted`
  (`workflow.ts:509-516`). So this card's bug is specific to **any Workflow that runs a
  `review` step OUTSIDE of a gating loop** — today just `plan-build-review.yaml`, but
  the fix should be generic in the interpreter, not special-cased per-workflow, so a
  future no-loop-ending-in-review YAML gets the same protection automatically without
  someone having to remember this gap exists.
- The "purely advisory" reading (second bullet in Context) is rejected: `review`'s whole
  job per its own envelope schema (`modules/envelopes.ts:98-136`, `ReviewOutputSchema`)
  is to gate approval (`approved: boolean`, doc comment: "the verdict is `approved`"), and
  `bounded-build-review.yaml` already treats it as a hard gate, not advisory — a
  no-loop workflow silently downgrading review from gate to advisory (with zero UI
  change to signal that downgrade) is very likely the actual bug, not an intentional
  design split. `cli.ts`'s `describeResult` (cli.ts:186-256) has no case that reads
  `steps.review.approved` today — confirms it isn't already being surfaced anywhere.

Concrete implementation plan:
1. In `modules/workflow.ts`, add a new `WorkflowRunResult` variant to the discriminated
   union (alongside `permissions-violation`, `gate-failed`, `loop-exhausted`, defined at
   workflow.ts:108-167) — name it `"review-rejected"`, shape:
   `{ status: "review-rejected"; adwId: string; sessionId: string; step: string;
   review: ReviewOutput; link: WorkflowRunLinkInfo }`. Import `ReviewOutput` type from
   `./envelopes.ts` (already imported as `ReviewOutput` at workflow.ts:61 for
   `buildLoopCorrectionMessage`'s param — reuse the same import).
2. At the end of `runWorkflow` (workflow.ts:585-594), after `runSteps` returns
   `undefined` (i.e., every step's agent phase parsed successfully with no other
   terminal outcome) but BEFORE unconditionally returning `status: "success"`: scan
   `ctx.stepResults` for any step whose recorded envelope has `approved === false`
   AND whose `findings`/`blocking` arrays are present (the same shape-check
   `runLoopStep` already uses at workflow.ts:499-502 to detect a review-shaped
   envelope — reuse that pattern, e.g. factor it into a small shared helper
   `isReviewEnvelope(envelope): envelope is ReviewOutput` used by both
   `runLoopStep` and this new check, rather than duplicating the `Array.isArray`
   checks). Since `stepResults` is a plain object keyed by step name in step-definition
   order (`Object.entries` preserves insertion order in JS), iterate in that order and
   flip on the FIRST rejected review found, or last — for `plan-build-review` there's
   only ever one `review` step so it's moot; document the "first encountered in
   step order" behavior in a comment since a future multi-review workflow would care.
   Return `{ status: "review-rejected", adwId, sessionId: session.id, step: <that
   step's name>, review: <envelope>, link }` instead of falling through to success.
   Note this only fires for steps OUTSIDE a loop (steps inside a loop that ended
   in rejection already returned `loop-exhausted` earlier and never reach this
   final check) — so no double-handling between the loop path and this one.
3. Update `opts.tracer.sessionFinish(adwId, ok)` call: a `review-rejected` run should
   record `ok: false` (mirrors the existing `terminal.status === "success"` ? pattern
   at workflow.ts:587) — either extend that branch to also cover this new path, or
   let it fall out naturally since `review-rejected` won't equal `"success"`.
4. In `cli.ts`'s `describeResult` (cli.ts:186-256), add a `case "review-rejected":`
   arm before the `default`/unknown-status fallback (cli.ts:256) — model it on the
   existing `permissions-violation` case (cli.ts:225-237): pull `blocking`/`findings`
   off `result.review` the same defensive `"x" in result` way other cases do, and
   print something like:
   `REVIEW-REJECTED (step=${stepName()}) — ${idLine} — ${link} — review did not
   approve: ${blocking.join("; ") || review.summary}`. Give it its own dedicated
   exit code (next available — existing codes are 0/2/3/4/5/6 per the switch; use 7)
   distinct from `permissions-violation`'s 4 and `gate-failed`'s 5, since a human/CI
   script watching exit codes needs to tell "review said no" apart from "a gate/perm
   check failed" apart from "success".
5. Update `chains/registry.ts`'s re-exported `WorkflowRunResult` type (registry.ts:128)
   — it's a type-only re-export, should pick up the new variant automatically via the
   `export type { ... WorkflowRunResult }` line; verify with `bun run typecheck` (or
   equivalent — check `package.json` scripts) after the change, no code change needed
   there unless the type-check surfaces a narrowing issue in a consumer.
6. Leave `chains/planBuildTest.ts` untouched — confirmed by reading it in full
   (plan -> build -> test only, no `review` step at all in that hand-written chain;
   `toChainOutcome`'s status union has no review-shaped step to worry about). This
   card's fix belongs entirely in the generic interpreter (`workflow.ts`), not
   `planBuildTest.ts`.
7. Leave `bounded-build-review.yaml`/its loop untouched — confirmed already-correct
   above; write a regression test (see item 8) that documents WHY it's exempt rather
   than assuming a reviewer will re-derive that reasoning.
8. Tests: add cases to whatever test file already covers `workflow.ts` (check for
   `modules/workflow.test.ts` or similar) exercising: (a) a no-loop Workflow (like
   `plan-build-review`) ending in a review step whose envelope has `approved: false`
   -> asserts `status: "review-rejected"`, not `"success"`; (b) same shape but
   `approved: true` -> still `"success"` (no false-positive regression); (c)
   `bounded-build-review`'s loop with a review that never approves within
   `max_rounds` -> still `"loop-exhausted"`, unaffected by this change (confirms
   item 2's ordering claim that loop-internal rejections never reach the new
   final check).
9. Separately (do NOT fold into this card — flag as a possible new backlog card
   instead if picking this up): the Context's third bullet — `build` hallucinating
   success without writing anything — is arguably a distinct, real gap (no check
   today catches "agent claims a write happened but the git diff shows nothing"
   pre-emptively; `permissions.ts` only catches writes OUTSIDE the allowlist, not
   writes that never happened at all). Out of scope for M-080 itself (that's an
   agent-honesty/gate problem, not a status-propagation problem) — this card's fix
   makes sure such a case is at least correctly reported as rejected via `review`
   catching it after the fact, which is the existing, working safety net.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T03:20Z — filed from a live finding during M-072's verification, not started -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): filed per AGENTS.md §2 (self-discovered bug → backlog/,
  flagged, not started) — this is a real, reproduced-live finding, not
  speculative, but the right fix depends on a design call only Chris should make.
- 2026-08-06 (claude): refined per Chris's "refine all 4" request. Read
  `modules/workflow.ts`, `modules/workflowDef.ts`, `chains/planBuildTest.ts`,
  `workflows/plan-build-review.yaml`, `workflows/bounded-build-review.yaml`,
  `modules/envelopes.ts`, `chains/registry.ts`, and `cli.ts`'s `describeResult`
  in full. Resolved the design question: any non-approved review outside a
  gating loop should flip the run to a new `review-rejected` status, generic
  in the interpreter (not per-workflow) — `bounded-build-review`'s loop
  already handles the loop case correctly via its `until` condition and needs
  no change; `planBuildTest.ts` has no review step at all and is unaffected.
  Plan is concrete (exact functions/line ranges, new status variant, cli.ts
  wiring, tests). Cleared `status: needs-refinement`.

## Handoff notes
Full repro trace (adwId `adw_b1b0a8101909`, now cleaned up — session archived+
deleted, scratch repo removed) is in this card's Context above. Whoever picks this
up should re-derive a small repro rather than trusting cleaned-up IDs.
