---
id: M-084
title: Serve Laguna-S-2.1 + Ornith under the big-moe/medium-moe role split
initiative_id: null
claimed_by: opencode
claimed_at: 2026-08-05T15:40:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-079]
---

# M-084 — Serve Laguna-S-2.1 + Ornith under the big-moe/medium-moe role split

## Context
Chris directive (2026-08-05): start Laguna-S-2.1 (big-moe + big-moe-continue-json)
and Ornith (the medium roles), stop any other models, and confirm git sync on main.
The two-tier role design (config.yaml header comment + litellm-bootstrap.sh) keeps
dynamic roles (big-moe/medium-moe) DB-backed via set-role.sh, while the continue-json
routes are static model_list entries in docker/litellm/config.yaml. big-moe-continue-json
was already pointed at laguna v2 (8108); medium-moe-continue-json still points at
qwen3.6-35b-a3b-mtp (8109, stopped) and must be repointed to ornith.

## Plan
1. [x] Sync box git to main (was behind: f115ddd -> 60f82f1).
2. [x] Start laguna v2 (8108) + ornith (8110); both healthy, ~122GiB/124GiB used (laguna v2 q8_0-KV co-residency design).
3. [x] set-role.sh big-moe -> laguna-s-2.1-118b-q4km (8108), live-verified.
4. [x] set-role.sh medium-moe -> ornith-1.0-35b-mtp-q8 (8110), live-verified.
5. [x] Empirically verify the pi-continue JSON-schema trick on ornith directly (schema-exact content, no preamble).
6. [ ] Repoint medium-moe-continue-json -> ornith in config.yaml; commit+push; box pull; restart litellm.
7. [ ] Confirm only laguna+ornith model containers running (stop any others).
8. [ ] Final git sync check: local main == origin/main == box.

## Signals
<!-- signal: opencode 2026-08-05T15:40Z — claiming, laguna+ornith up, roles set, verifying continue-json route -->

## Decision log
- 2026-08-05: laguna v2 (q8_0 KV) chosen over v1 (f16 KV) — big-moe-continue-json is
  hardcoded to 8108 (v2), and v2 is the build designed to co-reside with a second model.

## Handoff notes
medium-moe-continue-json repoint requires a litellm restart (static model_list route).
Verify with curl http://127.0.0.1:4000/v1/models and a live chat completion before done.
