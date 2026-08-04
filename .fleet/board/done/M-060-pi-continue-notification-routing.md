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
   from the published image, not a source checkout. **Done** (agent
   capacity recovered) — findings below.
4. [x] Investigate the browser/client side as a second candidate seam.
   **Verdict: a real "notifications inbox" architecture exists
   client-side, but confirmed its only filtering logic is unrelated
   transport deduplication, not content-based — no usable seam found
   here either.** Findings below.
5. [x] Write up findings and a recommendation — below.

### Findings: server-side patch feasibility (item 3, 2026-08-03)

- **What `notify` does today**: `sessionUiContext`'s `notify` closure
  (`piSessionService.js:2312-2379`) records the message into a
  `notificationStore` (drives the persistent inbox) and publishes it as a
  `command.output` event (drives the toast). No branching on message
  content or source today — every call takes the identical path.
- **The diversion logic itself would be small**: wrapping the closure body
  in a pattern-match check before the existing store/publish calls is
  genuinely a ~5-10 line, single-function change. Confirmed nothing else
  in the 3526-line file needs to move.
- **The real blocker isn't the patch, it's identity.** Traced the full
  call chain into `@earendil-works/pi-coding-agent`'s `ExtensionRunner`
  (a *separate* npm dependency, not pi-web's own code):
  `createContext()` builds one shared `ctx` object reused across every
  extension, and `emit()` loops that same `ctx` over all extensions
  without ever threading the emitting extension's identity into `ctx.ui`
  or into `notify`'s arguments. **Confirmed, not inferred, by reading both
  files directly: there is no source-extension identifier available at
  the point a `notify()` call reaches pi-web's Proxy, today, at all.**
  So "scope this to only pi-continue's notifications" is unavoidably
  message-text-pattern matching — the exact fragility already flagged in
  the item-2 inventory — regardless of where the patch lives. A patch
  doesn't buy a clean identity-based guarantee; getting one would require
  *also* patching `pi-coding-agent` itself, a materially bigger ask.
- **Correction to this card's earlier assumption**: `jmfederico-pi-web/Dockerfile`
  does `RUN bun install -g @jmfederico/pi-web` (the published npm
  package) — not `FROM ghcr.io/jmfederico/pi-web:latest` as this card
  previously assumed by analogy with the base image tag used elsewhere.
  No existing vendoring/patch infrastructure exists in the Dockerfile or
  entrypoint today.
- **Patch mechanism, if pursued**: a build-time `RUN node -e "..."` (or
  `sed`) step against the installed `dist/server/sessions/piSessionService.js`,
  appended after the existing install step — matches this repo's existing
  "thin wrapper + seed files" pattern far better than forking pi-web's
  actual source repo and replicating their build toolchain. Real,
  bounded fragility: anchored to specific line/string content that WILL
  drift on pi-web version bumps, but fails loudly (build breaks) rather
  than silently.

### Recommendation

**Ship what's already built (M-059's panel) and do not patch pi-web's
notify pipeline right now.** Reasoning:

1. No amount of patching gets a *clean* guarantee — even patched, this
   stays message-text matching, same fragility class already documented
   in the item-2 inventory (overlapping prefixes, dynamic interpolation).
   A patch buys "the pattern-match logic lives server-side" but not
   "reliably scoped to pi-continue only."
2. The actual user-facing goal — a real, persistent place to see handoff
   status instead of only a transient toast — is **already fully met** by
   the Continue panel (M-059), independent of whether the redundant toast
   also fires.
3. The cost side is real and ongoing: a version-anchored dist-patch that
   needs re-verification on every pi-web upgrade, for a benefit that's
   "one fewer duplicate toast," not new functionality.
4. This is a legitimate "ship now, revisit if it's actually annoying in
   practice" situation, not a "don't bother ever" — if toast duplication
   turns out to bother Chris day-to-day once he's lived with the panel a
   while, this card's research (the full notify() inventory + the patch
   mechanism assessment) is already done and ready to act on later.

Recommending this card close as "researched, deliberately not building
right now" pending Chris's sign-off — not because the question wasn't
answerable, but because the honest answer is "possible but not worth the
ongoing maintenance cost for what it actually buys."

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
- 2026-08-03 — closed: research complete (hook hunt, full notify()
  inventory, server-side patch feasibility all done, see findings
  sections above). Recommendation was to defer building this — no clean
  identity-based scoping exists at the notify() call site even with a
  patch, the actual goal (persistent handoff status) is already met by
  M-059's Continue panel, and the ongoing cost of maintaining a
  version-anchored dist-patch isn't worth it for "one fewer duplicate
  toast." Chris confirmed: passing on implementation. Research stays here
  for later if toast duplication proves actually annoying in practice.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Nothing left to do — research complete, Chris declined to implement. If
this gets picked up again later, everything needed is already in this
card: the full notify() message inventory/classification table, the
pattern-matching-not-exact-matching risk, and the server-side patch
mechanism (build-time dist-patch against `piSessionService.js`, not a
source fork) with its exact file/line anchors as of pi-web@1.202607.3.
