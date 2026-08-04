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
1. [x] Re-read `docs/plugins.md` + the real `dist/plugin-api.d.ts` types
   (not just prose) for any notification/toast/event-interception hook.
   **Verdict: confirmed none exists.** Findings below.
2. [x] Inventory the actual known pi-continue notification messages.
   **Done — full table below.**
3. [ ] Investigate pi-web's server-side `sessionUiContext` Proxy
   (`piSessionService.js`) in more depth — patch feasibility, surface
   size, and how it'd actually get maintained given the Dockerfile builds
   from the published image, not a source checkout. **Not done** — the
   dedicated research agent for this failed to launch (session rate
   limit / classifier unavailable, 2026-08-03 ~22:15). Needs to be
   resumed once agent capacity returns; see Handoff notes.
4. [x] Investigate the browser/client side as a second candidate seam.
   **Verdict: a real "notifications inbox" architecture exists
   client-side, but confirmed its only filtering logic is unrelated
   transport deduplication, not content-based — no usable seam found
   here either.** Findings below.
5. [ ] Write up findings and a recommendation — blocked on item 3.

### Findings: no interception hook exists (items 1 & 4, 2026-08-03)

Done by hand (research agents were unavailable — see Handoff notes) via
direct `ssh`/`grep` against the box.

- **`dist/plugin-api.d.ts`** (the real TypeScript types, not the docs'
  prose restatement) — grepped for `notify|notification|toast|EventTarget|
  addEventListener|emit|subscribe`: **zero matches**. `docs/plugins.md`
  itself has exactly one hit for any of those terms, and it's about a
  plugin cleaning up *its own* event listeners in `disconnectedCallback()`
  — unrelated. The documented/typed plugin API genuinely has no concept
  of observing or filtering another extension's UI traffic.
- **Client bundle** (`dist/client/assets/index-LME0LfPb.js`, pi-web's
  actual compiled frontend) — does have a real internal "notifications
  inbox" architecture: a structured store with `severity`/`message`/`id`
  per notification, `applyInboxEvent`, `dismissNotification`,
  `dismissAllNotifications`, delta kinds (`added`/`dismissed`/`cleared`/
  `resync`). Promising at first glance — but the one filtering function
  that exists, `shouldFilterLegacyNotification(e, t) { return t !== void 0
  && t !== "" && this.machineSupportsNotifications(e) }`, turned out to be
  purely about **avoiding double-delivery** of the same event across two
  transport paths (an older `command.output`-embedded style vs. the newer
  structured inbox) — not content-based filtering by message text or
  source extension. No plugin-reachable hook into this store was found
  either (it's internal app state, not exposed via anything in
  `plugin-api.d.ts`).
- **Combined verdict**: no documented, typed, or even semi-legitimate
  reachable seam exists for intercepting/redirecting another extension's
  notifications — neither server-side (per M-059's own earlier finding
  that `sessionUiContext`'s Proxy is pi-web's own backend code, not
  plugin-reachable) nor client-side. If this is buildable at all, it
  requires patching pi-web's own source — which is exactly what item 3
  needs to assess concretely (surface size, maintainability) before
  recommending for or against.

### Findings: pi-continue's notify() inventory (item 2, 2026-08-03)

Important correction to the original plan: a naive `grep '\.notify('`
**misses real call sites** — several routine messages (including "saving
handoff" and "resume request sent", both directly observed this session)
go through a shared `notify(ctx, message, severity)` helper function
(defined `resume-proof.ts:60`, wrapping `ctx.ui.notify` — bare function
calls, no leading dot) rather than calling `ctx.ui.notify` inline. Full
inventory below combines both call styles.

| Call site | Message (📎 = dynamic/interpolated) | Severity | Classification | Notes |
|---|---|---|---|---|
| `runtime.ts:241` | 📎 `${label}: saving handoff${triggerText}.` | info | **(a) routine** | Matches observed "saving handoff" notice |
| `runtime.ts:287` | 📎 `${label}: handoff saved.` | info | **(a) routine** | Success confirmation |
| `resume-proof.ts:174` | 📎 `${pending.label}: resume request sent.` | info | **(a) routine** | Matches observed "resume request sent" |
| `index.ts:401` | "Agent guide unchanged; no full replacement was produced." | info | **(a) routine** | Expected no-op outcome |
| `index.ts:374` | 📎 `Could not open Continuation Ledger: ${reason}` | **error** | **(b) known limitation** | Severity is "error" despite being purely an unsupported-mode notice — exactly the message Chris flagged as a red herring. `${reason}` is usually literally "Continuation Ledger cannot open in this Pi mode." from ledger-viewer.ts:188, but NOT always (see next row) |
| `ledger-viewer.ts:188` | "Continuation Ledger cannot open in this Pi mode." | warning | **(b) known limitation** | The stable, RPC-mode-specific reason string — safe to match on |
| `ledger-viewer.ts:181`/`184` | "Continuation Ledger could not open." | warning | **ambiguous — do not auto-classify** | A *different*, more generic open failure (not the "wrong Pi mode" case) — could indicate a real bug. Must not be conflated with the row above despite similar wording |
| `ledger-viewer.ts:175` | "No Continuation Ledger has been created in this session yet." | warning | **(a)/(b) borderline, lean routine** | Empty-state, not a failure |
| `commands.ts:89` | 📎 `${title} panel cannot open in this Pi mode.` | warning | **(b) known limitation** | Same RPC-mode pattern, generalized to palette/preview panels — needs suffix-pattern matching (`... panel cannot open in this Pi mode.`), not exact-string, since `${title}` varies |
| `runtime.ts:272` | 📎 `${label}: handoff failed: ${reason}` | **error** | **(c) real failure — never redirect** | The actual failure path (timeouts, parse errors, etc.) |
| `resume-proof.ts:232` | 📎 `pi-continue: handoff failed: ${reason}` | **error** | **(c) real failure** | A second, differently-prefixed "handoff failed" message — same fragility risk noted below |
| `resume-proof.ts:114` | 📎 `${resumeStart.label}: resume request failed.` | error | **(c) real failure** | |
| `resume-proof.ts:181` | 📎 `${pending.label}: resume request failed: ${PROMPT_DISPATCH_FAILURE}` | error | **(c) real failure** | |
| `runtime.ts:207` | "A continuation handoff is already being saved." | warning | **(c) real signal** | Double-trigger guard — user should know |
| `runtime.ts:215` | "The previous continuation is still resuming; no new handoff was started." | warning | **(c) real signal** | |
| `runtime.ts:227` | "pi-continue paused before another over-limit model request. Review /continue status before retrying." | error | **(c) real failure** | |
| `index.ts:212` | "pi-continue summarized a provider-unsafe kept suffix before resuming." | warning | **(c) real signal** | Unusual/edge-case handling notice, not routine |
| `index.ts:214` | "pi-continue moved the handoff to a safer checkpoint before resuming." | warning | **(c) real signal** | Same |
| `index.ts:397` | 📎 `Could not update ${pending.label}: ${OUTPUT_WRITE_FAILURE}` | error | **(c) real failure** | |
| `command-runner.ts:22` | "pi-continue is disabled. Re-enable it with /continue settings." | warning | **(c) real signal** | Important state, must stay visible |
| `runtime.ts:396` | "Queued continuation for the next idle point." | info | **(a) routine, lower priority** | Not yet observed this session but same "expected outcome" shape as the others |
| `mid-run-guard.ts` (`notifyNoCompactableSession`) | not yet read in full | — | **needs follow-up** | Function exists, exact message text not captured in this pass |
| `pi-threshold-settings.ts:47`/`64`, `commands.ts:194/224/334/374/381/389` | various | warning/info | **(c) real signal (mostly)** | Direct responses to the user's *own* `/continue settings`/`/continue reset`/`/continue preview` commands — not automatic background noise, so lower priority for redirect regardless of classification; keep as-is unless Chris says otherwise |

**Key implementation risk, flagged as originally anticipated**: several
"routine" and "real failure" messages share overlapping label prefixes
and both interpolate dynamic content (`${label}`, `${reason}`,
`${title}`) — e.g. `runtime.ts:272` and `resume-proof.ts:232` are BOTH
"handoff failed: ..." patterns with different prefixes. **Exact
full-string matching will not work reliably.** Any implementation needs
stable prefix/suffix pattern matching per row (e.g. match on
`: saving handoff` / `: handoff saved.` / `: resume request sent.` as
suffixes, and the ledger/panel "cannot open in this Pi mode." pattern
specifically) — never match on the interpolated `${reason}` content
itself, since that's exactly the part that must stay visible when it's a
real failure.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-08-03T22:00Z — claiming, starting research into whether/where a notification-interception seam exists -->
<!-- signal: claude 2026-08-03T22:20Z — items 1,2,4 done by hand after research agents hit a session rate limit; item 3 (server-side patch feasibility) still open, needs agent capacity to resume -->

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
Plan items 1, 2, and 4 are done (see findings sections above) — done by
hand via direct ssh/grep against the box after three research agents were
launched but two failed outright ("claude-sonnet-5 is temporarily
unavailable, so auto mode cannot determine the safety of Agent") and the
third returned essentially nothing (6 tool calls, no real findings,
apparently cut short by the same rate-limit event) — this was a session
capacity issue, not a real finding, so don't treat that agent's
"completed" status as informative.

**Next step**: plan item 3 — pi-web's server-side `sessionUiContext`
Proxy patch feasibility. The prompt already written for this (in this
conversation's history, agent description "Assess pi-web server-side
notify patch feasibility") is still valid and can be reused verbatim once
agent capacity returns; it wasn't wrong, it just never got to run. Key
questions it needs to answer: (1) is there already a per-notify
"which extension" identifier available in `sessionUiContext`'s call
chain (needed to scope any patch to "only pi-continue," not every
extension's notifications), (2) how large/invasive would the actual patch
be, (3) given `jmfederico-pi-web/Dockerfile` builds from the *published*
`ghcr.io/jmfederico/pi-web:latest` image (not a source checkout) — would
this require a real upstream source fork + our own image build, or is a
build-time dist-patching step (sed/node against the installed `dist/` JS)
realistic, and (4) the honest "is this worth it at all" comparison against
just letting redundant toasts fire alongside the now-working Continue
panel (M-059) without touching pi-web's notify pipeline.

Once item 3 has real findings, item 5 (write up a recommendation) should
be quick — the hard research is the patch-feasibility question, everything
else is already in hand.
