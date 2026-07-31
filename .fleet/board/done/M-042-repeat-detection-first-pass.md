---
id: M-042
title: Implement first-pass guardrail - semantic repeat/thinking-loop detection
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: [M-040, M-041]
status: null
related_cards: [M-040, M-041]
---

# M-042 — Implement first-pass guardrail: semantic repeat/thinking-loop detection

## Context
First concrete implementation of the pattern researched in M-041, using
the GLM-4.7-Flash judge model deployed in M-040. Picks the specific
guardrail that started this whole line of investigation: a session stuck
re-verifying/re-attempting the same thing via trivially-varied actions,
the exact failure mode Turnstone's own byte-literal `RepeatDetector`
missed (found live, this session, in the printer-dashboard workstream).

**Blocked behind M-040, which is itself paused tonight** (real incident
during M-037's deploy - a blanket compose command briefly took down the
`coder` model as collateral damage; holding off further shared-model-
stack changes, including M-040's new judge service, for Chris's morning
review). M-041's research/design work can still proceed independently -
it's pure writing, no infra touched.

This is a first pass, not a complete guardrail suite - one working
extension, real detection, real intervention, honestly scoped.

## Plan
1. [ ] Build a pi extension (per M-041's confirmed API shape) that:
   - Tracks recent `tool_call` events for the session (a rolling window,
     not the full history - keep it cheap).
   - On each new tool call, asks the judge model (M-040) a narrow
     question: does this call look like a semantic repeat of recent
     ones (same underlying goal, different surface form) - not byte-
     identical, that part's already handled adequately elsewhere.
   - On a positive detection: **block** the call with a clear `reason`
     the model will see (e.g. "this looks like the Nth attempt at the
     same underlying check - stop and either report what you already
     know or ask the user"), OR **steer** a corrective message - pick
     whichever M-041's research concluded is the better fit, don't
     re-litigate that choice here.
2. [ ] Make the judge call itself cheap and non-blocking-feeling - this
   runs on every tool call, so latency and cost (even at $0 for a local
   model, wall-clock time) matters. Consider: only invoke the judge
   after N tool calls in a short window, not on every single one.
3. [ ] Install into pi-web's shared extensions location.
4. [ ] Verify for real: reproduce something like the original
   4-minute Turnstone incident (a task where the model would plausibly
   re-verify something it already knows) against pi-web with this
   extension active, confirm it actually intervenes - don't just review
   the code and assume it works.
5. [ ] Be honest in the decision log about what this does and doesn't
   catch - e.g. if the judge's semantic-repeat judgment has false
   negatives/positives observed during testing, record them plainly
   rather than claiming full coverage.

## Signals

## Decision log

## Handoff notes
