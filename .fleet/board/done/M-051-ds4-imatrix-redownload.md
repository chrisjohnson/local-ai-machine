---
id: M-051
title: Re-download DS4 DeepSeek-V4-Flash with correct imatrix GGUF variant, re-benchmark
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-01T21:30:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-047]
---

# M-051 — Re-download DS4 with correct imatrix variant, re-benchmark

## Context
M-047 benchmarked DS4/DwarfStar's DeepSeek-V4-Flash on the wrong GGUF
variant: the Strix-Halo-specific upstream doc
(github.com/antirez/ds4/blob/main/STRIXHALO.md) explicitly recommends
`DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf`
(note the `-imatrix` suffix), but the existing
`ds4-deepseek-v4-flash-iq2xxs` download used the plain, non-imatrix file
instead — followed per the repo's general (non-hardware-specific) README
guidance, before the hardware-specific doc was found. Both files are
~86.72GB (imatrix affects quantization quality, not size) — a
correctness gap, not a capacity one. Full history in
`catalog/builds/ds4-deepseek-v4-flash-iq2xxs--ds4-strix-halo.yaml` and
`.fleet/board/done/M-047-ds4-mtp-onoff-benchmark.md`.

## Plan
1. [x] Add a new `configuration.nix` models-list entry
   (`ds4-deepseek-v4-flash-iq2xxs-imatrix`) pointing at the correct
   `-imatrix.gguf` file (+ the same MTP add-on, byte-identical to the one
   already downloaded, redeclared so this entry is self-contained).
   Confirmed exact filename/size fresh via the HF API tree listing.
2. [x] Commit and push the config change.
2a. [ ] Deploy on host (pull + the exact pre-authorized `nixos-rebuild
   switch` command) and confirm the new download service actually
   started and is making real progress — **deliberately held per Chris's
   explicit instruction: don't enable any new downloads while M-050's
   benchmark is running.** Do this once that's clear.
3. [x] Once fully downloaded, re-run both the no-MTP and MTP benchmarks
   (same real ~116k-token-prompt methodology as M-047) on the correct
   file, and record the results as a new `benchmark_runs[]` entry (or a
   new versioned build) in the catalog — this is the actual point of the
   card, not just fixing the download list.
4. [ ] Decide whether to delete the old wrong-variant
   `ds4-deepseek-v4-flash-iq2xxs` local dir (~84GB) once the correct one
   is confirmed working — a deliberate call for whoever picks this up,
   not an automatic side effect (left in place for now).

## Signals
<!-- signal: claude 2026-08-01T21:30Z — picked up and finished after a sub-agent dispatch failed mid-task (left a correct but uncommitted configuration.nix edit, no commit/card/deploy) -->
<!-- signal: claude 2026-08-06T03:30Z — benchmark done, catalog recorded, moving to done/ -->

## Decision log
- (claude, 2026-08-06) Re-ran M-047's exact methodology on the correct imatrix file: stopped all
  running model-serving containers by name first (qwen3.6-35b-a3b-mtp-v2, laguna-s-2.1-v2 — the only
  two running at the time), reused M-047's own leftover prompt file
  (`/tmp/ds4-bench/long_prompt_120k.txt`, 115,837 prompt tokens) and streaming-timing script
  (`ds4_stream_bench.py`), same `kyuz0/strix-halo-ds4-toolbox:rocm-7.14` image (already cached on host),
  same flags (`--rocm -c 128000 --prefill-chunk 1024`). **Result: confirms M-047's finding — MTP washes,
  does not help, on this hardware.** No-MTP: prefill 137.80 tok/s avg, generation 11.81 tok/s avg (841.18s
  total). MTP: prefill 99.25 tok/s avg (notably slower prefill again, same effect M-047 saw), generation
  11.85 tok/s avg (1192.51s total) — statistically indistinguishable from no-MTP (0.04 tok/s apart).
  These numbers are remarkably close to M-047's original wrong-variant numbers (141.41/11.86 vs
  137.80/11.81 no-MTP; 99.26/11.86 vs 99.25/11.85 MTP) — expected, since imatrix calibration changes
  quantization *quality*, not raw throughput (bit-width/tensor layout unchanged, same ~86.72GB file
  size either variant). This re-run resolves the correctness gap M-047 flagged (unverified output
  quality on the wrong file), not a speed correction — the speed number was already a reasonable
  estimate. No OOM this run (M-047's `--prefill-chunk 1024` fix applied from the start).
  New catalog entry: `catalog/builds/ds4-deepseek-v4-flash-iq2xxs-imatrix--ds4-strix-halo.yaml` (new
  versioned file, not appended to the old wrong-variant one — old one marked SUPERSEDED with a
  cross-reference comment, kept in place as historical record, not deleted). Raw JSON results saved to
  `catalog/raw/ds4-deepseek-v4-flash-iq2xxs-imatrix--ds4-strix-halo--ds4-server-live-timing-v1--{nomtp,mtp}--*.json`.
  Both ad hoc benchmark containers (`ds4-imatrix-nomtp`, `ds4-imatrix-mtp`) stopped and removed
  immediately after each run. Host restored to its pre-existing state afterward: the two original model
  containers (qwen3.6-35b-a3b-mtp-v2, laguna-s-2.1-v2) restarted explicitly by name, confirmed healthy
  with real completions, no OOM. Plan item 4 (delete old wrong-variant dir) deliberately left open —
  Chris's call, not mine.
- A background sub-agent was dispatched for this + a separate Bonsai 27B
  research task (M-052). It got as far as writing a correct, complete
  `configuration.nix` entry for this exact fix, then stopped without
  committing, pushing, deploying, or creating this card — likely related
  to a "safety classifier unavailable" condition flagged on its
  completion notification. Recovered its uncommitted edit (verified
  correct before using it) and finished the rest of this card's steps
  1-2 directly rather than re-doing the analysis from scratch.

## Handoff notes
Benchmark done, catalog recorded (2026-08-06). The card's actual point —
re-running M-047's methodology on the correct imatrix file — is complete;
MTP confirmed to wash (not help) on this hardware, matching M-047's
original conclusion. Only remaining open item is plan step 4 (delete the
old wrong-variant `ds4-deepseek-v4-flash-iq2xxs` dir, ~84GB) — explicitly
a deliberate call for Chris, not an automatic side effect, left in place
on disk. Not a blocker for closing this card: the card's own plan framed
step 4 as a separate decision, not a completion gate. Moving to done/.
