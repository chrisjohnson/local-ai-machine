---
id: M-053
title: Build poolside's llama.cpp fork (branch laguna) with Vulkan for real DFlash speculative decoding
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-01T22:57:00Z
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
1. [x] Get Chris's explicit go-ahead at the time this is actually picked
   up — don't assume this card's mere existence in the backlog is
   sufficient authorization to start building/running the fork.
   (GRANTED 2026-08-01 via direct request to reopen and proceed.)
2. [x] Clone `github.com/poolsideai/llama.cpp`, branch `laguna`.
   (fork head 04b2b72cb54048ead292884adbe11f284e3ec950)
3. [x] Attempt a Vulkan build (`GGML_VULKAN=ON`, matching this repo's
   existing Vulkan RADV toolbox build pattern) targeting gfx1151. If the
   build fails, or builds but crashes/errors specifically in the
   DFlash/Vulkan code path (not a generic unrelated build issue), that's
   a clean "no" — record the exact failure and stop rather than debugging
   someone else's unmerged fork indefinitely.
   (BUILDS CLEANLY. Two bounded toolchain fixes in the Dockerfile — the
   kyuz0 toolbox image's dangling /usr/bin/ld alternative (fixed to
   ld.bfd) and a missing <cmath> include for GCC 15 in
   common/speculative.cpp:1091. Verified BUILD_OK; DFlash initializes and
   serves at the full -c 131072 context on Vulkan — no build/load failure,
   so the experiment proceeded to the benchmark.)
4. [x] If it builds: download `laguna-s-2.1-DFlash-BF16.gguf` (already
   confirmed real, see M-052) and run the documented invocation
   (`llama-server -m laguna-s-2.1-Q4_K_M.gguf -md laguna-s-2.1-DFlash-BF16.gguf
   --spec-type draft-dflash --spec-draft-n-max 15`). Known community
   issue to watch for: `dflash requires ctx_other to be set` — a
   community-written patch exists (Proton Drive link in M-050's decision
   log) if this recurs on a Vulkan build; verify what it actually changes
   before applying it blindly.
   (Ran as documented, -c 131072 full baseline context, --spec-type
   draft-dflash --spec-draft-n-max 15. The `dflash requires ctx_other to
   be set` issue did NOT recur on this build. Engine log confirmed
   `common_speculative_impl_draft_dflash: n_max=15, block_size=16,
   mask_token_id=12` and a full-context load.)
5. [x] If it works: real generation benchmark, measure tok/s and draft
   acceptance rate, compare against the 30.0 tok/s plain Vulkan baseline
   AND the ~18-26 tok/s ROCm community numbers. Record honestly either
   way — including a clean negative result, matching this session's
   established standard for this whole speculative-decoding investigation.
   (DECISIVE NEGATIVE. Real /v1/chat/completions timing, 3 short + 1
   long-context prompt (11,243 prompt tok): generation 7.98 / 8.52 /
   11.52 / 7.92 tok/s vs the 30.0 tok/s plain baseline — ~3.2x slower.
   DFlash draft acceptance collapsed to 10.4% / 12.0% / 18.6% / 11.4% vs
   the 73-91% the community measured on the same fork built with ROCm/HIP.
   The Vulkan target is fast; the DFlash diffusion-draft path on RADV is
   broken-in-effect — draft predictions don't align with the target. No
   crash, just a throughput regression. Per the plan, this is a clean
   "no" and was not debugged past the recorded result.)
6. [x] Record results as a catalog entry with full `benchmark_runs[]`
   fingerprints per `catalog/OPERATIONS.md`.
   (New family `catalog/builds/laguna-s-2.1-118b-q4km--llamacpp-laguna-fork-vulkan-dflash.yaml`
   + engine recipe `catalog/engines/llamacpp-laguna-fork-vulkan-v1.yaml`,
   full fingerprint: image digest, fork head, host kernel 6.18.39, Mesa
   25.3.6, repo commit 7d42fd3, concurrent-load, metrics window
   23:28:10Z-23:32:19Z.)

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
- Reopened and claimed (2026-08-01): that closure was a mistake — Chris
  did not intend to close this; the Vulkan-DFlash experiment is the one
  untried candidate and he has now explicitly greenlit building/running
  the poolside fork. This is the informed sign-off the card requires;
  plan item 1 marked done accordingly.
- RESULT (2026-08-01): clean negative, experiment complete. Fork builds
  cleanly with Vulkan (after the two bounded toolchain fixes), DFlash
  loads and serves at the full -c 131072 baseline context (the `ctx_other`
  community issue did not recur), but real generation is 7.9-11.5 tok/s
  vs the 30.0 tok/s plain baseline (3.2x slower) because draft acceptance
  collapses to 10-19% on RADV/Vulkan vs 73-91% on the community's ROCm/HIP
  build of the same fork. M-050's three speculative-decoding options are
  now all resolved as net negatives or nulls on this box: (1) this DFlash-
  on-Vulkan fork run — negative; (2) classic draft with XS 2.1 — negative;
  (3) DFlash checkpoint as classic draft on stock llama.cpp — won't load.
  Recommendation: continue serving Laguna-S-2.1 plain at 30.0 tok/s / full
  131072 context; do not pursue speculative decoding for this model
  further. Host fully restored to pre-task state (standing laguna compose
  service healthy, ds4 imatrix download resumed, no stray containers, box
  worktree clean).

## Signals
<!-- signal: big-pickle 2026-08-01T22:57Z — claiming, building poolside's laguna fork with Vulkan per Chris's explicit greenlight -->
<!-- signal: big-pickle 2026-08-01T23:40Z — done. Clean negative: DFlash-on-Vulkan 7.9-11.5 tok/s vs 30.0 plain, draft acceptance 10-19% vs 73-91% ROCm. M-050's option 1 resolved; no further speculative-decoding work on Laguna warranted. Records in catalog/builds + catalog/engines. -->

## Handoff notes
- Test container used `local-ai-machine/llamacpp-laguna-fork:vulkan-radv`
  (digest sha256:98819738..., fork head 04b2b72, Mesa 25.3.6 in-image).
  Image is on the box and kept for reproducibility; there is deliberately
  NO compose service — nothing about this result is worth serving.
- Raw telemetry on the box at /tmp/laguna-dflash-results/ (short-0/1/2.json,
  long.json); run log /tmp/laguna-dflash-bench.log; build log
  /tmp/laguna-fork-build.log.
- One operational fix learned this session (already in the benchmark
  script): teardown must remove the ad-hoc test container BEFORE restoring
  the standing 68GB laguna service — the reverse order double-loads ~136GB
  and OOM-kills the test container (caught live, exit 137).
