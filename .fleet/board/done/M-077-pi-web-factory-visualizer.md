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
1. [x] Pick the stack — no reason to deviate from SSSF's own choice (Vue + Vite,
   served by Bun) unless the implementer has a concrete reason not to; document the
   choice either way, don't leave it implicit.
   - **Decision: NOT Vue+Vite** — went with a tiny Bun-served backend
     (`Bun.serve`, native routes) + plain TypeScript/DOM frontend, bundled on the
     fly by Bun's own HTML-import route feature (`Bun.serve({ routes: { "/":
     index } })` where `index` is an imported `.html` file that itself imports
     `.ts`/`.css` — Bun bundles those automatically, no separate build step, no
     Vite/Vue dependency added to `package.json`). Confirmed live via a throwaway
     spike before committing to this (a minimal `index.html` importing a `.ts`
     file, served and correctly bundled by `Bun.serve`). Rationale: the actual
     UI surface here is small (a list view + one Gantt detail view, no
     component-reuse-heavy app), Vue+Vite would add real tooling weight (a
     second package manager surface, a build step, SFC compilation) for little
     payoff versus ~700 lines of plain TS across 6 small modules
     (`api.ts`/`gantt.ts`/`format.ts`/`listView.ts`/`detailView.ts`/`main.ts`),
     all real, type-checked TypeScript (not innerHTML string soup without
     types) with a tiny hash router (`#/`, `#/runs/:adwId`). `package.json`
     itself is untouched — zero new deps.
2. [x] List view: one card per Workflow Run (`sessions`/workflow-run rows), showing
   title, status, cost/tokens at a glance.
   - Polls `GET /api/runs` every 4s. Falls back to `adwId` when `title` is null
     (confirmed live — nothing populates `title` yet, exactly as expected).
3. [x] Detail view: the Gantt-style Step timeline for one Workflow Run. **Idle/paused
   time collapses, does not render to scale** — draw each Step's real `started_at` →
   `ended_at` span, but compress any gap between one Step's end and the next Step's
   start to a small fixed width regardless of its real duration (§7.4's explicit
   requirement — a Workflow Run blocked on a human for an hour should not produce an
   hour-long blank timeline segment).
   - `visualizer/src/gantt.ts`'s `computeGanttLayout`: each Step's bar width is
     `durationSeconds * 8px` (min 24px so fast Steps stay visible/clickable);
     ANY gap between one Step's end and the next Step's start becomes a fixed
     28px, never proportional. Unit-tested directly (`gantt.test.ts`, 6 tests) —
     including a case with a 1-minute gap and a 2-hour gap producing
     byte-identical layout gap widths. Also verified against seeded data with a
     real 50-minute gap between two Steps rendering as the same small fixed gap
     as an adjacent normal-duration Step (screenshot-confirmed, see Handoff
     notes).
4. [x] Real-time updates: poll `events` past the last-seen `rowid` (same query
   pattern as everywhere else in this project) and animate/highlight whichever Step
   is currently active — a visual "this is happening right now" signal, not just data
   appearing on refresh. Concrete choice of animation style is the implementer's call;
   the requirement is that it reads as live, not static.
   - While a run's status is `running`: polls `GET /api/runs/:adwId/events?since=`
     every 2s. A Step counts as "active" if its own status is `running` OR an
     event touched it within the last 15s (keeps the highlight honest instead of
     stuck forever on stale data). Active Steps get an orange pulsing
     box-shadow (`step-active` CSS class, `pulse-border` keyframe) plus an
     "active now" label in the expanded detail panel, and the run header shows
     a pulsing "LIVE — polling for updates" badge. Confirmed with a real
     without-reload DOM-mutation proof (inserted a new event into the db
     mid-session via a separate process, watched the browser's own tool-call
     list grow from 6 to 7 items purely from polling — see Handoff notes) and
     against an actual live Workflow Run (see item 6 below).
5. [x] Nested tool-call nodes within an active agentic Step, using `events.parent_id` —
   same span-nesting the schema was built for from M-061 onward, just finally
   rendered.
   - Kept simple per the card's own explicit allowance: NOT a nested
     Gantt-within-a-Gantt. The expanded Step detail panel shows a scrollable,
     timestamped list of every event whose `phase_id` matches that Step
     (`tool_call` events plus other non-phase-boundary event types like `log`),
     sorted by `rowid`, each with its type/name, a compact JSON payload
     preview, and duration when `started_at`/`ended_at` are both present. Real
     `parent_id` nesting data (an `agent_start` event as parent of its
     `tool_call` children) is present in the underlying data and used for
     grouping logic, matching the schema's actual nesting design — just not
     drawn as a second visual timeline axis, which the card explicitly allowed.
6. [x] Live verification against a real Workflow Run in progress (not just replayed
   historical data) — start one, watch the visualizer update as it happens.
   - Full details in Handoff notes below. Summary: iterated first against
     hand-seeded realistic data (three runs: completed/running/failed, one with
     a genuine 50-minute inter-step gap) via headless-Chrome + CDP screenshots
     (no browser was available interactively during the build), confirming list
     view, detail view, active-step pulsing, nested tool-call rendering, and
     poll-driven live DOM updates (proven via a script that inserts a db row
     mid-session with the page already loaded and NOT reloaded). Then ran a
     REAL `plan-build-review` Workflow Run against the live pi-web server
     (same scratch-repo-in-container + resume-session pattern
     `workflow.integration.test.ts` established) while the visualizer server
     pointed at the real default `factory.db` path, and captured screenshots at
     each stage: appearing as `running` within seconds of `runWorkflow`
     starting, `review`'s real `agent_start` event (real model
     `local-litellm/big-moe`, real session id) appearing live in the expanded
     panel while genuinely in progress, and the final `success` state with all
     three Steps green and real per-step token counts. Session
     archived+deleted, Project deregistered, scratch repo `rm -rf`'d
     afterward — see Handoff notes for exact IDs/commands.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T03:00Z — claiming, starting the visualizer -->
<!-- signal: claude 2026-08-05T03:50Z — backend + frontend built, verified live against a real Workflow Run, done -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): stack decision — plain TS/DOM frontend bundled by Bun's
  native HTML-import route feature, NOT Vue+Vite (see Plan item 1 for full
  rationale). `package.json` untouched, zero new dependencies added.
- 2026-08-05 (claude): backend (`visualizer/server.ts`) opens `factory.db`
  with `{ readonly: true }` always — confirmed live (both an ad hoc spike and
  `server.test.ts`) that `bun:sqlite` throws `"attempt to write a readonly
  database"` on any write attempt through that handle, so the visualizer
  process is structurally incapable of corrupting or racing the real writer
  (`Tracer`, used by `cli.ts`/live runs). If `factory.db` doesn't exist yet, a
  brief SEPARATE writable connection creates it with the real schema
  (`modules/schema.ts`'s `SCHEMA` — same module `Tracer` uses) and is closed
  immediately, before the server's own readonly handle opens — this is the
  only writable handle the visualizer ever opens, and only to bootstrap an
  empty file, never to touch existing content (`CREATE TABLE IF NOT EXISTS`
  is a no-op against a real db).
- 2026-08-05 (claude): confirmed `events.rowid` works exactly as the card
  assumed, but verified rather than assumed per the card's own instruction —
  `event_id TEXT PRIMARY KEY` does NOT alias SQLite's implicit `rowid` (only
  `INTEGER PRIMARY KEY` does that), but `events` is still an ordinary rowid
  table, so `SELECT rowid, ... FROM events WHERE adw_id=? AND rowid>? ORDER BY
  rowid` works correctly and returns monotonically increasing rowids in
  insertion order — the exact cursor `/events?since=` needed. Confirmed via a
  standalone `bun:sqlite` spike before writing the route, then again via
  `server.test.ts`'s dedicated cursor-filtering test.
- 2026-08-05 (claude): port 8090 chosen (pi-web itself owns 8080 on this box),
  overridable via `PI_WEB_FACTORY_VISUALIZER_PORT`; db path defaults to the
  same path `cli.ts` writes to (`<repo>/factory.db`), overridable via
  `PI_WEB_FACTORY_VISUALIZER_DB_PATH` for tests/dev.
- 2026-08-05 (claude): root `tsconfig.json` needed a new `exclude:
  ["visualizer/src", "node_modules"]` — the frontend's DOM-using files
  (`document`/`window`/`HTMLElement`) don't type-check under the root
  config's `lib: ["ESNext"]` (no DOM), and the root config previously had no
  `include`/`exclude` at all, so it silently picked up every `.ts` file in the
  repo including the new frontend ones. `visualizer/src` gets its own scoped
  `visualizer/src/tsconfig.json` (`lib: DOM`, extends the root config,
  overrides `exclude` back to just `*.test.ts` since `gantt.test.ts` needs
  `bun-types` for `bun:test`, which the DOM-scoped config drops via `types:
  []`). Both `bunx tsc --noEmit` (root) and `bunx tsc --noEmit -p
  visualizer/src/tsconfig.json` are clean; `visualizer/server.ts` itself
  stays in the ROOT scope (ordinary Bun server code, no DOM), only
  `visualizer/src/*` (the actual browser bundle) is excluded from root.
  `bun test` itself is unaffected either way (confirmed both before and after:
  198 pass pre-change, 210 pass post-change — the +12 are this card's own new
  `gantt.test.ts` (6) and `server.test.ts` (6)).
- 2026-08-05 (claude): no browser was available for interactive use during
  development, so verification used headless Chrome
  (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless
  --disable-gpu --screenshot=...`) plus a small hand-written Chrome DevTools
  Protocol (CDP) driver script for click/wait/re-screenshot sequences (to
  expand Step detail panels and to prove live polling updates the DOM without
  a page reload) — not a checked-in tool, a throwaway verification aid, left
  out of the repo (scratchpad only).
- 2026-08-05 (claude): real end-to-end live verification performed against
  the actual running pi-web server on `local-ai-machine`
  (`http://192.168.1.226:8080/api`, resolved dynamically the same way
  `workflow.integration.test.ts` does). Scratch repo
  `/tmp/pi-web-factory-m077-viz-test` created inside the `pi-web` container
  via `ssh local-ai-machine "docker exec pi-web ..."`, worktree pre-created,
  session started (`019fcfcf-32ae-70a8-b1fe-33064d29c4df`), then
  `runWorkflow` invoked directly (same resume-path pattern
  `workflow.integration.test.ts`/`planBuildTest.integration.test.ts`
  establish) for the `plan-build-review` Workflow, `adwId
  adw_m077vizlivetst`, writing to the REAL default `factory.db` path (not a
  temp db) while the visualizer server was already running against that same
  real path. Watched the run go `running` -> `success` live in the browser
  (via headless-Chrome+CDP screenshots at each stage — see Handoff notes for
  what was captured). Real review-agent JSON-parse-failure-then-retry
  correction event chain was visible for real in the nested-events panel
  (`log:parse_failure` on attempt 1, `agent_end`+`gate_pass:json_parses`+
  `gate_pass:permissions` on attempt 2) — genuine operational detail the
  visualizer is meant to expose, not staged. Cleanup performed afterward:
  session archived (`POST /sessions/:id/archive`) then deleted (`DELETE
  /sessions/:id?cwd=...`), confirmed gone from `GET /sessions`; pi-web Project
  `c043c4a2-b6a3-414e-a916-684c12ba5db1` (auto-registered for the worktree
  path) deregistered via `DELETE /projects/:id`, confirmed gone from `GET
  /projects`; scratch repo removed via `docker exec pi-web rm -rf
  /tmp/pi-web-factory-m077-viz-test`, confirmed absent afterward. No other
  session/Project touched at any point.
- 2026-08-05 (claude): left the real `factory.db` (gitignored, never
  committed — confirmed) in place at the repo root afterward, containing this
  one genuine live run's full trace history, rather than deleting it — real
  evidence for the human to independently browse via the visualizer, matching
  the spirit of "use real historical data" the card's own verification
  instructions asked for. The visualizer server itself was left running
  (`bun visualizer/server.ts`, PID logged in Handoff notes) against that real
  db for the human's own inspection.
- 2026-08-05 (claude, independent review — not the implementing sub-agent):
  read `server.ts` and `gantt.ts` in full, spot-checked `detailView.ts` and
  `format.ts`'s `escapeHtml` (real implementation, not a stub). Confirmed
  live: `curl`'d the running server's `/api/runs` and `/api/runs/:adwId`
  directly, got back the real `plan-build-review` verification run with
  correct Step/token/timing data. Reran `bun test visualizer/` (12 pass) and
  the full non-live suite (`bun test` excluding `*.integration.test.ts`, 210
  pass) plus `tsc --noEmit` (root + `visualizer/src`, both clean)
  independently. Separately found (while checking for leftover state from
  today's broader session, not specific to this card) 9 stray sessions + 1
  stray Project from an UNRELATED card's (M-076) earlier testing — cleaned
  up with Chris's explicit confirmation, logged in M-078, not a defect in
  this card's own cleanup. No issues found in this card's own work.

## Handoff notes
**Files added** (all new, nothing existing modified except `tsconfig.json`,
see decision log): `visualizer/server.ts` (backend + static serving),
`visualizer/server.test.ts` (spawns the real binary, hits real HTTP routes
against a scratch db — 6 tests), `visualizer/src/index.html`,
`visualizer/src/main.ts` (hash router), `visualizer/src/api.ts` (fetch
wrappers), `visualizer/src/gantt.ts` (compressed-gap layout, pure logic),
`visualizer/src/gantt.test.ts` (6 tests), `visualizer/src/listView.ts`,
`visualizer/src/detailView.ts`, `visualizer/src/format.ts`,
`visualizer/src/style.css`, `visualizer/src/tsconfig.json` (DOM-scoped
typecheck config).

**Run it**:
```
cd pi-web-factory
bun visualizer/server.ts
# -> http://localhost:8090/  (list view at #/, detail at #/runs/<adwId>)
```
Env overrides: `PI_WEB_FACTORY_VISUALIZER_PORT` (default 8090),
`PI_WEB_FACTORY_VISUALIZER_DB_PATH` (default `<repo>/factory.db`, same file
`cli.ts` writes to).

**Currently running for independent review**: a `bun visualizer/server.ts`
process was left running against the REAL `factory.db` (not a scratch db),
which now contains one genuine live Workflow Run's full trace data from this
card's own verification (`adw_m077vizlivetst`, `plan-build-review`, ended
`success`). Visit `http://localhost:8090/` to see it directly — no setup
needed. Kill with `pkill -f 'bun visualizer/server.ts'` when done reviewing,
or leave it running, your call.

**Tests**: `bun test visualizer/` (12 tests, all pass, no live network
needed — `server.test.ts` spawns the real server binary against an isolated
temp db, `gantt.test.ts` is pure-function unit tests). Full project suite
(excluding `*.integration.test.ts`, which hit the shared live box): `bun test
$(find . -name "*.test.ts" -not -path "./node_modules/*" -not -name
"*.integration.test.ts")` — 210 pass, 0 fail (198 pre-existing + 12 new).
`bunx tsc --noEmit` and `bunx tsc --noEmit -p visualizer/src/tsconfig.json`
both clean.

**Known gaps vs. the full plan**: nested tool-call rendering is a flat
timestamped list inside the expanded Step panel, not a nested
Gantt-within-a-Gantt sub-timeline — the card's own Plan item 5 explicitly
allowed this simplification ("doesn't need to be a fully nested visual
Gantt-within-a-Gantt as long as the data is genuinely there and visible"),
and the underlying `parent_id` nesting data IS present and used for grouping,
just not drawn as a second visual axis. No horizontal scroll minimap/zoom
controls for very long Workflow Runs (not asked for; the timeline container
just scrolls). No archived-run filter/search on the list view (not asked
for — `archived` is read and returned by the API but not yet surfaced/acted
on in the UI, consistent with the card's own note that `archived` is "review
triage, set by the UI" in a LATER card, not this one).

**Pre-existing unrelated dirty state in this worktree** (present before this
card started, NOT touched by this work): uncommitted changes to
`../Dockerfile`, `../docker-entrypoint.sh`, and `pi-web-factory/cli.ts`
(a `PI_WEB_FACTORY_DB_PATH`/`resolveDbPath()` addition, referencing
M-068-style container persistence), plus an untracked `../.dockerignore` —
appears to be in-progress M-068 (Docker) work from elsewhere, left as-is,
not reviewed or modified by this card.
