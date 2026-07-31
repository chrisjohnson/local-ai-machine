---
id: M-035
title: Plan + research "projects" for pi-agent (project dirs, session workdirs, worktree-vs-empty init, growable YAML config)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-030, M-031, M-032, M-033, M-034, M-036, M-037, M-038]
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
<!-- signal: claude 2026-07-31T04:10Z — design conversation complete, recorded final decisions, spinning off M-036/M-037/M-038, demoting all to backlog per Chris's request; not implementing -->

## Decision log
Design conversation held directly with Chris (grilled one decision at a time,
recommendation offered each time, several answers corrected/refined an
earlier framing — captured as final below, not the interim wrong turns).

1. **Container filesystem access is a container-definition concern, not the
   project registry's.** Which host paths a project dir can reach is decided
   entirely by how the pi-agent container/compose service is defined (e.g.
   Chris's stated intent: `docker run -v /home/chris:/chris`, mounting his
   whole home dir). The project registry only ever stores a *pointer* to
   wherever a project's repo already lives inside that mount — pi-agent
   itself never clones or creates a project's repo dir.
2. **Project config is centralized, not inside the project's own repo.**
   Rejected storing it inside the project dir (git-tracked or untracked) —
   branch/worktree divergence would make "the project's config" ambiguous
   the moment two worktrees exist on different branches. Final: one
   `config.yaml` per project, living under pi-agent's own data tree at
   `/workspace/projects/<project-name>/config.yaml` — centrally located,
   part of the agent framework, not the individual repo.
3. **Registry granularity: thin index + one file per entity**, not one
   growing shared JSON blob (rejected extending `manifest.json`'s
   per-record shape to carry rich nested config directly). Each project and
   session gets its own file that's updated in place as settings change;
   a separate small index exists purely for fast cross-entity listing.
4. **Session-workdir-vs-project-dir separation is a convention, not an
   enforced OS-level boundary, for now.** Given the container already gets
   broad host access (whole home dir, `docker.sock`, SSH/GH creds per
   M-031), enforcing read-only isolation at just this one boundary would be
   inconsistent effort for little real security gain. Explicitly deferred,
   not rejected — "circle back to that boundary later."
5. **Worktree-mode sessions get a new branch per session**, namespaced and
   derived from the session's uuid (e.g. `pi-agent/session/<uuid>`),
   branched from the project repo's current HEAD at session-creation time.
   This is what makes concurrent sessions on one project collision-free by
   default (git refuses two worktrees on the same branch simultaneously).
6. **Session close/cleanup is a cascading confirm, modeled directly on
   Claude Code's own "keep or remove this worktree?" prompt**, with two
   distinct triggers sharing the same three questions but opposite
   defaults:
   - **Stop** (existing action — ends the live pi process, session stays
     resumable): cascade defaults to **keep** the worktree.
   - **Close/delete** (new action — does not exist in the supervisor today;
     only create/list/get/sendMessage/stop/resume exist currently): cascade
     defaults to **remove** the worktree, **and** remove both git artifacts
     (delete the branch locally, and delete it from the remote too).
   Cascade shape (both triggers): (1) keep or remove the worktree? (2) if
   removing, keep or delete the branch? (3) if deleting, also delete from
   the remote? Every step is an explicit confirm surfaced to the caller —
   never silently applied — only the pre-selected default differs by
   trigger.
7. **On-disk layout, final** (corrected twice during design — first from
   "split by init mode" to "one uniform per-session path regardless of
   mode," then from "workdir and session-dir consolidated into one
   directory" to "siblings under the same session path"):
   ```
   /workspace/projects/<project-name>/
     config.yaml                # repo path pointer, default init mode, open for growth
     sessions/
       <session-uuid>/
         workdir/                # empty dir, or `git worktree add` of the project repo - same
                                  # path either way; the only difference between "empty" and
                                  # "worktree" init mode is whether a worktree gets created inside it
         session-dir/             # pi's own --session-dir bookkeeping (transcript/session file),
                                  # relocated here from today's flat PI_AGENT_DATA_DIR/sessions/<uuid>
   ```
8. **Session ids stay globally-unique UUIDs** (today's existing scheme) —
   explicitly NOT switched to per-project sequential numbers, to avoid
   restructuring the API's addressing scheme (`/api/sessions/:id` today)
   and avoid "session 1" ambiguity anywhere an id is referenced outside a
   project-qualified context. They're just nested under the owning
   project's directory now instead of a flat global `sessions/` dir.
9. **Confirmed by reading the actual source**: `PI_AGENT_DATA_DIR` and
   `PI_AGENT_WORKDIR` are entirely our own invention (`pi-agent/supervisor/
   Dockerfile:76,94`, `server.ts:19,35`) — not a contract with pi itself.
   The only pi-native env var anywhere in this system is
   `PI_CODING_AGENT_DIR` (confirmed against pi's own
   `environment-variables.md` back in M-030/M-031). This means the entire
   per-session storage layout above is free to restructure with zero risk
   to pi's own contract.
10. **A slimmed cross-project index survives** outside the per-project tree
    (keep the name `PI_AGENT_DATA_DIR`, now holding only: the project
    registry — name → confirmed to exist under `/workspace/projects/<name>/`
    — and a cross-project session listing for "list everything" without a
    full filesystem walk). Deriving this purely from scanning the
    filesystem was explicitly rejected: session status/timestamp/error
    state still needs somewhere to live that isn't a full directory walk on
    every list call.

**Explicitly unresolved / out of scope for this design pass** (flagged for
implementation cards to resolve, not silently decided here):
- Exact YAML schema growability mechanism (versioned schema field vs. open
  passthrough map vs. something else) beyond "must support growth."
- Project naming/slug rules and rename semantics (project name is the
  literal directory segment — collision/rename handling not discussed).
- Fallback behavior when a project's default init mode is "worktree" but
  its repo path isn't actually a git repo.
- Migration path for the two existing static-mount pseudo-projects
  (`printer-dashboard`, `local-ai-machine`, currently just fixed bind
  mounts per M-031) into the new registry.
- The enforced read-only boundary deferred in point 4 above.

**Final closure (2026-07-31, Chris's explicit direction):** "Any backlog
cards around pi-agent-supervisor can be discarded." `pi-agent-supervisor`
— the service this entire design was built for — was fully decommissioned
in favor of `pi-web` (see `.fleet/board/done/M-037-decommission-pi-agent-supervisor.md`,
the real M-037; this card's own follow-on M-037 collided with that id and
was renumbered to M-037.1, see its decision log). pi-web already ships
its own native project/session browser and git-worktree switcher,
covering the same ground this design was built to fill from scratch. This
card and its three follow-ons (M-036, M-037.1, M-038) are being closed as
moot, not implemented.

## Handoff notes
Design is final per Chris's direction to stop here and not implement yet.
Split into three follow-on implementation cards, filed directly to
backlog/ (not now/ — nothing is authorized to start):
- **M-036** — project registry + growable config schema (index, per-project
  `config.yaml`, registration surface, naming rules).
- **M-037** — session↔project binding + workdir restructuring (required
  project field, new on-disk layout, empty/worktree init modes,
  `supervisor.ts` plumbing changes, legacy-mount migration decision).
- **M-038** — session close lifecycle + worktree/branch cleanup cascade
  (new close action, the stop-vs-close cascading confirm flow, real git
  worktree/branch/remote-delete wiring).
This card (M-035) itself is being demoted to backlog alongside them per
explicit request — the design is captured here for whoever picks up
M-036/M-037/M-038 next, but nothing should be claimed/started without a
fresh human go-ahead per §4a.
