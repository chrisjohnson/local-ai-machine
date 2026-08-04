---
id: M-071
title: pi-web-factory — git-worktree sessions, pi-web Project registration, real deep-links
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-062, M-066, M-067, M-070]
---

# M-071 — pi-web-factory — git-worktree sessions, pi-web Project registration, real deep-links

## Context
Chris's feedback 2026-08-04: lean into pi-web's own Workspace primitive to organize
pi-web-factory's sessions, and print a working link to a run's session rather than
just its bare id (`pi-web-adw-design.md` §6.1 points 3–4, §6.2, §6.3).

**Researched, both findings load-bearing:**
- Pi-web has **no workspace-creation API** — `WorkspaceService.list()` only
  *discovers* real `git worktree list` output, explicitly read-only. There is nothing
  to call; pi-web-factory has to create worktrees itself via plain `git worktree add`
  and point a session's `cwd` at the resulting path. Pi-web's own UI then picks the
  worktree up automatically, with zero coordination needed beyond that.
- A working session deep-link is **`http://<host>:<port>/?project=<projectId>&
  workspace=<workspaceId>&session=<sessionId>`** — confirmed from the client router
  (`route.ts`, `PiWebApp.ts`) that `session` alone does nothing; `project` is read
  first and short-circuits if absent. Printing a real link therefore requires
  registering the target repo as a pi-web Project (`POST /projects`, once,
  idempotently) purely to obtain a `projectId` — a different reason than M-070's
  config question, which correctly ruled pi-web's Project concept out for config.

This also happens to close a design gap flagged since the very first pass of this
design doc (§0/§4): no branch-per-run isolation. Worktree-per-run (or whatever
sharding Chris picks, see below) gets that for free.

**Open question, Chris's call, not decided by this card:** worktree sharding scheme —
one worktree per chain run (max isolation, needs a cleanup policy), one shared
worktree per project reused across runs (simpler, no cleanup, but runs can collide),
or per chain-type. Ask before implementing step 2 below; everything else can proceed
regardless of the answer.

## Plan
1. [ ] `modules/piwebProject.ts` (or fold into `config.ts` — implementer's call):
   idempotent `ensureProjectRegistered(baseUrl, path)` — `GET /projects`, find by
   path, `POST /projects` if absent, return the `projectId`. Called once per chain
   run (or cached) — cheap, no reason to make it a separate manual setup step.
2. [ ] Worktree creation: a small module wrapping `git worktree add <path> [-b
   <branch>]` for whatever sharding scheme Chris picks, returning the real filesystem
   path to use as `cwd`. Naming convention for the worktree directory/branch itself
   still needs deciding — propose one, don't block on it.
3. [ ] Resolve the `workspaceId` pi-web's `WorkspaceService` assigns to a newly
   `git worktree add`-created path (a `GET` route — the exact one wasn't pinned down
   in research, trace it: likely under `/projects/:id/workspaces` or similar,
   check `workspaceService.ts`'s route registration directly).
4. [ ] `cli.ts`: after starting a session, resolve/print the full working deep-link
   (`?project=...&workspace=...&session=...`), not just the bare `sessionId` — this
   replaces the placeholder "visible in pi-web's own session picker" line from M-067.
5. [ ] Live end-to-end verification: run a real chain, click (or curl) the printed
   link, confirm it actually opens the right session in the browser — don't just
   trust the URL is well-formed.
6. [ ] Cleanup policy for created worktrees, matching whatever sharding scheme was
   chosen — if per-run, decide when a worktree gets removed (`git worktree remove`)
   and make sure it doesn't fight `permissions.ts`'s own repo-diffing (a worktree
   being removed out from under an in-flight diff would be a real bug to avoid).

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
