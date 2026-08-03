---
id: M-010
title: "Task 6.1: Turnstone judge & governed route verification"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-010 — Turnstone Judge & Governed Route Verification

## Context

Ported from README.md §8 Phase 6, Task 6.1 (was 3.5) (2026-07-26). Phase 6's
objective: verify the remaining pieces supporting Drew's access, safety
governance, and operational resilience — distinct from the model
research/optimization work in Phase 5, and appropriately last since none of
it blocks day-to-day use of the stack by Chris.

Confirm Turnstone's safety judge (Qwen3.5-4B judge slot) actually intercepts
and evaluates `governed_coder` requests as intended, and that
`turnstone-eval`/`turnstone-doctor` run cleanly. Wiring `vllm-judge` in as
Turnstone's judge/reranker model has **no env-var equivalent** — it's
TOML-config (`~/.config/turnstone/config.toml`) or console-UI only, so
writing that config is real remaining work here, not just plumbing that got
skipped. Confirmed still empty as of the 2026-07-22 audit.

## Plan
<!-- ordered checklist -->
1. [ ] Write the `~/.config/turnstone/config.toml` entry wiring `vllm-judge`
   in as Turnstone's judge/reranker model (no env-var path exists for this).
2. [ ] Confirm Turnstone's safety judge actually intercepts and evaluates
   `governed_coder` requests as intended.
3. [ ] Run `turnstone-eval`/`turnstone-doctor` and confirm both complete
   cleanly.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 6, Task 6.1 into a fleet
  card during the fleet-bootstrap backlog migration.
- 2026-08-03 — closed as moot: Chris decided to fully decommission Turnstone
  (containers were already gone from the box; teardown of remaining
  compose/config/docs/volume done same day). There is no governed_coder
  route or Turnstone judge left to verify.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. `~/.config/turnstone/config.toml` was confirmed still empty as
of the 2026-07-22 audit — this is genuinely unstarted work, not a
verification-only task.
