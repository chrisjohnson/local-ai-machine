---
id: M-031
title: pi-agent experiment — persistent multi-session supervisor service
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-30T21:55:00Z
blocks: null
blocked_by: M-030
status: null
related_cards: [M-030, M-032, M-033, M-034]
---

# M-031 — pi-agent experiment — persistent multi-session supervisor service

## Context
`pi --mode rpc` is a single-session-per-process, stdin/stdout-driven headless
agent (see M-030 findings). There is no built-in multi-client HTTP server or
"keep running after my browser closes" behavior — that's exactly the gap this
card fills, and it's the whole point of the experiment: the user wants to
start a task, close their phone, and have it still be working (or at least
have its result waiting) when they reconnect. Turnstone gives this via
DB-backed workstreams (`turnstone-server`); this card builds the equivalent
minimal layer for pi.

## Plan
1. [x] Build a small persistent service (Node/TS, matching pi's own ecosystem
   so the provider extension mechanism from M-030 works unmodified) that:
   - Spawns one `pi --mode rpc --session-dir <per-session-dir>` child process
     per user-visible session ("workstream"), keeps its stdin pipe open for
     the process's full lifetime — independent of whether any HTTP/WS client
     is currently connected.
   - Exposes an HTTP+WebSocket (or SSE) API: create session, list sessions
     (with status: idle/running/done), send a message to a session, stream
     its `message_update`/`agent_end`/etc events to any connected client,
     and — critically — buffer events for a session while no client is
     connected so reconnecting later replays what was missed instead of
     losing it.
   - Tracks a small manifest (session id → session-dir path → status →
     created/updated timestamps) in a flat file or sqlite so the supervisor
     itself can restart (e.g. `docker restart`) and rediscover/resume
     existing sessions from their `--session-dir` state, not just lose them.
2. [x] Decide and document exactly what "keeps running so I can reconnect
   later" means here in practice (be honest about the boundary): an
   in-flight turn keeps running server-side and its output gets buffered
   for replay — but there's no autonomous "keep working with no new input"
   loop (that's a materially different, larger feature; out of scope for
   this experiment unless it falls out for free).
3. [x] Wire the litellm provider extension from M-030 into every spawned
   session by default (this experiment is specifically about validating the
   locally-hosted `coder` model's fit for daily work, not commercial
   providers).
4. [x] Basic smoke test: create 2-3 concurrent sessions via the API, send
   different prompts to each, confirm they run independently without
   cross-talk, confirm killing/restarting the supervisor process preserves
   session list + history.

## Signals
<!-- signal: claude 2026-07-30T21:55Z — claiming, M-030 confirmed pi RPC + restart-survival works end-to-end -->
<!-- signal: claude 2026-07-30T22:05Z — M-031 done, concurrent isolation + container-restart history survival confirmed live on the box, moving to M-032 -->
<!-- signal: claude 2026-07-31T02:35Z — post-done fix: UI transcript replay after restart/resume was actually blank, see decision log -->

## Post-done fix (2026-07-31, found by human review)
The restart test above verified the *model's* recall (it correctly quoted
prior context after a fresh respawn) and correctly concluded the
manifest+`--session-dir` mechanism preserves real history. What it did NOT
check — a real gap in this card's own test coverage, not a false claim — is
whether that history is visible through the *supervisor's own API/UI*.

It wasn't. `live.events` (the buffer the API and frontend actually read from)
is created empty every time `spawnFor` builds a fresh `live` entry — which
happens on every supervisor restart, and on resuming any session that's been
idle since. The model's context recall works independently (pi reloads its
own `--session-dir` history internally), but nothing replayed that history
into the buffer the UI reads. Net effect: any session without a *new* message
since the last restart/resume showed a blank transcript in the browser, even
though its `.jsonl` file on disk had real turns — confirmed directly (7 real
lines on disk for `concurrent-A`, 0 events returned by its `/events`
endpoint) before writing the fix.

Fixed in `pi-agent/supervisor/src/session-history.ts` (new file): parses
pi's persisted `*.jsonl` message lines and seeds `live.events` with them
(tagged `history_message`) whenever `spawnFor` creates a fresh entry, before
any new live events arrive. Frontend (`app.js`) renders `history_message` as
a static past-turn bubble, separate from the `message_start`/`message_update`
state machine that only applies to pi's live stdout stream. Rebuilt,
redeployed (`docker compose up -d --build pi-agent-supervisor`), re-verified
directly: `concurrent-A`'s `/events` now returns its real "secret word is
BANANA" / "BANANA" exchange from the original test. Committed as `d3d7b70`.

## Decision log
- Built `pi-agent/supervisor/` (Node 22 + TypeScript, Express + `ws`):
  `src/rpc-process.ts` wraps one `pi --mode rpc` child process with
  hand-rolled LF-only JSONL framing (rpc.md explicitly warns Node's
  `readline` is not protocol-compliant since it also splits on
  U+2028/U+2029 - implemented a manual buffer/split instead, not
  `readline`). `src/manifest.ts` is a flat JSON file (write-to-temp +
  rename for crash safety) - deliberately not sqlite, since a handful of
  concurrent sessions doesn't need it and this mirrors the shape of pi's
  own (unpublished) `packages/server/src/storage.ts`. `src/supervisor.ts`
  ties it together: per-session event buffer (capped at 2000 events) +
  subscriber fanout for the WS layer, `recoverAfterRestart()` that marks
  any session still "running"/"starting" from before this process started
  as "stopped" (honest UI state) without discarding the record or its
  `--session-dir` contents. `src/server.ts` exposes
  `POST/GET /api/sessions`, `POST /api/sessions/:id/messages`,
  `POST /api/sessions/:id/resume`, `POST /api/sessions/:id/stop`,
  `GET /api/sessions/:id/events?since=N` (HTTP replay) and
  `GET /api/sessions/:id/stream` (WS, replays backlog on connect then
  streams live) - both the HTTP and WS event paths read from the exact
  same in-memory per-session buffer.
- Real bug found and fixed via live testing, not review: initially wired
  a made-up `PI_CONFIG_DIR` env var (borrowed by mistake from the
  unrelated, unpublished `pi-server` package's own config module read in
  M-030) with an extra `agent/` path segment. pi's real env var
  (`environment-variables.md`, confirmed firsthand) is
  `PI_CODING_AGENT_DIR`, and it already points AT the directory
  `models.json` lives in - the mistake produced "Unknown provider
  local-litellm" from the very first real spawn attempt (a config lookup
  miss, not a crash pi surfaces as "file not found"). Fixed by renaming
  the option/env var throughout (`bootstrap-models-json.ts`,
  `rpc-process.ts`, `supervisor.ts`, `server.ts`, Dockerfile,
  docker-compose.yml) to `PI_CODING_AGENT_DIR` with no extra path
  segment, rebuilt, redeployed, re-tested - confirmed working on the
  second real attempt, not assumed fixed from the diff alone.
- What "keeps running so you can reconnect" concretely means here,
  stated honestly per plan item 2: an in-flight `prompt` keeps running in
  its `pi --mode rpc` child process regardless of whether any HTTP/WS
  client is attached: closing a browser tab or curl connection does NOT
  abort the turn (confirmed: the WS handler's only `close` action is
  unsubscribing from the in-memory event buffer - the child process and
  its `rpc.send()` call are entirely independent of any client socket).
  Its output keeps landing in the per-session buffer and gets replayed to
  whoever connects next via `?since=N` (HTTP) or `/stream?since=N` (WS).
  There is NOT an autonomous "keep working with no new input" loop - once
  `agent_settled` fires with no more queued messages, the session goes
  `idle` and waits for the next `prompt`. This matches Turnstone's own
  boundary (a workstream doesn't invent new work either) and is
  explicitly out of scope for this experiment per the card itself.
- Deployed for real on local-ai-machine (see docker/docker-compose.yml
  `pi-agent-supervisor` service, `network_mode: host` to reach litellm on
  `127.0.0.1:4000` matching the existing pattern) and ran the actual
  plan-item-4 smoke test live, not in isolation:
  - Created 2 concurrent sessions ("concurrent-A", "concurrent-B"), sent
    each a different secret word (BANANA / TRUMPET) via near-simultaneous
    parallel curl requests, then asked each "what was my secret word?".
    Confirmed via each session's own `/events` output: A correctly
    recalled BANANA, B correctly recalled TRUMPET - zero cross-talk.
  - Restart test (the single most load-bearing check, same bar M-030 set
    for the raw CLI): with 2 sessions live, ran `docker restart
    pi-agent-supervisor` for real. After restart, `GET /api/sessions`
    still listed both sessions (correctly marked `stopped`, since no
    child process could possibly have survived a container restart).
    Called `POST /sessions/:id/resume` on one of them, which spawned a
    **brand-new** pi rpc child process pointed at the same
    `--session-dir`/`--session <file>`. Then asked that fresh process
    "what exact phrase did I ask you to reply with earlier in this
    conversation?" - it correctly quoted `"SUPERVISOR SMOKE OK"` from
    before the restart. This is genuine proof the manifest +
    `--session-dir` mechanism carries real conversational history across
    a full container restart, not just that a directory happens to still
    exist on disk.
  - WebSocket path tested directly too (not just HTTP): connected via a
    small Node client from inside the container, sent
    `{"type":"prompt","message":"Say: WS STREAM OK"}` over the socket,
    received the full streamed event sequence ending in `agent_settled`
    over the same connection.

## Handoff notes
Live and running on local-ai-machine: `docker ps` shows
`pi-agent-supervisor` up, `curl http://127.0.0.1:3002/api/health` →
`{"ok":true}`. Test sessions from this card's smoke tests were stopped
(`POST /api/sessions/:id/stop`) but NOT deleted - they're still visible
via `GET /api/sessions` (ids: 42f8ad22 "smoke-test-1" [had the
PI_CODING_AGENT_DIR bug, status error/stopped - harmless, left as a
visible trail of the bug/fix rather than silently erased], 94806208
"smoke-test-2", 44eecb6d "concurrent-A", 675c9ba7 "concurrent-B") -
fine to delete or ignore, they don't interfere with anything.
No frontend yet (M-032) - `PI_AGENT_STATIC_DIR` (`/app/frontend` in the
container) doesn't exist, so the service currently logs "API-only mode"
and serves no browser UI at all; only curl/API access works right now.
Firewall: port 3002 added to `configuration.nix`
`networking.firewall.allowedTCPPorts` and applied for real via
`nixos-rebuild switch` on the box (not just committed) - LAN
reachability itself is verified in M-033, not yet re-checked here beyond
the earlier `checkReversePath: loose` general fix.
