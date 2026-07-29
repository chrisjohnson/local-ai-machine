---
id: M-004
title: Transition AGENTS.md to production mode — ask first, no destructive actions without confirmation
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-018
status: null
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

## Decisions (confirmed 2026-07-29, via AskUserQuestion)

1. **Trigger: Phase 7 rebuild-verification passing** — i.e. this card is
   `blocked_by: M-018` ("Fix anything the rebuild surfaces, then
   re-verify"), the last card in the wipe-and-rebuild-from-scratch chain
   (M-015 → M-016 → M-017 → M-018). Not the two-tier catalog/compose
   migration (M-001, already closed) — Chris explicitly wants proof the box
   is fully reproducible from git before tightening autonomy, not just the
   catalog/compose work being done.
2. **Scope: anything touching what's currently serving needs confirmation.**
   Stopping/restarting standing services, `nixos-rebuild switch`, any
   `docker compose` action affecting a running service, pausing the
   download queue — all gated behind explicit confirmation once production
   mode is active. Testing/benchmarking a *new* candidate build that
   doesn't touch current production stays autonomous even in production
   mode.
3. **Uniformity: context-dependent.** Conservative by default once
   triggered, but an explicit session-level grant (matching how the
   original weekend-sweep authorization, and this session's own M-022/M-024
   work, actually got authorized) can still unlock broader autonomy for
   that specific session — not a hard uniform lockdown with no override
   mechanism.

## Plan
<!-- ordered checklist -->
1. [x] Get Chris's answers to the open questions (trigger, scope,
   uniformity — see Decisions above).
2. [ ] Rewrite the relevant `AGENTS.md` sections (the "full authority"
   grant and hard-stops list) to reflect the agreed production-mode
   posture, once M-018 actually lands — not yet, this card is blocked.
3. [ ] Decide whether this is a hard cutover (one edit, one day) or a
   phased tightening — record whichever it is here, at the time M-018
   lands and this actually gets executed.

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
- 2026-07-29 — All three open questions answered directly by Chris (see
  Decisions section above). Cleared `needs-refinement`, set
  `blocked_by: M-018` to make the trigger condition a real fleet
  dependency rather than just prose. Not yet actionable — M-015 through
  M-018 (the wipe-and-rebuild-from-scratch chain) haven't started.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Fully scoped, not started — genuinely blocked on M-018 landing (which
itself is blocked on M-017, M-016, M-015 in sequence, none started). When
M-018 closes, come back here and execute plan items 2-3 using the
Decisions section above as the spec — don't re-litigate the three
questions, they're answered.
