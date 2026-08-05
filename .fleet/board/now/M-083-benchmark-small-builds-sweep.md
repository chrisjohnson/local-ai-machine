---
id: M-083
title: Benchmark KAT models + fresh-benchmark all small (<40B) builds, record memory, build dashboard
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T00:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-079]
---

# M-083 — Benchmark KAT models + fresh-benchmark all small (<40B) builds, record memory, build dashboard

## Context
Chris directive (2026-08-05): stop the laguna + qwen models; benchmark the two newly
downloaded KAT models (Q8_0 plain, MTP Q6_K graft); then fresh-benchmark every small
build (<40B params) one at a time; record memory consumption into per-build notes;
commit+push catalog data (builds/versions/benchmark_runs) after each model; final
summary table highlighting smallest memory footprint + fastest token throughput across
all builds (incl. historical data) rendered as a graphical dashboard and opened.
If Ornith finishes downloading mid-sweep, benchmark it too.

Explicitly out of scope: scripts/benchmark_orchestrator.py and the extended agentic
benchmark suite — Chris only wants raw performance this pass.

## Plan
1. [ ] Stop laguna-s-2.1-118b-q4km + qwen3.6-35b-a3b-mtp containers
2. [ ] Benchmark KAT Q8_0 (llama-bench pp512/tg128) + KAT MTP Q6_K (MTP live timing) with memory capture
3. [ ] Record builds/versions/benchmark_runs + raw results; commit+push
4. [ ] Fresh-benchmark every <40B build one at a time, memory notes each, commit+push per build
5. [ ] Ornith benchmark if download completes
6. [ ] Dashboard (speed + memory comparison, historical included), open for Chris

## Signals
<!-- signal: claude 2026-08-05T00:00Z — claiming, starting with KAT benchmarks -->

## Decision log
- 2026-08-05: KAT Q8_0 + KAT MTP Q6_K done; fresh llamacpp-bench on gemma-4-26b, glm-4.7-flash,
  laguna-xs, qwen3.6-27b (dense), qwen3.6-35b-a3b, qwen3.6-27b MTP (2.07x speedup — build corrected
  from stale-BROKEN to WORKING, wrong local_path), qwen3.6-35b-a3b MTP (1.16x). Fresh
  ollama-warm-request-v2 on all 3 working ollama builds (glm-4.7-flash 59.1 tok/s, qwen3.6-27b
  10.46, qwen3.6-35b-a3b 40.7; gemma-4-26b--ollama stays BROKEN: gemma4 arch unsupported in
  0.17.7). All committed+ pushed. Memory fields now recorded on all llama.cpp + ollama builds.
- 2026-08-05 INCIDENT: box unresponsive (ping OK, SSH banner timeout) after vLLM memory-capture
  pass. Root cause: qwen3.6-27b vLLM standing config uses --gpu-memory-utilization 0.90 (~114GB
  GTT) and my /tmp/vllm_mem.sh timed out at 600s before its `docker compose stop`, leaving the
  container resident; then glm-4.7-flash-awq started on top → full-RAM swap thrash. Lesson: run
  vLLM memory captures with generous timeout AND verify container stopped before starting next;
  gpu-util 0.90 standing configs are near-full-box allocations on their own.
- 2026-08-05: vLLM memory captured so far (peak GTT): qwen3.6-35b-a3b 87,724 MiB (0.70 util,
  65.5GiB weights), qwen3.5-4b 23,903 MiB (8.6GiB weights), qwen3.6-27b 114,651 MiB (0.90 util,
  51.1GiB weights). Remaining: glm-4.7-flash-awq, gpt-oss-20b, gemma-4-26b, gemma-4-31b,
  qwen2.5-vl-7b. Speed data for all vLLM builds is fresh (2026-07-24/25, same kernel) so only
  memory capture is needed, not full c1c8-v2 re-runs.
- 2026-08-05 RESOLUTION: Chris power-cycled the box; recovered clean (3.3Gi/124Gi, no vLLM/
  ollama containers). Hardened /tmp/vllm_mem.sh: pre-flight refuses to start if any vLLM/
  ollama container is resident (the exact failure that OOM'd the box), trap guarantees
  `docker compose stop` + verify-gone on EVERY exit path, health timeout extended 600s→900s.
  Box host key unchanged (ed25519 matches known_hosts); added raw IP to known_hosts so
  `ssh chris@192.168.1.226` works without relying on flaky mDNS. Note: glm-4.7-flash-awq
  compose service has NO gpu-util flag → vLLM default 0.90 (~112GB GTT), the co-running
  culprit. Remaining captures re-run one-model-at-a-time with hardened script.

## Handoff notes
<!-- Benchmark methodology: OPERATIONS.md preflight; llama-bench single invocation per
     run (llamacpp-bench-v1); MTP builds need llama-server live request timing
     (llamacpp-mtp-v1) since llama-bench lacks spec flags. -->
