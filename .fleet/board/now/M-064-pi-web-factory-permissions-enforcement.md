---
id: M-064
title: pi-web-factory — permissions.ts (writes:/protected_files enforcement)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-061, M-062, M-063, M-065, M-066, M-067, M-068]
---

# M-064 — pi-web-factory — permissions.ts (writes:/protected_files enforcement)

## Context
Ports SSSF's `adw_modules/permissions.py`. SSSF's own hard rule #9 (`SKILL.md`):
`tools:` is a capability list, `writes:` is the boundary — a tool list (e.g. `bash`)
can never make "this agent changes nothing" true by itself, so enforcement has to be a
before/after repo-diff check, done in code, after every call. Unauthorized changes get
rolled back and the phase fails.

This is inherently `cwd`-scoped (diff the target project's working tree, not
pi-web-factory's own directory), which is actually a clean fit for the multi-project
design — no changes needed to the core diff logic itself versus SSSF's version, only to
how the target path is threaded in (from the `WorkItem`'s `project` field, per design
doc §3.4, rather than an implicit "current repo" assumption).

## Plan
1. [ ] `modules/permissions.ts`: snapshot repo state (git status/diff) before a phase's
   agent call, diff again after.
2. [ ] Compare changed paths against that agent's `writes:` allowlist (from
   `factory.config.yaml`'s roster, M-065) and the global `protected_files` list.
3. [ ] On violation: roll back the unauthorized change (`git checkout -- <path>` /
   remove untracked files it shouldn't have created) and fail the phase with a specific
   violation, not a generic error.
4. [ ] Test against a real scratch git repo (not the target project) with a fake agent
   turn that writes both an allowed and a disallowed path — confirm only the
   disallowed one gets reverted.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
