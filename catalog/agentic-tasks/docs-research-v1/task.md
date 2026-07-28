# Task: implement `LedgerClient.post_transaction`

You are working in a small Python library, `ledgerclient`, that talks to an
internal service called Ledger. The repo root contains:

- `DOCS.md` — read this in full before writing any code. It documents a
  retry/backoff contract that every Ledger client method must follow. This
  contract is **not** derivable from the code alone, and is not the "usual"
  retry pattern you might default to (it is deliberately not exponential
  backoff, not backoff-with-jitter, and not a naive fixed-delay loop).
- `ledgerclient/client.py` — the client itself. `LedgerClient.get_balance`
  is already implemented correctly and follows the documented contract —
  use it as your reference for how `post_transaction` should behave.
- `fake_ledger_server.py` — a small local fake of the real Ledger service
  you can run to test against manually (`python3 fake_ledger_server.py
  --flaky` runs it on `http://127.0.0.1:8080` and randomly returns 429s
  with a `Retry-After` header so you can observe retry behavior for real).

## What to do

Implement `LedgerClient.post_transaction(account_id, amount_cents)` in
`ledgerclient/client.py`. It must:

1. Send a `POST` to `/accounts/{account_id}/transactions` with a JSON body
   `{"amount_cents": amount_cents}`.
2. Follow the exact retry/backoff contract described in `DOCS.md` — read
   that file carefully, the contract has specific rules about which status
   codes are retryable, how long to wait, and how many times to retry that
   are easy to get subtly wrong if you don't read it first.
3. Return a `TransactionResult` (already defined in the same file)
   constructed from the JSON response body.
4. Raise `LedgerError` when the request ultimately fails (whether
   immediately non-retryable, or after exhausting the retry budget) — same
   behavior as `get_balance`.

You're free to implement this however you like (reuse `_request_with_retry`
directly, or write your own logic) as long as the resulting behavior
matches the documented contract exactly. Feel free to run
`fake_ledger_server.py` locally and write your own quick test/script
against it to confirm your implementation actually behaves correctly under
429s — this is a real, checkable behavior, not just a matter of taste.

Do not modify `DOCS.md`, `fake_ledger_server.py`, or `get_balance`. Do not
change the public signature of `post_transaction` or `TransactionResult`.
