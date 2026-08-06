---
id: M-100
title: visualizer shows stuck "running" cards long after the session is dead
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-100 — visualizer shows stuck "running" cards long after the session is dead

## Context
Chris's direct report, 2026-08-06: the visualizer shows two Workflow Runs
stuck on their `build` Step, showing ~43 minutes elapsed. His own read:
"I'm guessing these aren't active sessions but rather a gap in
observability" — i.e. not two genuinely hung agent sessions, but stale
`running` status that never got reconciled after the underlying session
actually ended (crashed, was killed, or its container was recreated).

Quick live check via the visualizer API (`/api/runs`) at filing time found
two Steps both named `build`, both `status: running`, `startedAt` around
`2026-08-06T17:30:34Z` and `2026-08-06T17:30:44Z` — roughly 10 seconds apart,
suspicious for two independent genuine runs. Did not get far enough to pull
the actual run IDs/project names before session budget ran out.

Timing note, not confirmed as the cause: `jmfederico-pi-web`'s container
(`pi-web`) got recreated around 2026-08-06T17:56Z during M-097's deploy (see
that card's decision log — `docker compose up -d pi-web-factory-visualizer`
pulled in `jmfederico-pi-web` too via `depends_on`). That's ~15-25 min AFTER
these two builds' `startedAt`, so it's not obviously the trigger for THESE
two specifically, but it's the same class of event (container
restart/recreate killing an in-flight session's actual process without any
code path marking its DB record as failed/aborted) that would produce
exactly this symptom, and is worth checking as a general cause even if not
this specific instance. Also worth checking: were any of this session's
several sub-agent-triggered real Workflow Runs (M-089's verification run,
the 4-card-refinement sub-agent, M-097's own work) still theoretically
in-flight around 17:30 UTC and could have been abandoned mid-build when
their sub-agent process exited?

## Plan
Root cause confirmed (see Decision log): `bun cli.ts` is a **one-shot OS
process** per Workflow Run (`pi-web-factory/cli.ts`, invoked directly, e.g.
via `docker exec pi-web bun cli.ts --project ... --workflow ... --session-id
...`) — there is no daemon/worker holding these runs. `modules/run.ts`'s
`runAgentPhase` writes `phase_start` (→ `phases.status='running'`, via
`tracer.ts`'s `_upsertPhaseFromEvent`) BEFORE calling `setModel`/`sendPrompt`.
If either of those throws (e.g. `PiWebClientError` from a bad/nonexistent
`--session-id` — HTTP 404, exactly what happened here) or the process is
otherwise killed before reaching `waitForCompletion`'s resolution, the
exception propagates past `runAgentPhase`'s un-caught call sites, up through
`runWorkflow`, to `cli.ts`'s top-level `main().catch()` (`cli.ts`, bottom of
file), which only logs the stack and calls `process.exit(1)` — no `finally`
or `catch` anywhere in that chain calls `tracer.event({type:'phase_end',...})`
or `tracer.sessionFinish()`. The `phases`/`sessions` rows are left at
`status: 'running'` forever; nothing else in the codebase ever revisits them
(confirmed: zero reconciliation/staleness-detection logic anywhere in
`modules/` or `visualizer/` — see Decision log).

Concrete, scoped fix — two independent, complementary parts:

1. **Fix the write-path gap** (prevents new instances of this exact
   failure): wrap the body of `cli.ts`'s `main()` (or, better, wrap
   `runWorkflow()`'s own top-level body in `modules/workflow.ts`, so every
   caller benefits, not just the CLI) in a `try/catch` that, on any uncaught
   exception, writes a terminal `phase_end` (status `fail`) for whatever
   Step is currently open and a `sessionFinish(adwId, false)` for the run,
   with the caught error's message as the failure reason, before
   re-throwing (or exiting non-zero) — same shape `runAgentPhase`'s existing
   `failPhase()` helper already writes for its own known failure branches,
   just triggered from a catch-all instead of only the branches that happen
   to funnel through `waitForCompletion`'s discriminated result. Needs
   `runWorkflow`/`RunContext` to track "which phaseId is currently open" so
   the catch-all knows which Step row to close out (today only
   `runAgentStep`/`runCodeStep` know that, transiently).
2. **Add a reconciliation pass** (catches every OTHER way a process can die
   without unwinding its own stack at all — SIGKILL, OOM-kill, container
   recreate/`docker restart` killing the `docker exec` process, host reboot —
   none of which give JS a chance to run a `catch` block, so part 1 above
   cannot cover them): on visualizer `server.ts` startup (or a periodic timer
   there — it already owns the read path for `/api/runs` and is the one
   long-lived process in this system), scan `phases` for rows with
   `status='running'` whose `started_at` is older than some threshold (e.g.
   `PI_WEB_FACTORY_STEP_TIMEOUT_MS`, already defined in `piwebClient.ts` for
   the wait-loop's own timeout — reuse that constant/env var rather than
   inventing a second one) AND which have no corresponding live pi-web
   session (cross-check `GET /api/sessions?cwd=<phases row's project cwd>`
   against pi-web directly, the same check done manually in this
   investigation) — mark them `phases.status='fail'` /
   `sessions.status='fail'` with an error string like `"reconciled: no live
   session found, process likely died mid-run"`. This is the general fix for
   the container-recreate class of failure the card's Context section
   originally flagged, independent of the specific 404 mechanism found here.

Suggest doing (1) first — it's a small, contained change to a single
try/catch in an already-understood code path — then (2) as a follow-up,
since it requires a new pi-web-session cross-check call the visualizer
doesn't currently make. Both are new cards if picked up (this one is
research-only per the task brief).

## Signals

## Decision log
- 2026-08-06 (claude): filed directly from Chris's report + a quick live
  API spot-check (two `build` Steps stuck `running` for ~43min, start
  times ~10s apart). `status: needs-refinement` -- didn't have session
  budget left to pull real run IDs, confirm session death, or read the
  actual status-writing code path before filing.
- 2026-08-06 (claude): full research pass, findings below.
  - **Real run IDs / current state**: `curl http://192.168.1.226:8090/api/runs`
    (live, not stale) confirms both are STILL `status: running` as of this
    pass — `adw_32d8104649e2` (project `/tmp/pi-web-factory-m089-verify`,
    Step `build` startedAt `2026-08-06T17:30:34.266Z`) and `adw_9d7a3daa303d`
    (same project, Step `build` startedAt `2026-08-06T17:30:44.878Z`). Both
    titled "Create a file named hello.txt containing the single line: Hello
    from Or…" — clearly M-089's own verification runs.
  - **Direct pi-web session check**: `ssh local-ai-machine`, then
    `curl 'http://localhost:8080/api/sessions?cwd=/tmp/pi-web-factory-m089-verify'`
    (pi-web's real session-list API, requires `cwd`; confirmed via
    `docker port pi-web` → `3000/tcp -> 0.0.0.0:8080`) returns `[]` — zero
    live sessions for that project. Genuinely dead, not a visualizer
    display-lag issue. `docker ps` shows both `pi-web` and
    `pi-web-factory-visualizer` `Up 4 hours` (i.e. `pi-web` WAS recreated,
    matching M-097's ~17:56Z note, and has been stable since) — but see
    below, the recreate is a red herring for these two specific runs.
  - **Real trigger, confirmed via M-089's own decision log**: a THIRD run in
    the same project, `adw_f27447c6c14c`, started `17:33:14Z` and completed
    `status: success` (`build` + `review` both `success`) at `17:34:26Z`.
    M-089's decision log (item 7, verification section) says its
    `bounded-build-review` invocation "hit `PiWebClientError 404: Session
    not found` **twice** before this was understood" (a `--session-id` was
    passed on what needed to be a fresh-session run, not a resume) — that's
    exactly the two prior failed attempts, followed by the third, correctly-
    invoked run that succeeded. Container-recreate timing (~17:56Z) is
    unrelated to these two specifically, as the Context section already
    suspected — confirmed a red herring.
  - **Code-path trace, `cli.ts` → `workflow.ts` → `run.ts` → `piwebClient.ts`**
    (pulled all four live from `docker exec pi-web-factory-visualizer cat
    /home/piweb/pi-web-factory/{cli.ts,modules/workflow.ts,modules/run.ts,
    modules/piwebClient.ts}` — matches this repo's own copies): `bun cli.ts`
    is a ONE-SHOT OS PROCESS per Workflow Run (invoked directly, e.g.
    `docker exec pi-web bun cli.ts ...`) — no daemon/worker holds these runs
    once started. `run.ts`'s `runAgentPhase` writes `phase_start` (→
    `tracer.ts`'s `_upsertPhaseFromEvent` → `phases.status='running'`)
    BEFORE calling `setModel`/`sendPrompt` (both plain awaited
    `piwebClient.ts` calls, no try/catch around them in `runAgentPhase`). A
    `PiWebClientError` thrown there (e.g. 404 on a bad `--session-id`, this
    case) is NOT one of `runAgentPhase`'s handled outcomes (`blocked-on-
    human`/`error` from `waitForCompletion`/`unparseable`/`permissions-
    violation` — see its `RunAgentPhaseResult` union) since it's thrown
    before `waitForCompletion` is even reached. It propagates uncaught
    through `runWorkflow` (`modules/workflow.ts`) all the way to `cli.ts`'s
    top-level `main().catch()` (bottom of file), which only
    `console.error`s the stack and `process.exit(1)`s. No `finally`/`catch`
    anywhere in that chain writes a `phase_end` or calls
    `tracer.sessionFinish()`. Status is written incrementally
    (`phase_start`="running" persists as the row's only write until an
    explicit LATER `phase_end` write) — confirmed by `tracer.ts`'s own
    module header, which documents this exact behavior
    ("`phase_start` -> upserts a `phases` row (status "running")",
    "`phase_end` -> upserts the same `phases` row with the resolved
    status"). A killed-mid-flight process (whether by uncaught exception,
    SIGKILL, or container recreate) leaves the row at "running" forever by
    construction — this is the general mechanism, not specific to the 404
    case.
  - **Existing reconciliation mechanism: confirmed TOTAL ABSENCE, not a
    bug in one.** Grepped `modules/`, `visualizer/`, `chains/`, `cli.ts` on
    the live container for stale/orphan/reconcil/zombie/watchdog — the only
    hits are unrelated ("stale IP", "stale config") except one real
    near-miss: `visualizer/src/detailView.ts`'s `ACTIVITY_WINDOW_MS` (15s)
    and M-077's own decision log ("stuck forever on stale data"). Read
    `detailView.ts` in full: this is PURELY a frontend visual affordance —
    whether to show the orange "actively live" pulsing glow on a Step,
    based on recent `events` activity — it never writes anything back to
    `phases`/`sessions`. The DB row itself has no timeout, no staleness
    check, no cross-check against pi-web's live session list anywhere in
    the codebase. Confirms the card's original hypothesis exactly: this is
    a gap, not a broken mechanism.
  - Cleared `status: needs-refinement` → `null`: root cause is fully
    confirmed (not just hypothesized) and the Plan above is concrete and
    scoped enough to implement directly.

## Handoff notes
Real run IDs confirmed: `adw_32d8104649e2` and `adw_9d7a3daa303d`, project
`/tmp/pi-web-factory-m089-verify`, both still `status: running` as of this
pass (2026-08-06) — safe to ignore/manually mark failed, they're leftover
from M-089's own two mis-invoked verification attempts (bad `--session-id`),
superseded by that same session's third, successful attempt
(`adw_f27447c6c14c`). The real fix is scoped in the Plan above: (1) a
catch-all in `runWorkflow`/`cli.ts`'s top-level error path that writes a
terminal `phase_end`/`sessionFinish` on any uncaught exception, and (2) a
periodic/startup reconciliation pass in the visualizer's `server.ts` that
cross-checks long-`running` `phases` rows against pi-web's real
`GET /api/sessions?cwd=...` and marks orphans failed. Whoever picks this up
should open it as a fresh `now/`-bound card (this one stays research-only
per this pass's brief) — probably worth splitting (1) and (2) into separate
cards since they're independently shippable and (2) needs a new pi-web
cross-check call the codebase doesn't have yet.
