---
id: M-064
title: pi-web-factory — permissions.ts (writes:/protected_files enforcement)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T04:43:06Z
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
1. [x] `modules/permissions.ts`: snapshot repo state (git status/diff) before a phase's
   agent call, diff again after.
2. [x] Compare changed paths against that agent's `writes:` allowlist (from
   `factory.config.yaml`'s roster, M-065) and the global `protected_files` list.
3. [x] On violation: roll back the unauthorized change (`git checkout -- <path>` /
   remove untracked files it shouldn't have created) and fail the phase with a specific
   violation, not a generic error.
4. [x] Test against a real scratch git repo (not the target project) with a fake agent
   turn that writes both an allowed and a disallowed path — confirm only the
   disallowed one gets reverted.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:43Z — claiming, starting permissions.ts -->
<!-- signal: claude 2026-08-04T05:35Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): independently verified against upstream `permissions.py`
  (not just the implementing pass's citation) that `writes:` takes precedence over
  `protected_files` — naming a path explicitly is what unlocks it, confirmed at
  `permissions.py:127-135` and the `permitted()` docstring itself.
- 2026-08-04 (claude): caught and fixed a real doc inaccuracy in review — a comment
  justified skipping upstream's `always_writable(data_dir)` tier via "it's
  gitignored, same as upstream," which is backwards: upstream's own docstring
  explicitly rejects relying on gitignore for that exemption ("must not hang on a
  gitignore entry that someone can delete"). Corrected to the real reason: this
  port's session state lives entirely outside the target project's cwd (design doc
  §2), so there's no repo-local report directory needing the exemption in the first
  place — not an accidental gitignore-shaped coincidence.
- 2026-08-04 (claude): verified independently before committing — reran
  `tsc --noEmit` (clean) and the full non-live test suite myself (52 pass, 139
  expect() calls across permissions/envelopes/gates/tracer/piwebClient).

## Handoff notes
`enforceWrites(cwd, before, allowedWrites, protectedFiles)` is what M-066's chain
orchestration calls after each agent phase completes, with `before` from
`snapshotRepoState(cwd)` taken right before the phase's `prompt()` call. `allowedWrites`
and `protectedFiles` come from M-065's `factory.config.yaml` roster (`allowedWrites:
null` = unrestricted, matching upstream's `agent.writes is None`). `PermissionsResult
.clean === false` (a rollback itself failed) should hard-fail the phase in M-066, not
just log a violation.
