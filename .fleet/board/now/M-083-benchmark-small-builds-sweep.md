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
<!-- append-only -->

## Handoff notes
<!-- Benchmark methodology: OPERATIONS.md preflight; llama-bench single invocation per
     run (llamacpp-bench-v1); MTP builds need llama-server live request timing
     (llamacpp-mtp-v1) since llama-bench lacks spec flags. -->
