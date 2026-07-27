---
id: M-015
title: "Task 7.1: Full audit — everything on the machine cross-referenced against this git repo"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: M-016
blocked_by: null
status: null
related_cards: [M-016, M-017, M-018]
---

# M-015 — Full audit: everything on the machine cross-referenced against this git repo

## Context

Ported from README.md §8 Phase 7 (requested 2026-07-23), Task 7.1
(2026-07-26). Phase 7's objective: prove the whole machine is genuinely,
fully reproducible from this repo alone — not just mostly declarative, but
actually wipeable and rebuildable with zero manual steps left implicit
anywhere. This was the stated end goal from early in the project ("wipe the
machine, reinstall fresh, ensure it's able to 100% bootstrap") — this phase
is where that gets verified for real, not assumed. Tasks 7.1-7.4 are
sequential/dependent (see `blocks`/`blocked_by` chain across
[[M-015]]→[[M-016]]→[[M-017]]→[[M-018]]).

Go through the session history systematically: every
`configuration.nix`/`docker-compose.yml`/script change, every manual
`docker exec`/`ssh` command that changed live state, every model download,
every credential generated, every ad-hoc fix applied directly on the box.
For each, confirm it's either (a) fully captured declaratively in a
committed file, (b) captured as a documented manual step (e.g. Open WebUI's
first-signup, which genuinely can't be automated per earlier research), or
(c) flag it as a real gap — something that happened on the machine but
isn't reproducible from the repo alone.

**Known candidates to check carefully** given this project's session
history: the swap-in test containers (`vllm-bench-swap` and its many
variants) never touched `docker-compose.yml` and shouldn't need to —
confirm nothing from those experiments leaked into persistent state; the
temporary NOPASSWD sudo rule added and reverted for the firewall
investigation — confirm it's truly gone from both the repo and the live
`/etc/sudoers`; LiteLLM virtual keys (chris's, and Drew's once created) —
these live in Postgres, not in any file, so confirm the *mechanism* to
regenerate them is documented (it is: `/key/generate` API) even though the
specific key values aren't and shouldn't be committed; the orphaned FP8
model file and any other stray downloads (see also [[M-009]] — already
re-checked as stale/cleaned up during this porting pass).

## Plan
<!-- ordered checklist -->
1. [ ] Systematically go through session history: every config/compose/
   script change, every manual `docker exec`/`ssh` state change, every
   model download, every credential generated, every ad-hoc on-box fix.
2. [ ] For each, classify as (a) fully captured declaratively, (b)
   documented manual step, or (c) real gap.
3. [ ] Specifically verify the known candidates listed in Context (swap-in
   test containers, the reverted NOPASSWD sudo rule, LiteLLM virtual key
   regeneration mechanism, stray downloads).
4. [ ] Produce the gap list that [[M-016]] (Task 7.2) will fix.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 7, Task 7.1 into a fleet
  card during the fleet-bootstrap backlog migration; sequenced first in the
  7.1→7.4 chain via `blocks`/`blocked_by`, matching the M-001/M-002 pattern.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. This is the first card in the Phase 7 chain — [[M-016]]
(fixing gaps) can't start until this audit produces a real gap list.
