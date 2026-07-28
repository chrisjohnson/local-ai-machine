#!/usr/bin/env python3
"""Benchmark orchestrator — drives the real-data benchmark pass across
catalog/builds/*.yaml, following catalog/OPERATIONS.md's safety procedure
exactly.

Design constraints (see HANDOFF.md / OPERATIONS.md for full rationale):
  - Runs ON THE BOX (needs docker, sudo -n systemctl, the GPU). Not meant to
    be piloted over SSH from the Mac, though nothing stops that for --dry-run
    inspection.
  - Two-tier design (M-001): every verified model+engine build is its own
    compose service with a fixed port. The orchestrator stops all vLLM
    services to free the full GPU budget, starts the target service, runs
    benchmarks against its fixed port, then restores previously-running
    services. LiteLLM aliases role names to whichever localhost:<port> is
    the current pick for that role.
  - Ollama builds are no longer hard-skipped (re-enabled 2026-07-26 — 3 of 4
    registered Ollama models had their broken chat template fixed via
    RENDERER/PARSER Modelfile directives; see HANDOFF.md decision log). The
    remaining genuinely-broken build (gemma-4-26b-a4b-gguf, unsupported GGUF
    architecture on this pinned Ollama version) and the documented -rocm
    crash build are excluded the same way every other broken build is:
    status: BROKEN, checked below — no Ollama-specific carve-out needed.
  - Skips status: BROKEN builds and the MTP build/benchmark (no successful
    run exists yet anywhere).
  - Skips builds whose model isn't fully downloaded yet (checked live via
    .download-complete, not trusted from any snapshot/notes text) — deferred,
    picked up automatically on a future pass.
  - Resumable: skips builds that already have a benchmark_runs[] entry
    recording the current methodology version(s) for that build's engine
    family. Safe to Ctrl-C and rerun.
  - Does NOT write yaml.safe_dump over a whole build file — appends into the
    literal `benchmark_runs: []` (or the tail of an existing list) via text
    surgery, to avoid reformatting hand-written YAML.

Usage:
  python3 benchmark_orchestrator.py --dry-run                 # show the plan, do nothing
  python3 benchmark_orchestrator.py --only <build-id>          # run just one build (canary)
  python3 benchmark_orchestrator.py                            # run the full matrix (Phase 2 only)
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILDS_DIR = REPO_ROOT / "catalog" / "builds"
BENCHMARKS_DIR = REPO_ROOT / "catalog" / "benchmarks"
RAW_DIR = REPO_ROOT / "catalog" / "raw"
DOCKER_DIR = Path.home() / "local-ai-machine" / "docker"
SCRIPTS_DIR = REPO_ROOT / "scripts"
MODELS_ROOT = Path("/var/lib/ai-models")

# agentic_coding_benchmark.py lives alongside this file in scripts/ and is
# explicitly designed to be imported as a library by this orchestrator (see
# its own module docstring) — sys.path insert so `import
# agentic_coding_benchmark` resolves regardless of the caller's cwd (this
# script is sometimes invoked with cwd = REPO_ROOT, not SCRIPTS_DIR).
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import agentic_coding_benchmark as agentic_bench  # noqa: E402

VLLM_SPEED_BENCHMARK_ID = "vllm-speed-c1c8-v2"
CODING_BENCHMARK_ID = "seven-tier-coding-v2"
LLAMACPP_BENCH_ID = "llamacpp-bench-v1"
LLAMACPP_SERVER_CONCURRENT_ID = "llamacpp-server-concurrent-v1"
OLLAMA_WARM_REQUEST_ID = "ollama-warm-request-v2"
AGENTIC_OPENCODE_ID = "agentic-coding-session-opencode-v1"
AGENTIC_PI_ID = "agentic-coding-session-pi-v1"
# Both apply to every engine family (catalog/benchmarks/agentic-coding-session-
# *-v1.yaml: applies_to: [vllm, llamacpp, ollama]) — the harness talks to the
# candidate model exclusively through the litellm proxy's OpenAI-compatible
# endpoint, so it's agnostic to which engine is actually serving that alias
# underneath (same reasoning as run_coding_harness above).
AGENTIC_BENCHMARK_IDS = [AGENTIC_OPENCODE_ID, AGENTIC_PI_ID]

OLLAMA_CONTAINER = "ollama"
OLLAMA_PORT = 11434

# Builds excluded from this pass regardless of anything else.
EXCLUDED_BUILD_IDS = {
    "qwen3.6-27b--llamacpp-vulkan-radv-mtp-v1",  # status: BROKEN, MTP out of scope
}

TOOLBOX_IMAGE = "docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv"
VLLM_IMAGE = "docker.io/kyuz0/vllm-therock-gfx1151:latest"


def run(cmd, check=True, capture=True, timeout=None, cwd=None):
    """Run a shell-list command, return CompletedProcess. Logs the command."""
    printable = cmd if isinstance(cmd, str) else " ".join(cmd)
    log(f"$ {printable}")
    kwargs = dict(cwd=cwd, timeout=timeout)
    if capture:
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    result = subprocess.run(cmd, shell=isinstance(cmd, str), **kwargs)
    if capture and result.stdout:
        # Keep console output bounded; full output is saved to raw files by
        # callers that care, this is just operator visibility.
        tail = result.stdout[-4000:]
        print(tail)
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed (exit {result.returncode}): {printable}")
    return result


def log(msg):
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def utcnow_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------
# Build/benchmark catalog loading
# --------------------------------------------------------------------------

def load_yaml(path: Path):
    return yaml.safe_load(path.read_text())


def list_build_files():
    return sorted(BUILDS_DIR.glob("*.yaml"))


def model_download_complete(local_path: str) -> bool:
    """Check the real, live .download-complete marker — never trust build
    file notes/status text, which can drift (confirmed drift found live
    during this task: qwen3.5-122b-a10b--llamacpp's build file still says
    "download actively in progress" but the marker already exists)."""
    if not local_path:
        return False
    return (Path(local_path) / ".download-complete").exists()


def engine_family(engine_id: str) -> str:
    if engine_id.startswith("vllm"):
        return "vllm"
    if engine_id.startswith("llamacpp"):
        return "llamacpp"
    if engine_id.startswith("ollama"):
        return "ollama"
    return "unknown"


def already_has_run(build: dict, benchmark_id: str) -> bool:
    for run_entry in build.get("benchmark_runs") or []:
        if run_entry.get("benchmark_id") == benchmark_id:
            return True
    return False


def expected_benchmark_ids(build: dict, family: str) -> list:
    """Single source of truth for "which benchmark_ids should this build
    eventually have, given its engine family/variant". Both the plan-level
    skip-vs-run decision in main() and each process_*_build()'s internal
    per-benchmark gating must derive from this same list — otherwise a
    newly-added benchmark_id can be wired into one call site (e.g. a
    process_*_build() function) but forgotten in the other (the plan-level
    skip check), which would silently skip already-partially-benchmarked
    builds forever instead of scheduling them for just the missing piece.

    Extending to a new benchmark methodology (e.g. an agentic-coding-session
    benchmark) that applies to every engine family: add its benchmark_id
    constant near the top of this file, append it to the relevant list(s)
    below, then give each process_*_build() a `already_has_run(build, ID)`
    gate before running it (same pattern already used for every id here) —
    no other call site needs to change, this function is the only registry.
    """
    if family == "vllm":
        return [VLLM_SPEED_BENCHMARK_ID, CODING_BENCHMARK_ID, *AGENTIC_BENCHMARK_IDS]
    if family == "llamacpp":
        ids = [LLAMACPP_BENCH_ID, CODING_BENCHMARK_ID, *AGENTIC_BENCHMARK_IDS]
        if build.get("engine") == "llamacpp-vulkan-radv-server-v1":
            ids.append(LLAMACPP_SERVER_CONCURRENT_ID)
        return ids
    if family == "ollama":
        return [OLLAMA_WARM_REQUEST_ID, *AGENTIC_BENCHMARK_IDS]
    return []


def missing_benchmark_ids(build: dict, family: str) -> list:
    """Benchmark_ids expected for this build's family/variant that are not
    yet recorded — the generic per-benchmark-id idempotency check. Empty
    list means the build is fully done and can be skipped; a non-empty list
    means the build should be scheduled to run, even if some other expected
    id is already recorded (partial completion is not "done")."""
    return [bid for bid in expected_benchmark_ids(build, family) if not already_has_run(build, bid)]


def gather_plan(only_build_id=None):
    """Return list of (build_id, path, build_dict, reason_skip_or_None)."""
    plan = []
    for path in list_build_files():
        build_id = path.stem
        build = load_yaml(path)
        if only_build_id and build_id != only_build_id:
            continue

        engine_id = build.get("engine", "")
        family = engine_family(engine_id)
        local_path = build.get("model", {}).get("local_path")

        skip_reason = None
        if build_id in EXCLUDED_BUILD_IDS:
            skip_reason = "excluded (BROKEN/MTP, out of scope this pass)"
        elif build.get("status") == "BROKEN":
            skip_reason = "status: BROKEN"
        elif family not in ("vllm", "llamacpp", "ollama"):
            skip_reason = f"unrecognized engine family for engine={engine_id!r}"
        elif not model_download_complete(local_path):
            skip_reason = f"model not fully downloaded yet (.download-complete missing at {local_path})"

        plan.append((build_id, path, build, family, skip_reason))
    return plan


# --------------------------------------------------------------------------
# Preflight / teardown (OPERATIONS.md procedure)
# --------------------------------------------------------------------------

def list_activating_download_units():
    result = run(
        ["systemctl", "list-units", "download-model-*", "--all", "--no-legend"],
        check=False,
    )
    units = []
    for line in result.stdout.splitlines():
        if "activating" not in line:
            continue
        parts = line.split()
        # Leading column over SSH/non-tty is a bullet "●" as parts[0] when
        # present, unit name is parts[1] in that case, else parts[0].
        # Robust approach: find the first token ending in ".service".
        for tok in parts:
            if tok.endswith(".service"):
                units.append(tok)
                break
    return units


def pause_downloads():
    units = list_activating_download_units()
    if not units:
        log("Preflight: no activating download-model-* units, nothing to pause.")
        return []
    log(f"Preflight: pausing {len(units)} active download unit(s): {units}")
    run(["sudo", "-n", "systemctl", "stop", *units])
    return units


def resume_downloads(paused_units):
    if not paused_units:
        log("Teardown: no downloads were paused for this run, nothing to resume.")
        return
    log(f"Teardown: resuming {len(paused_units)} download unit(s): {paused_units}")
    # --no-block is required here — real bug found during the first canary
    # run: these are Type=oneshot units with no RemainAfterExit, so a plain
    # `systemctl start` blocks the CLIENT (and therefore this whole script)
    # until the unit's ExecStart process actually exits, which for a
    # multi-hour model download means the orchestrator hangs for hours after
    # "resuming" a download, never reaching the next build or printing
    # "=== Done ===". --no-block only changes how long the systemctl client
    # waits for job completion before returning; it does not change how the
    # service itself starts or run in the background. Confirmed live: the
    # download process (flock-waiting child of the oneshot's ExecStart) was
    # already running correctly even while the blocking `systemctl start`
    # call sat unfinished — this is a orchestrator responsiveness bug, not a
    # safety bug (downloads were already resuming correctly).
    run(["sudo", "-n", "systemctl", "start", "--no-block", *paused_units], check=False)


def check_no_other_benchmark_activity():
    result = run(["ps", "aux"], check=False)
    patterns = ["vllm bench serve", "llama-bench", "coding_benchmark.py"]
    hits = [ln for ln in result.stdout.splitlines() if any(p in ln for p in patterns) and "grep" not in ln]
    # Exclude our own process line noise (ps aux itself, this script's argv
    # won't match any pattern above).
    if hits:
        raise RuntimeError(
            "Preflight: another benchmark/harness process appears to be running:\n"
            + "\n".join(hits)
        )


_COMPOSE_SERVICES_CACHE = None


def _load_compose_services():
    """Parse docker-compose.yml and return dict keyed by service name with
    port (host-side int) and served_model_name (from --served-model-name
    flag in command, or None for non-vLLM services)."""
    global _COMPOSE_SERVICES_CACHE
    if _COMPOSE_SERVICES_CACHE is not None:
        return _COMPOSE_SERVICES_CACHE
    compose_path = DOCKER_DIR / "docker-compose.yml"
    with open(compose_path) as f:
        compose = yaml.safe_load(f)
    services = {}
    for svc_name, svc in (compose.get("services") or {}).items():
        port = None
        for p in svc.get("ports") or []:
            parts = str(p).split(":")
            if len(parts) >= 2 and parts[0] == "127.0.0.1":
                try:
                    port = int(parts[1])
                except ValueError:
                    pass
                break
        served_name = None
        cmd = svc.get("command")
        if cmd:
            cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
            if "--served-model-name" in cmd_str:
                parts = cmd_str.split()
                for i, part in enumerate(parts):
                    if part == "--served-model-name" and i + 1 < len(parts):
                        served_name = parts[i + 1]
                        break
        services[svc_name] = {"port": port, "served_model_name": served_name}
    _COMPOSE_SERVICES_CACHE = services
    return services


def list_vllm_services():
    """Return list of service names whose ports are in the vLLM range (8000-8099)."""
    return [
        name for name, info in _load_compose_services().items()
        if info["port"] is not None and 8000 <= info["port"] <= 8099
    ]


def find_running_vllm_services():
    """Return list of vLLM compose service names that are currently running."""
    result = run(
        ["docker", "compose", "ps", "--services", "--filter", "status=running"],
        cwd=str(DOCKER_DIR), check=False,
    )
    running = result.stdout.strip().splitlines()
    vllm_names = set(list_vllm_services())
    return [s for s in running if s in vllm_names]


def get_compose_service_port(service_name):
    """Return the host port for a compose service, or raise if not found."""
    info = _load_compose_services().get(service_name)
    if info is None or info["port"] is None:
        raise RuntimeError(f"Service '{service_name}' not found in docker-compose.yml or has no port mapping")
    return info["port"]


def get_compose_served_name(service_name):
    """Return the --served-model-name for a compose service, or raise."""
    info = _load_compose_services().get(service_name)
    if info is None:
        raise RuntimeError(f"Service '{service_name}' not found in docker-compose.yml")
    if info["served_model_name"] is None:
        raise RuntimeError(f"Service '{service_name}' has no --served-model-name in its command")
    return info["served_model_name"]


def stop_all_vllm_services():
    """Stop all vLLM compose services to free the full GPU budget."""
    vllm_svcs = list_vllm_services()
    if not vllm_svcs:
        log("No vLLM services found in compose — nothing to stop.")
        return
    log(f"Stopping all vLLM services ({len(vllm_svcs)} services) for full GPU budget.")
    run(["docker", "compose", "stop", *vllm_svcs], cwd=str(DOCKER_DIR))


def start_compose_service(service_name):
    """Start a single compose service and wait for it to become healthy."""
    port = get_compose_service_port(service_name)
    log(f"Starting {service_name} on port {port} ...")
    run(["docker", "compose", "up", "-d", service_name], cwd=str(DOCKER_DIR))
    deadline = time.time() + 20 * 60
    while time.time() < deadline:
        if run(["curl", "-sf", f"http://localhost:{port}/health"], check=False).returncode == 0:
            log(f"{service_name} healthy on :{port} after {int(time.time() - (deadline - 20*60))}s.")
            return
        time.sleep(10)
    raise RuntimeError(f"Timed out waiting for {service_name} to become healthy on port {port}.")


def restore_vllm_services(services):
    """Restart the given vLLM services and wait for all to become healthy."""
    if not services:
        log("No services to restore.")
        return
    log(f"Restoring vLLM services: {services}")
    run(["docker", "compose", "up", "-d", *services], cwd=str(DOCKER_DIR))
    deadline = time.time() + 20 * 60
    while time.time() < deadline:
        all_ok = True
        for svc in services:
            port = get_compose_service_port(svc)
            if run(["curl", "-sf", f"http://localhost:{port}/health"], check=False).returncode != 0:
                all_ok = False
                break
        if all_ok:
            log(f"All {len(services)} restored services healthy.")
            return
        time.sleep(10)
    raise RuntimeError(f"Timed out waiting for restored vLLM services to become healthy.")


def cleanup_stale_containers():
    """Startup cleanup pass: remove ad hoc containers left over from a
    previous crashed run (llama-server instances from llamacpp benchmarks)."""
    log("Startup cleanup: removing any stale ad hoc containers from a previous crashed run.")
    result = run(["docker", "ps", "-a", "--format", "{{.Names}}"], check=False)
    names = result.stdout.split()
    stale = [n for n in names if n.startswith("llama-server-")]
    for n in stale:
        log(f"Removing stale container: {n}")
        run(["docker", "rm", "-f", n], check=False)


def ensure_default_services_up():
    """Ensure the default coder and judge services are up and healthy at
    startup. These are the standing services that LiteLLM routes to."""
    default_coder = "qwen3.6-35b-a3b--vllm-therock-gfx1151-v1"
    default_judge = "qwen3.5-4b--vllm-therock-gfx1151-v1"
    log(f"Startup: ensuring default services ({default_coder}, {default_judge}) are up.")
    run(["docker", "compose", "up", "-d", default_coder, default_judge], cwd=str(DOCKER_DIR))
    for svc in (default_coder, default_judge):
        start_compose_service(svc)


# --------------------------------------------------------------------------
# Fingerprint capture
# --------------------------------------------------------------------------

def capture_host_fingerprint_common():
    kernel = run(["uname", "-r"], check=False).stdout.strip()
    repo_commit = run(["git", "rev-parse", "HEAD"], check=False, cwd=str(REPO_ROOT)).stdout.strip()
    return kernel, repo_commit


def capture_gpu_driver_via_toolbox():
    """Mesa/RADV driver version, read via vulkaninfo inside the toolbox
    image (cheap, no GPU device access needed for --summary metadata)."""
    result = run(
        [
            "docker", "run", "--rm",
            "--device", "/dev/kfd", "--device", "/dev/dri",
            "--group-add", "26", "--group-add", "303",
            TOOLBOX_IMAGE,
            "vulkaninfo", "--summary",
        ],
        check=False,
    )
    for line in result.stdout.splitlines():
        if "driverInfo" in line and "radv" not in line.lower():
            continue
        if "driverInfo" in line:
            return line.split("=", 1)[1].strip()
    # Fallback: just grab the first driverInfo line seen.
    for line in result.stdout.splitlines():
        if "driverInfo" in line:
            return line.split("=", 1)[1].strip()
    return "unknown"


def vllm_image_digest_and_version(container_name):
    image_id = run(["docker", "inspect", container_name, "--format", "{{.Image}}"]).stdout.strip()
    digest_out = run(["docker", "inspect", image_id, "--format", "{{.RepoDigests}}"]).stdout.strip()
    version = run(["docker", "exec", container_name, "vllm", "--version"], check=False).stdout.strip().splitlines()[-1]
    return digest_out, version


def toolbox_image_digest():
    run(["docker", "pull", TOOLBOX_IMAGE], check=False)
    image_id = run(["docker", "inspect", TOOLBOX_IMAGE, "--format", "{{.Id}}"]).stdout.strip()
    digest_out = run(["docker", "inspect", TOOLBOX_IMAGE, "--format", "{{.RepoDigests}}"]).stdout.strip()
    return digest_out


# --------------------------------------------------------------------------
# YAML surgery — append to benchmark_runs[] without a full re-dump
# --------------------------------------------------------------------------

def render_run_entry_yaml(entry: dict, indent: int = 2) -> str:
    """Render a single benchmark_runs[] entry as a YAML list item, indented
    to match hand-written build-file style (2-space list items under the
    top-level `benchmark_runs:` key)."""
    # allow_unicode=True — without it, real non-ASCII chars (the llama-bench
    # "±" pp512/tg128 figures) get backslash-escaped (\xB1) in the raw YAML
    # text. Re-parses fine either way (cosmetic only, found reviewing
    # canary 2's committed output), but the plain "±" is much more readable
    # for a human skimming the build file directly.
    body = yaml.safe_dump(entry, sort_keys=False, default_flow_style=False, width=100, allow_unicode=True)
    lines = body.rstrip("\n").split("\n")
    out = []
    pad = " " * indent
    for i, line in enumerate(lines):
        if i == 0:
            out.append(f"{pad}- {line}")
        else:
            out.append(f"{pad}  {line}")
    return "\n".join(out) + "\n"


def append_benchmark_run(build_path: Path, entry: dict):
    text = build_path.read_text()
    entry_yaml = render_run_entry_yaml(entry)

    if "benchmark_runs: []" in text:
        new_text = text.replace("benchmark_runs: []", "benchmark_runs:\n" + entry_yaml.rstrip("\n"), 1)
    elif re.search(r"^benchmark_runs:\s*$", text, re.MULTILINE):
        # Existing non-empty list — append after the last top-level list
        # item block. Find the benchmark_runs: line, then find where the
        # list block ends (next line that is not indented under it, or EOF).
        lines = text.split("\n")
        start = None
        for i, line in enumerate(lines):
            if re.match(r"^benchmark_runs:\s*$", line):
                start = i
                break
        if start is None:
            raise RuntimeError(f"{build_path}: could not locate benchmark_runs: block")
        end = len(lines)
        for j in range(start + 1, len(lines)):
            line = lines[j]
            if line.strip() == "":
                continue
            # A line belongs to the list block if it starts with at least
            # 2 spaces (list items / their nested content). Top-level keys
            # (status:, created:, etc.) start at column 0.
            if not line.startswith("  "):
                end = j
                break
        else:
            end = len(lines)
        new_lines = lines[:end] + entry_yaml.rstrip("\n").split("\n") + lines[end:]
        new_text = "\n".join(new_lines)
    else:
        raise RuntimeError(f"{build_path}: no `benchmark_runs: []` or `benchmark_runs:` block found")

    build_path.write_text(new_text)


# --------------------------------------------------------------------------
# git commit/push helper
# --------------------------------------------------------------------------

def git_commit_and_push(paths, message, dry_run=False):
    if dry_run:
        log(f"[dry-run] would git add {paths} and commit: {message!r}")
        return
    rel_paths = [str(Path(p).resolve().relative_to(REPO_ROOT)) for p in paths]
    run(["git", "add", *rel_paths], cwd=str(REPO_ROOT))
    run(["git", "commit", "-m", message], cwd=str(REPO_ROOT))
    run(["git", "push"], cwd=str(REPO_ROOT))


# --------------------------------------------------------------------------
# vLLM speed benchmark (c1/c8, 3 trials each, v2 methodology)
# --------------------------------------------------------------------------

def parse_vllm_footprint_from_log(log_text: str):
    """Best-effort extraction of weights_gib / kv_cache_gib / kv_tokens /
    max_concurrency from a vLLM server startup log. Returns a dict; any
    field not found is left as null rather than guessed.

    Regexes validated 2026-07-24 against real vllm-primary startup log
    lines (gpu_model_runner.py / gpu_worker.py / kv_cache_utils.py INFO
    lines), not guessed from field names alone:
      "Model loading took 65.53 GiB memory and 97.871027 seconds"
      "Available KV cache memory: 18.64 GiB"
      "GPU KV cache size: 925,508 tokens"
      "Maximum concurrency for 131,072 tokens per request: 7.06x"
    """
    footprint = {"weights_gib": None, "kv_cache_gib": None, "kv_tokens": None, "max_concurrency": None}
    m = re.search(r"Model loading took\s+([\d.]+)\s*GiB", log_text)
    if m:
        footprint["weights_gib"] = float(m.group(1))
    m = re.search(r"Available KV cache memory:\s*([\d.]+)\s*GiB", log_text)
    if m:
        footprint["kv_cache_gib"] = float(m.group(1))
    m = re.search(r"GPU KV cache size:\s*([\d,]+)\s*tokens", log_text)
    if m:
        footprint["kv_tokens"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Maximum concurrency for [\d,]+ tokens per request:\s*([\d.]+)x", log_text)
    if m:
        footprint["max_concurrency"] = float(m.group(1))
    return footprint


def run_vllm_bench_serve_trial(container, port, served_name, model_dir, backend, endpoint, out_len, num_prompts, conc, result_path_in_container):
    cmd = [
        "docker", "exec", container, "vllm", "bench", "serve",
        "--backend", backend,
        "--base-url", f"http://localhost:{port}",
        "--endpoint", endpoint,
        "--model", served_name,
        "--tokenizer", f"/models/{model_dir}",
        "--dataset-name", "random",
        "--random-input-len", "2048",
        "--random-output-len", str(out_len),
        "--max-concurrency", str(conc),
        "--num-prompts", str(num_prompts),
        "--ignore-eos",
        "--save-result", "--result-dir", "/tmp",
        "--result-filename", result_path_in_container,
    ]
    # Known client segfault-on-exit right after a run completes — tolerate
    # nonzero exit, verify success via the result file's existence instead.
    # 5400s (up from 2400s) — 2400s genuinely wasn't enough: gemma-4-31b-it's
    # c1 trial 1 (20 prompts, concurrency 1, 512 output tokens) timed out for
    # real at 2400s during the unattended run on 2026-07-25, confirmed via
    # llama-bench-adjacent evidence this model runs ~3.3 tok/s single-stream
    # (documented in its own build file as "slowest model tested all
    # session") — 20 * 512 / 3.3 ~= 3100s needed for that trial alone, with
    # no margin. 5400s gives real headroom above the worst case seen so far.
    run(cmd, check=False, timeout=5400)
    check = run(["docker", "exec", container, "test", "-f", f"/tmp/{result_path_in_container}"], check=False)
    if check.returncode != 0:
        raise RuntimeError(f"vllm bench serve trial produced no result file: {result_path_in_container}")
    raw = run(["docker", "exec", container, "cat", f"/tmp/{result_path_in_container}"]).stdout
    data = json.loads(raw)
    # Real bug found 2026-07-25: a wrong --base-url (port mismatch on a
    # standing service) made every request fail instantly, but the result
    # file still gets written with completed=0/failed=N — the file-exists
    # check alone let bogus all-zero data through as if it were a real
    # trial. Treat zero completions as a hard failure, not silent bad data.
    if data.get("completed", 0) == 0:
        raise RuntimeError(f"vllm bench serve trial completed 0/{data.get('failed', '?')} requests — every request failed: {result_path_in_container}")
    return data


def summarize_trials(trials, keys):
    import statistics
    out = {}
    for key in keys:
        vals = [t.get(key) for t in trials if t.get(key) is not None]
        out[key] = {
            "raw": vals,
            "mean": statistics.mean(vals) if vals else None,
            "stddev": statistics.stdev(vals) if len(vals) > 1 else 0.0 if vals else None,
        }
    return out


def run_vllm_speed_benchmark(build_id, build, container, port, served_name, model_dir, backend, endpoint, timestamp, dry_run):
    log(f"[{build_id}] Running vLLM speed benchmark ({VLLM_SPEED_BENCHMARK_ID}) against {served_name} on {container}.")
    if dry_run:
        log(f"[dry-run] would run c1 (3 trials) + c8 (3 trials) vllm bench serve against {served_name}")
        return None

    metric_keys = [
        "output_throughput", "total_token_throughput",
        "mean_ttft_ms", "median_ttft_ms", "p99_ttft_ms",
        "mean_tpot_ms", "median_tpot_ms", "p99_tpot_ms",
    ]

    # Footprint capture MUST happen before running any trials, not after —
    # real bug found in the first canary run: capturing after 6 trials'
    # worth of per-request log lines (30+ min of traffic) pushed the
    # one-time "Model loading took...GiB"/"GPU KV cache size..." startup
    # lines completely out of even a --tail 400 window, leaving every
    # footprint field null. The container is freshly healthy at this point
    # (for a swap-in) or has comparatively little traffic yet (for a
    # standing service argument, still safer to capture early), so this is
    # the right place to read it, once, before traffic accumulates.
    server_log = run(["docker", "logs", container, "--tail", "2000"], check=False).stdout
    footprint = parse_vllm_footprint_from_log(server_log)
    log_out = RAW_DIR / f"{build_id}--{VLLM_SPEED_BENCHMARK_ID}--server-log--{timestamp}.txt"
    log_out.write_text(server_log)

    configs = {
        "c1": {"out_len": 512, "num_prompts": 20, "conc": 1},
        "c8": {"out_len": 256, "num_prompts": 100, "conc": 8},
    }
    raw_results = {}
    trial_summaries = {}
    for tier, cfg in configs.items():
        trials = []
        for trial_n in range(1, 4):
            fname = f"{build_id}--{tier}-trial{trial_n}.json"
            log(f"[{build_id}] {tier} trial {trial_n}/3 ...")
            data = run_vllm_bench_serve_trial(
                container, port, served_name, model_dir, backend, endpoint,
                cfg["out_len"], cfg["num_prompts"], cfg["conc"], fname,
            )
            trials.append(data)
            raw_out = RAW_DIR / f"{build_id}--{VLLM_SPEED_BENCHMARK_ID}--{tier}-trial{trial_n}--{timestamp}.json"
            raw_out.write_text(json.dumps(data, indent=2))
            raw_results.setdefault(tier, []).append(str(raw_out.relative_to(REPO_ROOT)))
        trial_summaries[tier] = summarize_trials(trials, metric_keys)

    return {
        "trial_summaries": trial_summaries,
        "footprint": footprint,
        "raw_files": raw_results,
        "server_log_raw_file": str(log_out.relative_to(REPO_ROOT)),
    }


# --------------------------------------------------------------------------
# llama.cpp: llama-bench (speed) and llama-server (coding-tier + concurrency)
# --------------------------------------------------------------------------

def first_gguf_path(build: dict) -> str:
    files = build.get("model", {}).get("files")
    if not files:
        raise RuntimeError("build has no model.files entries — cannot construct -m path")
    first = files[0] if isinstance(files, list) else files
    return first


def run_llamacpp_bench(build_id, build, timestamp, dry_run):
    model_dir = Path(build["model"]["local_path"]).name
    gguf_rel = first_gguf_path(build)
    log(f"[{build_id}] Running llama-bench ({LLAMACPP_BENCH_ID}) on /models/{gguf_rel}.")
    if dry_run:
        log(f"[dry-run] would docker run llama-bench -m /models/{gguf_rel} -ngl 999 -fa 1 -lm none")
        return None

    cmd = [
        "docker", "run", "--rm",
        "--device", "/dev/kfd", "--device", "/dev/dri",
        "--group-add", "26", "--group-add", "303",
        "-v", f"/var/lib/ai-models/{model_dir}:/models:ro",
        TOOLBOX_IMAGE,
        "llama-bench", "-m", f"/models/{gguf_rel}", "-ngl", "999", "-fa", "1", "-lm", "none",
    ]
    # 3600s (up from 1800s) — margin for the largest still-untested models
    # in the queue (e.g. MiniMax-M2.7, 228B total params) where model load
    # alone could plausibly eat a large chunk of a 30min budget before
    # pp512/tg128 even starts.
    result = run(cmd, check=True, timeout=3600)
    raw_out = RAW_DIR / f"{build_id}--{LLAMACPP_BENCH_ID}--{timestamp}.txt"
    raw_out.write_text(result.stdout)

    build_hash = None
    m = re.search(r"build:\s*(\S+)\s*\((\d+)\)", result.stdout)
    if m:
        build_hash = f"{m.group(1)} ({m.group(2)})"

    pp512 = None
    tg128 = None
    for line in result.stdout.splitlines():
        if "pp512" in line and "|" in line:
            cols = [c.strip() for c in line.split("|")]
            for c in cols:
                if re.match(r"^[\d.]+\s*±\s*[\d.]+$", c):
                    pp512 = c
        if "tg128" in line and "|" in line:
            cols = [c.strip() for c in line.split("|")]
            for c in cols:
                if re.match(r"^[\d.]+\s*±\s*[\d.]+$", c):
                    tg128 = c

    return {
        "pp512_tok_s": pp512,
        "tg128_tok_s": tg128,
        "engine_build": build_hash,
        "raw_stdout_file": str(raw_out.relative_to(REPO_ROOT)),
    }


def start_llama_server(build_id, build, port, np_slots, ctx_size):
    model_dir = Path(build["model"]["local_path"]).name
    gguf_rel = first_gguf_path(build)
    container = f"llama-server-{build_id}"
    run(["docker", "rm", "-f", container], check=False)
    cmd = [
        "docker", "run", "-d", "--name", container,
        "--device", "/dev/kfd", "--device", "/dev/dri",
        "--group-add", "26", "--group-add", "303",
        "-p", f"127.0.0.1:{port}:8080",
        "-v", f"/var/lib/ai-models/{model_dir}:/models:ro",
        TOOLBOX_IMAGE,
        "llama-server", "-m", f"/models/{gguf_rel}", "-ngl", "999", "-fa", "1", "-lm", "none",
        "--host", "0.0.0.0", "--port", "8080",
        "-np", str(np_slots), "-cb", "-kvu", "-c", str(ctx_size),
    ]
    run(cmd)
    log(f"[{build_id}] Waiting for llama-server ({container}) health on port {port}.")
    deadline = time.time() + 20 * 60
    while time.time() < deadline:
        ok = run(["curl", "-sf", f"http://localhost:{port}/health"], check=False).returncode == 0
        if ok:
            log(f"[{build_id}] llama-server healthy.")
            return container
        if run(["docker", "ps", "--filter", f"name={container}", "--filter", "status=running", "-q"], check=False).stdout.strip() == "":
            logs = run(["docker", "logs", container, "--tail", "150"], check=False).stdout
            run(["docker", "rm", "-f", container], check=False)
            raise RuntimeError(f"llama-server container exited before healthy:\n{logs[-3000:]}")
        time.sleep(10)
    run(["docker", "logs", container, "--tail", "150"], check=False)
    run(["docker", "rm", "-f", container], check=False)
    raise RuntimeError("Timed out waiting for llama-server health.")


def stop_llama_server(container):
    run(["docker", "rm", "-f", container], check=False)


def get_llama_server_build_fingerprint(container):
    logs = run(["docker", "logs", container, "--tail", "400"], check=False).stdout
    m = re.search(r"build:\s*(\S+)\s*\((\d+)\)", logs)
    return f"{m.group(1)} ({m.group(2)})" if m else None


def run_coding_harness(build_id, base_url, served_name, timestamp, dry_run):
    log(f"[{build_id}] Running coding_benchmark.py ({CODING_BENCHMARK_ID}) against {base_url} model={served_name}.")
    if dry_run:
        log(f"[dry-run] would run coding_benchmark.py --base-url {base_url} --model {served_name}")
        return None
    out_path = RAW_DIR / f"{build_id}--{CODING_BENCHMARK_ID}--{timestamp}.json"
    cmd = [
        sys.executable, str(SCRIPTS_DIR / "coding_benchmark.py"),
        "--base-url", base_url,
        "--model", served_name,
        "--output", str(out_path),
    ]
    # Real bug found running canary 2 (qwen3.6-27b via llama-server, ~12.5
    # tok/s): a 1800s (30min) wrapper timeout is fine for vLLM-speed engines
    # (canary 1's full harness took ~5min) but genuinely too short for a
    # slow llama.cpp backend across 22+ tasks, several with an 8192-token
    # budget — killed the harness mid-run with subprocess.TimeoutExpired,
    # silently producing zero data (no raw JSON, no benchmark_runs entry,
    # no commit) while still reporting a clean-looking teardown afterward.
    # seven-tier-coding-v2's own `timeout_s: 1500` is a PER-REQUEST budget
    # inside coding_benchmark.py's call_model(), not a whole-harness one —
    # this wrapper timeout is a separate, outer safety net against a truly
    # hung process, not the harness's own pacing control. Set generously
    # (3 hours) so it only fires on a genuine hang, not a slow-but-working
    # engine; still bounded so a real hang doesn't run forever unattended.
    run(cmd, timeout=10800)
    data = json.loads(out_path.read_text())
    return {
        "tier_scores": {
            t: {"pass": data[f"tier_{t.lower()}_pass"], "total": data[f"tier_{t.lower()}_total"]}
            for t in ["a", "b", "j", "p", "d", "q", "l"]
        },
        "raw_file": str(out_path.relative_to(REPO_ROOT)),
    }


AGENTIC_HARNESS_FOR_ID = {AGENTIC_OPENCODE_ID: "opencode", AGENTIC_PI_ID: "pi"}


def run_agentic_tasks(build_id, benchmark_id, base_url, served_name, dry_run):
    """Runs all 3 agentic-coding-session tasks (docs-research-v1,
    docker-lifecycle-v1, git-pr-ci-v1) for one harness
    (opencode/agentic-coding-session-opencode-v1 or
    pi/agentic-coding-session-pi-v1), via agentic_coding_benchmark.py's own
    library entrypoint (run_all_tasks — imported directly, not shelled out,
    per that script's own module docstring: "Normal usage is as a library,
    imported by scripts/benchmark_orchestrator.py").

    This is a genuinely long-running leg — up to 45min/task x 3 tasks =
    2h15m worst case per harness, per M-021's wall-clock ceiling — so unlike
    the other legs in this file it is NOT bounded by an additional outer
    subprocess timeout here: agentic_coding_benchmark.py already
    self-enforces the per-task 45min ceiling internally (run_harness_process),
    so there is no unbounded-hang risk left for this call to guard against.

    Returns a dict shaped for a benchmark_runs[] entry's `result` field:
    one entry per task_id with pass_count/total_count/wall_clock_s/
    terminated_reason/transcript_raw_file, matching the methodology YAMLs'
    metrics_schema.
    """
    harness = AGENTIC_HARNESS_FOR_ID[benchmark_id]
    log(f"[{build_id}] Running {benchmark_id} (harness={harness}) against {base_url} model={served_name} — "
        f"3 tasks, up to {agentic_bench.WALL_CLOCK_CEILING_S}s each.")
    if dry_run:
        log(f"[dry-run] would run agentic_coding_benchmark.run_all_tasks(harness={harness!r}, "
            f"build_id={build_id!r}, base_url={base_url!r}, served_name={served_name!r}) "
            f"across tasks {agentic_bench.TASK_IDS}")
        return None

    task_results = agentic_bench.run_all_tasks(
        harness=harness, build_id=build_id, base_url=base_url, served_name=served_name,
    )
    result = {r["task_id"]: r for r in task_results}
    for task_id, r in result.items():
        log(f"[{build_id}] {benchmark_id}/{task_id}: {r['pass_count']}/{r['total_count']} "
            f"({r['terminated_reason']}, {r['wall_clock_s']:.0f}s)")
    return result


CORRECTNESS_PROMPTS = [
    ("what is 17*23? Answer with just the number.", "391"),
    ("what is the capital of France? Answer with just the city name.", "paris"),
    ("repeat the word BANANA five times separated by spaces, nothing else.", "banana"),
    ("what color is the sky on a clear day? one word.", "blue"),
]


def run_llama_server_correctness_check(base_url, served_name):
    import urllib.request

    results = []
    for prompt, expect_substr in CORRECTNESS_PROMPTS:
        payload = json.dumps({
            "model": served_name or "default",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 800,
        }).encode()
        req = urllib.request.Request(
            f"{base_url}/v1/chat/completions", data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read())
            content = body["choices"][0]["message"]["content"]
            passed = expect_substr.lower() in content.lower()
        except Exception as e:  # noqa: BLE001
            content = f"ERROR: {e}"
            passed = False
        results.append({"prompt": prompt, "response": content[:300], "passed": passed})
    return results


def run_llamacpp_server_concurrent(build_id, base_url, served_name, port, timestamp, dry_run):
    log(f"[{build_id}] Running llama-server concurrency benchmark ({LLAMACPP_SERVER_CONCURRENT_ID}).")
    if dry_run:
        log("[dry-run] would run correctness check then c1/c4 concurrent load test")
        return None

    correctness = run_llama_server_correctness_check(base_url, served_name)
    all_pass = all(r["passed"] for r in correctness)
    result = {"correctness_check": correctness, "correctness_passed": all_pass}
    raw_out = RAW_DIR / f"{build_id}--{LLAMACPP_SERVER_CONCURRENT_ID}--{timestamp}.json"

    if not all_pass:
        log(f"[{build_id}] CORRECTNESS CHECK FAILED — refusing to trust throughput numbers, per known_gotchas.")
        raw_out.write_text(json.dumps(result, indent=2))
        result["raw_file"] = str(raw_out.relative_to(REPO_ROOT))
        return result

    # c1 and c4 concurrent timing, using `curl -w time_total`.
    def timed_request(prompt):
        import urllib.request
        payload = json.dumps({
            "model": served_name or "default",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 512,
        }).encode()
        req = urllib.request.Request(
            f"{base_url}/v1/chat/completions", data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        start = time.time()
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.loads(resp.read())
        elapsed = time.time() - start
        usage = body.get("usage", {})
        return elapsed, usage.get("completion_tokens")

    import concurrent.futures

    def run_concurrency_level(n):
        prompts = [p for p, _ in CORRECTNESS_PROMPTS] * ((n // len(CORRECTNESS_PROMPTS)) + 1)
        prompts = prompts[:n]
        with concurrent.futures.ThreadPoolExecutor(max_workers=n) as ex:
            start = time.time()
            futures = [ex.submit(timed_request, p) for p in prompts]
            outcomes = [f.result() for f in futures]
            wall = time.time() - start
        total_tokens = sum(o[1] for o in outcomes if o[1])
        agg_tok_s = total_tokens / wall if wall > 0 else None
        return {
            "concurrency": n,
            "wall_clock_s": wall,
            "per_request_s": [o[0] for o in outcomes],
            "aggregate_tok_s": agg_tok_s,
        }

    result["c1"] = run_concurrency_level(1)
    result["c4"] = run_concurrency_level(4)
    raw_out.write_text(json.dumps(result, indent=2))
    result["raw_file"] = str(raw_out.relative_to(REPO_ROOT))
    return result


# --------------------------------------------------------------------------
# Per-build orchestration
# --------------------------------------------------------------------------

def build_fingerprint_base(kernel, repo_commit, gpu_driver, concurrent_load, window_start):
    return {
        "host_kernel": kernel,
        "repo_commit": repo_commit,
        "host_gpu_driver": gpu_driver,
        "concurrent_load": concurrent_load,
        "host_metrics_window": {"start": window_start, "end": None},  # filled in after run
    }


def process_vllm_build(build_id, build_path, build, dry_run, downloads_paused, kernel, repo_commit, gpu_driver):
    engine_id = build["engine"]
    is_gpt_oss = "gpt-oss" in build_id
    backend = "openai" if is_gpt_oss else "openai-chat"
    endpoint = "/v1/completions" if is_gpt_oss else "/v1/chat/completions"

    timestamp = utcnow_iso().replace(":", "").replace("-", "")
    window_start = utcnow_iso()
    model_dir = Path(build["model"]["local_path"]).name

    # Look up compose service (build ID = service name in two-tier design).
    compose_service = build_id
    try:
        port = get_compose_service_port(compose_service)
        served_name = get_compose_served_name(compose_service)
    except RuntimeError as e:
        raise RuntimeError(f"{build_id}: {e} — cannot benchmark without a compose service definition") from e

    previously_running = find_running_vllm_services()
    services_stopped = False

    try:
        log(f"[{build_id}] Stopping all vLLM services for full GPU budget, then starting {compose_service} on :{port}.")
        if dry_run:
            log(f"[dry-run] would stop all vLLM services, start {compose_service} on :{port}, benchmark {served_name}")
            return

        check_no_other_benchmark_activity()
        stop_all_vllm_services()
        services_stopped = True
        start_compose_service(compose_service)
        container = compose_service

        image_digest, engine_version = vllm_image_digest_and_version(container)

        speed_already_done = already_has_run(build, VLLM_SPEED_BENCHMARK_ID)
        coding_already_done = already_has_run(build, CODING_BENCHMARK_ID)
        opencode_already_done = already_has_run(build, AGENTIC_OPENCODE_ID)
        pi_already_done = already_has_run(build, AGENTIC_PI_ID)

        speed_result = None
        if speed_already_done:
            log(f"[{build_id}] {VLLM_SPEED_BENCHMARK_ID} already recorded — skipping speed trials, not re-running.")
        else:
            speed_result = run_vllm_speed_benchmark(
                build_id, build, container, port, served_name, model_dir, backend, endpoint, timestamp, dry_run,
            )

        coding_result = None
        if coding_already_done:
            log(f"[{build_id}] {CODING_BENCHMARK_ID} already recorded — skipping coding harness, not re-running.")
        else:
            coding_result = run_coding_harness(build_id, f"http://localhost:{port}", served_name, timestamp, dry_run)

        # Agentic-coding-session tasks (M-021) — both harnesses, same
        # base_url/served_name as the coding harness above (this script is
        # explicitly agnostic to litellm-vs-direct-engine-port per its own
        # module docstring). Genuinely long-running (up to 45min/task x 3
        # tasks per harness) — run after the cheaper legs above so a speed/
        # coding regression is caught before paying for the expensive legs.
        opencode_result = None
        if opencode_already_done:
            log(f"[{build_id}] {AGENTIC_OPENCODE_ID} already recorded — skipping, not re-running.")
        else:
            opencode_result = run_agentic_tasks(
                build_id, AGENTIC_OPENCODE_ID, f"http://localhost:{port}", served_name, dry_run,
            )

        pi_result = None
        if pi_already_done:
            log(f"[{build_id}] {AGENTIC_PI_ID} already recorded — skipping, not re-running.")
        else:
            pi_result = run_agentic_tasks(
                build_id, AGENTIC_PI_ID, f"http://localhost:{port}", served_name, dry_run,
            )

        window_end = utcnow_iso()
        fingerprint = build_fingerprint_base(kernel, repo_commit, gpu_driver, "n/a", window_start)
        fingerprint["host_metrics_window"]["end"] = window_end
        fingerprint["image_digest"] = image_digest
        fingerprint["engine_version"] = engine_version
        fingerprint["concurrent_load"] = {
            "downloads_paused": bool(downloads_paused),
            "vllm_co_resident_or_stopped": "stopped_for_benchmark",
        }

        benchmarks_run = []
        if not speed_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": VLLM_SPEED_BENCHMARK_ID,
                "fingerprint": fingerprint,
                "result": speed_result,
            })
            benchmarks_run.append(VLLM_SPEED_BENCHMARK_ID)
        if not coding_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": CODING_BENCHMARK_ID,
                "fingerprint": fingerprint,
                "result": coding_result,
            })
            benchmarks_run.append(CODING_BENCHMARK_ID)
        if not opencode_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": AGENTIC_OPENCODE_ID,
                "fingerprint": fingerprint,
                "result": opencode_result,
            })
            benchmarks_run.append(AGENTIC_OPENCODE_ID)
        if not pi_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": AGENTIC_PI_ID,
                "fingerprint": fingerprint,
                "result": pi_result,
            })
            benchmarks_run.append(AGENTIC_PI_ID)

        if benchmarks_run:
            raw_new_files = list(RAW_DIR.glob(f"{build_id}--*{timestamp}*"))
            git_commit_and_push(
                [build_path, *raw_new_files],
                f"Record {'/'.join(benchmarks_run)} results for {build_id}",
                dry_run=dry_run,
            )
        else:
            log(f"[{build_id}] Both benchmarks already recorded — nothing new to commit (shouldn't normally reach here; the plan-level skip should have caught this).")

    finally:
        if services_stopped:
            log(f"[{build_id}] Stopping {compose_service}, restoring previously-running services.")
            run(["docker", "compose", "stop", compose_service], cwd=str(DOCKER_DIR))
            restore_vllm_services(previously_running)


def process_llamacpp_build(build_id, build_path, build, dry_run, downloads_paused, kernel, repo_commit, gpu_driver):
    engine_id = build["engine"]
    is_server_variant = engine_id == "llamacpp-vulkan-radv-server-v1"
    timestamp = utcnow_iso().replace(":", "").replace("-", "")
    window_start = utcnow_iso()

    log(f"[{build_id}] llama.cpp build — stopping all vLLM services for the full GPU budget (mandatory per engine gotchas).")
    if dry_run:
        log(f"[dry-run] would stop all vLLM services, run llama-bench, then {'llama-server correctness+concurrency' if is_server_variant else 'llama-server + coding harness'}, then restore stack")
        return

    check_no_other_benchmark_activity()
    previously_running = find_running_vllm_services()
    stop_all_vllm_services()
    vllm_stopped_for_run = True
    toolbox_digest = toolbox_image_digest()

    # Resumability: check what's already recorded BEFORE doing any of the
    # (potentially expensive) work, same fix as process_vllm_build — these
    # used to run unconditionally every time regardless of prior completion.
    bench_already_done = already_has_run(build, LLAMACPP_BENCH_ID)
    concurrent_already_done = already_has_run(build, LLAMACPP_SERVER_CONCURRENT_ID)
    coding_already_done = already_has_run(build, CODING_BENCHMARK_ID)
    opencode_already_done = already_has_run(build, AGENTIC_OPENCODE_ID)
    pi_already_done = already_has_run(build, AGENTIC_PI_ID)

    try:
        entries_to_append = []

        # Leg 1: llama-bench (speed), every llamacpp build regardless of variant.
        if bench_already_done:
            log(f"[{build_id}] {LLAMACPP_BENCH_ID} already recorded — skipping llama-bench, not re-running.")
        else:
            bench_result = run_llamacpp_bench(build_id, build, timestamp, dry_run)
            window_end = utcnow_iso()
            fp = build_fingerprint_base(kernel, repo_commit, gpu_driver, "n/a", window_start)
            fp["host_metrics_window"]["end"] = window_end
            fp["image_digest"] = toolbox_digest
            fp["engine_version"] = bench_result["engine_build"]
            fp["concurrent_load"] = {
                "downloads_paused": bool(downloads_paused),
                "vllm_co_resident_or_stopped": "stopped_for_run",
            }
            entries_to_append.append({
                "timestamp": window_start,
                "benchmark_id": LLAMACPP_BENCH_ID,
                "fingerprint": fp,
                "result": bench_result,
            })

        # Leg 2: llama-server. Server-variant build also does the mandatory
        # correctness-gated concurrency test; every llamacpp build (server
        # or plain) also gets the seven-tier coding harness against a
        # llama-server instance, per HANDOFF instructions.
        # Skip the whole leg-2 server lifecycle if everything it could
        # produce is already recorded (resumability — don't pay for a real
        # model load + GPU work just to re-derive nothing new).
        need_concurrent = is_server_variant and not concurrent_already_done
        need_coding = not coding_already_done
        need_opencode = not opencode_already_done
        need_pi = not pi_already_done
        if not need_concurrent and not need_coding and not need_opencode and not need_pi:
            log(f"[{build_id}] All applicable leg-2 benchmarks already recorded — skipping llama-server entirely.")
        else:
            model_dir = Path(build["model"]["local_path"]).name
            served_name = build.get("served_model_name") or model_dir
            port = 8090
            np_slots = 4
            ctx_size = 32768
            for raw_flag in build.get("build_specific_flags", []):
                flag = str(raw_flag).split("#", 1)[0].strip()
                if flag.startswith("-np"):
                    parts = flag.split()
                    np_slots = int(parts[1]) if len(parts) > 1 else np_slots
                if flag.startswith("-c "):
                    parts = flag.split()
                    ctx_size = int(parts[1]) if len(parts) > 1 else ctx_size

            container = start_llama_server(build_id, build, port, np_slots, ctx_size)
            try:
                base_url = f"http://localhost:{port}"
                server_build = get_llama_server_build_fingerprint(container)
                fp_server = build_fingerprint_base(kernel, repo_commit, gpu_driver, "n/a", utcnow_iso())
                fp_server["image_digest"] = toolbox_digest
                fp_server["engine_version"] = server_build
                fp_server["concurrent_load"] = {
                    "downloads_paused": bool(downloads_paused),
                    "vllm_co_resident_or_stopped": "stopped_for_run",
                }

                if need_concurrent:
                    concurrent_result = run_llamacpp_server_concurrent(build_id, base_url, served_name, port, timestamp, dry_run)
                    fp_server["host_metrics_window"]["end"] = utcnow_iso()
                    entries_to_append.append({
                        "timestamp": window_start,
                        "benchmark_id": LLAMACPP_SERVER_CONCURRENT_ID,
                        "fingerprint": fp_server,
                        "result": concurrent_result,
                    })
                elif is_server_variant:
                    log(f"[{build_id}] {LLAMACPP_SERVER_CONCURRENT_ID} already recorded — skipping correctness+concurrency test, not re-running.")

                if need_coding:
                    coding_result = run_coding_harness(build_id, base_url, served_name or "default", timestamp, dry_run)
                    fp_coding = dict(fp_server)
                    fp_coding["host_metrics_window"] = {"start": fp_server["host_metrics_window"]["start"], "end": utcnow_iso()}
                    entries_to_append.append({
                        "timestamp": window_start,
                        "benchmark_id": CODING_BENCHMARK_ID,
                        "fingerprint": fp_coding,
                        "result": coding_result,
                    })
                else:
                    log(f"[{build_id}] {CODING_BENCHMARK_ID} already recorded — skipping coding harness, not re-running.")

                # Agentic-coding-session tasks (M-021), both harnesses —
                # same base_url/served_name as the coding harness above.
                # These are genuinely long-running (up to 45min/task x 3
                # tasks per harness), run last since they're the most
                # expensive legs and everything cheaper should be recorded
                # first in case of an interrupted run.
                if need_opencode:
                    opencode_result = run_agentic_tasks(
                        build_id, AGENTIC_OPENCODE_ID, base_url, served_name or "default", dry_run,
                    )
                    fp_opencode = dict(fp_server)
                    fp_opencode["host_metrics_window"] = {"start": fp_server["host_metrics_window"]["start"], "end": utcnow_iso()}
                    entries_to_append.append({
                        "timestamp": window_start,
                        "benchmark_id": AGENTIC_OPENCODE_ID,
                        "fingerprint": fp_opencode,
                        "result": opencode_result,
                    })
                else:
                    log(f"[{build_id}] {AGENTIC_OPENCODE_ID} already recorded — skipping, not re-running.")

                if need_pi:
                    pi_result = run_agentic_tasks(
                        build_id, AGENTIC_PI_ID, base_url, served_name or "default", dry_run,
                    )
                    fp_pi = dict(fp_server)
                    fp_pi["host_metrics_window"] = {"start": fp_server["host_metrics_window"]["start"], "end": utcnow_iso()}
                    entries_to_append.append({
                        "timestamp": window_start,
                        "benchmark_id": AGENTIC_PI_ID,
                        "fingerprint": fp_pi,
                        "result": pi_result,
                    })
                else:
                    log(f"[{build_id}] {AGENTIC_PI_ID} already recorded — skipping, not re-running.")
            finally:
                stop_llama_server(container)

        for entry in entries_to_append:
            append_benchmark_run(build_path, entry)

        raw_new_files = list(RAW_DIR.glob(f"{build_id}--*{timestamp}*"))
        if entries_to_append:
            git_commit_and_push(
                [build_path, *raw_new_files],
                f"Record llama.cpp benchmark results for {build_id}",
                dry_run=dry_run,
            )

    finally:
        # Download resume is intentionally NOT done here — main()'s per-build
        # loop owns pause/resume symmetrically for both engine families (see
        # its own finally block), so there's exactly one resume call per
        # pause call, never a double-resume.
        log(f"[{build_id}] Restoring previously-running vLLM services.")
        restore_vllm_services(previously_running)


# --------------------------------------------------------------------------
# Ollama: /api/generate against the one standing `ollama` container
# (registered model tags, not swapped containers) — ollama-warm-request-v2
# methodology (1 cold + 3 warm requests, headline tok/s from the warm mean).
# --------------------------------------------------------------------------

def ollama_generate_request(served_name, prompt, timeout=600):
    """POST /api/generate (non-streaming) against the standing ollama
    container, return the parsed JSON body. Raises on any non-2xx/timeout
    so a failed request can never be silently treated as a valid (if odd)
    sample — same discipline as run_vllm_bench_serve_trial's zero-completed
    check."""
    import urllib.request

    payload = json.dumps({
        "model": served_name,
        "prompt": prompt,
        "stream": False,
    }).encode()
    req = urllib.request.Request(
        f"http://localhost:{OLLAMA_PORT}/api/generate", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read())
    if "eval_count" not in body or "eval_duration" not in body:
        raise RuntimeError(f"ollama /api/generate response missing eval_count/eval_duration: {body}")
    return body


def summarize_ollama_trial(body):
    eval_count = body.get("eval_count")
    eval_duration = body.get("eval_duration")  # nanoseconds
    tok_s = (eval_count / (eval_duration / 1e9)) if eval_count and eval_duration else None
    return {
        "eval_count": eval_count,
        "eval_duration_ns": eval_duration,
        "prompt_eval_count": body.get("prompt_eval_count"),
        "prompt_eval_duration_ns": body.get("prompt_eval_duration"),
        "load_duration_ns": body.get("load_duration"),
        "total_duration_ns": body.get("total_duration"),
        "tok_s": tok_s,
    }


OLLAMA_WARM_REQUEST_PROMPT = (
    "Write a short essay (roughly 400-600 words) about the history and cultural "
    "significance of coffee, covering its origins, spread, and modern-day role."
)


def run_ollama_warm_request(build_id, served_name, timestamp, dry_run):
    log(f"[{build_id}] Running Ollama warm-request benchmark ({OLLAMA_WARM_REQUEST_ID}) against {served_name}.")
    if dry_run:
        log(f"[dry-run] would run 1 cold + 3 warm /api/generate requests against {served_name}")
        return None

    import statistics

    log(f"[{build_id}] Cold trial (first request after registration/idle — includes load time by design) ...")
    cold_body = ollama_generate_request(served_name, OLLAMA_WARM_REQUEST_PROMPT)
    cold_summary = summarize_ollama_trial(cold_body)

    warm_summaries = []
    for trial_n in range(1, 4):
        log(f"[{build_id}] Warm trial {trial_n}/3 ...")
        body = ollama_generate_request(served_name, OLLAMA_WARM_REQUEST_PROMPT)
        warm_summaries.append(summarize_ollama_trial(body))

    warm_tok_s = [w["tok_s"] for w in warm_summaries if w["tok_s"] is not None]
    result = {
        "cold": cold_summary,
        "warm_trials": warm_summaries,
        "warm_tok_s_mean": statistics.mean(warm_tok_s) if warm_tok_s else None,
        "warm_tok_s_stddev": statistics.stdev(warm_tok_s) if len(warm_tok_s) > 1 else 0.0 if warm_tok_s else None,
    }

    raw_out = RAW_DIR / f"{build_id}--{OLLAMA_WARM_REQUEST_ID}--{timestamp}.json"
    raw_out.write_text(json.dumps(result, indent=2))
    result["raw_file"] = str(raw_out.relative_to(REPO_ROOT))
    return result


def ollama_version(container=OLLAMA_CONTAINER):
    # `ollama --version` prints a client-vs-server-mismatch warning line
    # ahead of the real version on some builds — take the last non-empty
    # line, mirroring vllm_image_digest_and_version's approach for vLLM.
    out = run(["docker", "exec", container, "ollama", "--version"], check=False).stdout.strip()
    lines = [ln for ln in out.splitlines() if ln.strip()]
    return lines[-1] if lines else out


def ollama_image_digest(container=OLLAMA_CONTAINER):
    image_id = run(["docker", "inspect", container, "--format", "{{.Image}}"]).stdout.strip()
    return run(["docker", "inspect", image_id, "--format", "{{.RepoDigests}}"]).stdout.strip()


def process_ollama_build(build_id, build_path, build, dry_run, downloads_paused, kernel, repo_commit, gpu_driver):
    served_name = build.get("served_model_name")
    if not served_name:
        raise RuntimeError(f"{build_id}: no served_model_name — cannot address this build's Ollama model tag")

    timestamp = utcnow_iso().replace(":", "").replace("-", "")
    window_start = utcnow_iso()

    log(f"[{build_id}] Ollama build — stopping all vLLM services for the full GPU budget "
        f"(same GPU-contention risk as llama.cpp; Ollama itself keeps running, only vLLM is stopped).")
    if dry_run:
        log(f"[dry-run] would stop all vLLM services, run 1 cold + 3 warm /api/generate against "
            f"{served_name} on the standing ollama container, then restore stack")
        return

    # Per-benchmark-id idempotency (M-023 pattern, matching
    # process_vllm_build/process_llamacpp_build) — Ollama used to have only
    # one expected benchmark_id so an early-return on missing_benchmark_ids()
    # was equivalent to per-id gating; that stopped being true once the two
    # agentic-coding-session ids were added to expected_benchmark_ids() for
    # this family too (M-021), so this is now a real per-id gate rather than
    # a single early return.
    if not missing_benchmark_ids(build, "ollama"):
        log(f"[{build_id}] All expected Ollama benchmark_ids already recorded — nothing to do "
            f"(shouldn't normally reach here; the plan-level skip should have caught this).")
        return

    warm_already_done = already_has_run(build, OLLAMA_WARM_REQUEST_ID)
    opencode_already_done = already_has_run(build, AGENTIC_OPENCODE_ID)
    pi_already_done = already_has_run(build, AGENTIC_PI_ID)

    check_no_other_benchmark_activity()
    previously_running = find_running_vllm_services()
    stop_all_vllm_services()
    vllm_stopped_for_run = True

    try:
        engine_ver = ollama_version()
        digest = ollama_image_digest()

        result = None
        if warm_already_done:
            log(f"[{build_id}] {OLLAMA_WARM_REQUEST_ID} already recorded — skipping warm-request trials, not re-running.")
        else:
            result = run_ollama_warm_request(build_id, served_name, timestamp, dry_run)

        # Agentic-coding-session tasks (M-021) — Ollama exposes an
        # OpenAI-compatible endpoint at /v1 on the same port as its native
        # /api/generate (documented Ollama behavior), which is what
        # opencode/pi's provider config needs. Run after the cheap warm-
        # request leg above, same "cheaper legs first" reasoning as the
        # other two families.
        ollama_openai_base_url = f"http://localhost:{OLLAMA_PORT}/v1"
        opencode_result = None
        if opencode_already_done:
            log(f"[{build_id}] {AGENTIC_OPENCODE_ID} already recorded — skipping, not re-running.")
        else:
            opencode_result = run_agentic_tasks(
                build_id, AGENTIC_OPENCODE_ID, ollama_openai_base_url, served_name, dry_run,
            )

        pi_result = None
        if pi_already_done:
            log(f"[{build_id}] {AGENTIC_PI_ID} already recorded — skipping, not re-running.")
        else:
            pi_result = run_agentic_tasks(
                build_id, AGENTIC_PI_ID, ollama_openai_base_url, served_name, dry_run,
            )

        window_end = utcnow_iso()
        fingerprint = build_fingerprint_base(kernel, repo_commit, gpu_driver, "n/a", window_start)
        fingerprint["host_metrics_window"]["end"] = window_end
        fingerprint["image_digest"] = digest
        fingerprint["engine_version"] = engine_ver
        fingerprint["concurrent_load"] = {
            "downloads_paused": bool(downloads_paused),
            "vllm_co_resident_or_stopped": "stopped_for_run",
        }

        benchmarks_run = []
        if not warm_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": OLLAMA_WARM_REQUEST_ID,
                "fingerprint": fingerprint,
                "result": result,
            })
            benchmarks_run.append(OLLAMA_WARM_REQUEST_ID)
        if not opencode_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": AGENTIC_OPENCODE_ID,
                "fingerprint": fingerprint,
                "result": opencode_result,
            })
            benchmarks_run.append(AGENTIC_OPENCODE_ID)
        if not pi_already_done:
            append_benchmark_run(build_path, {
                "timestamp": window_start,
                "benchmark_id": AGENTIC_PI_ID,
                "fingerprint": fingerprint,
                "result": pi_result,
            })
            benchmarks_run.append(AGENTIC_PI_ID)

        if benchmarks_run:
            raw_new_files = list(RAW_DIR.glob(f"{build_id}--*{timestamp}*"))
            git_commit_and_push(
                [build_path, *raw_new_files],
                f"Record {'/'.join(benchmarks_run)} results for {build_id}",
                dry_run=dry_run,
            )
        else:
            log(f"[{build_id}] All Ollama benchmarks already recorded — nothing new to commit (shouldn't normally reach here; the plan-level skip should have caught this).")
    finally:
        # Same reasoning as process_llamacpp_build: download resume is owned
        # by main()'s per-build loop, not here — exactly one resume per pause.
        log(f"[{build_id}] Restoring previously-running vLLM services.")
        restore_vllm_services(previously_running)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="Run just one build (by build-id, matching a catalog/builds/<id>.yaml filename)")
    ap.add_argument("--dry-run", action="store_true", help="Log what would happen, execute nothing")
    args = ap.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    plan = gather_plan(only_build_id=args.only)
    if args.only and not plan:
        log(f"No build found matching --only {args.only!r}")
        sys.exit(1)

    log("=== Plan ===")
    runnable = []
    for build_id, path, build, family, skip_reason in plan:
        if skip_reason:
            log(f"  SKIP  {build_id}  ({skip_reason})")
            continue
        # Per-benchmark-id idempotency (M-023): derive the skip/run decision
        # from expected_benchmark_ids()/missing_benchmark_ids() — the same
        # registry process_*_build() uses internally — rather than a
        # hand-assembled "has some data" check. A build with N of its
        # expected M benchmark_ids already recorded (e.g. a third
        # benchmark_id added later, with the first two already run) must
        # still show up here as RUN, scheduled for just the missing ones,
        # never skipped outright and never re-run in full.
        missing = missing_benchmark_ids(build, family)
        if not missing:
            expected = expected_benchmark_ids(build, family)
            log(f"  SKIP  {build_id}  (already has {' + '.join(expected)} run{'s' if len(expected) != 1 else ''})")
            continue
        already_done = [bid for bid in expected_benchmark_ids(build, family) if bid not in missing]
        if already_done:
            log(f"  RUN   {build_id}  (engine family: {family}; missing {' + '.join(missing)}, already has {' + '.join(already_done)})")
        else:
            log(f"  RUN   {build_id}  (engine family: {family})")
        runnable.append((build_id, path, build, family))

    if not runnable:
        log("Nothing to run.")
        return

    if args.dry_run:
        log("=== Dry run — stopping after plan display (per-build dry-run detail below) ===")

    if not args.dry_run:
        cleanup_stale_containers()
        ensure_default_services_up()

    kernel, repo_commit = capture_host_fingerprint_common()
    gpu_driver = capture_gpu_driver_via_toolbox() if not args.dry_run else "not-captured-dry-run"

    # Batch by engine family to minimize container churn (vLLM builds first,
    # since standing services are already up; llamacpp/ollama builds both
    # need the standard stack down for their whole batch — grouped together
    # for the same reason llamacpp builds are grouped, minimize vLLM
    # stop/start churn across the batch).
    vllm_builds = [b for b in runnable if b[3] == "vllm"]
    llamacpp_builds = [b for b in runnable if b[3] == "llamacpp"]
    ollama_builds = [b for b in runnable if b[3] == "ollama"]

    for build_id, path, build, family in vllm_builds:
        log(f"\n=== {build_id} (vllm) ===")
        downloads_paused = pause_downloads() if not args.dry_run else []
        try:
            process_vllm_build(build_id, path, build, args.dry_run, downloads_paused, kernel, repo_commit, gpu_driver)
        except Exception as e:  # noqa: BLE001
            log(f"[{build_id}] FAILED: {e}")
        finally:
            if not args.dry_run:
                resume_downloads(downloads_paused)

    for build_id, path, build, family in llamacpp_builds:
        log(f"\n=== {build_id} (llamacpp) ===")
        downloads_paused = pause_downloads() if not args.dry_run else []
        try:
            process_llamacpp_build(build_id, path, build, args.dry_run, downloads_paused, kernel, repo_commit, gpu_driver)
        except Exception as e:  # noqa: BLE001
            # process_llamacpp_build's own finally already restores
            # previously-running vLLM services unconditionally (success or
            # failure) once it's past the initial stop_all_vllm_services()
            # call — restore here too is a safe no-op in case the exception
            # fired before that point.
            log(f"[{build_id}] FAILED: {e}")
            if not args.dry_run:
                restore_vllm_services(find_running_vllm_services())
        finally:
            if not args.dry_run:
                resume_downloads(downloads_paused)

    for build_id, path, build, family in ollama_builds:
        log(f"\n=== {build_id} (ollama) ===")
        downloads_paused = pause_downloads() if not args.dry_run else []
        try:
            process_ollama_build(build_id, path, build, args.dry_run, downloads_paused, kernel, repo_commit, gpu_driver)
        except Exception as e:  # noqa: BLE001
            # Same reasoning as the llamacpp branch above: process_ollama_build's
            # own finally already restores previously-running vLLM services
            # unconditionally once past the initial stop_all_vllm_services()
            # call — restore here too is a safe no-op in case the exception
            # fired before that point.
            log(f"[{build_id}] FAILED: {e}")
            if not args.dry_run:
                restore_vllm_services(find_running_vllm_services())
        finally:
            if not args.dry_run:
                resume_downloads(downloads_paused)

    log("\n=== Done ===")


if __name__ == "__main__":
    main()
