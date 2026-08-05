---
id: M-091
title: pi-web-factory — populate sessions.title at Workflow Run start
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T20:50:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-074, M-090]
---

# M-091 — pi-web-factory — populate sessions.title at Workflow Run start

## Context
Chris: "Use more descriptive titles for the workspace runs so what shows up in the
visualizer looks like real work happening." `sessions.title` has existed since M-074
but nothing in the real pipeline ever called `sessionSetTitle` — M-090's own
`runTitle()` fallback (`title → request → adwId`) covered for this at the display
layer only, flagged there as real, separate follow-up work.

## Plan
1. [x] `tracer.ts`: `deriveTitleFromPrompt()` — deterministic, no model call, first
   sentence/line extraction from the task prompt, capped at 72 chars with ellipsis.
2. [x] Wired into both real Workflow Run entry points (`workflow.ts`'s
   `runWorkflow`, `chains/planBuildTest.ts`) alongside the existing `sessionRequest`
   call.
3. [x] Real unit tests: sentence boundary, line boundary, hard-truncation, empty
   input, `?`/`!` as sentence boundaries too (not just `.`).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T20:55Z — done, deployed -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): confirmed via `cli.ts` that every real invocation mints a
  fresh `adwId` regardless of `--session-id` (resume reuses an existing pi-web
  session, not an existing trace-db row) — so there's no risk of a resume's own
  short follow-up prompt ("continue") ever overwriting a good original title.
- 2026-08-05 (claude): 251 tests passing (245 + 6 new), `tsc --noEmit` clean
  (caught and fixed one `noUncheckedIndexedAccess` violation on regex capture-group
  access before committing).

## Handoff notes
Commit `857b55c` on `main`, deployed. New Workflow Runs from this point forward get
a real title; historical runs before this change still show `runTitle()`'s
`request`-fallback in the visualizer (harmless, no backfill needed/attempted).
