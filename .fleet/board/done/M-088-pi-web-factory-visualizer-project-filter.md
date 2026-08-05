---
id: M-088
title: pi-web-factory — visualizer project filter
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T18:35:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-077, M-081]
---

# M-088 — pi-web-factory — visualizer project filter

## Context
Chris, 2026-08-05: "in the visualizer I want to be able to filter by project."

## Plan
1. [x] `GET /api/runs?project=<root>` — filter the run list to one project.
2. [x] Frontend `<select>` filter bar, options derived client-side from an
   unfiltered fetch (no dedicated `/api/projects` endpoint — documented reasoning
   in `server.ts`: this table has no pagination anywhere, so the frontend already
   has the full dataset after one unfiltered fetch).
3. [x] Filter state owned by the URL hash (`#/?project=<root>`) via `main.ts`'s
   router, not component-local state — linkable/bookmarkable/reload-safe, survives
   the poll cycle.
4. [x] Delegated to an Implement sub-agent (live-verified via headless Chrome + CDP
   against a scratch db before I ever touched it), independently reviewed the
   diff myself before committing.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T19:15Z — done, deployed; one real grouping bug found live and fixed after initial deploy -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): reviewed the sub-agent's diff (server-side parameterized
  query, hash-router-owned filter state, real new tests), ran the suite myself
  (15 pass), `tsc --noEmit` clean (both configs), committed and deployed.
- 2026-08-05 (claude): **immediately after deploying, live use of the filter
  surfaced a real, significant bug the sub-agent's own tests didn't catch**: every
  Workflow Run gets its own git worktree (M-071), so `sessions.project_cwd` is
  actually `<projectRoot>/.pi-web-factory-worktrees/<adwId>` — UNIQUE per run,
  never shared across runs against the same project. The filter (and the dropdown
  population) grouped/matched on this raw, unique value, so selecting a project
  either returned zero runs or exactly one — never the expected group. The
  sub-agent's own test fixture used two sessions sharing one LITERAL, unrealistic
  `project_cwd` string (`/tmp/other-project`, no worktree suffix), which never
  exercised the real-world shape and so never caught this.
  - Fixed with `projectRootOf()` (`server.ts`): strips the
    `/.pi-web-factory-worktrees/<adwId>` suffix back to the real, shared project
    root. Exposed as a new `projectRoot` field on `/api/runs` responses (computed
    server-side, one source of truth) rather than duplicating the stripping logic
    in the browser bundle. The filter itself is now JS-side (fetch all rows, filter
    by normalized root) rather than a SQL `WHERE` — no clean single-column SQL
    predicate for "same normalized root" without a LIKE-based prefix match, and
    this table is small enough (local trace db) that this isn't a real cost.
  - Added a realistic regression test (two sessions with genuine, DIFFERENT
    per-run worktree `project_cwd` values under one shared root) proving both the
    old exact-match approach would have failed this exact scenario and the new
    normalized approach correctly groups them.
  - Live-verified the fix afterward via a real filtered screenshot: selecting one
    project correctly showed both of its runs (one success, one fail) together.

## Handoff notes
Commits: `685cb66` (main feature), `0d5a0ef` (project-root grouping fix). Both
deployed and live at `http://192.168.1.226:8090`.
