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
<!-- not scoped yet — needs the design decision above first -->

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T03:20Z — filed from a live finding during M-072's verification, not started -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): filed per AGENTS.md §2 (self-discovered bug → backlog/,
  flagged, not started) — this is a real, reproduced-live finding, not
  speculative, but the right fix depends on a design call only Chris should make.

## Handoff notes
Full repro trace (adwId `adw_b1b0a8101909`, now cleaned up — session archived+
deleted, scratch repo removed) is in this card's Context above. Whoever picks this
up should re-derive a small repro rather than trusting cleaned-up IDs.
