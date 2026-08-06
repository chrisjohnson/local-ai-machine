---
id: M-100
title: visualizer shows stuck "running" cards long after the session is dead
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
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
<!-- not scoped yet -- needs someone to:
     1. Pull the actual stuck runs' IDs/project/session details from the
        visualizer API or pi-web's own session store and check whether the
        underlying pi-web session is actually still alive (query pi-web
        directly, not just the visualizer's cached view) or genuinely dead.
     2. If dead: find where "session ended, status still shows running" can
        happen -- e.g. no reconciliation after a container
        restart/recreate, no timeout-based staleness check, a crash in the
        `build` Step's own completion-handling code path that never wrote
        a terminal status. Check piwebClient.ts's waitForCompletion and
        whatever writes Step status into whatever store the visualizer's
        /api/runs reads from.
     3. Decide + implement a real fix: likely either (a) a reconciliation
        pass that detects orphaned "running" Steps whose parent session no
        longer exists/is idle past some threshold and marks them
        failed/unknown, and/or (b) whatever code path is supposed to mark
        a Step's terminal status but isn't reliably doing so on process
        death. -->

## Signals

## Decision log
- 2026-08-06 (claude): filed directly from Chris's report + a quick live
  API spot-check (two `build` Steps stuck `running` for ~43min, start
  times ~10s apart). `status: needs-refinement` -- didn't have session
  budget left to pull real run IDs, confirm session death, or read the
  actual status-writing code path before filing.

## Handoff notes
Start by getting the real run IDs (`curl http://192.168.1.226:8090/api/runs`
and match on the ~17:30:34Z / 17:30:44Z start times) and checking pi-web's
own session view directly for whether either is still genuinely alive.
