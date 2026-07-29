---
id: M-026
title: Deploy Laguna-S-2.1 as coder role (stop vLLM pair, land PR, apply live)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-29T04:35:00Z
blocks: null
blocked_by: null
related_cards: []
status: null
---

# M-026 — Deploy Laguna-S-2.1 as coder role

## Context

Chris prepared a local branch `laguna-coder-role` (commit `b3db055`, off
main) with the file edits already made:

1. `docker/docker-compose.yml` — new compose service
   `laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1`, llama-server on port
   8101, mirroring the flags validated in the 2026-07-29 attended smoke test
   (`catalog/builds/laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1.yaml`),
   except `-n` raised from the smoke test's `512` to `8192` as a real-use
   generation cap (model has a known reasoning/EOS runaway bug — cap must
   stay).
2. `docker/litellm/config.yaml` — new static entry for
   `laguna-s-2.1-118b-q4km` (port 8101), and the `coder` role's
   `model:`/`api_base:` repointed from `qwen3.6-35b-a3b` (port 8000) to it.

Note: `scripts/set-role.sh` only supports vLLM services (greps for
`--served-model-name`); llama.cpp's `llama-server` uses `-a`/`--alias`
instead. This role flip was a hand-match edit to `config.yaml`, not via the
script.

Delegated task: land this via branch+PR (per AGENTS.md — no direct push to
main for source changes), and also apply it live on
`local-ai-machine`: stop the two running vLLM containers
(`qwen3.5-4b--vllm-therock-gfx1151-v1`,
`qwen3.6-35b-a3b--vllm-therock-gfx1151-v1`), bring up the new laguna
service, restart litellm-proxy, verify `coder` resolves and responds.

## Plan
1. [ ] Push `laguna-coder-role` branch, open PR against main (do not merge)
2. [ ] SSH to local-ai-machine, checkout branch there without clobbering
   unrelated working-tree changes
3. [ ] Stop both vLLM services (`docker compose stop`, not `down`)
4. [ ] Start laguna service, wait for load, confirm health on 8101
5. [ ] Restart litellm-proxy, verify `/v1/models` and a real completion via
   `coder` role
6. [ ] Report back: PR URL, live status, any think-tag leak or load issues

## Signals
<!-- signal: claude 2026-07-29T04:35Z — claiming, landing PR + applying live per Chris's direct request -->

## Decision log

## Handoff notes
