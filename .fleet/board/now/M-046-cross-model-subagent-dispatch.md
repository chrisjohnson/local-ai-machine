---
id: M-046
title: Cross-model sub-agent dispatch from the orchestrator role (local models + Claude Pro via pi-claude-bridge)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T22:30:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-035, M-037, M-039, M-043]
---

# M-046 — Cross-model sub-agent dispatch from the orchestrator role

## Context
Chris now has a fast, snappy `orchestrator` role (GLM-4.7-Flash, ~65-70
tok/s) as his primary pi-web interaction point, separate from the slower
`coder` role (currently laguna-s-2.1, ~12-30 tok/s depending on context —
noticeably slow to watch directly). He wants the orchestrator to delegate
specific coding tasks to the slower/bigger model (and, separately, to real
Claude Code billed against his Claude Pro subscription) and report back,
so he never has to watch the slow work happen directly. He's explicitly
fine with a hybrid shape: orchestrator reachable via pi-web, but worker
sessions doing the actual dispatched work only reachable via terminal `pi`
sessions if that's what it takes.

Two requirements bundled into this one card because they interact with
the same dispatch mechanism and should be designed together, not as
separate uncoordinated features:

1. **Cross-model sub-agent dispatch itself.** Research already done
   (this session) confirms `davis7dotsh/my-pi-setup`'s `subagents`
   extension is real, pi-CLI-level (works identically under pi-web or a
   terminal `pi` session, no UI-specific plumbing), and gives the
   orchestrator model five tools (`subagent_spawn`, `subagent_wait`,
   `subagent_check`, `subagent_cancel`, `subagent_list`). It's not a
   published package — it's Davis's personal config
   (`extensions/subagents/` + a `shared/tool-call-timeout.ts` dependency)
   that would need to be copied/adapted into this box's shared pi
   extensions location, matching the existing convention from
   M-036/M-038. It supports three backends: `pi` (in-process, fully
   provider-agnostic via pi's own `models.json`/custom-provider
   mechanism — this is the one that matters for local litellm-routed
   models), `claude` (spawns `@anthropic-ai/claude-agent-sdk` directly),
   and `codex`. Hardcoded `MAX_RUNNING = 4` concurrent subagents.

2. **Route dispatch targets through litellm roles, not raw model IDs.**
   Chris's explicit preference: "I'd rather keep model mapping out of the
   harness." This repo already has exactly the mechanism for this —
   litellm's dynamic DB-backed roles (`coder`/`judge`/`vision`/
   `orchestrator`, see M-043's terraform-`ignore_changes` design) are
   already addressable via litellm's OpenAI-compatible API exactly like
   any static model name (confirmed all session: `curl .../v1/chat/completions
   -d '{"model":"coder",...}'` works identically whether `coder` is a
   role or a literal model name — litellm doesn't distinguish). So
   `subagent_spawn`'s `model` parameter should point at a **role name**
   (e.g. `local-litellm/coder` or a new dedicated role), not a specific
   service's literal model id (e.g. `local-litellm/laguna-s-2.1-118b-q4km`)
   — swapping which real model backs the dispatch target then only ever
   needs a `set-role.sh` call, never touching pi's own `models.json` or
   the subagents extension's config.

3. **Claude Code (Pro subscription) as a dispatch target — likely already
   solved, needs confirming, not rebuilding.** M-039 already built and
   verified end-to-end: `pi-claude-bridge` is installed, configured with
   `provider.plan: "pro"`, and registers Claude as a real pi provider/model
   (`claude-bridge/claude-sonnet-5`) reachable from ANY pi session,
   already confirmed working live (`BRIDGE-OK` test, plus a separate
   `AskClaude` tool delegation path, `ASKCLAUDE-OK` test). Since the
   `subagents` extension's generic `pi` backend can address *any*
   registered pi model — including `claude-bridge/claude-sonnet-5` —
   there is a real, open question of whether we need the `subagents`
   extension's separate `claude` backend at all, or whether pointing its
   `pi` backend at the already-working claude-bridge provider is
   sufficient and avoids re-solving the OAuth/root/`IS_SANDBOX` problem
   M-039 already spent a full session on. Leaning toward: don't touch
   the `claude` backend, use `pi` backend uniformly for every dispatch
   target (local-model roles AND claude-bridge).

**This is plan-only for now** — no implementation until Chris signs off
on the open design questions below. Filed directly to `now/` since this
is exactly what Chris asked for this turn (a detailed ticket, to be
grilled/refined before work starts).

## Plan
1. [ ] Resolve open design questions (see below) with Chris directly.
2. [ ] Copy/adapt `extensions/subagents/` (+ `shared/tool-call-timeout.ts`)
   from `davis7dotsh/my-pi-setup` into this box's shared pi extensions
   location (same convention as M-036/M-038), pin whatever
   `@earendil-works/pi-coding-agent` SDK version it needs to match
   against pi-web's actual deployed version (flagged as a real
   version-drift risk in this session's research).
3. [ ] Decide and implement the role(s) subagent dispatch targets
   resolve against (see open questions) — if a new role beyond
   `coder`/`judge`/`vision`/`orchestrator` is needed, add it the same way
   `orchestrator` was just added (`scripts/litellm-bootstrap.sh`'s
   `ROLES` array + `pi-web/models.seed.json.tmpl` + a `set-role.sh` call).
4. [ ] Wire pi's own `models.json`/custom-provider config so
   `subagent_spawn`'s `model` param can address that role (or roles)
   through the `pi` backend — confirm this actually round-trips a real
   request through litellm's role indirection, not just through a static
   model id, before calling this done.
5. [ ] For the Claude-Pro dispatch path specifically: verify (don't
   assume) that pointing the `pi` backend at `claude-bridge/claude-sonnet-5`
   from within a spawned subagent session actually works end-to-end —
   this is a different call path than M-039's own direct verification
   (interactive session switching to the claude-bridge provider, or the
   AskClaude tool), not yet proven from inside a `subagent_spawn`-launched
   child session specifically.
6. [ ] Confirm the observability/watch story end-to-end: `subagent_check`/
   `subagent_wait` from the orchestrator, AND independently resuming a
   dispatched child session directly via terminal `pi --resume` (or
   pi-web's own session browser) — Chris should be able to look in on a
   dispatched task's progress by hand if he wants to, not just take the
   orchestrator's word for it.
7. [ ] Document the final setup (which roles map to which dispatch
   targets, how to add a new one, the terminal-fallback path) somewhere
   discoverable — this is exactly the kind of thing that'll be forgotten
   in a month otherwise.

## Open design questions (to grill/refine before starting)
- Does the local-model dispatch target reuse the existing `coder` role,
  or does it get its own distinct role (e.g. `worker`)? Reusing `coder`
  is simpler but conflates "the model a human directly chats with in
  pi-web" and "the model the orchestrator dispatches background work
  to" — those could reasonably want to diverge later (e.g. coder could
  go back to being human-driven while a separate always-on worker role
  handles dispatch).
- Is Claude-Pro dispatch meant to be a manual, occasional escalation
  (orchestrator asks for confirmation before spending Pro-plan usage),
  or fully autonomous within some budget the orchestrator decides on its
  own? Claude Pro plans have real usage caps — worth an explicit answer
  rather than an implicit default.
- Should dispatch targets be selectable per-request (orchestrator picks
  local-model vs. Claude-Code per task based on difficulty), or is this
  card scoped to just wiring up ONE default dispatch target first and
  adding selection logic later?
- `MAX_RUNNING = 4` is hardcoded in the extension as researched — does
  that ceiling matter given this box's own memory constraints (running
  multiple concurrent large local models, or multiple concurrent Claude
  Code sessions, has real resource/quota implications beyond just the
  orchestrator's own tool-call bookkeeping)?
- Terminal-fallback UX: is "run `pi --resume <session-id>` by hand" good
  enough, or does Chris want something more discoverable (e.g. the
  orchestrator proactively telling him the session id/command to inspect
  a specific dispatched task)?

## Signals
<!-- signal: claude 2026-07-31T22:30Z — drafted, about to grill Chris on the open questions before any implementation starts -->

## Decision log

## Handoff notes
