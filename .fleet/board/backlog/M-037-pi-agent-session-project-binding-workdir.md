---
id: M-037
title: pi-agent session↔project binding + per-session workdir/session-dir restructuring
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-036
status: needs-refinement
related_cards: [M-035, M-036, M-038]
---

# M-037 — pi-agent session↔project binding + workdir restructuring

## Context
Design decided in M-035 (read that card's Decision log first). This card
implements the session side of the projects design: making project a
required field on session creation, and moving per-session storage from
today's flat global layout into the new project-scoped tree. Blocked on
M-036 (project registry must exist to resolve a project reference
against). Filed straight to backlog per explicit request — don't start
without a fresh human go-ahead.

Today (confirmed by reading `pi-agent/supervisor/src/{supervisor,server}.ts`):
every session shares one single global `PI_AGENT_WORKDIR` (`/workspace`)
as `cwd`, and pi's own `--session-dir` bookkeeping lives under a flat
`PI_AGENT_DATA_DIR/sessions/<uuid>/`. There is no project concept at all
today — this card is what actually removes that gap.

Key facts from M-035 this card must honor:
- Final per-session layout:
  ```
  /workspace/projects/<project-name>/sessions/<session-uuid>/
    workdir/       # empty dir, or `git worktree add` of the project repo - same path either
                   # way; only difference between init modes is whether a worktree is created inside it
    session-dir/   # pi's own --session-dir bookkeeping, relocated here from the old flat location
  ```
- Session ids stay globally-unique UUIDs (NOT per-project sequential
  numbers) — just nested under the owning project's directory now.
- Worktree-mode sessions get a new branch per session, namespaced from the
  session uuid (e.g. `pi-agent/session/<uuid>`), branched from the
  project repo's current HEAD at creation time — this is what makes
  concurrent sessions on one project collision-free (git refuses two
  worktrees on the same branch simultaneously).
- Session-workdir-vs-project-dir separation is a convention only, not an
  enforced OS boundary, for now (explicitly deferred, see M-035 point 4) —
  don't build read-only mount enforcement as part of this card.

## Plan
1. [ ] Make `project` a required field on session creation; reject session
   creation with no project reference or an unresolvable project name
   (resolve against M-036's registry).
2. [ ] Relocate per-session storage to
   `/workspace/projects/<name>/sessions/<uuid>/{workdir,session-dir}` per
   the layout above.
3. [ ] Implement the two workdir init modes: empty (`mkdir`) vs.
   `git worktree add` on a new per-session branch — project's `config.yaml`
   default applies unless the session creation request overrides it.
4. [ ] Update `SupervisorConfig`/`spawnFor` (`supervisor.ts`) to use the
   new per-session `workdir`/`session-dir` paths instead of today's single
   global `workDir` + `PI_AGENT_DATA_DIR`-rooted `sessionDir`. Touches
   every place enumerated in M-035 (docker-compose/Dockerfile env vars,
   the `/workspace` bind mounts already documented in M-031's post-done
   notes).
5. [ ] Document the workdir-vs-project-dir convention clearly wherever a
   session is told about its project dir, since it's an informed
   convention rather than an enforced boundary.
6. [ ] Decide migration path for the two existing static-mount
   pseudo-projects (`printer-dashboard`, `local-ai-machine`, currently
   just fixed bind mounts per M-031) — become the first two registered
   projects, or left alone/unmigrated — unresolved in M-035.

## Signals

## Decision log

## Handoff notes
