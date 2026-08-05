---
id: M-068
title: pi-web-factory — Docker bake-in + first live end-to-end smoke test
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T03:00:00Z
blocks: null
blocked_by: []
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
1. [x] Add `pi-web-factory/` to `jmfederico-pi-web/Dockerfile` (`COPY`) and the
   entrypoint's always-sync step.
   - Pulled forward 2026-08-05 (before this card's own remaining items) because
     M-072 needed it to unblock the Skill's `cli.ts` invocation path — see that
     card's decision log. Landed at `$HOME/pi-web-factory`, NOT under
     `$PI_CODING_AGENT_DIR` — a real deviation from the plugin/extension
     precedent, documented in design doc §8.
2. [x] Confirm `bun` (already present in the image for `pi-web` itself) can run
   `pi-web-factory`'s CLI without additional runtime deps beyond what M-061's
   `package.json` declares.
   - Confirmed: `bun install --frozen-lockfile` baked in at build time (6
     packages, `yaml`/`zod` + transitive), `bun cli.ts` runs correctly inside
     a throwaway container built from the new image before touching the live
     one.
3. [x] Deploy for real: push, pull on the box, scoped rebuild+redeploy of
   `jmfederico-pi-web` only.
   - `git push` → `ssh local-ai-machine "cd ~/local-ai-machine && git pull
     --ff-only"` → `docker compose build jmfederico-pi-web && docker compose
     up -d jmfederico-pi-web` on the box, exactly the M-035 pipeline this
     card's own Context pointed at. Confirmed healthy (200) and config-hash
     match against the compose file post-deploy.
4. [x] First live end-to-end run: against a real, isolated scratch repo (not
   `printer-dashboard` as originally named — see design doc §8 for why: that
   repo's shared checkout had unrelated concurrent work active at the time),
   confirm the session shows up correctly and `factory.db` recorded the run.
   - Ran `bun $HOME/pi-web-factory/cli.ts --project <scratch> --workflow
     plan-build-review "..."` from an ordinary shell INSIDE the `pi-web`
     container itself — the exact path M-072's Skill will use, not the
     SSH+`docker exec`-from-the-Mac pattern every other live test this
     session used. Real success (`adw_4a24f8c7dcf2`), three Steps recorded
     correctly in `factory.db` at its new persistent path
     (`/home/piweb/.pi-web/pi-web-factory-data/factory.db`), deep-link
     resolved (200). Session archived+deleted, Project deregistered, scratch
     repo removed afterward.
5. [x] Update `pi-web-adw-design.md` with what was actually true on first real
   contact.
   - New §8: the two similarly-named compose services (a real, easy-to-make
     mixup — see below), the `$HOME/pi-web-factory` path deviation, and the
     `PI_WEB_FACTORY_DB_PATH` fix (below).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T03:00Z — pulled forward from M-072, bake-in + deploy + smoke test done -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): while investigating for the bake-in, found what looked
  like live config drift on the running `pi-web` container vs.
  `docker-compose.yml` — turned out to be a mixup between two similarly-named
  compose services (`pi-web:`, the original `agegr/pi-web` comparison
  partner, vs `jmfederico-pi-web:`, the one actually running). No real drift
  existed; corrected with Chris directly. Full account in design doc §8.
- 2026-08-05 (claude, with Chris): removed the `pi-web:` service block, its
  `../pi-web` build-context directory, and the orphaned `pi-web-data` volume
  declaration entirely — the comparison is long settled, nothing was running
  from that service (confirmed via `docker ps -a --filter
  label=com.docker.compose.service=pi-web`).
- 2026-08-05 (claude): caught before deploying, not after — baking
  `cli.ts` into the always-resynced `pi-web-factory-seed` copy would have put
  `factory.db` somewhere `docker-entrypoint.sh`'s `rm -rf` destroys on every
  container restart (real accumulated observability history, exactly what
  §7.3's schema migration exists to preserve). Fixed via a new
  `PI_WEB_FACTORY_DB_PATH` env override in `cli.ts`
  (`resolveDbPath()`, mirrors the existing `PI_WEB_FACTORY_CONFIG` escape-hatch
  pattern + `mkdirSync`s the parent dir), pointed by the Dockerfile at a path
  under `$PI_CODING_AGENT_DIR` (bind-mounted, survives restarts/rebuilds).
- 2026-08-05 (claude): validated the build in a throwaway container (`docker
  run --rm ... --entrypoint docker-entrypoint.sh`) before touching the live
  one — confirmed the sync landed correctly, `bun cli.ts` ran, and
  `PI_WEB_FACTORY_DB_PATH`/parent-dir creation worked — only then redeployed
  the real `jmfederico-pi-web` container. Chris confirmed nothing needed it
  to stay up ("I'm not using pi-web, it's all you and your sub-agents...
  feel free to restart").
- 2026-08-05 (claude): full non-live suite (210 pass) + `tsc --noEmit` clean
  before every commit in this card's sequence.

## Handoff notes
Commits: pi-web-factory bake-in + `PI_WEB_FACTORY_DB_PATH` (`0fa4ee8`), pi-web
experiment removal (`1521848`), design doc §8 (`78a9e18`), all on `main`, all
deployed and live. `jmfederico-pi-web` container recreated and healthy
(config-hash matches compose exactly). M-072 (the Skill itself) can now
proceed — its own blocker on this card is cleared.
