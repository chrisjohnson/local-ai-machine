---
id: 2026-07-23-grafana-incident-litellm-key-roadmap
date: 2026-07-23
source: "README.md (Decision Log — 2026-07-23 later still: Grafana access incident, LiteLLM key, roadmap restructure, Task 4.4)"
tags: [grafana, litellm, monitoring, roadmap, incident]
status: active
---

# Grafana access incident fixed; LiteLLM key generated; roadmap restructured to 8 phases

**Grafana access incident — root-caused and fixed.** Chris couldn't log into Grafana,
recalling an account for `chrisjohnson0@gmail.com`. Investigation found Grafana's actual
SQLite user table has exactly one user, `admin` — no such account, no OAuth, no
self-signup configured anywhere in the stack. The account Chris remembered was Open
WebUI's separate first-signup-becomes-admin flow (a different service, port 3001 not
Grafana's 3000). **Fixed** by resetting Grafana's admin password via its own supported
`grafana cli admin reset-admin-password` tool and updating `GRAFANA_ADMIN_PASSWORD` in the
gitignored `docker/.env` to match; verified working via a live API call. New password was
handed to Chris directly in conversation, not written to any tracked file — if lost again,
the fix is the same reset command, not recovery of the old value.

**Decided: Chris's LiteLLM virtual key generated** (`/key/generate` API, alias
`chris-master`, unrestricted, verified against `/v1/models`). Drew's rate-limited edge key
deferred — real rate-limit/route-blocking parameters still needed to be decided before
creation.

**Decided: roadmap restructured from 4 phases to 8.** Phase 5 (Model Research &
Continuous Optimization, open-ended — explicitly includes alternate serving paths like
Lemonade/Ollama and MTP research, not just flag-tuning), Phase 6 (Multi-Tenant & Control
Plane Verification — Turnstone, Drew's key/edge access, Herdr/Hermes, backups, moved out
of Phases 3/4), Phase 7 (Review, Codify, Rebuild — full audit against the repo then an
actual wipe-and-rebuild to prove reproducibility; the actual wipe is a hard stop needing
explicit go-ahead), Phase 8 (Day-N Operations Documentation — split the README into fleet
kanban items + a project AGENTS.md + a proper human-facing README, preserving decision-log
history rather than discarding it — this M-003 knowledge/ migration is part of that
Phase 8 work). Phase 3 was complete at this point; Phase 4 trimmed to just
Grafana/observability.

**Task 4.4 complete**: node-exporter's hwmon collector already surfaces GPU
temp/power/clock for free; a new textfile-collector script (`scripts/amdgpu-metrics.sh`) +
10s systemd timer covers the amdgpu-specific values (busy %, GTT/VRAM) hwmon doesn't.
Dashboard grew from 10 to 17 panels.

**Explicit standing instruction from Chris at this point**: do not start Phase 5 (or
anything beyond it) without checking in first.
