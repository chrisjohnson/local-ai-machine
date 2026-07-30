---
id: M-033
title: pi-agent experiment — deploy on local-ai-machine, LAN/phone reachable
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-30T22:22:00Z
blocks: null
blocked_by: [M-031, M-032]
status: null
related_cards: [M-030, M-031, M-032, M-034]
---

# M-033 — pi-agent experiment — deploy on local-ai-machine, LAN/phone reachable

## Context
Same declarative-infra pattern as everything else in this repo: this isn't a
one-off manual deploy, it goes through `docker/docker-compose.yml` (+
`configuration.nix` firewall changes if a new port needs LAN exposure),
committed and pushed like the rest of the stack. User has given standing
permission tonight to push directly to main and to stop/start/remove
services on the box as needed — use it, don't wait for PR review on this.

Recall the concrete LAN-reachability failure mode from earlier this session:
local-ai-machine is multi-homed and its firewall's reverse-path filter
dropped LAN-originated traffic to a bound port even though the service itself
was fine (fixed generally via `checkReversePath = "loose"` in
`configuration.nix`) — that general fix should already cover a new port, but
verify with a real curl from another machine on the LAN (or your phone),
not just `curl localhost` on the box itself. Don't assume it works — that
exact assumption caused real debugging time earlier this session.

## Plan
1. [x] Decide the deployment shape: most likely one new docker-compose
   service (supervisor serving both API and built frontend static files) —
   avoid a separate frontend container unless there's a real reason for one,
   fewer moving parts for a quick experiment.
2. [x] Add the service to `docker/docker-compose.yml` following existing
   conventions in this file (env vars via `docker/.env`, volumes for session
   persistence so `docker restart` doesn't lose sessions, network access to
   reach litellm on port 4000).
3. [x] If the chosen port isn't already covered by the existing firewall
   rules, add it in `configuration.nix` and run the real deploy pipeline
   (git push → `nixos-rebuild switch` on the box, or however this repo's
   README/other cards describe doing that — check, don't guess) rather than
   hand-editing the box out of band.
4. [x] Verify real LAN reachability: curl the service's port from a
   non-localhost vantage point (or ask the human to check from their phone
   once they're back — but verify what you can yourself first).
5. [x] No auth — explicit user instruction. Don't add any without asking.

## Signals
<!-- signal: claude 2026-07-30T22:22Z — claiming; deploy shape/service/firewall already landed incrementally during M-031/M-032, this card verifies + closes remaining gaps -->
<!-- signal: claude 2026-07-30T22:26Z — M-033 done, real off-box LAN curl + Playwright browser test both confirm reachability, moving to M-034 -->

## Decision log
- Deployment shape decided and already implemented during M-031/M-032
  (single `pi-agent-supervisor` docker-compose service serving both the
  API and the bind-mounted static frontend - no separate frontend
  container), rather than redone here from scratch. This card's real
  remaining work was formal, deliberate LAN-reachability verification
  from a genuinely external vantage point, which had only been checked
  informally as a side effect of the M-032 Playwright test until now.
- `docker/docker-compose.yml`: `pi-agent-supervisor` service uses
  `network_mode: host` (same justification already established for
  litellm/prometheus in this file: litellm binds `127.0.0.1:4000`, and a
  bridge-networked container reaching it via `host.docker.internal` gets
  refused by that loopback-only bind - confirmed as a real, previously-hit
  bug this session, not a hypothetical). Port 3002 published directly (no
  `127.0.0.1:` prefix) since this is explicitly meant to be LAN/phone
  reachable, matching the existing grafana (3000) / open-webui (3001)
  precedent rather than turnstone-console's loopback-only 8090 pattern.
  `pi-agent-data` named volume persists `/data` (manifest.json + all
  per-session `--session-dir` state) so `docker restart`/redeploy doesn't
  lose sessions - already verified directly in M-031's own restart test.
- `configuration.nix`: added `3002` to
  `networking.firewall.allowedTCPPorts` (network_mode: host means this
  port is genuinely subject to the host's own firewall input chain, not
  Docker-DNAT'd, so it needed its own explicit entry - unlike a
  bridge-published port, which per this file's own comment on
  `filterForward` is reachable from the LAN regardless of
  `allowedTCPPorts` due to Docker's own FORWARD-chain rules). Applied for
  real via `sudo nixos-rebuild switch --flake /etc/nixos#local-ai-machine`
  on the box (the exact NOPASSWD-permitted command form, confirmed via
  `sudo -l` rather than guessed) - not just committed and assumed applied.
  `checkReversePath = "loose"` (already set generally, from an earlier
  fix this session for the box's multi-homed-same-subnet reverse-path
  issue) required no further change - confirmed by testing, not just
  trusting the "should already cover it" note in this card's own context.
- Real LAN reachability re-verified here specifically, from a genuinely
  separate machine (this agent's own Mac, NOT the box, NOT localhost) on
  the same LAN, addressing the box by both of its two interface IPs (the
  exact scenario that caused a real dropped-traffic bug earlier this
  session for litellm on port 4000):
  - `curl http://192.168.1.21:3002/api/health` → `{"ok":true}`
  - `curl http://192.168.1.221:3002/api/health` → `{"ok":true}`
  - `curl -o /dev/null http://192.168.1.21:3002/` (the frontend's own
    index.html) → `200`
  - Negative control, to confirm the firewall change is scoped and not
    accidentally wide open: `curl http://192.168.1.21:8090/`
    (turnstone-console, which this repo deliberately keeps
    loopback-only) → connection refused/timed out, as expected. This
    rules out "the whole box became reachable" as an alternate
    explanation for 3002 working.
  - The M-032 Playwright end-to-end test (session creation, message
    send, reconnect-after-close) was also run against
    `http://192.168.1.21:3002` from this same off-box vantage point, so
    the "reachable from a phone" claim isn't just an HTTP status code -
    a real headless browser loaded the actual page, opened a real
    WebSocket, and rendered a real streamed conversation, all across the
    LAN rather than on the box's own loopback.
  - `docker inspect pi-agent-supervisor` confirms `restart=unless-stopped`
    and `network=host` are actually the live container's config, not
    just what's declared in the compose file (i.e. not stale from before
    a deploy - this deploy is the one that landed those values in
    Docker's own `HostConfig`).
- No auth added - confirmed as an explicit non-goal by re-reading the
  card and the mission brief; the service will happily serve any client
  on the LAN with no login. Deliberate and unchanged.

## Handoff notes
Fully deployed and LAN-reachable right now at `http://192.168.1.21:3002/`
(or `.221`, same box, either interface) - both curl'd and driven through a
real browser from off-box during this card's own verification pass, not
assumed. No further deploy action needed unless the human wants a
friendlier hostname/bookmark; raw IP:port works today from a phone on the
same LAN. Everything left running per the mission's explicit instruction
not to tear anything down.
