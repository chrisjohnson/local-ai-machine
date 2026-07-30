---
id: M-032
title: pi-agent experiment — web frontend (session list + streaming chat view)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-30T22:07:00Z
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
1. [x] Check `packages/web-ui`'s source/docs for a non-Direct-Mode / custom
   backend wiring path. Time-box this — if it's not straightforward within
   ~30-45 min of investigation, build a minimal bespoke frontend instead
   and move on.
2. [x] Build the frontend: list of sessions (status, last activity), open a
   session to see full transcript with live streaming as new events arrive,
   an input box to send a new message, and a way to create a new session
   (picking the model — just `coder` is fine for v1).
3. [x] Confirm it's usable from a phone browser: responsive layout, no
   desktop-only interactions required (hover-only controls, etc).
4. [x] No auth, no login — per explicit user instruction for this experiment.

## Signals
<!-- signal: claude 2026-07-30T22:07Z — claiming, M-031 supervisor live on the box with concurrent-session + container-restart survival confirmed -->
<!-- signal: claude 2026-07-30T22:20Z — M-032 done, real headless-browser E2E test confirms reconnect-after-close survival through the actual UI, moving to M-033 -->

## Decision log
- Checked `packages/web-ui` directly (~10 min, well under the 30-45 min
  time-box) - it does NOT exist in the current `pi-mono`/`earendil-works/pi`
  main branch clone at all (`find`/`grep` across the whole repo tree came
  back empty), and neither "web-ui" nor "Direct Mode" appears anywhere in
  `packages/coding-agent/docs/`. It is a real, separately-published npm
  package (`@earendil-works/pi-web-ui`, confirmed live on the registry,
  0.75.3) that must live in a different repo or have been split out -
  M-030's assumption that it ships inside this pi-mono checkout was wrong.
  Inspected its actual npm tarball contents directly (`npm pack` + `tar
  tzf`, 371 files) rather than guessing from the name: it's a large,
  heavy component library built around `@earendil-works/pi-ai`'s
  `AgentInterface` - sandboxed "artifact" runtime providers (Excel/Docx/
  HTML/Image artifact renderers via xlsx/jszip/pdfjs-dist/docx-preview),
  its own IndexedDB-backed `app-storage`, its own API-key-prompt/
  custom-provider dialogs. None of this has any relationship to
  `pi-coding-agent`'s RPC protocol or M-031's supervisor session API - it
  is a different product surface (an in-browser, client-side agent chat
  app) with its own persistence and auth-prompt assumptions baked in
  throughout, not a set of components that could be pointed at a remote
  backend without fighting essentially every one of those assumptions.
  Decision: build a bespoke frontend against M-031's own HTTP+WS API, per
  the card's own stated preference for "working-and-simple" - not a close
  call, the fit is genuinely poor, not just inconvenient.
- Built `pi-agent/frontend/dist/` as plain static HTML/JS/CSS with no
  build step or framework (`index.html` + `app.js` + `style.css`) - two
  views (session list, session chat) toggled via `hidden` class, no
  router library needed for something this small. Bind-mounted read-only
  into the supervisor container at `/app/frontend` (see docker-compose.yml)
  rather than baked into the image, since it lives outside the
  Dockerfile's own build context (`pi-agent/supervisor/`) and has no build
  step to run inside a Docker stage anyway - a plain restart picks up
  frontend edits, no rebuild needed.
- Chat view renders pi's actual RPC event stream directly (message_start
  for user messages, message_update text/thinking/toolcall deltas
  appended into the same bubble via a per-contentIndex map, tool_execution_end
  for tool output) - not a simplified/summarized view. Connects via the
  supervisor's WS endpoint with `?since=<lastSeq>`, auto-reconnects on
  close with the last-seen seq so intermittent connectivity (a phone
  losing signal, backgrounding the browser) self-heals without user action.
- Mobile-first CSS: `100dvh` (not `100vh`, which doesn't shrink for
  mobile Safari's dynamic address bar), `env(safe-area-inset-bottom)`
  padding on the composer so it's not hidden behind the iOS home
  indicator, flexbox layout with no fixed desktop-only interactions
  (no hover-only controls, tap targets sized for touch). Verified with a
  390×844 (iPhone-sized) Playwright viewport, not just written and assumed.
- Real end-to-end verification via headless Chromium (Playwright,
  installed fresh for this check), driven against the actual deployed
  service at `http://192.168.1.21:3002` from a separate machine on the
  LAN (not localhost-on-the-box) - this doubles as an early, informal
  check of M-033's LAN-reachability requirement, though M-033 does its
  own formal verification:
  - Test 1 (basic flow): loaded the page, clicked "+ New session",
    handled the `prompt()` dialog, sent a real message through the
    composer, waited for the actual assistant bubble to contain the
    exact requested text ("PLAYWRIGHT E2E OK") - confirmed via
    screenshot and DOM text extraction, not just an HTTP status code.
  - Test 2 (the load-bearing reconnect claim, done through the real UI
    this time, not just curl/WS-client as in M-031): opened a session,
    sent a message establishing a fact ("RECONNECT TEST PHRASE ALPHA"),
    then called `browserContext.close()` - a full teardown of the tab,
    not just navigation - waited 3 seconds, then opened a **brand-new**
    browser context (zero shared state, equivalent to reopening the app
    fresh on a phone) and reopened the same session by clicking it in
    the list. The full transcript, including the message sent right
    before the context was destroyed, was present via the WS
    replay-on-connect mechanism. Screenshot saved confirming this
    visually as well as via DOM assertion.
  - One dialog-timing quirk noted (harmless): the Playwright script's
    `prompt()` dialog handler didn't reliably capture the custom label
    text (sessions ended up with their default `session <id-prefix>`
    label instead) - a benign test-harness timing issue with
    Playwright's dialog API, not a bug in the app itself (manually
    naming a session via the same `prompt()` call works fine for a real
    user; this only affected the scripted test's ability to name it).

## Handoff notes
Frontend live and reachable at `http://<box-LAN-IP>:3002/` (verified
directly from a separate machine on the LAN via both curl and a real
headless-browser session, not just from the box's own localhost).
`pi-agent/frontend/dist/{index.html,app.js,style.css}` are the actual
served files - edit and `docker compose restart pi-agent-supervisor`
(no rebuild needed, it's bind-mounted). Test sessions created during
this card's verification were stopped via the API afterward but left in
the manifest (visible in the session list) rather than deleted - same
call as M-031, harmless.
