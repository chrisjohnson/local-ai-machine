---
id: M-038
title: Wire up web search capability for pi (pi-web)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-035, M-037]
---

# M-038 — Wire up web search capability for pi (pi-web)

## Context
pi's built-in tools are read/bash/edit/write/grep/find/ls — no web search
(confirmed: `pi --help`'s tool list). Same gap Turnstone had, same fix
available: SearxNG is already deployed and working (`searxng` service in
`docker/docker-compose.yml`, internal-only, no published port, used by
Turnstone's own `web_search` tool via `TURNSTONE_SEARXNG_URL`). Reuse it -
don't stand up a second search stack (Chris confirmed this explicitly).

## Plan
1. [ ] Research first: is there an existing published pi extension for
   web search (check `packages.md`'s example list, npm) that just needs
   SearxNG's URL configured, or does this need a small custom extension
   (`pi.registerTool()` calling SearxNG's `/search?format=json` endpoint -
   same API Turnstone's own web_search tool already hits)? Don't assume -
   check what's actually available before writing one from scratch.
2. [ ] Whichever path: wire it to `http://searxng:8080` (pi-web is
   `network_mode: host`, so reachable at whatever address SearxNG
   resolves to on the bridge network `searxng` sits on - check whether
   pi-web can actually reach a bridge-only container from host network
   mode; if not, may need to publish SearxNG on localhost like other
   backend services, following the same reasoning as the earlier
   Prometheus/litellm bridge-vs-host fix this session already worked
   through once - don't re-learn that the hard way).
3. [ ] Install/configure as a pi extension in `pi-web`'s shared extensions
   location (see M-036's AGENTS.md bind-mount for the pattern - same
   `PI_CODING_AGENT_DIR/extensions/` idea, add it if not already wired).
4. [ ] Verify for real: a live pi-web session asked something requiring
   current information it can't already know, confirm it actually
   searched (not hallucinated) and cited something real.

## Signals

## Decision log

## Handoff notes
