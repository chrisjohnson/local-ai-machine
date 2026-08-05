---
id: M-077
title: pi-web-factory — visualizer (Gantt-style Workflow Run view, real-time)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T03:00:00Z
blocks: null
blocked_by: [M-074]
status: null
related_cards: [M-061, M-074, M-076]
---

# M-077 — pi-web-factory — visualizer (Gantt-style Workflow Run view, real-time)

## Context
`pi-web-adw-design.md` §7.4. Explicitly deferred in the original design (§3.5: "no UI
yet... a future panel inside pi-web itself") — un-deferred 2026-08-04 with real,
specific requirements, not a vague "build a dashboard eventually."

Data model already supports this (§7.3, M-074): one card per Workflow Run, that run's
Steps as a timeline, `parent_id`-nested tool-call spans within an agentic Step. The
`events` table's cursor-poll pattern (`select * from events where adw_id=? and
rowid>?`) is the same live-read transport SSSF's own visualizer already proved out —
no websocket, no ingest endpoint, reads never block writers (`pi-web-adw-design.md`
§1.1's citation of SSSF's own design). Blocked on M-074 since it reads the migrated
schema (`title`, narrowed `kind`, `role`, per-step tokens, `output_summary`).

## Plan
1. [ ] Pick the stack — no reason to deviate from SSSF's own choice (Vue + Vite,
   served by Bun) unless the implementer has a concrete reason not to; document the
   choice either way, don't leave it implicit.
2. [ ] List view: one card per Workflow Run (`sessions`/workflow-run rows), showing
   title, status, cost/tokens at a glance.
3. [ ] Detail view: the Gantt-style Step timeline for one Workflow Run. **Idle/paused
   time collapses, does not render to scale** — draw each Step's real `started_at` →
   `ended_at` span, but compress any gap between one Step's end and the next Step's
   start to a small fixed width regardless of its real duration (§7.4's explicit
   requirement — a Workflow Run blocked on a human for an hour should not produce an
   hour-long blank timeline segment).
4. [ ] Real-time updates: poll `events` past the last-seen `rowid` (same query
   pattern as everywhere else in this project) and animate/highlight whichever Step
   is currently active — a visual "this is happening right now" signal, not just data
   appearing on refresh. Concrete choice of animation style is the implementer's call;
   the requirement is that it reads as live, not static.
5. [ ] Nested tool-call nodes within an active agentic Step, using `events.parent_id` —
   same span-nesting the schema was built for from M-061 onward, just finally
   rendered.
6. [ ] Live verification against a real Workflow Run in progress (not just replayed
   historical data) — start one, watch the visualizer update as it happens.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T03:00Z — claiming, starting the visualizer -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
