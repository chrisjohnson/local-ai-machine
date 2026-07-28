#!/usr/bin/env python3
"""wordcount-backend: tiny in-memory counter service.

Endpoints:
  GET  /count/<key>          -> {"key": key, "count": <int>}
  POST /count/<key>          -> body {"amount": <int>}, increments the
                                 counter for <key> by <amount> (default 1
                                 if body omitted/empty), returns the new
                                 {"key": key, "count": <int>}
  GET  /health                -> {"status": "ok"}

Intentionally minimal, stdlib only (http.server), in-memory (no
persistence -- restarting the container resets all counts, which is fine
for this task).
"""
from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COUNTS = {}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        m = re.match(r"^/count/([^/]+)$", self.path)
        if not m:
            self._send_json(404, {"error": "not_found"})
            return
        key = m.group(1)
        self._send_json(200, {"key": key, "count": COUNTS.get(key, 0)})

    def do_POST(self):
        m = re.match(r"^/count/([^/]+)$", self.path)
        if not m:
            self._send_json(404, {"error": "not_found"})
            return
        key = m.group(1)
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        amount = 1
        if raw:
            try:
                body = json.loads(raw.decode("utf-8"))
                amount = int(body.get("amount", 1))
            except Exception:
                self._send_json(400, {"error": "bad_request"})
                return
        COUNTS[key] = COUNTS.get(key, 0) + amount
        self._send_json(200, {"key": key, "count": COUNTS[key]})

    def log_message(self, fmt, *args):
        pass


def main():
    import os

    port = int(os.environ.get("PORT", "9100"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"wordcount-backend listening on 0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
