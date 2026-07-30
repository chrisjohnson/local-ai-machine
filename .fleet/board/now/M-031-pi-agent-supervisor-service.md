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
1. [ ] Build a small persistent service (Node/TS, matching pi's own ecosystem
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
2. [ ] Decide and document exactly what "keeps running so I can reconnect
   later" means here in practice (be honest about the boundary): an
   in-flight turn keeps running server-side and its output gets buffered
   for replay — but there's no autonomous "keep working with no new input"
   loop (that's a materially different, larger feature; out of scope for
   this experiment unless it falls out for free).
3. [ ] Wire the litellm provider extension from M-030 into every spawned
   session by default (this experiment is specifically about validating the
   locally-hosted `coder` model's fit for daily work, not commercial
   providers).
4. [ ] Basic smoke test: create 2-3 concurrent sessions via the API, send
   different prompts to each, confirm they run independently without
   cross-talk, confirm killing/restarting the supervisor process preserves
   session list + history.

## Signals
<!-- signal: claude 2026-07-30T21:55Z — claiming, M-030 confirmed pi RPC + restart-survival works end-to-end -->

## Decision log

## Handoff notes
