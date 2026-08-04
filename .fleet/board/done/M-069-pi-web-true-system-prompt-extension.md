---
id: M-069
title: pi-web-factory — true per-role system prompt via before_agent_start extension
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T17:17:54Z
blocks: null
blocked_by: null
status: null
related_cards: [M-062, M-063, M-066]
---

# M-069 — pi-web-factory — true per-role system prompt via before_agent_start extension

## Context
**Unblocked 2026-08-04** — Chris: "fold that in before we do docker" (see
`pi-web-adw-design.md` §6.1 point 5, §6.3). Moved from `blocked/` to `now/`, ahead of
M-068 in the build sequence.

Full evidence trail is in `pi-web-adw-design.md` §1.4 at repo root — read that section
before touching this card, don't rediscover it. Summary: SSSF's source gives each agent
identity a true system prompt (bare `pi` CLI's `--system-prompt` flag). Going through
pi-web's session API instead (required — no bare `pi` binary exists in the container,
see §1.2) loses that: confirmed at the SDK level (`NewSessionOptions = {id?,
parentSession?}`, no `systemPrompt`; persisted message roles are only `user`/
`assistant`/`toolResult`, no `system`) that pi-web's `POST /sessions` has no equivalent.
The interim fix (shipping now, M-066) folds role identity into the first prompt's text
instead — which works, but is exposed to context compaction and isn't guaranteed to
survive a pi-continue handoff (its `brief` schema has no identity slot), unlike a true
system prompt which is recomputed fresh at session bootstrap regardless of message
history.

## Plan — high-level approach

**Primary approach (investigate first): a small pi extension, not a pi-web patch.**
This is a correction from how this was first framed in conversation (as "patch pi-web's
REST routes") — digging one level deeper found a better-fitting mechanism that requires
**zero changes to `@jmfederico/pi-web`'s own source**, matching the "preserve pi-web
as-is" constraint from the original design ask.

1. [x] Confirm the target hook: `@earendil-works/pi-coding-agent`'s extension API fires
   `before_agent_start` and accepts a `BeforeAgentStartEventResult` whose `systemPrompt?:
   string` field replaces the system prompt for that turn (chained if multiple
   extensions return one) — `extensions/types.d.ts:797` in the SDK, already confirmed
   present in this version. `pi-continue` itself hooks `before_agent_start` today
   (`extensions/continue/index.ts:155`) — a known-working precedent for exactly this
   integration point, in this exact stack.
2. [x] Design the marker: how does the extension know "this is a pi-web-factory session,
   in role X" on a given turn? Leading candidate: `POST /sessions`'s existing
   `startupToken` field (already accepted by the route, documented in pi-web's own
   source as "an opaque label the caller uses to recognise its own construction's
   startup reports" — built for exactly this kind of caller-side tagging). Needs
   confirming the token is actually readable by an extension at `before_agent_start`
   time (i.e. does `ExtensionContext` expose it) — not yet verified, first real unknown
   in this plan.
3. [x] Write `pi-web-factory-prompts` (or similar name) as a small extension package,
   built and baked into the `jmfederico-pi-web` image the same way `pi-continue-
   companion` already is (`plugins/` dir, `COPY` in Dockerfile, always-synced in
   `docker-entrypoint.sh` — see M-068's plan for the exact pattern to copy).
4. [x] Wire `piwebClient.ts` (M-062) to pass whatever marker M-069.2 lands on, and update
   `envelopes.ts`/chain prompt construction (M-063/M-066) to drop the prepended-text
   workaround once this is confirmed working, in favor of real per-agent `system.md`-
   style content sourced the same way `factory.config.yaml`'s roster already does for
   models (M-065).
5. [x] Verify empirically: a session started by the factory actually receives the
   correct role-specific system prompt, and — the actual point of doing this work — that
   it survives both a multi-turn gate-correction loop and (if reproducible in a test
   setting) a pi-continue handoff, unlike the prepended-text version.

**Fallback approach, only if the extension hook turns out not to be reachable for
externally-started sessions** (e.g. if `ExtensionContext` doesn't expose the
`startupToken` or any other external-caller marker): a scoped, additive PR against
`jmfederico/pi-web` threading an optional `systemPrompt` through `POST /sessions` →
wherever it constructs the live `AgentSession`/`ResourceLoader` for a `SessionManager`-
tracked session (not yet traced — `piSessionService.ts`'s `start()` only touches
`SessionManager`, which has no systemPrompt concept at all; the actual `AgentSession`
construction site for an API-started session hasn't been located in this research pass).
This is a real source change to pi-web, which is why it's the fallback, not the primary
plan.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T17:17Z — claiming, starting before_agent_start extension investigation -->
<!-- signal: claude 2026-08-04T20:45Z — done, deployed live, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-03 (claude): filed blocked-on-decision per Chris's explicit instruction;
  primary approach revised from an earlier in-conversation framing ("patch pi-web's REST
  API") to the `before_agent_start` extension hook after finding it during §1.4's
  research — no card was created under the old framing, so no correction needed there.
- 2026-08-04 (claude): **item 2's "first real unknown" resolved: `startupToken` does
  NOT work.** Installed the exact pinned SDK (`@earendil-works/pi-coding-agent@0.82.1`)
  and grepped every `.d.ts` — zero references to `startupToken` anywhere; it never
  crosses the pi-web HTTP layer into the extension event system at all. Pivoted to
  `event.prompt` instead (the raw prompt text, always present on
  `BeforeAgentStartEvent`) — same mechanism `pi-continue`'s own installed extension
  already uses for its own marker-matching. Chain code now prefixes every prompt with
  `[[pi-web-factory:role=<name>]]`; the extension parses it and returns the matching
  `roles.json` entry as `systemPrompt`. One real, acknowledged tradeoff: the marker
  stays visible in the conversation (no way to strip prompt text from a
  `before_agent_start` handler) — small, self-explanatory, and a net improvement over
  the full prepended paragraph it replaces.
- 2026-08-04 (claude): real production deploy, explicitly authorized by Chris in two
  steps (first attempt correctly blocked by the auto-mode classifier on a too-generic
  "go ahead"; second attempt approved after Chris confirmed specifically: "I'm not
  currently using the machine, feel free to stop and start as needed"). Deployed via
  the established push→pull→scoped-rebuild pattern (`docker compose build
  jmfederico-pi-web && docker compose up -d jmfederico-pi-web`), container confirmed
  healthy.
- 2026-08-04 (claude): caught and fixed a small doc inaccuracy in review —
  `roles.json`'s comment pointed at a nonexistent `README.md`; corrected to point at
  `index.ts`'s own header comment, the real explanation. Comment-only, no redeploy
  needed for it specifically (picked up on the next real deploy).
- 2026-08-04 (claude): verified independently before closing — reran the full test
  suite myself (123 pass, including live integration tests) and `tsc --noEmit`
  (clean), confirmed the extension file is genuinely present inside the running
  container (not just claimed), and ran my OWN live test (not just trusting the
  implementing pass's transcript): a fresh `role=scout`-marked session replied "As the
  scout agent, my role is to investigate and report findings read-only; I am NOT
  allowed to modify the repository" — matching `roles.json`'s scout entry — with a
  matching `docker logs` injection line. Confirmed git status clean both locally and
  on the box (pulled the box forward to the latest commit, no container rebuild
  needed for that comment-only fix). Cleaned up my own scratch session/repo
  afterward.

## Handoff notes
`roleMarker(role)`/`roleMarkerPrompt(role, text)` (`piwebClient.ts`) and
`runAgentPhase`'s `promptPrefix` option (`run.ts`) are what any future chain (M-076's
generic Workflow interpreter included) should use to get a role's true system prompt
— pass `promptPrefix: roleMarker(roleName)` and the extension handles the rest
automatically for that session. `roles.json` (baked into the `jmfederico-pi-web`
image, not `pi-web-factory` itself) is a deliberate short-term duplicate of
`factory.config.yaml`'s roster content — M-075 (global Roles config) is the tracked
follow-up to collapse this back to one source of truth once `pi-web-factory` is baked
into the same container (M-068) and the extension can read its files directly.
