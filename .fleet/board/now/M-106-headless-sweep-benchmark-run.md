---
id: M-106
title: headless full-sweep benchmark run + watchdog self-healing
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-07T16:05:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-101]
---

# M-106 — headless full-sweep benchmark run + watchdog self-healing

## Context
Chris asked (2026-08-07) to let the llm-inference-bench orchestrator run headless
over the weekend and arrive back with every model build benchmarked or explicitly
marked failed. Sweep was seeded by queuing every build without valid results
(25 new runs, ids 41-65) plus re-queues for the 3 stale-running builds. A
watchdog script (`docker/llm-inference-bench/watchdog.py`, commit `0406477`) keeps
the sweep self-healing: restarts the container if it dies, detects a wedged worker
via activity-log staleness (heartbeat every 60s during bench; health-wait silent
for up to 20 min, so 30-min stale threshold), and re-queues in-flight runs.

## Plan
1. [x] Audit queue vs builds — 18 done / 9 failed / 9 queued / 4 running (1 real, 3 stale) across 40 runs
2. [x] Queue all builds lacking valid results (runs 41-65; includes omp/open-webui excluded as non-benchmarkable)
3. [x] Re-queue stale-running builds north-mini-code / ornith-q8 / qwen2.5-vl as fresh runs
4. [x] Write + deploy watchdog (`watchdog.py`) — running on box, pid tracked in .orchestrator/watchdog.out
5. [ ] Monitor sweep to completion (34 queued + run 31 in flight); intervene on unexpected failures
6. [ ] Move to done/ with summary of results-per-build and any failures needing follow-up

## Signals
<!-- signal: big-pickle 2026-08-07T16:05Z — claiming; 34 queued + 1 in-flight; watchdog live -->
<!-- signal: big-pickle 2026-08-07T16:06Z — queue seeded, run 31 (qwen3-coder) actively benchmarking on :8004 -->

## Decision log
- 2026-08-07: queued builds lacking valid JSON results as single-build runs (duplicates OK per user).
  omp/open-webui excluded — web apps with no 127.0.0.1 port mapping, not benchmark targets.
- 2026-08-07: ds4-deepseek-v4-flash-iq2xxs (non-imatrix) queued even though its weights were deleted
  (commit 5009fbc) — expected to fail and be marked as such, matching user's "benchmarked or failed" goal.

## Handoff notes
Watchdog runs as `python3 docker/llm-inference-bench/watchdog.py` on the box (nohup/setsid).
Progress: `builds/.orchestrator/watchdog.log`. Queue state: `GET /queue` on :8092. If box reboots,
the container is `restart: unless-stopped` so the sweep survives, but the watchdog must be
restarted manually via the same setsid command.
