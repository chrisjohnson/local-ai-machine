---
id: M-037
title: Decommission pi-agent-supervisor - pi-web is the way forward
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:15:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-030, M-031, M-032, M-033, M-034, M-035, M-036]
---

# M-037 — Decommission pi-agent-supervisor - pi-web is the way forward

## Context
After building our own bespoke supervisor+frontend (M-030..M-034) and then
deploying `pi-web` alongside it for comparison (M-035), Chris has decided:
full removal of `pi-agent-supervisor`, `pi-web` going forward. This is an
explicit decision, not a judgment call — confirmed directly.

## Plan
1. [ ] Stop and remove the `pi-agent-supervisor` container on the box.
2. [ ] Remove the `pi-agent-supervisor` service block, its named volume
   (`pi-agent-data`), and any port/firewall entries scoped only to it
   from `docker/docker-compose.yml` / `configuration.nix`.
3. [ ] Remove the `pi-agent/` directory (supervisor + frontend source)
   from the repo.
4. [ ] Keep the shared bits still in use by `pi-web`:
   `docker/agentic-fleet-AGENTS.md` (M-036) stays - it's mounted into
   `pi-web` too, don't delete it. Firewall port 3002 can be removed from
   `configuration.nix` since nothing will use it anymore.
5. [ ] Real deploy: push, pull on box, `docker compose up -d` (removes the
   dropped service), `sudo /run/current-system/sw/bin/nixos-rebuild
   switch --flake /etc/nixos#local-ai-machine` for the firewall change.
   Verify port 3002 is actually closed after (`curl` from off-box should
   fail), and `pi-web` is unaffected (still healthy, still reachable).

## Signals
<!-- signal: claude 2026-07-31T06:15Z — claiming, working the 6-ticket overnight batch per Chris's direction -->

## Decision log

## Handoff notes
