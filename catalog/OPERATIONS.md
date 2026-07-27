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

## Build naming for config variants (e.g. different served context length)

If the same model+engine pair is tested at more than one meaningfully different serving
config (most commonly `--max-model-len`, but could be any flag that materially changes
footprint/behavior), that's two different **builds**, not two runs of one build.

- File naming: `<model>--<engine>--<variant-tag>.yaml` (e.g. `--ctx65536` / `--ctx131072`),
  only when more than one variant exists for a model+engine pair — no suffix needed otherwise.
- Add a `context_length_served: <N>` field at the top level of the build (not just buried
  inside the compose service's command), so it's queryable without parsing compose YAML.
- The `model:` block (repo, architecture, params, quantization) is duplicated verbatim across
  variant files — that's intentional, not an inconsistency to fix. The point of a build file is
  to be a single, complete, self-contained unit sufficient to reconstruct a docker-compose
  entry on its own; splitting `model:` out into a shared reference would break that property.

## Two-tier model: catalog + compose

As of M-001, deployment detail lives exclusively in `docker-compose.yml`:
- `build_specific_flags`, `build_specific_env`, `compose_service`, `served_model_name`
  have been removed from `catalog/builds/*.yaml`.
- Each build's compose service name = its catalog `id` (exact match, the join key).
- Port allocation: vLLM builds → 8000-8099, llama.cpp-server → 8100+, Ollama → 11434
  (shared instance, model switch via API).

### Switching which model serves a role

1. Start the desired build: `docker compose up -d <build-id>`
2. Update `docker/litellm/config.yaml` — change the `api_base` port to match the build's
   assigned port.
3. Reload LiteLLM: `docker compose restart litellm`

### llama.cpp builds: benchmarker vs. server

- `llamacpp-vulkan-radv-v1` builds use `llama-bench` (single-shot benchmarking tool that
  exits after running). These **cannot** be standing compose services.
- `llamacpp-vulkan-radv-server-v1` builds use `llama-server` (OpenAI-compatible HTTP API).
  These get compose entries like vLLM builds.
