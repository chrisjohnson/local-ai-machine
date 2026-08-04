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
1. [x] `pi-web-factory/` Bun project scaffold — `package.json`, `tsconfig.json`, minimal
   deps (expect `zod` and a YAML parser to be added by M-063/M-065; don't over-add here).
2. [x] Port SSSF's seven-table trace schema (`sessions`, `phases`, `events`, `envelopes`,
   `gate_results`, `agent_sessions`, `processes` — see design doc §1.1 and SSSF's own
   `references/observability.md` at `~/src/super-simple-software-factory/.claude/skills/
   sssf/references/observability.md` for the exact column list and event-type table) to
   `bun:sqlite`, WAL mode. **Add `project_cwd TEXT` to `sessions`** — the one schema
   change needed since this factory spans multiple projects, unlike SSSF's per-repo db.
3. [x] `modules/tracer.ts` — write path for the ten event types (`phase_start`,
   `agent_start`, `tool_call`, `handoff`, `gate_pass`, `gate_fail`, `log`, `agent_end`,
   `phase_end`, `error`), same `parent_id` span-nesting SSSF uses.
4. [x] Smoke test: write a handful of synthetic events, confirm the one-cursor-query read
   pattern (`select * from events where adw_id=? and rowid>? order by rowid`) returns
   them in order.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:14Z — claiming, starting scaffold + trace db -->
<!-- signal: claude 2026-08-04T04:32Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): schema ported from upstream's actual `tracer.py` `SCHEMA`
  constant, not `observability.md`'s narrative summary — the live schema carries a few
  extra columns the doc omits (`sessions.adw_name`/`archived`, `gate_results.checks_json`,
  `agent_sessions.context_tokens`/`context_window`); ported the real shape, per this
  card's own instruction to check column-level detail against reality, not the summary.
- 2026-08-04 (claude): verified independently (not just trusting the implementing
  sub-agent's report) — re-ran `bun test` and `tsc --noEmit` myself before committing,
  both clean (4 pass / 0 fail, zero type errors). Also fixed two things the sub-agent
  left: no `.gitignore` for `node_modules/` (506 of 514 created files were vendored
  deps that would have been committed), and a premature `"module": "cli.ts"` field in
  `package.json` pointing at a file that doesn't exist yet (that's M-067's job).

## Handoff notes
Built at `jmfederico-pi-web/pi-web-factory/`. `Tracer` class in `modules/tracer.ts`
wraps `bun:sqlite`; construct with `new Tracer(dbPath)`, call `.event(...)` for any of
the ten event types plus the `session*`/`process*`/`phaseUpsert`/`envelopeRow`/
`gateRow`/`agentSessionRow` helpers for the side-table writes. M-062 (piwebClient.ts)
and M-063 (envelopes/gates) have no dependency on this card and can proceed in
parallel; M-066 (chains) is what actually wires a `Tracer` instance into a real run.
