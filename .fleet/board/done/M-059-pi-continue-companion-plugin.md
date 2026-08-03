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
3. [x] Deep-dive `docs/plugins.md`/`plugin-api.d.ts` and the bundled
   example plugins. Findings below.
4. [x] Pin down exactly where pi-continue's handoff/ledger data lives on
   disk and what it contains. Findings below.
5. [x] UX/visual survey of pi-web's existing native panels. Findings below
   (with one caveat: no real screenshot, structural/CSS-token inference
   only — see "Open items" below).
6. [x] Concrete implementation plan written below — still planning only,
   no code written, per Chris's explicit instruction.
7. [x] Naming confirmed by Chris: **pi-continue-companion**.

### Findings: pi-web's plugin API (round 2 research, 2026-08-03)

Two research agents ran in parallel: one on the plugin API + UX survey,
one on pi-continue's on-disk data shape. Full reports are in this card's
originating conversation; distilled here.

**Manifest & lifecycle.** A plugin is a `package.json` declaring
`piWeb.plugins: [{ id, module }]` plus a plain JS module (no build step
required) default-exporting `{ apiVersion: 1, name, activate }`.
`activate(context)` returns `{ contributions: { actions?, workspacePanels?,
workspaceLabels? } }`. Runs **browser-side only** — no server/session-daemon
hook, no access to session event/message/compaction-event history, no
general filesystem API. Installed at `~/.pi-web/plugins/<id>/` (or
`$PI_WEB_DATA_DIR/plugins`). Unconditionally trusted code, no permission
model.

**Data access.** The only sanctioned data layer is a `files` helper
(`readFile`/`listFiles`/`writeFile`/`deleteFile`/`moveFile`) injected into
panel/label contexts, **scoped to the selected workspace root**
(path-traversal blocked). Confirmed live: pi-continue's handoff file sits
at `<workspaceRoot>/.pi/continue/<base64url(sessionId)>.md` — squarely
inside that scope. No special access needed.

**UI registration.** Declarative only: `workspacePanels` (tabs alongside
Files/Git/Terminal in a persistent, resizable side panel — **not modal**),
`actions` (command-palette entries), `workspaceLabels` (small inline
badges). No arbitrary routing. Rendering is **Lit** (`lit-html` tagged
templates / custom elements), not React (React is pi-web's own internal
framework, not exposed to plugins). Plugins are expected to reuse pi-web's
own CSS custom properties (`var(--pi-border-muted)`, `var(--pi-muted)`,
etc.) and shared classes (`toolbar`, `viewer`, `empty`, `muted`) rather
than bring their own styling — confirmed both by docs guidance and by the
bundled `info` plugin's real CSS.

**Near-exact template already exists**: the bundled `relays` plugin reads
markdown files from a workspace-relative directory
(`.pi-web/relays/<name>/*.md`) written by external tools, and renders them
via `files.listFiles`/`files.readFile` with sanitized markdown→HTML and
graceful empty-state handling. Structurally identical to what
pi-continue-companion needs — swap the root path
(`.pi/continue/`→ vs `.pi-web/relays/`) and add real section parsing
instead of treating each file as opaque markdown.

**Visual shell** (dark theme, GitHub-dark-like palette, CSS custom
properties — `--pi-bg`, `--pi-surface`, `--pi-accent`, `--pi-success` /
`--pi-warning` / `--pi-danger`, `--pi-border(-muted)`, `--pi-text` /
`--pi-muted` / `--pi-dim`). Layout is a persistent two-pane shell: a fixed
~340px nav sidebar + a resizable (min 360px / 42vw) workspace side panel
where tool tabs (Files/Git/Terminal/plugins) live. Not a modal-first UI.

### Findings: pi-continue's on-disk data (round 2 research, 2026-08-03)

- **Path**: `<gitProjectRoot>/.pi/continue/<base64url(sessionId)>.md` —
  keyed by session id, one file per session, **overwritten** on every
  successful handoff within that session (no history/timeline kept).
  Different files in that directory = different past sessions, not a
  timeline of one session's handoffs.
- **Content**: the exact same `briefMarkdown` prose the (broken, in
  pi-web) Ledger viewer would show — `## Task`, `## Done When`,
  `## Forbid`, `## Established`, `## Learned`, `## Open`, `## Next`
  sections, each entry a single flattened bullet
  (e.g. `- <claim> — evidence: <e>; basis: <b>; reopen: <r>` for
  Established). This is a fixed, deterministic render format
  (`renderForbidEntry`/`renderEstablishedEntry`/etc. in pi-continue's
  `blocks.ts`) — safely re-parseable by section header + bullet pattern.
- **No structured JSON is ever persisted** — the parsed `BriefEnvelope`
  object exists only transiently in pi-continue's own memory during
  synthesis, then gets flattened to markdown and discarded. A companion
  wanting a structured card-style view (not a markdown dump) must
  re-parse the markdown, not read structured data directly.
- **The Ledger's "extra" content (read/modified file lists, synthesis
  telemetry — model, tokens, cost) is genuinely RAM-only**, lost on Pi
  process restart, and was never reachable by a plugin in the first place
  (no server-side hook API for plugins, confirmed above). This is a
  **permanent, accepted gap** — pi-continue-companion can faithfully
  reproduce the persisted brief content, but not this ephemeral metadata,
  and that's fine: it's genuinely not recoverable by any means available
  to a browser-side plugin.
- Second output target: the agent guide file (default `AGENTS.md`) gets a
  full-file replacement when `agentGuideSyncMode` is on and the model
  proposed one — also plain markdown, also workspace-root-relative, also
  in scope for `files.readFile` if we ever want to show that too.
- Hygiene note, unrelated to the plugin itself: `.pi/continue/*.md` isn't
  gitignored in the test repo we checked — worth a footnote to Chris that
  projects using pi-continue may want to `.gitignore` that path, separate
  from this card's scope.

### Concrete implementation plan (still planning only — no code written)

**Package layout** (mirrors the bundled `relays` plugin):
```
pi-continue-companion/
  package.json          # piWeb.plugins: [{ id: "pi-continue-companion", module: "pi-web-plugin.js" }]
  pi-web-plugin.js       # apiVersion:1, name, activate() -> { contributions: { workspacePanels: [...] } }
  companionPanel.js      # panel logic: list + read .pi/continue/*.md via `files`, parse, render
  companionParser.js     # re-parses the fixed ## Section / bullet format back into structured entries
  companionPanelElement.js  # a custom element (like relaysPanelElement.js) for list+detail interaction
```

**Contribution type**: `workspacePanels`, not `actions` — a persistent tab
next to Files/Git/Terminal is the natural, discoverable home for "what did
my agent hand off," matching how a user would actually look for this.

**Panel behavior**:
1. `files.listFiles(".pi/continue")` → one entry per session that has ever
   handed off in this workspace. Base64url-decode each filename back to a
   session id for display/labeling (needs a friendly label — raw session
   ids aren't useful; may need to correlate against whatever session
   metadata IS available to a plugin context, or just show a truncated id
   + file mtime as a stand-in if nothing richer is exposed — this is a
   real open question, see below).
2. Selecting an entry → `files.readFile()` that file, run it through
   `companionParser.js` to recover structured `task`/`done_when`/
   `forbid[]`/`established[]`/`learned[]`/`open[]`/`next[]` groups, render
   as distinct visual sections (not a raw markdown dump) — e.g. a
   task/done-when header, then collapsible or clearly-separated
   Established/Learned/Open/Next groups, each entry a small card-like row
   rather than a flat bullet list. This is where "nice experience, makes
   sense visually" actually gets delivered — leaning on the same visual
   language as pi-continue's own rendered sections but as real DOM
   structure instead of markdown text.
3. Empty state (no `.pi/continue/` directory yet) — reuse the `empty`
   class convention already established by other bundled panels, with a
   short explanation of what this panel is for.
4. Styling: `toolbar` (panel header, maybe a refresh/list-vs-detail
   toggle) + `viewer` (scrollable content) class conventions, `var(--pi-*)`
   tokens throughout, no new component library.

**Distribution/install path while iterating**: develop as a local plugin
directly under `~/.pi-web/plugins/pi-continue-companion/` on the box
(no build step needed per the docs), same low-friction loop used for
everything else this session. Spin into its own repo later, once proven
out, per Chris's stated intent — nothing about the plugin API requires
npm-registry distribution during development.

### Open items / things to resolve before or during implementation

1. **Session labeling**: need to confirm what identifying info (if any)
   a `workspacePanels` context exposes about the *currently open* session,
   so the panel could default to/highlight "this session's" handoff
   rather than just listing raw session ids. Not yet confirmed either way
   — worth a quick follow-up read of the full `WorkspacePanelContext`
   type (`dist/plugin-api.d.ts`) before implementation starts, rather than
   assuming.
2. **No verified screenshot** — the visual design above is based on CSS
   custom properties, class-name conventions, and the bundled `info`/
   `relays` plugins' real markup, not an actual rendered look. Worth a
   real look (e.g. local browser via SSH port-forward, or any
   screenshot-capable tool) before finalizing visual details, though the
   design-token-based approach should already look native even
   unverified.
3. Not yet decided: does the panel also show the agent-guide
   (`AGENTS.md`) replacement content when `agentGuideSyncMode` writes one,
   or stay scoped to just the continuation brief? Leaning toward brief-only
   for a v1, agent-guide diff view as a possible follow-up.

### Built, tested, deployed (2026-08-03)

Chris confirmed the plugins.md source used was accurate before build started
— cross-checked against `github.com/jmfederico/pi-web/blob/main/docs/plugins.md`
directly (the hosted `pi-web.dev/plugins` site 403'd on fetch, GitHub source
matches the bundled npm package docs exactly, including the "no cleanup
function returned" detail a web search snippet had misleadingly implied
might differ). No drift, safe to build against.

Built via a dedicated implement agent (worktree-isolated), reviewed and
merged by hand rather than trusted blindly:

- `jmfederico-pi-web/plugins/pi-continue-companion/`: `package.json`,
  `pi-web-plugin.js` (activate() contributing a `workspacePanels` "Continue"
  tab + a command-palette action), `continueHandoffParser.js` (markdown →
  structured brief, never throws), `continueDiscovery.js`
  (`files.listFiles`/`files.readFile`-based `.pi/continue/*.md` discovery,
  base64url session-id decoding), `continuePanelElement.js` (Lit/shadow-DOM
  custom element, list+detail, modeled closely on the real bundled `relays`
  plugin's `relaysPanelElement.js`).
- `test/parser.test.js` + real fixture (copied live from the box's actual
  handoff file) + a hand-built minimal/empty-sections fixture. Independently
  re-ran this myself post-merge (not just trusting the build agent's report)
  — all assertions pass against real data: task/doneWhen text, 0 Forbid
  (section legitimately absent that day), 11 Established, 3 Learned, 1 Open,
  4 Next, every sub-field correctly extracted. One real bug the build agent
  found *during its own testing* and fixed: a naive `;`-split on the
  "key: value; key: value" tail truncated an Open entry's `verifies:` value
  at an internal semicolon present in the real data — fixed with
  field-name-boundary-aware splitting, regression-tested.
- Deployment: `Dockerfile` bakes the plugin into
  `/app/.pi-web/plugins-seed/pi-continue-companion`; `docker-entrypoint.sh`
  does an always-overwrite sync into `$PI_CODING_AGENT_DIR/plugins/` on every
  container start (deliberately NOT the seed-once pattern used for
  settings.json/models.json — this is our own actively-developed code, must
  never go stale on restart).
- Code-reviewed the diff by hand before merging (not just the agent's
  self-report): confirmed `pi-web-plugin.js`'s `activate()`/contribution
  shape matches the verified API exactly, confirmed the Dockerfile/entrypoint
  wiring is correct. Found and fixed one cosmetic nit myself (missing
  `"type": "module"` in package.json causing a Node ESM-detection warning
  when running the test directly — harmless to the actual browser-side
  plugin runtime, just noisy for local test runs).
- Merged to `main` (commit `aaf4af7`), pushed, box's git checkout
  fast-forwarded to match, then **rebuilt jmfederico-pi-web from that
  official checkout** (not the build agent's scratch build, which
  intentionally avoided touching the box's git state) — `docker compose up
  -d --build jmfederico-pi-web`.
- **Live verification, post-official-rebuild**: `pi-web` container up,
  zero errors/exceptions in logs, plugin files present at
  `/home/piweb/.pi-web/plugins/pi-continue-companion/`, and
  `/pi-web-plugins/manifest.json` lists it: `{"id":"pi-continue-companion",
  "source":"local","scope":"local","machineSpecific":false}`, alongside the
  bundled `info`/`relays`/`updates`/`workspace-tasks` plugins — pi-web's own
  plugin loader recognizes it correctly.
- Minor known non-issue: the deployed plugin directory includes the `test/`
  folder (Dockerfile COPYs the whole plugin dir) — harmless bloat, pi-web's
  loader only reads the declared `module` entry point, not worth a
  `.dockerignore` for such a small file set right now.

**Still unverified — genuinely needs a human or a browser-capable tool**:
actual visual rendering, panel-tab placement/styling in the real UI, and
interactive behavior (clicking a handoff row, list↔detail navigation,
refresh). No browser automation tool was available in this environment for
either the build agent or me. Chris should open pi-web
(`http://<box>:8080`) and check the "Continue" tab in the workspace side
panel directly — that's the one thing this card cannot self-certify.

### Visual confirmation (2026-08-03)

Chris opened pi-web and confirmed the "Continue" tab looks and works
great — fits the existing UI, renders the parsed handoff sections as
intended. The one gap neither the build agent nor I could self-certify
(actual rendering) is now closed. Nothing further outstanding on this
card; ready to close.

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
- 2026-08-03 — closed: built, tested (parser verified against real data,
  one real bug found and fixed), deployed (merged to main, rebuilt from
  the official checkout on the box, confirmed live in pi-web's own plugin
  manifest), and now visually confirmed working by Chris in the actual
  UI. All plan items complete, no open blockers.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Nothing built yet — this is planning-only per Chris's explicit instruction.
Next step is plan item 3: read `docs/plugins.md`/`plugin-api.d.ts` in full
(available inside the running `pi-web` container on `local-ai-machine`,
under `@jmfederico/pi-web`'s installed package — see the prior research
agent's file list in this conversation's history for exact paths) to
determine what a plugin can actually see/do before designing the panel.
