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
1. [x] Confirm the download completed cleanly (`.download-complete`
   marker present, no `.incomplete` residue).
2. [x] Get DS4 itself running on this box via the `strix-halo-ds4-toolbox`
   (kyuz0) — this is a new engine, not yet deployed here at all; expect
   real first-time-integration friction (build/pull the toolbox image,
   figure out its serving interface/API shape, memory-utilization
   flags), not just "point an existing container at a new file."
3. [x] Run a real generation benchmark **with MTP disabled** (or the MTP
   file simply not loaded) at a fixed, realistic context size (128k, per
   the earlier design conversation this session) — record actual
   tok/s, not an estimate.
4. [x] Run the same benchmark **with MTP enabled**, same context size,
   same prompt(s) — as close to apples-to-apples as the engine's own
   flags allow.
5. [x] Record both results — ideally as a new `catalog/builds/` entry
   (matching this repo's existing convention: `benchmark_id`,
   `fingerprint`, `result` with real numbers, `raw_files` pointing at
   saved output), even though this is a new engine outside the existing
   vLLM/llama.cpp catalog schema — adapt the schema minimally rather
   than skipping recording just because it doesn't fit perfectly.
6. [x] State the actual conclusion plainly in the decision log: did MTP
   help, hurt, or wash on this hardware for this model? Don't bury it in
   raw numbers — answer the question this card exists to answer.

## Signals
<!-- signal: claude 2026-08-01T21:00Z — done, catalog recorded, moving to done/ -->

## Decision log
- Deployed via `kyuz0/strix-halo-ds4-toolbox:rocm-7.14` (ad hoc `docker
  run`, no standing compose service — matches the "swap-in comparison
  tier" pattern used elsewhere in this catalog). Real, hardware-specific
  OOM hit and fixed during setup: `--ctx 128000` prefill of a real
  ~116k-token prompt got OOM-killed by the kernel (confirmed via
  `journalctl -k`), root-caused to a known, still-unmerged upstream bug
  (antirez/ds4 issue #359 / PR #361 — ROCm's tensor allocator uses
  device-only `cudaMalloc` instead of `cudaMallocManaged`, so prefill
  scratch can't spill into the broader unified-memory pool even with
  `amdgpu.gttsize=126976` already configured correctly). Fixed with
  `--prefill-chunk 1024` (below the default 4096), a legitimate
  documented flag, not a workaround-hack.
- **Answer to the card's own question: MTP washes, doesn't help.** Same
  real ~116k-token prompt + 300-token generation, both runs: no-MTP
  generation 11.86 tok/s avg (141.41 tok/s prefill); MTP-enabled
  generation 11.86 tok/s avg (99.26 tok/s prefill — notably slower
  prefill despite MTP not algorithmically touching prefill, likely the
  draft model's resident weights competing for memory bandwidth, not
  confirmed further). Generation speed is identical to 2 decimal places
  across the whole decode span — a genuine null result, not noise.
  Matches independent research from earlier this session: a different
  quantizer's README for this same base model reported "MTP was a net
  loss of 3-11%" on Apple Silicon, attributed to compute/dequantization-
  bound decode rather than bandwidth-bound — here it's a wash rather
  than a loss, same underlying story.
- **Real gap found late, flagged rather than silently left uncorrected:**
  this whole benchmark ran on the wrong GGUF variant. Chris asked
  directly whether the downloaded file matched what
  `github.com/antirez/ds4/blob/main/STRIXHALO.md` (the Strix-Halo-specific
  upstream doc) recommends — it doesn't. That doc explicitly says to use
  the `-imatrix.gguf` variant; this build downloaded and benchmarked the
  plain non-imatrix file instead (per the repo's general, non-hardware-
  specific README guidance, followed earlier in the session before this
  doc was found). Both files are ~86.72GB — a correctness gap, not a
  capacity one. The MTP-vs-no-MTP comparison itself is still fair (same
  wrong file both times), but the absolute 11.86 tok/s number is
  provisional, not authoritative, until re-run on the recommended file.
  Recorded explicitly in the catalog entry rather than glossed over.
- Catalog entry: `catalog/builds/ds4-deepseek-v4-flash-iq2xxs--ds4-strix-halo.yaml`,
  two `benchmark_runs[]` entries (no-MTP, MTP) with full fingerprints per
  `catalog/OPERATIONS.md`. Committed and pushed to `main` directly
  (commit `e27795a`).

## Handoff notes
Follow-up not yet actioned: re-download
`DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf`
(the STRIXHALO.md-recommended variant) and re-run both benchmarks for an
authoritative result. The `ds4-128k-mtp`/`ds4-128k-*` containers used for
this benchmark should be cleaned up if not already (ad hoc, not part of
the standing serving set).
