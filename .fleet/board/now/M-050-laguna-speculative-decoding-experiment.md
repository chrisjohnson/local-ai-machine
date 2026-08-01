---
id: M-050
title: Test llama.cpp classic speculative decoding for Laguna-S-2.1 (Laguna XS 2.1 as draft model)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-01T10:00:00Z
blocks: null
blocked_by: [M-047, M-049]
status: null
related_cards: [M-047, M-049]
---

# M-050 — Test llama.cpp speculative decoding for Laguna-S-2.1

## Context
Chris watched a video showing Laguna-S-2.1 (118B/8B-active) hitting
75+ tok/s on a DGX Spark with speculative decoding enabled. Researched
this session: that number comes from **NVFP4** (Blackwell-exclusive FP4
tensor cores — the same hardware wall we already hit with FP8 on this
GPU, gfx1151 has none) plus **DFlash** (a genuinely new 2026 speculative
decoding method using a dedicated small diffusion draft model, invoked
via vLLM's `--speculative-config`, showcased specifically on Blackwell).
Neither is reproducible on this box's Vulkan RADV/llama.cpp stack as-is —
different hardware, different quantization format, different serving
engine.

**Not a dead end, though.** Our own already-measured Laguna-S-2.1 result
on this exact box (plain llama.cpp, no speculative decoding at all) is
**30.0 tok/s** — already ahead of the DGX Spark's own NVFP4-*without*-
DFlash baseline (19.5 tok/s per the same research). llama.cpp has its
own, separate, older speculative decoding mechanism (`-md`/
`--model-draft`, classic autoregressive draft-and-verify — unrelated to
DFlash's diffusion approach) that doesn't need any NVIDIA-specific
hardware. Requirement: the draft model must share the target's
tokenizer.

Two locally-available candidates to actually test (this needs hands-on
verification, not more research — genuinely uncertain which, if either,
works):
1. **Laguna XS 2.1** (already downloaded, 33B/3B-active, same poolside
   family — plausible but unconfirmed tokenizer compatibility with
   Laguna-S-2.1). A full, capable model rather than a purpose-built tiny
   draft model, so there's a real risk it's too heavy to give a net win
   even if it technically works (the draft step itself must be fast
   relative to target verification for classic speculative decoding to
   help at all).
2. Poolside's own dedicated `poolside/Laguna-S-2.1-DFlash` checkpoint —
   described as a "5-layer Llama-style draft model," which sounds
   llama.cpp-compatible in principle, but its diffusion block-prediction
   design may not translate to llama.cpp's simpler one-token-at-a-time
   draft loop. Check its actual published format/architecture before
   assuming either way — may need conversion, may not work at all, may
   need to be downloaded fresh (not yet on this box).

Chris's explicit framing: "I'm willing to try unproven things" — this
card is scoped as a real experiment with an honestly uncertain outcome,
not a proven-safe addition. **Blocked until M-047 and M-049 finish** (both
are live benchmark work on the box right now) — don't start until both
are in `done/`.

## Plan
1. [ ] Confirm M-047 and M-049 are both done before touching anything.
2. [ ] Check `poolside/Laguna-S-2.1-DFlash`'s actual published format via
   the HF API (architecture, file format, whether a GGUF conversion
   already exists anywhere) — resolve the "is this even usable outside
   vLLM's DFlash pipeline" question with real evidence before attempting
   to wire it in.
3. [ ] Test option 1 first (Laguna XS 2.1 as draft, already on disk, zero
   additional download): deploy Laguna-S-2.1 via llama-server with
   `-md /path/to/laguna-xs-2.1...gguf`, confirm it even loads (tokenizer
   compatibility is unconfirmed, don't assume) — if it errors out on a
   tokenizer/vocab mismatch, that's a clean, fast "no," record it and
   move to option 2 if still worth pursuing.
4. [ ] If option 1 loads: run a real generation benchmark, measure actual
   tok/s AND draft acceptance rate, compare against the existing 30.0
   tok/s plain baseline. A slow/heavy draft model can make things worse,
   not better — the acceptance-rate-vs-draft-model-cost tradeoff needs
   real numbers, not an assumption that "any speculative decoding helps."
5. [ ] If option 1 is a bust (tokenizer mismatch, or net negative
   speedup) and option 2's format check from step 2 looked plausible,
   attempt it too. If option 2 also requires a GGUF conversion nobody's
   published yet, that's a real, larger undertaking (own conversion work)
   — stop and report back rather than taking that on unprompted, given
   the card's scope is "test what we can with what's realistic," not
   "build a new GGUF conversion pipeline."
6. [ ] Record whatever you find — including a clean negative result — as
   a catalog entry or at minimum a clear decision-log writeup. A "we
   tried X, it didn't work because Y" result is exactly as valuable to
   record as a win, given Chris explicitly framed this as an experiment.
7. [ ] Leave the box in a clean state when done — don't leave a
   half-working speculative-decoding config as anyone's active role.

## Signals
<!-- signal: claude 2026-08-01T10:00Z — claiming, blocked on M-047/M-049 finishing first -->

## Decision log

## Handoff notes
