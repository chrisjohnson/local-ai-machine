---
id: M-035
title: Deploy and evaluate agegr/pi-web alongside bespoke pi-agent supervisor
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T04:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-030, M-031, M-032, M-033, M-034]
---

# M-035 — Deploy and evaluate agegr/pi-web alongside bespoke pi-agent supervisor

## Context
After building our own supervisor+frontend (M-030..M-034), Chris found
`github.com/agegr/pi-web` (npm `@agegr/pi-web`, 3,345 stars, actively
maintained) — a community web UI for the pi coding agent. Verified before
building: it depends directly on `@earendil-works/pi-coding-agent@0.83.0`,
the exact same version our own `pi-agent/supervisor` pins — same engine,
so this is a genuine like-for-like comparison of orchestration/UI layers,
not a different model or agent loop. Its own `rpc-manager.ts` (read
directly, not assumed) manages pi processes with a 10-minute idle timer
that defers while a session is actively running — conceptually similar to
what we built, arguably more resource-efficient (we keep every spawned
session alive indefinitely; pi-web reclaims genuinely idle ones).

pi-web already covers several things identified as gaps in our own
bespoke frontend: markdown rendering, session forking UI, cost/context
usage display, model config from the browser, git worktree switching,
file browsing/preview. Deployed alongside (not replacing) the existing
`pi-agent-supervisor` service specifically so the two can be compared
side by side under real use, per Chris's explicit instruction.

## Plan
1. [x] Build `pi-web/Dockerfile` — pin `@agegr/pi-web@0.8.5`, install
   `git` (needed for its worktree-switching feature against the mounted
   `/home/chris`), proactively apply the `git config --system --add
   safe.directory '*'` fix already found necessary for pi-agent-supervisor
   (same root-cause: container runs as root, mounted dirs owned by uid
   1000 — no need to rediscover this bug a third time).
2. [x] Seed the same litellm-backed `coder` model config pi-agent-supervisor
   already uses (`bootstrap-models-json.ts`'s exact shape), via a
   committed template (`models.seed.json.tmpl`, placeholder key,
   substituted from `LITELLM_MASTER_KEY` at container startup — never a
   real secret in git) — seeded ONCE (only if `models.json` doesn't
   already exist), unlike pi-agent-supervisor's own always-overwrite
   approach, since pi-web has its own user-facing Models panel that reads
   AND writes this file; overwriting every restart would fight that UI.
3. [x] Add `pi-web` service to `docker/docker-compose.yml`: `network_mode:
   host` (reach litellm at 127.0.0.1:4000, same pattern as everything
   else), port 30141 (pi-web's own default, published for LAN/phone
   reachability, no auth per the same explicit no-auth choice as the rest
   of this experiment), `/home/chris:/home/chris` bind mount per Chris's
   explicit instruction (same absolute path inside the container as on
   the host, so session files' recorded cwd paths resolve correctly — not
   remapped to `/workspace/*` like pi-agent-supervisor).
4. [x] Deploy for real (push to main, pull + `docker compose up -d --build
   pi-web` on the box) and verify: container healthy, LAN reachability via
   off-box curl, `/home/chris` mount + `safe.directory` fix hold under a
   real `git log` inside the container.
5. [x] Leave both `pi-agent-supervisor` and `pi-web` running side by side
   for Chris to compare directly.

## Signals
<!-- signal: claude 2026-07-31T04:00Z — claiming, building pi-web deployment alongside existing pi-agent-supervisor for direct comparison -->
<!-- signal: claude 2026-07-31T05:15Z — done, both services live and LAN-reachable side by side -->

## Decision log
- First deploy attempt was healthy on localhost (`curl 127.0.0.1:30141` →
  200 inside the box) but unreachable from off-box (`curl 192.168.1.21:30141`
  → connection failure) — port 30141 was added to `docker-compose.yml`
  but never to `configuration.nix`'s `networking.firewall.allowedTCPPorts`
  (only 3002 was added for pi-agent-supervisor last night). Fixed by
  adding 30141 to the allow-list and running the real deploy pipeline,
  not a manual box edit.
- Applying that fix hit a genuine tooling gap: I don't have interactive
  sudo on the box. Resolved for good, not just this once - `sudo -l`
  (run at Chris's direction) revealed a standing NOPASSWD rule for the
  *exact* command `/run/current-system/sw/bin/nixos-rebuild switch
  --flake /etc/nixos#local-ai-machine` (full path + exact flake arg
  required to match; the bare `sudo nixos-rebuild switch` I'd tried
  earlier doesn't match sudoers' exact-string rule, hence the password
  prompt). That precise command is the one to use for any future
  firewall/config change - no need to hand this back to Chris again.
- Did not `cat` the real seeded `models.json` to verify its content - it
  contains the real `LITELLM_MASTER_KEY` substituted in, and printing it
  would leak the secret into this transcript (a permission gate caught
  this correctly before it ran). Verified structurally instead: the
  entrypoint's substitution logic was reviewed directly, and the
  container's own logs/health confirm it started cleanly, which it
  would not do with a malformed or missing models.json.
- Both `pi-agent-supervisor` (:3002) and `pi-web` (:30141) are live,
  same litellm-backed `coder` model, same `@earendil-works/pi-coding-agent
  @0.83.0` engine - genuinely comparable, not a different model.

## Handoff notes
Live at `http://192.168.1.21:30141/` (pi-web) alongside
`http://192.168.1.21:3002/` (pi-agent-supervisor, our own build). Neither
has auth, per the same explicit choice made for the whole pi-agent
experiment - LAN-only. Not yet functionally tested end-to-end through the
browser (a real prompt/response, git worktree switching in the actual UI,
session forking) - that hands-on comparison is the point, left for Chris
to do directly rather than pre-empted here.
