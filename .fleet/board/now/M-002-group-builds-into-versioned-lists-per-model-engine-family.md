---
id: M-002
title: Research + implement grouping builds into versioned lists (v1, v2, ...) within a single catalog file
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-001
status: null
related_cards: [M-001]
---

# M-002 — Group builds into versioned lists per model+engine family

## Context

Decided directly with Chris 2026-07-26, as a follow-up to [[M-001]]'s
two-tier catalog/compose split. Today, a config change to an existing build
(e.g. tuning `--max-num-batched-tokens`, enabling a fused-kernel flag) has no
established home — it either mutates the existing file in place (losing the
pre-change benchmark data's context) or spawns a whole new sibling file with
an incremented engine-recipe suffix (today's `-v1`/`-v2` convention is on the
*engine* id, e.g. `vllm-therock-gfx1151-v1`, not on the *build's own serving
config* — a different axis). Chris wants a real, first-class way to track a
specific model+engine build's config evolving over time, compare versions
directly, and flip back to an older version if a "optimization" turns out to
regress something.

**Target shape**: for a given (model, engine, any other major structural
difference) combination, there is **one catalog file**, containing a list of
**versions** (v1, v2, v3, ...) — each version is a distinct serving-config
iteration with its own `benchmark_runs: []` and its own
`docker-compose.yml` service entry (own fixed port, per [[M-001]]'s port
convention). This lets the comparison dashboard show a version-over-time
trend for one model+engine pair directly, not just a flat cross-model table.

This is explicitly a **research + implementation** card, not a fully-specified
one — several real design questions need answering before touching any files:

## Open questions to resolve as part of this card

1. **Version identity vs. file identity.** What's the top-level file `id`
   once a file holds multiple versions (today's `id` is per-build, e.g.
   `qwen3.6-35b-a3b--vllm-therock-gfx1151-v1` — the version suffix needs to
   move somewhere else). Proposal to evaluate: file id drops the version
   suffix (`qwen3.6-35b-a3b--vllm-therock-gfx1151`), each version entry
   inside carries its own `version: v1` / `version: v2` field and its own
   full `compose_service_id: qwen3.6-35b-a3b--vllm-therock-gfx1151-v1` (the
   actual `docker-compose.yml` join key, per [[M-001]]) — don't assume this
   is right without checking it doesn't collide with how the *engine*
   recipe's own versioning (`catalog/engines/*.yaml`, e.g.
   `llamacpp-vulkan-radv-v1`) is meant to compose with a *build's* version.
   These are two different, currently-conflated axes — sort out whether a
   build version bump implies anything about which engine-recipe version it
   references, or whether they're fully independent.
2. **What counts as "the same family" vs. a new file entirely?** The card
   title says "model+engine+any other major structural differences" — define
   what counts as a structural difference forcing a new file rather than a
   new version within the existing one (e.g. is a different quantization a
   new version of the same family, or a genuinely different family? Is a
   different context-length config — already an existing convention,
   `catalog/OPERATIONS.md`'s `--ctx<N>` suffix pattern — a version bump or
   its own family?). Get this taxonomy right before migrating data into it.
3. **Migration mechanics.** How do the 19 already-populated build files
   (post-[[M-001]] trim) map onto this new grouped structure? Some model+engine
   pairs have exactly one build today (trivial: becomes v1 of a new
   single-version file); check whether any pairs already have more than one
   build file differing only in config (candidates for becoming v1+v2 of the
   same file retroactively) — audit this rather than assume every existing
   file becomes a lone v1.
4. **Comparison-dashboard implications.** `docs/comparison-dashboard-*.html`
   generation (see the 2026-07-26 dashboard and its generator approach) reads
   one catalog file per build today — decide whether it needs to change to
   read the new grouped structure, and whether version-over-time comparison
   becomes a new dashboard section.

## Plan
<!-- ordered checklist -->
1. [ ] Answer the four open questions above and record the decisions in this
   card's Decision log before writing any migration code.
2. [ ] Design the exact YAML schema for a grouped/versioned build file
   (spell it out fully, don't just describe it in prose).
3. [ ] Write a migration script/pass that converts the post-[[M-001]] catalog
   into the new grouped structure, preserving all existing `benchmark_runs:`
   data.
4. [ ] Update `docker-compose.yml` service naming to match (each version its
   own service/port, per [[M-001]]'s convention).
5. [ ] Update anything that reads the catalog structurally (dashboard
   generator, `scripts/benchmark_orchestrator.py`'s build-scanning logic) to
   understand the new grouped shape.
6. [ ] Update `catalog/OPERATIONS.md` to document the new versioning
   convention (when to cut a new version vs. a new family file).

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed per Chris's direct request, explicitly scoped as
  research-first (open design questions listed above are real, not
  rhetorical) and sequenced after [[M-001]] since it builds on that card's
  trimmed catalog schema and port convention.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Blocked on [[M-001]] landing first — the trimmed catalog schema
and port-allocation convention this card depends on don't exist yet.
