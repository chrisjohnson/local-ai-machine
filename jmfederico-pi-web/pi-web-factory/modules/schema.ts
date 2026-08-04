/**
 * Trace db schema: a TS/bun:sqlite port of upstream SSSF's seven-table schema
 * (`adws/adw_modules/tracer.py`'s `SCHEMA` constant — the ground-truth live
 * schema, not the narrative summary in `references/observability.md`).
 *
 * One deliberate deviation from upstream, required by our design (see
 * pi-web-adw-design.md §3.1): `sessions` gains `project_cwd TEXT`. Upstream
 * SSSF is one db per target repo, so it never needs to record which project a
 * run targeted — pi-web-factory is one shared db across N projects, so every
 * session row must say which `cwd` it ran against.
 *
 * WAL mode, per observability.md's "WAL pragmas" section — open on every
 * connection, writer and reader alike.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  adw_id        TEXT PRIMARY KEY,
  adw_name      TEXT,                -- ADW script(s) run, e.g. "adw_plan + adw_build_test"
  project_cwd   TEXT,                -- DEVIATION FROM UPSTREAM: which project this run targeted (abs path) — required since one db spans N projects, unlike upstream's per-repo db
  request       TEXT,
  status        TEXT,                -- running | success | fail
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER DEFAULT 0, total_cost REAL DEFAULT 0,
  archived      INTEGER DEFAULT 0    -- review triage, set by the UI; never by a run
);
CREATE TABLE IF NOT EXISTS phases (
  phase_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail', -- success must be earned
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  parent_id     TEXT,                -- span nesting
  type          TEXT,                -- phase_start | agent_start | tool_call | handoff
                                      -- | gate_pass | gate_fail | log | agent_end
                                      -- | phase_end | error
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT  -- ended_at set only on events that span time
);
CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id   TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  agent         TEXT,
  output_type   TEXT,                -- name of the envelope schema it parsed against
  payload_json  TEXT,
  valid         INTEGER,
  attempt       INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  attempt       INTEGER,
  gate          TEXT,
  passed        INTEGER,
  violations_json TEXT,              -- derived: the failed checks, as "item: note"
  checks_json   TEXT,                -- [{item, ok, note}] — everything the gate looked at
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  kind          TEXT,                -- 'adw' (the workflow process) | 'agent' (a coding-agent child)
  name          TEXT,                -- '' for the adw, the agent name for a child
  pid           INTEGER,
  command       TEXT,                -- what the pid WAS; pids get recycled, so verify before killing
  started_at    TEXT, ended_at TEXT  -- ended_at NULL = believed alive
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  adw_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens  INTEGER,           -- window occupancy after the agent's last turn
  context_window  INTEGER,           -- the model's ceiling; 0/NULL = unknown
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (adw_id, agent)
);
`;

/** Pragmas required on every connection — writer and reader alike. */
export const PRAGMAS = [
  "PRAGMA journal_mode=WAL;",
  "PRAGMA synchronous=NORMAL;",
  "PRAGMA busy_timeout=5000;",
];
