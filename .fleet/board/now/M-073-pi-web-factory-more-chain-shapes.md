---
id: M-073
title: pi-web-factory — lightweight plan-implement-review chain + bounded build/review loop
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-066, M-072]
---

# M-073 — pi-web-factory — lightweight plan-implement-review chain + bounded build/review loop

## Context
Chris's feedback 2026-08-04: match SSSF's own variety of chain shapes — "a lightweight
plan->implement->review, a complete run with a mechanism for a limited number of
review->build->review->build cycles, probably max 3 rounds" (`pi-web-adw-design.md`
§6.1 point 4, §6.3). Today only one chain exists (`chains/planBuildTest.ts`:
plan → build → test, no review, no loop).

**Two distinct things, don't conflate them:**
- `run.ts`'s existing retry-on-parse-failure loop (already built, M-066) retries a
  *single phase* when its JSON doesn't parse — bounded at 3 attempts, operates below
  the chain level, nothing to change here.
- This card's bounded loop is a **chain-level** correction cycle: reviewer rejects →
  builder gets the reviewer's specific findings and tries again → reviewer re-checks
  → ... up to 3 rounds, then the chain reports its final state (not necessarily
  "success" — a 3rd rejection is a real, reportable outcome, not silently accepted).
  Mirrors upstream SSSF's own `adw_build_review` chain shape.

## Plan
1. [ ] `chains/planImplementReview.ts` — plan → build → review, no loop, three
   `runAgentPhase` calls in sequence (same session, continuation, matching
   `planBuildTest.ts`'s established pattern). Reuses `ReviewOutputSchema` from
   `envelopes.ts` (already built, unused until now) for the review phase's envelope.
2. [ ] A bounded build↔review chain (name TBD — e.g. `chains/buildReview.ts`,
   matching the design doc's own earlier-sketched name): build → review; if
   `!approved` (per `ReviewOutput`'s `approved`/`findings`/`blocking` fields), loop
   back to build with the reviewer's `blocking`/unmet `findings` folded into the next
   build prompt as a correction (same "name exactly what was wrong" discipline
   `run.ts`'s `buildCorrectionMessage` already established for parse failures — reuse
   that pattern's spirit, don't invent a new one). Hard cap at 3 rounds; the 3rd
   rejection is a real chain outcome (`status: "not-approved-after-max-rounds"` or
   similar — needs its own discriminated-union branch, don't collapse it into
   `"failed"`).
3. [ ] Consider (implementer's judgment, not mandated): does this bounded chain want
   upstream's `verdict_consistent` gate (deliberately NOT ported in M-063, see that
   card's decision log — flagged then as "a candidate for M-066" and never picked
   up)? A chain that actually branches on `approved` is the first real consumer of
   that consistency check — building it now may be more honest than building the
   loop on an unverified verdict field. If skipped, document why, same discipline as
   every other deliberate-omission decision in this project so far.
4. [ ] Register both new chains in `chains/registry.ts`.
5. [ ] Tests: unit tests for the bounded-loop logic (mocked, matching `run.test.ts`'s
   established mock-fetch pattern — prove 3-round exhaustion reports the right
   status, prove an early approval doesn't burn unnecessary rounds), plus at least
   one live end-to-end test for each new chain (matching the established
   `*.integration.test.ts` pattern — real scratch repo, real model, real cleanup).

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
