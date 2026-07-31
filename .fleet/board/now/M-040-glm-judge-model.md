---
id: M-040
title: Deploy GLM-4.7-Flash as judge model, wire to litellm + pi
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:16:00Z
blocks: M-042
blocked_by: null
status: null
related_cards: [M-041, M-042]
---

# M-040 — Deploy GLM-4.7-Flash as judge model, wire to litellm + pi

## Context
Chris asked for "that glm flash 7b model we talked about way back" as a
judge model - misremembered the size; it's **GLM-4.7-Flash** (30B total /
3B active MoE), confirmed via catalog research, not guessed. Already
downloaded on the box in two forms:
- `/var/lib/ai-models/glm-4.7-flash-awq` (AWQ 4-bit, for vLLM)
- `/var/lib/ai-models/ollama-glm-4.7-flash` (GGUF Q4_K_M, for llama.cpp/ollama)

Chris asked for "the strongest" variant. Comparing the catalog's own
benchmark records (not guessed):
- `glm-4.7-flash-awq--vllm-therock-gfx1151-v1` (currently the ONLY
  standing service, already in `docker/litellm/config.yaml` as
  `glm-4.7-flash-awq` on port 8003): seven-tier-coding-v2 = 18/22, ~19-33
  tok/s depending on concurrency.
- `glm-4.7-flash--llamacpp-vulkan-radv-v1` (GGUF, **not currently a
  standing service**): seven-tier-coding-v2 = 20/22 (perfect on tier J),
  70.1 tok/s generation - both faster AND more accurate than the AWQ/vLLM
  one already running.

The llamacpp variant is the one to actually deploy as "judge" - the
already-running AWQ one is the weaker, slower option, not the target.

**Paused for tonight (2026-07-31T06:25Z).** Deploying this adds another
model-serving container to the same shared GPU that just had a real
incident during M-037's deploy (a blanket `docker compose up -d`
mistake started ~13 stopped models simultaneously, OOM-killed the
active `coder` model as collateral damage - see M-037's decision log).
Given the safety classifier explicitly flagged that pattern and asked
for human eyes before further shared-model-stack action, starting a new
model service on this same box right now isn't the moment for it, even
though this card's own plan is scoped and safe in isolation. Holding
this one for Chris's morning review rather than pushing through solo.

## Plan
1. [ ] Add `glm-4.7-flash--llamacpp-vulkan-radv-v1` as a new standing
   docker-compose service, llama.cpp-server port range (8100-8199) -
   8100/8101/8102 already taken, use 8103. Command line matches the
   catalog build entry's engine ref (`llamacpp-vulkan-radv-v1`) - check
   that engine file for the actual invocation, don't improvise flags.
2. [ ] Register it in `docker/litellm/config.yaml`, then use
   `scripts/set-role.sh` to point the `judge` role alias at it (matching
   this repo's existing role-flip convention - role flips aren't
   committed by convention elsewhere in this repo; check whether that
   still applies or whether `judge` should be a committed pin like
   `coder` was for the MTP model, and match whichever this repo already
   does for judge specifically).
3. [ ] Add it as a selectable model in the shared pi models config (the
   same `models.json` shape used for `coder` - see
   `pi-web/models.seed.json.tmpl` from the pi-agent-supervisor days,
   equivalent needed for pi-web's own config now that pi-agent-supervisor
   is gone per M-037).
4. [ ] Verify for real: a live prompt through litellm's `judge` alias
   gets a real response from this exact model/port, and pi-web can
   actually select and use it as a model option.

## Signals
<!-- signal: claude 2026-07-31T06:16Z — claiming, deploying the stronger llamacpp variant (20/22, 70tok/s) not the weaker already-running AWQ one -->

## Decision log

## Handoff notes
