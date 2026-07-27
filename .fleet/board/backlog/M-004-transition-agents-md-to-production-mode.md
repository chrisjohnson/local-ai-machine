---
id: M-004
title: Transition AGENTS.md to production mode — ask first, no destructive actions without confirmation
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
related_cards: []
---

# M-004 — Transition AGENTS.md to production mode

## Context

`AGENTS.md` (created 2026-07-26) currently grants broad standing autonomy
tuned for the active build-out/benchmarking phase this repo is in right now:
"You have full authority to manage the box's OS/services to get work done —
start/stop containers, run `nixos-rebuild`, pause/resume downloads, run
benchmarks — this is not timid, ask-first territory." That's appropriate
while the machine is under active development and Chris is deliberately
granting wide autonomous latitude (e.g. the 2026-07-25/26 weekend sweep).

Chris wants a tracked transition to a more conservative "production mode"
once the machine reaches a stable, ongoing-use state — the standing default
should shift toward asking first and never taking a destructive/hard-to-
reverse action without explicit confirmation, rather than today's broad
"drive it through git, just do it" grant.

`status: needs-refinement` because the actual trigger condition and the
precise new default posture aren't defined yet — this needs Chris's input on:

## Open questions
1. **What marks the transition?** A specific milestone (e.g. Phase 7's
   from-scratch-rebuild verification passing, or the two-tier
   catalog/compose migration landing), a calendar point, or just "when Chris
   says so"?
2. **What exactly changes?** Likely candidates to gate behind explicit
   confirmation in production mode that are currently standing-permission:
   stopping/restarting the standing `vllm-primary`/`vllm-judge` services,
   pausing the download queue, any `nixos-rebuild switch`, any `docker
   compose` action affecting a running service. Benchmarking a *new*
   candidate build (not touching what's currently serving) might reasonably
   stay autonomous even in production mode — needs Chris's call on where the
   line actually sits, not an assumption.
3. **Does this apply uniformly, or per-context** (e.g. still-permissive
   during an explicit "benchmark sweep" session, conservative by default
   otherwise)?

## Plan
<!-- ordered checklist -->
1. [ ] Get Chris's answers to the open questions above.
2. [ ] Rewrite the relevant `AGENTS.md` sections (the "full authority" grant
   and hard-stops list) to reflect the agreed production-mode posture.
3. [ ] Decide whether this is a hard cutover (one edit, one day) or a
   phased tightening — record whichever it is here.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed per Chris's direct request; marked needs-refinement
  since the trigger condition and exact scope of "production mode" need his
  input before this is actionable.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Needs Chris's answers to the open questions before any
AGENTS.md edit is made.
