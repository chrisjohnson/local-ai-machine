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
1. [ ] Confirm with Chris (or wait for an explicit go-ahead / natural
   lull) before deploying — this card's own download is intentionally
   gated, not blocked by a technical dependency.
2. [ ] Once cleared: pull, apply via the exact pre-authorized
   `nixos-rebuild switch` command, confirm the download service starts
   and makes real progress (check `du -sh` at two points, don't just
   trust "service says running").
3. [ ] Once downloaded: attempt `llama-server -m <laguna-s-2.1 path> -md
   <this file> ...` (plain, no `--spec-type draft-dflash` — that flag is
   fork-specific and unavailable here) on the box's stock llama.cpp
   toolbox. If it fails to load at all (very likely, per the
   architecture-recognition concern above), that's a clean, fast,
   informative "no" — record the exact error and close this out; don't
   spend real time trying to work around a fundamentally unsupported
   architecture tag.
4. [ ] If it somehow loads: real generation benchmark, same methodology
   as this session's other speculative-decoding comparisons, record
   results (or the negative result) in the catalog either way.

## Signals
<!-- signal: claude 2026-08-01T21:45Z — claiming, download prepared but deliberately held per Chris's explicit instruction -->

## Decision log

## Handoff notes
`configuration.nix` already has the `laguna-s-2.1-dflash-draft` entry,
committed but not deployed. Deploying it is the literal next step once
Chris gives the go-ahead — don't re-research the file, it's already
confirmed.
