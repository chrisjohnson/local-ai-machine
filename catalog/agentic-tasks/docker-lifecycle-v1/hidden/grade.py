#!/usr/bin/env python3
"""Hidden grading script for agentic-tasks/docker-lifecycle-v1.

Real runtime validation, not a static file check: makes sure the
(agent-modified) compose stack is up (starting it itself if the agent left
it stopped), sends real HTTP requests against the running services, checks
real responses, then tears the stack down again. Stdlib only, no LLM
judge.

This script is NOT copied into the agent's workspace. It is run by the
harness after the session ends, pointed at the agent's (possibly modified)
workspace directory, which must still contain a valid docker-compose.yml
(compose project files are the deliverable, not the running containers
themselves -- if the agent stopped its containers, that's fine, we start
them back up here; if the agent left them running from its own session,
that's fine too, we just verify+use them and tear down when done).

Usage:
    python3 grade.py --workspace /path/to/agent/workspace [--json]
                      [--project-name NAME] [--keep-running]

Exit code 0 always (grading is percent-based) unless the script itself
fails to even attempt grading (e.g. docker compose unavailable).
"""
from __future__ import annotations

import argparse
import json as jsonlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


FRONTEND_PORT = 9200
BACKEND_PORT = 9100
STARTUP_TIMEOUT_S = 60
POLL_INTERVAL_S = 1.0


@dataclass
class CheckResult:
    id: str
    description: str
    passed: bool
    detail: str = ""


class ComposeError(Exception):
    pass


def run_compose(workspace: Path, project: str, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    cmd = ["docker", "compose", "-p", project, *args]
    return subprocess.run(
        cmd, cwd=str(workspace), capture_output=True, text=True, timeout=timeout
    )


def http_get(url: str, timeout: float = 5.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.status, jsonlib.loads(resp.read().decode("utf-8"))


def http_post(url: str, payload: dict, timeout: float = 5.0):
    data = jsonlib.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, jsonlib.loads(resp.read().decode("utf-8"))


def wait_for_health(url: str, timeout_s: float) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            status, body = http_get(url, timeout=3.0)
            if status == 200 and body.get("status") == "ok":
                return True
        except Exception:
            pass
        time.sleep(POLL_INTERVAL_S)
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, help="path to the agent's (post-session) workspace")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON instead of text")
    parser.add_argument(
        "--project-name",
        default=None,
        help="docker compose project name to use (default: a fresh random one, avoids colliding "
        "with whatever project name the agent's own session used)",
    )
    parser.add_argument(
        "--keep-running",
        action="store_true",
        help="don't tear the stack down at the end (debugging aid, not for normal harness use)",
    )
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    compose_file = workspace / "docker-compose.yml"
    project = args.project_name or f"grade-{uuid.uuid4().hex[:8]}"

    results: List[CheckResult] = []
    started_here = False

    if not compose_file.exists():
        results.append(CheckResult("compose_file_present", "docker-compose.yml exists in workspace", False,
                                    f"no docker-compose.yml under {workspace}"))
        _emit(results, args.json)
        return
    results.append(CheckResult("compose_file_present", "docker-compose.yml exists in workspace", True))

    try:
        up = run_compose(workspace, project, "up", "-d", "--build", timeout=300)
        started_here = True
        build_ok = up.returncode == 0
        results.append(
            CheckResult(
                "stack_builds_and_starts",
                "docker compose up -d --build succeeds",
                build_ok,
                "" if build_ok else f"stderr: {up.stderr[-2000:]}",
            )
        )

        if build_ok:
            frontend_healthy = wait_for_health(f"http://localhost:{FRONTEND_PORT}/health", STARTUP_TIMEOUT_S)
            results.append(
                CheckResult(
                    "frontend_health_ok",
                    "GET /health on the frontend returns 200 {status: ok} within timeout "
                    "(implies frontend can reach backend -- this is the misconfigured-env-var check)",
                    frontend_healthy,
                    "" if frontend_healthy else "frontend never reported healthy backend connectivity",
                )
            )
        else:
            results.append(CheckResult("frontend_health_ok", "frontend /health reachable", False, "stack failed to build/start"))

        # -- functional checks, only meaningful if the stack came up healthy --
        if build_ok and frontend_healthy:
            results.append(_check_track_and_backend_consistency())
            results.append(_check_top_sort_order())
        else:
            results.append(CheckResult("track_reaches_backend", "POST /track increments backend-side count", False, "skipped: stack not healthy"))
            results.append(CheckResult("top_sorted_descending", "GET /top returns most-frequent-first order", False, "skipped: stack not healthy"))

    except subprocess.TimeoutExpired as e:
        results.append(CheckResult("stack_builds_and_starts", "docker compose up -d --build succeeds", False, f"timed out: {e}"))
        results.append(CheckResult("frontend_health_ok", "frontend /health reachable", False, "skipped: build timed out"))
        results.append(CheckResult("track_reaches_backend", "POST /track increments backend-side count", False, "skipped: build timed out"))
        results.append(CheckResult("top_sorted_descending", "GET /top returns most-frequent-first order", False, "skipped: build timed out"))
    finally:
        if started_here and not args.keep_running:
            try:
                run_compose(workspace, project, "down", "-v", "--remove-orphans", timeout=120)
            except Exception:
                pass  # best-effort teardown; don't let a teardown failure corrupt the grading result

    _emit(results, args.json)


def _check_track_and_backend_consistency() -> CheckResult:
    """POST /track on the frontend must actually increment the count on the
    BACKEND (not just return a locally-fabricated number) -- verified by
    reading the backend directly, independent of the frontend's claim."""
    word = f"gradeword-{uuid.uuid4().hex[:6]}"
    try:
        status1, body1 = http_post(f"http://localhost:{FRONTEND_PORT}/track", {"word": word, "amount": 3})
        status2, body2 = http_post(f"http://localhost:{FRONTEND_PORT}/track", {"word": word, "amount": 4})
    except Exception as e:
        return CheckResult("track_reaches_backend", "POST /track increments backend-side count", False, f"request failed: {e!r}")

    if status1 != 200 or status2 != 200:
        return CheckResult(
            "track_reaches_backend", "POST /track increments backend-side count", False,
            f"unexpected status codes: {status1}, {status2}"
        )

    frontend_final_count = body2.get("count")

    try:
        backend_status, backend_body = http_get(f"http://localhost:{BACKEND_PORT}/count/{word}")
    except Exception as e:
        return CheckResult("track_reaches_backend", "POST /track increments backend-side count", False, f"backend read failed: {e!r}")

    backend_count = backend_body.get("count")
    passed = (
        backend_status == 200
        and backend_count == 7  # 3 + 4
        and frontend_final_count == 7
    )
    detail = f"frontend reported count={frontend_final_count}, backend directly reports count={backend_count} (expected both == 7)"
    return CheckResult(
        "track_reaches_backend",
        "POST /track increments backend-side count (checked directly against backend, not just frontend's claim)",
        passed,
        "" if passed else detail,
    )


def _check_top_sort_order() -> CheckResult:
    """GET /top must return words sorted MOST-frequent-first (descending),
    per frontend/server.py's documented contract -- the deliberately
    planted sort-direction bug."""
    words = [
        (f"grade-low-{uuid.uuid4().hex[:6]}", 1),
        (f"grade-mid-{uuid.uuid4().hex[:6]}", 5),
        (f"grade-high-{uuid.uuid4().hex[:6]}", 9),
    ]
    try:
        for word, amount in words:
            status, _ = http_post(f"http://localhost:{FRONTEND_PORT}/track", {"word": word, "amount": amount})
            if status != 200:
                return CheckResult(
                    "top_sorted_descending", "GET /top returns most-frequent-first order", False,
                    f"seeding /track for {word} returned {status}"
                )

        status, body = http_get(f"http://localhost:{FRONTEND_PORT}/top?n=10")
    except Exception as e:
        return CheckResult("top_sorted_descending", "GET /top returns most-frequent-first order", False, f"request failed: {e!r}")

    if status != 200:
        return CheckResult("top_sorted_descending", "GET /top returns most-frequent-first order", False, f"unexpected status {status}")

    top = body.get("top", [])
    high_word = words[2][0]
    mid_word = words[1][0]
    low_word = words[0][0]

    positions = {w: i for i, (w, _c) in enumerate(top)}
    if high_word not in positions or mid_word not in positions or low_word not in positions:
        return CheckResult(
            "top_sorted_descending", "GET /top returns most-frequent-first order", False,
            f"expected seeded words missing from /top response: {top!r}"
        )

    passed = positions[high_word] < positions[mid_word] < positions[low_word]
    detail = f"/top order (subset relevant to seeded words): {top!r} (expected high({high_word})=9 before mid({mid_word})=5 before low({low_word})=1)"
    return CheckResult(
        "top_sorted_descending",
        "GET /top returns most-frequent-first order (descending by count)",
        passed,
        "" if passed else detail,
    )


def _emit(results: List[CheckResult], as_json: bool):
    pass_count = sum(1 for r in results if r.passed)
    total_count = len(results)

    if as_json:
        print(
            jsonlib.dumps(
                {
                    "pass_count": pass_count,
                    "total_count": total_count,
                    "checks": [r.__dict__ for r in results],
                },
                indent=2,
            )
        )
    else:
        for r in results:
            status = "PASS" if r.passed else "FAIL"
            print(f"[{status}] {r.id}: {r.description}")
            if not r.passed and r.detail:
                print(f"       {r.detail}")
        print(f"\n{pass_count}/{total_count} checks passed")


if __name__ == "__main__":
    main()
