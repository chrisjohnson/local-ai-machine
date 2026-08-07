---
id: M-100
title: visualizer shows stuck "running" cards long after the session is dead
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-07T00:00Z
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

**Refinement, 2026-08-07 (Chris, direct):** terminology — "CLI" undersells
what `cli.ts` actually is; think of it as the **job runner** (one job-runner
process per Workflow Run) going forward, in docs/comments/future naming.
Not renaming the file in this pass, just using the clearer term.

Also refined part (2)'s check to be explicitly **OR-based**, matching
Chris's framing ("detect any jobs that don't have an active runner, OR
don't have an active session"), not the AND-based version originally
drafted:
- **No active session** (definitive on its own): `GET
  /api/sessions?cwd=<project>` on pi-web returns no live session for the
  row's project — the underlying agent conversation is provably gone,
  mark failed regardless of how fresh the row's timestamp looks.
- **No active runner** (definitive on its own, independent of session
  state): the row is stale — `status='running'` with no fresh
  `phase_start`/`phase_end`/`event` write within the staleness threshold
  (reuse `PI_WEB_FACTORY_STEP_TIMEOUT_MS`) — even if pi-web's session API
  still shows something for that project. A live pi-web session doesn't
  imply the job runner driving it is still alive; the runner could have
  died while the session it opened sits idle indefinitely. Staleness is
  the only observable proxy for "no job runner is present" today (there's
  no runner heartbeat/registration anywhere in the codebase to check more
  directly) — worth flagging that a first-class heartbeat mechanism would
  be a cleaner signal than a staleness proxy, but is out of scope for this
  pass; the sub-agent implementing this should note it as a possible
  follow-on rather than build it now.
Either condition alone is sufficient to mark a row failed — this is a
logical OR of two independently-checkable, definitive signals, not a
combined AND requiring both.

Chris also confirmed the reconciliation pass should run **on startup**, in
addition to (not instead of) whatever periodic cadence gets built.

Proceeding with implementation now — both fixes, one card (not splitting
into two, per Chris's "let's proceed with the fixes" covering both in one
go; the original suggestion to split was about independent shippability,
not a requirement).

**Implementation, 2026-08-07 (claude, sub-agent):**
- [x] Fix 1 — write-path catch-all: `runWorkflow()` (`modules/workflow.ts`)
  wrapped in a `try/catch`. `RunContext` gained `openPhase: { phaseId,
  stepName } | undefined`, set by `runAgentStep`/`runCodeStep` right before
  each Step's `phase_start` write, and cleared explicitly on every
  non-throwing return path (deliberately NOT via a `finally` in those two
  functions — an inner `finally` would blank `openPhase` before the
  exception ever reaches `runWorkflow`'s own `catch`, per ordinary JS
  unwind order; found this the hard way when the first version of the new
  tests failed). On catch: writes a terminal `phase_end` (`status: 'fail'`,
  the caught error's `message` as `error`/`outputSummary`) for
  `ctx.openPhase` if one was open, calls `tracer.sessionFinish(adwId,
  false)`, then re-throws.
- [x] Fix 2 — reconciliation pass: `visualizer/server.ts` gained a second,
  separate read-write `bun:sqlite` handle (`reconcileDb`) alongside the
  existing readonly `db` handle (used by every `/api/...` route,
  unchanged) — `reconcileStuckRuns()` scans `phases` rows `status='running'`
  and marks a row (plus its `sessions` row, if that row's own `status` is
  also `'running'`) `'fail'` on either OR'd condition: (1) `GET
  /sessions?cwd=<project>` against pi-web (`PI_WEB_FACTORY_BASE_URL`)
  returns no live session, or (2) the row's `started_at`/latest `events`
  activity is older than `RECONCILE_STALE_MS` — reused directly from
  `piwebClient.ts`'s `PI_WEB_FACTORY_STEP_TIMEOUT_MS` (exported as
  `DEFAULT_WAIT_FOR_COMPLETION_TIMEOUT_MS`, no second constant invented).
  Runs once on startup (fire-and-forget, logged) and every
  `PI_WEB_FACTORY_VISUALIZER_RECONCILE_INTERVAL_MS`, **default 5 minutes**
  (`DEFAULT_RECONCILE_INTERVAL_MS`, chosen as a reasonable middle ground —
  frequent enough a dead run doesn't sit visibly "running" long, infrequent
  enough the extra db connection + per-project pi-web round trip is
  negligible background load on a box that may be running real GPU work).
  Job-runner-heartbeat-as-a-cleaner-signal noted as an explicit out-of-scope
  follow-on in the code comment, per the card's own refinement.
- [x] Tests: `modules/workflow.test.ts` — new `describe("runWorkflow —
  catch-all on an uncaught exception (M-100 Fix 1)")`, two cases (an agent
  step's `setModel` 404 before `waitForCompletion`, reproducing the real
  M-089 trigger exactly; a code step's `projectConfigFor` throwing) —
  both confirm the phase row lands `status='fail'` (not left `'running'`)
  and the session row lands `status='fail'` too, and that the original
  error still propagates (`rejects.toThrow`). `visualizer/server.test.ts` —
  new `describe("reconciliation pass (M-100 Fix 2)")` against its own
  scratch db/spawned server instance with a short `PI_WEB_FACTORY_STEP_
  TIMEOUT_MS` and a stubbed pi-web `/sessions` endpoint: a stale row flips
  to `fail` even when the stub reports a live session (condition 2 alone
  sufficient); a fresh row with no live session also flips to `fail`
  (condition 1 alone sufficient); a fresh, genuinely-live row is left
  completely untouched (no false positive).
- [x] Full suite run (`bun test`, inside the `pi-web-factory-visualizer`
  container against a scratch copy, since bun isn't installed on the dev
  Mac): 258 pass / 6 fail, all 6 failures pre-existing and unrelated
  (integration tests needing a live pi-web session or an `ssh
  local-ai-machine` bridge unreachable from inside a container — confirmed
  identical failures against the untouched, already-deployed checkout
  before this change). `tsc --noEmit` clean (0 errors).
- [x] **Real end-to-end verification on the box**, per the task brief —
  confirmed pi-web genuinely had no live session for
  `/tmp/pi-web-factory-m089-verify` before deploy (`curl
  'http://localhost:8080/api/sessions?cwd=/tmp/pi-web-factory-m089-verify'`
  → `[]`), then after `docker compose build jmfederico-pi-web && docker
  compose up -d pi-web-factory-visualizer` (which recreated `pi-web` too,
  as expected), the visualizer's own startup log showed `[visualizer]
  reconciliation (startup): scanned 2 running Step(s), marked 2 failed` —
  and `curl http://192.168.1.226:8090/api/runs` confirmed both
  `adw_32d8104649e2` and `adw_9d7a3daa303d` flipped from `status: running`
  to `status: fail`, each Step's `error` reading `"reconciled: stale, no
  runner activity within timeout"` (condition 2 — staleness — is what
  actually fired for these two, since their `started_at` was from the
  prior day). Both containers confirmed healthy post-deploy (`docker ps`:
  both `Up`; `curl` 200 on both `http://192.168.1.226:8090/` and
  `http://localhost:8080/` on the box). The live GPU benchmark sweep
  (`llm-inference-bench`) was left untouched throughout — no new
  GPU-consuming Workflow Run was triggered.

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
