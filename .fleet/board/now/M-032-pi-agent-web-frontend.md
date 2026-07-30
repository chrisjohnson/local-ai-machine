---
id: M-032
title: pi-agent experiment — web frontend (session list + streaming chat view)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-031
status: null
related_cards: [M-030, M-031, M-033, M-034]
---

# M-032 — pi-agent experiment — web frontend (session list + streaming chat view)

## Context
The one Turnstone UX property the user explicitly wants to keep: track and
drive agent sessions from a browser, including from their phone. This card
is the client for M-031's supervisor API.

`pi-mono` ships a `packages/web-ui` component library, but its default/example
mode ("Direct Mode") runs the agent loop *in the browser* against IndexedDB —
the opposite of what we're building (server-side persistent sessions via
M-031). Check whether `pi-web-ui`'s components can be pointed at a remote
backend instead of Direct Mode before deciding to reuse it — if that wiring is
unclear or fights the library's assumptions, a small bespoke page (session
list, transcript view with streaming, message input, polling or WS) is very
likely faster and more reliable than fighting someone else's browser-side
storage model. Prefer working-and-simple over "correctly" reusing pi-web-ui.

## Plan
1. [ ] Check `packages/web-ui`'s source/docs for a non-Direct-Mode / custom
   backend wiring path. Time-box this — if it's not straightforward within
   ~30-45 min of investigation, build a minimal bespoke frontend instead
   and move on.
2. [ ] Build the frontend: list of sessions (status, last activity), open a
   session to see full transcript with live streaming as new events arrive,
   an input box to send a new message, and a way to create a new session
   (picking the model — just `coder` is fine for v1).
3. [ ] Confirm it's usable from a phone browser: responsive layout, no
   desktop-only interactions required (hover-only controls, etc).
4. [ ] No auth, no login — per explicit user instruction for this experiment.

## Signals

## Decision log

## Handoff notes
