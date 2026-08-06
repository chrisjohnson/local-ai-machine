"""Benchmark queue + run lifecycle for the llm-inference-bench container.

One worker thread processes the queue serially (one run at a time). Queue and
per-run state persist to builds/.orchestrator/queue.json inside the mounted
checkout (gitignored, see root .gitignore) so the orchestrator's own
container restart resumes pending runs instead of losing them.

Run lifecycle (per the M-101 refined design):
  1. hard-reset the mounted checkout to origin/main (compose defs + build.yaml
     are current before anything else touches the box's model services)
  2. stop every non-always-up compose service EXCEPT this run's targets
  3. bring up targets via named services, wait for health
  4. per build, serially: run llm_decode_bench.py, raw JSON + stdout log saved
     under builds/<build>/benchmarks/llm-inference-bench/
  5. on success: git pull --rebase + add + commit + push straight to main
  6. leave targets up; non-target exclusive services stay stopped

Failure modes adopted from the existing stack (OPERATIONS.md +
benchmark_orchestrator.py): hard-fail on empty/no-completions results (never
trust bogus data); health-wait before every bench; bounded-but-generous whole
build timeout; no service cycling mid-run (2026-07-29 full-system hang);
crash = restart once + re-run once, second crash = docker logs + fail.
Download pausing is explicitly out of scope for v1 (container can't
sudo -n systemctl) and documented in the card.
"""

from __future__ import annotations

import datetime
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import yaml

from . import compose as dc
from .config import Config

STATE_VERSION = 1


def utcnow_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ts_for_filename() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _bench_key() -> str:
    return "llm-inference-bench"


class Orchestrator:
    def __init__(self, config: Config):
        self.config = config
        self._lock = threading.Lock()
        self._worker = None
        self._state = {"version": STATE_VERSION, "next_id": 1, "runs": {}}
        self._load_state()

    # ------------------------------------------------------------------
    # State persistence
    # ------------------------------------------------------------------

    def _load_state(self):
        path = self.config.state_path
        if path.exists():
            try:
                data = json.loads(path.read_text())
                if data.get("version") == STATE_VERSION:
                    self._state = data
            except (json.JSONDecodeError, OSError) as e:
                print(f"WARNING: could not load queue state from {path}: {e}; starting fresh", flush=True)

    def _save_state(self):
        path = self.config.state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self._state, indent=2))
        os.replace(tmp, path)

    # ------------------------------------------------------------------
    # Queue API (thread-safe)
    # ------------------------------------------------------------------

    def _next_id(self):
        run_id = str(self._state["next_id"])
        self._state["next_id"] += 1
        return run_id

    def enqueue(self, builds: list) -> dict:
        """Validate + enqueue one run. Rejects unknown service names and
        always-up infra services (nothing to benchmark behind a generic
        gateway), so a fat-fingered POST can never stop real infra."""
        services = self.services()
        unknown = [b for b in builds if b not in services]
        if unknown:
            raise ValueError(f"Unknown build/service names: {unknown}")
        infra = [b for b in builds if services[b]["always_up"] and not self._always_up_benchmarkable(b)]
        if infra:
            raise ValueError(f"Not benchmarkable (always-up infra): {infra}")
        with self._lock:
            run_id = self._next_id()
            run = {
                "id": run_id,
                "status": "queued",
                "builds": list(builds),
                "created_at": utcnow_iso(),
                "started_at": None,
                "finished_at": None,
                "error": None,
                "per_build": {
                    b: {
                        "status": "pending",
                        "error": None,
                        "raw_json": None,
                        "stdout_log": None,
                        "crash_log": None,
                        "attempts": 0,
                    }
                    for b in builds
                },
            }
            self._state["runs"][run_id] = run
            self._save_state()
        return run

    def list_runs(self):
        with self._lock:
            return [self._state["runs"][r] for r in sorted(self._state["runs"], key=int)]

    def get_run(self, run_id: str):
        with self._lock:
            return self._state["runs"].get(run_id)

    def _update_run(self, run_id: str, **fields):
        with self._lock:
            run = self._state["runs"][run_id]
            run.update(fields)
            self._save_state()

    def _update_build(self, run_id: str, build: str, **fields):
        with self._lock:
            run = self._state["runs"][run_id]
            run["per_build"][build].update(fields)
            self._save_state()

    # ------------------------------------------------------------------
    # Worker
    # ------------------------------------------------------------------

    def start(self):
        if self._worker is not None and self._worker.is_alive():
            return
        self._worker = threading.Thread(target=self._worker_loop, name="bench-worker", daemon=True)
        self._worker.start()

    def _worker_loop(self):
        while True:
            run = self._next_queued_run()
            if run is None:
                time.sleep(5)
                continue
            self._execute_run(run["id"])

    def _next_queued_run(self) -> dict | None:
        with self._lock:
            for run_id in sorted(self._state["runs"], key=int):
                run = self._state["runs"][run_id]
                if run["status"] == "queued":
                    return dict(run)
        return None

    # ------------------------------------------------------------------
    # Compose surface (re-read each run — reset --hard may have changed it)
    # ------------------------------------------------------------------

    def services(self) -> dict:
        return dc.load_compose_services(self.config.docker_dir / "docker-compose.yml")

    @staticmethod
    def _always_up_benchmarkable(build: str) -> bool:
        # Only ollama today: always-up shared instance, benchmarked via its
        # OpenAI-compatible /v1 API without stop/start. Everything else that
        # carries the always-up label is infra (litellm, db, monitoring) and
        # is not a benchmark target.
        return build == "ollama"

    # ------------------------------------------------------------------
    # Run lifecycle
    # ------------------------------------------------------------------

    def _execute_run(self, run_id: str):
        self._update_run(run_id, status="running", started_at=utcnow_iso())
        try:
            self._git_sync()
            services = self.services()
            targets = list(self.get_run(run_id)["builds"])
            unknown = [b for b in targets if b not in services]
            if unknown:
                raise RuntimeError(f"Unknown build/service names after git sync: {unknown}")

            self._establish_exclusivity(targets, services)
            self._wait_all_healthy(targets, services)

            for build in targets:
                self._benchmark_build(run_id, build, services)

            self._update_run(run_id, status="done", finished_at=utcnow_iso())
        except Exception as e:  # noqa: BLE001
            print(f"[run {run_id}] FAILED: {e}", flush=True)
            self._update_run(run_id, status="failed", error=str(e), finished_at=utcnow_iso())

    def _git_sync(self):
        checkout = self.config.checkout_dir
        env = self._git_env()
        print("[git] fetching + hard resetting checkout to origin/main ...", flush=True)
        dc.run(["git", "fetch", "origin", self.config.git_branch], cwd=str(checkout), env=env, timeout=300)
        dc.run(["git", "reset", "--hard", f"origin/{self.config.git_branch}"], cwd=str(checkout), env=env)

    def _git_env(self):
        env = dict(os.environ)
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {self.config.deploy_key} -o IdentitiesOnly=yes "
            f"-o StrictHostKeyChecking=yes -o UserKnownHostsFile={self.config.known_hosts}"
        )
        env["GIT_AUTHOR_NAME"] = self.config.git_author_name
        env["GIT_AUTHOR_EMAIL"] = self.config.git_author_email
        env["GIT_COMMITTER_NAME"] = self.config.git_author_name
        env["GIT_COMMITTER_EMAIL"] = self.config.git_author_email
        return env

    def _establish_exclusivity(self, targets: list, services: dict):
        """Stop every exclusive (non-always-up) service except this run's
        targets, freeing the GPU budget without cycling the targets
        themselves. Matches the old orchestrator's label-driven semantics."""
        stoppable = [name for name in dc.exclusive_services(services) if name not in targets]
        if not stoppable:
            print("[exclusivity] no non-target exclusive services running/defined — nothing to stop", flush=True)
            return
        print(f"[exclusivity] stopping exclusive services not in this run: {stoppable}", flush=True)
        dc.compose(["stop", *stoppable], self.config.docker_dir, timeout=600)

    def _wait_all_healthy(self, targets: list, services: dict):
        for build in targets:
            info = services[build]
            if info["always_up"]:
                # Always-up targets (ollama) are already up — just confirm healthy.
                print(f"[health] {build} is always-up, confirming reachable ...", flush=True)
                self._wait_healthy(build, info, already_up=True)
            else:
                print(f"[health] bringing up {build} ...", flush=True)
                dc.compose(["up", "-d", build], self.config.docker_dir, timeout=600)
                self._wait_healthy(build, info, already_up=False)

    def _wait_healthy(self, build: str, info: dict, already_up: bool):
        port = info["port"]
        if port is None:
            raise RuntimeError(f"Service '{build}' has no 127.0.0.1 port mapping — cannot health-check or benchmark")
        deadline = time.time() + self.config.health_wait_s
        while time.time() < deadline:
            if self._probe(port):
                print(f"[health] {build} healthy on :{port}", flush=True)
                return
            time.sleep(10)
        raise RuntimeError(f"Timed out waiting for {build} to become healthy on port {port}")

    @staticmethod
    def _probe(port: int) -> bool:
        # /health first (vLLM, llama-server); fall back to / for servers that
        # only answer at the root (ollama returns "Ollama is running" on /).
        for path in ("/health", "/"):
            result = dc.run(["curl", "-sf", "-o", "/dev/null", "-w", "%{http_code}", f"http://localhost:{port}{path}"], check=False)
            if result.returncode == 0 and result.stdout.strip() == "200":
                return True
        return False

    # ------------------------------------------------------------------
    # Per-build benchmark
    # ------------------------------------------------------------------

    def _benchmark_build(self, run_id: str, build: str, services: dict):
        self._update_build(run_id, build, status="running", attempts=0)
        info = services[build]
        port = info["port"]
        overrides = self._build_overrides(build)
        print(f"[bench] {build} on :{port}", flush=True)

        out_dir = self.config.checkout_dir / "builds" / build / "benchmarks" / _bench_key()
        out_dir.mkdir(parents=True, exist_ok=True)

        raw_json = out_dir / f"{ts_for_filename()}.json"
        stdout_log = out_dir / f"{raw_json.stem}-stdout.log"

        bench_cmd = self._bench_command(port, overrides, raw_json)

        try:
            # Crash handling: if the model container dies mid-bench, restart
            # it once and re-run the benchmark once; a second crash is a hard
            # failure with the container logs saved.
            max_attempts = 2
            for attempt in range(1, max_attempts + 1):
                self._update_build(run_id, build, attempts=attempt)
                crashed = self._run_bench_timed(bench_cmd, stdout_log, build, info)
                if not crashed:
                    break
                if attempt < max_attempts:
                    print(f"[bench] {build} crashed during attempt {attempt} — restarting and re-running once", flush=True)
                    dc.compose(["up", "-d", build], self.config.docker_dir, timeout=600)
                    self._wait_healthy(build, info, already_up=False)
                else:
                    crash_log = out_dir / f"{raw_json.stem}-crash.log"
                    self._save_crash_log(build, crash_log)
                    self._update_build(run_id, build, status="failed", crash_log=str(crash_log.relative_to(self.config.checkout_dir)))
                    raise RuntimeError(f"{build} crashed twice during benchmark; logs saved to {crash_log.relative_to(self.config.checkout_dir)}")

            self._validate_results(raw_json)
            print(f"[bench] {build} complete: {raw_json.relative_to(self.config.checkout_dir)}", flush=True)
            self._update_build(
                run_id, build, status="done",
                raw_json=str(raw_json.relative_to(self.config.checkout_dir)),
                stdout_log=str(stdout_log.relative_to(self.config.checkout_dir)),
            )
            self._commit_and_push([raw_json, stdout_log], f"bench: {build} llm-inference-bench raw results")
        except Exception as e:  # noqa: BLE001
            self._update_build(run_id, build, status="failed", error=str(e))
            raise

    def _bench_command(self, port: int, overrides: dict, raw_json: Path) -> list:
        cmd = [
            "python3", str(self.config.bench_script),
            "--host", "localhost",
            "--port", str(port),
            "--concurrency", overrides.get("concurrency", self.config.default_concurrency),
            "--contexts", overrides.get("contexts", self.config.default_contexts),
            "--duration", str(overrides.get("duration", self.config.default_duration)),
            "--max-tokens", str(overrides.get("max_tokens", self.config.default_max_tokens)),
            "--kv-budget", str(overrides.get("kv_budget", self.config.default_kv_budget)),
            "--output", str(raw_json),
        ]
        model = overrides.get("model")
        if model:
            cmd += ["--model", str(model)]
        return cmd

    def _build_overrides(self, build: str) -> dict:
        """Optional bench: overrides from builds/<build>/build.yaml. Missing
        file or section -> empty dict (defaults used)."""
        build_yaml = self.config.checkout_dir / "builds" / build / "build.yaml"
        if not build_yaml.exists():
            return {}
        try:
            data = yaml.safe_load(build_yaml.read_text()) or {}
        except (yaml.YAMLError, OSError) as e:
            print(f"[bench] WARNING: could not parse {build_yaml}: {e}; using defaults", flush=True)
            return {}
        return dict(data.get("bench") or {})

    def _run_bench_timed(self, bench_cmd: list, stdout_log: Path, build: str, info: dict) -> bool:
        """Run the tool, capturing stdout. Returns True if the model
        container crashed during the run (caller restarts + re-runs)."""
        with open(stdout_log, "w") as logf:
            proc = subprocess.Popen(bench_cmd, stdout=logf, stderr=subprocess.STDOUT, text=True)
            started = time.time()
            try:
                while True:
                    try:
                        proc.wait(timeout=10)
                        break
                    except subprocess.TimeoutExpired:
                        if time.time() - started > self.config.build_timeout_s:
                            proc.kill()
                            logf.flush()
                            raise RuntimeError(
                                f"Benchmark exceeded {self.config.build_timeout_s}s timeout for {build}"
                            )
                        if not dc.container_running(build) and not info["always_up"]:
                            proc.kill()
                            logf.flush()
                            return True
                if proc.returncode != 0:
                    # Nonzero exit with no container crash: the tool exited
                    # on its own (e.g. "No results collected" path exits 0,
                    # but a metrics-required SGLang path sys.exit(1)). Treat
                    # as failure; validation below adds the specific reason.
                    raise RuntimeError(f"llm_decode_bench.py exited {proc.returncode} for {build}")
            finally:
                logf.flush()
        return False

    def _save_crash_log(self, build: str, crash_log: Path):
        log = dc.run(["docker", "logs", build, "--tail", "300"], check=False).stdout
        crash_log.write_text(log)

    def _validate_results(self, raw_json: Path):
        if not raw_json.exists():
            raise RuntimeError(f"No results file written: {raw_json.relative_to(self.config.checkout_dir)}")
        try:
            data = json.loads(raw_json.read_text())
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Results file is not valid JSON: {raw_json.relative_to(self.config.checkout_dir)} ({e})")
        results = data.get("results") or []
        # Mirror benchmark_orchestrator.py's zero-completions hard-fail: a
        # benchmark that completed zero requests produced no usable data and
        # must never be committed as if it were real.
        completed = sum(1 for r in results if r.get("num_completed", 0) > 0)
        if not results or completed == 0:
            raise RuntimeError(
                f"No completions in {raw_json.relative_to(self.config.checkout_dir)} "
                f"({len(results)} cells, 0 completed) — refusing to trust empty data"
            )

    # ------------------------------------------------------------------
    # Git commit/push of results
    # ------------------------------------------------------------------

    def _commit_and_push(self, paths: list, message: str):
        checkout = self.config.checkout_dir
        env = self._git_env()
        rel = [str(Path(p).resolve().relative_to(checkout)) for p in paths]
        dc.run(["git", "pull", "--rebase", "origin", self.config.git_branch], cwd=str(checkout), env=env, timeout=300)
        dc.run(["git", "add", *rel], cwd=str(checkout), env=env)
        result = dc.run(["git", "commit", "-m", message], cwd=str(checkout), env=env, check=False)
        if result.returncode != 0:
            # Nothing staged (e.g. result identical to one already pushed) is
            # fine; anything else is a real error.
            if "nothing to commit" not in result.stdout:
                raise RuntimeError(f"git commit failed: {result.stdout[-2000:]}")
            return
        dc.run(["git", "push", "origin", self.config.git_branch], cwd=str(checkout), env=env, timeout=300)
