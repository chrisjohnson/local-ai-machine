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
1. [x] Push `laguna-coder-role` branch, open PR against main (do not merge)
2. [x] SSH to local-ai-machine, checkout branch there without clobbering
   unrelated working-tree changes
3. [x] Stop both vLLM services (`docker compose stop`, not `down`)
4. [x] Start laguna service, wait for load, confirm health on 8101
5. [x] Restart litellm-proxy, verify `/v1/models` and a real completion via
   `coder` role
6. [x] Report back: PR URL, live status, any think-tag leak or load issues

## Signals
<!-- signal: claude 2026-07-29T04:35Z — claiming, landing PR + applying live per Chris's direct request -->
<!-- signal: claude 2026-07-29T04:45Z — done, PR #4 open (unmerged), laguna live on 8101, coder role verified via litellm, moved to done/ -->

## Decision log
- PR #4 opened against main from `laguna-coder-role` (b3db055), left unmerged per instructions: https://github.com/chrisjohnson/local-ai-machine/pull/4
- Server main checkout had an unrelated pre-existing modified file
  (`catalog/raw/.../transcript.jsonl`); left untouched, branch checkout
  applied cleanly alongside it with no conflict.
- Both vLLM containers (`qwen3.5-4b`, `qwen3.6-35b-a3b`) stopped via
  `docker compose stop` (state/volumes preserved, not `down`).
- Laguna container came up, took ~76s to report healthy (503 during
  load then 200), consistent with the ~81s smoke-test load time.
  Server logs confirm `n_ctx=16384` and reproduce the known tokenizer
  issue (`special_eos_id is not in special_eog_ids`), which is the root
  cause of the reasoning/EOS runaway-generation bug referenced in the
  build notes.
- litellm container's actual name is `litellm-proxy` (compose "Service"
  column showed truncated `litellm` in `docker compose ps`, which was
  briefly misleading) — restarted correctly, `/v1/models` shows both
  `coder` and `laguna-s-2.1-118b-q4km`.
- Sent one real `/v1/chat/completions` request via the `coder` role:
  response was coherent but reproduced the flagged bug exactly — a
  `<think>` tag leaked into `content` despite `--reasoning-format none`,
  and generation hit `finish_reason: length` (truncated at the `-n`
  cap) still inside the think block, never emitting the actual code.
  Confirms the `-n` cap is doing its job as a safety net but the
  underlying leak/runaway issue is real and unresolved — worth a
  follow-up card if Chris wants it investigated further.

## Handoff notes
None — task complete, PR awaiting Chris's review/merge.
