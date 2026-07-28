#!/usr/bin/env python3
"""Agentic-coding-session benchmark harness — drives opencode or Pi headless
against a candidate model, across the 3 tasks under catalog/agentic-tasks/,
per M-021 (.fleet/board/now/M-021-agentic-coding-session-benchmark.md — read
that card in full for the complete design history/decision log; this file
only implements it).

For each (task x model x harness) this script:
  1. Sets up a clean scratch workspace (temp dir). Copies in ONLY that
     task's starter/ contents (never hidden/) — except git-pr-ci-v1, which
     has no starter/ at all: instead this resets the shared
     local-ai-machine-test GitHub repo to baseline (scripts/
     reset_agentic_test_repo.sh) and clones it fresh into the workspace.
  2. Writes a per-run harness provider config pointing at the target
     model's OpenAI-compatible endpoint (base_url + served_name — the same
     two values scripts/benchmark_orchestrator.py's run_coding_harness()
     already resolves per engine family; litellm's proxy is one valid
     source of such an endpoint for vLLM builds today, but this script
     itself is agnostic to whether base_url is litellm or a direct
     engine port, exactly mirroring the existing coding harness's design).
  3. Runs the harness headless with the task's task.md prompt, cwd = the
     scratch workspace, self-enforced 45-minute wall-clock ceiling (neither
     opencode nor Pi has a documented built-in timeout/exit-code/max-turns
     guarantee — confirmed during M-021 design, see the methodology YAMLs'
     known_caveats). Captures the COMPLETE raw event stream to a transcript
     log file under catalog/raw/ — every tool call/message, not a summary.
  4. After the session ends (or is killed on timeout): runs that task's
     hidden grader (copying hidden/grade.py in is not required — every
     grader here is invoked as an external script pointed at the workspace
     or, for git-pr-ci-v1, at the real GitHub repo directly), captures
     pass_count/total_count and the full check detail.
  5. Cleans up the scratch workspace. For git-pr-ci-v1: runs
     reset_agentic_test_repo.sh again immediately after (regardless of
     whether the session/grading succeeded, failed, or timed out) so no
     stray branch/PR/commit ever leaks into the next run.

Usage (standalone / smoke test):
  python3 agentic_coding_benchmark.py --harness opencode --task docs-research-v1 \\
      --base-url http://127.0.0.1:4000/v1 --served-name qwen3.5-4b-judge \\
      --build-id qwen3.5-4b--vllm-therock-gfx1151-v1 --api-key sk-...

  python3 agentic_coding_benchmark.py --harness pi --task all \\
      --base-url http://127.0.0.1:4000/v1 --served-name qwen3.5-4b-judge \\
      --build-id qwen3.5-4b--vllm-therock-gfx1151-v1 --api-key sk-...

Normal usage is as a library, imported by scripts/benchmark_orchestrator.py
(run_agentic_task()), which resolves --base-url/--served-name/--api-key
itself per build/engine-family and handles the GPU-contention safety
sequencing (stopping other services, restoring them after) — this script
does not do any of that sequencing itself, by design, so it can also be
smoke-tested standalone against an already-running service without
disturbing anything else.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
TASKS_DIR = REPO_ROOT / "catalog" / "agentic-tasks"
RAW_DIR = REPO_ROOT / "catalog" / "raw"
SCRIPTS_DIR = REPO_ROOT / "scripts"
RESET_SCRIPT = SCRIPTS_DIR / "reset_agentic_test_repo.sh"

WALL_CLOCK_CEILING_S = 45 * 60  # 45min, per M-021 decision log point 4.
# Small margin beyond the ceiling before we escalate from terminate to
# kill -9 — gives a well-behaved process a moment to exit after SIGTERM
# before we force it, without materially affecting the recorded
# wall_clock_s (that's measured from the ceiling hit, not from the kill).
SIGTERM_GRACE_S = 15

TASK_IDS = ["docs-research-v1", "docker-lifecycle-v1", "git-pr-ci-v1"]
GIT_PR_CI_REPO = "chrisjohnson/local-ai-machine-test"

BENCHMARK_IDS = {
    "opencode": "agentic-coding-session-opencode-v1",
    "pi": "agentic-coding-session-pi-v1",
}


def log(msg: str) -> None:
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def utcnow_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def utcnow_compact() -> str:
    return utcnow_iso().replace(":", "").replace("-", "")


# --------------------------------------------------------------------------
# Secrets — litellm master key, read live from docker/.env, never hardcoded
# or committed. Only needed when base_url actually points at the litellm
# proxy (port 4000); direct engine endpoints (llama-server, Ollama, a raw
# vLLM container port) use "none"/no auth, same convention already used
# throughout this repo (docker/litellm/config.yaml's api_key: "none" entries,
# scripts/coding_benchmark.py's call_model()).
# --------------------------------------------------------------------------

def read_litellm_master_key() -> Optional[str]:
    env_path = REPO_ROOT.parent / "local-ai-machine" / "docker" / ".env"
    # On the box the repo checkout IS ~/local-ai-machine, so REPO_ROOT itself
    # is that directory — prefer REPO_ROOT/docker/.env directly and only
    # fall back to the sibling-guess above for an unusual checkout layout.
    candidates = [REPO_ROOT / "docker" / ".env", env_path]
    for path in candidates:
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if line.startswith("LITELLM_MASTER_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def resolve_api_key(base_url: str, explicit_api_key: Optional[str]) -> str:
    if explicit_api_key:
        return explicit_api_key
    if ":4000" in base_url:
        key = read_litellm_master_key()
        if key:
            return key
        log("WARNING: base_url looks like the litellm proxy but LITELLM_MASTER_KEY "
            "could not be read from docker/.env — falling back to 'none', requests "
            "will likely 401.")
    return "none"


# --------------------------------------------------------------------------
# Workspace setup / teardown
# --------------------------------------------------------------------------

def task_dir(task_id: str) -> Path:
    return TASKS_DIR / task_id


def read_task_prompt(task_id: str) -> str:
    return (task_dir(task_id) / "task.md").read_text()


def make_scratch_workspace(task_id: str, run_id: str) -> Path:
    ws = Path(tempfile.mkdtemp(prefix=f"agentic-bench-{task_id}-{run_id}-"))
    return ws


def make_isolated_agent_home(run_id: str) -> Path:
    """A per-run $HOME for the candidate model's own harness subprocess,
    deliberately separate from the real chris $HOME. The box's real
    ~/.ssh/github_deploy_key turned out (2026-07-28) to be an account-level
    SSH key, not narrowly scoped to one repo — fine for this project's own
    deliberate, reviewed code paths (e.g. reset_agentic_test_repo.sh), but
    the candidate model itself runs with full unsandboxed shell access
    (confirmed for both opencode and Pi — neither documents any sandboxing)
    and has no reason to ever reach that key: its own git-pr-ci-v1
    operations go through the workspace's HTTPS remote + GH_TOKEN (the
    correctly-scoped fine-grained PAT), set up by clone_git_pr_ci_repo()
    via `gh repo clone` with the box's `gh` configured for the https
    protocol.

    IMPORTANT, real gap found and fixed 2026-07-28 during this task's own
    Pi smoke test: an isolated $HOME alone is NOT a structural guarantee
    against reaching the real ~/.ssh/github_deploy_key — this was the
    original (wrong) assumption documented here. OpenSSH resolves the
    user's *default* ~/.ssh/config from the real passwd-database home
    directory for the calling UID, not from the $HOME environment
    variable — confirmed directly on this box (OpenSSH_10.4p1): `HOME=
    /tmp/isolated ssh -G git@github.com` (even via a plain
    subprocess.Popen with a fully-replaced env, no shell involved) still
    reports `identityfile ~/.ssh/github_deploy_key`, and a real live Pi
    smoke-test session generated its own throwaway SSH keypair, hit
    exactly this gap, and successfully pushed to local-ai-machine-test
    over SSH using the box's real account-level deploy key (verified via
    `ssh -vT`: the connection was "Authenticated ... using publickey" with
    /home/chris/.ssh/github_deploy_key, NOT the model's own fresh key) —
    despite running under this isolated $HOME the whole time. See
    ssh_lockdown_wrapper_dir() below for the actual fix (an ssh/scp
    wrapper placed first on $PATH that forces `-F <empty file>`,
    unconditionally bypassing config-file-based IdentityFile resolution
    regardless of $HOME/passwd lookup) — isolated $HOME alone is
    necessary but not sufficient. Real HOME's .npm-global (Pi's install
    location) and other real tool state are deliberately NOT copied in
    here; each harness's own config-writer (write_pi_models_config,
    write_opencode_config) targets this directory directly instead of the
    real $HOME."""
    home = Path(tempfile.mkdtemp(prefix=f"agentic-bench-home-{run_id}-"))
    return home


_SSH_WRAPPER_SCRIPT = """#!/usr/bin/env bash
# Generated by agentic_coding_benchmark.py's ssh_lockdown_wrapper_dir() —
# see that function's docstring for why this exists (real gap found
# 2026-07-28: an isolated $HOME does not stop OpenSSH from resolving the
# real ~/.ssh/config, since it looks up the passwd-database home
# directory for the calling UID rather than trusting $HOME). This forces
# every ssh/scp invocation the agent's subprocess makes (directly, or via
# git's internal ssh calls) to use an empty config file and refuse
# ssh-agent-offered/config-file identities — the ONLY identity that can
# ever be used is one explicitly passed via -i on that exact invocation
# (harmless: this is exactly how the model's own self-generated keys are
# used, e.g. after `ssh-keygen`, and how it must add its own key as a
# repo-scoped deploy key or use GH_TOKEN/HTTPS for anything to actually
# reach GitHub — see the module docstring's isolated_agent_env note).
REAL_SSH="{real_bin}"
exec "$REAL_SSH" -F "{empty_config}" -o IdentitiesOnly=yes -o "UserKnownHostsFile={known_hosts}" "$@"
"""


def ssh_lockdown_wrapper_dir(agent_home: Path) -> Path:
    """Builds a per-run directory containing ssh/scp wrapper scripts that
    unconditionally force `-F <empty config>` (bypassing the real
    ~/.ssh/config entirely, see make_isolated_agent_home's docstring for
    why an isolated $HOME alone doesn't do this) plus a fresh, empty
    known_hosts under agent_home (so host-key state doesn't leak in
    either, though that's a much lower-stakes concern than the identity
    file gap). Callers must prepend this directory to $PATH (see
    isolated_agent_env) so it shadows the real ssh/scp binaries for any
    command the model's subprocess runs, directly or via git's own
    internal ssh invocation."""
    wrapper_dir = agent_home / ".ssh-lockdown"
    wrapper_dir.mkdir(parents=True, exist_ok=True)
    empty_config = agent_home / ".ssh-lockdown-empty-config"
    empty_config.write_text("")
    known_hosts = agent_home / ".ssh-lockdown-known-hosts"
    known_hosts.write_text("")

    for real_name in ("ssh", "scp", "sftp"):
        real_bin = shutil.which(real_name)
        if not real_bin:
            continue
        wrapper_path = wrapper_dir / real_name
        wrapper_path.write_text(_SSH_WRAPPER_SCRIPT.format(
            real_bin=real_bin, empty_config=empty_config, known_hosts=known_hosts,
        ))
        wrapper_path.chmod(0o755)
    return wrapper_dir


def isolated_agent_env(base_env: dict, agent_home: Path) -> dict:
    """Env for the candidate model's own subprocess: isolated HOME (see
    make_isolated_agent_home), strip anything that could let it reach the
    real SSH identity by another path (an inherited ssh-agent socket, or a
    GIT_SSH_COMMAND override) even though neither is expected to be set in
    this harness's own calling environment, AND (real fix, 2026-07-28)
    prepend ssh_lockdown_wrapper_dir() to $PATH so bare ssh/scp and git's
    own internal ssh calls all go through the config-bypassing wrapper —
    isolated $HOME alone was proven insufficient by a live Pi smoke-test
    session that reached the real account-level deploy key through it
    (see make_isolated_agent_home's docstring for the full incident)."""
    env = dict(base_env)
    env["HOME"] = str(agent_home)
    env.pop("SSH_AUTH_SOCK", None)
    env.pop("GIT_SSH_COMMAND", None)
    wrapper_dir = ssh_lockdown_wrapper_dir(agent_home)
    env["PATH"] = f"{wrapper_dir}{os.pathsep}{env.get('PATH', '')}"
    return env


def setup_workspace(task_id: str, workspace: Path) -> None:
    """Copy in ONLY starter/ (never hidden/) for tasks that have one.
    git-pr-ci-v1 has no starter/ — it's set up by reset_git_pr_ci_repo() +
    clone_git_pr_ci_repo() instead, called separately by the git-pr-ci-v1
    branch of run_one() below."""
    starter = task_dir(task_id) / "starter"
    if not starter.exists():
        raise RuntimeError(f"{task_id}: no starter/ directory and no special-cased setup — "
                            f"cannot set up workspace")
    for item in starter.iterdir():
        dest = workspace / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    # Sanity assertion, cheap and load-bearing: hidden/ must genuinely never
    # be reachable from inside the workspace at any point during the
    # session. This isn't just a copy-order guarantee (we never copy it in
    # before grading) — assert it positively too, so a future refactor that
    # accidentally introduces a copy-hidden-in-early bug fails loudly here
    # rather than silently leaking the grading suite to the agent.
    assert not (workspace / "hidden").exists(), (
        f"{task_id}: workspace unexpectedly contains a 'hidden' entry before grading — "
        f"this must never happen, refusing to run the agent session"
    )


def verify_hidden_never_leaked(task_id: str, workspace: Path) -> None:
    """Re-assert post-session, before grading, that the agent's own session
    never created a 'hidden' path in its workspace (e.g. by copying
    something in from outside, which it has no way to reach, or naming its
    own work 'hidden' by coincidence) that could be confused with the real
    grading suite, and that the real hidden/ directory was never staged
    into the workspace at any point up to and including right now."""
    suspicious = workspace / "hidden"
    if suspicious.exists():
        log(f"[{task_id}] NOTE: workspace contains a path named 'hidden' after the "
            f"session ended — this is the agent's own doing (nothing this harness "
            f"copied in), not a leak of the real grading suite, but flagging it since "
            f"it's an unusual coincidence worth a human glance: {suspicious}")


def kill_orphans_under_workspace(workspace: Path) -> None:
    """Best-effort safety net: kill any process whose cwd is still under
    the workspace, before deleting it. Real gap found during Pi harness
    smoke testing 2026-07-28: Pi's own `bash` tool can spawn children (e.g.
    a foreground long-running server the agent itself launched without
    backgrounding it) that survive a SIGTERM/SIGKILL sent to the top-level
    `pi` process's process group — confirmed live, a `fake_ledger_server.py`
    child process the agent started stayed alive and bound to its port
    after the harness's own timeout-kill had already reaped `pi` itself and
    torn down the workspace directory. Not fully understood why this one
    child escaped the group (pi's bash tool implementation likely
    setsid()s or double-forks its own subprocesses) — this is a defensive
    net, not a fix to the root cause, and isn't guaranteed exhaustive (a
    process could also have chdir'd away after spawning), but it materially
    reduces the chance of a leaked process outliving cleanup_workspace()."""
    proc_root = Path("/proc")
    if not proc_root.exists():
        return  # not on Linux /proc — best-effort only, skip silently.
    ws_str = str(workspace)
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cwd_link = (entry / "cwd").resolve()
        except (OSError, RuntimeError):
            continue
        if str(cwd_link).startswith(ws_str):
            pid = int(entry.name)
            try:
                os.kill(pid, signal.SIGKILL)
                log(f"Killed orphaned process pid={pid} (cwd under {workspace}) "
                    f"before workspace cleanup.")
            except ProcessLookupError:
                pass
            except PermissionError:
                log(f"WARNING: found process pid={pid} with cwd under {workspace} "
                    f"but lack permission to kill it — may leak past cleanup.")


def cleanup_workspace(workspace: Path) -> None:
    kill_orphans_under_workspace(workspace)
    shutil.rmtree(workspace, ignore_errors=True)


# --------------------------------------------------------------------------
# git-pr-ci-v1 special-cased setup: real GitHub repo, not a local scaffold
# --------------------------------------------------------------------------

def gh_env():
    """Environment for gh/git calls against local-ai-machine-test, sourcing
    the scoped PAT if present (matches reset_agentic_test_repo.sh's own
    documented auth convention) — falls back to whatever gh/git are already
    authenticated as in the calling environment otherwise."""
    env = os.environ.copy()
    secret_path = REPO_ROOT / "secrets" / "gh-agentic-test-repo-token.env"
    # Also check /etc/nixos/secrets, the actual on-box location per M-021's
    # Handoff notes — the repo-relative secrets/ path is gitignored and may
    # not exist in every checkout, but the box's copy at /etc/nixos/secrets
    # is what's actually live and verified working.
    for candidate in (Path("/etc/nixos/secrets/gh-agentic-test-repo-token.env"), secret_path):
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
            break
    return env


def reset_git_pr_ci_repo() -> None:
    log(f"Resetting {GIT_PR_CI_REPO} to baseline via {RESET_SCRIPT.name} ...")
    result = subprocess.run(
        [str(RESET_SCRIPT)], cwd=str(REPO_ROOT), env=gh_env(),
        capture_output=True, text=True, timeout=300,
    )
    if result.stdout:
        print(result.stdout)
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"reset_agentic_test_repo.sh failed (exit {result.returncode}) — "
                            f"refusing to proceed with a possibly-dirty shared test repo")


def clone_git_pr_ci_repo(workspace: Path) -> None:
    result = subprocess.run(
        ["gh", "repo", "clone", GIT_PR_CI_REPO, str(workspace)],
        cwd=str(REPO_ROOT), env=gh_env(), capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"failed to clone {GIT_PR_CI_REPO}: {result.stderr.strip()}")


# --------------------------------------------------------------------------
# opencode: per-run opencode.json provider config + `opencode run`
# --------------------------------------------------------------------------

def write_opencode_config(workspace: Path, alias: str, base_url: str, api_key: str) -> None:
    """opencode discovers opencode.json from its cwd (the workspace root
    here) automatically — no --config flag needed. Registers a single
    custom "litellm" provider (name is just a label; it does not need to
    literally be litellm if base_url points elsewhere) via the
    @ai-sdk/openai-compatible adapter, with exactly one models{} entry for
    this run's target alias. Verified 2026-07-28 via a live smoke test
    (real tool call + real completion via a standing service)."""
    config = {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            "bench": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "bench",
                "options": {
                    "baseURL": base_url,
                    "apiKey": api_key,
                },
                "models": {
                    alias: {"name": alias}
                },
            }
        },
    }
    (workspace / "opencode.json").write_text(json.dumps(config, indent=2))


def build_opencode_cmd(alias: str, prompt: str) -> list:
    return [
        "opencode", "run",
        "--model", f"bench/{alias}",
        "--format", "json",
        "--auto",  # required for unattended headless operation — no TTY to
                   # answer an interactive permission prompt, and opencode
                   # has no other documented headless-approval mechanism.
        prompt,
    ]


# --------------------------------------------------------------------------
# Pi: shared ~/.pi/agent/models.json (rewritten fresh per run) + `pi --mode json`
# --------------------------------------------------------------------------

def pi_home_config_path(agent_home: Path) -> Path:
    return agent_home / ".pi" / "agent" / "models.json"


def write_pi_models_config(agent_home: Path, alias: str, base_url: str, api_key: str) -> None:
    """Pi has no documented per-run config-path override (confirmed
    2026-07-28 during implementation — the M-021 card's "baseUrl model
    config" note undersold how literal a JSON config file this is; see
    Pi's own docs/models.md) — so this writes exactly one provider/one
    model entry for this run's target alias into agent_home's
    ~/.pi/agent/models.json (agent_home is the isolated per-run $HOME from
    make_isolated_agent_home, not the real chris $HOME — see that
    function's docstring for why). Rewriting fresh per run (rather than
    reusing a persistent file) is only safe because M-021's own
    GPU-contention safety sequencing already requires runs to be strictly
    sequential, never concurrent, on this box."""
    compat = {}
    if "qwen" in alias.lower():
        # Local Qwen-compatible servers read chat_template_kwargs.enable_thinking,
        # not the plain top-level "qwen" flag or default OpenAI
        # reasoning_effort mapping — Pi's own docs/custom-provider.md and
        # docs/models.md both call this out explicitly as the local-serving
        # convention (as opposed to DashScope's hosted API).
        compat["thinkingFormat"] = "qwen-chat-template"

    config = {
        "providers": {
            "litellm": {
                "baseUrl": base_url,
                "api": "openai-completions",
                "apiKey": api_key,
                **({"compat": compat} if compat else {}),
                "models": [
                    {
                        "id": alias,
                        "name": alias,
                        "reasoning": False,
                        "input": ["text"],
                        "contextWindow": 131072,
                        "maxTokens": 16384,
                        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                    }
                ],
            }
        }
    }
    path = pi_home_config_path(agent_home)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2))


def pi_bin() -> str:
    """Resolve the pi CLI, installed via `npm install -g` with a custom
    prefix (~/.npm-global) rather than nixpkgs (no nixpkgs package exists
    for it, confirmed 2026-07-28) — not guaranteed to already be on PATH in
    every calling shell, so resolve it explicitly rather than assuming."""
    custom_prefix_bin = Path.home() / ".npm-global" / "bin" / "pi"
    if custom_prefix_bin.exists():
        return str(custom_prefix_bin)
    found = shutil.which("pi")
    if found:
        return found
    raise RuntimeError(
        "pi CLI not found (checked ~/.npm-global/bin/pi and PATH) — "
        "install via: npm config set prefix ~/.npm-global && "
        "npm install -g @mariozechner/pi-coding-agent"
    )


def build_pi_cmd(alias: str, prompt: str) -> list:
    return [
        pi_bin(),
        "--provider", "litellm",
        "--model", alias,
        "--mode", "json",
        "-p", prompt,
    ]


# --------------------------------------------------------------------------
# Process execution with a self-enforced wall-clock ceiling
# --------------------------------------------------------------------------

def run_harness_process(cmd: list, cwd: Path, env: dict, transcript_path: Path,
                         ceiling_s: int = WALL_CLOCK_CEILING_S):
    """Runs cmd, streaming stdout/stderr to transcript_path as it arrives
    (so a killed-on-timeout run still leaves a full partial transcript, not
    nothing). Enforces ceiling_s itself via SIGTERM then SIGKILL — neither
    opencode nor Pi has a documented built-in timeout/exit-code guarantee
    (confirmed during M-021 design), so this is the harness's own safety
    net, not a substitute for the tool's own judgment about when it's done.

    Returns (terminated_reason, wall_clock_s, returncode_or_None).
    terminated_reason is one of "completed" | "timeout" | "error".
    """
    # Real bug found during harness smoke-testing (2026-07-28): passing
    # cwd=<workspace> to Popen changes the OS-level working directory, but
    # opencode additionally resolves its own "project directory" from the
    # inherited PWD *environment variable* (used internally for an
    # instance-registry/dedup mechanism) rather than trusting the process's
    # actual cwd — if PWD is stale (e.g. still pointing at the calling
    # shell's directory, which is exactly what a plain os.environ.copy()
    # preserves), opencode silently creates a SECOND internal "instance"
    # rooted at that stale directory and runs the prompt there instead,
    # against whatever (or no) opencode.json that stale directory has —
    # observed directly as an instant (<1s) "ProviderModelNotFoundError:
    # Model not found" failure, since the real per-run opencode.json (with
    # this run's provider/model registered) only exists in the intended
    # workspace, not at the stale PWD. Explicitly overriding PWD to match
    # cwd fixes this — confirmed by reproducing the failure with a stale
    # PWD and then re-running identically except for this override.
    env = dict(env)
    env["PWD"] = str(cwd)

    start = time.monotonic()
    with open(transcript_path, "wb") as logf:
        try:
            proc = subprocess.Popen(
                cmd, cwd=str(cwd), env=env,
                stdout=logf, stderr=subprocess.STDOUT,
                start_new_session=True,  # own process group, so a timeout kill
                                          # can take any child processes with it
                                          # (opencode/pi may spawn subprocesses
                                          # for tool calls) rather than
                                          # orphaning them.
            )
        except FileNotFoundError as e:
            return "error", 0.0, None, str(e)

        try:
            returncode = proc.wait(timeout=ceiling_s)
            wall = time.monotonic() - start
            reason = "completed" if returncode == 0 else "error"
            return reason, wall, returncode, None
        except subprocess.TimeoutExpired:
            log(f"Wall-clock ceiling ({ceiling_s}s) hit — sending SIGTERM to process group.")
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=SIGTERM_GRACE_S)
            except subprocess.TimeoutExpired:
                log("Process didn't exit after SIGTERM within grace period — SIGKILL.")
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    pass
            wall = time.monotonic() - start
            return "timeout", wall, proc.returncode, None


# --------------------------------------------------------------------------
# Grading
# --------------------------------------------------------------------------

def grade_docs_research(workspace: Path) -> dict:
    grader = task_dir("docs-research-v1") / "hidden" / "grade.py"
    result = subprocess.run(
        [sys.executable, str(grader), "--workspace", str(workspace), "--json"],
        capture_output=True, text=True, timeout=120,
    )
    return json.loads(result.stdout)


def grade_docker_lifecycle(workspace: Path, project_name: str) -> dict:
    grader = task_dir("docker-lifecycle-v1") / "hidden" / "grade.py"
    result = subprocess.run(
        [sys.executable, str(grader), "--workspace", str(workspace),
         "--project-name", project_name, "--json"],
        capture_output=True, text=True, timeout=400,
    )
    return json.loads(result.stdout)


# docker-lifecycle-v1's starter/docker-compose.yml hardcodes fixed
# container_name: wordcount-backend / wordcount-frontend (not scoped by
# compose project name at all) — real gap found during harness smoke
# testing 2026-07-28: an agent session that runs `docker compose up`
# itself (as the task explicitly instructs it to) creates these two fixed-
# name containers regardless of cwd/project name, so they persist under
# their own fixed names even after the *grader's* differently-project-named
# stack is torn down (grade.py's own teardown only touches its own
# --project-name's containers, never the agent's). Confirmed live: a real
# smoke-test run left `wordcount-backend`/`wordcount-frontend` containers
# (and matching per-workspace-named images) running after the harness's
# own workspace + grading teardown had already completed — these must be
# force-removed by name (not by project) both before a new run starts
# (defensive, in case a previous crashed run left them) and after grading
# ends, or back-to-back docker-lifecycle-v1 runs (any two models) will
# collide on these exact names.
STRAY_DOCKER_LIFECYCLE_CONTAINER_NAMES = ["wordcount-backend", "wordcount-frontend"]


def cleanup_stray_docker_lifecycle_containers() -> None:
    subprocess.run(
        ["docker", "rm", "-f", *STRAY_DOCKER_LIFECYCLE_CONTAINER_NAMES],
        capture_output=True, text=True, timeout=60,
    )  # best-effort; nonzero exit just means they didn't exist, that's fine.


def grade_git_pr_ci() -> dict:
    grader = task_dir("git-pr-ci-v1") / "hidden" / "grade.py"
    result = subprocess.run(
        [sys.executable, str(grader), "--repo", GIT_PR_CI_REPO, "--json"],
        cwd=str(REPO_ROOT), env=gh_env(),
        capture_output=True, text=True, timeout=300,
    )
    return json.loads(result.stdout)


# --------------------------------------------------------------------------
# Per-run orchestration
# --------------------------------------------------------------------------

def run_one(task_id: str, harness: str, build_id: str, base_url: str, served_name: str,
            api_key: Optional[str] = None) -> dict:
    """Runs exactly one (task x harness x model) combination end to end.
    Returns a result dict suitable for a benchmark_runs[] entry's `result`
    field (pass_count/total_count/wall_clock_s/terminated_reason/
    transcript_raw_file), plus the raw grading `checks` detail.

    Caller (the orchestrator, or this file's own __main__ for standalone/
    smoke-test use) is responsible for GPU-contention safety sequencing —
    this function assumes the target service is already up and reachable
    at base_url, and does not stop/start/restore anything itself."""
    if task_id not in TASK_IDS:
        raise ValueError(f"unknown task_id {task_id!r}, expected one of {TASK_IDS}")
    if harness not in BENCHMARK_IDS:
        raise ValueError(f"unknown harness {harness!r}, expected one of {list(BENCHMARK_IDS)}")

    run_id = uuid.uuid4().hex[:8]
    timestamp = utcnow_compact()
    resolved_api_key = resolve_api_key(base_url, api_key)
    prompt = read_task_prompt(task_id)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    transcript_path = RAW_DIR / f"{build_id}--{BENCHMARK_IDS[harness]}--{task_id}--{timestamp}--transcript.jsonl"

    workspace = make_scratch_workspace(task_id, run_id)
    agent_home = make_isolated_agent_home(run_id)
    log(f"[{build_id}/{harness}/{task_id}] Scratch workspace: {workspace}")
    log(f"[{build_id}/{harness}/{task_id}] Isolated agent $HOME: {agent_home}")

    is_git_pr_ci = task_id == "git-pr-ci-v1"
    is_docker_lifecycle = task_id == "docker-lifecycle-v1"

    try:
        # -------------------- SETUP --------------------
        if is_docker_lifecycle:
            # Defensive: in case a previous crashed run left the fixed-name
            # wordcount-* containers behind (see
            # cleanup_stray_docker_lifecycle_containers()'s docstring).
            cleanup_stray_docker_lifecycle_containers()
        if is_git_pr_ci:
            reset_git_pr_ci_repo()  # BEFORE, so the agent starts clean.
            clone_git_pr_ci_repo(workspace)
        else:
            setup_workspace(task_id, workspace)

        # -------------------- HARNESS CONFIG --------------------
        # isolated_agent_env: the candidate model's own subprocess gets a
        # fake $HOME with no .ssh at all (see make_isolated_agent_home's
        # docstring) — it structurally cannot reach the box's broad
        # account-level SSH key regardless of what its shell commands try.
        # GH_TOKEN (the properly-scoped fine-grained PAT) IS still present,
        # since that's the intended credential for the agent's own
        # git-pr-ci-v1 operations against the HTTPS remote clone_git_pr_ci_
        # repo() already set up.
        env = isolated_agent_env(os.environ.copy(), agent_home)
        if harness == "opencode":
            write_opencode_config(workspace, served_name, base_url, resolved_api_key)
            cmd = build_opencode_cmd(served_name, prompt)
        else:
            write_pi_models_config(agent_home, served_name, base_url, resolved_api_key)
            cmd = build_pi_cmd(served_name, prompt)
            env.setdefault("PATH", os.environ.get("PATH", ""))

        # -------------------- RUN --------------------
        log(f"[{build_id}/{harness}/{task_id}] Running headless (ceiling {WALL_CLOCK_CEILING_S}s) ...")
        reason, wall_s, returncode, error = run_harness_process(cmd, workspace, env, transcript_path)
        if error:
            log(f"[{build_id}/{harness}/{task_id}] Harness process failed to start: {error}")

        if not is_git_pr_ci:
            verify_hidden_never_leaked(task_id, workspace)

        # -------------------- GRADE --------------------
        # Grading always runs, even on timeout/error — a killed/incomplete
        # session may still have left partial, gradable progress (e.g. some
        # files edited, or for git-pr-ci-v1, a PR opened but not yet
        # merged), and "0/N because nothing happened" is itself a real,
        # meaningful data point distinct from a grading-script crash.
        log(f"[{build_id}/{harness}/{task_id}] Grading ...")
        try:
            if task_id == "docs-research-v1":
                grade = grade_docs_research(workspace)
            elif task_id == "docker-lifecycle-v1":
                grade = grade_docker_lifecycle(workspace, f"agentic-bench-{run_id}")
            else:
                grade = grade_git_pr_ci()
        except Exception as e:  # noqa: BLE001
            log(f"[{build_id}/{harness}/{task_id}] Grading itself failed: {e}")
            grade = {"pass_count": 0, "total_count": 0, "checks": [], "grading_error": str(e)}

        result = {
            "task_id": task_id,
            "harness": harness,
            "pass_count": grade.get("pass_count"),
            "total_count": grade.get("total_count"),
            "checks": grade.get("checks"),
            "wall_clock_s": wall_s,
            "terminated_reason": reason,
            "harness_returncode": returncode,
            "transcript_raw_file": str(transcript_path.relative_to(REPO_ROOT)),
        }
        log(f"[{build_id}/{harness}/{task_id}] Result: {result['pass_count']}/{result['total_count']} "
            f"({reason}, {wall_s:.0f}s)")
        return result
    finally:
        # -------------------- TEARDOWN --------------------
        if is_git_pr_ci:
            # AFTER, so a crashed/incomplete run never leaves stray
            # branches/PRs for the next model — regardless of whether the
            # session or grading above succeeded, failed, or timed out.
            # Grading has already run (it needs the pre-reset state), so
            # this ordering is safe: grade first, reset second, always.
            try:
                reset_git_pr_ci_repo()
            except Exception as e:  # noqa: BLE001
                log(f"[{build_id}/{harness}/{task_id}] WARNING: post-run reset failed: {e} — "
                    f"the shared test repo may be left dirty for the next run, "
                    f"investigate before the next git-pr-ci-v1 run.")
        if is_docker_lifecycle:
            # AFTER, unconditionally — the grader's own teardown only tears
            # down its own --project-name's stack, never the agent's
            # separately-named one (see cleanup_stray_docker_lifecycle_
            # containers()'s docstring for the real incident this guards
            # against, found during harness smoke testing).
            cleanup_stray_docker_lifecycle_containers()
        cleanup_workspace(workspace)
        shutil.rmtree(agent_home, ignore_errors=True)


def run_all_tasks(harness: str, build_id: str, base_url: str, served_name: str,
                   api_key: Optional[str] = None, tasks=None) -> list:
    tasks = tasks or TASK_IDS
    results = []
    for task_id in tasks:
        results.append(run_one(task_id, harness, build_id, base_url, served_name, api_key))
    return results


# --------------------------------------------------------------------------
# CLI (standalone / smoke-test entrypoint)
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--harness", required=True, choices=["opencode", "pi"])
    ap.add_argument("--task", required=True, choices=TASK_IDS + ["all"])
    ap.add_argument("--build-id", required=True, help="build id, used only for output file naming")
    ap.add_argument("--base-url", required=True, help="OpenAI-compatible base URL, e.g. http://127.0.0.1:4000/v1")
    ap.add_argument("--served-name", required=True, help="model name/alias as the endpoint expects it")
    ap.add_argument("--api-key", default=None, help="override auto-resolved API key (litellm master key or 'none')")
    ap.add_argument("--output", default=None, help="write the full JSON result(s) here too")
    args = ap.parse_args()

    tasks = TASK_IDS if args.task == "all" else [args.task]
    results = run_all_tasks(args.harness, args.build_id, args.base_url, args.served_name,
                             args.api_key, tasks)

    print(json.dumps(results, indent=2))
    if args.output:
        Path(args.output).write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
