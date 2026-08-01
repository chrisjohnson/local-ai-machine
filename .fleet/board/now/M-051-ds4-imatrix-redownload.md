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
3. [ ] Once fully downloaded, re-run both the no-MTP and MTP benchmarks
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

## Decision log
- A background sub-agent was dispatched for this + a separate Bonsai 27B
  research task (M-052). It got as far as writing a correct, complete
  `configuration.nix` entry for this exact fix, then stopped without
  committing, pushing, deploying, or creating this card — likely related
  to a "safety classifier unavailable" condition flagged on its
  completion notification. Recovered its uncommitted edit (verified
  correct before using it) and finished the rest of this card's steps
  1-2 directly rather than re-doing the analysis from scratch.

## Handoff notes
Download in progress on the host — check
`/var/lib/ai-models/ds4-deepseek-v4-flash-iq2xxs-imatrix/.download-complete`
before starting the re-benchmark (step 3). Old wrong-variant directory
(`ds4-deepseek-v4-flash-iq2xxs`) is untouched, still on disk.
