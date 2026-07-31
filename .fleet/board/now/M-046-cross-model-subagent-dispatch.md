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

3. **Claude Code (Pro subscription) as a dispatch target — both paths get
   built, deliberately, for side-by-side comparison.** M-039 already
   built and verified end-to-end: `pi-claude-bridge` is installed,
   configured with `provider.plan: "pro"`, and registers Claude as a real
   pi provider/model (`claude-bridge/claude-sonnet-5`) reachable from ANY
   pi session, already confirmed working live (`BRIDGE-OK` test, plus a
   separate `AskClaude` tool delegation path, `ASKCLAUDE-OK` test). The
   `subagents` extension separately ships its own `claude` backend
   (spawns `@anthropic-ai/claude-agent-sdk` directly) — a second,
   independent path to the same destination, likely to hit the same
   root/`--dangerously-skip-permissions`/`IS_SANDBOX` problem M-039
   already spent a full session diagnosing, with no guarantee the fix
   transfers cleanly to this different code path. **Chris's explicit
   call: build both anyway, so he can compare them directly** — not a
   pick-one decision.

**Design decisions, finalized 2026-07-31 (grilled with Chris directly —
see Decision log for the full back-and-forth).** Filed to `now/`; ready
for implementation, not yet started.

## Plan
1. [ ] Copy/adapt `extensions/subagents/` (+ `shared/tool-call-timeout.ts`)
   from `davis7dotsh/my-pi-setup` into this box's shared pi extensions
   location (same convention as M-036/M-038), pin whatever
   `@earendil-works/pi-coding-agent` SDK version it needs to match
   against pi-web's actual deployed version (flagged as a real
   version-drift risk in this session's research). Install/configure it
   in its **mostly-original form** — no custom confirmation gates, no
   custom dispatch-target-selection framework layered on top; the
   orchestrator LLM picks `model`/`provider` per `subagent_spawn` call
   using its own judgment, exactly as the tool is designed. Leave
   `MAX_RUNNING = 4` at its default; leave the terminal-fallback
   observability story (`pi --resume <session-id>` by hand, or pi-web's
   own session browser) as-is — no extra tooling on top.
2. [ ] Add a new dedicated `worker` role (not a reuse of `coder`) for
   local-model dispatch — same mechanism as `orchestrator`'s recent
   addition (`scripts/litellm-bootstrap.sh`'s `ROLES` array +
   `pi-web/models.seed.json.tmpl` + a `set-role.sh` call). Keeps "model a
   human directly drives in pi-web" and "model the orchestrator
   dispatches background work to" cleanly separate even when they
   happen to point at the same underlying model.
3. [ ] Wire pi's own `models.json`/custom-provider config so the
   extension's `pi` backend can address the `worker` role through
   litellm's role indirection (not a raw/static model id) — confirm this
   actually round-trips a real request through the role, not just a
   static model id, before calling this done. This is the mechanism that
   keeps model mapping out of the harness per Chris's explicit
   preference: swapping which real model backs `worker` is only ever a
   `set-role.sh` call from here on.
4. [ ] Wire up BOTH Claude dispatch paths, kept as separate, independently
   selectable targets:
   - the extension's `pi` backend pointed at `claude-bridge/claude-sonnet-5`
     (reuses M-039's already-verified integration);
   - the extension's own `claude` backend (spawns the Agent SDK
     directly) — expect to rediscover and re-fix the root/`IS_SANDBOX`
     problem M-039 hit, don't assume it'll just work.
   Verify both independently with a real dispatched task each, from
   inside an actual `subagent_spawn`-launched child session specifically
   (not just the interactive-session-switch or AskClaude paths M-039
   already proved — this is a different call path).
5. [ ] Document the final setup (which roles/backends exist, how to add
   a new one, the terminal-fallback path) somewhere discoverable.

## Design decisions (grilled + finalized 2026-07-31)
- **Local dispatch role:** new dedicated `worker` role, not a reuse of
  `coder`.
- **Claude dispatch:** build both the `pi`-backend-via-claude-bridge path
  and the extension's own `claude` backend, kept side-by-side for Chris
  to compare directly — not a pick-one.
- **Everything else about the extension's behavior: taken as-is, in its
  mostly-original form.** No custom pre-dispatch confirmation gate (even
  for Claude-Pro usage-cap protection — considered, explicitly declined:
  "let's just take it as is"). No custom per-task dispatch-target
  selection framework — the orchestrator LLM's own per-call judgment on
  `subagent_spawn`'s `model`/`provider` params is the whole mechanism,
  matching the tool's actual original design (there is no selection
  layer to build; the tool schema already puts that choice on the
  calling LLM). `MAX_RUNNING = 4` and the terminal-fallback observability
  story are both left at their defaults, unchanged from Ben's setup.

## Signals
<!-- signal: claude 2026-07-31T22:30Z — drafted, about to grill Chris on the open questions before any implementation starts -->
<!-- signal: claude 2026-07-31T22:55Z — design grilled + finalized, ready for implementation pickup, nothing started yet -->

## Decision log
- Grilled with Chris directly (2026-07-31). Two real decisions made
  (new `worker` role; build both Claude dispatch paths for comparison).
  Everything else initially raised (confirm-before-use gate, per-task
  target-selection framework) was explicitly declined — Chris's
  correction mid-grill: this is meant to be cribbing Ben Davis's
  (`davis7dotsh/my-pi-setup`) existing setup, not a from-scratch redesign
  of how the tool decides things. Recorded here so a future implementer
  doesn't reintroduce that scope: the extension's own default behavior
  (LLM picks `model`/`provider` per call, no external gate/framework) is
  the intended final shape, not a placeholder to be refined later.

## Handoff notes
