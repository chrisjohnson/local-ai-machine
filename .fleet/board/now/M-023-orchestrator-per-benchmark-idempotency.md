---
id: M-023
title: Verify/harden benchmark_orchestrator.py idempotency at the per-benchmark-id level
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-021]
---

# M-023 — Per-benchmark-id idempotency in the orchestrator

## Context

M-021 will introduce a new benchmark methodology (`agentic-coding-session-v1`
or similar) that needs to run against every already-benchmarked build. Chris
wants a guarantee: re-running the whole orchestrator after adding a new
benchmark type causes it to detect, per build, exactly which benchmark_ids
are missing and run *only those*, not re-run already-recorded benchmarks and
not skip the whole build just because it has *some* prior data.

Open question worth real verification, not assumption: the dry-run output
seen so far always shows skip reasons like `already has llamacpp-bench-v1 +
seven-tier-coding-v2 runs` — i.e., the skip decision appears to reference the
*combined* set of benchmark_ids a build's engine family is expected to have,
which is a good sign, but each `process_*_build()` function needs to be
checked to confirm it actually gates *each* benchmark_id it might run
independently via `already_has_run()`, rather than treating "has some data"
as "fully done, skip everything."

Chris explicitly wants this delivered as a **PR for his review**, not a
direct push to main (deviation from this repo's normal direct-push
convention — his call for this specific change).

## Plan
<!-- ordered checklist -->
1. [ ] Read `gather_plan()`, `already_has_run()`, and every
   `process_*_build()` function in `scripts/benchmark_orchestrator.py` in
   full.
2. [ ] Determine definitively whether a build with some-but-not-all expected
   benchmark_ids recorded would currently be handled correctly (run only the
   missing ones) or incorrectly (skipped entirely, or re-run entirely).
3. [ ] If there's a gap, fix it so each benchmark_id a build could produce is
   independently checked via `already_has_run()` before being (re)run.
4. [ ] Demonstrate the fix concretely (e.g. a synthetic/temporary extra
   benchmark_id against a real already-benchmarked build, via --dry-run or a
   controlled real run) — not just an assertion that it's fine.
5. [ ] Open a PR against main with the findings/fix. Do not merge, do not
   push to main directly.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-28 — filed per Chris's direct request, ahead of implementing
  M-021's new benchmark type. PR-based delivery is an explicit deviation
  from this repo's normal direct-push-to-main convention, per Chris's
  instruction for this specific change.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Dispatched to a sub-agent working in an isolated worktree.
