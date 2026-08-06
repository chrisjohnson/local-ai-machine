# Benchmarking via the llm-inference-bench orchestrator API

The M-101 orchestrator is a container on the box that queues benchmark runs,
executes them serially (git sync → exclusivity → health → bench → commit+push
to main), and exposes everything over a small JSON API. It replaces tailing
logs or driving the old `scripts/benchmark_orchestrator.py`.

**Agent workflow — enqueue via API, then WAIT on the API.** `GET /runs/<id>`
is a ~500-byte JSON document; `docker logs` is unbounded. Do not tail the
container's logs. For live progress, consume the SSE log stream incrementally
— it only emits lines as they're appended, so it is cheap while the bench is
idle.

- Box: `local-ai-machine` · Base URL: `http://192.168.1.226:8092/` (LAN, no
  auth — keep this off the WAN boundary)
- Web UI: same URL (`GET /`) — enqueue form + live streaming log panel
- Code: `docker/llm-inference-bench/` · bench checkout on the box:
  `/home/chris/local-ai-machine-bench` (the checkout results are pushed from)
- Build identity: `builds/<name>/` holds `build.yaml` (derived metadata +
  optional `bench:` overrides) and `docker-compose.yaml` (the build's compose
  service, 1:1 with the global `docker/docker-compose.yml`). See
  `builds/README.md` — the orchestrator reads service defs from the global
  compose, never from per-build files, so the two stay in lockstep.

## The whole flow, condensed

1. Pick a build: `GET /builds` → list of service names.
2. Enqueue: `POST /run` with `{"builds": ["<build>", ...]}` → run id.
3. Wait: poll `GET /runs/<id>` every 30–60s until `status` is `done`/`failed`.
4. Read the result: `per_build[<build>].raw_json` = committed result path;
   `stdout_log` = tool transcript; `error` / `crash_log` if it failed.
5. Restore: a run stops every non-target model service (exclusivity). Restart
   whatever was serving before the run (`docker compose up -d <svc>` on the
   box). This is intentionally manual today.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/builds` | Benchmarkable compose services (name, always_up, port, has_build_yaml) |
| POST | `/run` | Enqueue one run: `{"builds": ["svc-a"]}` → `{"created": <run>}` |
| POST | `/runs` | Enqueue many: `{"runs": [["svc-a"], ["svc-b","svc-c"]]}` → `{"created": [<run>, ...]}` |
| GET | `/queue` | ALL runs ever (grows without bound — prefer `/runs/<id>` when waiting) |
| GET | `/runs/<id>` | One run's full state (the wait loop's endpoint) |
| GET | `/runs/<id>/log` | Activity log text; `?stream=1` → SSE tail (replays from top, `end` event on completion); `?build=<name>` → that build's stdout log |
| GET | `/state` | Raw `queue.json` (gitignored) |

Enqueue validation: unknown names and always-up infra (non-benchmarkable)
are rejected with `400` + a `detail` message.

## Status model

Run-level `status`: `queued` → `running` → `done` | `failed`. Per-build
`status`: `pending` → `running` → `done` | `failed`, with `attempts`
(crash restarts), `error`, `raw_json`, `stdout_log`, `crash_log`.

```json
{
  "id": "6",
  "status": "done",
  "builds": ["qwen3.5-4b--vllm-therock-gfx1151-v1"],
  "created_at": "2026-08-06T19:55:27Z",
  "started_at": "2026-08-06T19:55:29Z",
  "finished_at": "2026-08-06T20:13:51Z",
  "error": null,
  "per_build": {
    "qwen3.5-4b--vllm-therock-gfx1151-v1": {
      "status": "done", "error": null, "attempts": 1,
      "raw_json": "builds/qwen3.5-4b--vllm-therock-gfx1151-v1/benchmarks/llm-inference-bench/20260806T201351Z.json",
      "stdout_log": "builds/qwen3.5-4b--vllm-therock-gfx1151-v1/benchmarks/llm-inference-bench/20260806T201351Z-stdout.log",
      "crash_log": null
    }
  }
}
```

The wait loop is one cheap call:

```bash
while :; do
  S=$(curl -s http://192.168.1.226:8092/runs/$ID | python3 -c \
     'import sys,json;print(json.load(sys.stdin)["status"])')
  [ "$S" = done ] || [ "$S" = failed ] && break
  sleep 30
done
```

## What a run does (so "waiting" is not a mystery)

1. Hard-reset the bench checkout to `origin/main` (compose defs + build.yaml
   are current before anything touches model services).
2. **Exclusivity** — stop every non-always-up compose service EXCEPT this
   run's targets, freeing the GPU budget. The orchestrator itself is always-up
   and never stops itself.
3. Bring up targets via named services, wait until healthy (probe each
   service's 127.0.0.1 port).
4. Per build, serially: run the harness with the build's `bench:` overrides
   (or the default matrix), raw JSON + stdout log saved under
   `builds/<build>/benchmarks/llm-inference-bench/<timestamp>.json`.
5. On success: `git pull --rebase` + add + commit + **push to main**.
6. Targets stay up; non-target exclusive services stay stopped (restore is
   manual, step 5 of the flow).

**Runtime reality:** the default matrix is large (4 concurrency × 4 contexts ×
30s each + prefill to the model's full context). A small model is minutes; a
35B+ model is tens of minutes. Multiple builds in ONE run bench serially
(co-existence proof) — time scales linearly.

## Fast validation runs

`builds/<name>/build.yaml` can carry a `bench:` override block to shrink the
matrix. Orchestrator-only edits are never needed; a human edits build.yaml
(hand-authored, never written by the orchestrator). For a quick smoke run:

```yaml
bench:
  concurrency: "1,2"
  contexts: "0,8192"
  duration: 15
  max_tokens: 1024
  kv_budget: 0
```

Defaults when a build has no `bench:` block: `concurrency 1,2,4,8`,
`contexts 0,16384,32768,65536`, `duration 30`, `max_tokens 8192`,
`kv_budget 0`. Other env-tunable knobs on the container (see
`docker/llm-inference-bench/app/config.py`): `BENCH_BUILD_TIMEOUT_S` (7200),
`BENCH_HEALTH_WAIT_S` (1200), `BENCH_CRASH_PROBE_FAILURES` (3),
`BENCH_HEARTBEAT_S` (60).

## Failure modes

- **Zero-completions hard-fail**: a run that completes zero requests is marked
  failed and never committed — never trust bogus data.
- **Crash handling**: a model container crash mid-bench (health probe fails
  for `BENCH_CRASH_PROBE_FAILURES` consecutive polls) → restart once + re-run
  once; a second crash saves `docker logs` to `crash.log` and fails the build.
- **Signals to read on a failed run**: run-level `error`; per-build `error`;
  `crash_log` path when a container died twice; `stdout_log` for the tool's
  own failure text.
- **Build timeout**: a bench exceeding `BENCH_BUILD_TIMEOUT_S` is killed and
  the run fails, so a hang can never run forever unattended.
- The health-wait phase polls for up to `BENCH_HEALTH_WAIT_S`; a target that
  never becomes healthy fails the run with a timeout message.

## Queuing multiple builds

- Separate runs: `POST /runs` with `{"runs": [["a"], ["b"], ...]}` — each
  becomes its own run; the worker executes them in order.
- Co-launch (bench serially in one run, proving they co-exist without
  crashing): `POST /run {"builds": ["a", "b"]}`.
- Runs execute strictly serially (one worker thread); a new enqueue waits
  behind whatever is running.
