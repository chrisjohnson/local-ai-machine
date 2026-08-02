---
id: M-056
title: Launch qwen3.6-35b-a3b + laguna-s-2.1; add planner role
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-01T23:55:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-054, M-054.1]
---

# M-056 — Launch qwen3.6-35b-a3b + laguna-s-2.1; add planner role

## Context
<!-- why this card exists: root cause, links to runbooks/PRs/related cards -->

Chris asked (2026-08-01) to launch qwen3.6-35b-a3b and laguna-s-2.1 (both
llama.cpp GGUFs, co-resident — memory math in session: 20.6GB + 68.1GB fits
in the 124GiB unified budget; laguna-s already running), then:
- set qwen -> coder role (set-role.sh)
- add a NEW "planner" role across pi-web, oh-my-pi, litellm (and set-role)
  and set laguna -> planner.

ORDERING PER CHRIS: start models + set qwen to coder FIRST, only then build
the planner role. Do not get ahead of the role work.

Role architecture (M-054 era, 2026-07-31 redesign): roles are litellm-DB
runtime values (terraform-style, git codifies existence not live value).
set-role.sh <role> <service> re-points a role via litellm Model Management
API. pi-web (models.seed.json.tmpl) and oh-my-pi (models.seed.yml.tmpl)
each seed coder/judge/vision/orchestrator pointing at litellm:4000; the
litellm DB maps role name -> actual backend model service.

Known facts:
- laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1 (port 8101) ALREADY RUNNING on box.
- qwen3.6-35b-a3b: NO plain llamacpp compose service exists — only the MTP
  variant (qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1, port 8102). MTP
  GGUF is downloaded (/var/lib/ai-models/llamacpp-qwen3.6-35b-a3b-mtp).
  Build status: WORKING, MTP path untested-but-wired; 27B MTP failed only
  on missing MTP tensors, this file has them.
- litellm-bootstrap.sh seeds ROLES=(coder judge vision orchestrator);
  set-role.sh auto-creates a role if missing (bootstrap is cleaner).
- set-role.sh needs yq on the box + LITELLM_MASTER_KEY from docker/.env.
- Current box running: laguna-s (68GB) + ollama; vllm-primary/judge NOT up.

## Plan
<!-- ordered checklist -->
1. [x] Launch qwen3.6-35b-a3b MTP llamacpp service (compose up -d, scoped); verify /health + /v1/models
2. [x] Verify laguna-s still up + healthy
3. [x] set-role.sh coder qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1; verify live via chat completion
3b. [x] Post-power-cycle recovery (2026-08-02): box power-cycled by Chris after qwen@-c131072
   KV cache + laguna + ollama thrashed 123GiB used / box unreachable. On reboot: pi-web +
   ollama containers no longer exist (per Chris: leave them stopped). Relaunched laguna + qwen
   MTP; both healthy, qwen chat completes in 0.6s, 120GiB used / 4GiB free (co-residency holds).
   coder -> 127.0.0.1:8102/v1 persisted across reboot (litellm DB).
4. [ ] Add planner to scripts/litellm-bootstrap.sh ROLES; run it on box (seeds planner role)
5. [ ] Add planner to pi-web/models.seed.json.tmpl (git)
6. [ ] Add planner to oh-my-pi/models.seed.yml.tmpl (git)
7. [ ] Update LIVE runtime configs: pi-web config + ~/.omp/agent/models.yml (box, runtime state not git)
8. [ ] set-role.sh planner laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1; verify live
9. [ ] Commit + push (templates + bootstrap), move card to done/

## Signals
<!-- append-only. Leave signals for other agents. -->
<!-- signal: big-pickle 2026-08-01T23:55Z — claiming; launching qwen first per Chris's ordering -->
<!-- signal: big-pickle 2026-08-02T02:12Z — Phase 1 done+recovered; qwen MTP + laguna healthy, coder->qwen live, pi-web/ollama stopped per Chris -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Phase 1 (launch + coder) is Chris's explicit first step; role work follows.
