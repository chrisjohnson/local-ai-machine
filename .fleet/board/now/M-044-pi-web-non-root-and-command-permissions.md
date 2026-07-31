---
id: M-044
title: pi-web non-root user + pi command/tool permission model
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T18:20:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-039]
---

# M-044 — pi-web non-root user + pi command/tool permission model

## Context
Surfaced directly out of the M-039 SSH fix: pi-web runs as root (no `USER`
directive, `$HOME=/root`) purely because every service in this compose file
happens to default to root, not because it was ever confirmed to need root.
Chris's question: does it actually need root, or can it run as a matched
non-root uid (like turnstone already does, uid 1000 = chris, which is why
turnstone's SSH key mount just works without any of the `/root/.ssh`
confusion pi-web just hit)?

Second, related thread: Chris wants to understand/control what commands pi
(and models running through it) can actually execute — right now nothing in
this stack scopes that beyond whatever pi's own defaults are. Two separate
concerns bundled into one card because they're both "what is pi-web actually
allowed to do, and is that intentional or just default sprawl."

## Plan
1. [ ] Research: does pi-web's Dockerfile/entrypoint (`npm install` into
   `$PI_CODING_AGENT_DIR/npm` at runtime, port 30141 binding, `/data` volume
   writes) actually require root, or would a matched non-root uid (1000,
   mirroring turnstone's own already-working pattern) work? Check file
   ownership on all mounted volumes (`pi-web-data`, `/home/chris`,
   `/home/chris/.ssh/*`) against a non-root candidate uid.
2. [ ] If non-root is viable: switch pi-web to a matched uid/gid, retarget
   the SSH key mount back to that user's real `$HOME/.ssh` (same fix
   pattern as M-039, just for the right home dir this time), verify a real
   `git push`/`gh pr create` end to end from inside a pi-web session.
3. [ ] Research: what mechanism(s) does pi itself expose for scoping which
   shell commands / tools a session (or a specific model) can run without
   asking — allowlist/denylist config, `settings.json` permission fields,
   per-tool gating (the `pi-claude-bridge` `MODE_DISALLOWED_TOOLS` pattern
   is one example already in this repo, but that's bridge-specific, not
   pi-core). Confirm from pi's own source/docs, not assumption.
4. [ ] Write up what's actually configurable today vs. what would need new
   work, so Chris can decide whether/how to restrict command access —
   this card covers research + a design writeup, not necessarily a full
   implementation (split into a follow-on card if the fix is nontrivial).

## Signals
<!-- signal: claude 2026-07-31T18:20Z — claiming, starting with root-requirement research -->

## Decision log
- Card created directly from a live root-cause finding (M-039's SSH fix),
  not speculative — root-vs-non-root was never actually evaluated when
  pi-web was first deployed, it just inherited the rest of this compose
  file's default.

## Handoff notes
Not started yet. Two independent research threads (root requirement,
command permission model) — fine to parallelize across sub-agents per
AGENTS.md §2, but this card owns both until it's clear whether they split
into separate follow-on cards.
