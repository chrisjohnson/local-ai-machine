#!/usr/bin/env bun
/**
 * visualizer/server.ts: read-only HTTP server for pi-web-factory's trace db
 * (M-077, pi-web-adw-design.md §7.4).
 *
 * Serves both the JSON read API (`/api/...`) AND the bundled frontend
 * (`visualizer/src/index.html` + its imported `.ts`/`.css`, bundled on the
 * fly by `Bun.serve`'s HTML-import routes — no separate build step, no
 * Vite/Vue dependency added to this project's `package.json`) from ONE
 * `Bun.serve` process, per the card's brief ("one process to run").
 *
 * ── Read-only, always ───────────────────────────────────────────────────
 * Opens `factory.db` with `{ readonly: true }` (bun:sqlite) — this process
 * NEVER writes to the trace db, confirmed live (see this file's own
 * companion test / the M-077 card's decision log): `bun:sqlite` throws
 * "attempt to write a readonly database" on any write attempt against a
 * readonly-opened handle, which is exactly the safety property wanted here
 * (the visualizer must never be able to corrupt or race the real writer,
 * `Tracer`, used by `cli.ts`/live Workflow Runs).
 *
 * ── `rowid` on `events` despite its TEXT primary key ───────────────────
 * `events.event_id` is declared `TEXT PRIMARY KEY` (schema.ts), which does
 * NOT alias SQLite's implicit `rowid` (only an `INTEGER PRIMARY KEY` column
 * does that) — but `events` is still an ordinary rowid table, so the
 * implicit `rowid` column is still queryable/orderable on it regardless.
 * Confirmed directly against `bun:sqlite` before relying on it here (ad hoc
 * spike, not assumed): `SELECT rowid, event_id FROM events ORDER BY rowid`
 * returns monotonically increasing rowids in insertion order, exactly the
 * cursor `GET .../events?since=<rowid>` needs.
 *
 * ── Port ────────────────────────────────────────────────────────────────
 * Defaults to 8090 (pi-web itself owns 8080 on this box) — overridable via
 * `PI_WEB_FACTORY_VISUALIZER_PORT`.
 *
 * ── DB path ─────────────────────────────────────────────────────────────
 * Defaults to the same path `cli.ts` writes to (`<repo>/factory.db`, next to
 * `cli.ts` — see that file's own `DEFAULT_DB_PATH`) — overridable via
 * `PI_WEB_FACTORY_VISUALIZER_DB_PATH` for tests/dev against a scratch db.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA } from "../modules/schema.ts";
import { WORKTREE_SUBDIR } from "../modules/worktree.ts";
import index from "./src/index.html";

/**
 * Every Workflow Run gets its OWN git worktree (M-071), so `sessions.
 * project_cwd` is actually `<projectRoot>/.pi-web-factory-worktrees/<adwId>`
 * — a value that's UNIQUE per run, never shared across runs against the
 * same project. Confirmed live (2026-08-05): filtering by the raw, unique
 * `projectCwd` made the "project" filter useless — it only ever matched
 * the one run whose worktree path was typed in exactly. Strips the
 * worktree suffix back to the real, shared project root so multiple runs
 * against the same project group together correctly, both for the
 * dropdown's distinct-project list and for the actual filter query below.
 */
function projectRootOf(cwd: string): string {
  const marker = `/${WORKTREE_SUBDIR}/`;
  const idx = cwd.indexOf(marker);
  return idx === -1 ? cwd : cwd.slice(0, idx);
}

const DEFAULT_DB_PATH = join(import.meta.dir, "..", "factory.db");
const DB_PATH = process.env["PI_WEB_FACTORY_VISUALIZER_DB_PATH"] ?? DEFAULT_DB_PATH;
const PORT = Number(process.env["PI_WEB_FACTORY_VISUALIZER_PORT"] ?? 8090);

// If `factory.db` doesn't exist yet (e.g. no Workflow Run has ever been
// started), create it WITH the real schema via a brief writable connection,
// then close it — same schema module `Tracer` itself uses (`modules/
// schema.ts`), so an empty-but-correctly-shaped db always exists before the
// readonly handle below opens it. This is the ONLY writable handle this
// process ever opens, and only to CREATE (never touch an existing file's
// contents — `CREATE TABLE IF NOT EXISTS` is a no-op against a real db).
if (!existsSync(DB_PATH)) {
  const bootstrap = new Database(DB_PATH, { create: true });
  bootstrap.run(SCHEMA);
  bootstrap.close();
}

// The server's actual db handle: readonly, always — this process must never
// be able to write to the trace db (see module doc comment above).
const db = new Database(DB_PATH, { readonly: true });
db.run("PRAGMA busy_timeout=5000;");

// ── row shapes (raw SQL column names — mapped to camelCase in the API) ────

interface SessionRow {
  adw_id: string;
  adw_name: string | null;
  project_cwd: string | null;
  title: string | null;
  request: string | null;
  status: string | null;
  engineer: string | null;
  started_at: string | null;
  ended_at: string | null;
  total_tokens: number;
  total_cost: number;
  archived: number;
}

interface PhaseRow {
  phase_id: string;
  adw_id: string;
  seq: number;
  name: string | null;
  kind: string | null;
  owner: string | null;
  description: string | null;
  status: string | null;
  attempt: number;
  retries: number;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  output_summary: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface EventRow {
  rowid: number;
  event_id: string;
  adw_id: string;
  phase_id: string | null;
  parent_id: string | null;
  type: string | null;
  name: string | null;
  payload_json: string | null;
  tokens: number | null;
  started_at: string | null;
  ended_at: string | null;
}

/**
 * `steps` defaults to `[]` here — `runsToApi` (below, the ONLY real caller
 * for the list route) always overwrites it with the real, batched-fetched
 * Steps for that run. Kept as a real field (not optional) on the return
 * type so the frontend's `RunSummary` type can rely on it always being
 * present, matching the spec's "every card shows its mini-Gantt, not just
 * running ones" requirement (found missing in review, M-090 follow-up) —
 * a card can't render anything without knowing its Steps up front, and a
 * dedicated per-card fetch for every non-running card would mean N extra
 * round trips just to paint the initial page, which is exactly the kind of
 * thing the "batch data streaming efficiently" performance requirement
 * rules out.
 */
function runToApi(r: SessionRow, steps: ReturnType<typeof stepToApi>[] = []) {
  return {
    adwId: r.adw_id,
    adwName: r.adw_name,
    projectCwd: r.project_cwd,
    /** The shared, worktree-suffix-stripped project root — what the `?project=` filter actually groups/matches on (see `projectRootOf` above). `projectCwd` itself is unique per run, never shared. */
    projectRoot: r.project_cwd === null ? null : projectRootOf(r.project_cwd),
    title: r.title,
    request: r.request,
    status: r.status,
    engineer: r.engineer,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    totalTokens: r.total_tokens,
    totalCost: r.total_cost,
    archived: Boolean(r.archived),
    steps,
  };
}

/**
 * Batches every returned run's Steps into ONE extra query (`WHERE adw_id IN
 * (...)`) rather than one query per run — the grid needs every card's Steps
 * up front (to render a mini-Gantt for ALL cards, not just running ones),
 * so this is the difference between 1 extra round trip and N. Groups by
 * `adw_id` in JS afterward (SQLite's `IN` doesn't preserve per-key
 * grouping on its own).
 */
function runsToApi(rows: SessionRow[]): ReturnType<typeof runToApi>[] {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => "?").join(",");
  const adwIds = rows.map((r) => r.adw_id);
  const allSteps = db
    .query<PhaseRow, string[]>(
      `SELECT phase_id, adw_id, seq, name, kind, owner, description, status,
              attempt, retries, error, input_tokens, output_tokens, cached_tokens,
              output_summary, started_at, ended_at
       FROM phases WHERE adw_id IN (${placeholders}) ORDER BY adw_id, seq`,
    )
    .all(...adwIds);
  const stepsByAdwId = new Map<string, ReturnType<typeof stepToApi>[]>();
  for (const row of allSteps) {
    const mapped = stepToApi(row);
    const bucket = stepsByAdwId.get(row.adw_id);
    if (bucket) bucket.push(mapped);
    else stepsByAdwId.set(row.adw_id, [mapped]);
  }
  return rows.map((r) => runToApi(r, stepsByAdwId.get(r.adw_id) ?? []));
}

function stepToApi(r: PhaseRow) {
  return {
    phaseId: r.phase_id,
    adwId: r.adw_id,
    seq: r.seq,
    name: r.name,
    kind: r.kind,
    role: r.owner,
    description: r.description,
    status: r.status,
    attempt: r.attempt,
    retries: r.retries,
    error: r.error,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cachedTokens: r.cached_tokens,
    outputSummary: r.output_summary,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

function eventToApi(r: EventRow) {
  return {
    rowid: r.rowid,
    eventId: r.event_id,
    adwId: r.adw_id,
    phaseId: r.phase_id || null,
    parentId: r.parent_id || null,
    type: r.type,
    name: r.name,
    payload: safeParseJson(r.payload_json),
    tokens: r.tokens,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

function safeParseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

const server = Bun.serve({
  port: PORT,
  routes: {
    // ── static frontend (bundled by Bun.serve from the HTML import) ──────
    "/": index,

    // ── GET /api/runs?project=<root> — list, most recent first, optionally
    // filtered to runs whose NORMALIZED project root (projectRootOf, above —
    // strips the per-run worktree suffix) matches `project` ────────────────
    //
    // Filtered in JS, not SQL: `project_cwd` is a unique-per-run worktree
    // path, not a plain column value shared across a project's runs, so
    // there's no clean single-column SQL WHERE for "same project" — fetch
    // every row (already the unfiltered-case behavior, and this table is a
    // local trace db, not something needing a real query planner for this)
    // and filter by the normalized root computed per row.
    //
    // No dedicated `/api/projects` endpoint: `/api/runs` is already a single
    // unpaginated query over the whole `sessions` table (no pagination exists
    // anywhere in this API), so the frontend already has the full set of
    // `projectCwd` values in hand after its first unfiltered fetch — deriving
    // the distinct (normalized) project list client-side (see `listView.ts`)
    // is a plain `Set` over data already on the wire, not an extra round
    // trip's worth of DISTINCT query. A dedicated endpoint would only pay
    // for itself once this table is large enough to need pagination/limits
    // on `/api/runs` itself, which it isn't.
    "/api/runs": {
      GET(req) {
        const url = new URL(req.url);
        const project = url.searchParams.get("project");
        const allRows = db
          .query<SessionRow, []>(
            `SELECT adw_id, adw_name, project_cwd, title, request, status, engineer,
                    started_at, ended_at, total_tokens, total_cost, archived
             FROM sessions
             ORDER BY started_at DESC, adw_id DESC`,
          )
          .all();
        const rows = project ? allRows.filter((r) => r.project_cwd !== null && projectRootOf(r.project_cwd) === project) : allRows;
        return json(runsToApi(rows));
      },
    },

    // ── GET /api/runs/:adwId — one run + its Steps ────────────────────────
    "/api/runs/:adwId": {
      GET(req) {
        const adwId = req.params.adwId;
        const run = db
          .query<SessionRow, [string]>(
            `SELECT adw_id, adw_name, project_cwd, title, request, status, engineer,
                    started_at, ended_at, total_tokens, total_cost, archived
             FROM sessions WHERE adw_id = ?`,
          )
          .get(adwId);
        if (!run) return json({ error: `no such Workflow Run: ${adwId}` }, { status: 404 });

        const steps = db
          .query<PhaseRow, [string]>(
            `SELECT phase_id, adw_id, seq, name, kind, owner, description, status,
                    attempt, retries, error, input_tokens, output_tokens, cached_tokens,
                    output_summary, started_at, ended_at
             FROM phases WHERE adw_id = ? ORDER BY seq`,
          )
          .all(adwId);

        return json({ run: runToApi(run), steps: steps.map(stepToApi) });
      },
    },

    // ── GET /api/runs/:adwId/events?since=<rowid> — cursor-poll ───────────
    "/api/runs/:adwId/events": {
      GET(req) {
        const adwId = req.params.adwId;
        const url = new URL(req.url);
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam ? Number(sinceParam) : 0;
        const sinceValid = Number.isFinite(since) ? since : 0;

        const rows = db
          .query<EventRow, [string, number]>(
            `SELECT rowid, event_id, adw_id, phase_id, parent_id, type, name,
                    payload_json, tokens, started_at, ended_at
             FROM events WHERE adw_id = ? AND rowid > ? ORDER BY rowid`,
          )
          .all(adwId, sinceValid);

        return json(rows.map(eventToApi));
      },
    },
  },

  // Fallback for anything not matched above (shouldn't normally hit —
  // Bun.serve's HTML-import route already handles client-side asset paths
  // referenced from index.html).
  fetch() {
    return new Response("not found", { status: 404 });
  },

  error(error) {
    console.error("[visualizer] request error:", error);
    return json({ error: "internal error" }, { status: 500 });
  },
});

console.log(`pi-web-factory visualizer listening on ${server.url.href}`);
console.log(`  reading (readonly) trace db: ${DB_PATH}`);
