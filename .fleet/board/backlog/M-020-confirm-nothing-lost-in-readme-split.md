---
id: M-020
title: "Task 8.4: Confirm nothing is lost in the README split"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-019
status: null
related_cards: [M-003, M-019]
---

# M-020 — Confirm nothing is lost in the README split

## Context

Ported from README.md §8 Phase 8, Task 8.4 (2026-07-26). The current
README's decision-log history is real project memory, not filler — it
shouldn't just be deleted when the "live" README becomes lean (per
[[M-019]]'s rewrite and [[M-003]]'s agentic-content migration). Preserve it
somewhere sensible (e.g. `docs/history.md` or similar) even after the
split.

Depends on [[M-019]] (the new human-facing README) existing so there's an
actual "before/after" to diff for completeness.

## Plan
<!-- ordered checklist -->
1. [ ] Once [[M-019]] (and [[M-003]]'s classification work) land, diff the
   old README against the new structure section by section.
2. [ ] Confirm every piece of real decision-log history has a home — either
   still in the new README, or preserved in something like
   `docs/history.md`.
3. [ ] Confirm nothing was silently dropped rather than deliberately
   relocated or removed.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 8, Task 8.4 into a fleet
  card during the fleet-bootstrap backlog migration; `blocked_by` [[M-019]]
  since there's nothing to verify completeness against until the new
  README exists.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Blocked on [[M-019]] landing first.
