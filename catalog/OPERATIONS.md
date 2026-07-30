# Operational safety procedure for running any benchmark

Distilled from the old `BENCHMARKING.md` — this is the cross-cutting "how to safely touch
the box" procedure, not tied to any one engine/build/benchmark. Those now live in
`catalog/engines/`, `catalog/builds/`, `catalog/benchmarks/`.

## Before you start

- Never run a benchmark concurrently with other work on the box (other tests, harness runs,
  model swaps, downloads). One benchmark at a time, full stop.
- Passwordless `sudo` is scoped to `nixos-rebuild switch` and `systemctl start`/`stop`/`restart`
  only (NOPASSWD, not `enable`/`disable`/`edit`/masking). Pausing/resuming
  `download-model-*.service` units **requires** `sudo -n systemctl stop/start` — plain
  `systemctl stop` fails with "Access denied... requires interactive authentication."
  `docker`/`docker compose` do NOT need `sudo` (chris is in the `docker` group).

## Preflight (every run, every engine)

1. Check for active downloads:
   ```
   ps aux | grep -iE "hf download|nix.*download " | grep -v grep
   systemctl list-units "download-model-*" --all --no-legend | grep activating
   ```
2. If any are "activating," pause all of them in one command:
   ```
   sudo -n systemctl stop $(systemctl list-units "download-model-*" --all --no-legend | grep activating | awk '{print $2}')
   ```
   **Gotcha**: `--no-legend` output over SSH still includes the leading `●` bullet as column 1 —
   `awk '{print $1}'` grabs the bullet, not the unit name, and silently no-ops per unit
   ("Invalid unit name" error, easy to miss in a wall of output). Use `$2`. Keep a copy of
   exactly which units you stopped — resume the same list at teardown.
3. Check no other benchmark/harness activity is already in flight (`ps aux` for
   `vllm bench serve`/`llama-bench`/`coding_benchmark.py`/`speed_benchmark_swap.sh`).
4. Stop any running model-serving compose services if this benchmark needs the full GPU
   budget or GPU contention would invalidate the numbers (`docker compose stop <service>`
   from `~/local-ai-machine/docker`). Check what's running: `docker compose ps`.
   The swap scripts do this automatically — don't stop manually first if using them.

## Teardown — sequencing is mandatory and safety-critical

**Real incident**: restarting model-serving containers **concurrently** with resuming the
download queue overloaded host memory (`free -h` showed ~92GiB used / only ~2-7GiB free
against a 124GiB pool while a 66.97GiB checkpoint was mid-load) and SIGKILLed both vLLM
engine-core processes (OOM-killer, confirmed via `docker inspect --format RestartCount`
showing 2 and 4 crash-restarts before caught).

1. **Restart the standing model services first**: `docker compose up -d <standing-services>`
   (e.g. `docker compose up -d qwen3.6-35b-a3b--vllm-therock-gfx1151-v1`).
2. **Confirm healthy before touching anything else**: `curl -sf http://localhost:<port>/health`
   must return 200. Do not resume downloads while waiting.
3. **Only then** resume the download queue, same unit list as paused: `sudo -n systemctl start <units>`.
   An "activating" unit reporting a control-process error right after resuming is normal
   (back to its own pre-existing flock-queue retry behavior) — confirm via the activating-unit
   count, not absence of error text.
4. Confirm no leftover temp containers/volumes (`docker ps -a | grep vllm-bench-swap`).

**Lesson**: model restart → confirmed healthy → THEN download resume. Never simultaneously,
especially right after a large (60GB+) model load.

## Run fingerprint — capture every one of these fields on every benchmark run

A build's `benchmark_runs[]` entry (see `catalog/builds/`) must record all of the following,
captured fresh at run time — not assumed static from when the build file was written, since a
floating image tag or host state can drift between two runs of "the same" build weeks apart:

- `image_digest`: exact digest, not just tag (`docker inspect --format '{{.RepoDigests}}' <image>`).
- `engine_version`: as reported at startup — vLLM's own version string, llama.cpp's
  `build: <hash> (<n>)` line, or Ollama's `--version`.
- `host_kernel`: `uname -r`.
- `host_gpu_driver`: amdgpu/Mesa version in use.
- `repo_commit`: `git rev-parse HEAD` of this repo at run time (so a later script/task fix can be
  told apart from a genuine model/config difference).
- `concurrent_load`: whether the download queue was paused, and whether vLLM was co-resident or
  stopped.
- `host_metrics_window`: the run's start/end UTC timestamps, so the box's own Grafana/Prometheus
  dashboards (GPU %, GPU temp/power, memory, disk I/O — already built, see README.md's
  observability section) can be queried for that exact time range after the fact. This is cheap
  to capture (just note the two timestamps) and catches failure modes this project has already
  been burned by once — e.g. the Ollama ROCm crash investigation needed exactly this kind of
  GPU-utilization cross-check to confirm real vs. silent-CPU-fallback behavior. Not a live
  Grafana link (dashboards aren't stable-URL-per-range in this setup) — just the timestamps
  needed to look it up.

## Build versioning: new version vs. new family (M-002)

As of M-002, `catalog/builds/*.yaml` files are **families**, not individual builds: one file
per (model, engine-recipe-identity, any other major structural difference), holding a
`versions:` list of that family's serving-config iterations over time (v1, v2, v3, ...). The
`model:` block is hoisted to the family level, shared by every version. Each version entry
carries its own `version: vN`, `compose_service_id:` (the real `docker-compose.yml` join key
for that version — see "Two-tier model" below), `engine_ref:` (which `catalog/engines/*.yaml`
recipe this version was built against — independent of `version:`; bumping a build's version
does NOT imply bumping the engine-recipe reference), plus `role`, `notes`, `status`, `created`,
`last_verified`, and `benchmark_runs:`.

Deciding which bucket a config change falls into:

- **New version within the existing family** — same engine recipe (same binary/invocation
  shape) + same model artifact (same quant/files) + a serving-config-only change: batch size,
  context length (`--max-model-len`/`-c`), GPU-memory cap, KV-cache flags, and similar
  like-for-like serving tweaks. This is the versioning this section used to route through a
  `--ctx<N>` filename suffix (retired below) — it now goes through `version:` instead, which
  also gets you version-over-time comparison in the dashboard for free.
- **New family (new file)** — different engine recipe, different quantization/model artifact,
  or a different backend entirely (vllm/llamacpp/ollama). Any of these changes the actual
  loaded weights or the invocation shape, not just a serving-time tunable — not what the
  version-over-time trend within one family is for.

Practical mechanics for cutting a new version:
- Append a new entry to the family's `versions:` list with the next `vN`, a fresh
  `compose_service_id:` (own fixed port, per the two-tier convention below — do not reuse a
  prior version's compose service name), `engine_ref:` (unchanged from the prior version unless
  the engine recipe itself changed), and its own empty `benchmark_runs: []` to start.
- Do not mutate a prior version's fields in place — each version is a permanent, independently
  comparable record. If an "optimization" regresses something, the prior version's data is
  still there to flip back to.

**Retired**: the pre-M-002 `--ctx<N>`-style filename-suffix convention (`<model>--<engine>--
<variant-tag>.yaml`) for tracking context-length/config variants is superseded by `version:`
above. It was never actually adopted by any of the files migrated into the new schema — clean
retirement, not a deprecate-in-place.

## Two-tier model: catalog + compose

As of M-001, deployment detail lives exclusively in `docker-compose.yml`:
- `build_specific_flags`, `build_specific_env`, `compose_service`, `served_model_name`
  have been removed from `catalog/builds/*.yaml`.
- Each version's compose service name = its `compose_service_id` (exact match, the join key;
  as of M-002 this lives on the version entry, not the family's top-level `id`).
- Port allocation: vLLM builds → 8000-8099, llama.cpp-server → 8100+, Ollama → 11434
  (shared instance, model switch via API).

### Always-up vs. exclusive/benchmarkable services

Every service in `docker-compose.yml` is either **always-up** (infra: LiteLLM, its
Postgres DB, Turnstone + its DB, Prometheus, node-exporter, Grafana, Open WebUI, the
shared Ollama instance) or **exclusive** (any model-serving build — vLLM, llama.cpp-server,
regardless of engine family). `scripts/benchmark_orchestrator.py` stops every exclusive
service before running a candidate build (mandatory for full GPU budget/no contention)
and restores exactly whichever ones were running beforehand.

The distinction is driven by a compose label, not a hardcoded name/port-range list:

```yaml
services:
  litellm:
    labels:
      com.local-ai-machine.always-up: "true"
```

**New model-serving builds need no label at all** — a service is treated as
exclusive/stoppable by default; only genuine infra should ever carry
`com.local-ai-machine.always-up: "true"`. This is a deliberate fail-safe default: a new
build added without remembering the label still gets correctly stopped for GPU
exclusivity, rather than silently escaping it. (Real incident, 2026-07-29: before this
label existed, the orchestrator had a hardcoded "bring up qwen3.6-35b-a3b + qwen3.5-4b
at startup" step that predated the laguna deployment — it didn't know `coder` now
pointed at laguna, brought the old vLLM pair up alongside it anyway, and caused a real
GPU-contention crash. The label-driven approach generalizes correctly no matter which
model currently serves which role.)

**Stop/restore happens once per sweep, not once per build** (fixed 2026-07-29, same day
as the label fix above): `benchmark_orchestrator.py`'s `main()` stops every exclusive
service exactly once before the whole sweep starts, and restores whatever was running
beforehand exactly once after every build in every engine family finishes — not around
each individual build. Repeatedly cycling a large standing model (e.g. laguna, ~68GB)
on and off between every single build in a 25+-build sweep is real, unnecessary GPU/
driver churn, and was implicated in a full-system hang that required a hard power-cycle
during the first sweep run under the per-build-restore design.

**No `restart: unless-stopped` on model-serving services** (also 2026-07-29): a hard
reboot that catches the sweep mid-cycle leaves containers in whatever state they were
in at the moment of the crash — not necessarily "explicitly stopped." Docker's restart
policy then brings back *every* container that wasn't explicitly stopped, which meant a
post-reboot pileup of nearly every model service running simultaneously (~111GB/124GB
memory used). Infra services keep `restart: unless-stopped` — no GPU-contention risk
there. Which model (if any) should auto-start on boot is an open question, deliberately
deferred rather than guessed at here.

### Switching which model serves a role

```
docker compose up -d <service-name>
./scripts/set-role.sh <role> <service-name>
```

Example — switch "coder" to Gemma-4-26B:
```
docker compose up -d gemma-4-26b-a4b-it--vllm-therock-gfx1151-v1
./scripts/set-role.sh coder gemma-4-26b-a4b-it--vllm-therock-gfx1151-v1
```

The script reads the port and served-model-name from docker-compose.yml,
updates the litellm config, and restarts the litellm container. No git
commit required — this is a runtime selection, not a definition change.

The service name is the exact docker-compose service name (which equals a
version's `compose_service_id`, not the family file's top-level `id` — see
"Build versioning" above). Run `docker compose ps` to see what's running, or
`docker compose config --services` to list all defined services.

### llama.cpp builds: benchmarker vs. server

- `llamacpp-vulkan-radv-v1` builds use `llama-bench` (single-shot benchmarking tool that
  exits after running). These **cannot** be standing compose services.
- `llamacpp-vulkan-radv-server-v1` builds use `llama-server` (OpenAI-compatible HTTP API).
  These get compose entries like vLLM builds.
