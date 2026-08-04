---
id: M-062
title: pi-web-factory — piwebClient.ts (session lifecycle + completion wait-loop)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-061, M-063, M-064, M-065, M-066, M-067, M-068]
---

# M-062 — pi-web-factory — piwebClient.ts (session lifecycle + completion wait-loop)

## Context
The execution primitive that replaces SSSF's `agent_pi.py` (which spawns a bare `pi`
CLI subprocess — confirmed not available on PATH anywhere in the running `jmfederico-
pi-web` container, which is *why* this approach exists at all). See `pi-web-adw-
design.md` §1.3 (the confirmed API surface) and §3.2 (the pseudocode this card
implements). Runs as a sibling process inside the same container, talking to
`pi-web-server` over `http://127.0.0.1:<port>` (loopback).

Key facts already verified against `@jmfederico/pi-web@1.202607.3` source (cloned at
that tag to `/tmp/pi-web-research` during design research — re-clone if that dir is
gone):
- `POST /sessions {cwd, startupToken}` takes a raw absolute path, no pre-registration.
- `POST /sessions/:id/prompt` is fire-and-forget (`{accepted:true}` immediately).
- No blocking/long-poll variant exists anywhere — polling `/status` or holding the
  `/events` WebSocket open for `agent.end` is the only completion signal.
- `GET /status` is booleans (`isStreaming`, `isCompacting`, `pendingAsk`,
  `pendingDialogs`, ...), not an enum. Turn-complete = `isStreaming === false &&
  pendingAsk === undefined`. `pendingAsk` set instead means the agent is blocked on a
  question — a distinct state from success/failure, must be surfaced as such, not
  swallowed into a timeout or misread as failure.
- `GET /messages` is guaranteed consistent with `agent.end`/`isStreaming:false` — no
  race (both come from the same in-memory session object, published synchronously).

## Plan
1. [ ] `modules/piwebClient.ts`: `startSession(cwd, startupToken?)`,
   `setModel(sessionId, provider, modelId)`, `prompt(sessionId, text)`.
2. [ ] Completion wait-loop: prefer the `/events` WebSocket for `agent.end`; fall back to
   polling `/status` on a short interval if the socket drops. Return a discriminated
   result: `{status: "done", messages}` | `{status: "blocked-on-human", pendingAsk}` |
   `{status: "error", detail}`.
3. [ ] `getMessages(sessionId)` wrapper + a helper to pull the last assistant message's
   text back out (for envelope parsing in M-063/M-066).
4. [ ] Integration test against the real, running `pi-web` container on
   `local-ai-machine` (not a mock) — start a session, set model to
   `local-litellm`/`medium-moe`, send a trivial prompt, confirm the wait-loop returns
   `done` with the expected message content. Use a scratch/throwaway `cwd` so this
   doesn't pollute a real project's session history.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
