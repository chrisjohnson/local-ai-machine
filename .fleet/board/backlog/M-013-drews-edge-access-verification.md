---
id: M-013
title: "Task 6.4: Drew's edge access verification"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-011
status: null
related_cards: [M-011]
---

# M-013 — Drew's Edge Access Verification

## Context

Ported from README.md §8 Phase 6, Task 6.4 (was 4.3) (2026-07-26). Confirm
Drew's WireGuard VPN path to the LiteLLM/Hermes endpoints works end-to-end
with `sk-drew-edge`, respecting rate limits.

Depends on [[M-011]] (`sk-drew-edge` key generation) existing first — can't
verify end-to-end access with a key that hasn't been created yet.

## Plan
<!-- ordered checklist -->
1. [ ] Confirm Drew's WireGuard VPN path reaches the LiteLLM/Hermes
   endpoints.
2. [ ] Confirm requests using `sk-drew-edge` succeed end-to-end over that
   path.
3. [ ] Confirm the rate limits from [[M-011]] are actually respected over
   the VPN path, not just locally.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 6, Task 6.4 into a fleet
  card during the fleet-bootstrap backlog migration; marked `blocked_by`
  [[M-011]] since this task needs `sk-drew-edge` to already exist.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Blocked on [[M-011]] landing first — nothing to verify without
the key.
