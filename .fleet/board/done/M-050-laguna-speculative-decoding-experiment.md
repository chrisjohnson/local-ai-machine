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

**Real community evidence found (2026-08-01, Reddit r/LocalLLaMA thread
"AI summary of creating a toolbox for Laguna S 2.1" —
reddit.com/r/LocalLLaMA/comments/1v3f6jq/, OP + a reply from u/Protryt),
not speculation — this materially changes the priority order below.**
Someone already built `poolsideai/llama.cpp` branch `laguna` on Strix
Halo (gfx1151) and ran it, both plain and with DFlash:
- OP built with **ROCm/HIP** (`-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151`),
  on a Fedora toolbox. Hit a real, hardware-specific wall: flash
  attention crashes outright on this GPU under ROCm without `rocWMMA`
  (`HIP kernel flash_attn_ext_f16 has no device code compatible with HIP
  arch 1300`) — had to disable FA entirely (`-fa 0`) to get anything
  running at all.
- OP's plain (no-DFlash) `llama-bench` result on that ROCm/no-FA build:
  **18.44 tok/s** tg128 (Q4_K_M, ngl 99).
- OP's own DFlash attempt failed outright (`dflash requires ctx_other to
  be set`) — gave up.
- u/Protryt got DFlash actually running using a community-written patch
  (Proton Drive link posted in-thread) fixing that exact error. Real
  measured results (pasted `llama-server` logs): draft acceptance
  73.5-90.6%, but **real generation speed only ~19-26 tok/s** across
  several logged requests.
- **The critical comparison: our own already-measured Laguna-S-2.1
  baseline on THIS box — Vulkan RADV, no speculative decoding at all —
  is 30.0 tok/s.** That beats both OP's plain ROCm baseline (18.44) and
  Protryt's DFlash-accelerated ROCm result (~19-26). The bottleneck isn't
  "no speculative decoding" — it's that ROCm/HIP itself appears to
  underperform our proven Vulkan RADV path on this exact GPU, almost
  certainly because of the FA-without-rocWMMA limitation nobody in that
  thread worked around. **Building this fork via ROCm/HIP would very
  likely make things slower for us, not faster.**
- **Nobody in that thread tried building the fork with Vulkan instead of
  ROCm.** That's now the one genuinely open, promising question: if
  `poolsideai/llama.cpp`/`laguna` builds cleanly with `GGML_VULKAN=ON`
  and inherits whatever makes our existing Vulkan RADV setup faster
  (proper FA support, evidently), DFlash's acceptance-rate boost could
  stack on top of our 30 tok/s baseline instead of ROCm's ~18. If the
  fork's Vulkan backend turns out not to support the DFlash-specific
  decode path at all (a real possibility — Vulkan support in the README
  may just be inherited boilerplate, per this card's earlier note), that
  itself is a valid, useful negative result.

Candidates to actually test, in priority order (this needs hands-on
verification — genuinely uncertain which, if any, work):

1. **Poolside's `laguna` fork, built with VULKAN (not ROCm/HIP) — the
   one thing the community thread didn't try, now the most promising
   option precisely because of what that thread found.**
   `github.com/poolsideai/llama.cpp`, branch `laguna`. Build with
   `-DGGML_VULKAN=ON` (matching this repo's existing Vulkan RADV toolbox
   build pattern), NOT the `-DGGML_HIP=ON` path OP/Protryt used. The
   matching draft-model GGUF already exists in a repo we already know:
   `poolside/Laguna-S-2.1-GGUF` → `laguna-s-2.1-DFlash-BF16.gguf`.
   Documented invocation: `llama-server -m laguna-s-2.1-Q4_K_M.gguf -md
   laguna-s-2.1-DFlash-BF16.gguf --spec-type draft-dflash
   --spec-draft-n-max 15`. Known issue to watch for from the community
   thread: `dflash requires ctx_other to be set` — if this recurs on a
   Vulkan build, the community patch (Proton Drive link:
   `https://drive.proton.me/urls/DZZHA26NS4#0spkpMpg9Znu`, written by
   an AI assistant per u/Protryt's account, fixing this exact error) may
   apply regardless of backend — worth trying before concluding it's a
   dead end, though verify what the patch actually changes before
   applying it blindly. Requires building a custom Docker image from
   this fork (not just pulling kyuz0's existing toolbox) — real but
   bounded work, not a huge lift.
2. **Laguna XS 2.1 as a classic `-md` draft** (already downloaded,
   33B/3B-active, same poolside family — plausible but unconfirmed
   tokenizer compatibility with Laguna-S-2.1). Works on stock/upstream
   llama.cpp (no custom fork needed), but XS is a full capable model, not
   a purpose-built tiny draft — real risk it's too heavy to give a net
   win even if it technically loads (the draft step must be fast
   relative to target verification for classic speculative decoding to
   help at all).
3. Poolside's dedicated `poolside/Laguna-S-2.1-DFlash` checkpoint used
   OUTSIDE the dflash-specific mechanism (i.e. as a plain classic `-md`
   draft on stock llama.cpp) — confirmed via its HF metadata to be a
   custom `DFlashLagunaForCausalLM` architecture (6 sliding-attention
   layers, block_size 16), specifically built for the block-diffusion
   DFlash decode loop, not a generic autoregressive draft model. Very
   unlikely to work as a plain `-md` draft even if the file loads —
   listed last, try only if 1 and 2 both fail and there's appetite for a
   long-shot.

Chris's explicit framing: "I'm willing to try unproven things" / "75
tok/sec on my hardware for a model this size seems extremely promising"
— this card is scoped as a real experiment with an honestly uncertain
outcome, not a proven-safe addition. **Blocked until M-047 and M-049
finish** (both are live benchmark work on the box right now) — don't
start until both are in `done/`. (Status as of this update: M-049 done;
M-047 still in progress.)

## Plan
1. [ ] Confirm M-047 is done before touching anything (M-049 already is).
2. [ ] Try option 1 first (poolside's `laguna` branch + real DFlash draft
   model): clone `github.com/poolsideai/llama.cpp` branch `laguna`,
   attempt a Vulkan build (`GGML_VULKAN=ON`, matching this repo's
   existing Vulkan RADV toolbox build pattern) targeting gfx1151. If it
   builds, download `laguna-s-2.1-DFlash-BF16.gguf` from
   `poolside/Laguna-S-2.1-GGUF` and run the documented invocation. If the
   build fails, or builds but crashes/errors specifically in the
   DFlash/Vulkan code path (not a generic unrelated build issue), that's
   a clean "no" for this option — record the exact failure and move on
   rather than debugging someone else's unmerged fork indefinitely.
3. [ ] If option 1 works: real generation benchmark, measure tok/s and
   draft acceptance rate, compare against the 30.0 tok/s plain baseline
   AND against whatever DGX Spark numbers were cited (75+ tok/s) — be
   honest that different hardware means this is not a fair apples-to-
   apples target, just a reference point.
4. [ ] If option 1 is a bust, try option 2 (Laguna XS 2.1 as classic
   `-md` draft on stock llama.cpp — already on disk, zero additional
   download, zero custom build). Confirm it even loads (tokenizer
   compatibility unconfirmed) — a tokenizer/vocab mismatch is a clean,
   fast "no." If it loads, benchmark real tok/s + draft acceptance rate;
   a slow/heavy draft model can make things worse, not better.
5. [ ] Option 3 only if both above fail and there's still appetite for a
   long-shot — per its own description above, don't expect it to work.
6. [ ] Record whatever you find — including a clean negative result — as
   a catalog entry or at minimum a clear decision-log writeup. A "we
   tried X, it didn't work because Y" result is exactly as valuable to
   record as a win, given Chris explicitly framed this as an experiment.
7. [ ] Leave the box in a clean state when done — don't leave a
   half-working speculative-decoding config as anyone's active role, and
   don't leave a half-built custom Docker image cluttering things if
   option 1 doesn't pan out.

## Signals
<!-- signal: claude 2026-08-01T10:00Z — claiming, blocked on M-047/M-049 finishing first -->
<!-- signal: claude 2026-08-01T21:15Z — done, option 2 tested and negative -->

## Decision log

- 2026-08-01: Explicit scope from Chris for this session's work: option 1 (poolside's
  `laguna` fork, custom Vulkan build) is OFF LIMITS per a safety review denial —
  "building and running arbitrary external compiled code" without his sign-off. Did
  NOT clone, build, or attempt option 1 in any form. Worked option 2 only (Laguna XS
  2.1 as a classic `-md` draft on stock/trusted llama.cpp), per explicit instruction.
- 2026-08-01: Preflight confirmed clean before touching anything — `docker ps` showed
  no exclusive model-serving containers running, litellm `/model/info` showed all
  roles pointing at their existing targets (`coder`->qwen3.6-35b-a3b-mtp,
  `worker`->qwen3.5-122b-a10b-mtp, `judge`/`orchestrator`->glm-4.7-flash-judge,
  `vision`->qwen2.5-vl-7b-instruct, `laguna-s-2.1-118b-q4km` role pointing at its own
  service), no active downloads, no other benchmark/harness activity in flight. Host
  repo checkout had stale uncommitted drift (a redundant copy of the already-merged
  M-049 compose-service diff) — discarded it and fast-forward-pulled to sync with
  origin/main (11 commits behind) before doing any new work, per this repo's
  convention of working directly against the repo-root checkout.
- 2026-08-01: **Tokenizer/vocab compatibility between Laguna-S-2.1 and Laguna-XS-2.1
  is CONFIRMED COMPATIBLE** — the card's central open question. `-md
  <laguna-xs-2.1.gguf>` never produced a vocab-mismatch rejection across 5 separate
  container runs at 4 different context sizes. This rules out the "clean fast no"
  the card anticipated for a tokenizer mismatch.
- 2026-08-01: Real finding not anticipated by the card: `-md <draft.gguf>` alone does
  NOT engage speculative decoding on this llama.cpp build (`0e4a03622 (10154)`) —
  `--spec-type draft-simple` must also be passed explicitly (`--spec-type` defaults
  to `none`). First attempt silently loaded the draft model into memory without ever
  using it (no `draft_n`/`draft_n_accepted` in response timings, no "draft
  acceptance" log lines) — caught by comparing a misconfigured run against a
  correctly-configured one side by side.
- 2026-08-01: The base flags specified in the task (matching Laguna-S-2.1's existing
  compose service exactly, including `-c 131072`) do NOT fit in memory with a second
  full model added. At `-c 131072`: both GGUFs loaded, then KV-cache buffer
  allocation failed (`radv/amdgpu: Failed to allocate a buffer`, repeated 3x, domain
  4 / 1GiB size) and the container was SIGKILLed (exit 137) — consistent with OOM,
  not a driver bug. At `-c 16384`: harder crash (`vk::DeviceLostError`, exit 139)
  during load, before either KV cache finished initializing. This host's
  `mem_info_vram_total` sysfs value is a fixed 1GiB (Strix Halo APU convention; bulk
  GPU memory instead comes from the 126GB GTT pool carved from system RAM) — the
  plain single-model Laguna-S-2.1 baseline fits fine in this scheme; a second full
  (non-tiny) 33B/3B-active model plus its own KV cache does not, at full context.
  No `--ctx-size-draft`-equivalent flag exists on this build to give the draft model
  a smaller independent context (checked via `--help`) — `-c` is shared. `-c 8192`
  was the highest value that loaded and served requests stably in this session (not
  exhaustively bisected between 8192 and 16384).
- 2026-08-01: **Real benchmark result, negative.** Even at the reduced `-c 8192`
  context (already a real handicap vs. the 131072-context plain baseline), measured
  generation throughput was 16.9-28.1 tok/s across 4 fresh (non-cache-hit) prompts —
  short-context avg ~23.3 tok/s (samples: 28.12, 20.85, 21.02), long-context
  (7090 prompt tokens) 16.88 tok/s. **This is below the existing plain Laguna-S-2.1
  baseline of 30.0 tok/s at every point measured**, despite draft acceptance rates
  of 40.8-72.4% (not low in absolute terms). Laguna XS 2.1 (33B total/3B active) is
  too heavy a draft model to pay for itself against this target — consistent with
  the card's own stated risk going in ("XS is a full capable model, not a
  purpose-built tiny draft"). Full methodology, fingerprints, and per-sample data
  recorded in `catalog/builds/laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-speculative-xs.yaml`
  (status: `TESTED_NOT_VIABLE`).
- 2026-08-01: **Why moving to done**: Option 2 (the only in-scope option for this
  session) was tested hands-on end to end — tokenizer compatibility confirmed real,
  speculative decoding confirmed actually engaged (not just configured), real
  generation throughput measured at multiple context depths, and the result is an
  honest, well-evidenced negative (slower than the plain baseline despite decent
  draft acceptance, plus a hard memory ceiling forcing a much smaller context than
  the baseline uses). Recommend continuing to serve Laguna-S-2.1 plain. Options 1
  and 3 remain untried (1 is explicitly off-limits without further sign-off from
  Chris; 3 was never reached and per its own description in this card is a
  long-shot). Host confirmed restored to pre-task state: all 5 ad-hoc test
  containers stopped and removed, no stray containers, litellm role targets
  unchanged, no compose/docker-compose.yml changes made (this build was
  intentionally kept out of compose entirely, given the negative result).

## Handoff notes

- If option 1 (poolside's `laguna` fork + real DFlash draft, Vulkan build) is ever
  authorized, it remains untried and is the most promising remaining candidate per
  this card's own prior research — see the Context section above.
- Option 3 (Laguna-S-2.1-DFlash checkpoint as a plain classic `-md` draft) remains
  untried; per its own description, unlikely to work given its custom
  `DFlashLagunaForCausalLM` architecture, but was never actually attempted.
- If a genuinely tiny (not full-capability) draft model for Laguna-S-2.1 ever
  becomes available (e.g. a purpose-built <1B draft, or an MTP-tensor build like
  the qwen3.6-35b-a3b/qwen3.5-122b-a10b sibling builds in this repo), classic
  speculative decoding is worth revisiting — the mechanism itself works correctly
  on this box/image (`--spec-type draft-simple`, confirmed both models' tokenizers
  compatible); it's specifically Laguna-XS-2.1's weight/size class that made it a
  net loss here, not the speculative-decoding mechanism itself.
