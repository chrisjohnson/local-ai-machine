# docs-research-v1

Agentic-coding-session benchmark task: docs-research + implementation. Part
of M-021 (`.fleet/board/now/M-021-agentic-coding-session-benchmark.md`).

## Directory layout — what the harness copies where

```
docs-research-v1/
  README.md      <- this file. Not copied anywhere; harness-author reference only.
  task.md        <- the natural-language prompt given to the agent, verbatim.
                    Copy into the workspace root alongside starter/'s contents
                    (or otherwise surface its text to the agent) at session start.
  starter/       <- AGENT-VISIBLE. Copy the *contents* of this directory into
                    the agent's scratch workspace before the session starts.
                    This is the entire filesystem surface the agent should see.
  hidden/        <- NEVER visible during the session. Do not copy into the
                    workspace, do not mount it, do not let the agent's shell
                    reach it by any path. Copy `hidden/grade.py` in (or run it
                    from outside, pointed at the workspace via --workspace)
                    only AFTER the agent's session has ended.
```

Concretely, the harness should do:

1. `cp -r docs-research-v1/starter/* <workspace>/` and drop `task.md`'s
   contents into the agent's prompt (or as `<workspace>/task.md` — either
   is fine, it's plain instructions, not a secret).
2. Run the agent (opencode or Pi) headless against `<workspace>`, ceiling
   45 min.
3. After the session ends: `python3 docs-research-v1/hidden/grade.py
   --workspace <workspace> --json` and record `pass_count`/`total_count`
   from its JSON output.

`hidden/grade.py` is stdlib-only and has no dependency on anything inside
`starter/` at import time beyond the `ledgerclient` package it dynamically
loads from the workspace path given via `--workspace` — it never needs to be
copied anywhere near the agent, it just needs filesystem access to the
*post-session* workspace from wherever the harness invokes it.

## What the task actually tests

`starter/` is a small Python client library (`ledgerclient`) for a fictional
internal "Ledger" service, styled deliberately like a real internal-tooling
repo: a `DOCS.md` describing a non-obvious, load-bearing convention that
lives only in prose (not in the code, not in an OpenAPI schema, not
inferable from tests) — a specific HTTP retry/backoff contract:

- Honor `Retry-After` **exactly** (not exponential backoff, not
  backoff-with-jitter — both are the "obvious default" a model is likely to
  reach for if it doesn't actually read the docs).
- Retry at most 3 times (4 attempts total), then raise.
- `503` is retryable *only if* `Retry-After` is present; otherwise treat as
  fatal.
- No other status code is ever retried.

The starter code has one method (`get_balance`) that already implements
this contract correctly, explicitly labeled as the reference the agent
should follow, and one method (`post_transaction`) left as a stub the agent
must implement. This mirrors the described real workflow ("researching
documentation, reading the codebase, planning changes") in miniature: the
agent has to actually read `DOCS.md`, not just pattern-match the existing
`get_balance` code (which alone doesn't spell out *why* it behaves the way
it does, only that it does) or reach for a generic-good-practice retry
implementation, which would be subtly wrong here on purpose.

A small local fake server (`starter/fake_ledger_server.py`) is included so
the agent can sanity-check its implementation against something real and
running during the session — this is a convenience/test-double, not the
grading mechanism, and is fine to be visible (grading uses a separately
scripted fake server inside `hidden/grade.py`, not this one).

## Why this bug/doc pairing specifically

Considered and rejected simpler alternatives before landing on this:

- A missing-feature task with no subtlety (e.g. "add a `delete` method")
  would be gradable but wouldn't actually require reading documentation —
  a model could write plausible code from the method stub and docstring
  alone and pass. The retry contract is the opposite: getting it wrong
  looks *identical* to getting it right in casual/happy-path testing (the
  fake server's `--flaky` mode still eventually succeeds either way), so
  the only way to reliably get it right is to have actually internalized
  the specific rules, which is exactly the property this benchmark tier
  needs to isolate.
- Kept to a single documented convention (not three unrelated ones) so the
  hidden checks can be precise and the task stays well under the 45-minute
  ceiling — a competent agent that reads `DOCS.md` carefully should finish
  this in well under 10 minutes of actual work.

## Hidden grading (`hidden/grade.py`)

7 independent checks, each spinning up its own tiny scripted fake HTTP
server (a fixed, ordered sequence of responses per check, not the flaky
random one from `starter/`) so exact retry counts and timing can be
asserted rather than guessed at:

1. `happy_path` — single successful call returns a correctly populated
   `TransactionResult`.
2. `request_shape` — POST path and JSON body match the documented API
   shape exactly.
3. `honors_retry_after_exactly` — on a 429, the client must sleep
   approximately the exact `Retry-After` value, not a fixed/exponential
   schedule (tolerance band chosen specifically to reject exponential
   backoff's ~2x/4x/8x pattern while allowing for "late is fine" per the
   docs).
4. `gives_up_after_3_retries` — a client hammered with unlimited 429s must
   make exactly 4 attempts total then raise `LedgerError`, never loop
   forever.
5. `503_without_retry_after_not_retried` — must raise immediately, single
   attempt, no retry.
6. `503_with_retry_after_is_retried` — must retry exactly like a 429 when
   the header is present.
7. `other_4xx_never_retried` — a non-429 4xx must never be retried even if
   it carries a `Retry-After` header (tests that the agent didn't
   overgeneralize "retry on `Retry-After` present" instead of the narrower
   documented rule).

Verified during construction of this task: the unimplemented starter scores
0/7 (raises `NotImplementedError`, every check fails cleanly rather than
crashing the grader); a correct reference implementation scores 7/7; a
plausible-but-wrong implementation (exponential backoff, retries any
429/503 regardless of headers) scores 5/7 — it fails exactly the two checks
that probe the documented-but-not-code-visible convention
(`honors_retry_after_exactly`, `503_without_retry_after_not_retried`),
confirming the suite actually discriminates "read the docs" from "wrote
generically reasonable retry code."

## Design notes / constraints followed

- Stdlib only (`http.server`, `urllib`, `json`, `threading`, `dataclasses`)
  — no pip install needed in either the starter workspace or the grading
  environment, consistent with `catalog/benchmarks/seven-tier-coding-v2.yaml`'s
  philosophy (objective, stdlib-only, no LLM-judge scoring).
- Percent-based grading (`pass_count`/`total_count`), not binary, matching
  the existing `tier_x_pass`/`tier_x_total` convention.
- Grading script never imports or reads anything from `starter/` at
  authoring time that wouldn't also exist in a modified copy — it locates
  `ledgerclient` purely via the `--workspace` path so it works unmodified
  against whatever the agent leaves behind, including a fully-rewritten
  `client.py` as long as the public `LedgerClient`/`TransactionResult`/
  `LedgerError` surface is preserved (which `task.md` explicitly asks the
  agent not to break).
