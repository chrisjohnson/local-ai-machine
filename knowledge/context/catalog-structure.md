---
id: catalog-structure
date: 2026-07-24
source: "HANDOFF.md (\"Current state\", lines 47-81)"
tags: [catalog, operations, benchmark, schema]
status: active
---

# Catalog structure and benchmarking SOP location

As of 2026-07-24, `catalog/` replaced the old `MODEL_STACK_CATALOG.md`/`BENCHMARKING.md`
files (content fully migrated or confirmed superseded at the time).

- **`catalog/engines/*.yaml`** — reusable engine+backend recipes (vLLM, llama.cpp x3
  variants, Ollama x2 variants including a documented-broken one).
- **`catalog/builds/*.yaml`** — one file per model+engine combo, identity/config only. No
  historical benchmark run data was backfilled deliberately — old numbers stay in git
  history / `README.md` / `OPTIMIZATIONS.md`, not migrated. Every build has an empty
  `benchmark_runs: []` ready for real data.
- **`catalog/benchmarks/*.yaml`** — versioned methodology definitions. Versions in use as
  of this note: `vllm-speed-c1c8-v2` (3 trials + mean/stddev, for production-candidate-
  grade comparisons; `v1` single-run is for wide-survey screening only),
  `seven-tier-coding-v2` (supersedes `six-tier-coding-v1`; applies to vLLM and llama.cpp/
  Ollama), `ollama-warm-request-v2` (cold + 3 warm), `llamacpp-bench-v1` (unchanged),
  `llamacpp-server-concurrent-v1`, `llamacpp-mtp-v1` (mechanism verified, no successful
  run recorded as of this note).
- **`catalog/OPERATIONS.md`** — the safety-critical procedure: preflight/teardown
  sequencing, `sudo -n` requirements, a documented `awk '{print $2}'` gotcha, the real OOM
  incident that motivated the vLLM-restart-before-downloads-resume ordering, required
  run-fingerprint fields, build-naming convention for config variants (e.g. testing one
  model at multiple context lengths). **Read this before running or scripting any
  benchmark.**

Note: `catalog/builds/*.yaml`'s exact schema is described elsewhere as "undergoing
restructuring per the board" — check `.fleet/board/` for the current target schema before
assuming this note's shape is still exactly current.
