# Model + Engine + Config Catalog

**Purpose.** This is a durable, standalone reference of every unique **model + serving-engine + config** combination that has actually been proven to work (or proven *not* to work) on this specific machine (Bosgame M5, AMD Ryzen AI Max+ 395 "Strix Halo", gfx1151, 128GB unified LPDDR5X). "Proven working" means the combination actually loaded and produced real generated output — not just "downloaded" or "should work in theory." Broken combinations are included too, with the exact error and root cause, since knowing what doesn't work here is just as valuable as knowing what does.

This document exists so that a later, dedicated benchmark-comparison pass (flipping combinations on/off, one at a time, over multiple days) can be driven from a single source of truth instead of re-deriving exact flags/images/env-vars from `README.md`'s narrative decision log each time. **It does not decide or build the on/off mechanism itself** (docker-compose profiles, standalone scripts, whatever) — that's future work. This is purely the catalog of facts.

**This is a living document.** Add a new entry in the same shape every time a new combination is proven (or proven broken) on this hardware. Do not paraphrase or summarize away exact flags/env-vars/image tags — the whole point is that this doc is precise enough to reproduce a combination exactly, without re-reading `README.md`/`OPTIMIZATIONS.md` in full.

`README.md` and `OPTIMIZATIONS.md` remain the full narrative session history (decision logs, dead ends, reasoning-in-progress) — this doc is the distilled, structured extract of only the combinations that were actually run.

## House rules for future entries

**See `BENCHMARKING.md` for the authoritative, step-by-step benchmarking procedure** (pre-flight checks, per-engine invocation templates, teardown sequencing, recording convention) — this section only covers the catalog's own naming/entry conventions, not how to actually run a benchmark.

**Every future benchmark run (speed or coding-capability) MUST save its raw captured output into `results/`.** This means the exact command run plus the full raw stdout, or the tool's own native JSON output if it produces one (e.g. `scripts/coding_benchmark.py`'s JSON). Narrative-only numbers pasted into a catalog entry, `README.md`, or `OPTIMIZATIONS.md` are not acceptable as the sole record going forward — this is exactly the gap this pass exists to close (most existing speed-benchmark numbers in this project were captured only as prose, never as a saved file, and are honestly marked as such below).

- **Naming convention**: `results/<model-slug>--<engine>[-config-tag].{txt,json}` — e.g. `results/gemma-4-26b-a4b-it--llamacpp.txt`, `results/gemma-4-26b-a4b-it--ollama.txt`, `results/qwen3.6-35b-a3b--vllm.txt`.
  - The double-dash `--engine` suffix is deliberate and required for all new speed-benchmark artifacts, so they never collide with the existing bare `<model-slug>.json` coding-harness files already in `results/` (those were produced by `scripts/coding_benchmark.py` before this convention existed — **leave them as-is, do not rename them**).
- **The catalog entry's "Results file" field must link to the saved file** — a relative path from the repo root (e.g. `results/qwen3.6-35b-a3b.json`), or multiple paths if a run produced more than one artifact.
- This is not optional or a nice-to-have. It's a hard requirement for any future benchmarking work in this repo, precisely so results stay traceable to real files instead of relying on narrative claims that can drift from what was actually run.

Entry template (copy this for new entries):

```
### <Model> — <Engine> (<quant/format>)

- **Model**: <name> — `<HF repo>` (<quant/format>)
- **Engine**: <vLLM / llama.cpp direct / Ollama>
- **Image**: `<exact docker image:tag>`
- **Config required**: <env vars, CLI flags, device/group mappings — exact, not paraphrased>
- **Benchmark numbers**: <tok/s figures, date measured>
- **Results file**: <relative path(s), or "not preserved as a file — see README.md §<section> / OPTIMIZATIONS.md <date entry> for the narrative record">
- **Status**: WORKING / BROKEN / UNTESTED-BUT-DOWNLOADED
- **Gotcha**: <one-line non-obvious trick, if any>
```

---

## vLLM

All vLLM combinations use the same base image and device/group wiring unless noted otherwise:

- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest` (NOT `kyuz0/amd-strix-halo-vllm` — that tag doesn't exist; caught only when `docker compose up` failed with a real pull-access-denied error)
- **Devices**: `/dev/kfd:/dev/kfd`, `/dev/dri:/dev/dri`
- **group_add**: `video`, `render` (works by name on this image — its `/etc/group` defines both)
- **security_opt**: `seccomp:unconfined`
- **ipc**: `host`
- No `ROCM_PATH`/`HSA_OVERRIDE_GFX_VERSION` env vars needed — baked into the image at build time for gfx1151.
- No ENTRYPOINT — `vllm serve ...` runs headless directly, no interactive toolbox/distrobox wizard needed.
- Ports are bound `127.0.0.1:<port>:<port>` (loopback only) — NixOS's firewall has a built-in unconditional `ct status dnat accept` forward-chain rule that bypasses `allowedTCPPorts` entirely for any Docker-published port, so binding to loopback is the only real fix; reach via SSH tunnel or the LiteLLM gateway on 4000.
- **vLLM requires native (safetensors) format, not GGUF** — vLLM's GGUF support is limited/experimental and not used anywhere in this stack.

### Qwen3.6-35B-A3B — vLLM (bf16) — PRIMARY

- **Model**: Qwen3.6-35B-A3B — `Qwen/Qwen3.6-35B-A3B` (bf16, MoE, ~35B total / ~3B active)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**:
  ```
  vllm serve /models/qwen3.6-35b-a3b
  --served-model-name qwen3.6-35b-a3b
  --host 0.0.0.0 --port 8000
  --tensor-parallel-size 1
  --gpu-memory-utilization 0.70   # 0.70 when co-resident with the judge slot; standalone swap-in benchmarks use 0.90
  --dtype auto
  --trust-remote-code
  --max-num-seqs 64
  --enable-prefix-caching
  --max-model-len 131072
  --enable-auto-tool-choice
  --tool-call-parser qwen3_coder
  --reasoning-parser qwen3
  ```
  Standard devices/group_add/ipc as above. No AITER (`VLLM_ROCM_USE_AITER`, default False/unset) — tested enabling it, crashes (see Broken section).
- **Benchmark numbers** (2026-07-22/23, `vllm bench serve`, random dataset, `--ignore-eos`): c1 (2048in/512out) **11.91 tok/s** output, TTFT 3812/1680/36528ms (mean/median/p99), TPOT 76.69/71.37/143.24ms. c8 (2048in/256out, 100 prompts) **33.19 tok/s** output, TTFT 6213/5705/11069ms, TPOT 217.53/212.01/238.60ms. Footprint: 66.97 GiB weights, 18.49 GiB KV cache, 918,504 KV tokens, 7.01x max concurrency @131072. Coding harness (`scripts/coding_benchmark.py`, Tier A+B): **4/5** (2/3 Tier A — failed `palindrome` due to reasoning-budget exhaustion before a harness bugfix; result predates that fix, likely a conservative floor not re-run). Six-tier harness role-fitness not run against this model specifically (run against GLM-4.7-Flash-AWQ instead) but this model **failed `judge_incorrect`** (Tier J) when spot-checked — said `passes: true` on a subtly-buggy palindrome check.
- **Results file**: `results/qwen3.6-35b-a3b.json` (coding-harness Tier A/B, confirmed `model: qwen3.6-35b-a3b`, tier_a 2/3 + tier_b 2/2 matches the numbers above) and `docs/benchmark-report-2026-07-22.html` (speed/footprint numbers, confirmed present verbatim). The Tier J spot-check result is not preserved as a file — see the narrative in `OPTIMIZATIONS.md`.
- **Status**: WORKING — standing production primary as of 2026-07-24.
- **Gotcha**: gfx1151 (RDNA3.5) has no FP8 matrix-core hardware at all (FP8 WMMA starts at RDNA4) — this is why bf16 was chosen over any FP8 Qwen3-Next checkpoint (those fail to load / stall at Triton autotune on this exact toolbox+hardware, not just run slow). `--max-num-batched-tokens 16384` (double default) was tested and is a confirmed universal regression (-9.3% throughput, +65% TTFT) — do not use.

### Qwen3.5-4B — vLLM (bf16) — JUDGE

- **Model**: Qwen3.5-4B — `Qwen/Qwen3.5-4B` (bf16)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**:
  ```
  vllm serve /models/qwen3.5-4b
  --served-model-name qwen3.5-4b-judge
  --host 0.0.0.0 --port 8001
  --tensor-parallel-size 1
  --gpu-memory-utilization 0.20   # shares the GPU with vllm-primary at 0.70; two processes at 0.90 each would OOM the second on startup
  --dtype auto
  --trust-remote-code
  --max-num-seqs 64
  --enable-prefix-caching
  --max-model-len 131072
  --enable-auto-tool-choice
  --tool-call-parser qwen3_coder
  --reasoning-parser qwen3
  ```
- **Benchmark numbers** (2026-07-22): c1 **23.50 tok/s** output, TTFT 514/402/2210ms, TPOT 40.71/40.71/40.79ms. c8 **107.17 tok/s** output, TTFT 2060/2133/3496ms, TPOT 66.82/66.29/73.33ms. Footprint: 8.68 GiB weights, 13.6 GiB KV cache, 433,308 KV tokens, 3.31x concurrency @131072. Coding harness: **4/5** (2/3 Tier A, 2/2 Tier B — failed `expr_eval`).
- **Results file**: `results/qwen3.5-4b-judge.json` (coding-harness, confirmed `model: qwen3.5-4b-judge`, tier_a 2/3 + tier_b 2/2 matches) and `docs/benchmark-report-2026-07-22.html` (speed/footprint numbers, confirmed present verbatim).
- **Status**: WORKING — standing production judge/quick-tasks slot.
- **Gotcha**: `gpu-memory-utilization` is computed against *total* device memory, not free memory — this is why primary/judge percentages must sum sensibly rather than each defaulting to 0.90.

### Qwen3-Coder-Next-GPTQ-4bit — vLLM (GPTQ 4-bit) — 80B comparison tier

- **Model**: Qwen3-Coder-Next (80B total / ~3B active) — `btbtyler09/Qwen3-Coder-Next-GPTQ-4bit` (GPTQ 4-bit, ~50GB on disk)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: swapped in temporarily via `scripts/speed_benchmark_swap.sh` / `swap_model_start.sh` in place of the primary (not a standing compose service), `--gpu-memory-utilization 0.70`–`0.90`, `--max-model-len 131072`. Standard devices/group_add/ipc.
- **Benchmark numbers** (2026-07-22): c1 **14.34 tok/s** output, TTFT 2154/2214/2240ms, TPOT 65.63/65.63/65.76ms. c8 **26.13 tok/s** output, TTFT 7291/3774/15468ms, TPOT 278.63/276.84/309.65ms. Footprint: 46.49 GiB weights (smaller on disk than the 35B bf16 primary despite 2.3x the params — GPTQ-4bit beats bf16 for footprint), 40.42 GiB KV cache, 1,721,978 KV tokens, 13.14x concurrency @131072. Coding harness: **5/5 perfect** (3/3 Tier A, 2/2 Tier B).
- **Results file**: `results/qwen3-coder-next-gptq4bit.json` (coding-harness, confirmed `model: qwen3-coder-next-gptq4bit`, tier_a 3/3 + tier_b 2/2 matches) and `docs/benchmark-report-2026-07-22.html` (speed/footprint numbers, confirmed present verbatim).
- **Status**: WORKING — not currently a standing compose service; downloaded and proven via swap-in benchmark only.
- **Gotcha**: wins single-stream (c1) over the bf16 primary due to lower per-token memory-bandwidth cost of 4-bit weights, but loses at c8 where the primary's MoE aggregate throughput pulls ahead. `VLLM_ROCM_USE_AITER=1` tested on this model too — crashes identically to the primary (same `UnicodeDecodeError` in `torch._C._jit_get_operation`), confirming the AITER incompatibility is toolbox/hardware-level, not architecture-specific. `--max-num-batched-tokens 16384` also regresses this model (-8.3% throughput, +97.6% TTFT).

### Qwen3.5-122B-A10B-AWQ-4bit — vLLM (AWQ 4-bit) — 100B+ comparison tier

- **Model**: Qwen3.5-122B-A10B (122B total / ~10B active, hybrid mamba/attention) — `cyankiwi/Qwen3.5-122B-A10B-AWQ-4bit` (AWQ 4-bit, ~80GB on disk — bigger than raw param math suggests because it bundles a vision encoder)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: swapped in via `swap_model_start.sh qwen3.5-122b-a10b-awq4bit qwen3.5-122b-a10b-awq4bit 65536` with `SWAP_ENV_VARS='VLLM_USE_TRITON_AWQ=1'`. **Standing default (adopted 2026-07-23): do NOT pass `--enforce-eager`** — tested both ways, non-eager is a real (marginal) improvement on every metric with no regression, at the cost of a slower cold start (~410s vs ~350s from CUDA graph capture). `VLLM_USE_TRITON_AWQ=1` is still required — a genuine AWQ-kernel dependency, unrelated to eager mode. Served at `--max-model-len 65536` (bumped up from an earlier under-provisioned 32768 to meet a 64K-context requirement; confirmed it still fits memory-wise).
- **Benchmark numbers**: original enforce-eager baseline (2026-07-22): c1 **7.87 tok/s**, TTFT 3808/3799/4012ms, TPOT 119.88/119.88/120.02ms; c8 **16.05 tok/s**, TTFT 20383/24833/28927ms, TPOT 420.08/405.88/488.59ms. Non-eager re-test (2026-07-23): c1 **8.14 tok/s** (+3.4%), TTFT 3743/3582/6114ms, TPOT 115.77/115.78/115.84ms; c8 **16.28 tok/s** (+1.4%), TTFT 18583/20130/27444ms, TPOT 408.13/408.87/458.59ms. Footprint (no-eager, at 65536 context): 73.58 GiB weights, 35.21 GiB KV cache, 1,264,154 KV tokens, 19.29x concurrency. Coding harness: **5/5 perfect** (3/3 Tier A, 2/2 Tier B) despite being the slowest model tested.
- **Results file**: `results/qwen3.5-122b-a10b-awq4bit.json` (coding-harness, confirmed `model: qwen3.5-122b-a10b-awq4bit`, tier_a 3/3 + tier_b 2/2 matches) and `docs/benchmark-report-2026-07-22.html` (original enforce-eager baseline speed numbers, confirmed present verbatim). The non-eager re-test numbers (2026-07-23) are not preserved as a file — not present in either HTML report — see the narrative in `OPTIMIZATIONS.md`.
- **Status**: WORKING — no standing compose entry, swapped in ad hoc only.
- **Gotcha**: `--max-num-batched-tokens 16384` was tested here too and came out flat (0% throughput change) rather than a clear regression like every other model — the one exception in that sweep, though TTFT still worsened +12.9%, so the "don't adopt" conclusion still holds. The benchmark client itself is known to segfault on exit right after the c8 run completes — harmless (the server keeps running and the result JSON is already saved), but scripts must tolerate the nonzero exit code (`|| true` + check for the result file) rather than treating it as a failure.

### Qwen3.6-27B — vLLM (bf16) — dense comparison tier

- **Model**: Qwen3.6-27B (dense) — `Qwen/Qwen3.6-27B` (bf16)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: same tool/reasoning parser family as the 35B primary (`qwen3_coder`/`qwen3`), swapped in at `--max-model-len 131072`, `--gpu-memory-utilization 0.90` (standalone). No toolbox table entry exists for this exact model — flags copied from the 35B-A3B entry (same model generation).
- **Benchmark numbers** (2026-07-23): c1 **4.07 tok/s**, TTFT 4664/4524/6854ms, TPOT 236.86/236.82/237.30ms. c8 **17.91 tok/s**, TTFT 29202/35439/39890ms, TPOT 320.88/308.26/400.73ms. Footprint: 51.1 GiB weights, 57.65 GiB KV cache, 906,957 KV tokens, 6.92x concurrency @131072. Coding harness: **4/5** (2/3 Tier A, 2/2 Tier B).
- **Results file**: `results/qwen3.6-27b.json` (coding-harness, confirmed `model: qwen3.6-27b`, tier_a 2/3 + tier_b 2/2 matches) and `docs/benchmark-report-2026-07-23.html` (speed/footprint numbers, confirmed present verbatim).
- **Status**: WORKING.
- **Gotcha**: dense architecture (all 27B params active per token) makes it markedly slower than the MoE 35B-A3B primary despite fewer total params — the clearest dense-vs-MoE finding in this project. Also has a GGUF form tested separately via Ollama/llama.cpp — see those sections.

### Gemma-4-31B-it — vLLM (bf16) — dense comparison tier

- **Model**: Gemma-4-31B-it (dense) — `google/gemma-4-31B-it` (bf16)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: `--tool-call-parser gemma4 --reasoning-parser gemma4` (NOT the Qwen parser), `enforce_eager: False`, `--max-model-len 65536` (bumped from the toolbox's proven-but-conservative 32768 default to meet the 64K-context requirement; confirmed it still fit), `--gpu-memory-utilization 0.90` (standalone swap-in).
- **Benchmark numbers** (2026-07-23): c1 **3.23 tok/s**, TTFT 7601/7535/8712ms, TPOT 294.97/294.96/295.10ms. c8 **11.73 tok/s**, TTFT mean/median/**p99 31649/29955/59202ms(!)**, TPOT 543.18/519.59/689.89ms. Footprint: 58.9 GiB weights, 50.45 GiB KV cache, 274,525 KV tokens, 4.19x concurrency @65536 — the lowest concurrency headroom of any model tested. Coding harness: **5/5 perfect** (3/3 Tier A, 2/2 Tier B).
- **Results file**: `results/gemma-4-31b-it.json` (coding-harness, confirmed `model: gemma-4-31b-it`, tier_a 3/3 + tier_b 2/2 matches) and `docs/benchmark-report-2026-07-23.html` (speed/footprint numbers, confirmed present verbatim).
- **Status**: WORKING.
- **Gotcha**: slowest model tested all session, degrades hardest under concurrency (near-1-minute p99 TTFT at c8) — a real architectural cost of being dense at this size, not a config problem. Despite this, scored a perfect coding result — speed and coding capability do not correlate here.

### Gemma-4-26B-A4B-it — vLLM (bf16) — MoE comparison tier, best-performing model

- **Model**: Gemma-4-26B-A4B-it (MoE, ~26B total / ~4B active) — `google/gemma-4-26B-A4B-it` (bf16)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: `--tool-call-parser gemma4 --reasoning-parser gemma4`, `--max-model-len 65536`, `--gpu-memory-utilization 0.90` (standalone swap-in).
- **Benchmark numbers** (2026-07-23): c1 **20.85 tok/s**, TTFT 1531/1411/3412ms, TPOT 45.06/45.06/45.08ms. c8 **50.38 tok/s** — the fastest model tested all session, beating even the 35B-A3B primary. TTFT 5334/5502/10524ms, TPOT 134.30/133.24/157.64ms. Footprint: 48.5 GiB weights, 61.02 GiB KV cache, 1,328,176 KV tokens, **20.27x concurrency @65536** — best combination of small footprint and high concurrency headroom of any model tested (until GLM-4.7-Flash-AWQ later beat it at 28.10x). Coding harness: **5/5 perfect** (3/3 Tier A, 2/2 Tier B).
- **Results file**: `results/gemma-4-26b-a4b-it.json` (coding-harness, confirmed `model: gemma-4-26b-a4b-it`, tier_a 3/3 + tier_b 2/2 matches) and `docs/benchmark-report-2026-07-23.html` (speed/footprint numbers, confirmed present verbatim).
- **Status**: WORKING — strongest combined speed + coding result of any vLLM-served model tested; not promoted to production primary (Chris's call, deliberately deferred — testing/swapping ≠ changing the standing default).
- **Gotcha**: `--max-num-batched-tokens 16384` regresses this model too (-3.8% throughput, +74.4% TTFT) — same universal finding as every other model. Same GGUF file was separately benchmarked via llama.cpp direct and Ollama — see those sections; llama.cpp/GGUF decode speed does NOT rank this model the same way vLLM does (it comes out slower than GLM-4.7-Flash's GGUF there), a reminder that vLLM-serving fitness and raw GGUF decode speed aren't the same ranking.

### Qwen2.5-VL-7B-Instruct — vLLM (bf16) — vision/OCR, not a coding candidate

- **Model**: Qwen2.5-VL-7B-Instruct — `Qwen/Qwen2.5-VL-7B-Instruct` (bf16, ~16GB on disk)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: no Qwen3 tool-call parser (older generation, different template), `--max-model-len 32768` (deliberately below the 64K requirement — role is quick OCR/vision, not long-context coding). Will need `--limit-mm-per-prompt` flags once actually used for real vision workloads — not yet exercised in this stack.
- **Benchmark numbers** (2026-07-23): c1 **15.41 tok/s**, TTFT 1218/1071/3458ms, TPOT 62.65/62.65/62.66ms. c8 **79.25 tok/s** — fastest c8 throughput of any model tested, as expected for the smallest model (7B). TTFT 4234/3868/7820ms, TPOT 81.53/81.96/93.72ms.
- **Results file**: `docs/benchmark-report-2026-07-23.html` (speed numbers, confirmed present verbatim). No coding-harness JSON exists for this model — deliberately excluded from `scripts/coding_benchmark.py` as a vision/OCR specialist, not a coding candidate.
- **Status**: WORKING (served and benchmarked for speed) — NOT run through the coding-capability harness (excluded deliberately as a vision/OCR specialist, not a coding candidate).
- **Gotcha**: none of the KV-cache/concurrency figures were captured for this model (excluded from the Phase 3 optimization pass that captured real footprint numbers for the other comparison models) — "n/a" in the benchmark report, disk-size only.

### GLM-4.7-Flash-AWQ — vLLM (AWQ 4-bit) — best memory footprint of any vLLM model

- **Model**: GLM-4.7-Flash (MoE, ~30B total / ~3B active) — `QuantTrio/GLM-4.7-Flash-AWQ` (AWQ 4-bit, <20GB on disk)
- **Engine**: vLLM
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest`
- **Config required**: vLLM's dedicated `--tool-call-parser glm47 --reasoning-parser glm45` — both worked directly, no AWQ workaround needed (unlike the 122B tier's `VLLM_USE_TRITON_AWQ=1`). Healthy in ~190s at startup. Served at `--max-model-len 65536`.
- **Benchmark numbers** (2026-07-23): c1 **18.95 tok/s** output. c8 **30.19 tok/s** output — behind the 35B primary (33.19) and Gemma-4-26B-A4B (50.38), ahead of Qwen3.6-27B (17.91), 122B AWQ (16.05), Gemma-4-31B (11.73). TTFT scales 1353ms→7994ms (mean), TPOT 50ms→228ms, c1→c8. Footprint: **16.94 GiB weights, 92.87 GiB KV cache, 28.10x max concurrency @65536** — best of any model tested. Six-tier harness (`results/glm-4.7-flash-awq.json`): **10/13** — Tier A 3/3, Tier B 2/2, Tier P 2/2, Tier Q 2/2, Tier J 1/2, Tier D 0/1.
- **Results file**: `results/glm-4.7-flash-awq.json` (six-tier harness, confirmed `model: glm-4.7-flash-awq`, all six tier pass/total fields match the numbers above exactly). The c1/c8 speed/footprint numbers are **not preserved as a file** — confirmed absent from both `docs/benchmark-report-2026-07-22.html` and `docs/benchmark-report-2026-07-23.html` (this model postdates both reports) — see the narrative record in `OPTIMIZATIONS.md`'s 2026-07-23 entry.
- **Status**: WORKING — not a standing compose service, tested via swap-in only.
- **Gotcha**: Tier J loss (`judge_incorrect`) — missed the same subtly-buggy palindrome check the primary also missed, real evidence this isn't a reliable judge model without more scrutiny. Tier D loss (`debug_off_by_one`) — its "fix" used `range(len(orders) - 1)`, silently dropping the last element instead of following the explicit multi-turn instruction to keep it — a genuine multi-turn instruction-following carelessness, not a harness artifact (confirmed by the harness correctly grading the primary's differently-shaped fix as PASS in the same session). Not a drop-in primary replacement on speed, but the best memory-efficiency result of any model and a real MTP candidate (`glm4_moe_lite_mtp.py` ships a dedicated MTP variant in this vLLM build).

### GPT-OSS-120B — vLLM (MXFP4/bf16) — UNTESTED-BUT-DOWNLOADED

- **Model**: GPT-OSS-120B — `openai/gpt-oss-120b` (MXFP4 native weights, bf16 compute path — NOT `amd/gpt-oss-120b-w-mxfp4-a-fp8`, which quantizes activations to FP8 and can't run on this hardware)
- **Engine**: vLLM (intended)
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest` (planned)
- **Config required**: native `openai`/`openai_gptoss` tool-call/reasoning parsers (not yet exercised). Download requires `hfExclude = ["metal/*" "original/*"]` — the repo ships a 65GB Apple-Metal `metal/model.bin` that HF's non-Xet HTTP downloader refuses outright ("file too large... install hf_xet"), plus a redundant ~63GB `original/*.safetensors` full-precision copy; excluding both avoids ~128GB of unneeded/failing download.
- **Benchmark numbers**: none yet — never served.
- **Results file**: none — never benchmarked on this machine, nothing to link.
- **Status**: UNTESTED-BUT-DOWNLOADED — confirmed proven-compatible in kyuz0's own toolbox compatibility table at TP=1 (high confidence), but not yet actually run on this machine as of the last update to this catalog.
- **Gotcha**: a distinct GGUF repack of the same weights was separately benchmarked via llama.cpp direct — see that section (56.61 tok/s TG128, Vulkan RADV) — that number does NOT transfer to this vLLM/MXFP4 combination, which remains unmeasured.

### GPT-OSS-20B — vLLM (MXFP4/bf16) — UNTESTED-BUT-DOWNLOADED

- **Model**: GPT-OSS-20B — `openai/gpt-oss-20b` (MXFP4/bf16, ~13GB real weights)
- **Engine**: vLLM (intended)
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest` (planned)
- **Config required**: same parser family as GPT-OSS-120B. Same `hfExclude = ["metal/*" "original/*"]` requirement (this repo's `metal/model.bin` is 13.75GB — under whatever size threshold triggers the hard download failure, but still ~28GB of pure waste without the exclude).
- **Benchmark numbers**: none yet — never served.
- **Results file**: none — never benchmarked on this machine, nothing to link.
- **Status**: UNTESTED-BUT-DOWNLOADED — candidate to replace Qwen3.5-4B as judge/quick-tasks model.
- **Gotcha**: none observed yet (never run).

### North-Mini-Code-1.0-w4a16 — vLLM (W4A16) — UNTESTED-BUT-DOWNLOADED (download not yet started)

- **Model**: North-Mini-Code-1.0 (MoE, 30B total / 3B active) — `CohereLabs/North-Mini-Code-1.0-w4a16` (W4A16 weight-only, bf16 activations, ~18-20GB)
- **Engine**: vLLM (intended)
- **Image**: `docker.io/kyuz0/vllm-therock-gfx1151:latest` (planned)
- **Config required**: native vLLM `cohere_command4` tool-call parser (not yet exercised). No TP requirement.
- **Benchmark numbers**: none — never downloaded as of the last README update (codified in `configuration.nix`'s `models` list but download deliberately not started, per Chris's request to keep infra ready without spending bandwidth).
- **Results file**: none — not downloaded, never benchmarked, nothing to link.
- **Status**: UNTESTED-BUT-DOWNLOADED (more precisely: not-yet-downloaded) — zero direct Strix-Halo evidence exists yet for this exact checkpoint.
- **Gotcha**: same "theoretical fit, needs real testing" position GPT-OSS was in before it got tested.

---

## llama.cpp direct (`kyuz0/amd-strix-halo-toolboxes`)

General config for this engine family:

- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (Vulkan/RADV backend — the same project family behind the vLLM image and its benchmark data, ~0.59GB, no bundled model weights)
- **Devices**: `--device /dev/kfd --device /dev/dri`
- **group_add**: numeric GIDs, not names — `--group-add 26 --group-add 303` (this image, like the vLLM one, resolves `video`/`render` group names fine when passed as compose `group_add`; the numeric form is used in the raw `docker run` invocations shown in the actual benchmark commands)
- **GPU verified real**: `llama-cli --list-devices` → `Vulkan0: AMD Radeon 8060S Graphics (RADV GFX1151) (128000 MiB, 16389 MiB free)`.
- **Recommended flags** (toolbox's own README, confirmed in practice): `-fa 1` (flash attention on), `-lm none` (NOT the deprecated `--no-mmap` — that flag errors out on this build with "invalid parameter for argument"; `-lm none` / `--load-mode none` is the equivalent on this toolbox's `llama-bench` build), `-ngl 999` to offload all layers.
- MTP (multi-token-prediction) speculative decoding is merged into this toolbox's standard images (deprecating older `-mtp` variants) — the `--spec-type draft-mtp --spec-draft-n-max N` flags are real, confirmed directly against `--help` output and the upstream PR author's own invocation (llama.cpp PR #22673, merged 2026-05-16). Real caveats: `n_parallel=1` only (no concurrent request serving while using MTP); ROCm+tensor-parallel combinations reportedly crash — Vulkan is the safer backend. Reported speedups 1.8x-2.5x elsewhere (kyuz0's own `mtp.html`, calebcoffie.com), draft acceptance ~72% at depth 3. **Tested on this machine 2026-07-24 against Qwen3.6-27B-Q4_K_M.gguf (`unsloth/Qwen3.6-27B-GGUF`) — failed to load: "model doesn't contain MTP layers".** Root cause: unsloth ships MTP-head-bearing GGUFs as a separate repo (`unsloth/Qwen3.6-27B-MTP-GGUF`), not bundled with the plain quants already downloaded here. The mechanism itself is confirmed real and correctly wired in this toolbox build; reproducing an actual speedup number on this machine needs that separate MTP-tagged file, not yet downloaded. See the dedicated entry below and `results/qwen3.6-27b--llamacpp-mtp.txt`.

### GLM-4.7-Flash — llama.cpp direct (GGUF Q4_K_M) — fastest generation speed measured anywhere in this project

- **Model**: GLM-4.7-Flash — `unsloth/GLM-4.7-Flash-GGUF`, file `GLM-4.7-Flash-Q4_K_M.gguf` (~18.31GB)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv`
- **Config required**:
  ```
  docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
    -v /var/lib/ai-models/ollama-glm-4.7-flash:/models:ro \
    kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    llama-bench -m /models/GLM-4.7-Flash-Q4_K_M.gguf -ngl 999 -fa 1 -lm none
  ```
- **Benchmark numbers** (2026-07-24, `vllm-primary`/`vllm-judge` stopped to remove GPU contention): **81.3 tok/s prompt processing, 70.1 tok/s generation** (256-token generation, single prompt) — ~3.7x faster generation than the same model's vLLM+AWQ numbers (18.95/30.19 tok/s c1/c8). Caveat: not a pure backend-only ablation, since the quantization format also differs (Q4_K_M GGUF vs AWQ 4-bit) — some of the gap could be quant-format-driven, not purely backend-driven.
- **Results file**: not preserved as a file — `results/` contains no `llama-bench` output for this run; the numbers above are the narrative record. See `OPTIMIZATIONS.md`'s 2026-07-24 entry. Going forward this run would be saved as `results/glm-4.7-flash--llamacpp.txt` per the house rule above.
- **Status**: WORKING — this is the benchmark-of-record for this model (faster than both vLLM+AWQ and Ollama+Vulkan for the same underlying weights).
- **Gotcha**: this exact file was also the one that exposed the Ollama `gemma4`-unrelated crash bug used to isolate Ollama's ROCm-backend problem — see the Ollama section below. Same file loaded and generated successfully here on the first try, proving the crash was Ollama/ROCm-specific, not a problem with the file or host GPU.

### Gemma-4-26B-A4B-it — llama.cpp direct (GGUF Q4_K_M)

- **Model**: Gemma-4-26B-A4B-it — `unsloth/gemma-4-26B-A4B-it-GGUF`, file `gemma-4-26B-A4B-it-UD-Q4_K_M.gguf` (15.77 GiB on disk, 25.23B total params)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv`
- **Config required**:
  ```
  docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
    -v /var/lib/ai-models/ollama-gemma-4-26b-a4b-it:/models:ro \
    kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    llama-bench -m /models/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf -ngl 999 -fa 1 -lm none
  ```
- **Benchmark numbers** (2026-07-24, two runs): first run contaminated by a concurrent background `hf download` — pp512 1192.75 ± 11.10 tok/s, tg128 54.50 ± 0.29 tok/s. Clean re-run (verified no download activity via `ps aux`/`systemctl` before and after): **pp512 1251.33 ± 17.08 tok/s, tg128 53.96 ± 0.15 tok/s** — this is the benchmark-of-record. Contention cost: ~4.9% PP-only hit from a concurrent download; TG statistically unaffected (within run-to-run noise).
- **Results file**: not preserved as a file — `results/` contains no `llama-bench` output for either run (contaminated or clean); the numbers above are the narrative record. See `OPTIMIZATIONS.md`'s 2026-07-24 entry. Going forward this run would be saved as `results/gemma-4-26b-a4b-it--llamacpp.txt` per the house rule above.
- **Status**: WORKING.
- **Gotcha**: notably slower on both axes than GLM-4.7-Flash's llama.cpp numbers (81.3/70.1) despite Gemma-4-26B-A4B being the strongest vLLM/coding-benchmark performer tested — raw llama.cpp decode speed and vLLM-serving fitness don't necessarily rank models the same way. PP-sensitive benchmarks should pause the download queue first; TG-only comparisons are robust to background download contention.

### GPT-OSS-120B (MXFP4 GGUF repack) — llama.cpp direct — UNTESTED-BUT-DOWNLOADED

- **Model**: GPT-OSS-120B — `ggml-org/gpt-oss-120b-GGUF` (llama.cpp's own official native-MXFP4 GGUF repack of `openai/gpt-oss-120b` — a different artifact from the vLLM-format copy, not a lossier re-quant, ~59GB single file)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (planned)
- **Config required**: not yet run on this machine; kyuz0's own `results.json` reports `ngl=99`, flash attention on, no-mmap for this model.
- **Benchmark numbers**: not yet measured on this machine. Reference figure from kyuz0's raw `results.json` (same chip family, independently verified, not just the rendered page): ROCm 51-52 tok/s TG128, Vulkan AMDVLK 51.4, **Vulkan RADV 56.61 tok/s (fastest)** — real, reproducible, not cherry-picked, but not yet reproduced locally.
- **Results file**: none in this repo's `results/` — the reference figure is from kyuz0's own upstream `results.json` (an external artifact, not something captured by this project). Once actually run on this machine, save as `results/gpt-oss-120b--llamacpp.txt` per the house rule above.
- **Status**: UNTESTED-BUT-DOWNLOADED — download queued/in-progress as of the last README update (`llamacpp-gpt-oss-120b` in `configuration.nix`'s models list).
- **Gotcha**: none observed yet locally (never run here).

### Qwen3.5-122B-A10B (UD-Q5_K_XL GGUF) — llama.cpp direct — UNTESTED-BUT-DOWNLOADED

- **Model**: Qwen3.5-122B-A10B — `unsloth/Qwen3.5-122B-A10B-GGUF`, files under `UD-Q5_K_XL/` (3-shard GGUF)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (planned)
- **Config required**: not yet run on this machine.
- **Benchmark numbers**: not yet measured locally. Reference figure from kyuz0's raw `results.json`: **22.30 tok/s TG128 via Vulkan RADV** — a different quantization of a model already owned in vLLM AWQ form (measured 8.14-16.28 tok/s there), so this would be a real same-model cross-backend comparison once run.
- **Results file**: none in this repo's `results/` — the reference figure is from kyuz0's own upstream `results.json` (external artifact). Once actually run on this machine, save as `results/qwen3.5-122b-a10b--llamacpp.txt` per the house rule above.
- **Status**: UNTESTED-BUT-DOWNLOADED — download queued as of the last README update (`llamacpp-qwen3.5-122b-a10b`).
- **Gotcha**: none observed yet locally.

### NVIDIA-Nemotron-3-Super-120B-A12B (UD-Q4_K_XL GGUF) — llama.cpp direct — UNTESTED-BUT-DOWNLOADED

- **Model**: NVIDIA-Nemotron-3-Super-120B-A12B (hybrid Mamba-2+MoE+attention) — `unsloth/NVIDIA-Nemotron-3-Super-120B-A12B-GGUF`, files under `UD-Q4_K_XL/` (3-shard GGUF)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (planned)
- **Config required**: not yet run on this machine.
- **Benchmark numbers**: not yet measured locally. Reference figure from kyuz0's raw `results.json`: **14.86 tok/s TG128** — new model, not otherwise in this project's lineup.
- **Results file**: none in this repo's `results/` — the reference figure is from kyuz0's own upstream `results.json` (external artifact). Once actually run on this machine, save as `results/nvidia-nemotron-3-super-120b-a12b--llamacpp.txt` per the house rule above.
- **Status**: UNTESTED-BUT-DOWNLOADED — download queued as of the last README update (`llamacpp-nemotron-3-super-120b`).
- **Gotcha**: none observed yet locally.

### MiniMax-M2.7 (UD-Q3_K_S GGUF) — llama.cpp direct — UNTESTED-BUT-DOWNLOADED

- **Model**: MiniMax-M2.7 (228.69B total params) — `unsloth/MiniMax-M2.7-GGUF`, files under `UD-Q3_K_S/` (3-shard GGUF)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (planned)
- **Config required**: not yet run on this machine.
- **Benchmark numbers**: not yet measured locally. Reference figure from kyuz0's raw `results.json`: **31.08 tok/s TG128** — confirmed single-node viable (`rpc:false` in the source benchmark data), unlike an earlier MiniMax variant already disqualified in this project for requiring TP=2/multi-GPU.
- **Results file**: none in this repo's `results/` — the reference figure is from kyuz0's own upstream `results.json` (external artifact). Once actually run on this machine, save as `results/minimax-m2.7--llamacpp.txt` per the house rule above.
- **Status**: UNTESTED-BUT-DOWNLOADED — download queued as of the last README update (`llamacpp-minimax-m2.7`).
- **Gotcha**: none observed yet locally.

### Qwen3.6-27B — llama.cpp direct (GGUF Q4_K_M)

- **Model**: Qwen3.6-27B (dense) — `unsloth/Qwen3.6-27B-GGUF`, file `Qwen3.6-27B-Q4_K_M.gguf` (15.65 GiB on disk, 26.90B params)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv`
- **Config required**:
  ```
  docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
    -v /var/lib/ai-models/ollama-qwen3.6-27b:/models:ro \
    kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    llama-bench -m /models/Qwen3.6-27B-Q4_K_M.gguf -ngl 999 -fa 1 -lm none
  ```
- **Benchmark numbers** (2026-07-24, `vllm-primary`/`vllm-judge` stopped to remove GPU contention, download queue paused first): **pp512 342.55 ± 14.41 tok/s, tg128 12.75 ± 0.03 tok/s**. Markedly slower generation than the dense-tier comparison already in this catalog would suggest at a glance — Gemma-4-26B-A4B-it (an MoE model, not dense) hit tg128 53.96 tok/s on the same engine/backend; this dense 27B model's generation speed is roughly a quarter of that, consistent with the dense-vs-MoE gap already observed in the vLLM entries above.
- **Results file**: `results/qwen3.6-27b--llamacpp.txt` (exact command + full raw stdout table, confirmed present verbatim).
- **Status**: WORKING.
- **Gotcha**: same underlying GGUF file also has a proven Ollama combination (see Ollama section below) and an untested MTP speculative-decoding path (see the Qwen3.6-35B-A3B / MTP entry immediately below, which now only concerns the 35B-A3B plain-decode case and the MTP experiment for both models — this 27B plain-decode number is proven above, no longer part of that placeholder).

### Qwen3.6-27B — llama.cpp direct (GGUF Q4_K_M) — MTP speculative decoding attempt — BROKEN (file lacks MTP head)

- **Model**: Qwen3.6-27B (dense) — `unsloth/Qwen3.6-27B-GGUF`, file `Qwen3.6-27B-Q4_K_M.gguf` (same file as the plain-decode entry above; 15.65 GiB on disk, 26.90B params)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv` (version 10107 / build `c0bc8591e` — same build used for the plain baseline)
- **Config required**: real flags discovered directly from `--help` output (per this session's hard-won lesson not to trust cold-AI-query flag names), confirmed against the upstream PR author's own invocation (`ggml-org/llama.cpp` PR #22673):
  ```
  docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
    -v /var/lib/ai-models/ollama-qwen3.6-27b:/models:ro \
    kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    llama-cli -m /models/Qwen3.6-27B-Q4_K_M.gguf -ngl 999 -fa 1 -lm none \
    --spec-type draft-mtp --spec-draft-n-max 3 \
    -p 'Write a short haiku about autumn.' -n 32 --no-conversation -v
  ```
  Note: `llama-bench` (used for the plain-decode baseline) has **zero** spec/draft/mtp flags at all — confirmed via `llama-bench --help | grep -iE 'draft|spec|mtp'` (no matches). Speculative-decoding flags exist only on `llama-server`/`llama-cli`, so an MTP trial can't reuse the exact `llama-bench` invocation used for the baseline.
- **Benchmark numbers**: **none — the model failed to load with MTP enabled.** Exact error from `llama_init_from_model`: `context type MTP requested but model doesn't contain MTP layers`. Server exits cleanly with code 1 rather than crashing or silently falling back to plain decode.
- **Results file**: `results/qwen3.6-27b--llamacpp-mtp.txt` (exact commands, full raw output including the error, and the root-cause investigation).
- **Status**: **BROKEN — for this specific file only, not the mechanism.** The `--spec-type draft-mtp` flag and MTP mechanism itself are real and correctly implemented in this exact toolbox build (confirmed against the upstream PR's own author invocation, which matches ours exactly). The failure is that this specific GGUF (from the plain `unsloth/Qwen3.6-27B-GGUF` repo) does not ship MTP head tensors.
- **Gotcha**: unsloth publishes MTP-head-bearing GGUFs as a **separate HF repo** — `unsloth/Qwen3.6-27B-MTP-GGUF` — confirmed to exist via the HF API, not bundled as extra files alongside the plain quants already on this box. Reproducing a real MTP speedup number for this model would require downloading that separate repo (a new-model-download decision under this project's standing check-in rule — not done here per explicit instruction not to download anything new this session). The community reference numbers cited elsewhere in this project (kyuz0's `mtp.html`, calebcoffie.com, ~1.8x-2.5x speedup, Qwen3.6-27B Q4_K_M 11.7→21.2 tok/s) almost certainly used the dedicated MTP-tagged GGUF, not the plain quant — this is a real, actionable explanation for why those numbers can't be reproduced with the files currently on this machine.

### Qwen3.6-35B-A3B — llama.cpp direct (GGUF Q4_K_M) — fastest tg128 of any MoE GGUF tested so far

- **Model**: Qwen3.6-35B-A3B (MoE, ~35B total / ~3B active) — `unsloth/Qwen3.6-35B-A3B-GGUF`, file `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (20.60 GiB on disk per `llama-bench`, 34.66B params)
- **Engine**: llama.cpp direct
- **Image**: `docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv`
- **Config required**:
  ```
  docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
    -v /var/lib/ai-models/ollama-qwen3.6-35b-a3b:/models:ro \
    kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    llama-bench -m /models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf -ngl 999 -fa 1 -lm none
  ```
- **Benchmark numbers** (2026-07-24, download queue paused first — 7 units found "activating", stopped for the duration and resumed after; `vllm-primary`/`vllm-judge` already inactive at the time of this specific run): **pp512 1075.81 ± 21.68 tok/s, tg128 63.43 ± 0.30 tok/s.** This is the fastest tg128 of any GGUF/llama.cpp-direct model tested so far in this project's Qwen3.6 family, and beats the sibling dense Qwen3.6-27B by nearly 5x (12.75 tok/s) — the clearest MoE-vs-dense active-param-count contrast measured via llama.cpp direct yet. Still behind GLM-4.7-Flash's 70.1 tok/s (a smaller ~3B-active MoE at a smaller total footprint) and Gemma-4-26B-A4B's 53.96 tok/s is beaten by this model, consistent with the "smaller active-param-count wins" pattern this hardware keeps rewarding.
- **Results file**: `results/qwen3.6-35b-a3b--llamacpp.txt` (exact command + full raw stdout table, confirmed present verbatim).
- **Status**: WORKING.
- **Gotcha**: MTP speculative-decoding test for this file remains untested — same MTP-head-missing risk flagged for the sibling Qwen3.6-27B file applies here too (unsloth ships MTP-bearing GGUFs as separate `-MTP-GGUF` repos, not bundled into the plain quant used here); not attempted this pass, still an open follow-up gated behind the new-model-download check-in rule.

---

## Ollama

General config for this engine family:

- **Base pattern**: `--device /dev/kfd --device /dev/dri`, bound `127.0.0.1:11434:11434` (loopback only, same reasoning as vLLM), `ollama_data` named volume at `/root/.ollama`, GGUF source mounted read-only at `/gguf-source` from `/var/lib/ai-models`.
- **group_add must use numeric GIDs, not names** on Ollama images — unlike the kyuz0 vLLM image, Ollama's own `/etc/group` doesn't define `video`/`render` names at all (`group_add: [video, render]` fails outright: `unable to find group render: no matching entries in group file`). Use `group_add: ["26", "303"]` (this host's actual `video`/`render` GIDs, confirmed via `getent group video render`).
- **Registration**: `scripts/ollama_register_model.sh <name> <gguf-filename> <ollama-model-name>` runs `ollama create` against a downloaded GGUF once its `.download-complete` marker exists.

### Ollama image-tag / backend-selection history (applies to all entries below)

- `ollama/ollama:0.17.7-rocm` — **BROKEN for real inference.** GPU *detection* at startup looked correct (`msg="inference compute" ... library=ROCm compute=gfx1151 ... type=iGPU total="125.0 GiB"`), but any actual chat/generate request crashed: `ggml_backend_cuda_buffer_type_alloc_buffer: ... cudaMalloc failed: out of memory` despite confirmed <200MiB of 124GiB actually in use (checked directly via `/sys/class/drm/card0/device/mem_info_{vram,gtt}_used`, `vllm-primary`/`vllm-judge` stopped too). Setting `OLLAMA_VULKAN=1` alone did NOT fix it on this tag — Ollama's backend picker still selected ROCm (the var makes Vulkan *available*, doesn't force it), and this image doesn't even bundle Vulkan libraries at all (confirmed: no `libvulkan`/`libggml-vulkan.so` anywhere in it) — hiding ROCm devices on this tag just falls through to CPU, not Vulkan. **Root cause**: real, upstream, chip-specific ROCm allocation bug (consistent with open issues `ollama/ollama#13589`, `#15336`).
- `ollama/ollama:0.17.7` (plain tag, NOT `-rocm`) — **WORKING**, this is the tag to use. Confirmed to bundle real Vulkan libs (`libvulkan_radeon.so`/RADV, `libggml-vulkan.so`). Requires all three of:
  ```
  OLLAMA_VULKAN=1
  HIP_VISIBLE_DEVICES=-1
  ROCR_VISIBLE_DEVICES=-1
  ```
  (`OLLAMA_VULKAN=1` alone is not sufficient — Ollama's backend picker ranks ROCm above Vulkan whenever any ROCm device is enumerable at all, regardless of this var; `HIP_VISIBLE_DEVICES=-1`/`ROCR_VISIBLE_DEVICES=-1` hide ROCm devices from discovery entirely, forcing fallthrough to Vulkan — from `ollama/ollama#14855`, a community workaround, not an official documented flag combo.) Startup log confirms real Vulkan selection: `library=Vulkan ... description="Radeon 8060S Graphics (RADV GFX1151)"`.
- Pin to **0.17.7 or earlier**, not `latest`/unqualified `:rocm` — `ollama/ollama#15336` (open) reports a regression where 0.18.x+ broke GPU detection that worked correctly on 0.17.7.
- **Real, measured downside**: even once working, Ollama+Vulkan is meaningfully slower than llama.cpp direct on the identical GGUF file — Ollama's Go wrapper/scheduling layer adds real overhead on top of the same underlying Vulkan/ggml engine. **Use Ollama for convenience/API-compatibility, not as the benchmark-of-record** — llama.cpp direct is that.

### GLM-4.7-Flash — Ollama (GGUF Q4_K_M, Vulkan)

- **Model**: GLM-4.7-Flash — same file as the llama.cpp entry, `GLM-4.7-Flash-Q4_K_M.gguf` (via `unsloth/GLM-4.7-Flash-GGUF`)
- **Engine**: Ollama
- **Image**: `ollama/ollama:0.17.7` + `OLLAMA_VULKAN=1` + `HIP_VISIBLE_DEVICES=-1` + `ROCR_VISIBLE_DEVICES=-1`
- **Config required**: registered via `scripts/ollama_register_model.sh`; group_add `["26", "303"]`; `127.0.0.1:11434:11434`.
- **Benchmark numbers** (2026-07-24, rough measurement, `vllm-primary` running concurrently so conservative/pessimistic, not a clean isolated test): **~13 tok/s** generation, vs. llama.cpp direct's clean **70.1 tok/s** for the same file — Ollama here is roughly 5.4x slower than llama.cpp direct for this exact model/file.
- **Results file**: not preserved as a file — this was a rough/manual timing observation, not a saved harness or benchmark-tool output. See `OPTIMIZATIONS.md`'s 2026-07-24 entry. Going forward this would be saved as `results/glm-4.7-flash--ollama.txt` per the house rule above.
- **Status**: WORKING (slow) — real chat completion succeeded (a full generated essay, not a crash).
- **Gotcha**: this was the model/file used to discover the whole ROCm-crash → Vulkan-workaround → wrong-image-tag saga above; the `-rocm` tag crashed on this exact file with the `cudaMalloc failed: out of memory` error before the plain tag + three-env-var combo was found to work.

### Gemma-4-26B-A4B-it — Ollama — BROKEN (architecture not supported by this Ollama build)

- **Model**: Gemma-4-26B-A4B-it — same file as the llama.cpp entry, `gemma-4-26B-A4B-it-UD-Q4_K_M.gguf` (via `unsloth/gemma-4-26B-A4B-it-GGUF`)
- **Engine**: Ollama
- **Image**: `ollama/ollama:0.17.7` + `OLLAMA_VULKAN=1` + `HIP_VISIBLE_DEVICES=-1` + `ROCR_VISIBLE_DEVICES=-1`
- **Config required**: registration succeeded fine (`ollama create` completed, `ollama list` shows `gemma-4-26b-a4b-gguf:latest`, 16GB) — the failure is only at inference time.
- **Benchmark numbers**: none — every generation request fails.
- **Status**: **BROKEN.** Exact error:
  ```
  llama_model_load: error loading model architecture: unknown model architecture: 'gemma4'
  llama_model_load_from_file_impl: failed to load model
  ```
  Root cause: Ollama 0.17.7's bundled ggml/llama.cpp build genuinely does not recognize the `gemma4` GGUF architecture tag — Gemma-4 postdates what this specific Ollama build's vendored inference engine supports. Confirmed via `docker logs ollama` that the full GGUF metadata (tensors, tokenizer, chat template) parses fine — the failure is specifically at the architecture-dispatch step, not a corrupt download or config error.
- **Results file**: none — every generation request fails, there is no benchmark output to save. The exact error text above is preserved in this entry and in `OPTIMIZATIONS.md`'s narrative record.
- **Gotcha**: this is a genuine version tradeoff, not a fixable config bug. A newer Ollama build likely supports `gemma4`, but jumping to 0.18.x+ reintroduces the GPU-detection regression (`ollama/ollama#15336`) on this exact chip. Flagged as an open, unresolved tradeoff (Vulkan/GPU-detection correctness on 0.17.7 vs newer-architecture support on 0.18.x+) rather than solved unilaterally. **llama.cpp direct is the only backend that can currently serve this exact file at all on this box** — for this specific model, Ollama isn't just slower, it's a hard blocker.

### Qwen3.6-27B — Ollama (GGUF Q4_K_M, Vulkan)

- **Model**: Qwen3.6-27B (dense) — same file as the llama.cpp entry, `Qwen3.6-27B-Q4_K_M.gguf` (via `unsloth/Qwen3.6-27B-GGUF`)
- **Engine**: Ollama
- **Image**: `ollama/ollama:0.17.7` + `OLLAMA_VULKAN=1` + `HIP_VISIBLE_DEVICES=-1` + `ROCR_VISIBLE_DEVICES=-1`
- **Config required**: registered via `./scripts/ollama_register_model.sh ollama-qwen3.6-27b Qwen3.6-27B-Q4_K_M.gguf qwen3.6-27b-gguf`; group_add `["26", "303"]`; `127.0.0.1:11434:11434`.
- **Benchmark numbers** (2026-07-24, download queue paused first; `vllm-primary`/`vllm-judge` were stopped during this session's earlier llama.cpp run and not yet restarted when this request ran, so this was also a GPU-contention-free measurement): a single `/api/generate` request returned `eval_count: 613`, `eval_duration: 57871769652` ns → **10.59 tok/s** generation. This is well below the llama.cpp-direct number for the same file (tg128 12.75 tok/s) — consistent with this project's standing finding that Ollama's Go wrapper/scheduling layer adds real overhead over the same underlying Vulkan/ggml engine, though the gap here (~17%) is much smaller than GLM-4.7-Flash's ~5.4x gap, and this was a single real-generation sample (with reasoning-mode `<think>` output inflating `eval_count`), not an averaged `llama-bench`-style run, so treat the two numbers as directionally comparable rather than a precise apples-to-apples ratio.
- **Results file**: `results/qwen3.6-27b--ollama.txt` (exact registration + curl command, full raw JSON response, confirmed present verbatim).
- **Status**: WORKING — real chat completion succeeded (full generated response with reasoning trace, not a crash). Confirms Qwen3.6 is a recognized architecture in this Ollama build, unlike Gemma-4's `unknown model architecture: 'gemma4'` failure on the same image/version.
- **Gotcha**: unlike the Gemma-4-26B-A4B Ollama entry above (a hard architecture-support blocker), this combination just works — no version-tradeoff caveat needed. `total_duration` (68.18s) includes model load time (`load_duration` 7.81s) since this was the first request after `ollama create`; a warm second request would show much lower total latency.

### Qwen3.6-35B-A3B — Ollama (GGUF Q4_K_M, Vulkan)

- **Model**: Qwen3.6-35B-A3B (MoE, ~35B total / ~3B active) — same file as the llama.cpp entry, `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (via `unsloth/Qwen3.6-35B-A3B-GGUF`)
- **Engine**: Ollama
- **Image**: `ollama/ollama:0.17.7` + `OLLAMA_VULKAN=1` + `HIP_VISIBLE_DEVICES=-1` + `ROCR_VISIBLE_DEVICES=-1`
- **Config required**: registered via `./scripts/ollama_register_model.sh ollama-qwen3.6-35b-a3b Qwen3.6-35B-A3B-UD-Q4_K_M.gguf qwen3.6-35b-a3b-gguf`; group_add `["26", "303"]`; `127.0.0.1:11434:11434`.
- **Benchmark numbers** (2026-07-24, download queue paused first, `vllm-primary`/`vllm-judge` already inactive at the time of this run): a single `/api/generate` request (first request after `ollama create`, so `total_duration` includes model load) returned `eval_count: 1511`, `eval_duration: 135177304222` ns → **11.18 tok/s** generation. This confirms Qwen3.6 is a recognized architecture on this Ollama build for the MoE variant too (same family as the now-proven dense 27B file) — no architecture blocker, unlike Gemma-4. Well below the llama.cpp-direct number for the same file (tg128 63.43 tok/s) — roughly a **5.7x gap**, much closer to GLM-4.7-Flash's ~5.4x Ollama-overhead gap than to the dense Qwen3.6-27B's comparatively narrow ~17% gap. This is a single real-generation sample (with reasoning-mode `<think>` output inflating `eval_count`), not an averaged `llama-bench`-style run.
- **Results file**: `results/qwen3.6-35b-a3b--ollama.txt` (exact registration + curl command, full raw JSON response, confirmed present verbatim).
- **Status**: WORKING — real chat completion succeeded (full generated response with reasoning trace, not a crash).
- **Gotcha**: this model's Ollama-overhead gap (~5.7x) is far larger than its dense sibling Qwen3.6-27B's (~17%) — consistent with a pattern now seen twice (GLM-4.7-Flash's ~5.4x vs Qwen3.6-27B's ~17%): Ollama's Go wrapper/scheduling overhead appears to cost MoE models proportionally much more than dense models on this hardware, though the exact mechanism (MoE routing overhead interacting badly with Ollama's scheduler, vs. some other confound) isn't isolated here — worth a dedicated investigation if Ollama's MoE performance ever needs to be relied on for real.

---

## Other serving paths — investigated, not viable, no working combination to catalog

Recorded here rather than omitted, since "doesn't work / not worth pursuing" is itself a proven fact worth keeping:

- **Lemonade Server** (lemonade-server.ai) — NPU+iGPU "Hybrid Mode" is **Windows-only** per the project's own FAQ (confirmed verbatim against the actual docs, not assumed from the earlier Reddit-sourced lead). On Linux, its own GPU story for this chip is just "use the experimental `vllm:rocm` backend" — i.e., the same vLLM already run here. Would not touch the idle NPU on this machine's actual OS. Closed out, not pursued further.
- **FastFlowLM** — a real, Linux-native, actively-maintained NPU-only inference engine (Strix Halo explicitly supported, native Linux since March 2026). Compatibility pre-checked on this exact machine: kernel 6.18.39 satisfies its 6.18.4+ minimum, `amdxdna` kernel module already loaded, `/dev/accel0` exists. **Blocked by a real, quantified tradeoff, not attempted**: requires IOMMU enabled, and this machine deliberately runs `amd_iommu=off` (part of the original iGPU-memory-reservation tuning) — enabling it costs a real, cited 5-12% iGPU performance hit (kyuz0's own toolboxes README, contributor @urbanswelt) and requires a full reboot, interrupting the whole production stack. **Deferred, Chris's explicit call ("decide later")** — not a technical dead end, just not yet attempted.
- **SGLang** — no official ROCm support for gfx1151 (open feature request `sgl-project/sglang#5131`); a community-patched image exists (`JeremiahM37/strix-halo-sglang`) but is unproven/non-upstream. Not attempted.
- **MLC-LLM** — no gfx1151 evidence found anywhere. Not attempted.
- **ExLlamaV2 / TabbyAPI** — no AMD/ROCm support at all, a hard dependency-level no. Not attempted.
- **"MLX Engine ROCm backend" claims** — traced to a real GitHub issue (`lemonade-sdk/lemonade#1642`) whose cited benchmark numbers come from a deleted account and a 404'd repo — fabricated-at-the-source, not a real lead. Not attempted.
