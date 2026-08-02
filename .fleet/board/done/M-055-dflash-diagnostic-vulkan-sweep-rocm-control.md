---
id: M-055
title: DFlash diagnostic — Vulkan parameter sweep + ROCm control build (Laguna-S-2.1)
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-01T23:55:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-050, M-052, M-053]
---

# M-055 — DFlash diagnostic: Vulkan sweep + ROCm control

## Context
M-053 left one genuine open question: the fork's DFlash draft acceptance is
10-19% on our Vulkan build, vs the 73.5-90.6% the community measured on the
same fork built with ROCm/HIP. Chris asked what paths remain; the answer was
two bounded diagnostics that decide whether debugging the fork's Vulkan
DFlash path is even worth it:

1. **Vulkan parameter sweep** (10-min class, uses the fork image already on
   the box): does acceptance move with `--spec-draft-n-max` (4/8/15) or with
   `-fa 0` vs `-fa 1`? If acceptance jumps to 40%+ under some config, the
   collapse is tunable, not a bug. If nothing moves, it's a real
   backend-divergence in the fork's Vulkan DFlash decode path.
2. **ROCm control build** (~30-60 min): build the same fork with
   `-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151` in the box's existing
   `kyuz0/strix-halo-ds4-toolbox:rocm-7.14` image and measure acceptance on
   THIS box. Two possible outcomes, both decisive:
   - Acceptance jumps to 70%+ on ROCm here → collapse is Vulkan-specific →
     time-boxed fork-debug becomes the candidate path (separate card, Chris's
     call on effort).
   - Acceptance stays low on ROCm too → the community's 73-91% was
     env/patch-specific; DFlash is a dead end on this hardware, stop.
   The ROCm control's primary metric is ACCEPTANCE, not tok/s — the community
   numbers show its throughput (19-26) already loses to our 30 tok/s Vulkan
   plain baseline.

Community FA constraint for the ROCm leg: flash attention crashes on gfx1151
under ROCm without rocWMMA (`flash_attn_ext_f16 ... no device code compatible
with HIP arch 1300`) — run the control with `-fa 0`, matching the config the
community's 73-91% acceptance was actually measured on.

## Plan
1. [x] Chris greenlit the two-step diagnostic ("sweep, then rocm control"),
   per the M-053 follow-up discussion (2026-08-01).
2. [x] Parameterize the existing DFlash bench script (n_max + fa + result-dir
   env overrides, M-053 defaults preserved) so configs are reproducible.
3. [x] Run the Vulkan sweep: n_max=8/fa1, n_max=4/fa1, n_max=15/fa0 (2 short
   prompts each; M-053's n15/fa1 run is the in-family control). Record
   acceptance + tok/s per config.
4. [x] Build the ROCm control image (fork @ 04b2b72, GGML_HIP=ON,
   AMDGPU_TARGETS=gfx1151) via a Dockerfile layered on
   rocm/dev-ubuntu-24.04:7.14.0-full.
5. [x] Run the ROCm control bench: n_max=15, `-fa 0`, same methodology.
   Result: DFLASH_LOAD_FAILED — the load hangs before any sample (evidence in
   catalog/raw/laguna-rocm-control-2026-08-02/). No acceptance measurement
   possible; the negative is recorded honestly.
6. [x] State the conclusion: is the Vulkan acceptance collapse a config
   effect, a tunable knob, or a backend-specific defect? → Block-size effect
   (tunable, but a wash — tops out at the 30 tok/s plain baseline); the ROCm
   control shows the community's ROCm numbers don't reproduce on this box
   (load fails entirely). Catalog family updated (build records, engine
   recipe, research note, raw evidence).
7. [x] Restore box to pre-task state (services, downloads, git clean), commit
   + push records.

## Signals

<!-- signal: big-pickle 2026-08-02T01:00Z — ROCm build unblocked after killing a hung `docker pull` of the base image that was deadlocking buildkit's FROM step; build re-downloading base itself (~7.77GB layer, throttled ~1MB/s), ETA 1-2h. Check build log /tmp/laguna-fork-rocm-build.log. -->

<!-- signal: big-pickle 2026-08-02T01:45Z — done. ROCm control: load fails on gfx1151 (draft ctx init + even plain load stalls); community's ROCm acceptance not reproducible here. DFlash dead end on both backends. Catalog committed; box restored. Serve plain @ 30 tok/s. -->

## Decision log
- 2026-08-01: card created from the M-053 follow-up. Scope is strictly the
  two bounded diagnostics; a fork-debug effort (if the ROCm control points
  that way) is deliberately NOT folded into this card — it would need its own
  time-box and Chris's explicit go-ahead, matching M-053's greenlight pattern.
- 2026-08-02 (sweep complete, both rounds; raw JSON under
  catalog/raw/dflash-sweep-2026-08-02/). The "acceptance collapse" is a
  BLOCK-SIZE effect, not a fixed Vulkan defect — and not FA-related. The
  fork's DFlash is block-diffusion (all-or-nothing per block); at
  --spec-draft-n-max 15, whole 15-token blocks almost never pass. Sweep
  (Vulkan fork image, -c 131072 full context, -fa 1 unless noted, 2 short +
  1 long prompt each):

  | config | short acc | short tok/s | long acc | long tok/s |
  |---|---|---|---|---|
  | n15 fa1 (M-053) | 10-19% | 8.0-11.5 | 11.4% | 7.9 |
  | n8 fa1 | 17-18% | 9.2-9.5 | 26.4% | 11.3 |
  | n6 fa1 | 23-27% | 21.2-23.1 | 27.2% | 20.9 |
  | n4 fa1 | 31-38% | 24.8-27.1 | 40.1% | 25.9 |
  | n3 fa1 | 39-49% | 27.1-30.9 | 50.2% | 27.4 |
  | n2 fa1 | 48-55% | 27.7-30.1 | 53.3% | 26.7 |
  | n15 fa0 | 10-10.4% | 7.5-7.7 | 12.8% | 6.2 |

  Findings: (a) -fa 0 makes everything WORSE, so flash attention is not the
  corruption source — rule it out. (b) acceptance rises monotonically as
  block size shrinks (10-19% at n15 -> 48-55% at n2), and throughput follows
  (7.9-11.5 -> 26.7-30.9 tok/s), a ~2.7-3.2x improvement. (c) BUT the
  optimum (n3) lands exactly AT the plain 30.0 tok/s baseline — best single
  sample 30.9 tok/s, long-context n3 = 27.4 tok/s vs plain long 27.42 tok/s
  (M-053-era plain baseline 30.93 short / 27.42 long). Draft overhead (a
  full 2GB diffusion-draft forward pass per block step) cancels the
  acceptance gain. INTERIM CONCLUSION: DFlash-on-Vulkan is tunable but a
  wash vs plain decoding — it matches, does not beat, the 30 tok/s baseline.
  The 73-91% community acceptance at n15 on ROCm remains unexplained and is
   the precise thing the ROCm control (now building) targets.
- 2026-08-02 (ops): a manual `docker pull rocm/dev-ubuntu-24.04:7.14.0-full`
  run in parallel with the build HUNG (~30 min, zero progress, no TCP) and
  deadlocked the build's `[1/8] FROM` (buildkit waits on the same content
  store the pull holds). Lesson: do NOT pre-pull a base image in parallel
  with a build of the same image — let buildkit fetch it itself; if a
  parallel pull is ever needed, it must finish before the build starts.
  After killing the pull, the build resumed its own download and progressed.
- 2026-08-02 (ROCm control, decisive): image `local-ai-machine/llamacpp-
  laguna-fork:rocm-7.14` built and smoke-tested (ldconfig fix for the
  libhipblas.so.3 runtime miss — ROCm 7.14 libs live under
  /opt/rocm/core-7.14/lib). The control bench at the community config (n15,
  `-fa 0`, -c 131072) FAILED TO LOAD: the memory-fit probe errors
  ("dflash requires ctx_other to be set" -> "failed to create llama_context
  from model"), then the real load hangs ~551MiB RSS, no output for 7+ min.
  Follow-up probes: the draft alone can't init standalone (ctx_other is
  spec-mode-only — expected), and even a PLAIN no-draft load of the 68GB
  model stalls after weight paging (~51GiB RSS, CPU spin, SIGTERM-immune).
  => The ROCm llama.cpp path is broken-in-effect on gfx1151 on this box
  (consistent with the documented-broken ollama-rocm-0177); the community's
  73-91% ROCm acceptance numbers are NOT reproducible here. Verdict closes
  the DFlash investigation: no backend serves DFlash at a throughput
  advantage on this hardware. Recommendation stands: serve Laguna-S-2.1
  plain (30.0 tok/s, full 131072 context).
- 2026-08-02 (closeout): full catalog records committed (Vulkan build record
  sweep table, ROCm build record, ROCm engine recipe, research note, raw
  evidence in catalog/raw/laguna-rocm-control-2026-08-02/ and
  catalog/raw/dflash-sweep-2026-08-02/). Box restored to pre-task state:
  standing laguna healthy, ds4 imatrix download resumed, no stray
  containers, repo clean.

## Handoff notes
- No PR — catalog/config-as-code committed directly to main per this repo's
  established workflow (M-053 precedent), box repo synced by pull.
- Recommendation for Chris: serve Laguna-S-2.1 plain (30.0 tok/s, full
  131072 context). DFlash is a dead end on this hardware on both Vulkan and
  ROCm; all M-050 speculative-decoding options are now resolved. Nothing
  else pending from this card.

