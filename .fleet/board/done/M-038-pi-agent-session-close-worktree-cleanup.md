---
id: M-038
title: pi-agent session close lifecycle + worktree/branch cleanup cascade
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-037
status: null
related_cards: [M-035, M-036, M-037]
---

# M-038 — pi-agent session close lifecycle + worktree/branch cleanup cascade

## Context
Design decided in M-035 (read that card's Decision log first). This card
implements the cleanup/lifecycle side: today the supervisor has no delete
concept at all (only create/list/get/sendMessage/stop/resume exist, per
`pi-agent/supervisor/src/supervisor.ts` — stopped sessions and their
`sessionDir` are kept forever). Blocked on M-037 since there's nothing to
clean up (no worktrees) until sessions actually have project-scoped
workdirs. Filed straight to backlog per explicit request — don't start
without a fresh human go-ahead.

Key facts from M-035 this card must honor — a cascading confirm modeled
directly on Claude Code's own "keep or remove this worktree?" prompt, with
two distinct triggers sharing the same three questions but **opposite
defaults**:
- **Stop** (existing action, ends the live pi process, session stays
  resumable): cascade defaults to **keep** the worktree.
- **Close** (new action introduced by this card): cascade defaults to
  **remove** the worktree, **and** remove both git artifacts (delete the
  branch locally, and delete it from the remote too).

Cascade shape (both triggers, only the pre-selected defaults differ):
1. Keep or remove the worktree?
2. If removing: keep or delete the branch?
3. If deleting: also delete it from the remote?

Every step must be an explicit confirm surfaced to the caller (API/CLI/UI)
— never silently applied just because a default exists.

## Plan
1. [ ] Introduce the new "close" session action (doesn't exist today).
2. [ ] Implement the three-step cascading confirmation flow for both
   `stop` and `close`, sharing the same three questions with opposite
   defaults as described above.
3. [ ] Handle `close` on a session whose workdir was never a worktree
   (empty-init mode) — the worktree/branch questions don't apply; just
   remove the working directory itself (with its own explicit confirm)
   and the session's own storage tree.
4. [ ] Wire real `git worktree remove` / `git branch -d` /
   `git push origin --delete <branch>` calls with real error handling
   (e.g. worktree has uncommitted changes, no remote configured, remote
   unreachable) — verify actual git behavior/error messages live, not
   assumed from documentation.

## Signals

## Decision log
- Closed as moot without implementation (2026-07-31, Chris's explicit
  direction: "Any backlog cards around pi-agent-supervisor can be
  discarded"). `pi-agent-supervisor` (the service this whole projects
  design was built for) was fully decommissioned in favor of `pi-web` —
  see `.fleet/board/done/M-037-decommission-pi-agent-supervisor.md` (the
  real M-037; a numbering collision with this design work's own now-moot
  M-037 card was found and resolved separately, see M-037.1's decision
  log).

## Handoff notes
