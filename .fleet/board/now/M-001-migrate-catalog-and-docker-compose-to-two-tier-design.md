---
id: M-001
title: Migrate existing catalog + docker-compose to the new two-tier design
initiative_id: null
claimed_by: gentle-genet-star
claimed_at: 2026-07-26T14:00:00Z
blocks: M-002
blocked_by: null
status: null
related_cards: [M-002]
---

# M-001 — Migrate existing catalog + docker-compose to the new two-tier design

## Context

Design decided directly with Chris 2026-07-26, after a weekend benchmark sweep
left `catalog/builds/*.yaml` with 27 files (19 now carrying real data) and
`docker-compose.yml` with only 2 model-serving services (`vllm-primary`,
`vllm-judge`) — every other verified-working build only ever ran as an ad hoc
`docker run` via `swap_model_start.sh`/the benchmark orchestrator, never as a
standing, selectable service.

**Rejected alternative**: generating `docker-compose.yml` from the catalog at
deploy time. Chris's call: keep **one big, complete, checked-in
`docker-compose.yml`** — this is more portable (carries the exact serving
config to another machine with no Claude harness / generator tooling needed)
and is itself the durable, inspectable source of truth for "how do I actually
run this model," not a build artifact.

## Target design

**`docker-compose.yml`** becomes the single complete, checked-in definition of
every verified-working model+engine build, each as its own service:
- Service name = the build's catalog `id` (exact match, no reformatting) —
  this is the join key between the two files, not a separate mapping table.
- Each service gets a **fixed port that it holds forever** (once assigned,
  never reused for a different build). Simple allocation scheme needed —
  propose one (e.g. a base port per engine family + sequential offset) as
  part of this card's work, don't invent one silently without recording the
  convention somewhere (this file's own `## Decision log`, or
  `catalog/OPERATIONS.md`).
- Only the build(s) actually in use get `docker compose up -d <service>`'d;
  everything else stays defined-but-stopped. This matches Chris's actual
  usage pattern (deliberate one-model-per-slot switching, not dynamic
  hot-swapping) — no orchestration needed beyond starting/stopping the
  service you want.
- llama.cpp and Ollama builds have **no standing-service precedent
  today** (only vLLM's primary/judge do) — this card has to write real
  compose service definitions for these engine families too, not just
  relocate the 2 existing vLLM ones. Reference `catalog/engines/*.yaml` for
  each engine's image/flags/gotchas.
- `primary`/`judge` (and any other logical roles) stop being fixed
  compose-service identities. LiteLLM's own config becomes the place that
  aliases a role name to whichever concrete `localhost:<port>` is currently
  the pick for that role — switching "primary" to a different model is a
  LiteLLM config edit + reload, not a docker-compose change. Update
  `docker/litellm-config.yaml` (or wherever LiteLLM's model list lives) to
  reflect this — check its current structure before assuming the exact
  mechanism.

**`catalog/builds/*.yaml`** gets trimmed to only what's materially relevant to
benchmarking/comparison — stop duplicating deployment detail that
`docker-compose.yml` now owns exclusively:
- **Keep**: `id` (still the join key), `engine` (family/methodology
  selector), `role`/`notes`, the full `model:` identity block (`display_name`,
  `family`, `hf_repo`, `architecture`, `total_params`, `active_params`,
  `quantization`, `context_length_native`, `modality` — the comparison
  dashboard groups/sorts on these, don't drop them), `status`,
  `created`/`last_verified`, `benchmark_runs: []`.
- **Remove** (now lives only in `docker-compose.yml`): `build_specific_flags`,
  `build_specific_env`, `compose_service` block, `served_model_name` (the
  compose service's own command already specifies this).
- **Judgment call, decide and record it**: whether `model.local_path` /
  `model.files` stay (arguably provenance/identity — needed to cross-reference
  which `configuration.nix` download entry a build corresponds to — not
  strictly "how do I deploy this") or move to compose-only too. Lean toward
  keeping them in catalog as identity/provenance, but this card should settle
  it explicitly rather than leave it ambiguous, and note the reasoning here.

**Un-migrated for now** (explicitly out of scope for this card, belongs to
M-002): the "one file per model+engine+structural-family containing a
`versions:` list" restructuring. This card keeps today's one-file-per-build
granularity, just trims the fields and adds the corresponding compose
service. M-002 does the harder regrouping/versioning work on top of this
card's result.

## Plan
<!-- ordered checklist -->
1. [x] Decide and document the port-allocation convention — DONE (see Decision log).
2. [x] Decide and document the `model.local_path`/`model.files`
   keep-or-remove call — DONE (see Decision log).
3. [ ] For every `WORKING`/`UNTESTED-BUT-DOWNLOADED` build (skip `BROKEN`),
   write its `docker-compose.yml` service entry — vLLM, llama.cpp, and
   Ollama all need real definitions, not just vLLM.
4. [ ] Trim each `catalog/builds/*.yaml` to the reduced field set, preserving
   all existing `benchmark_runs:` data untouched.
5. [ ] Update `docker/litellm-config.yaml` (or find wherever the actual
   LiteLLM model-alias config lives) so `primary`/`judge` route to whichever
   builds are the current pick, via the new fixed ports.
6. [ ] Verify at least one build of each engine family (vLLM, llama.cpp,
   Ollama) actually starts cleanly from the new compose entry and responds
   on its assigned port before calling this done — this is a real deploy
   change, don't just eyeball the YAML.
7. [ ] Update `catalog/OPERATIONS.md` (and anywhere else that documents the
   old `build_specific_flags`-in-catalog / `swap_model_start.sh`-for-testing
   workflow) to describe the new two-tier model.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
<!-- signal: gentle-genet-star 2026-07-26T14:00Z — claiming, starting recon -->
<!-- signal: gentle-genet-star 2026-07-26T14:05Z — decisions made: port scheme (8100-8199 vllm, 8200 llamacpp, 11434 ollama), local_path/files kept, llamacpp benchmarker builds excluded from compose. Starting implementation. -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26T14:05Z — **Port allocation**: per-engine-family ranges.
  vLLM builds → 8100-8199 (sequential per build). llamacpp-server builds →
  8200-8299. Ollama builds → 11434 (shared; only one runs at a time).
  Existing 8000/8001 stay reserved for standing primary/judge. Infrastructure
  ports (4000, 8080, 9090, 3000, 3001) untouched. Rationale: simple,
  extensible, no collisions between engine families; within a family only
  one build runs at a time so sequential offsets suffice.
- 2026-07-26T14:05Z — **local_path/files keep-or-remove**: KEEP in catalog.
  These are identity/provenance fields (which HF repo, which quantization,
  which files on disk), not deployment detail. Needed to cross-reference
  `configuration.nix` download entries. Deployment detail that moves to
  compose-only: `build_specific_flags`, `build_specific_env`,
  `compose_service`, `served_model_name`.
- 2026-07-26T14:05Z — **llamacpp benchmarker builds**: 10 of11 llamacpp
  builds use engine `llamacpp-vulkan-radv-v1` (llama-bench, single-shot
  benchmarking tool that exits after running). These cannot be standing
  compose services. Only `llamacpp-vulkan-radv-server-v1` (llama-server,
  HTTP API) gets a compose entry. Decision: skip benchmarker builds for
  compose; document this in OPERATIONS.md.
- 2026-07-26 — filed per Chris's direct request; design decided in
  conversation (docker-compose stays one big checked-in file, not
  generated; catalog trims to benchmark-relevant fields; build `id` is the
  join key in both files).

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Decisions made (port allocation, local_path/files kept, llamacpp benchmarker
exclusion). Next: write docker-compose.yml service entries for all WORKING/
UNTESTED vllm builds (11 new) + llamacpp-server (1 new) + ollama (3 new),
then trim catalog files, update litellm config, verify deploys.
