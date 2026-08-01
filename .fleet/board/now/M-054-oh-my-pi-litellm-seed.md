---
id: M-054
title: Port pi-web models.json seeding to oh-my-pi (litellm provider)
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-01T23:20:00Z
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-054 — Port pi-web models.json seeding to oh-my-pi (litellm provider)

## Context
<!-- why this card exists: root cause, links to runbooks/PRs/related cards -->

Chris asked (2026-08-01) to port the models.json seeding behavior from pi-web
into the new `oh-my-pi/` dir (just moved from `docker/omp/`, d0c6e21) so omp
launches pre-configured to the litellm stack, same starting point pi-web has.

pi-web's mechanism (pi-web/docker-entrypoint.sh + models.seed.json.tmpl):
seed config ONCE only if absent (non-stomping, because pi-web's Models panel
writes the same file), substitute a `__LITELLM_MASTER_KEY__` placeholder from
the runtime env, and refuse to start if the key is missing.

Key research findings (verified from can1357/oh-my-pi source, main branch):

- omp reads provider config from `{agentDir}/models.yml` (YAML preferred;
  `.yaml` fallback; a legacy `models.json` at the same path is auto-migrated
  to YAML on load — packages/coding-agent/src/config/config-file.ts).
- Agent dir resolves as `path.join(os.homedir(), PI_CONFIG_DIR) + "/agent"`
  (packages/utils/src/dirs.ts). `PI_CONFIG_DIR` is a directory *name*
  (default `.omp`), NOT an absolute path.
- BUG in the current oh-my-pi Dockerfile/compose: `PI_CONFIG_DIR=/home/omp/.omp`
  (absolute) makes config root `/home/omp/home/omp/.omp` — missing the
  `~/.omp:/home/omp/.omp` volume mount entirely. Must be `.omp`.
- litellm service is `network_mode: host` (port 4000 on host); omp is
  bridge-networked. Reach litellm via `http://host.docker.internal:4000/v1`
  with `extra_hosts: host.docker.internal:host-gateway` (turnstone precedent).
- omp model config schema (docs/models.md): providers.<id>.baseUrl / api /
  apiKey / compat / models[] with id, name, reasoning, input, contextWindow,
  maxTokens, cost. Same field shapes pi-web's template already uses.

## Plan
<!-- ordered checklist -->
1. [x] Research omp config format + path resolution (done above)
2. [ ] Write oh-my-pi/models.seed.yml.tmpl (translated from pi-web template)
3. [ ] Write oh-my-pi/docker-entrypoint.sh (seed-once + key guard)
4. [ ] Wire into oh-my-pi/Dockerfile (COPY template + entrypoint, fix PI_CONFIG_DIR)
5. [ ] Update docker/docker-compose.yml omp service (LITELLM_MASTER_KEY, extra_hosts, PI_CONFIG_DIR)
6. [ ] Shellcheck/syntax + YAML sanity check
7. [ ] Commit + push main, update this card to done/
8. [ ] Offer deploy to box (compose-only change; NOT auto-deployed, Chris said "draft")

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
     Examples:
     <!-- signal: otter 2025-07-15T14:30Z — claiming, will work on API layer -->
     <!-- signal: otter 2025-07-15T15:10Z — blocked on K-003, need schema first -->
     <!-- signal: otter 2025-07-15T15:45Z — done, moved to done/ -->
-->
<!-- signal: big-pickle 2026-08-01T23:20Z — claiming; drafting seed + entrypoint now -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
