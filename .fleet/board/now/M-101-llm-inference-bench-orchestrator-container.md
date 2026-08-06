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
2. [x] Finalize design decisions (build identity, llm-inference-bench repo,
       networking/UI, crash/restore semantics, download-pause scope, Ollama
       scope, checkout+key provisioning, queue persistence) — confirmed
       2026-08-06: build.yaml shape approved (compose blob + derived + bench
       overrides); web UI LAN port 8092 approved; green light to implement.
3. [ ] Implement the orchestrator image + code (Dockerfile under
       `docker/llm-inference-bench/` per repo convention).
4. [ ] Add the `llm-inference-bench` service to `docker/docker-compose.yml`
       (socket mount, checkout mount, user/perms, network).
5. [ ] Provision the bench checkout + git credentials on the box.
6. [ ] Deploy, smoke-test (dry/real), verify commit+push of a result.

## Design (refined 2026-08-06, after Chris Q&A + tool research)

**Tool**: julien-lebot/llm-inference-bench — single MIT-licensed script
`llm_decode_bench.py` (deps httpx+rich, no GPU needed). OpenAI-compatible
streaming `/v1/chat/completions`; auto-detects vLLM/SGLang; falls back to
client-side timing when server `/metrics` lacks `vllm:`/`sglang:` prefixes
(always the case for llama.cpp + Ollama → engine label reads "sglang" but
numbers are client-side; raw JSON kept untainted). Writes structured JSON:
`metadata` + `prefill` + per-cell `results[]` + `summary_table`. CLI:
`--host --port --model --concurrency --contexts --duration --max-tokens
--output [--kv-budget --skip-prefill]`. "Record raw data" = the `--output`
JSON (per-cell throughput/TTFT/queue/errors) + stdout log.

**Container**: new `llm-inference-bench` compose service (always-up label —
MUST be, so its own stop-everything logic never stops it).
- `build: {context: ./llm-inference-bench}` — new dir: Dockerfile (python
  3.11-slim + docker-cli + git + openssh-client + httpx/rich/fastapi/uvicorn),
  vendored `llm_decode_bench.py` at a pinned upstream commit, orchestrator app.
- `network_mode: host` (only way to reach the 127.0.0.1-only model ports;
  litellm/prometheus precedent). Web UI binds 0.0.0.0:<port>, LAN no auth.
- `user: "1000:1000"` + `group_add: ["131"]` + `/var/run/docker.sock` mount
  (identical pattern to omp/pi-web — chris uid 1000, box docker group gid 131).
- volumes: `/home/chris/local-ai-machine-bench:/bench` (rw — the DEDICATED
  checkout, hard-reset per run, results pushed from here), box deploy key
  mounted ro + GIT_SSH_COMMAND + git identity via env.
- `restart: unless-stopped`.

**Build identity**: build name = directory under `builds/` (and the compose
service name). `builds/<name>/build.yaml` = (1) the verbatim docker-compose
service blob + (2) hand-authored derived metadata (params, active params,
quant, mtp/dflash, etc.) + optional `bench:` overrides. The ORCHESTRATOR never
writes build.yaml — its only job is raw benchmark data. Launch = named compose
services (`docker compose up -d <svc>`), ports/served-name parsed from the
mount's compose file (pattern: `_load_compose_services`).

**Run lifecycle** (queue item = list of builds; run serially, one worker):
1. `git fetch` + `git reset --hard origin/main` on /bench (before anything —
   compose defs + build.yaml are current).
2. Stop all non-always-up (exclusive) compose services EXCEPT this run's
   targets. Bring up targets via named services. Wait all healthy
   (curl /health on each parsed port, bounded timeout).
3. Per build, serially: run the tool with build.yaml `bench:` overrides (or
   defaults `concurrency 1,2,4,8 / contexts 0,16384,32768,65536 / duration 30
   / max-tokens 8192`) against `localhost:<port>`, `--model` = served name,
   `--output builds/<name>/benchmarks/llm-inference-bench/<timestamp>.json`.
4. Model container crash during a benchmark → `docker compose restart <svc>`,
   wait healthy, re-run ONCE; second crash → `docker logs` to
   `builds/<name>/benchmarks/.../crash-<ts>.log`, mark build failed, continue.
5. On success: `git pull --rebase` + `git add` result file(s) + commit + push
   to main, from /bench.
6. End of run: leave targets up (Chris's choice); non-target exclusive
   services stay stopped.

**Failure modes adopted from existing stack**: hard-fail on empty/no-results
output (tool exits "No results collected" or all cells num_completed==0) —
never trust bogus data; health-wait before every bench; bounded-but-generous
whole-run timeout (tool already has per-request 600s caps); no service cycling
mid-run (2026-07-29 full-system hang lesson — co-existence is the point);
serial queue, one run at a time; persist queue + run state to a gitignored
path in /bench so the orchestrator's own restart resumes pending runs;
download-pausing explicitly OUT OF SCOPE v1 (container can't sudo systemctl)
— documented.

**Queue/web server** (FastAPI, LAN no auth, port TBD ~8092):
- `POST /runs` body `{"runs": [["svc-a"], ["svc-b","svc-c"]]}` → enqueue.
- `GET /queue` (pending/running/done + per-build status), `GET /runs/{id}`,
  `GET /builds` (valid names). Simple polling HTML page.

**Provisioning on box**: fresh `git clone` to /home/chris/local-ai-machine-bench
using the box's existing push-capable deploy key; ssh known_hosts for github;
git identity (Chris Johnson / chrisjohnson0@gmail.com, matching repo).

## Signals

## Decision log

- 2026-08-06 (big-pickle): filed from Chris's verbatim request, claimed.
  Phase 1 is the interactive refinement session — no implementation before
  it completes (his explicit ask).
- 2026-08-06 (big-pickle): refinement Q&A answered by Chris: tool =
  julien-lebot/llm-inference-bench; build = compose service name + a
  hand-authored `builds/<name>/build.yaml` carrying the verbatim compose
  blob + derived metadata (orchestrator only produces raw data, never writes
  build.yaml); download-pause out of scope v1 (documented); crash = restart
  once + re-run, then logs + fail; post-run = leave targets up (no
  snapshot-restore); Ollama included via standard compose-service path
  (stack may be adjusted later if needed); web UI = LAN, no auth; checkout =
  /home/chris/local-ai-machine-bench + box's deploy key; queue state
  persisted across container restarts.
- 2026-08-06 (big-pickle): refinement session COMPLETE. Chris approved:
  build.yaml schema (verbatim compose blob + `derived:` metadata + optional
  `bench:` CLI overrides; orchestrator never writes build.yaml); web UI =
  LAN port 8092, no auth; implementation green-lit. Proceeding to build.

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
