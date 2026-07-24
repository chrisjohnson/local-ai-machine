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
4. Stop `vllm-primary`/`vllm-judge` if this benchmark needs the full GPU budget or GPU
   contention would invalidate the numbers (`docker compose stop vllm-primary vllm-judge`
   from `~/local-ai-machine/docker`). The swap scripts do this automatically — don't stop
   manually first if using them.

## Teardown — sequencing is mandatory and safety-critical

**Real incident**: restarting `vllm-primary`/`vllm-judge` **concurrently** with resuming the
download queue overloaded host memory (`free -h` showed ~92GiB used / only ~2-7GiB free
against a 124GiB pool while a 66.97GiB checkpoint was mid-load) and SIGKILLed both vLLM
engine-core processes (OOM-killer, confirmed via `docker inspect --format RestartCount`
showing 2 and 4 crash-restarts before caught).

1. **Restart vLLM first**: `docker compose up -d vllm-primary vllm-judge`.
2. **Confirm both healthy before touching anything else**: `curl -sf http://localhost:8000/health`
   and `:8001/health` must both return 200. Do not resume downloads while waiting.
3. **Only then** resume the download queue, same unit list as paused: `sudo -n systemctl start <units>`.
   An "activating" unit reporting a control-process error right after resuming is normal
   (back to its own pre-existing flock-queue retry behavior) — confirm via the activating-unit
   count, not absence of error text.
4. Confirm no leftover temp containers/volumes (`docker ps -a | grep vllm-bench-swap`).

**Lesson**: vLLM restart → confirmed healthy → THEN download resume. Never simultaneously,
especially right after a large (60GB+) model load.
