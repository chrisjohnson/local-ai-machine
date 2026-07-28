#!/usr/bin/env python3
"""wordcount-frontend: tracks word occurrences by delegating storage to the
wordcount-backend service, and reports the top-N most frequent words.

Endpoints:
  POST /track      -> body {"word": <str>, "amount": <int, optional>}
                       increments that word's count via the backend and
                       returns {"word": <str>, "count": <int>} (the NEW
                       total count after this increment, straight from the
                       backend response).
  GET  /top?n=<N>  -> {"top": [["word", count], ...]} -- the N most
                       frequent words tracked so far, MOST frequent first
                       (descending by count). Defaults to n=5 if not given.
  GET  /health      -> {"status": "ok"} only if the backend is also
                       reachable (checks the backend's own /health first).

Talks to the backend over HTTP using the BACKEND_URL environment variable
(e.g. "http://backend:9100"). Stdlib only.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:9100").rstrip("/")

# Tracks every distinct word this frontend has ever seen tracked, along with
# the last known count for it (refreshed on every /track call). Used only to
# know which keys to ask the backend about for /top -- the backend remains
# the source of truth for actual counts.
SEEN_WORDS = {}


def _backend_get(path: str) -> dict:
    with urllib.request.urlopen(BACKEND_URL + path, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _backend_post(path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BACKEND_URL + path, data=data, method="POST", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            try:
                backend_health = _backend_get("/health")
                if backend_health.get("status") == "ok":
                    self._send_json(200, {"status": "ok"})
                else:
                    self._send_json(503, {"status": "backend_unhealthy"})
            except Exception as e:
                self._send_json(503, {"status": "backend_unreachable", "error": str(e)})
            return

        if parsed.path == "/top":
            qs = parse_qs(parsed.query)
            try:
                n = int(qs.get("n", ["5"])[0])
            except Exception:
                n = 5

            results = []
            for word in SEEN_WORDS:
                try:
                    data = _backend_get(f"/count/{word}")
                    results.append((word, data["count"]))
                except Exception:
                    continue

            # BUG: not actually sorted by count descending -- currently
            # sorted ascending (or effectively unsorted), so /top does not
            # return the MOST frequent words first as documented above.
            results.sort(key=lambda pair: pair[1])
            self._send_json(200, {"top": results[:n]})
            return

        self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/track":
            self._send_json(404, {"error": "not_found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
            word = body["word"]
            amount = int(body.get("amount", 1))
        except Exception:
            self._send_json(400, {"error": "bad_request"})
            return

        try:
            result = _backend_post(f"/count/{word}", {"amount": amount})
        except urllib.error.URLError as e:
            self._send_json(502, {"error": "backend_unreachable", "detail": str(e)})
            return
        except Exception as e:
            self._send_json(502, {"error": "backend_error", "detail": str(e)})
            return

        SEEN_WORDS[word] = result["count"]
        self._send_json(200, {"word": word, "count": result["count"]})

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "9200"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"wordcount-frontend listening on 0.0.0.0:{port}, backend={BACKEND_URL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
