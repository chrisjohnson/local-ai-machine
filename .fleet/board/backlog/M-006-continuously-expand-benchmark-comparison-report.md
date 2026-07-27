---
id: M-006
title: Continuously expand the benchmark comparison report (standing task)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-005]
---

# M-006 — Continuously expand the benchmark comparison report

## Context

Ported from README.md §8 Phase 5, Task 5.4 (2026-07-26). This is a
**standing/recurring task, not a one-shot**: every meaningful round of new
data (new model tested, confirmed optimization) should produce a new dated
comparison report/dashboard for direct before/after comparison, not overwrite
history. `docs/benchmark-report-2026-07-23.html` was the original baseline;
a newer dashboard, `docs/comparison-dashboard-2026-07-26.html`, was already
built 2026-07-26 following exactly this task's own instruction. **Keep doing
this going forward** every time new benchmark data lands — this card doesn't
close just because a dashboard exists.

Also folds in the six-tier coding harness (`scripts/coding_benchmark.py`)
history for context: originally two tiers (A: correctness, B: tool-calling),
expanded 2026-07-23 to six — added Tier J (judge-role strict-JSON verdict,
catches a degenerate "always pass" judge), Tier P (personal-assistant,
constrained-length summary/structured extraction), Tier D (long-running
interactive debugging, 3-turn conversation grading the final fix against
known-correct test assertions), Tier Q (planning/"grill me" fitness,
keyword-matched against 5 known-missing critical details, min 3/5 to pass).
All six tiers run against every model by default now. Fully autonomous.

## Plan
<!-- ordered checklist -->
1. [ ] Whenever a new model is benchmarked or a new optimization is
   confirmed, generate a new dated comparison report/dashboard rather than
   overwriting the previous one.
2. [ ] Keep the six-tier coding harness (`scripts/coding_benchmark.py`)
   running against every new model by default.
3. [ ] Link/cross-reference each new report from wherever the "current
   baseline" pointer lives (currently README references
   `docs/benchmark-report-2026-07-23.html`; keep that pointer current or
   retire it in favor of the dashboard).

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 5, Task 5.4 into a fleet
  card during the fleet-bootstrap backlog migration; worded as an ongoing
  standing task rather than a one-shot, since `docs/comparison-dashboard-
  2026-07-26.html` already exists as one iteration of this task, not its
  completion.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
`docs/comparison-dashboard-2026-07-26.html` is the most recent iteration.
Next agent doing new benchmark work should produce the next dated report on
top of it, not treat this card as satisfied and closeable.
