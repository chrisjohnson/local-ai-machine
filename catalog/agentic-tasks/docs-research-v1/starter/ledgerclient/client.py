"""Client for the internal Ledger service.

See DOCS.md at the repo root for the retry/backoff contract every method on
this client is expected to follow. Read it before touching retry logic —
the contract is not derivable from this code or from Ledger's OpenAPI
schema alone.
"""

from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional

MAX_RETRIES = 3  # 4 attempts total, including the first (see DOCS.md #3)


class LedgerError(Exception):
    """Raised when a Ledger request fails in a non-retryable way, or after
    exhausting the retry budget."""


@dataclass
class TransactionResult:
    transaction_id: str
    account_id: str
    amount_cents: int
    new_balance_cents: int


class LedgerClient:
    """Minimal client for the internal Ledger bookkeeping service.

    Parameters
    ----------
    base_url:
        Base URL of the Ledger service, e.g. "http://localhost:8080".
    sleep_fn:
        Injectable sleep function (defaults to time.sleep) so tests can run
        without real wall-clock delay. Do not remove this parameter — it's
        load-bearing for testing retry behavior quickly.
    """

    def __init__(self, base_url: str, sleep_fn=time.sleep):
        self.base_url = base_url.rstrip("/")
        self._sleep = sleep_fn

    # -- public API ---------------------------------------------------

    def get_balance(self, account_id: str) -> int:
        """Return the current balance, in cents, for the given account.

        Reference implementation of the Ledger retry contract (DOCS.md) —
        use this as the template for any other method that talks to
        Ledger, including post_transaction below.
        """
        path = f"/accounts/{account_id}/balance"
        body = self._request_with_retry("GET", path)
        return int(body["balance_cents"])

    def post_transaction(self, account_id: str, amount_cents: int) -> TransactionResult:
        """Post a transaction (positive = credit, negative = debit) against
        an account and return the resulting transaction record.

        NOT YET IMPLEMENTED. Must:
          - POST to /accounts/{account_id}/transactions with a JSON body
            {"amount_cents": amount_cents}
          - Follow the exact same Ledger retry contract as get_balance
            above (see DOCS.md) — this is a real internal requirement, not
            an implementation detail left to preference.
          - Return a TransactionResult built from the JSON response, which
            has the shape:
              {"transaction_id": str, "account_id": str,
               "amount_cents": int, "new_balance_cents": int}
        """
        raise NotImplementedError("post_transaction is not implemented yet")

    # -- internals ------------------------------------------------------

    def _request_with_retry(self, method: str, path: str, json_body: Optional[dict] = None) -> dict:
        """Reference retry-contract implementation. Reused by get_balance;
        post_transaction should follow the same pattern (call this, or
        replicate its behavior exactly)."""
        attempt = 0
        data = None
        headers = {"Accept": "application/json"}
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        while True:
            req = urllib.request.Request(
                self.base_url + path, data=data, method=method, headers=headers
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                retry_after = e.headers.get("Retry-After") if e.headers else None
                if e.code == 429 and retry_after is not None:
                    pass
                elif e.code == 503 and retry_after is not None:
                    pass
                else:
                    # Not retryable per the contract (DOCS.md #4, #5).
                    raise LedgerError(
                        f"Ledger request failed: {method} {path} -> {e.code}"
                    ) from e

                if attempt >= MAX_RETRIES:
                    raise LedgerError(
                        f"Ledger request failed after {MAX_RETRIES} retries: "
                        f"{method} {path} -> {e.code}"
                    ) from e

                self._sleep(float(retry_after))
                attempt += 1
