---
id: M-017
title: "Task 7.3: Wipe and rebuild the machine from scratch"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: M-018
blocked_by: M-016
status: null
related_cards: [M-015, M-016, M-018]
---

# M-017 — Wipe and rebuild the machine from scratch

## Context

Ported from README.md §8 Phase 7, Task 7.3 (2026-07-26). Third card in the
7.1→7.4 chain. Wipe and rebuild the machine from scratch, using **only this
repo** (fresh NixOS install per README Section 8 Phase 2's own
bootstrapping notes, `nixos-rebuild switch --flake`, `docker compose up
-d`) — no manual fixes, no "oh right, I also need to..." steps. This is the
actual test of [[M-015]]/[[M-016]]'s completeness, not a formality.

**This is a hard-stop-style task per README's own explicit callout**:
actually wiping the production machine is exactly the kind of destructive,
high-blast-radius action that needs explicit user confirmation before
execution — not something to do autonomously as part of the standing
optimization-loop work. This task specifically requires Chris's direct
go-ahead immediately before it happens, even though the audit/fix work in
[[M-015]]/[[M-016]] can proceed without that gate. This aligns with
`AGENTS.md` §7's hard-stop list (destructive actions require explicit
confirmation, no exceptions).

## Plan
<!-- ordered checklist -->
1. [ ] Get Chris's explicit go-ahead immediately before wiping — do not
   treat prior autonomous-work grants as covering this.
2. [ ] Fresh NixOS install per README Section 8 Phase 2's bootstrapping
   notes.
3. [ ] `nixos-rebuild switch --flake`.
4. [ ] `docker compose up -d`.
5. [ ] Confirm zero manual fixes or undocumented steps were needed —
   this is the actual test of [[M-015]]/[[M-016]]'s completeness.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 7, Task 7.3 into a fleet
  card during the fleet-bootstrap backlog migration; `blocked_by` [[M-016]]
  since the audit/fix pass needs to be clean first; flagged explicitly as a
  hard-stop task requiring Chris's direct confirmation immediately before
  execution, per README's own callout and `AGENTS.md` §7.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Blocked on [[M-016]]. When unblocked, do not proceed without
getting Chris's explicit go-ahead first — this is a genuine hard stop, not
a routine judgment call.
