---
id: M-033
title: pi-agent experiment — deploy on local-ai-machine, LAN/phone reachable
initiative_id: null
claimed_by: null
claimed_at: null
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
1. [ ] Decide the deployment shape: most likely one new docker-compose
   service (supervisor serving both API and built frontend static files) —
   avoid a separate frontend container unless there's a real reason for one,
   fewer moving parts for a quick experiment.
2. [ ] Add the service to `docker/docker-compose.yml` following existing
   conventions in this file (env vars via `docker/.env`, volumes for session
   persistence so `docker restart` doesn't lose sessions, network access to
   reach litellm on port 4000).
3. [ ] If the chosen port isn't already covered by the existing firewall
   rules, add it in `configuration.nix` and run the real deploy pipeline
   (git push → `nixos-rebuild switch` on the box, or however this repo's
   README/other cards describe doing that — check, don't guess) rather than
   hand-editing the box out of band.
4. [ ] Verify real LAN reachability: curl the service's port from a
   non-localhost vantage point (or ask the human to check from their phone
   once they're back — but verify what you can yourself first).
5. [ ] No auth — explicit user instruction. Don't add any without asking.

## Signals

## Decision log

## Handoff notes
