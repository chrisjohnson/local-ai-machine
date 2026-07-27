---
id: M-012
title: "Task 6.3: Herdr & Hermes control plane verification"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-012 — Herdr & Hermes Control Plane Verification

## Context

Ported from README.md §8 Phase 6, Task 6.3 (was 3.7) (2026-07-26). Verify
the Herdr daemon socket is reachable, panes spawn correctly, and Hermes'
Telegram topic routing + sub-agent delegation rules (README Section 6)
behave as documented.

## Plan
<!-- ordered checklist -->
1. [ ] Verify the Herdr daemon socket is reachable.
2. [ ] Verify Herdr panes spawn correctly.
3. [ ] Verify Hermes' Telegram topic routing behaves as documented (README
   Section 6).
4. [ ] Verify Hermes' sub-agent delegation rules behave as documented.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 6, Task 6.3 into a fleet
  card during the fleet-bootstrap backlog migration.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Verification-only task — check README Section 6 for the
documented expected behavior of Hermes' topic routing/delegation rules
before testing.
