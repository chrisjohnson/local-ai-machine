# ROCm control evidence — 2026-08-02

Decisive-result notes for the M-055 ROCm control leg. The control never produced a
benchmark result because the ROCm build of the fork could not get DFlash serving on
this box. All timestamps UTC. Full context in
`catalog/builds/laguna-s-2.1-118b-q4km--llamacpp-laguna-fork-rocm-dflash.yaml`.

## Evidence 1 — full DFlash server load (n15, -fa 0) hangs

Invocation (from `scripts/benchmark-laguna-dflash.sh`, IMAGE=...:rocm-7.14,
FA_FLAG="-fa 0", SPEC_N_MAX=15, -c 131072, --spec-type draft-dflash):
`llama-server -m <UD-Q4_K_M shard 1> -md <laguna-s-2.1-DFlash-BF16.gguf> --spec-type
draft-dflash --spec-draft-n-max 15 -ngl 999 -fa 0 --swa-full --reasoning-format
deepseek -n 8192 -c 131072`.

Server log (captured live via `docker logs`, ~01:19Z):
```
0.00.039.474 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg)
0.00.043.693 I srv    load_model: loading model '/models/UD-Q4_K_M/Laguna-S-2.1-UD-Q4_K_M-00001-of-00003.gguf'
0.00.133.585 E llama_init_from_model: failed to initialize the context: dflash requires ctx_other to be set (this warning is normal during memory fitting)
0.00.148.464 W srv    load_model: [spec] failed to measure draft model memory: failed to create llama_context from model
0.00.595.982 W load: special_eos_id is not in special_eog_ids - the tokenizer config may be incorrect
0.00.595.986 W load: special_eot_id is not in special_eog_ids - the tokenizer config may be incorrect
```
After the tokenizer warnings (~0.6s in) there was NO further output for 7+ minutes.
Process state during the stall: 551 MiB resident, ~0 cumulative CPU, container Up.
The M-053 Vulkan equivalent reached healthy in ~2-3 min with the model resident.
=> The DFlash draft context (`ctx_other`) creation fails on ROCm, and the real
(second-pass) load then hangs with the model never paged in.

## Evidence 2 — DFlash draft model cannot init standalone (any backend)

`llama-cli -m laguna-s-2.1-DFlash-BF16.gguf -c 512 -ngl 999 -fa 0` fails with:
```
E llama_init_from_model: failed to initialize the context: dflash requires ctx_other to be set
E common_fit_params: encountered an error while trying to fit params to free device memory: failed to create llama_context from model
E common_init_: failed to create context with model '...'
```
Expected — DFlash draft models require the `--spec-type draft-dflash` wrapper to set
`ctx_other`; run standalone they cannot init. Included to preempt the "just load the
draft alone" dead end.

## Evidence 3 — plain (no-draft) 68GB load on ROCm stalls after weight loading

`llama-cli -m <UD-Q4_K_M shard 1> -c 2048 -ngl 999 -fa 0 --swa-full --reasoning-format
deepseek -n 16` (no `-md`):
- 2:19 in: 49.5 GiB RSS, 32% CPU — weights loading normally.
- 5:52 in: 50.7 GiB RSS, 73% CPU — RSS plateaued; stuck in context/buffer setup.
- 8:27 in: still no output; unresponsive to the 420s `timeout` SIGTERM (killed
  manually with `docker rm -f`).
=> The stall is NOT DFlash-specific: even a plain load gets through weight paging
(~51GB) but never completes to generation on this ROCm build on gfx1151. This is the
strongest evidence that the community's ROCm numbers are not reproducible on this box
with this toolchain — the ROCm llama.cpp path itself is broken-in-effect here.

## Environment

- Image: `local-ai-machine/llamacpp-laguna-fork:rocm-7.14`
  @ sha256:0d38312bf2111a6b33716722b0504a1f7aa733cb60dc0f3f917416ebfc714cc1,
  fork pinned 04b2b72cb54048ead292884adbe11f284e3ec950, GGML_HIP=ON,
  AMDGPU_TARGETS=gfx1151, base rocm/dev-ubuntu-24.04:7.14.0-full.
- Host: NixOS, kernel 6.18.39, gfx1151 (Strix Halo), 128GB unified.
- Standing laguna service stopped for the runs (GPU exclusivity per OPERATIONS.md);
  restored after, download queue resumed.
