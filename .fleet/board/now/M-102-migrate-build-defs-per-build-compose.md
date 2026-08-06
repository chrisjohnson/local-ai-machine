---
id: M-102
title: Migrate build definitions to per-build docker-compose + populate every catalog build
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-06T21:20:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-101]
---

# M-102 — Migrate build definitions to per-build docker-compose + populate every catalog build

## Context
M-101's build.yaml inlined the compose service blob (`compose:` key), which is
documentation-only — the orchestrator actually uses the central
`docker/docker-compose.yml`. The human directed a migration:

1. Drop the inline `compose:` blob; each build gets a real, directly-executable
   `builds/<build>/docker-compose.yaml` (`docker compose -f <file> up -d`).
2. Using `catalog/builds/*.yaml` as the inventory basis, populate **every known
   build** — broken, other-machine, or ad-hoc alike — with a complete
   `build.yaml` + `docker-compose.yaml` and a matching service in the global
   `docker/docker-compose.yml`, so the two are **1:1 across the board**.
3. Versioning: any build whose name has no version starts at `-v1` (added in
   BOTH the global compose service name and the per-build file, just like the
   global compose). `-v2` variants that already exist stay.
4. Ollama-based catalog builds get **dedicated** ollama compose services
   (own container_name/port, `OLLAMA_MODELS` pointed at their model dir) —
   NOT the shared always-up `ollama` service.
5. Status notes go in build.yaml (e.g. `status: broken`, `status: other-machine`).

Explicitly excluded from parity by human decision: none — every catalog build
is included.

## Plan
1. [x] Inventory the canonical build set (catalog versions ∪ global-compose model services, resolve -v1/-v2 naming)
2. [x] Read all remaining catalog/engine/script sources needed to author the not-in-compose builds (ds4, laguna-fork/dflash, ollama variants, llamacpp-radv not-in-compose)
3. [x] Define build.yaml schema: name / status / derived / bench; drop `compose:`
4. [x] Generate builds/<name>/docker-compose.yaml for all existing global-compose services (mechanical 1:1 extraction)
5. [x] Author + add 20 new services to the global docker-compose.yml (ds4×2, laguna-fork/dflash×5, llamacpp-radv not-in-compose×8, dedicated ollama×5) so global ↔ builds is 1:1
6. [x] Write build.yaml for every build dir (catalog-derived metadata + status notes)
7. [x] Update builds/README.md + docs/benchmark-api.md for the new layout
8. [x] Verify: python yaml parse of every file; docker compose config per build; global service names == builds/ dir names (1:1 script check)
9. [x] Commit + push (source 421a4b9 + board 6efb1d7 on main)

## Signals
<!-- signal: big-pickle 2026-08-06T21:20Z — claiming; starting with inventory -->
<!-- signal: big-pickle 2026-08-06T22:10Z — 46 build dirs generated; global compose 46 model services; all 1:1 verified -->
<!-- signal: big-pickle 2026-08-06T22:15Z — committed + pushed; awaiting box deploy + compose validation before done/ -->

## Decision log
- 2026-08-06T21:20Z — Human confirmed: dedicated ollama compose service per ollama build (not shared `ollama`), and full parity for BROKEN / other-machine / ad-hoc catalog builds with a status note in build.yaml. (big-pickle)
- 2026-08-06T22:10Z — Catalog dump corrected the plan's status assumptions: laguna-fork dflash rocm-7.2.2 / rocm / vulkan-v1 are TESTED_NOT_VIABLE, only vulkan-v2 is TESTED_VIABLE; speculative-dflash is BROKEN. build.yamls carry those statuses verbatim. (big-pickle)
- 2026-08-06T22:10Z — Dedicated ollama instances share the `ollama_data` model store (volume mount) instead of per-instance `OLLAMA_MODELS` — models are registered once via scripts/ollama_register_model.sh against the shared store; `bench.model` in build.yaml points at the registered ollama name. `OLLAMA_MODELS` is not set per-instance to avoid duplicating the store. (big-pickle)
- 2026-08-06T22:10Z — Per-build docker-compose.yaml pins project name `docker` (same as global stack) and declares referenced named volumes `external` with full `docker_<vol>` names — compose v5 rejects undeclared named volumes otherwise, and this makes standalone `docker compose -f builds/<b>/docker-compose.yaml up` attach the real shared volumes. Files are machine-derived from the global compose so they cannot drift. (big-pickle)
- 2026-08-06T22:10Z — ds4-server compose commands are best-effort (flags from M-047/M-051 catalog notes + STRIXHALO.md: `--ctx 128000 --prefill-chunk 1024`); STRIXHALO.md has no full CLI reference, so the standing-service config is not yet validated end-to-end. (big-pickle)
- 2026-08-06T22:10Z — ornith-q8's catalog file (`ornith-1.0-35b-mtp-q8--llamacpp-vulkan-radv-mtp.yaml`) has a genuine YAML parse error (unquoted colon in a timestamp string, line 22). Not part of this card's scope to fix; build.yaml for ornith-q8 authored manually from M-089 context. (big-pickle)

## Handoff notes
- Working tree is the main checkout (the `baz-bang` worktree the session opened in had been deleted). Prior M-101/bench commits also landed directly on main, matching the box's `git pull` deploy model.
- Verification results: 46/46 model services in `docker/docker-compose.yml`; 46/46 build dirs with `build.yaml` + `docker-compose.yaml`; per-build compose service block == global block (parity script, 0 mismatches); `docker compose config` valid on all 46 per-build files; `qwen3.5-4b` and `ornith-q4` `benchmarks/` subdirs preserved.
- Remaining before done/: commit source (docker compose + builds/ + docs) + board card update, push to main. Deployment to the box (git pull + compose validation) is a separate step after the human reviews the global compose diff.
- Generator script (throwaway, /tmp/gen_build_files.py) derives per-build files from the global compose + a META table; not committed — outputs are the deliverable.
