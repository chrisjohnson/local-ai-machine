---
id: M-023
title: Verify/harden benchmark_orchestrator.py idempotency at the per-benchmark-id level
initiative_id: null
claimed_by: sub-agent (implement)
claimed_at: 2026-07-28T14:00Z
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
1. [x] Read `gather_plan()`, `already_has_run()`, and every
   `process_*_build()` function in `scripts/benchmark_orchestrator.py` in
   full.
2. [x] Determine definitively whether a build with some-but-not-all expected
   benchmark_ids recorded would currently be handled correctly (run only the
   missing ones) or incorrectly (skipped entirely, or re-run entirely).
3. [x] If there's a gap, fix it so each benchmark_id a build could produce is
   independently checked via `already_has_run()` before being (re)run.
4. [x] Demonstrate the fix concretely (e.g. a synthetic/temporary extra
   benchmark_id against a real already-benchmarked build, via --dry-run or a
   controlled real run) — not just an assertion that it's fine.
5. [x] Open a PR against main with the findings/fix. Do not merge, do not
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
- 2026-07-28 — read `gather_plan()`, `already_has_run()`, and all three
  `process_*_build()` functions in full. Finding: for the *current* fixed
  benchmark_id set, per-id gating was already correct everywhere
  (`already_has_run()` checks exact benchmark_id match; each
  `process_vllm_build`/`process_llamacpp_build` independently gates each
  benchmark_id via `already_has_run()` before running it, not a looser
  "has any data" check). The real gap was structural, not behavioral:
  `main()`'s plan-level skip/run decision was a hand-assembled per-family
  boolean chain (duplicating, not deriving from, the same benchmark_id
  constants each `process_*_build()` checks) — so adding a new
  benchmark_id later would require updating multiple call sites in
  lockstep, and forgetting the plan-level check (the one furthest from the
  dispatch code) would silently skip every already-partially-benchmarked
  build forever once it had even one recorded id, exactly the failure mode
  this card was worried about.
- 2026-07-28 — fix: added `expected_benchmark_ids(build, family)` and
  `missing_benchmark_ids(build, family)` as the single registry both
  `main()`'s plan-level skip check and `process_ollama_build()`'s early
  return now derive from (vLLM/llama.cpp process functions already gated
  per-id correctly and were left untouched). Verified no regression:
  `--dry-run` plan output is byte-for-byte identical before/after across
  all 27 real `catalog/builds/*.yaml` entries. Verified the fix: simulated
  a new benchmark_id added to every engine family and confirmed three
  real, already-fully-benchmarked builds (one per family) correctly flip
  from SKIP to RUN with "missing `<new-id>`, already has `<old ids>`",
  exercised via both a standalone harness and the real `main()`
  entrypoint directly. PR opened, not merged:
  https://github.com/chrisjohnson/local-ai-machine/pull/3

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Done. Chris merged PR #3 2026-07-28; fix (`903f451`) confirmed on main.
