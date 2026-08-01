---
id: M-053
title: Build poolside's llama.cpp fork (branch laguna) with Vulkan for real DFlash speculative decoding
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-050, M-052]
---

# M-053 — Build poolside's llama.cpp fork with Vulkan for real DFlash

## Context
This is **M-050's option 1**, split into its own card now that options 2
and 3 have their own separate tracking (M-050 itself is closed/done;
M-052 covers option 3). Chris's explicit correction: this option is
**not blocked** — it's the lowest priority of the three approaches, not
off-limits. Worth recording precisely why it needs deliberate handling
regardless of priority: it requires cloning, compiling, and running a
third-party fork of llama.cpp (`github.com/poolsideai/llama.cpp`, branch
`laguna`) — real, compiled, GPU-privileged code from a source found via
research, not something pre-vetted the way a model weights file (data,
not executable code) is. An earlier attempt to dispatch this to a
background sub-agent was denied by the safety classifier for exactly
that reason. That denial concerned *proceeding without Chris's explicit,
informed sign-off on building/running that specific third-party code* —
it is not a permanent block on the approach itself. Chris can authorize
this whenever he wants to actually pick it up; it doesn't need to be
"unblocked" so much as explicitly greenlit at the time it's worked.

Why it might be worth it despite being lowest priority: it's the only
option that could plausibly reproduce the real DFlash mechanism (the
thing that gets Laguna-S-2.1 to 75+ tok/s on a DGX Spark) rather than
either a null result (M-047-style, DS4's own MTP) or a net loss (M-050
option 2, classic draft with Laguna XS 2.1). Real community evidence
(Reddit r/LocalLLaMA thread, see M-050's decision log for the full
citation) shows this exact fork built with **ROCm/HIP** underperforms
this box's own already-proven Vulkan RADV baseline (18-26 tok/s ROCm vs.
30.0 tok/s our existing Vulkan baseline) — nobody has tried building it
with **Vulkan** instead, which is the one combination that could
plausibly beat our existing baseline rather than just match or lose to
it.

## Plan
1. [ ] Get Chris's explicit go-ahead at the time this is actually picked
   up — don't assume this card's mere existence in the backlog is
   sufficient authorization to start building/running the fork.
2. [ ] Clone `github.com/poolsideai/llama.cpp`, branch `laguna`.
3. [ ] Attempt a Vulkan build (`GGML_VULKAN=ON`, matching this repo's
   existing Vulkan RADV toolbox build pattern) targeting gfx1151. If the
   build fails, or builds but crashes/errors specifically in the
   DFlash/Vulkan code path (not a generic unrelated build issue), that's
   a clean "no" — record the exact failure and stop rather than debugging
   someone else's unmerged fork indefinitely.
4. [ ] If it builds: download `laguna-s-2.1-DFlash-BF16.gguf` (already
   confirmed real, see M-052) and run the documented invocation
   (`llama-server -m laguna-s-2.1-Q4_K_M.gguf -md laguna-s-2.1-DFlash-BF16.gguf
   --spec-type draft-dflash --spec-draft-n-max 15`). Known community
   issue to watch for: `dflash requires ctx_other to be set` — a
   community-written patch exists (Proton Drive link in M-050's decision
   log) if this recurs on a Vulkan build; verify what it actually changes
   before applying it blindly.
5. [ ] If it works: real generation benchmark, measure tok/s and draft
   acceptance rate, compare against the 30.0 tok/s plain Vulkan baseline
   AND the ~18-26 tok/s ROCm community numbers. Record honestly either
   way — including a clean negative result, matching this session's
   established standard for this whole speculative-decoding investigation.
6. [ ] Record results as a catalog entry with full `benchmark_runs[]`
   fingerprints per `catalog/OPERATIONS.md`.

## Signals

## Decision log
- Split out from M-050 as its own card (2026-08-01), reprioritized as
  "lowest priority of three, not blocked" per Chris's explicit
  correction — recorded here so the framing doesn't drift back to
  "off-limits" over time.
- Closed by Chris's direct request (2026-08-01): not picked up this
  round. Moved to done without executing the plan so the approach (and
  its explicit-greenlight requirement) stays tracked without lingering as
  open backlog.

## Handoff notes
