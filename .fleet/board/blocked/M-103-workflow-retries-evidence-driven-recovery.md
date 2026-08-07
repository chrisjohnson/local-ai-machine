---
id: M-103
title: workflow retries — evidence-driven retry/new-run decision + merged multi-attempt UI
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-07T00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-100, M-098]
---

<!-- signal: claude 2026-08-07T04:00Z — Phases 1+2 fully done and live; Phase 3's evidence-stack/decision-Role code done+tested+manually-invokable, resume-after-fail empirically confirmed safe; automated SPAWN trigger stopped short (no docker.sock/transport from pi-web-factory-visualizer to pi-web — real infra gap, see Decision log) — moved to blocked/, not done/ -->


# M-103 — workflow retries — evidence-driven retry/new-run decision + merged multi-attempt UI

## Context
Chris's direct idea, 2026-08-07, arising from the M-100 discussion (what do
you actually do with a failed run once reconciliation correctly marks it
`fail` instead of leaving it stuck?): the `workflows/*.yaml` schema should
gain a `retries` field, and failed-run recovery shouldn't be purely manual.
The idea: hand the whole evidence stack for a failed run (its trace —
prompts, envelopes, permission violations, the terminal failure reason) to
a model and let it decide whether to invoke a second attempt of the SAME
Workflow Run, or kick off a genuinely NEW Workflow Run instead. Visually,
Chris wants multiple attempts at what's conceptually "the same job" to
merge into a single card/record in the visualizer, with a small pair of
arrow buttons to flip back and forth between attempts, rather than showing
N separate unrelated-looking cards for what's really one logical unit of
work retried N times.

Explicitly Chris's own framing: "That sounds like it's own ticket" — filed
as research/design, not scoped implementation. Depends conceptually on
M-100 landing first (reconciliation needs to reliably produce a real
terminal `fail` status before there's a trustworthy signal to retry on —
retrying off a falsely-stuck "running" row would be wrong).

## Plan
**Fully refined 2026-08-07 via direct discussion with Chris. `status: null`,
ready to implement.** Chris gave explicit autonomy on the retry/evidence
mechanics ("you've got this for retries and evidence") and concrete
direction on the ticket/UI half. Design below; implementer should still
verify exact current file/line references before editing (files may have
shifted since this was written, e.g. M-100 just landed real changes to
`workflow.ts`/`server.ts`/`schema.ts`-adjacent code).

### 1. Ticket table — the grouping anchor
New `tickets` table in `factory.db` (`modules/schema.ts`):
- `ticket_id TEXT PRIMARY KEY` — a plain string, deliberately NOT tied to
  this codebase's `adw_<hex>` id shape. Must accommodate external ids like
  `M-103`/`BOARD-NUMBER` shapes from `.fleet` or wherever a future ticket
  source lives. When no external ticket exists (the common case today —
  see auto-creation below), mint an internal id in some clearly-distinct
  shape (e.g. `ticket_<hex>`, mirroring `adw_<hex>`) so the two id spaces
  never collide and are visually distinguishable in the visualizer/DB.
- `file_path TEXT` — nullable. A path to an external ticket file (e.g. a
  `.fleet/board/.../M-xxx-....md` path), stored as a **pure reference
  field only** — Chris's explicit framing: "the 'fleet ticket' file itself
  doesn't even need to be read by the fleet orchestrator or anything." No
  code in this codebase should ever open/parse/watch this path. It exists
  so a human (or a future integration) can jump from a ticket row straight
  to its source file, nothing more.
- `created_at TEXT`.
- `title TEXT` — reuse `deriveTitleFromPrompt` (already exists, used for
  session titles today) against whichever prompt started the FIRST run
  linked to this ticket. Chris's framing: "only whatever you need that
  makes sense... ticket's only job right now is to give us a higher level
  anchor to group workflow runs" — keep this table minimal; don't add
  fields (status rollup, tags, etc.) beyond what's needed to (a) show a
  sensible card title before a human opens it, and (b) group runs. If the
  visualizer grid needs a fast "latest run" lookup without an aggregate
  query over `sessions`, a denormalized `latest_run_adw_id TEXT` column is
  fine to add — implementer's call, this is exactly the kind of "whatever
  you need" scope Chris authorized.

`sessions` table (existing) gets a new `ticket_id TEXT` column, FK to
`tickets.ticket_id`. Every run belongs to exactly one ticket, always — no
run without a ticket, matching Chris's point 2 below.

### 2. Every run auto-creates or attaches to a ticket
Chris, explicit: "Yes, this is how agentic-fleet works today. Even if I
just casually describe a task, the agent automatically knows to turn my
request into a ticket to be tracked." Port that expectation here: `cli.ts`
today has no `--ticket-id` concept at all — add one, optional. If omitted
(the common, "just run something" case), `runWorkflow` mints a fresh
internal ticket row automatically, same moment it mints `adwId` today, and
links this run to it. If `--ticket-id <id>` is passed and that ticket
already exists, link this run into the EXISTING ticket instead (this is
the mechanism a retry/new-run decision uses to keep a second attempt
grouped with the first, and the mechanism a human resuming a
`BLOCKED-ON-HUMAN` run by hand would naturally want too, though wiring the
existing resume path to auto-populate `--ticket-id` from the original
run's own ticket is a reasonable implementer's-choice detail, not spelled
out further here).

### 3. `retries` — the Workflow-level field
Add `retries?: number` (default 0) to `workflowDef.ts`'s `Workflow` schema
— max ADDITIONAL full-run attempts (each its own fresh `adwId`/trace-DB
row, linked to the same ticket) allowed after an initial failure, before
the ticket is marked exhausted and left for a human. This is a BETWEEN-
runs retry budget, distinct from `bounded-build-review`'s existing
`max_rounds` (a WITHIN-one-run, same-session build/review loop) — don't
conflate the two, they solve different problems and both can coexist on
the same Workflow.

### 4. Evidence stack — what gets handed to the deciding model
A compact, purpose-built summary, NOT raw trace events (too noisy/
expensive to hand a model wholesale). Build a function (new module, e.g.
`modules/retryDecision.ts`, or add to `tracer.ts` if that reads more
natural once you're in the code) that assembles, for a failed run:
- The original task prompt.
- The terminal status + failure reason (`fail`/`gate-failed`/
  `permissions-violation`/`loop-exhausted`/reconciled-per-M-100, whichever
  applies).
- Each Step's name/kind/status/one-line summary (not full transcripts).
- **The ticket's full attempt history so far** (every prior run's status +
  end time, not just the most recent) — the deciding model needs to know
  if this is attempt #2 or attempt #5 to reasonably factor in "this keeps
  failing, maybe give up" rather than retrying blindly toward the budget
  cap every time.

### 5. Decision model + retry-vs-new-run semantics
New Role (`kind: "agent"`, small/cheap model — this doesn't need a strong
model, it's a narrow classification decision), given the evidence stack,
returns `{decision: "retry" | "new-run" | "give-up", reasoning: string}`.

Verified directly against `modules/workflow.ts`/`cli.ts` (not assumed) what
"retry" vs "new run" actually mean in this codebase today — this differs
from what might be assumed:
- **Both always mint a brand-new `adwId`** (`cli.ts` line ~380, unconditional
  — even on `--session-id` resume). So retry and new-run are NOT
  distinguished by "reuses the old trace row" — they both always create a
  fresh one, uniformly linked to the same ticket either way. Good: this
  means the ticket/attempt data model doesn't need special-casing between
  the two paths.
- **The Workflow's Step sequence ALWAYS restarts from `steps[0]`**,
  regardless of resume — `runWorkflow`'s `runSteps(opts.workflow.steps)`
  has no skip-ahead logic at all. Resume does NOT mean "continue from the
  failed Step" — it means "replay the full Step sequence as new turns in a
  session that already has memory of the prior attempt."
- What resume (`--session-id`) actually changes, currently coupled as one
  binary choice (not independently toggleable without new plumbing):
  session continuity (reuse the pi-web session -> model remembers what it
  tried) and worktree/branch continuity (skip fresh `git worktree add`,
  reuse the existing path -> the failed attempt's files are still there,
  but `--project` must be passed as the OLD WORKTREE path, not the
  project's main checkout path, for this to work correctly — a real,
  easy-to-get-wrong usage detail, exactly what caused M-100's own trigger
  case).
- Starting heuristic for the decision Role's prompt (a starting point, not
  gospel — let the model reason, don't hardcode this as a rule engine):
  reconciled/infra failures (M-100-class) -> retry, clearly, the agent did
  nothing wrong. `PERMISSIONS-VIOLATION` -> lean new-run, resuming risks
  repeating the same confused reasoning. `GATE-FAILED` -> genuinely
  ambiguous, real judgment call. `LOOP-EXHAUSTED` -> lean new-run, the
  session already burned its in-run correction budget.
- **Real open risk, verify empirically before leaning on this in
  production**: resume has only ever been exercised for `BLOCKED-ON-HUMAN`
  (a paused, waiting session) — never proven against a session that
  already has a terminal `phase_end: fail` written for a Step. Test this
  directly (a real scratch-repo run, force a failure, attempt
  `--session-id` resume, confirm it behaves sanely) before trusting it as
  part of an automated retry path.

Track the decision call's own cost/time somewhere in the trace DB (per this
session's earlier architecture-hardening discussion — a model call is
exactly the kind of thing that shouldn't be silent runner glue) — exact
mechanism (a lightweight event type, or treating it as its own tiny
1-step run) is an implementer's call.

**Who triggers this?** Ties naturally into M-100's reconciliation
infrastructure — the visualizer is the one long-lived process in this
system. After a run is marked `fail` (either the normal write path or
M-100's reconciliation pass), check the ticket's `retries` budget; if
attempts remain, invoke the decision Role, then kick off the next attempt
(spawning a job-runner invocation the same way anything else does today —
`docker exec pi-web bun cli.ts ...`) with the right `--session-id`/
`--project`/`--ticket-id` per the decision. If budget exhausted or decision
is `give-up`, leave the ticket as failed/exhausted for a human, don't loop
forever.

### 6. Visualizer UI
Chris, explicit: full detail per attempt (not a summarized/lightweight view
for older ones) — "you're flipping through complete runs and inspecting
them." Defaults to showing the latest run. Small, subtle arrow icons (his
words: "Subtle arrow icons not big fat buttons"), not prominent buttons.

Two places need this, not just one — Chris caught this himself mid-
discussion: **grid page** (`visualizer/src/listView.ts`/`gantt.ts` — cards
become ticket-level, one card per ticket showing its latest run by default,
arrows page through attempts inline without leaving the grid) AND **detail
page** (`visualizer/src/detailView.ts` — this page conceptually becomes a
*ticket* detail page now, not a run detail page; same arrow navigation,
same full-detail-per-attempt principle, defaulting to latest). Needs a new
or extended API surface (`visualizer/src/api.ts`/`server.ts`) to fetch by
ticket and page through its linked runs.

### Suggested build order
Land in phases, verify each with real data before moving on (matches the
discipline M-100's implementation used):
1. Schema (`tickets` table, `sessions.ticket_id`) + auto-ticket-creation/
   linking on every run + `retries` field on `Workflow`. Verify with a real
   scratch-repo run that a ticket row gets created and linked correctly.
2. Visualizer grid + detail arrows/grouping, built directly against phase
   1's real data (do a second real scratch-repo run under the SAME ticket
   id manually via `--ticket-id`, to prove multi-attempt grouping actually
   renders before automated retry exists to produce it naturally).
3. Evidence-stack assembly + decision Role + trigger wiring in the
   visualizer's reconciliation loop. This is the highest-risk, most novel
   part — if the resume-after-hard-failure behavior (flagged above) turns
   out to be genuinely unreliable, stop and report back rather than ship
   an automated retry loop on top of an unverified assumption.

## Signals

## Decision log
- 2026-08-07 (claude): filed directly from Chris's verbatim idea during the
  M-100 discussion. `status: needs-refinement` — genuinely open design
  space (schema shape, what evidence gets handed to the deciding model,
  retry-vs-new-run semantics, data model for grouping attempts), matches
  the bar for this status per AGENTS.md §4b. `blocked_by` left unset since
  it's not a hard dependency in the fleet sense, but noted in Context that
  M-100 landing first gives this a trustworthy failure signal to build on.

- 2026-08-07 (claude, implementation): Phase 1 landed and verified.
  - `modules/schema.ts`: new `tickets` table (`ticket_id` PK, `file_path`
    nullable/pure-reference, `created_at`, `title`, `latest_run_adw_id`
    denormalized fast-path). `sessions.ticket_id` FK column, additive/
    nullable.
  - `modules/ticket.ts` (new): `mintInternalTicketId` (`ticket_<12 hex>`,
    visually distinct from `adw_<hex>`), `mintOrAttachTicket` (mint fresh
    internal ticket when no id given; attach to / create-if-novel an
    explicit id), `getTicket`, `setTicketLatestRun`, `runsForTicket`.
  - `modules/tracer.ts`: `Tracer.sessionStart` gained `ticketId`/
    `taskPromptForTicket` options — wires `mintOrAttachTicket` +
    `setTicketLatestRun` at the exact moment a run's `sessions` row is
    created, so every run belongs to a ticket from the start.
  - `modules/workflow.ts`/`chains/planBuildTest.ts`/`chains/registry.ts`:
    `ticketId` threaded through `WorkflowRunOptions`/`PlanBuildTestOptions`/
    `WorkflowRunOptionsBase` down to `sessionStart`.
  - `cli.ts`: new optional `--ticket-id <id>` flag.
  - `modules/workflowDef.ts`: `retries?: number` (default 0, `z.number().
    int().min(0)`) added to the `Workflow` schema/type — the BETWEEN-runs
    retry budget, distinct from `loop.max_rounds`.
  - **Real verification**: two real scratch-repo Workflow Runs against
    `local-ai-machine`'s live `pi-web` (project
    `/tmp/pi-web-factory-m103-p1-verify`, workflow `plan-build-review`) —
    confirmed via direct `factory.db` query that each run auto-minted its
    own `tickets` row and `sessions.ticket_id` correctly points at it
    (`ticket_501a14bb69ba` / `ticket_cd053eec646d`). Both underlying runs
    happened to fail on the live model (empty response after retries — a
    pre-existing, box-wide model-flakiness class already documented in
    `chains/workflow.integration.test.ts`'s own decision log, unrelated to
    this card's code) — the DB-level ticket wiring itself worked correctly
    regardless of run outcome, which is what Phase 1 needed to prove.
  - Unit tests: `modules/ticket.test.ts` (new, 10 tests), `modules/tracer.
    test.ts`'s new "Tracer — M-103 ticket wiring" block (5 tests),
    `modules/workflowDef.test.ts`'s new "retries (M-103)" block (3 tests),
    `cli.test.ts` additions for `--ticket-id` parsing.

- 2026-08-07 (claude, implementation): Phase 2 landed and verified.
  - `visualizer/server.ts`: new `GET /api/tickets` (ticket-level list, each
    row carrying its `latestRun` — the SAME full `RunSummary` shape a bare
    run always had, steps included — plus `runCount`; batched, 2 extra
    queries total, not N) and `GET /api/tickets/:ticketId` (full attempt
    history, most recent first, full detail per attempt). `/api/runs`/
    `/api/runs/:adwId` now also expose `ticketId`.
  - `visualizer/src/api.ts`: `TicketSummary`/`TicketDetail` types,
    `fetchTickets`/`fetchTicketDetail`.
  - `visualizer/src/attemptNav.ts` (new): the shared "subtle arrow icons"
    control (Chris's exact words: "subtle arrow icons, not big fat
    buttons") — `moveAttemptIndex` (pure index-clamping) +
    `attemptNavHtml` (renders nothing for a 1-attempt ticket, per-attempt
    human-facing "attempt N/total" numbering). 18 unit tests.
  - `visualizer/src/listView.ts`: rewritten ticket-level — one card per
    ticket via `/api/tickets`, `TicketCardController`/`RunningCardController`
    both gained lazy on-demand attempt-history fetch + arrow-nav wiring,
    card links carry `?attempt=<adwId>` so clicking through opens the
    exact attempt the card was showing (not a silent reset to latest).
  - `visualizer/src/detailView.ts`: rewritten as a ticket detail page
    (`DetailView(container, ticketId, initialAdwId?)`) — fetches the
    ticket's full attempt history once, arrow-nav pages through it
    in-memory, live polling (run status + events) only ever targets the
    LATEST attempt and only while the human is actually looking at it.
  - `visualizer/src/main.ts`: route changed from `#/runs/:adwId` to
    `#/tickets/:ticketId[?attempt=<adwId>]`.
  - `visualizer/src/sortRuns.ts`: new `sortTickets` (same running-first/
    most-recent rule as `sortRuns`, keyed off each ticket's `latestRun`).
  - `visualizer/src/style.css`: `.attempt-nav*` rules — small, low-contrast
    by default, full color only on hover/focus.
  - **Real verification**: did a SECOND real scratch-repo run manually
    passing `--ticket-id` matching the first Phase-1 run's own ticket
    (`ticket_501a14bb69ba`), then a third — 3 real runs under one ticket.
    Confirmed via `GET /api/tickets`/`GET /api/tickets/:ticketId` that
    `runCount: 3` and all 3 real adwIds/prompts/timestamps came back
    correctly, most-recent-first. **Headless Chrome screenshots** (ssh
    tunnel to the box, `google-chrome --headless --screenshot`) of both the
    grid (exactly 2 ticket cards for what was 4 real runs, "attempt 3/3"
    arrow-nav visible on the multi-attempt one, none on the single-attempt
    one) and the ticket detail page at both `?attempt=<latest>` ("attempt
    3/3", that attempt's own distinct Steps/prompt) and
    `?attempt=<oldest>` ("attempt 1/3", correctly showing that DIFFERENT
    attempt's own distinct adwId/prompt/Steps — that attempt actually got
    further, plan+build both ran, proving real per-attempt data, not a
    cached/stale render) — confirmed visually, not just via the API
    response shape. Unit tests: `visualizer/src/attemptNav.test.ts` (new),
    `sortRuns.test.ts`'s new `sortTickets` block, `visualizer/server.
    test.ts`'s new ticket-route tests (8 new cases, seeded via `Tracer.
    sessionStart`'s real ticket wiring, not a raw INSERT).

- 2026-08-07 (claude, implementation): Phase 3 landed — evidence-stack/
  decision-Role code fully built and tested; the automated SPAWN trigger
  was deliberately STOPPED short of executing, per the card's own
  stop-if-broken safety condition. Full detail:
  - **The one flagged empirical unknown — CONFIRMED SAFE.** Card's Plan §5
    flagged: "resume has only ever been exercised for BLOCKED-ON-HUMAN...
    never proven against a session that already has a terminal
    `phase_end: fail` written for a Step." Tested directly: took a real
    scratch-repo run that had genuinely failed (`unparseable`, `plan` Step,
    real terminal `phase_end: fail` written by `run.ts`'s normal write
    path), then ran `cli.ts --session-id <that session> --project <that
    exact worktree path> --workflow plan-build-review --ticket-id
    <ticket>` against it. Result: **behaves sanely.** The interpreter
    correctly restarted from `steps[0]` in the resumed session (a fresh
    `plan` phase_start under the NEW adwId's own phaseId — no collision
    with the original failed run's row, since `phaseId = ${adwId}_
    ${step.name}` is scoped per-adwId), the `plan` Step reached a genuine
    `status: success` this time, execution correctly proceeded to `build`,
    and the run ended in a clean, correctly-recorded terminal state
    (`sessions.status='fail'`, `build`'s own real error, both Steps with
    real `started_at`/`ended_at`) when `build` itself hit the same
    ongoing model-flakiness (see below). No crash, no confused state, no
    stuck row. This directly answers the card's flagged unknown: resume
    is safe to build an automated retry path on top of.
  - `modules/envelopes.ts`: `RetryDecisionOutputSchema` (`{decision:
    "retry"|"new-run"|"give-up", reasoning: string}`) — deliberately NOT
    extended from `EnvelopeBaseSchema` (this Role isn't a Workflow Step).
  - `modules/retryDecision.ts` (new): `assembleEvidence` (reads a failed
    run's compact evidence — prompt, terminal failure reason, per-Step
    name/kind/status/summary, full ticket attempt history — directly back
    out of `factory.db`, NOT raw trace events), `renderEvidencePrompt`,
    `decideRetry` (calls the `decide-retry` Role in its own clean one-shot
    session), `traceRetryDecision` (records the decision call's own
    cost/time as a trace-db `log` event, per the card's note that a model
    call shouldn't be silent runner glue). 15 unit tests (mocked fetch,
    same scripted-sequence pattern `run.test.ts` established).
  - `factory.config.yaml`/`prompts/decide-retry.md` (new): the `decide-
    retry` agent Role — `medium-moe` (this codebase's cheaper tier, not
    `big-moe`, per the card's "doesn't need a strong model"), `thinking:
    low`, `writes: []`. Prompt carries the card's own starting heuristics
    (reconciled/infra -> retry; permissions-violation -> lean new-run;
    gate-failed -> genuine judgment call; loop-exhausted -> lean new-run)
    as guidance for the model to reason from, not hardcoded branches.
  - `chains/registry.ts`: new `loadedWorkflows()` export — read-only access
    to the already-loaded YAML Workflow list, so the visualizer can look up
    a failed run's `retries` budget by its `sessions.adw_name` without
    duplicating registry.ts's own YAML-loading logic.
  - `modules/retryTrigger.ts` (new): `undecidedFailedRuns` (every
    `status='fail'` run with no `retry_decision` event yet — the durable
    dedup marker, survives process restarts), `planNextAttempt` (budget
    check BEFORE the costing decision call; assembles evidence; calls
    `decideRetry`; builds the EXACT `cli.ts` command for `retry`/`new-run`
    — `retry` passes `--session-id <failed adwId's session>` +
    `--project <old worktree path>`, `new-run` omits `--session-id`
    entirely), `triggerRetryIfNeeded` (the reconciliation-loop's own
    entry point — decides every undecided failed run, records the
    decision durably, LOGS the command rather than executing it). 12 unit
    tests.
  - `visualizer/server.ts`: `runRetryTriggerPass` wired into
    `runReconciliationSweep` (runs immediately after each M-100 sweep, on
    the same `reconcileDb` read-write handle) — **opt-in only**, via
    `PI_WEB_FACTORY_VISUALIZER_RETRY_TRIGGER=1` (default off).
  - **Why the actual spawn is NOT wired to execute — a real, concrete
    infrastructure gap, not a soft judgment call.** Investigated directly:
    `visualizer/server.ts` runs inside the `pi-web-factory-visualizer`
    container — a SEPARATE container from `pi-web` (`docker/docker-
    compose.yml`'s own comment on that service: "no docker.sock, no SSH
    key, nothing this read-only server needs"). `cli.ts` needs to run
    CO-LOCATED inside `pi-web` (worktree/`testCmd` shell-outs are local
    filesystem ops). Confirmed live: `pi-web-factory-visualizer` genuinely
    has no `docker.sock`, and pi-web's own HTTP API has no generic
    command-execution route either (it's a coding-agent session server).
    So there is currently NO transport for the visualizer process to
    actually invoke `docker exec pi-web bun cli.ts ...`. Per the card's own
    instruction ("if this turns out to be broken... STOP this phase... but
    still land... the evidence-stack/decision-Role code itself, which
    could still be invoked manually"): `planNextAttempt` computes the FULL
    real decision + exact next command; `triggerRetryIfNeeded` only LOGS
    it (`[retry-trigger] ... NOT auto-executed (no spawn transport...) —
    would run: ...`). A future card wiring a real spawn mechanism (e.g.
    docker.sock access for the visualizer container, or a small trigger
    endpoint inside pi-web) can swap that one log call for a real
    `Bun.spawn`/`docker exec` without touching any decision logic.
  - **Environmental note on this session's own live-model verification**:
    partway through Phase 1/2/3's live testing, `local-ai-machine`'s model
    backends became broadly unavailable (`docker ps -a`: every `*-moe`-
    backing llama.cpp/vllm container `Exited`; `litellm-queue-haproxy`
    logs: 500s on every `/v1/chat/completions` request) — confirmed
    box-wide (unrelated to this card's own code, same class already
    documented in `chains/workflow.integration.test.ts`'s own decision
    log), likely from concurrent parallel agent/benchmark load on the
    shared box during this session. This blocked getting a live,
    non-mocked `decideRetry` model response in addition to the mocked
    unit-test coverage — the evidence-ASSEMBLY half (`assembleEvidence`/
    `renderEvidencePrompt`) WAS verified against real production data
    (shown correct, complete evidence text assembled from the real failed
    runs above); the model-CALL half is covered by 15+12 passing unit
    tests using this codebase's own established mocked-fetch pattern
    (`run.test.ts`), not yet by one additional live, non-mocked
    confirmation. Flagged honestly rather than claimed as fully proven
    live.
  - Full suite: 345 pass / 6 fail (all 6 pre-existing/environmental —
    unreachable `ssh local-ai-machine` from inside a container, the same
    live-model-flakiness class, and one test that reads a sibling
    `plugins/` directory only present in a full checkout) — same baseline
    class M-100's own card documented, confirmed unchanged by this card's
    diff. `tsc --noEmit` clean throughout, including after merging in
    M-080/M-082/M-095/M-096/M-099's concurrent work (real overlap in
    `chains/registry.ts`/`cli.ts`/`modules/workflow.ts`, confirmed
    non-conflicting line ranges before merging, clean auto-merge,
    re-typechecked/re-tested after).

## Handoff notes
Read M-100's and M-098's cards first — M-100 for what a reliable `fail`
status actually looks like once that lands, M-098 for the existing
`--session-id` resume mechanism (relevant prior art for "retry the same
run") and for the finding that pi-web-factory doesn't commit/push
anywhere today (relevant to what "a new attempt" even means in git terms).

Full design refined 2026-08-07 (see Plan) via direct back-and-forth with
Chris, including verifying the actual resume/`adwId` behavior against real
code before writing the design down (it doesn't work the way it might be
assumed to — see Plan §5). Build in the suggested phase order; phase 3 is
the riskiest and has one real unverified assumption flagged explicitly —
don't skip that verification step.

**2026-08-07, post-implementation**: Phases 1 and 2 are fully done and live
(pushed to `main`). Phase 3's evidence-stack/decision-Role code
(`modules/retryDecision.ts`, `modules/retryTrigger.ts`,
`prompts/decide-retry.md`, the `decide-retry` Role in
`factory.config.yaml`) is also fully done, tested, and manually invokable —
and the one flagged empirical risk (resume after a real terminal
`phase_end: fail`, not just BLOCKED-ON-HUMAN) is now CONFIRMED SAFE via a
real scratch-repo test (see Decision log). What's genuinely left undone:
the actual SPAWN of a next-attempt job-runner process from
`triggerRetryIfNeeded` — `visualizer/server.ts`'s
`pi-web-factory-visualizer` container has no `docker.sock`/transport to
`docker exec pi-web bun cli.ts ...` from where it runs today (confirmed
live, see Decision log — this is a real infra gap, not a design choice
made lightly). The trigger pass (opt-in via
`PI_WEB_FACTORY_VISUALIZER_RETRY_TRIGGER=1`) computes the full decision and
the exact command that SHOULD run, and logs it — a human/future card can
copy that logged command and run it manually today, or wire a real spawn
mechanism (docker.sock for the visualizer container, or a small trigger
endpoint inside `pi-web`) to make it fully automated without touching any
of the decision logic itself. Left in `blocked/` for that reason rather
than `done/`, per the task's own explicit instruction not to claim done
when the automated-trigger piece is stopped short.

Also worth a human's attention independent of this card: `local-ai-machine`
was under real, sustained model-backend unavailability throughout a good
chunk of this implementation session (every `*-moe`-backing model
container `Exited`, `litellm-queue-haproxy` returning 500s on every
request) — confirmed box-wide via `docker ps -a`/`docker logs
litellm-queue-haproxy`, not specific to this card's own code. Several real
scratch-repo verification runs during this card's work failed on an empty
model response as a result (still useful — proved the DB/ticket/resume
wiring correctness regardless of the model's own output) but a genuinely
clean, non-mocked `decideRetry` model round trip was never captured live
because of it. Worth checking model-container health/scheduling if this
recurs.
