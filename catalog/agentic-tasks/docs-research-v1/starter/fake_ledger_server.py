#!/usr/bin/env python3
"""A tiny in-memory fake of the Ledger service, for local manual testing
only. Not a substitute for reading DOCS.md — this fake does not enforce or
explain the retry contract, it just demonstrates the status codes/headers a
real client has to react to correctly.

Usage:
    python3 fake_ledger_server.py [--port 8080] [--flaky]

With --flaky, roughly 1 in 3 requests gets a 429 with Retry-After: 1 instead
of succeeding, so you can watch retry behavior happen against something
real. Balances are all in-memory and reset when the process restarts.
"""
from __future__ import annotations

import argparse
import json
import random
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

BALANCES = {"acct-1": 10_000, "acct-2": 500}
TRANSACTIONS = []


class Handler(BaseHTTPRequestHandler):
    flaky = False

    def _maybe_throttle(self) -> bool:
        if self.flaky and random.random() < 0.33:
            self.send_response(429)
            self.send_header("Retry-After", "1")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "rate_limited"}')
            return True
        return False

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        m = re.match(r"^/accounts/([^/]+)/balance$", self.path)
        if not m:
            self._send_json(404, {"error": "not_found"})
            return
        if self._maybe_throttle():
            return
        account_id = m.group(1)
        balance = BALANCES.get(account_id)
        if balance is None:
            self._send_json(404, {"error": "no_such_account"})
            return
        self._send_json(200, {"account_id": account_id, "balance_cents": balance})

    def do_POST(self):
        m = re.match(r"^/accounts/([^/]+)/transactions$", self.path)
        if not m:
            self._send_json(404, {"error": "not_found"})
            return
        if self._maybe_throttle():
            return
        account_id = m.group(1)
        if account_id not in BALANCES:
            self._send_json(404, {"error": "no_such_account"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
            amount_cents = int(body["amount_cents"])
        except Exception:
            self._send_json(400, {"error": "bad_request"})
            return
        BALANCES[account_id] += amount_cents
        txn_id = f"txn-{len(TRANSACTIONS) + 1}"
        TRANSACTIONS.append((txn_id, account_id, amount_cents))
        self._send_json(
            200,
            {
                "transaction_id": txn_id,
                "account_id": account_id,
                "amount_cents": amount_cents,
                "new_balance_cents": BALANCES[account_id],
            },
        )

    def log_message(self, fmt, *args):
        pass  # keep test output quiet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--flaky", action="store_true")
    args = parser.parse_args()

    Handler.flaky = args.flaky
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fake ledger server listening on http://127.0.0.1:{args.port} (flaky={args.flaky})")
    server.serve_forever()


if __name__ == "__main__":
    main()
