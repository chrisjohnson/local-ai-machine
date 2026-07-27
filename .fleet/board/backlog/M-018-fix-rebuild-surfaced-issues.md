---
id: M-018
title: "Task 7.4: Fix anything the rebuild surfaces, then re-verify"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-017
status: null
related_cards: [M-015, M-016, M-017]
---

# M-018 — Fix anything the rebuild surfaces, then re-verify

## Context

Ported from README.md §8 Phase 7, Task 7.4 (2026-07-26). Fourth and final
card in the 7.1→7.4 chain. Fix anything the from-scratch rebuild ([[M-017]])
surfaces, then re-verify. Repeat until a from-scratch rebuild genuinely
works end-to-end unattended.

## Plan
<!-- ordered checklist -->
1. [ ] Fix anything [[M-017]]'s rebuild surfaced.
2. [ ] Re-verify with another rebuild attempt.
3. [ ] Repeat until a from-scratch rebuild genuinely works end-to-end
   unattended, with zero manual intervention.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 7, Task 7.4 into a fleet
  card during the fleet-bootstrap backlog migration; `blocked_by` [[M-017]]
  as the final link in the sequential 7.1-7.4 chain.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Blocked on [[M-017]] (the actual wipe/rebuild) happening
first — nothing to fix until a rebuild attempt surfaces real issues.
