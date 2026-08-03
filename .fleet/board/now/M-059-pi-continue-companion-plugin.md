---
id: M-059
title: "pi-continue-companion: native pi-web plugin for pi-continue's Ledger/handoff UI"
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-03T21:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-059 — pi-continue-companion: native pi-web plugin for pi-continue's Ledger/handoff UI

## Context

Chris asked what it would take to get pi-continue's UI (the Continuation
Ledger overlay, the `/continue` action palette, the preview panel) working
inside jmfederico/pi-web's web UI, since today it fails with "Continuation
Ledger cannot open in this Pi mode." This card tracks the planning work
(research + design), not implementation yet — Chris was explicit: plan
first, don't build.

Working name for the eventual artifact: **pi-continue-companion**. If it
works out well, Chris wants to spin it off into its own repo rather than
keep it nested here.

### Research so far (2 parallel research agents, 2026-08-03)

**The actual blocker is structural, one layer above both pi-continue and
pi-web**, in `@earendil-works/pi-coding-agent`'s RPC-mode implementation:

- pi-continue's Ledger viewer / palette / preview panel all depend on
  `ctx.ui.custom()` — a Pi extension API whose contract requires an actual
  `pi-tui` terminal-rendering `Component` (real render buffers, keyboard
  input handling), not a portable/serializable UI spec. Everything else
  pi-continue uses (`notify`/`select`/`confirm`/`input`) already works
  fine in RPC mode — confirmed pi-continue's core handoff mechanism
  (save/compact/resume) does **not** depend on any of the broken surfaces.
  It's a UX nicety gap, not a functional one — the thing Chris actually
  needed (handoffs working) is already working.
- Confirmed from both sides of the wire: jmfederico-pi-web's own session
  service (`piSessionService.js`, `sessionUiContext`) wraps the extension
  UI context in a `Proxy` that only intercepts `notify`/`confirm`/`select`/
  `input` — `custom` falls through untouched to Pi's own RPC-mode default,
  which is hardcoded to return `undefined` without ever invoking the
  extension's render callback (`@earendil-works/pi-coding-agent`'s own
  `docs/rpc.md`, "Extension UI Protocol" section, confirms this by name).
  There is no wire format for `custom()` to travel over RPC at all today.
- So: no pi-continue-side extension code, and no jmfederico-pi-web-side
  config/plugin, can make `ctx.ui.custom` itself start working under RPC
  mode. That would require an actual protocol change upstream in
  `@earendil-works/pi-coding-agent` (affects every RPC host, not just
  pi-web) — out of scope for us to depend on.

**jmfederico-pi-web has its own, separate, legitimate plugin system**
(confirmed via its real upstream repo, `github.com/jmfederico/pi-web`,
npm `@jmfederico/pi-web`, docs at `docs/plugins.md` inside the installed
package) — explicitly **not** the same thing as a Pi extension. Direct
quote from their docs: *"Pi extensions are runtime modules loaded by the
session daemon... They are not PI WEB plugins."* A PI WEB plugin is a
trusted, browser-side ES module under `~/.pi-web/plugins/<id>` with a
`pi-web-plugin.ts` manifest — a real, generic extensibility point, but
an existing Pi extension (pi-continue) can't automatically hook into it;
someone has to author a bespoke companion plugin.

**Recommended direction**: build pi-continue-companion as one of these PI
WEB plugins — not by bridging `ctx.ui.custom()` (permanently a dead end
under RPC), but as an independent view that reads whatever pi-continue
already persists to disk (handoff artifacts, e.g. the `.pi/continue/<id>.md`
files and compaction-event data seen earlier the same day this card was
filed) and renders it natively inside pi-web's own UI.

**Minor doc-accuracy correction found along the way** (not blocking, low
priority): `pi-web/docker-entrypoint.sh`'s comment attributing something
to "pi-web's own `lib/rpc-manager.ts`" is factually wrong — no such file
exists upstream in `jmfederico/pi-web` (confirmed via GitHub code search,
0 results); the actual RPC machinery lives in the
`@earendil-works/pi-coding-agent` dependency instead.

### Answering Chris's original framing directly

- **A Pi extension?** No — pi-continue already is one, and already tries
  this; it's blocked upstream of anything an extension can control.
- **A jmfederico-pi-web plugin?** Yes — this is the viable path, via their
  documented, generic PI WEB plugin system, built as an independent
  companion rather than a `ctx.ui.custom()` bridge.
- **A fork of jmfederico-pi-web?** Not needed for the plugin path. Would
  only become relevant for a much more invasive alternative (running Pi
  in real TUI mode inside an embedded browser terminal instead of RPC
  mode) — not recommended, conflicts with pi-web's whole RPC-based
  architecture and would likely mean giving up its native UI.

## Plan
<!-- ordered checklist -->
1. [x] Establish why the Ledger/palette/preview fail under pi-web (RPC-mode
   `ctx.ui.custom()` stub) and confirm the core handoff mechanism is
   unaffected.
2. [x] Confirm jmfederico-pi-web's real upstream repo and its own plugin
   system as the viable integration point (vs. extension-side or
   protocol-side fixes).
3. [ ] Deep-dive `docs/plugins.md` / `plugin-api.d.ts` (and the bundled
   example plugin, `pi-web-plugins/info`) for: what data/API hooks a
   plugin actually gets (session list? session events/messages? a way to
   read files under a session's working directory or PI_CODING_AGENT_DIR?
   a way to register a new panel/route/nav entry in pi-web's own UI
   chrome?), and the manifest/lifecycle shape required.
4. [ ] Pin down exactly where pi-continue's handoff/ledger data actually
   lives on disk at the point a plugin could read it (which file(s), what
   shape, keyed by session how) — re-examine `pi-continue`'s
   `continuation-event.ts` / `details.ts` / wherever it writes
   `.pi/continue/<id>.md` and any session/compaction-event JSON, from the
   companion-plugin's read side rather than the extension's write side.
5. [ ] UX/visual design pass: survey pi-web's existing native panels
   (Models, session browser, etc. — whatever Chris noticed) for their
   actual look/interaction patterns (modal vs. side panel vs. inline,
   theming, nav placement) so pi-continue-companion's panel fits in
   rather than looking bolted-on. Sketch what it should actually show
   (raw ledger text? a structured task/brief/next-steps view matching
   pi-continue's own `brief` schema fields — task, done_when, forbid,
   established, learned, open, next?).
6. [ ] Write up a concrete implementation plan (file layout, manifest,
   data-reading approach, rendering approach) — still planning only, no
   code, until Chris signs off.
7. [ ] Naming: working name is "pi-continue-companion" — confirm before
   any repo/package scaffolding exists, since Chris is already thinking
   about spinning it into its own repo if it works out.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-08-03T21:00Z — claiming, starting deep-dive into pi-web's plugin API and pi-continue's on-disk ledger data -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-08-03 — filed directly in now/ per Chris's explicit request to track
  this planning work; captured the two parallel research agents' findings
  from the same conversation as the starting context.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Nothing built yet — this is planning-only per Chris's explicit instruction.
Next step is plan item 3: read `docs/plugins.md`/`plugin-api.d.ts` in full
(available inside the running `pi-web` container on `local-ai-machine`,
under `@jmfederico/pi-web`'s installed package — see the prior research
agent's file list in this conversation's history for exact paths) to
determine what a plugin can actually see/do before designing the panel.
