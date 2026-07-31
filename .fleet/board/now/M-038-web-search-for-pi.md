---
id: M-038
title: Wire up web search capability for pi (pi-web)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:26:44Z
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
1. [x] Research first: is there an existing published pi extension for
   web search (check `packages.md`'s example list, npm) that just needs
   SearxNG's URL configured, or does this need a small custom extension
   (`pi.registerTool()` calling SearxNG's `/search?format=json` endpoint -
   same API Turnstone's own web_search tool already hits)? Don't assume -
   check what's actually available before writing one from scratch.
2. [x] Whichever path: wire it to `http://searxng:8080` (pi-web is
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
   BLOCKED pending human confirmation of the package choice - see decision
   log and handoff notes.
4. [ ] Verify for real: a live pi-web session asked something requiring
   current information it can't already know, confirm it actually
   searched (not hallucinated) and cited something real.

## Signals
<!-- signal: claude 2026-07-31T06:26:44Z — claiming -->
<!-- signal: claude 2026-07-31T07:05:00Z — steps 1-2 done (package research + networking fix); step 3 stopped short of deploy, needs human confirmation on baking a 3rd-party npm package into pi-web's auto-run entrypoint - see decision log -->

## Decision log
- 2026-07-31: Researched npm for existing pi web-search extensions per
  packages.md's install docs rather than writing a custom
  `pi.registerTool()` extension. Two real candidates support SearxNG
  natively: `pi-web-access` (nicobailon, 7.2MB unpacked, ~10 backends +
  PDF/video/GitHub tooling - kitchen-sink) and
  `@juicesharp/rpiv-web-tools` (juicesharp, 151KB, 2 deps, dedicated
  `providers/searxng.ts`, fully documented self-hosted flow - `pi install
  npm:@juicesharp/rpiv-web-tools`, then `WEB_SEARCH_PROVIDER=searxng` +
  `SEARXNG_URL=http://127.0.0.1:8091` env vars, zero interactive setup,
  confirmed from its own docs/self-hosted.md and providers.md that env
  vars win over any config file). Assessed rpiv-web-tools as the better
  fit (smaller surface, purpose-built for exactly this SearxNG-as-backend
  case) and manually confirmed it live: `pi install npm:@juicesharp/rpiv-web-tools`
  inside the running `pi-web` container (via its bundled `pi` CLI shim at
  `node_modules/@agegr/pi-web/node_modules/.bin/pi`) succeeded, `pi list`
  showed it registered, and it persisted correctly under
  `/data/pi-agent-config/{settings.json,npm/}` in the `pi-web-data` named
  volume. This manual install is NOT yet reflected in the compose/image -
  see handoff notes.
- 2026-07-31: Networking - confirmed directly on the box (`docker network
  inspect docker_default`, then `curl` from the host) that `searxng`'s
  current bridge IP (`172.18.0.9:8080`) is reachable from the host
  namespace (and therefore from `pi-web`, which is `network_mode: host`),
  including a working `format=json` search returning real results
  (`json` is already enabled under `search.formats` in
  `docker/searxng/settings.yml`, confirmed - no separate SearxNG config
  change needed). Chose NOT to hardcode that bridge IP though, since
  bridge IPs aren't guaranteed stable across container recreation.
  Instead published `searxng` on `127.0.0.1:8091:8080` in
  `docker/docker-compose.yml` (port 8091 = next free loopback port,
  clear of 8000-8012 vLLM / 8100-8199 llama.cpp / 8090 turnstone-console
  / 8080 turnstone-server) - matches every other backend service's
  loopback-publish convention in this file, and is the mirror-image of
  the earlier litellm/prometheus bridge-vs-host fix (there the *caller*
  needed host networking to reach a 127.0.0.1-bound *target*; here the
  *caller* (pi-web) is already host-networked and the *target* (searxng)
  needed the loopback publish instead). This compose edit is committed
  locally in this worktree/branch but not yet pushed or deployed - see
  handoff notes.
- 2026-07-31: Stopped short of finishing step 3 (baking the `pi install`
  into `pi-web/docker-entrypoint.sh` so it runs idempotently on every
  container start, matching the existing models.json-seed-once pattern)
  - the harness's auto-mode classifier denied that specific edit,
  correctly flagging that installing a specific third-party npm package I
  selected via my own research into an auto-executing entrypoint is a
  real external-code-trust decision the card asked me to *investigate*,
  not pre-authorized me to *choose and wire to auto-run*. Did not attempt
  to route around this - stopping is the right call at 7am with no one
  awake to ask. Left the compose networking fix and Dockerfile/entrypoint
  untouched beyond that point; card stays in `now/`, not `blocked/` (this
  isn't a dependency block, it's a judgment call needing a yes/no).

## Handoff notes
- **Decision needed from Chris**: confirm (or override) using
  `npm:@juicesharp/rpiv-web-tools` (github.com/juicesharp/rpiv-mono,
  MIT, published 2 days ago as of this session, 106 versions total on
  the monorepo, actively maintained) as the web-search extension for
  pi-web. Alternative considered: `pi-web-access`
  (github.com/nicobailon/pi-web-access) - larger, more backends, not
  SearxNG-first. Once confirmed, remaining work is small:
  1. Add to `pi-web/docker-entrypoint.sh`, right after the existing
     models.json seed block:
     ```sh
     if ! grep -q '"npm:@juicesharp/rpiv-web-tools"' "$PI_CODING_AGENT_DIR/settings.json" 2>/dev/null; then
       "$(npm root -g)/@agegr/pi-web/node_modules/.bin/pi" install npm:@juicesharp/rpiv-web-tools
     fi
     ```
  2. Add to `pi-web` service's `environment:` in
     `docker/docker-compose.yml`:
     ```yaml
     WEB_SEARCH_PROVIDER: searxng
     SEARXNG_URL: http://127.0.0.1:8091
     ```
  3. Commit, push, deploy scoped to `pi-web` only:
     `ssh local-ai-machine "cd /home/chris/local-ai-machine && git pull --ff-only && cd docker && docker compose up -d --build pi-web"`
     - the `searxng` compose change (127.0.0.1:8091:8080 publish) also
       needs `docker compose up -d searxng` (scoped, same rule) since
       its port mapping changed - do this BEFORE or together with the
       pi-web redeploy, not as a separate blanket `up -d`.
  4. Verify for real (Plan step 4, still fully open): create a live
     pi-web session, ask something requiring current information (e.g.
     today's date-sensitive news, not something in training data),
     confirm a `web_search` tool call actually fired and returned real
     results with citations, not a hallucinated answer.
  - Already manually installed once, live, directly in the running
    `pi-web` container for verification purposes only (see decision
    log) - this is NOT persisted through a rebuild/redeploy path yet
    and should be treated as scratch/proof-of-concept, not the real fix.
    A fresh `pi-web-data` volume (or one recreated for any reason) will
    not have it until steps 1-3 above are done.
  - The `docker/docker-compose.yml` `searxng` port-publish change (8091)
    IS a real, intended fix regardless of which extension package is
    chosen - it's needed no matter what wires up to it. Safe to deploy
    that half independently if useful.
  - Left `pi-web`'s manually-installed extension in place on the running
    container rather than uninstalling it - harmless (unconfigured,
    since `WEB_SEARCH_PROVIDER`/`SEARXNG_URL` env vars aren't set yet,
    so `web_search` would just throw "not set" if invoked) and saves a
    re-download step once confirmed.
