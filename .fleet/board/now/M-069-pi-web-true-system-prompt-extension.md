---
id: M-069
title: pi-web-factory — true per-role system prompt via before_agent_start extension
initiative_id: null
claimed_by: null
claimed_at: null
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

1. [ ] Confirm the target hook: `@earendil-works/pi-coding-agent`'s extension API fires
   `before_agent_start` and accepts a `BeforeAgentStartEventResult` whose `systemPrompt?:
   string` field replaces the system prompt for that turn (chained if multiple
   extensions return one) — `extensions/types.d.ts:797` in the SDK, already confirmed
   present in this version. `pi-continue` itself hooks `before_agent_start` today
   (`extensions/continue/index.ts:155`) — a known-working precedent for exactly this
   integration point, in this exact stack.
2. [ ] Design the marker: how does the extension know "this is a pi-web-factory session,
   in role X" on a given turn? Leading candidate: `POST /sessions`'s existing
   `startupToken` field (already accepted by the route, documented in pi-web's own
   source as "an opaque label the caller uses to recognise its own construction's
   startup reports" — built for exactly this kind of caller-side tagging). Needs
   confirming the token is actually readable by an extension at `before_agent_start`
   time (i.e. does `ExtensionContext` expose it) — not yet verified, first real unknown
   in this plan.
3. [ ] Write `pi-web-factory-prompts` (or similar name) as a small extension package,
   built and baked into the `jmfederico-pi-web` image the same way `pi-continue-
   companion` already is (`plugins/` dir, `COPY` in Dockerfile, always-synced in
   `docker-entrypoint.sh` — see M-068's plan for the exact pattern to copy).
4. [ ] Wire `piwebClient.ts` (M-062) to pass whatever marker M-069.2 lands on, and update
   `envelopes.ts`/chain prompt construction (M-063/M-066) to drop the prepended-text
   workaround once this is confirmed working, in favor of real per-agent `system.md`-
   style content sourced the same way `factory.config.yaml`'s roster already does for
   models (M-065).
5. [ ] Verify empirically: a session started by the factory actually receives the
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

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-03 (claude): filed blocked-on-decision per Chris's explicit instruction;
  primary approach revised from an earlier in-conversation framing ("patch pi-web's REST
  API") to the `before_agent_start` extension hook after finding it during §1.4's
  research — no card was created under the old framing, so no correction needed there.

## Handoff notes
Nothing started. First real step for whoever picks this up (after Chris says go): M-069
plan item 2 — confirm `ExtensionContext` actually exposes `startupToken` or an
equivalent marker at `before_agent_start` time. Everything else in the primary approach
depends on that answer.
