---
id: M-011
title: "Task 6.2: Drew's rate-limited key generation"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-011 — Drew's Rate-Limited Key Generation

## Context

Ported from README.md §8 Phase 6, Task 6.2 (was part of 3.6) (2026-07-26).
Generate `sk-drew-edge` via LiteLLM's `/key/generate` API — needs actual
rate-limit and route-blocking parameters (`rpm_limit`, `models` allowlist
excluding cloud/governed-admin routes) decided **before** creating it, not
just an unrestricted key with a different name. Confirm Drew is correctly
rate-limited and blocked from cloud/governed-admin routes.

## Plan
<!-- ordered checklist -->
1. [ ] Decide the actual rate-limit (`rpm_limit`) and `models` allowlist
   values before generating the key — not an afterthought.
2. [ ] Generate `sk-drew-edge` via LiteLLM's `/key/generate` API with those
   parameters.
3. [ ] Verify Drew is correctly rate-limited and blocked from
   cloud/governed-admin routes (real test requests, not just config
   inspection).

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 6, Task 6.2 into a fleet
  card during the fleet-bootstrap backlog migration.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. The rate-limit/allowlist parameters haven't been decided yet —
that decision needs to happen before calling `/key/generate`, not after.
