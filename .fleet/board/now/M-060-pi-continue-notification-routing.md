---
id: M-060
title: "Route known pi-continue notifications into the Continue panel instead of toasts"
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-03T22:00:00Z
blocks: null
blocked_by: null
related_cards: [M-059]
status: null
---

# M-060 — Route known pi-continue notifications into the Continue panel instead of toasts

## Context

Follow-up to M-059 (pi-continue-companion, now done). Even with the
Continue panel working and looking good, pi-continue's original toast
notifications still fire on every `/continue` — including the "Continuation
Ledger cannot open in this Pi mode." message, which is a red herring now
that the panel exists as the real way to view handoff state, and the
various save/success notices, which are just noisy given the panel already
shows current status.

Chris's explicit ask: do **not** blanket-suppress pi-continue
notifications — he's wary of losing visibility into genuine failures
(pi-continue has already been observed to fail in real ways this session:
timeouts, JSON parse errors). The request is narrower and more careful
than "turn off notifications":

1. Identify the **specific, known** notification messages pi-continue
   emits for routine/expected events (the Ledger-unsupported message, and
   whatever success/save notices it sends on a normal `/continue`).
2. Redirect *only those specific, known* messages into the Continue
   panel's own UI as status (e.g. last-handoff state, a small inline
   indicator) instead of a toast.
3. Everything else pi-continue might notify about — anything not on that
   known list, including any future/unexpected message — must keep
   bubbling up as a normal toast notification. The list should be an
   allowlist of things to *redirect*, not a blocklist of things to
   *suppress*, so nothing new or unrecognized silently goes missing.

This card is for research first — Chris was explicit: create the ticket,
then start researching, no build decision yet. The open question that
actually matters: **is this architecturally possible at all without
forking pi-web or patching `@earendil-works/pi-coding-agent`?**

## Why this is a real open question, not just "plug into the panel"

From M-059's research (carried forward, still true): `ctx.ui.notify()`
calls from an extension travel over RPC via the
`extension_ui_request`/response JSON protocol, and jmfederico-pi-web's own
**server-side** session service (`piSessionService.js`, `sessionUiContext`)
is what actually intercepts `notify`/`confirm`/`select`/`input` via a Proxy
wrapping the extension UI context — this happens in pi-web's own backend,
not in anything a browser-side PI WEB plugin gets a hook into. The
documented plugin API (`docs/plugins.md`, per M-059's research) only
exposes `actions`/`workspacePanels`/`workspaceLabels`/`files`/`terminal` —
nothing resembling "intercept an outgoing notification before it reaches
the toast UI."

So the real research question is where (if anywhere) such an interception
point exists:
- Is there a plugin-facing hook we haven't found yet (worth a fresh,
  skeptical re-read of `docs/plugins.md` specifically hunting for anything
  notification/toast-related, not just re-confirming what M-059 already
  found)?
- Does pi-web's client-side (browser) code have its own notification
  rendering path that a plugin's custom element could somehow tap into
  (e.g. a shared event bus, a DOM-level notification container plugins
  could observe/intercept client-side, even if undocumented)?
- Is this only achievable by patching pi-web's own server-side
  `sessionUiContext` Proxy (i.e. a real fork, the option M-059 explicitly
  recommended against for the panel itself) — and if so, is a *narrow*
  patch (just this one interception point) meaningfully lower-risk/effort
  than the "full TUI-in-browser" alternative M-059 ruled out, or does it
  carry the same maintenance-burden argument?
- Alternative: could pi-continue's own notify() calls be distinguished
  and matched at the message-text level from *outside* pi-web entirely
  (e.g. a thin proxy sitting between pi-web and the browser, or between
  pi-web-sessiond and pi-web-server) — is there a real seam there, or are
  these too tightly coupled in the same process pair to intercept
  cleanly?

## Plan
<!-- ordered checklist -->
1. [ ] Re-read `docs/plugins.md` end to end with a specific, skeptical eye
   for any notification/toast/event-interception hook M-059's research
   might have missed (M-059 was scoped to "how do I add a panel," not
   "how do I intercept other UI traffic" — worth not assuming the earlier
   pass was exhaustive on this specific question).
2. [ ] Inventory the actual known pi-continue notification messages worth
   redirecting — re-derive from pi-continue's source (already read
   extensively in M-059's research): every `ctx.ui.notify()` call site in
   `extensions/continue/`, its exact message text/pattern, and whether
   it's genuinely "routine/expected" (redirect-worthy) vs. a real failure
   signal (must stay a toast). Build this as an explicit table before any
   implementation.
3. [ ] Investigate pi-web's server-side `sessionUiContext` Proxy
   (`piSessionService.js`) in more depth than M-059 did — specifically
   whether it's realistic to patch just the `notify` intercept without
   touching anything else, what a fork/patch would actually look like in
   practice (file size, complexity, upstream-diff surface), and whether
   jmfederico/pi-web has any existing configuration/hook point for
   customizing notification behavior at all (check for anything like a
   notification filter, webhook, or event-emitter escape hatch in the
   docs or source before assuming a patch is the only path).
4. [ ] Investigate the browser/client side as a second candidate seam —
   does the compiled client bundle have an inspectable notification
   dispatch mechanism (a DOM custom event, a shared store) a plugin's own
   custom element could listen to and suppress/reroute client-side,
   without needing server-side changes at all? This would be strictly
   lower-risk than a server-side patch if it exists.
5. [ ] Write up findings and a recommendation (build vs. not worth it vs.
   needs a different approach entirely) — still planning/research only
   until Chris signs off on an actual implementation path.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-08-03T22:00Z — claiming, starting research into whether/where a notification-interception seam exists -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-08-03 — filed directly in now/ per Chris's explicit request, claimed
  immediately. Chris was explicit this must be an allowlist-based redirect
  of specific known messages, never a blanket suppression — genuine
  pi-continue failures (already observed multiple times this session) must
  keep surfacing as normal toasts.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Nothing researched yet beyond what M-059 already established (which is
carried forward into this card's Context section). Next step is plan item
1: a fresh, skeptical re-read of `docs/plugins.md` specifically hunting for
a notification-interception hook, since M-059's read was scoped to a
different question and may not have exhaustively ruled this out.
