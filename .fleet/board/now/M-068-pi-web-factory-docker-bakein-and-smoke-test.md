---
id: M-068
title: pi-web-factory — Docker bake-in + first live end-to-end smoke test
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: [M-069, M-070, M-071, M-072, M-074, M-075, M-076, M-077]
status: null
related_cards: [M-061, M-062, M-063, M-064, M-065, M-066, M-067, M-069, M-070, M-071, M-072, M-074, M-075, M-076, M-077]
---

# M-068 — pi-web-factory — Docker bake-in + first live end-to-end smoke test

## Context
**Re-sequenced 2026-08-04, twice.** Originally blocked only on M-067. First revision:
Chris's "docker last" instruction (`pi-web-adw-design.md` §6.1 point 6, §6.3) added
M-069/070/071/072/073. Second revision, same day: the terminology/architecture pass
(§7) withdrew M-073 (superseded by M-076) and added M-074 (schema migration),
M-075 (global Roles config), M-076 (Workflow interpreter), M-077 (visualizer) — all
now blocking, so what gets baked in is the real, final shape of the system.

Gets `pi-web-factory/` actually running inside the `jmfederico-pi-web` container,
per design doc §0 point 1 and §3.1's "always-synced" note. Mirror the existing
`plugins/pi-continue-companion` pattern exactly (see `jmfederico-pi-web/Dockerfile`
and `docker-entrypoint.sh` on the box, or `docker/docker-compose.yml`'s comments
around the `jmfederico-pi-web` service): `COPY` into the image, re-synced on every
container start so the running copy never drifts from what's committed to git — never
a hand-edited copy living only on the running container.

This is the card that finally validates the whole design against the real, running
stack rather than a scratch/throwaway setup — treat it with the same care M-035's
original pi-web deployment used (real push-and-redeploy, not a manual box edit; see
that card in `.fleet/board/done/` for the deploy pipeline this should reuse:
`git push` → `ssh local-ai-machine "cd ~/local-ai-machine && git pull --ff-only"` →
scoped `docker compose build jmfederico-pi-web && docker compose up -d
jmfederico-pi-web` on the box).

## Plan
1. [ ] Add `pi-web-factory/` to `jmfederico-pi-web/Dockerfile` (`COPY`) and the
   entrypoint's always-sync step.
2. [ ] Confirm `bun` (already present in the image for `pi-web` itself) can run
   `pi-web-factory`'s CLI without additional runtime deps beyond what M-061's
   `package.json` declares.
3. [ ] Deploy for real: push, pull on the box, scoped rebuild+redeploy of
   `jmfederico-pi-web` only.
4. [ ] First live end-to-end run: `factory run` against a real project directory
   already known to this stack (e.g. `printer-dashboard`, the same one
   `jmfederico-pi-web`'s own `working_dir` already targets), confirm the session shows
   up in pi-web's own browser UI exactly like a hand-started session would (design doc
   §3.5's core claim — verify it, don't just assume it), and that `factory.db` recorded
   the run correctly.
5. [ ] Update `pi-web-adw-design.md` with what was actually true on first real contact
   (this design has been careful about citing evidence — keep that discipline through
   the first live run, where reality often diverges from the sketch).

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
