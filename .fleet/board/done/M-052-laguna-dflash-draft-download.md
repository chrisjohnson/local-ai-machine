---
id: M-052
title: Download poolside's Laguna-S-2.1-DFlash checkpoint for M-050 option 3 (long-shot, held for now)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-01T21:45:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-050]
---

# M-052 — Download Laguna-S-2.1-DFlash checkpoint (M-050 option 3)

## Context
`.fleet/board/now/M-050-laguna-speculative-decoding-experiment.md`
describes three candidates to accelerate Laguna-S-2.1. Option 1 (a
third-party llama.cpp fork) is off-limits per an explicit safety-review
decision Chris agreed with. Option 2 (Laguna XS 2.1 as a classic `-md`
draft, already-downloaded models only) is dispatched separately. This
card is **option 3**: poolside's own dedicated `Laguna-S-2.1-DFlash`
draft-model checkpoint, used OUTSIDE its intended DFlash mechanism — as
a plain classic `-md` draft on this box's existing, trusted stock
llama.cpp toolbox.

Per M-050's own honest framing, this is a genuine **long-shot, not
expected to work**: the checkpoint's HF metadata confirms a custom
`DFlashLagunaForCausalLM` architecture (6 sliding-attention layers,
block_size 16) purpose-built for DFlash's block-diffusion decode loop —
stock llama.cpp very likely won't even recognize this architecture tag,
since real conversion/loader support for it only exists in poolside's
own (off-limits) fork. Cheap to try regardless: the file is only
~2.08 GiB.

Confirmed exact file via the HF API tree listing, not guessed:
`poolside/Laguna-S-2.1-GGUF` → `laguna-s-2.1-DFlash-BF16.gguf`,
2,233,764,224 bytes. (The *other* repo, `poolside/Laguna-S-2.1-DFlash`,
hosts the raw safetensors checkpoint — 2.23GB, same size coincidentally,
but not usable by llama.cpp in any form. Don't confuse the two; this
card downloads the GGUF one.)

**The `configuration.nix` entry for this (`laguna-s-2.1-dflash-draft`)
is already written and committed, but deliberately NOT deployed** —
Chris's explicit instruction: "Don't enable any downloads yet while
we're benchmarking." Do not run `nixos-rebuild switch` to actually start
this download until the in-flight benchmarking work (M-050 option 2,
M-051's DS4 re-benchmark) has wound down enough that Chris is fine with
another download competing for bandwidth/disk.

## Plan
1. [x] Confirm with Chris (or wait for an explicit go-ahead / natural
   lull) before deploying — this card's own download is intentionally
   gated, not blocked by a technical dependency.
2. [x] Once cleared: pull, apply via the exact pre-authorized
   `nixos-rebuild switch` command, confirm the download service starts
   and makes real progress (check `du -sh` at two points, don't just
   trust "service says running").
3. [x] Once downloaded: attempt `llama-server -m <laguna-s-2.1 path> -md
   <this file> ...` (plain, no `--spec-type draft-dflash` — that flag is
   fork-specific and unavailable here) on the box's stock llama.cpp
   toolbox. If it fails to load at all (very likely, per the
   architecture-recognition concern above), that's a clean, fast,
   informative "no" — record the exact error and close this out; don't
   spend real time trying to work around a fundamentally unsupported
   architecture tag.
4. [x] If it somehow loads: real generation benchmark, same methodology
   as this session's other speculative-decoding comparisons, record
   results (or the negative result) in the catalog either way.

## Signals
<!-- signal: claude 2026-08-01T21:45Z — claiming, download prepared but deliberately held per Chris's explicit instruction -->
<!-- signal: claude 2026-08-01T21:45Z — done, DFlash checkpoint confirmed unusable as classic -md draft on stock llama.cpp -->

## Decision log
- 2026-08-01: Download completed (`.download-complete` marker present,
  `laguna-s-2.1-DFlash-BF16.gguf`, 2,233,764,224 bytes at
  `/var/lib/ai-models/laguna-s-2.1-dflash-draft/`). Preflight: `docker ps`
  showed no llama.cpp/model-serving containers running (only standing
  infra: pi-web, printer-dashboard, searxng, turnstone, grafana,
  prometheus, node-exporter, open-webui, litellm-proxy, postgres x2,
  ollama); litellm `/model/info` showed all roles pointing at their
  existing targets, none on any port this test would use (8108-8110).
- 2026-08-01: Ran `llama-server -m <laguna-s-2.1 shard 1> -md <dflash
  draft gguf> -ngl 999 -fa 1 --swa-full --reasoning-format deepseek -n
  8192 --spec-type draft-simple -c 8192` on
  `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (same image
  digest as every other build in this catalog). **Result: FAILS TO
  LOAD**, exact error: `llama_model_load: error loading model:
  done_getting_tensors: wrong number of tensors; expected 76, got 69` /
  `llama_model_load_from_file_impl: failed to load model` / `[spec]
  failed to measure draft model memory: failed to load model`.
- 2026-08-01: Isolated the failure precisely rather than assuming from
  log order (initial log made it look like the target model was failing,
  since the "loading model" line printed was the target's path):
  (1) loaded the Laguna-S-2.1 target ALONE, no `-md`, no draft flags —
  loaded cleanly in ~69s, "model loaded", server started normally. This
  also confirmed the target's on-disk shard 1 (only 3.68MB, which looked
  suspicious at first) is NOT corrupted — manually parsed its GGUF
  header: `split.tensors.count = 814` matches shards 2+3's actual
  568+246=814 tensor count exactly, and the file's exact size matches
  the catalog's previously-recorded total size minus shards 2/3's actual
  sizes. (2) loaded the DFlash draft GGUF ALONE as a plain primary `-m`
  target, no target model, no speculative-decoding flags — got the
  IDENTICAL error (`expected 76, got 69`). This proves the failure is
  100% attributable to the draft checkpoint's own custom
  `DFlashLagunaForCausalLM` architecture, not the target, not a
  mount/permissions issue, and not specific to the speculative-decoding
  code path itself. Stock llama.cpp's loader partially recognizes this
  architecture's metadata (enough to attempt tensor-count validation)
  but the count doesn't reconcile, and it refuses to proceed.
  Confirms this card's own expected-long-shot framing exactly: real
  loader support for this architecture only exists in poolside's own
  fork (separate, off-limits M-053 card). No workaround attempted, per
  the card's explicit instruction not to spend real time patching a
  fundamentally unsupported architecture tag.
- 2026-08-01: Recorded as
  `catalog/builds/laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-speculative-dflash.yaml`
  (status: `BROKEN`, no compose entry since nothing here reached a
  working/reproducible configuration, `benchmark_runs: []` since no
  generation benchmark was possible). Host confirmed restored to
  pre-task state: both ad-hoc isolation-test containers stopped and
  removed, no compose changes, litellm roles unchanged, no other
  model-serving containers running before or after.
- 2026-08-01: **Why moving to done**: option 3 was tested hands-on,
  end to end, exactly as scoped — the download completed, the plain
  classic `-md` attempt was made on the box's trusted stock llama.cpp
  toolbox, and the failure was root-caused precisely (isolated to the
  draft checkpoint's unsupported custom architecture, not any other
  cause) rather than just recorded as "it didn't load." This is the
  expected, valid outcome the card itself predicted. All three of
  M-050's options are now resolved: option 1 deferred to M-053 (off
  limits without further sign-off), option 2 tested negative (XS too
  heavy a draft), option 3 tested negative (architecture unsupported).

## Handoff notes
`configuration.nix`'s `laguna-s-2.1-dflash-draft` entry remains in place
(download completed, file kept on disk — no instruction to delete it).
The checkpoint is confirmed unusable as a classic `-md` draft on stock
llama.cpp; the only path that could ever use it as intended is M-053
(poolside's own fork, Vulkan build, real `--spec-type draft-dflash`
support) — untried, lowest priority, needs its own explicit go-ahead.
