---
id: M-071
title: pi-web-factory — git-worktree sessions, pi-web Project registration, real deep-links
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T21:23:44Z
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

**Resolved 2026-08-04**: one worktree per Workflow Run (max isolation — closes the
long-standing "no branch-per-run isolation" gap directly). Chris's explicit choice via
AskUserQuestion, also recorded in `pi-web-adw-design.md` §6.4. Cleanup policy (item 6
below) is still this card's job to design.

## Plan
1. [x] `modules/piwebProject.ts` (or fold into `config.ts` — implementer's call):
   idempotent `ensureProjectRegistered(baseUrl, path)` — `GET /projects`, find by
   path, `POST /projects` if absent, return the `projectId`. Called once per chain
   run (or cached) — cheap, no reason to make it a separate manual setup step.
2. [x] Worktree creation: a small module wrapping `git worktree add <path> [-b
   <branch>]` for whatever sharding scheme Chris picks, returning the real filesystem
   path to use as `cwd`. Naming convention for the worktree directory/branch itself
   still needs deciding — propose one, don't block on it.
3. [x] Resolve the `workspaceId` pi-web's `WorkspaceService` assigns to a newly
   `git worktree add`-created path (a `GET` route — the exact one wasn't pinned down
   in research, trace it: likely under `/projects/:id/workspaces` or similar,
   check `workspaceService.ts`'s route registration directly).
4. [x] `cli.ts`: after starting a session, resolve/print the full working deep-link
   (`?project=...&workspace=...&session=...`), not just the bare `sessionId` — this
   replaces the placeholder "visible in pi-web's own session picker" line from M-067.
5. [x] Live end-to-end verification: run a real chain, click (or curl) the printed
   link, confirm it actually opens the right session in the browser — don't just
   trust the URL is well-formed.
6. [x] Cleanup policy for created worktrees, matching whatever sharding scheme was
   chosen — if per-run, decide when a worktree gets removed (`git worktree remove`)
   and make sure it doesn't fight `permissions.ts`'s own repo-diffing (a worktree
   being removed out from under an in-flight diff would be a real bug to avoid).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T21:23Z — claiming, starting project registration + worktree-per-run -->
<!-- signal: claude 2026-08-04T22:10Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): worktree location — nested at `<project>/.pi-web-factory-
  worktrees/<adwId>/`, not a true sibling directory — decided from a verified
  container-topology constraint (the `jmfederico-pi-web` container bind-mounts
  exactly one path per project; a sibling directory outside that mount would be
  unreachable), not a style preference. `.git/info/exclude` (never `.gitignore`)
  keeps the subdirectory invisible to `permissions.ts`'s own snapshot queries,
  confirmed live so an untouched worktree never gets misread as an unauthorized
  write and rolled back.
- 2026-08-04 (claude): cleanup policy — worktrees are kept after a run, on any
  outcome, never auto-removed. Reasoning: post-hoc inspectability (trace db, session
  transcript, and now the worktree's own on-disk state/git history) matters more
  than tidiness at today's manual-trigger, low-volume usage; auto-removal would
  destroy exactly the evidence a `blocked-on-human` outcome exists to let a human
  look at. `removeRunWorktree` is built/tested for a future explicit sweep tool, not
  wired into any current chain.
- 2026-08-04 (claude): resolved the workspace-lookup route research had left open —
  `GET /projects/:id/workspaces`, confirmed against both source and the live server.
- 2026-08-04 (claude): verified independently before committing — reran the full
  suite myself (154 pass, including live integration tests) and `tsc --noEmit`
  (clean), read all four new/changed core files in full, and independently confirmed
  no leftover scratch state (only the two expected long-lived projects — `/work`,
  `/tmp` — remain registered; no stray worktree directories found).

## Handoff notes
`ensureProjectRegistered`/`resolveWorkspaceId` (`piwebProject.ts`) and
`createRunWorktree`/`resolveMainCheckoutPath` (`worktree.ts`) are the pieces M-076's
generic Workflow interpreter should reuse directly rather than reimplementing —
`chains/planBuildTest.ts`'s wiring (register project → create worktree → resolve
workspace → run phases against the worktree's `cwd`) is the reference pattern.
`removeRunWorktree` exists, tested, unused — a future cleanup-sweep card can pick it
up without building it from scratch.
