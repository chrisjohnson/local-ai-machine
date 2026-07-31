---
id: M-035
title: Plan + research "projects" for pi-agent (project dirs, session workdirs, worktree-vs-empty init, growable YAML config)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T03:26Z
blocks: null
blocked_by: null
status: null
related_cards: [M-030, M-031, M-032, M-033, M-034]
---

# M-035 — Plan + research "projects" for pi-agent

## Context
Confirmed by reading the current supervisor source (`pi-agent/supervisor/src/{types,supervisor,manifest,server}.ts`,
built in M-031): there is no project concept today. Every session is an
anonymous "workstream" with only two things persisted about it — pi's own
`sessionDir` (`--session-dir`, pi's bookkeeping) and a single **global**
`config.workDir` (`PI_AGENT_WORKDIR`, default `/workspace`) shared across
*every* session on the box. There is no per-session working directory, no
notion of which repo a session is "for", and no config file of any kind
beyond the flat `manifest.json` (session id → status/timestamps only,
write-temp-then-rename, deliberately not sqlite per M-031's decision log).

Chris wants to add a "projects" layer on top of this, scoped by him as
follows (captured verbatim from the request, not to be silently reinterpreted):
- Sessions attach to a project; **project is a required field on a session**.
- Projects have a **project dir** — typically the main git clone of a repo.
- Sessions have their own **working dir**, separate from the project dir, but
  a session can **read from** its project dir.
- A session's working dir can be initialized two ways: **empty**, or as a
  **git worktree of the project dir**. Projects can set a **default** for
  which mode new sessions use.
- Both projects and sessions should assume **complex YAML configuration
  from the start** — i.e. the schema should be designed to grow over time,
  not a minimal flat shape bolted on later.
- Config for a project or session is **not** stored inside that project's
  work dir or that session's working dir — it lives in a **separate
  location**, one file per project and one file per session, updated in
  place as settings change.

This card is **plan + research only** — no implementation. The output is a
concrete design (schema, file layout, lifecycle, migration path, open
questions) written into this card, stress-tested with Chris directly before
any follow-on implementation card is created. Given the scope (this changes
the core session model that M-031/M-032/M-033 already shipped and Chris is
using daily), get the shape right before writing code.

## Plan
1. [ ] Re-confirm every current touchpoint that assumes a single global
   `workDir` (`supervisor.ts` `SupervisorConfig.workDir`, `spawnFor`'s
   `cwd: this.config.workDir`, `docker-compose.yml`/`Dockerfile` env vars,
   the `/workspace` bind mounts documented in M-031's post-done notes) so
   the design's migration section is grounded in what actually has to
   change, not assumed.
2. [ ] Research git worktree mechanics for the "session workdir = worktree
   of project dir" mode: creating one on demand, which branch/ref it starts
   from, cleanup on session deletion (`git worktree remove` vs. orphaned
   worktrees), what happens if the project dir itself is mid-rebase/dirty,
   and whether concurrent sessions can worktree the same branch.
3. [ ] Draft the project YAML schema: required fields (id/name, project
   dir path, default session-workdir-init-mode) plus explicit room to grow
   (versioned schema? reserved/open `extra:` map? both?).
4. [ ] Draft the session YAML schema: required project reference, resolved
   working dir path, workdir-init-mode (with project-default + explicit
   override), plus the same growability treatment as the project schema.
5. [ ] Design the config storage location and per-file lifecycle: where
   project/session config files live (distinct from `PI_AGENT_DATA_DIR`'s
   existing `manifest.json`+`sessions/<id>/` layout, distinct from any
   project dir or session workdir), naming convention, and the
   read-modify-write pattern (mirror `manifest.ts`'s temp-write+rename
   crash safety, or something else — decide and justify).
6. [ ] Design the project/session API and CLI surface: create/list/update
   a project, and how session creation both requires and resolves a
   project (reject vs. default behavior for a session request with no
   project).
7. [ ] Decide the migration story for sessions that exist today (global
   shared `/workspace`, no project). Per repo convention (no
   backwards-compat shims for internal tools), default answer is a clean
   break — confirm that's acceptable here or if existing live sessions
   need an explicit one-time migration step.
8. [ ] Write the final design into this card (Decision log + Handoff
   notes): concrete YAML examples for both schemas, file layout, and a
   list of follow-up implementation cards to file once the design is
   confirmed.

## Signals
<!-- signal: claude 2026-07-31T03:26Z — claiming, starting design conversation with Chris before writing anything down as final -->

## Decision log

## Handoff notes
