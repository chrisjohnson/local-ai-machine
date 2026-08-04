---
id: M-074
title: pi-web-factory — schema migration to Workflow Run / Step terminology
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T16:57:25Z
blocks: null
blocked_by: null
status: null
related_cards: [M-061, M-075, M-076, M-077]
---

# M-074 — pi-web-factory — schema migration to Workflow Run / Step terminology

## Context
Foundation for the whole 2026-08-04 terminology revision (`pi-web-adw-design.md` §7,
especially §7.3). M-061's schema (`modules/schema.ts`) and tracer (`modules/tracer.ts`)
are `done` and tested against the old `sessions`/`phases` vocabulary — this card
migrates them to the new one. Nothing about the *design* changes here beyond what §7.3
specifies; this is a rename + a few real additions, not a rethink.

## Plan
1. [ ] `modules/schema.ts`: decide and apply actual identifier names (design doc
   deliberately left this to the implementer — "not decided character-by-character").
   Reasonable default: keep the physical SQL table names `sessions`/`phases` (avoids a
   destructive `ALTER TABLE RENAME` + touching every existing query string) but rename
   the **TS-level** types/fields/comments to the new vocabulary (`WorkflowRun`,
   `Step`, `role` instead of `owner`) — document this SQL-name-vs-TS-name split
   clearly in the module's own header comment so it doesn't read as an oversight.
   If the implementer judges a real table rename is worth the churn instead, that's a
   legitimate call too — just make it deliberately and say why.
2. [ ] Add `sessions.title TEXT` (nullable — derived from the prompt when ad hoc, or a
   future ticket's own title; not populated by this card, just the column).
3. [ ] Narrow `phases.kind` to `'agent' | 'code'` — drop the unused `'engineer'` value
   from the TS type (leave the SQL column as plain `TEXT`, nothing to migrate at the
   db level, just stop the type system offering a value nothing ever writes).
4. [ ] Rename `phases.owner` → conceptually `role` (TS-level rename per item 1's
   decision; SQL column rename is the implementer's call, same reasoning).
5. [ ] Add per-step token columns: `input_tokens INTEGER`, `output_tokens INTEGER`,
   `cached_tokens INTEGER` (all nullable — code steps never populate these; agent
   steps populate them from the same `agent_end` event payload `tracer.ts`'s
   `_sideEffects` already reads for `sessions.total_tokens`, just also written
   per-phase now, not only accumulated at the run level).
6. [ ] Add `phases.output_summary TEXT` (nullable) — an agent step's envelope
   `summary` field, or a code step's gate-result headline (e.g. "3/3 checks passed").
   `run.ts` (M-066, already built) is the caller that will need updating to actually
   populate this — that wiring is this card's job too, not deferred to M-076, since
   `run.ts` already exists and already has the envelope/gate data in hand at exactly
   the point it calls `tracer.event(...)`.
7. [ ] Update every existing test that touches these tables/fields
   (`tracer.test.ts`, `run.test.ts`, `planBuildTest.integration.test.ts`'s trace
   assertions) to the new shape — confirm nothing regresses.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T16:57Z — claiming, starting schema/terminology migration -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
