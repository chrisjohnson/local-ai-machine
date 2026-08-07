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
