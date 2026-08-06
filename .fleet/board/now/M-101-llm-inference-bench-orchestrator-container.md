---
id: M-101
title: llm-inference-bench containerized benchmark orchestrator (new stack, separate from catalog/)
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-06T18:45:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-001, M-002]
---

# M-101 — llm-inference-bench containerized benchmark orchestrator (new stack, separate from catalog/)

## Context

Chris's direct request, 2026-08-06. **Green-field** — deliberately a NEW
stack, entirely separate from `catalog/` and `scripts/benchmark_orchestrator.py`
(which stays as-is). Requirements as requested:

- Deploy `llm-inference-bench` as a NEW container via docker-compose.
- Bind-mount a host dir containing a **fresh checkout of local-ai-machine used
  only by the benchmarking container**.
- The benchmarking container runs **llm-inference-bench + orchestrator code**.
- Bind-mount the docker socket; the container user/perms must allow running
  `docker` commands against the box's daemon (the box's compose stack).
- Orchestrator receives a request to benchmark a specific **build** (a unique
  instance of model+config+params+engine+docker image+whatever else) or a
  **combination of builds**. Per run:
  1. If the build(s) have a definition in docker-compose: **stop all other
     models**, bring up the target build(s) via **named services**, wait for
     health, then fire the benchmark configured to **record raw data**.
  2. Before the benchmark: `git fetch` + **hard reset** of the mounted checkout
     to `origin/main`.
  3. After the benchmark: save structured JSON output as
     `builds/<build-name>/benchmarks/llm-inference-bench/<timestamp>.json`,
     then `git pull --rebase` + `git add` + commit + **push directly to main**.
- The orchestrator accepts a **list of runs**; each run is a list of one or
  more builds to launch together. Multiple builds per run are benchmarked
  **serially** (not concurrent traffic) — the point is proving they **co-exist
  without crashing**.
- **Crash handling**: if a (model) container crashes, restart it once and
  re-run the benchmark; on a second crash, record the container logs.
- Mine `benchmark_orchestrator.py` + `catalog/OPERATIONS.md` for failure modes
  worth adopting (see Handoff notes for the ones found).
- The orchestrator is a **web server** to enqueue build names and monitor
  queue progress.

**Phase 1 (current)**: interactive refinement with Chris before any
implementation — this is his explicit ask, same shape as M-098.

Relevant existing surface area (read, don't redesign):
- `docker/docker-compose.yml` — two-tier design (M-001): every model build is
  its own named service, fixed loopback port, `com.local-ai-machine.always-up`
  label distinguishes infra from exclusive/stoppable model services.
  `benchmark_orchestrator.py`'s `_load_compose_services()` is the existing
  port/served-name/always-up parser to crib from.
- `network_mode: host` precedent (litellm, prometheus, haproxy): bridge-
  networked containers cannot reach the 127.0.0.1-only model ports; the
  orchestrator needs host networking for the same reason.
- `catalog/OPERATIONS.md` — preflight/teardown sequencing, OOM incident, run
  fingerprint fields, download-pause/`sudo -n systemctl` constraints.
- Box repo lives at `/home/chris/local-ai-machine` (pull-only-for-humans,
  push-for-automation via deploy key). Bench checkout is a SEPARATE host dir.

## Plan

1. [ ] **(current)** Refine this ticket with Chris — resolve the open
       questions in Handoff notes; record answers in Decision log. No code
       until this is done.
2. [ ] Finalize design decisions (build identity, llm-inference-bench repo,
       networking/UI, crash/restore semantics, download-pause scope, Ollama
       scope, checkout+key provisioning, queue persistence).
3. [ ] Implement the orchestrator image + code (Dockerfile under
       `docker/llm-inference-bench/` per repo convention).
4. [ ] Add the `llm-inference-bench` service to `docker/docker-compose.yml`
       (socket mount, checkout mount, user/perms, network).
5. [ ] Provision the bench checkout + git credentials on the box.
6. [ ] Deploy, smoke-test (dry/real), verify commit+push of a result.

## Signals

## Decision log

- 2026-08-06 (big-pickle): filed from Chris's verbatim request, claimed.
  Phase 1 is the interactive refinement session — no implementation before
  it completes (his explicit ask).

## Handoff notes

Open refinement questions raised to Chris, 2026-08-06 (answers → Decision log):

1. **Which `llm-inference-bench`?** Several public repos share the name
   (bereketlemma/..., NoahLundSyrdal/..., argonne-lcf/LLM-Inference-Bench,
   julien-lebot/..., haanjack/llm-inference-benchmark, huggingface/
   inference-benchmarker). Which repo/image + which "record raw data" /
   structured-JSON mode?
2. **Build identity.** Is a "build" just a docker-compose service name (the
   queue takes `docker compose config --services` names, metadata captured in
   the result JSON), or a new per-build manifest (e.g. `builds/<name>/`)
   defining model/config/params/engine/image + which service(s) to launch?
3. **Orchestrator networking + web UI.** Confirm `network_mode: host`
   (required to reach 127.0.0.1-only model ports). Web UI port + bind: 
   loopback-only (SSH tunnel) vs LAN? Auth or none (pi-web precedent)?
4. **Download-pause scope.** Old orchestrator pauses `download-model-*`
   systemd units during runs — a container can't `sudo -n systemctl`. Options:
   (a) explicitly out of scope for v1, documented; (b) mount host dbus/systemd
   into the container to call systemctl; (c) host-side helper. Which?
5. **Crash + restore semantics.** Confirm: crash = model container exits
   during a run → restart once + re-run; second crash → save `docker logs`,
   fail the run. And: after a run completes, restore whichever exclusive
   services were running before it (old orchestrator's snapshot-restore
   behavior) or leave everything stopped?
6. **Ollama builds.** Ollama is a single shared always-up instance (model
   switch via API), not a per-build service. Support Ollama builds in v1, or
   vLLM + llama.cpp-server compose services only?
7. **Bench checkout + creds.** Host path for the dedicated checkout (e.g.
   `/home/chris/local-ai-machine-bench`), and where the push-capable key +
   git identity come from (reuse the box's deploy key mounted in, or a new
   one?).
8. **Queue persistence.** If the orchestrator container restarts mid-queue,
   should pending runs survive? (Store queue state on a gitignored path in
   the mount, or accept loss?)

Failure modes mined from the existing stack that this should adopt (folded
into the design):
- Zero-completions/empty result = hard failure, never trust numbers
  (run_vllm_bench_serve_trial's completed==0 check).
- Correctness-gate before concurrency numbers (llama-server concurrent leg).
- Generous timeouts on every long subprocess; bounded so a real hang can't
  run forever unattended.
- Capture run fingerprint at benchmark time (image digest, engine version,
  host kernel, repo commit, host_metrics_window start/end) — OPERATIONS.md
  mandates it; keeps result JSON self-describing.
- Don't cycle model services on/off more than necessary (full-system hang
  incident 2026-07-29) — within a multi-build run, keep all targets up and
  just serialize the benchmarks.
- Pause/resume downloads around runs (see Q4 for container feasibility).
- One benchmark at a time (queue is serial; reject concurrent runs).
