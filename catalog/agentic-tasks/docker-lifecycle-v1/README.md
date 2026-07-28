# docker-lifecycle-v1

Agentic-coding-session benchmark task: docker container lifecycle + live-
system validation. Part of M-021
(`.fleet/board/now/M-021-agentic-coding-session-benchmark.md`).

## Directory layout — what the harness copies where

```
docker-lifecycle-v1/
  README.md      <- this file. Not copied anywhere; harness-author reference only.
  task.md        <- the natural-language prompt given to the agent, verbatim.
  starter/       <- AGENT-VISIBLE. Copy the *contents* of this directory into
                    the agent's scratch workspace before the session starts.
                    This is the entire filesystem surface the agent should see
                    -- a self-contained docker-compose app (2 services).
  hidden/        <- NEVER visible during the session. Contains grade.py,
                    which is run FROM OUTSIDE the workspace, pointed at it via
                    --workspace, after the session ends. It does not need to
                    be copied into the workspace at all -- it only needs
                    filesystem + docker access to the workspace path and to
                    the docker daemon, both available to the harness process
                    itself.
```

Concretely, the harness should do:

1. `cp -r docker-lifecycle-v1/starter/* <workspace>/` and give the agent
   `task.md`'s contents as its prompt (or drop it in as
   `<workspace>/task.md`, either is fine).
2. Run the agent (opencode or Pi) headless against `<workspace>`, with real
   `docker`/`docker compose` access (no sudo needed, matching this repo's
   own `chris` user being in the `docker` group — see `AGENTS.md`), ceiling
   45 min. **Important**: give the agent a workspace-scoped, isolated
   docker compose project — either run the harness itself with `cd
   <workspace>` so compose's default project-name-from-directory-name
   behavior naturally scopes it, or explicitly pass a per-run
   `COMPOSE_PROJECT_NAME`/`-p <run-id>` so concurrent benchmark runs (e.g.
   different models tested back-to-back, or in parallel across ports if
   ever run that way) never collide on container/network names. The
   compose file intentionally does NOT hardcode a project name.
3. After the session ends: `python3 docker-lifecycle-v1/hidden/grade.py
   --workspace <workspace> --project-name <same-or-fresh-name> --json`.
   The grading script **starts the (agent-modified) stack itself** if it's
   not already running (agent leaving it running is fine too — the script
   still owns teardown at the end either way), so it works whether the
   agent's session ended with the stack up or down. Record
   `pass_count`/`total_count` from its JSON output.
4. `grade.py` always tears its own stack down (`docker compose down -v
   --remove-orphans`) before exiting — the harness does not need a separate
   cleanup step for this task, but should still verify no stray
   `wordcount-*` containers/images linger between runs if paranoid (e.g.
   `docker ps -a --filter name=wordcount`), since a grading run that itself
   crashes mid-check could theoretically skip its own `finally` teardown
   under sufficiently unusual conditions (process killed via SIGKILL, not
   a normal exception).

## What the task actually tests

`starter/` is a two-service app (`wordcount-frontend`, `wordcount-backend`)
defined in a `docker-compose.yml`, both stdlib-only Python (`http.server`)
on `python:3.12-slim`, no pip installs, no external images beyond the slim
base — deliberately lightweight since this needs to run per-task per-model
across roughly 20 models without meaningful download/build cost per run.

Two independent, deliberately distinct planted issues, matching the task
brief's example categories directly:

1. **Misconfigured environment variable** — `docker-compose.yml` sets
   `BACKEND_URL=http://backend:9101` for the frontend service, but the
   backend actually listens on `9100` (both its `Dockerfile` and
   `server.py` are internally consistent and correct — the bug is purely
   in the compose file's env var value). This manifests as the frontend's
   own `/health` endpoint reporting `backend_unreachable`, and `/track`
   failing with a 502 — both real, live-system symptoms the agent has to
   actually observe by running the stack and hitting it, not something
   visible from a code read alone (the code is doing exactly what it's
   told; the value it's told is wrong).
2. **Request-handling bug** — `frontend/server.py`'s `/top` endpoint sorts
   ascending instead of descending, silently inverting the documented
   "most-frequent-first" contract stated in the same file's own module
   docstring. This is deliberately the kind of bug that *runs successfully
   and returns a well-formed response* — it will never crash, error, or
   fail a basic smoke test; the only way to catch it is to actually
   exercise the system with known inputs and check the output order is
   correct, i.e. genuine live-system validation, not just "does it start."

Both bugs are independently fixable and independently gradable, so a model
that only finds one of the two still gets partial, meaningful credit
(verified during construction — see below) rather than an all-or-nothing
grade that would conflate "found nothing" with "found one of two."

## Why this pairing specifically

- Chose one infra-level bug (compose env var) and one application-level
  bug (sort logic) rather than two of the same kind, since Chris's
  described workflow explicitly calls out both "building/stopping/starting
  docker containers" (infra layer) and "directly interacting with them to
  test things" (functional/application layer) as distinct concerns — one
  bug alone would only exercise one of those.
- The env var bug is the more procedural one (requires actually starting
  the stack and observing a connection failure — reading the compose file
  alone won't obviously reveal `9101` is wrong without also checking what
  port the backend Dockerfile/code actually expose).
- The sort bug is the more "read carefully and verify against real
  requests" one — it's a classic silent-wrong-output bug, the kind that
  specifically requires the "connecting to real systems to validate that
  changes were successful" step from Chris's own workflow description,
  since a superficial "does /top return 200" check would never catch it.
- Kept to exactly 2 services and 2 bugs (not 3+) to comfortably fit well
  under the 45-minute ceiling — a competent agent should build, diagnose,
  and fix both issues in well under 10 minutes of actual working time; the
  build itself (slim base image, stdlib-only, no dependency install step)
  takes seconds, not minutes.

## Hidden grading (`hidden/grade.py`)

5 checks, run against a **real, live** instance of the (agent-modified)
stack that the grading script starts (or reuses if already running) itself
via `docker compose up -d --build` — genuinely interacting with the running
system, not inspecting files statically:

1. `compose_file_present` — sanity check, `docker-compose.yml` exists.
2. `stack_builds_and_starts` — `docker compose up -d --build` exits 0.
3. `frontend_health_ok` — polls `GET /health` on the frontend (which itself
   checks backend reachability) until it reports healthy or a startup
   timeout (60s) elapses. This is the check that catches the misconfigured
   `BACKEND_URL` — if that's not fixed, this fails and blocks the two
   checks below (they're skipped, not silently passed, if the stack never
   becomes healthy).
4. `track_reaches_backend` — `POST /track` twice against the frontend with
   a random never-seen-before word, then reads the count **directly from
   the backend's own `/count/<word>` endpoint**, independent of whatever
   the frontend claims — this specifically guards against a frontend that
   fabricates a plausible-looking response without actually updating
   backend state.
5. `top_sorted_descending` — seeds three distinct words with counts 1, 5,
   and 9 via real `/track` calls, then asserts `GET /top` returns them in
   strictly descending order by count — the check that catches the planted
   sort-direction bug. Uses randomized per-run word names so repeated
   grading runs (e.g. re-grading, or multiple models sharing a cached
   image layer) never collide with leftover state from a previous run.

Teardown: `docker compose down -v --remove-orphans` in a `finally` block,
always run regardless of how grading went, so no `wordcount-*` container,
network, or volume outlives a single grading invocation.

Verified during construction of this task:
- Unmodified (buggy) starter: **2/5** (`compose_file_present` and
  `stack_builds_and_starts` pass — the containers themselves build and
  start fine — but `frontend_health_ok` and everything gated behind it
  fail, since the frontend can never reach the backend on the wrong port).
- Only the env-var bug fixed (sort bug left in place): **4/5** — health and
  backend-consistency checks pass, `top_sorted_descending` fails, isolating
  exactly the remaining bug.
- Both bugs fixed (full reference solution): **5/5**.
- Confirmed real teardown behavior: no `wordcount-*` containers, networks,
  or `starter-backend`/`starter-frontend` images left behind after grading
  runs in any of the above scenarios.

## Design notes / constraints followed

- `python:3.12-slim` base images, stdlib-only application code (`http.server`,
  `urllib`, `json`) in both services — no `pip install` step, no external
  registry pulls beyond the slim base itself, keeping build time and image
  size minimal for repeated runs across ~20 models.
- No project name hardcoded into `docker-compose.yml` — left to the harness
  to scope per-run (via `cd`-based default naming or an explicit `-p` flag)
  so concurrent/sequential runs never collide on container or network
  names.
- Percent-based grading (`pass_count`/`total_count`), matching the existing
  `tier_x_pass`/`tier_x_total` convention and this project's stdlib-only,
  no-LLM-judge philosophy (`catalog/benchmarks/seven-tier-coding-v2.yaml`).
- Grading script never assumes any particular container/project name the
  agent might have used during its own session — it always starts (or
  reuses) the stack under its own explicit `--project-name`, so it works
  regardless of what state the agent left things in (running, stopped,
  containers renamed, etc.) as long as `docker-compose.yml` in the
  workspace is still valid.
