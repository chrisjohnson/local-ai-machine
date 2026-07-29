---
id: M-025
title: Add --gpu-memory-utilization caps to all judge-sized (~<25B) vLLM services
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
related_cards: [M-024]
status: needs-refinement
---

# M-025 — Judge-sized model GPU memory caps

## Context

Found while fixing M-024's judge model (`qwen2.5-vl-7b-instruct`): it had no
`--gpu-memory-utilization` cap in `docker/docker-compose.yml`, defaulting to
vLLM's own 0.90 — fine for a standalone candidate, but this model runs
co-resident alongside whatever candidate model M-024's harness is actually
benchmarking, and an uncapped judge can starve it on this unified-memory box.
Fixed narrowly for `qwen2.5-vl-7b-instruct` (set to 0.20, matching the
existing `qwen3.5-4b-judge` precedent) as an immediate unblock.

Chris's request: do this systematically, not just for the one model that
happened to block M-024. Judge-sized models (his rough heuristic: **under
~25B**) will almost certainly only ever be used in tandem with a larger
candidate model, so they should all carry a conservative cap by default.
Larger models might plausibly be fast/capable enough to serve standalone
without needing a separate judge at all — those should NOT get a cap
(forcing a cap on a model meant to run alone would just waste capacity) —
but the docker-compose comments should hint at this consideration for future
model additions. (Done already: a general hint added to the file's top-level
header comment block, 2026-07-28 — this card is about the actual systematic
per-service pass, not the general documentation note.)

`needs-refinement`: the ~25B threshold is explicitly a rough heuristic, not
a hard rule — several current services are genuinely borderline and need a
real per-model judgment call, not a mechanical grep-and-set pass:
- `gemma-4-26b-a4b-it` — MoE, 26B total / 4B active. Total is just over the
  rough threshold; active params (what actually matters for real memory
  pressure during inference) is tiny.
- `glm-4.7-flash-awq` — MoE, ~30B total / ~3B active, AWQ 4-bit (already a
  very small on-disk footprint). Same total-vs-active tension.
- `qwen3.6-27b` — 27B dense, just over the rough threshold, no MoE
  active-params discount to lean on.
- `north-mini-code-1.0-w4a16` — 30B total/3B active MoE, but this build is
  `status: BROKEN` (hardware-incompatible NVFP4 issue) — likely moot, but
  worth a conscious skip-and-note rather than silently ignoring it.

## Plan
<!-- ordered checklist -->
1. [ ] Decide the actual criterion for "judge-sized" with Chris — literal
   total-param threshold, active-param threshold (better proxy for real
   memory pressure), or judged case-by-case per the borderline list above.
2. [ ] Audit every vLLM service in `docker/docker-compose.yml` against that
   criterion (current full list, with existing flags, found 2026-07-28:
   `qwen3.6-35b-a3b` 0.70, `qwen3.5-4b-judge` 0.20, `qwen3.6-27b` 0.90,
   `glm-4.7-flash-awq` unset/default, `qwen3-coder-next-gptq4bit` 0.70,
   `gpt-oss-20b` 0.90, `gpt-oss-120b` 0.90, `qwen3.5-122b-a10b-awq4bit`
   unset/default, `gemma-4-26b-a4b-it` 0.90, `gemma-4-31b-it` 0.90,
   `qwen2.5-vl-7b-instruct` now 0.20 (fixed), `north-mini-code-1.0-w4a16`
   0.90/BROKEN).
3. [ ] Set appropriate caps on whichever services the criterion actually
   selects. Pick cap values thoughtfully (not a single copy-pasted number
   for every model — `qwen3.5-4b-judge`'s 0.20 was sized for a 4B model,
   a 20-27B judge-sized model may reasonably need a higher cap than that).
4. [ ] Leave standalone-candidate-sized services uncapped, confirm the
   general hint comment already in the file's header (2026-07-28) still
   reads correctly once the systematic pass lands.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-28 — filed per Chris's direct request, as a followup to the
  narrow `qwen2.5-vl-7b-instruct` fix that unblocked M-024. Marked
  `needs-refinement` since the ~25B threshold is explicitly a rough
  heuristic and several existing services are genuinely borderline
  (MoE total-vs-active param tension) — needs Chris's actual criterion
  before this is a mechanical pass.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. The immediate blocker (`qwen2.5-vl-7b-instruct`) is already
fixed directly in `docker/docker-compose.yml` (0.20, matching
`qwen3.5-4b-judge`'s precedent) — this card is the broader systematic pass
across the rest of the fleet, not urgent, no active blocker right now.
