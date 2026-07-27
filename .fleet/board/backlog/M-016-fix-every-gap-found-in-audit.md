---
id: M-016
title: "Task 7.2: Fix every gap found in the audit"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: M-017
blocked_by: M-015
status: null
related_cards: [M-015, M-017, M-018]
---

# M-016 — Fix every gap found in the audit

## Context

Ported from README.md §8 Phase 7, Task 7.2 (2026-07-26). Second card in the
7.1→7.4 chain. Commit the missing pieces, document the genuinely-manual
steps clearly (in README, not tribal knowledge), until the audit from
[[M-015]] comes back clean.

## Plan
<!-- ordered checklist -->
1. [ ] Work through the gap list [[M-015]] produced.
2. [ ] For each gap, either commit the missing declarative piece or
   document the genuinely-manual step clearly in README (not left as
   tribal knowledge).
3. [ ] Re-run/re-check the audit until it comes back clean — no open gaps
   remaining.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 7, Task 7.2 into a fleet
  card during the fleet-bootstrap backlog migration; `blocked_by` [[M-015]]
  since there's no gap list to fix until the audit runs.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Blocked on [[M-015]] producing a real gap list first.
