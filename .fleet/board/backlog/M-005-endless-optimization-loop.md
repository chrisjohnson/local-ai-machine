---
id: M-005
title: Endless optimization loop — squeeze real performance out of each model on this hardware
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-006, M-007, M-008]
---

# M-005 — Endless optimization loop

## Context

Ported from README.md §8 Phase 5, Task 5.3 (2026-07-26). Standing, fully
autonomous work: squeeze the best real performance out of each model on this
exact hardware/toolbox combination — kernel flags, quantization choices,
speculative decoding, scheduler tuning, anything findable via research —
verified with real benchmarks, not trusted claims, keeping only what's
confirmed to actually help.

**Already closed out** (don't re-litigate): AITER confirmed broken across 3
architectures, left off; non-`enforce-eager` AWQ for the 122B tier tested as
a marginal real win and adopted as the standing default (drop
`--enforce-eager`, keep `VLLM_USE_TRITON_AWQ=1`); `--max-num-batched-tokens
16384` tuning confirmed a universal real regression across all 6 models
tested — keep the default (8192) everywhere.

**Next candidates for this loop**: MTP speculative decoding ([[M-007]]) and
alternate serving paths / hybrid NPU+iGPU execution ([[M-008]]).

No human dependency once underway — this is the umbrella/standing card for
the loop itself; specific sub-investigations that need their own tracking
(like MTP and alternate serving paths) get their own cards.

## Plan
<!-- ordered checklist -->
1. [ ] Pick up the next credible optimization candidate (research via 5.1-style
   surveys, community benchmark data, upstream changelogs).
2. [ ] Verify with a real benchmark run on this hardware before adopting —
   never trust a claimed number without reproducing it here.
3. [ ] Record the result (win, regression, or inconclusive) either in this
   card or in `OPTIMIZATIONS.md`, and only keep what's a confirmed real win.
4. [ ] Repeat — this card stays open as the standing loop; spin off a
   dedicated card for any candidate large enough to need its own tracking.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 5, Task 5.3 into a fleet
  card during the fleet-bootstrap backlog migration; prior progress (AITER,
  non-enforce-eager AWQ, max-num-batched-tokens) summarized from README
  rather than re-derived.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started as a fleet card. The three items already closed out (AITER,
non-enforce-eager AWQ, max-num-batched-tokens) are done and shouldn't be
re-tested; pick up from MTP ([[M-007]]) or alternate serving paths
([[M-008]]) next, per README's own note.
