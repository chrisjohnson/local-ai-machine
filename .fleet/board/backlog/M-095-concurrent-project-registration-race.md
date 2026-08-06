---
id: M-095
title: pi-web-factory project registration races when two cli.ts runs against different new projects launch simultaneously
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
related_cards: [M-094]
---

# M-095 — pi-web-factory project registration races under concurrent launch

## Context
Found 2026-08-06 while testing M-094 (litellm cross-model request queue) —
unrelated to that card, filed separately per its own decision log.

Two real Workflow Runs, each targeting a DIFFERENT brand-new scratch project
(`/tmp/pi-web-factory-m094-retry-a`, `/tmp/pi-web-factory-m094-retry-b`),
launched via `cli.ts` within ~2ms of each other (two `docker compose exec -d`
invocations backgrounded and `wait`ed together in the same shell).

Run A failed almost immediately:
```
PiWebClientError: pi-web request failed (404): Project not found
    at requestJson (/home/piweb/pi-web-factory/modules/piwebProject.ts:67:15)
    at async resolveWorkspaceId (/home/piweb/pi-web-factory/modules/piwebProject.ts:134:28)
    at async runWorkflow (/home/piweb/pi-web-factory/modules/workflow.ts:538:29)
```
Run B (launched at the same moment, different project) succeeded in
registering its project and proceeded normally (failed later, separately,
for an unrelated reason — a real "unparseable" model response, see M-094's
own decision log for that part).

This looks like a genuine race in `piwebProject.ts`'s project-registration
flow when TWO calls are racing to register/resolve DIFFERENT new projects at
the same moment — not simply "the same project registered twice" (a more
obvious, probably-already-handled case), but something about concurrent
registration of unrelated projects tripping a lookup that expects to run
serially.

## Plan
<!-- not scoped yet -- needs someone to read piwebProject.ts's
resolveWorkspaceId/registration flow in full and reproduce deliberately
(fire N concurrent cli.ts launches against N distinct fresh projects,
see how many fail and with what) before this can be planned -->

## Signals

## Decision log
- 2026-08-06 (claude): filed from a real, reproduced (once) failure during
  M-094 testing. Not investigated further — M-094 was the priority at the
  time. `status: needs-refinement` since the actual root cause in
  `piwebProject.ts` hasn't been read/diagnosed yet, only the symptom.

## Handoff notes
Only reproduced once, incidentally. Whoever picks this up should first try
to reproduce deliberately and reliably (concurrent `cli.ts` launches against
distinct fresh projects) before attempting a fix — a single incidental
occurrence isn't enough to be confident about the actual failure mechanism.
