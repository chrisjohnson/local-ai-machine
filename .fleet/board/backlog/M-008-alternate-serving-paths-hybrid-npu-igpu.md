---
id: M-008
title: Alternate serving paths and hybrid NPU+iGPU execution
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-005]
---

# M-008 — Alternate serving paths and hybrid NPU+iGPU execution

## Context

Ported from README.md §8 Phase 5, Task 5.6 (2026-07-26, long section —
condensed here, see README's own text for full narrative/dates if needed).
This machine's **XDNA NPU sits completely idle** right now — everything runs
on the iGPU (RDNA3.5/gfx1151) via vLLM. Research so far has surveyed several
alternate serving paths with mixed results:

- **Lemonade Server — researched and closed out, not worth pursuing.**
  Its NPU+iGPU "Hybrid Mode" is Windows-only per Lemonade's own FAQ; the
  Linux story is just "use vLLM's experimental ROCm backend," which this
  project already runs. Doesn't touch the idle NPU. Revisit only if a new
  Linux-native NPU/hybrid tool surfaces.
- **Ollama — now working, but not the benchmark-of-record.** Wired into
  compose (`ollama/ollama:0.17.7`, then the plain non-`-rocm` tag once a
  Vulkan fix was found), GPU-verified. Real gotchas found along the way:
  ROCm backend crashes outright on this chip (`cudaMalloc failed: out of
  memory` despite <200MiB actually in use — a real ROCm bug, not a memory
  shortage); the fix is `OLLAMA_VULKAN=1` + `HIP_VISIBLE_DEVICES=-1` +
  `ROCR_VISIBLE_DEVICES=-1` on the **plain `ollama/ollama:0.17.7` tag**
  (the `-rocm` tag doesn't bundle Vulkan libs at all, falls through to CPU
  instead). Even working, Ollama is ~5.4-5.7x slower than llama.cpp direct
  for MoE models (only ~17% slower for the one dense model tested) — Go
  scheduling-layer overhead, not a GPU problem. A separate, more relevant
  finding for **future** re-checks: Ollama versions ≥0.30 have an open
  Strix-Halo VRAM-detection regression on the ROCm backend
  (`ollama/ollama#16462`, still open as of 2026-07-22) — the corroborated
  workaround if Ollama is revisited on a newer release is the **Vulkan
  image + `OLLAMA_IGPU_ENABLE=1`**, not `-rocm`.
- **llama.cpp direct (Vulkan/RADV) — the actual benchmark-of-record engine.**
  `kyuz0/amd-strix-halo-toolboxes:vulkan-radv`, GPU-verified
  (`llama-cli --list-devices` correctly detects the Radeon 8060S/RADV
  GFX1151). Consistently faster than Ollama, and the only path that exposes
  MTP support ([[M-007]]).
- **`llama-server` concurrent/parallel-serving benchmark — a real, confirmed
  gap, good candidate for the next full re-run pass.** Every existing
  llama.cpp number in this project is single-stream (`llama-bench`,
  `n_parallel=1`) only — there's no c1/c8-style concurrent comparison
  against vLLM anywhere in this repo, despite `llama-server` supporting
  `-np/--parallel`, `-cb/--cont-batching`, `-kvu/--kv-unified`. **Real
  wrinkle**: an open llama.cpp bug (`ggml-org/llama.cpp#25992`) causes
  cross-request response corruption under `-np N --kv-unified`, but it's
  bisected to the HIP/ROCm path specifically — this toolbox is already
  Vulkan, so it shouldn't hit directly. A second, older RADV-Vulkan
  concurrent-slot-hang report (`ggml-org/llama.cpp#20906`) exists too,
  auto-closed for staleness but not confirmed fixed — any real concurrency
  benchmark here should verify output correctness under load, not just
  raw tok/s.
- **FastFlowLM — a genuinely new, real Linux-native path to the idle NPU**,
  found 2026-07-24. Actively maintained, explicit Strix Halo support,
  native Linux support since March 2026. Compatibility confirmed on this
  machine (kernel 6.18.39 meets the 6.18.4+ minimum, `amdxdna` module
  already loaded, `/dev/accel0` exists). **Real blocker**: this machine has
  `amd_iommu=off` explicitly set in `configuration.nix`
  (`boot.kernelParams`, part of the original iGPU-memory-reservation
  tuning), and FastFlowLM requires IOMMU enabled. Best current cost
  estimate for enabling it: kyuz0's own toolboxes README cites **5-12%
  slower** than `amd_iommu=off` (any IOMMU-enabled mode, including
  `iommu=pt`) — a real, non-trivial cost, plus it requires a full **reboot**
  (kernel boot params only take effect at boot), interrupting the whole
  running production stack. **Deferred 2026-07-24, Chris's explicit call:
  "decide later."** Also worth re-checking against current firmware: a
  known Ubuntu 25.10 firmware/driver mismatch bug is open upstream
  (`amd/xdna-driver#1219`).
- Other backends surveyed and ruled out: SGLang (no official ROCm support
  for gfx1151, only an unproven community-patched image), MLC-LLM (no
  gfx1151 evidence), ExLlamaV2/TabbyAPI (no AMD support at all).
- Standing rule still applies: pulling a new model for Ollama or any other
  backend is a "new model download" and needs the same two-step check-in
  (present candidate, then a separate explicit go-ahead) — installing or
  evaluating the serving stack itself (no model weights) doesn't need that
  gate.

## Plan
<!-- ordered checklist -->
1. [ ] Pick up the `llama-server` concurrent-serving benchmark (`-np N`,
   with a correctness check under load, not just tok/s) — flagged as the
   strongest immediate candidate for the next full benchmark re-run pass.
2. [ ] Revisit the `amd_iommu=off` → FastFlowLM tradeoff with Chris when it
   comes up again (his call to defer, not this card's to force) — if
   revisited, re-check `amd/xdna-driver#1219` against current firmware
   first.
3. [ ] If Ollama is ever revisited, use a current release with the Vulkan
   image + `OLLAMA_IGPU_ENABLE=1`, not `-rocm`, per the corroborated
   workaround for `ollama/ollama#16462`.
4. [ ] Keep surveying for any new Linux-native NPU/hybrid tool during
   routine research ([[M-005]]) — this list isn't exhaustive.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 5, Task 5.6 into a fleet
  card during the fleet-bootstrap backlog migration; condensed from
  README's long-form narrative but kept the concrete technical specifics
  (exact env vars, bug IDs, the IOMMU cost numbers) since those are load-
  bearing for whoever picks this up next.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started as a fleet card. Ollama and llama.cpp-direct setup are already
functional (see Context) — the two genuinely open threads are the
`llama-server` concurrency benchmark (no code/infra blocker, just hasn't
been run) and the FastFlowLM/IOMMU tradeoff (deliberately deferred, needs
Chris before touching boot params).
