---
id: M-078
title: Human review — judgment calls made during the 2026-08-04 evening autonomous session
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-071, M-072, M-075, M-076, M-077, M-068]
---

# M-078 — Human review — judgment calls made during the 2026-08-04 evening autonomous session

## Context
Chris, 2026-08-04 ~21:25: "Keep making progress on everything planned for this work
[...] Don't stop to ask questions, if you need to make a decision make the one that
makes the most sense and then record a new ticket blocked on human review about
reviewing the tickets (place in now)." He's stepping away for the evening, not using
the machine, and granted standing authorization for this session to: merge PRs in
`printer-dashboard` or `local-ai-machine` as needed, deploy/restart live services as
needed, and make judgment calls without pausing to ask — all provided everything stays
git-driven (no direct/hand edits except temporary local testing, cleaned up and
re-deployed via git afterward).

This card is **not blocked on another card** — it's a running log, kept open and
appended to as the session progresses, of every consequential judgment call, deploy,
merge, or design decision made without Chris's real-time input. Its purpose is to make
review cheap when he's back: read this one card, not every card's full decision log.
Each entry below cross-references the card where the full reasoning/evidence lives.

**Chris: start here.** Skim the entries below in order; each links to the card with
full detail if you want to dig in. Nothing below was silently done — every card this
references has its own complete decision log, this is just the index of what most
needs your eyes.

## Log (append-only, newest last, one entry per consequential call)

- 2026-08-04T21:28Z — card filed, session continuing per Chris's standing grant.
- 2026-08-04T22:10Z — **M-071 done** (git-worktree-per-run, pi-web Project
  registration, real session deep-links). Two judgment calls worth a look: (1)
  worktree location — nested inside the project's own checkout rather than a true
  sibling directory, forced by a real container-topology constraint (only one bind
  mount per project) — see M-071's decision log for the verification trail. (2)
  Cleanup policy — worktrees are kept forever after a run, never auto-removed
  (reasoning: post-hoc inspectability matters more than tidiness at today's
  manual-trigger volume) — this means `<project>/.pi-web-factory-worktrees/` will
  grow unbounded over time with no sweep yet built. Worth confirming you're fine
  with that tradeoff before volume increases.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T21:28Z — filed, session continuing autonomously -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): filed per Chris's explicit instruction, placed directly in
  `now/` (his own instruction, not the usual human-request-promotes-to-now/ default —
  same effect either way here).

## Handoff notes
Read the Log section above first. This card should stay open (not moved to `done/`)
until Chris has actually reviewed it — closing it is his call, not something to do
automatically when the session's work is finished.
