---
id: M-014
title: "Task 6.5: Execute backup mirror test"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-014 — Execute Backup Mirror Test

## Context

Ported from README.md §8 Phase 6, Task 6.5 (was 4.1) (2026-07-26). Run
`scripts/sync-backup.sh` (or `systemctl start synology-backup.service`) and
verify files land under `tank/backups/local-ai-machine/` on the Synology,
including the new `hermes/` and `herdr/` paths. Confirm DSM's Btrfs snapshot
schedule is enabled on the `tank` share for point-in-time recovery.

## Plan
<!-- ordered checklist -->
1. [ ] Run `scripts/sync-backup.sh` or `systemctl start
   synology-backup.service`.
2. [ ] Verify files land under `tank/backups/local-ai-machine/` on the
   Synology, including `hermes/` and `herdr/` paths specifically.
3. [ ] Confirm DSM's Btrfs snapshot schedule is enabled on the `tank` share.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 6, Task 6.5 into a fleet
  card during the fleet-bootstrap backlog migration.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started.
