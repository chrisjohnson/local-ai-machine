---
id: M-036
title: pi-agent project registry + growable per-project config schema
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
related_cards: [M-035, M-037, M-038]
---

# M-036 — pi-agent project registry + growable per-project config schema

## Context
Design decided in M-035 (read that card's Decision log before starting —
it captures the full grilled-out design conversation, including several
rejected alternatives worth not re-litigating). This card implements the
project side of it: the registry and per-project config file. `M-037`
implements the session side (binding a session to a project, restructuring
session storage). Don't start either without a fresh human go-ahead — both
were filed straight to backlog per explicit request, not promoted to now/.

Key facts from M-035 this card must honor:
- Container filesystem access (which host paths are reachable) is a
  container-definition concern, not this registry's — the registry only
  stores a pointer to wherever a project's repo already lives inside
  whatever mount the container definition provides. pi-agent never clones
  or creates a project's repo dir itself.
- Project config lives centrally at
  `/workspace/projects/<project-name>/config.yaml` — NOT inside the
  project's own repo checkout (rejected: git-tracked/untracked config
  inside the repo goes ambiguous the moment multiple worktrees exist on
  different branches).
- Registry shape is a thin cross-project index (project name → confirmed
  to exist under `/workspace/projects/<name>/`) plus one config file per
  project — not one growing shared JSON blob.
- `PI_AGENT_DATA_DIR`/`PI_AGENT_WORKDIR` are confirmed to be this
  project's own invention, not a pi-native contract (only
  `PI_CODING_AGENT_DIR` is pi's real env var) — free to restructure.

## Plan
1. [ ] Design the slimmed cross-project index (survives under
   `PI_AGENT_DATA_DIR`, now holding only the project registry + a
   cross-project session listing per M-035 point 10 — session-listing
   half is M-037's concern, but the index structure itself is shared).
2. [ ] Implement `/workspace/projects/<name>/config.yaml` read/write
   (create-on-register, update-in-place, temp-write+rename crash safety
   matching `manifest.ts`'s existing pattern). Minimum fields: pointer to
   the project's real repo path on the container's filesystem, default
   session init mode (`empty`|`worktree`). Resolve the actual growability
   mechanism (versioned schema field vs. open passthrough map vs.
   something else) — M-035 deliberately left this open.
3. [ ] Project registration surface: CLI or API endpoint to register a
   project by name + host repo path.
4. [ ] Decide + document project naming rules (uniqueness, directory-safe
   slug, rename semantics) — unresolved in M-035, project name is the
   literal directory segment so renaming implies moving the whole tree.
5. [ ] Decide fallback behavior when a project's default init mode is
   `worktree` but its repo path isn't actually a git repo — unresolved in
   M-035.

## Signals

## Decision log

## Handoff notes
