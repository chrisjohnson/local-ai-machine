---
id: M-003
title: Migrate remaining agentic instruction/state from README.md into AGENTS.md + fleet cards
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
related_cards: []
---

# M-003 — Migrate remaining agentic content from README.md into AGENTS.md + fleet cards

## Context

Chris's stated intention (2026-07-26): switch this repo from the README-based
agentic-instruction flow to the fleet workflow — pull all agentic instruction
and state out of `README.md` and into `AGENTS.md` + `.fleet/board/`. A starter
`AGENTS.md` was created the same day (repo identity, the git-mediated
box-deploy workflow, hard-stops, pointers to `catalog/OPERATIONS.md` and
`HANDOFF.md`) — but `README.md` is large (1400+ lines) and still contains a
lot of agentic-process content that hasn't been touched yet: the "Open Next
Steps" section's phase-by-phase task tracking, standing-permission notes
(e.g. "freely swap vllm-primary/judge for testing"), the download check-in
protocol, and narrative decision history mixed in with genuine
user-documentation content that *should* stay in README.

`status: needs-refinement` because the real scoping question — what in
README is agentic *process* (→ AGENTS.md or a fleet card) vs. genuine
*product documentation* (→ stays in README, since README should still explain
what this project *is* to a human or future agent encountering it cold) —
hasn't been decided. Doing this section-by-section without that judgment call
first risks either stripping README down to nothing useful or leaving
agentic-process cruft behind.

## Plan
<!-- ordered checklist -->
1. [ ] Read `README.md` end to end and classify each section: product docs
   (stays), stale/completed agentic process (safe to delete — already
   superseded by fleet cards or by events), still-relevant agentic state
   (needs a new home — AGENTS.md if it's a standing rule, a fleet card if
   it's an actual open task).
2. [ ] Get Chris's sign-off on the classification before deleting anything —
   this is exactly the kind of judgment call worth a quick check-in given
   how much history is in there.
3. [ ] Move/delete accordingly, keeping README focused on what a human or
   fresh agent needs to understand the project, not on tracking in-flight
   work.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed per Chris's stated intention while working [[M-001]]/
  [[M-002]] scoping; marked needs-refinement since the docs-vs-process
  classification is a real open question, not yet actionable.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. A starter `AGENTS.md` already exists (repo identity, box-deploy
workflow, hard-stops) — this card is about the rest of README's content, not
about creating AGENTS.md from scratch.
