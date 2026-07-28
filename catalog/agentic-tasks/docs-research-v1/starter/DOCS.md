# ledgerclient — internal client library for the Ledger service

`ledgerclient` is a small Python client for talking to the internal "Ledger"
bookkeeping service over HTTP. It is used by several internal batch jobs, so
correctness of retry/backoff behavior matters more than it looks like it
should from the code alone — the Ledger service has bitten people before.

## Why this library exists

Ledger is a shared, rate-limited internal service. It does its own
server-side throttling and communicates that entirely through HTTP status
codes and headers — there's no client-side rate limiter, by design. Every
client is expected to implement the same backoff contract described below.
Clients that don't get either silently double-charged (retrying too fast
re-submits work that already landed) or rate-limited harder by Ledger's own
abuse detector (which permanently downgrades a client's quota tier for the
rest of the day if it sees more than 3 "uncooperative" retries — see below).

**This convention is not visible anywhere in Ledger's OpenAPI schema or in
this repo's code — it is only described here, and every internal client is
expected to have read this page before writing retry logic.**

## The retry contract

1. Ledger returns `HTTP 429` when it wants the caller to back off. When it
   does, it **always** sets a `Retry-After` response header, given in
   **whole seconds** (a string, e.g. `"2"`).
2. A correct client **must** sleep for *exactly* the number of seconds in
   `Retry-After` before retrying — not a fixed backoff schedule, not an
   exponential-backoff guess, and not "at least" that long with jitter added
   on top. Ledger's abuse detector specifically flags retries that arrive
   **more than 250ms early** relative to the `Retry-After` deadline as
   "uncooperative" (it assumes a client ignoring the header). It does **not**
   flag retries that arrive late.
3. A request may be retried **at most 3 times** (4 attempts total, including
   the first). If Ledger still returns 429 after the 3rd retry, the client
   must give up and raise — do not loop forever, and do not silently return
   a partial/empty result.
4. `HTTP 503` (Ledger temporarily down, not rate-limiting) is retryable the
   same way *only if* a `Retry-After` header is present. If a 503 arrives
   with no `Retry-After` header, treat it as non-retryable and raise
   immediately — Ledger only omits the header on 503 when the outage is
   expected to outlast any reasonable client-side wait, so retrying without
   guidance just wastes the attempt budget.
5. All other HTTP error codes (4xx other than 429, or 5xx other than 503)
   are **never** retried, regardless of headers present.

Getting step 2 wrong (fixed/exponential backoff instead of honoring
`Retry-After` exactly) is the single most common bug in Ledger client code
reviews — it works fine in casual testing (nobody notices), and then
quietly trips the abuse detector in production under real load, downgrading
the whole job's Ledger quota for the rest of the day.

## Existing client surface

`ledgerclient/client.py` currently implements `LedgerClient.get_balance(account_id)`,
which already follows the retry contract above correctly — use it as the
reference implementation for the retry behavior when implementing anything
new.

It does **not** yet implement posting a transaction. That's today's task —
see `TASK` (given separately from this documentation file).
