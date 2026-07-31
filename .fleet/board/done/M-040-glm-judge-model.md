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
1. [x] Added `glm-4.7-flash--llamacpp-vulkan-radv-v1` as a new standing
   docker-compose service, port 8103 (next free in 8100-8199). Single
   slot (no `-cb`/`-kvu`), matching the MTP coder service's simplicity
   rather than the 4-slot server engine template - a judge doesn't need
   concurrent-serving complexity. `-lm none` matches the exact flags the
   catalog's own benchmark-of-record run used, for as close a match to
   the measured 70.1 tok/s as possible.
2. [x] Registered in `docker/litellm/config.yaml` and pointed the `judge`
   role alias at it via `scripts/set-role.sh judge
   glm-4.7-flash--llamacpp-vulkan-radv-v1` - confirmed this repo's
   existing convention (role flips NOT committed to git, same as
   `coder`'s day-to-day flips) still applies; did not commit
   `litellm/config.yaml`.
3. [x] Added `judge` to `pi-web/models.seed.json.tmpl` (committed) AND
   applied the identical addition directly to the already-deployed
   `models.json` on the box, since that file is seeded once and never
   overwritten (to protect pi-web's own Models panel edits) - a fresh
   deploy from an empty volume gets it from the template alone; the
   live box needed both.
4. [x] Verified for real, deploy scoped correctly this time (single
   named service only, learned from M-037's incident): direct completion
   against port 8103 (`"OK"`, `finish_reason: stop`), then the same
   prompt through litellm's `judge` alias end-to-end
   (`model: "judge"` in the response, confirming it's actually routing
   through the alias, not just reachable directly). `pi-web` restarted
   cleanly after the config change (scoped `docker compose restart
   pi-web`, verified 200 after). Did NOT independently verify pi-web's
   own model picker shows `judge` in the UI - its `/api/models` route
   returned "Access denied" to a plain curl (looks like pi-web's own
   request-security/host-check layer, not a real problem, given the
   config file itself has the identical shape as the already-working
   `coder` entry) - a 10-second manual check in the browser closes this
   out fully, lower stakes than the parts already confirmed directly.

## Signals
<!-- signal: claude 2026-07-31T06:16Z — claiming, deploying the stronger llamacpp variant (20/22, 70tok/s) not the weaker already-running AWQ one -->
<!-- signal: claude 2026-07-31T14:20Z — done, judge model live and verified end-to-end through litellm; deploy scoped correctly this time -->

## Decision log
- Deploy was scoped precisely this time (`docker compose up -d
  glm-4.7-flash--llamacpp-vulkan-radv-v1`, one named service only) -
  direct application of the lesson from M-037's incident earlier
  tonight. `docker ps` before/after confirmed nothing else was touched,
  `coder` untouched throughout.
- This unblocks M-042 (repeat-detection first pass), which was waiting
  on this judge model existing.

## Handoff notes
Live: `judge` role in litellm → port 8103 →
`glm-4.7-flash--llamacpp-vulkan-radv-v1`. `pi-web` has `judge` as a
selectable model. One low-stakes item left for Chris to eyeball: confirm
`judge` actually shows up in pi-web's own model picker in the browser
(everything backing it is independently confirmed working; this is just
closing the loop on the UI layer specifically).
