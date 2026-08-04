---
id: M-061
title: pi-web-factory — Bun/TS project scaffold + shared trace db
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T04:14:44Z
blocks: null
blocked_by: null
status: null
related_cards: [M-062, M-063, M-064, M-065, M-066, M-067, M-068]
---

# M-061 — pi-web-factory — Bun/TS project scaffold + shared trace db

## Context
First card of the pi-web-factory build (SSSF pattern rehosted on the `jmfederico-pi-web`
session API — see `pi-web-adw-design.md` at repo root, especially §3.1 and §3.3). No
per-project stamping: this is one shared control plane, baked into the `jmfederico-
pi-web` image later (M-068), addressing N projects by `cwd`. Language decided
2026-08-03: TypeScript/Bun, matching the container's native runtime — `bun:sqlite`
(built in, no external dependency) instead of Python's `sqlite3`.

This card lays the foundation everything else (M-062..M-067) builds on: the repo
scaffold and the trace db schema + writer. No dependency on pi-web's live API — this can
be built and unit-tested standalone.

## Plan
1. [ ] `pi-web-factory/` Bun project scaffold — `package.json`, `tsconfig.json`, minimal
   deps (expect `zod` and a YAML parser to be added by M-063/M-065; don't over-add here).
2. [ ] Port SSSF's seven-table trace schema (`sessions`, `phases`, `events`, `envelopes`,
   `gate_results`, `agent_sessions`, `processes` — see design doc §1.1 and SSSF's own
   `references/observability.md` at `~/src/super-simple-software-factory/.claude/skills/
   sssf/references/observability.md` for the exact column list and event-type table) to
   `bun:sqlite`, WAL mode. **Add `project_cwd TEXT` to `sessions`** — the one schema
   change needed since this factory spans multiple projects, unlike SSSF's per-repo db.
3. [ ] `modules/tracer.ts` — write path for the ten event types (`phase_start`,
   `agent_start`, `tool_call`, `handoff`, `gate_pass`, `gate_fail`, `log`, `agent_end`,
   `phase_end`, `error`), same `parent_id` span-nesting SSSF uses.
4. [ ] Smoke test: write a handful of synthetic events, confirm the one-cursor-query read
   pattern (`select * from events where adw_id=? and rowid>? order by rowid`) returns
   them in order.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:14Z — claiming, starting scaffold + trace db -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
