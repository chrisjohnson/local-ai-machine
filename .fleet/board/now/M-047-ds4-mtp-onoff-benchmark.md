---
id: M-047
title: Benchmark DS4 DeepSeek-V4-Flash with MTP on vs off, record results
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-047 — Benchmark DS4 DeepSeek-V4-Flash MTP on vs off

## Context
`ds4-deepseek-v4-flash-iq2xxs` is currently downloading (main weights
~80.76GiB + MTP add-on ~3.55GiB, `antirez/deepseek-v4-gguf`, engine:
DwarfStar/ds4, not generic llama.cpp — see `kyuz0/strix-halo-ds4-toolbox`
for the gfx1151 build). A real, concrete reason to doubt the MTP add-on
helps at all here, found during this session's research (not
speculation): a different quantizer's README for the same base model
(`nazeshinjite/DeepSeek-V4-Flash-0731-ds4-GGUF`) reported **"MTP was a
net loss of 3-11%"** on Apple Silicon, attributing it to being
"compute-bound... dequantization dominates the decode step — so
verification work is not free." Whether that dequantization-bound
dynamic is a Metal-specific quirk or a property of this quantization
scheme generally (and thus also relevant on this box's ROCm/Strix-Halo
backend) is unknown — this card exists to actually measure it here
rather than assume either way.

**Blocked until the download finishes** — do not start until
`/var/lib/ai-models/ds4-deepseek-v4-flash-iq2xxs/.download-complete`
exists on the host.

## Plan
1. [ ] Confirm the download completed cleanly (`.download-complete`
   marker present, no `.incomplete` residue).
2. [ ] Get DS4 itself running on this box via the `strix-halo-ds4-toolbox`
   (kyuz0) — this is a new engine, not yet deployed here at all; expect
   real first-time-integration friction (build/pull the toolbox image,
   figure out its serving interface/API shape, memory-utilization
   flags), not just "point an existing container at a new file."
3. [ ] Run a real generation benchmark **with MTP disabled** (or the MTP
   file simply not loaded) at a fixed, realistic context size (128k, per
   the earlier design conversation this session) — record actual
   tok/s, not an estimate.
4. [ ] Run the same benchmark **with MTP enabled**, same context size,
   same prompt(s) — as close to apples-to-apples as the engine's own
   flags allow.
5. [ ] Record both results — ideally as a new `catalog/builds/` entry
   (matching this repo's existing convention: `benchmark_id`,
   `fingerprint`, `result` with real numbers, `raw_files` pointing at
   saved output), even though this is a new engine outside the existing
   vLLM/llama.cpp catalog schema — adapt the schema minimally rather
   than skipping recording just because it doesn't fit perfectly.
6. [ ] State the actual conclusion plainly in the decision log: did MTP
   help, hurt, or wash on this hardware for this model? Don't bury it in
   raw numbers — answer the question this card exists to answer.

## Signals

## Decision log

## Handoff notes
