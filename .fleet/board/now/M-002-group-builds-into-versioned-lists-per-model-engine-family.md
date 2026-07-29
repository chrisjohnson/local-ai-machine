---
id: M-002
title: Research + implement grouping builds into versioned lists (v1, v2, ...) within a single catalog file
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-29T04:23Z
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
1. [x] Answer the four open questions above and record the decisions in this
   card's Decision log before writing any migration code.
2. [x] Design the exact YAML schema for a grouped/versioned build file
   (spell it out fully, don't just describe it in prose).
3. [x] Write a migration script/pass that converts the post-[[M-001]] catalog
   into the new grouped structure, preserving all existing `benchmark_runs:`
   data.
4. [x] Update `docker-compose.yml` service naming to match (each version its
   own service/port, per [[M-001]]'s convention).
5. [x] Update anything that reads the catalog structurally (dashboard
   generator, `scripts/benchmark_orchestrator.py`'s build-scanning logic) to
   understand the new grouped shape.
6. [x] Update `catalog/OPERATIONS.md` to document the new versioning
   convention (when to cut a new version vs. a new family file).

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-07-29T04:23Z — claiming, M-001 confirmed done, starting research on open questions 1-4 -->
<!-- signal: claude 2026-07-29T04:45Z — research done, Q1-Q4 resolved + schema designed, see decision log. starting implementation (steps 3-6) via sub-agent -->
<!-- signal: claude 2026-07-29T06:10Z — steps 3-6 implemented, PR #5 open. review pass started (isolated worktree) to verify before this moves to done/ -->
<!-- signal: claude 2026-07-29T05:10Z — steps 3-6 implemented, PR #5 open (https://github.com/chrisjohnson/local-ai-machine/pull/5), all 29 build files migrated cleanly, dashboard output byte-identical pre/post, not merging — awaiting review -->
<!-- signal: claude 2026-07-29T06:35Z — review pass complete, verdict: looks correct, ready to merge, no bugs found. one non-blocking robustness note (see decision log). still not merging myself — awaiting Chris -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed per Chris's direct request, explicitly scoped as
  research-first (open design questions listed above are real, not
  rhetorical) and sequenced after [[M-001]] since it builds on that card's
  trimmed catalog schema and port convention.
- 2026-07-29 — M-001 confirmed done, claimed and started. Research pass
  (sub-agent) read every build/engine file, `docker-compose.yml`,
  `catalog/OPERATIONS.md`, `generate_comparison_dashboard.py`, and
  `benchmark_orchestrator.py` to answer the four open questions with
  evidence rather than guesses. Findings + decisions below.
- 2026-07-29 — **Q1 (version vs file identity) resolved.** Confirmed via
  `catalog/engines/llamacpp-vulkan-radv-server-v1.yaml:6-9` (explicit
  "distinct engine" comment) that engine-recipe `-v1`/`-v2` and
  build-serving-config version are genuinely different axes today only
  coincidentally sharing a suffix. Decision: family `id` drops the version
  suffix AND is scoped to a specific engine recipe *identity minus its own
  version number* (e.g. `qwen3.6-27b--llamacpp-vulkan-radv`,
  `qwen3.6-27b--llamacpp-vulkan-radv-server`, and
  `qwen3.6-27b--llamacpp-vulkan-radv-mtp` are three separate families, not
  one — the bench/server/mtp split is structural, per Q2). Each version
  entry carries its own `version: vN`, `compose_service_id: <family-id>-vN`
  (this exactly reproduces today's compose service names for every
  existing file — zero compose/port renaming needed for migrated data,
  only for future v2+ entries), and its own `engine_ref:` pointing at the
  exact engine-recipe file/version it was built against. `engine_ref`
  defaults to whatever v1 used; bumping it is independent of bumping
  `version` — a build version bump does NOT imply an engine-recipe bump.
- 2026-07-29 — **Q2 (family vs version taxonomy) resolved.** Audited all
  29 current build files by (model, engine) pair: zero existing cases
  differ *only* in a tunable serving parameter — every multi-file pair
  found (`qwen3.6-27b` x5, `gemma-4-26b-a4b-it` x3, `glm-4.7-flash` x3) is
  a structural split (different binary/invocation entirely: llama-bench
  vs llama-cli-MTP vs llama-server vs ollama vs vllm), confirming the
  card's suspected taxonomy split is real, not hypothetical. Decision:
  **new version** = same engine recipe (same binary/invocation shape) +
  same model artifact (same quant/files) + a serving-config-only change
  (batch size, ctx length — this retires the unused `--ctx<N>` filename
  suffix convention in `catalog/OPERATIONS.md`, folding it into `version:`
  instead — GPU-mem cap, KV-cache flags, etc). **New family** = different
  engine recipe, different quantization/model artifact, or different
  backend (vllm/llamacpp/ollama). Rationale: quantization changes the
  actual loaded weights (memory/quality tradeoff), not a like-for-like
  serving tweak — not what the version-over-time dashboard trend is for.
- 2026-07-29 — **Q3 (migration mechanics) resolved.** All 29 current build
  files become a lone `v1` of a new same-named family file — a 1:1
  wrap/rename, no retroactive merging needed since Q2's audit found no
  config-only duplicates in today's data. `compose_service_id` for every
  migrated v1 equals its current filename stem exactly, so
  `docker-compose.yml` needs **no changes** for the migration itself
  (Plan step 4 only matters for future v2+ entries).
- 2026-07-29 — **Q4 (dashboard/reader implications) resolved.** Both
  `scripts/generate_comparison_dashboard.py` (`load_builds()`/`find_runs()`,
  lines 79-89) and `scripts/benchmark_orchestrator.py` (`list_build_files`,
  `gather_plan`, `already_has_run`, `missing_benchmark_ids`,
  `process_vllm_build` lines 143-236, 1085-1090) hard-assume file == id ==
  compose-service-name and one `benchmark_runs:` list per file — all need
  to iterate the new `versions:` list instead. Highest-risk piece:
  `benchmark_orchestrator.py`'s `append_benchmark_run()` (lines 526-562)
  does column-0 regex text-surgery on a literal top-level `benchmark_runs:`
  string — must become version-aware (locate the right nested block under
  the matching `version: vN` entry) instead of a single top-level match.
  Dashboard: migrate `_build_id` to `compose_service_id` per version
  (reproduces every existing row's label/identity unchanged); a genuine
  version-over-time trend section is additive/future work, not required
  for the initial migration since no family has 2+ versions yet.
- 2026-07-29 — **Schema finalized** (Plan step 2). Full example below,
  migrated from `catalog/builds/qwen3.6-27b--llamacpp-vulkan-radv-server-v1.yaml`:

  ```yaml
  id: qwen3.6-27b--llamacpp-vulkan-radv-server   # family id: no version suffix
  model:                                          # hoisted: shared by all versions
    display_name: Qwen3.6-27B
    family: Qwen3.6
    hf_repo: unsloth/Qwen3.6-27B-GGUF
    hf_revision: null
    architecture: dense
    total_params: 26.90e9
    active_params: null
    num_experts: null
    quantization: GGUF-Q4_K_M
    context_length_native: null
    modality: text
    files: [Qwen3.6-27B-Q4_K_M.gguf]
    local_path: /var/lib/ai-models/ollama-qwen3.6-27b
    size_on_disk_gb: 15.65
  versions:
    - version: v1
      compose_service_id: qwen3.6-27b--llamacpp-vulkan-radv-server-v1
      engine_ref: llamacpp-vulkan-radv-server-v1
      role: first concurrent-serving benchmark for llama.cpp on this hardware
      notes: >
        ...(verbatim from today's file)...
      status: WORKING
      created: "2026-07-24"
      last_verified: "2026-07-24"
      benchmark_runs:
        - timestamp: '2026-07-26T01:29:33Z'
          benchmark_id: llamacpp-bench-v1
          # ...(unchanged shape, verbatim from today's per-file benchmark_runs entries)
    # - version: v2   (future — e.g. a -np/batch-size retune)
    #   compose_service_id: qwen3.6-27b--llamacpp-vulkan-radv-server-v2
    #   engine_ref: llamacpp-vulkan-radv-server-v1   # unchanged unless the recipe itself changed
    #   ...
  ```
- 2026-07-29 — **Implementation done (Plan steps 3-6), PR #5 opened, not
  merged.** `scripts/migrate_catalog_to_versioned.py` re-audited
  `(hf_repo, quantization, engine)` groups before migrating (re-checking
  Q3's finding rather than trusting it blindly) — confirmed again: zero
  groups with >1 file, so all 29 build files became a lone v1 of their own
  family file, no merging logic exercised. `benchmark_runs` data verified
  byte-identical (order + content) for every file against the pre-migration
  git blob. `docker-compose.yml` needed no changes — verified by diffing
  every migrated version's `compose_service_id` against the compose file's
  actual service names (all 13 standing services matched exactly, both
  vLLM and the one llama.cpp-server build).
  `generate_comparison_dashboard.py`'s `load_builds()` now flattens each
  family's `versions:` list into synthetic per-version dicts; full HTML
  dashboard output diffed byte-for-byte identical before vs. after.
  `benchmark_orchestrator.py`: added `iter_flattened_versions()` as the
  single place that understands the grouped shape, so every
  `process_*_build()` body stays untouched (same flat build-dict shape via
  `id`/`engine` aliasing). **Deviation flagged**: kept the regex/text-surgery
  approach for `append_benchmark_run()` rather than switching to
  `ruamel.yaml` — the only real wrinkle was that a version entry's own keys
  and its nested `benchmark_runs:` list-item dashes land at the *same*
  indent depth under `yaml.safe_dump`'s default style (a block-sequence
  dash can share its parent key's column), which turned out solvable by
  discriminating "bare key" vs. "dash" at that indent level rather than
  needing indent depth alone. Validated with a synthetic 2-version fixture
  (append to an empty-list version, then a non-empty one) confirming
  correct version targeting and insertion point, plus a real-file EOF-path
  append test. No files needed genuine v1+v2 merging — Q3's finding held.
  `catalog/OPERATIONS.md` updated with the Q2 version-vs-family taxonomy and
  the `--ctx<N>` convention retired outright (never adopted by any real
  file). PR: https://github.com/chrisjohnson/local-ai-machine/pull/5 —
  left open for Chris's review, not merged, card stays in now/ until then.
- 2026-07-29 — **Review pass complete (isolated worktree, per Chris's
  request for a thorough check including cross-codebase regression risk).**
  Verdict: correct, ready to merge, no bugs found. Independently re-verified
  rather than trusting the implementer's claims: diffed all 29 old files
  against all 29 new family files programmatically (every old id traces to
  exactly one `version:` entry, `benchmark_runs` content exactly equal, no
  drops/dupes); confirmed `docker/docker-compose.yml` has zero diff and
  13/29 `compose_service_id`s match real compose services (unchanged from
  pre-migration — most builds are one-off CLI/bench runs, not standing
  services, so this is expected, not a regression); ran
  `generate_comparison_dashboard.py` at both the pre-migration merge-base
  and the PR tip and diffed the HTML output byte-identical; ran three
  live end-to-end `append_benchmark_run()` tests including a
  prefix-collision stress case (`-v1` vs `-v11`) — correct version targeted
  every time, no corruption. Cross-codebase consumer check (Chris
  specifically asked about regressions elsewhere): read
  `scripts/agentic_coding_benchmark.py` and
  `scripts/agentic_orchestration_benchmark.py` in full — both are pure
  libraries imported by `benchmark_orchestrator.py`, neither touches
  `catalog/builds/*.yaml` directly, so the PR's changed-file surface
  (`generate_comparison_dashboard.py` + `benchmark_orchestrator.py`) is the
  complete dependency surface. No test suite/CI exists in this repo, so
  this manual verification was the only safety net. One non-blocking note:
  `scripts/migrate_catalog_to_versioned.py:46`'s `VERSION_SUFFIX_RE`
  (`^(.*)-v(\d+)$`) would misinterpret a future model/engine id that
  legitimately ends in `-v<N>` for non-version reasons — harmless today
  (audited, no such case exists) but worth a guard/comment if the script
  is ever rerun. Not merging the PR myself — that's Chris's call.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Research (Plan step 1) and schema design (Plan step 2) are done — see
Decision log above for the full resolved taxonomy and schema. Remaining:
step 3 (migration script — should be a 1:1 wrap per family per Q3, no
merging logic needed for current data, but write it generally since future
runs may have real multi-version merges), step 4 (docker-compose.yml — a
no-op for existing services per Q3, just confirm), step 5 (update
`generate_comparison_dashboard.py` and `benchmark_orchestrator.py` per Q4,
`append_benchmark_run()` is the highest-risk piece), step 6
(`catalog/OPERATIONS.md` — document the version-vs-family taxonomy from Q2
and retire the now-superseded `--ctx<N>` filename convention). Next agent:
implement steps 3-6, then have a Review pass verify the dashboard and
orchestrator still work against the migrated catalog before this moves to
done/.

**2026-07-29 update — steps 3-6 implemented, PR open, awaiting review:**
[PR #5](https://github.com/chrisjohnson/local-ai-machine/pull/5)
(`m-002-versioned-catalog` branch vs. `main`). All 29 build files migrated
1:1 into families (`scripts/migrate_catalog_to_versioned.py`), zero
merging needed — confirms Q3. `benchmark_runs` verified byte-identical
pre/post for every file. `docker-compose.yml` needed no changes (confirmed
by diffing every migrated `compose_service_id` against the compose file's
actual service names). `generate_comparison_dashboard.py`'s `load_builds()`
now flattens `versions:` into synthetic per-version build dicts — full HTML
render diffed byte-identical before/after. `benchmark_orchestrator.py` gets
a new `iter_flattened_versions()` (the one place that understands the
grouped shape) plus a version-aware `append_benchmark_run()` (kept the
regex/text-surgery approach, not ruamel.yaml — see PR description for why).
`catalog/OPERATIONS.md` updated with the version-vs-family taxonomy and the
`--ctx<N>` convention retired. Next agent (Review pass): read the PR diff,
confirm the reasoning holds, then this card can move to done/ once the PR
is merged — do not move it to done/ before that.
