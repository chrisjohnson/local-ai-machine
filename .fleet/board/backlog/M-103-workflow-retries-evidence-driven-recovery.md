---
id: M-103
title: workflow retries — evidence-driven retry/new-run decision + merged multi-attempt UI
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
related_cards: [M-100]
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
<!-- not scoped yet -- open questions to work through before this is
     actionable:
     - Schema: where does `retries` live — per-Workflow (in the YAML), per-
       Step, or per-run (an override at invocation time)? What's the
       default, and is 0 the same as "no auto-retry, manual only"?
     - The "evidence stack": what exactly gets hand to the deciding model —
       raw trace events, the parsed envelopes, just the terminal failure
       reason + last Step's context? Needs a real look at what's in
       factory.db (schema.ts) and whether that's already enough, or needs
       a purpose-built summary.
     - Decision model: a NEW agent Role (like plan/build/review), or a
       cheaper/smaller model given a narrow decision prompt? Where does it
       run — inline in the job runner right after a failure, or as a
       separate step someone/something triggers later?
     - Retry-vs-new-run semantics: what's the actual difference in this
       codebase between "retry the same Workflow Run" (resume machinery
       already exists via --session-id, per M-098's research) and "start a
       genuinely new Workflow Run" — and what would make the decision model
       pick one over the other?
     - Data model for "one logical job, multiple attempts": needs a real
       grouping key (a parent adwId? a new `attempt_of` column?) connecting
       N `sessions`/`phases` rows as attempts of the same logical unit —
       this is a schema change in `schema.ts`, not just a UI change.
     - Visualizer UI: the merged-card-with-arrow-buttons interaction is a
       real frontend design task once the data model exists to support it. -->

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
