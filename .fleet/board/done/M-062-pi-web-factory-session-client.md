---
id: M-062
title: pi-web-factory — piwebClient.ts (session lifecycle + completion wait-loop)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T04:25:52Z
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
1. [x] `modules/piwebClient.ts`: `startSession(cwd, startupToken?)`,
   `setModel(sessionId, provider, modelId)`, `prompt(sessionId, text)`.
2. [x] Completion wait-loop: prefer the `/events` WebSocket for `agent.end`; fall back to
   polling `/status` on a short interval if the socket drops. Return a discriminated
   result: `{status: "done", messages}` | `{status: "blocked-on-human", pendingAsk}` |
   `{status: "error", detail}`.
3. [x] `getMessages(sessionId)` wrapper + a helper to pull the last assistant message's
   text back out (for envelope parsing in M-063/M-066).
4. [x] Integration test against the real, running `pi-web` container on
   `local-ai-machine` (not a mock) — start a session, set model to
   `local-litellm`/`medium-moe`, send a trivial prompt, confirm the wait-loop returns
   `done` with the expected message content. Use a scratch/throwaway `cwd` so this
   doesn't pollute a real project's session history.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:25Z — claiming, starting piwebClient.ts -->
<!-- signal: claude 2026-08-04T05:05Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): confirmed live against the real server (not just source-read)
  that `POST /model` returns a full `SessionStatus`, not a bare ack, and that `GET
  /messages` with no query params returns a bare `SessionMessage[]` (paging params
  switch it to a `{messages,start,total}` shape) — neither was fully nailed down in
  the design doc, both now encoded in the client's return types.
- 2026-08-04 (claude): found and handled a real Bun-specific wrinkle not mentioned
  anywhere in prior research — Bun delivers WebSocket text frames as `Buffer`
  payloads, not JS strings, so `event.data` needed explicit decoding
  (`bufferLikeToText`, handling `ArrayBuffer`/typed-array/`Blob`/Node-`Buffer` shapes).
  Without this the WebSocket path would have silently never matched `agent.end` and
  always fallen through to polling — verified the poll-only path independently too
  (`forcePollOnly: true`) so the fallback itself is proven, not just assumed correct.
- 2026-08-04 (claude): `DEFAULT_BASE_URL` hardcodes this box's LAN IP
  (`http://192.168.1.21:8080/api`) as a dev-time convenience — `baseUrl` is a
  parameter on every function, so this is not load-bearing; M-066/M-068 will supply
  the real value (loopback, once baked into the container) rather than relying on
  this default.
- 2026-08-04 (claude): verified independently before committing — reran `tsc --noEmit`
  (clean), the unit tests (4 pass), and the live integration test myself (1 pass,
  3.95s), then confirmed via `GET /sessions?cwd=/tmp` that the test's scratch session
  was actually archived+deleted afterward, not just claimed to be.

## Handoff notes
`waitForCompletion(baseUrl, sessionId, opts?)` is the main entrypoint M-066's chain
orchestration will call after `prompt(...)`. `lastAssistantText(result.messages)` is
what M-063's envelope parsing will feed its JSON parser. Not yet wired to
`tracer.ts` (M-061) — that wiring is M-066's job, this card intentionally kept the
client standalone/testable in isolation.
