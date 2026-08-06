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
1. [ ] Inventory the canonical build set (catalog versions ∪ global-compose model services, resolve -v1/-v2 naming)
2. [ ] Read all remaining catalog/engine/script sources needed to author the not-in-compose builds (ds4, laguna-fork/dflash, ollama variants, llamacpp-radv not-in-compose)
3. [ ] Define build.yaml schema: name / status / derived / bench; drop `compose:`
4. [ ] Generate builds/<name>/docker-compose.yaml for all existing global-compose services (mechanical 1:1 extraction)
5. [ ] Author + add ~18 new services to the global docker-compose.yml (ds4×2, laguna-fork/dflash×5, ollama×6, llamacpp-radv not-in-compose×8) so global ↔ builds is 1:1
6. [ ] Write build.yaml for every build dir (catalog-derived metadata + status notes)
7. [ ] Update builds/README.md + docs/benchmark-api.md for the new layout
8. [ ] Verify: python yaml parse of every file; docker compose config per build; global service names == builds/ dir names (1:1 script check)
9. [ ] Commit + push

## Signals
<!-- signal: big-pickle 2026-08-06T21:20Z — claiming; starting with inventory -->

## Decision log
- 2026-08-06T21:20Z — Human confirmed: dedicated ollama compose service per ollama build (not shared `ollama`), and full parity for BROKEN / other-machine / ad-hoc catalog builds with a status note in build.yaml. (big-pickle)

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
