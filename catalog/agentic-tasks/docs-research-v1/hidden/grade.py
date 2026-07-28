#!/usr/bin/env python3
"""Hidden grading script for agentic-tasks/docs-research-v1.

Grades the agent's implementation of `LedgerClient.post_transaction`
against the retry/backoff contract documented in the starter workspace's
DOCS.md. Stdlib only, no LLM judge — every check is a structural/behavioral
assertion against a scripted fake HTTP server that returns a fixed sequence
of responses per check, so retry timing and give-up behavior can be graded
exactly instead of guessed at.

This script is NOT copied into the agent's workspace. It is run by the
harness after the session ends, pointed at the (possibly modified)
`ledgerclient` package copied out of the agent's workspace.

Usage:
    python3 grade.py --workspace /path/to/agent/workspace [--json]

Exit code 0 always (grading is percent-based, not a pass/fail gate) unless
the script itself errors out before producing a result.
"""
from __future__ import annotations

import argparse
import importlib.util
import json as jsonlib
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Callable, List, Optional


# ---------------------------------------------------------------------
# Scripted fake server: each check installs a script of responses that get
# played back in order, one per request received, so retry counts/timing
# can be asserted exactly.
# ---------------------------------------------------------------------

@dataclass
class ScriptedResponse:
    code: int
    body: dict
    retry_after: Optional[str] = None


@dataclass
class RequestLog:
    method: str
    path: str
    body: Optional[dict]
    received_at: float


class _ScriptedHandler(BaseHTTPRequestHandler):
    script: List[ScriptedResponse] = []
    log: List[RequestLog] = []
    lock = threading.Lock()

    def _handle(self, method: str):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        body = None
        if raw:
            try:
                body = jsonlib.loads(raw.decode("utf-8"))
            except Exception:
                body = None

        with self.lock:
            self.log.append(RequestLog(method, self.path, body, time.monotonic()))
            idx = len(self.log) - 1
            if idx < len(self.script):
                resp = self.script[idx]
            else:
                # Ran out of script -- treat as an unexpected extra call.
                resp = ScriptedResponse(500, {"error": "unscripted_extra_request"})

        payload = jsonlib.dumps(resp.body).encode("utf-8")
        self.send_response(resp.code)
        if resp.retry_after is not None:
            self.send_header("Retry-After", resp.retry_after)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def log_message(self, fmt, *args):
        pass


class ScriptedServer:
    """Context manager running a scripted fake HTTP server on a free port."""

    def __init__(self, script: List[ScriptedResponse]):
        handler_cls = type(
            "BoundHandler",
            (_ScriptedHandler,),
            {"script": script, "log": [], "lock": threading.Lock()},
        )
        self._handler_cls = handler_cls
        self.server = HTTPServer(("127.0.0.1", 0), handler_cls)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.port}"

    @property
    def requests(self) -> List[RequestLog]:
        return list(self._handler_cls.log)


# ---------------------------------------------------------------------
# Check harness
# ---------------------------------------------------------------------

@dataclass
class CheckResult:
    id: str
    description: str
    passed: bool
    detail: str = ""


def load_ledgerclient(workspace: Path):
    """Import the agent's ledgerclient package fresh (not the hidden dir's
    copy -- there isn't one; this module lives only in the starter)."""
    pkg_init = workspace / "ledgerclient" / "__init__.py"
    if not pkg_init.exists():
        raise FileNotFoundError(f"ledgerclient package not found under {workspace}")

    spec = importlib.util.spec_from_file_location(
        "ledgerclient", pkg_init, submodule_search_locations=[str(pkg_init.parent)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["ledgerclient"] = module
    spec.loader.exec_module(module)
    return module


def make_client(module, base_url: str, sleeps: List[float]):
    def fake_sleep(seconds):
        sleeps.append(seconds)

    return module.LedgerClient(base_url, sleep_fn=fake_sleep)


# -- individual checks --------------------------------------------------

def check_happy_path(module) -> CheckResult:
    """post_transaction succeeds on the first try and returns a correctly
    populated TransactionResult."""
    script = [
        ScriptedResponse(
            200,
            {
                "transaction_id": "txn-1",
                "account_id": "acct-1",
                "amount_cents": 500,
                "new_balance_cents": 10_500,
            },
        )
    ]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        try:
            result = client.post_transaction("acct-1", 500)
        except Exception as e:
            return CheckResult("happy_path", "successful post_transaction call", False, f"raised {e!r}")

        ok = (
            getattr(result, "transaction_id", None) == "txn-1"
            and getattr(result, "account_id", None) == "acct-1"
            and getattr(result, "amount_cents", None) == 500
            and getattr(result, "new_balance_cents", None) == 10_500
        )
        req = server.requests[0] if server.requests else None
        req_ok = (
            req is not None
            and req.method == "POST"
            and req.path == "/accounts/acct-1/transactions"
            and req.body == {"amount_cents": 500}
        )
        passed = ok and req_ok
        detail = "" if passed else f"result={result!r} request={req!r}"
        return CheckResult("happy_path", "successful post_transaction call", passed, detail)


def check_honors_retry_after_exactly(module) -> CheckResult:
    """On a 429, the client must sleep for (approximately) exactly the
    Retry-After value -- not longer (exponential backoff), not shorter."""
    script = [
        ScriptedResponse(429, {"error": "rate_limited"}, retry_after="2"),
        ScriptedResponse(
            200,
            {
                "transaction_id": "txn-2",
                "account_id": "acct-1",
                "amount_cents": 100,
                "new_balance_cents": 10_100,
            },
        ),
    ]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        try:
            client.post_transaction("acct-1", 100)
        except Exception as e:
            return CheckResult(
                "honors_retry_after_exactly",
                "sleeps exactly Retry-After seconds on 429, then succeeds",
                False,
                f"raised {e!r}",
            )

        # Tolerance: contract says late is fine, more than 250ms early is
        # flagged. We grade close-to-exact (allow late up to a generous
        # margin for scheduling jitter in a test harness, but an
        # exponential-backoff implementation would produce a very different
        # number, e.g. 4s/8s or 2s*jitter -- 2s +/- small margin is the only
        # value consistent with "honor Retry-After exactly").
        got = sleeps[0] if sleeps else None
        passed = got is not None and 1.9 <= got <= 4.0
        detail = f"sleep_fn called with {sleeps!r} (expected ~2.0, tolerant up to 4.0 for late-is-ok)"
        return CheckResult(
            "honors_retry_after_exactly",
            "sleeps exactly Retry-After seconds on 429, then succeeds",
            passed,
            "" if passed else detail,
        )


def check_gives_up_after_3_retries(module) -> CheckResult:
    """4 total attempts (1 + 3 retries), all 429 -> must raise LedgerError,
    never loop forever or return a fabricated result."""
    script = [ScriptedResponse(429, {"error": "rate_limited"}, retry_after="0") for _ in range(6)]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        raised = None
        try:
            client.post_transaction("acct-1", 100)
        except Exception as e:
            raised = e

        is_ledger_error = raised is not None and type(raised).__name__ == "LedgerError"
        attempts = len(server.requests)
        # Exactly 4 attempts: first try + 3 retries.
        attempts_ok = attempts == 4
        passed = is_ledger_error and attempts_ok
        detail = f"raised={raised!r} attempts={attempts} (expected LedgerError after exactly 4 attempts)"
        return CheckResult(
            "gives_up_after_3_retries",
            "raises LedgerError after exactly 3 retries (4 attempts total), no infinite loop",
            passed,
            "" if passed else detail,
        )


def check_503_without_retry_after_not_retried(module) -> CheckResult:
    """503 with no Retry-After header must NOT be retried -- raise
    immediately, single attempt only."""
    script = [ScriptedResponse(503, {"error": "down"}, retry_after=None)]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        raised = None
        try:
            client.post_transaction("acct-1", 100)
        except Exception as e:
            raised = e

        is_ledger_error = raised is not None and type(raised).__name__ == "LedgerError"
        attempts = len(server.requests)
        passed = is_ledger_error and attempts == 1
        detail = f"raised={raised!r} attempts={attempts} (expected immediate LedgerError, 1 attempt only)"
        return CheckResult(
            "503_without_retry_after_not_retried",
            "503 with no Retry-After is treated as non-retryable",
            passed,
            "" if passed else detail,
        )


def check_503_with_retry_after_is_retried(module) -> CheckResult:
    """503 WITH a Retry-After header should be retried the same as a 429."""
    script = [
        ScriptedResponse(503, {"error": "down"}, retry_after="1"),
        ScriptedResponse(
            200,
            {
                "transaction_id": "txn-3",
                "account_id": "acct-1",
                "amount_cents": 100,
                "new_balance_cents": 10_100,
            },
        ),
    ]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        try:
            result = client.post_transaction("acct-1", 100)
        except Exception as e:
            return CheckResult(
                "503_with_retry_after_is_retried",
                "503 WITH Retry-After is retried like a 429",
                False,
                f"raised {e!r}",
            )
        attempts = len(server.requests)
        passed = attempts == 2 and getattr(result, "transaction_id", None) == "txn-3"
        detail = f"attempts={attempts} result={result!r}"
        return CheckResult(
            "503_with_retry_after_is_retried",
            "503 WITH Retry-After is retried like a 429",
            passed,
            "" if passed else detail,
        )


def check_other_4xx_never_retried(module) -> CheckResult:
    """A non-429 4xx (e.g. 400) must never be retried, even if it somehow
    carried a Retry-After header."""
    script = [ScriptedResponse(400, {"error": "bad_request"}, retry_after="1")]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        raised = None
        try:
            client.post_transaction("acct-1", 100)
        except Exception as e:
            raised = e

        is_ledger_error = raised is not None and type(raised).__name__ == "LedgerError"
        attempts = len(server.requests)
        passed = is_ledger_error and attempts == 1
        detail = f"raised={raised!r} attempts={attempts} (expected immediate LedgerError, 1 attempt only)"
        return CheckResult(
            "other_4xx_never_retried",
            "non-429 4xx is never retried even with Retry-After present",
            passed,
            "" if passed else detail,
        )


def check_request_shape(module) -> CheckResult:
    """The POST body/path must match the documented API shape exactly."""
    script = [
        ScriptedResponse(
            200,
            {
                "transaction_id": "txn-4",
                "account_id": "acct-9",
                "amount_cents": -250,
                "new_balance_cents": 750,
            },
        )
    ]
    with ScriptedServer(script) as server:
        sleeps: List[float] = []
        client = make_client(module, server.base_url, sleeps)
        try:
            client.post_transaction("acct-9", -250)
        except Exception as e:
            return CheckResult("request_shape", "POST path/body match documented API shape", False, f"raised {e!r}")

        req = server.requests[0] if server.requests else None
        passed = (
            req is not None
            and req.method == "POST"
            and req.path == "/accounts/acct-9/transactions"
            and req.body == {"amount_cents": -250}
        )
        detail = f"request={req!r}"
        return CheckResult(
            "request_shape",
            "POST path/body match documented API shape",
            passed,
            "" if passed else detail,
        )


CHECKS: List[Callable[[object], CheckResult]] = [
    check_happy_path,
    check_request_shape,
    check_honors_retry_after_exactly,
    check_gives_up_after_3_retries,
    check_503_without_retry_after_not_retried,
    check_503_with_retry_after_is_retried,
    check_other_4xx_never_retried,
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, help="path to the agent's (post-session) workspace")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON instead of text")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    results = []

    try:
        module = load_ledgerclient(workspace)
    except Exception as e:
        # Import itself failed -- every check fails, but we still emit a
        # full, well-formed result rather than crashing the harness.
        for check_fn in CHECKS:
            results.append(
                CheckResult(check_fn.__name__, check_fn.__doc__ or "", False, f"import failed: {e!r}")
            )
        _emit(results, args.json)
        return

    for check_fn in CHECKS:
        try:
            results.append(check_fn(module))
        except Exception as e:
            results.append(CheckResult(check_fn.__name__, check_fn.__doc__ or "", False, f"check crashed: {e!r}"))

    _emit(results, args.json)


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
