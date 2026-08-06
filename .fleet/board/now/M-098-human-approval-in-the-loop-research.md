---
id: M-098
title: research + design human-approval-in-the-loop (git/PR handoff)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-098 — research + design human-approval-in-the-loop (git/PR handoff)

## Context
Chris's direct request, 2026-08-06 (verbatim): "One more ticket around where
human approval fits into the loop. The original SSSF had no opinions about
git PRs, it just did work. But we're working on a whole end to end including
durable ticket storage, we're ok to be more opinionated about what that looks
like and how it hands off. This ticket should be a research into what makes
sense and interactive refinement session with me to be sure it makes sense."

**This is explicitly NOT a delegated/autonomous implementation task.** Chris
was specific: research first, then an interactive design conversation with
him directly, before anything gets built or even firmly proposed. Do not
treat this like other cards where a sub-agent researches, decides, and files
a finished plan for review after the fact — the refinement step itself has to
happen live with Chris, not async.

Relevant existing surface area to ground the research in (read, don't
redesign yet):
- `PERMISSIONS-VIOLATION` / rollback handling (workflow.ts) — pi-web-factory
  already has automated gates that stop/roll back bad work; approval design
  should account for how it composes with these, not just bolt on top.
- `BLOCKED-ON-HUMAN` status + resumable `--session-id` (see M-076/skills docs)
  — the one human-in-the-loop mechanism that already exists today, mid-Step,
  for agent-asked questions. Worth understanding fully since a new
  approval-handoff design will likely want to reuse or sit alongside it
  rather than invent a second, parallel "ask the human" pathway.
- `.fleet` board's own human-gate pattern (AGENTS.md §4a: "nothing enters
  now/ without explicit human confirmation") — a DIFFERENT, already-proven
  approval pattern in the adjacent fleet-coordination layer. Worth knowing
  as a reference point (not necessarily the right shape for this), especially
  since Chris's own stated plan is to eventually graft fleet's kanban
  mechanics into this stack directly (see decision log,
  [[project_fleet_vs_pi_web_factory_boundary]]).
- Durable ticket storage — whatever's landed to date for tracking Workflow
  Runs/sessions durably; approval/handoff design should plug into that
  storage, not a side channel.

## Plan
1. [ ] Research phase (can proceed without Chris): survey how comparable
   systems handle human-approval gates for agent-driven code changes —
   PR-per-run vs. PR-per-approved-batch vs. no-PR-direct-commit-with-review-
   window, where in the Workflow a gate would sit (after every Step? only at
   the end? only on `review`/`test` failure?), and how that composes with
   the two existing human-touch points above (`BLOCKED-ON-HUMAN`,
   `PERMISSIONS-VIOLATION` rollback). Write up options with real tradeoffs,
   not a single pre-decided answer.
2. [ ] **Stop and hold an interactive session with Chris** before finalizing
   any design — walk through the research findings live, let him react and
   redirect, and only then converge on a shape.
3. [ ] Only after that session: write the actual design doc / follow-on
   implementation card(s).

## Signals

## Decision log
- 2026-08-06 (claude): filed directly from Chris's verbatim request.
  Deliberately left `claimed_by: null` — per his own framing this needs an
  interactive session with him, not an autonomous claim-and-run.

## Handoff notes
Do research (step 1) freely, but do not skip straight to a finished design —
Chris needs to be in the room for the refinement step before this converges.
