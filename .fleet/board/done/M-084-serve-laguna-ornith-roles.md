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
routes were static model_list entries in docker/litellm/config.yaml. big-moe-continue-json
was already pointed at laguna v2 (8108); medium-moe-continue-json still points at
qwen3.6-35b-a3b-mtp (8109, stopped) and must be repointed to ornith.

## Plan
1. [x] Sync box git to main (was behind: f115ddd -> 60f82f1).
2. [x] Start laguna v2 (8108) + ornith (8110); both healthy, ~122GiB/124GiB used (laguna v2 q8_0-KV co-residency design).
3. [x] set-role.sh big-moe -> laguna-s-2.1-118b-q4km (8108), live-verified.
4. [x] set-role.sh medium-moe -> ornith-1.0-35b-mtp-q8 (8110), live-verified.
5. [x] Empirically verify the pi-continue JSON-schema trick on ornith directly (schema-exact content, no preamble).
6. [x] Repoint medium-moe-continue-json -> ornith; via DB-backed roles (bootstrap + set-role), NOT config.yaml static entries — see Decision log.
7. [x] Confirm only laguna+ornith model containers running (stop any others).
8. [x] Final git sync check: local main == origin/main == box.

## Signals
<!-- signal: opencode 2026-08-05T15:40Z — claiming, laguna+ornith up, roles set, verifying continue-json route -->
<!-- signal: opencode 2026-08-07T16:45Z — all 4 roles DB-backed+live, pressure test via :4001 passed, swap added, done -->

## Decision log
- 2026-08-05: laguna v2 (q8_0 KV) chosen over v1 (f16 KV) — big-moe-continue-json is
  hardcoded to 8108 (v2), and v2 is the build designed to co-reside with a second model.
- 2026-08-07: continue-json roles are now DB-backed, not static. Verified empirically that
  litellm `POST /model/update` REPLACES `litellm_params` wholesale (throwaway role
  zz-test-merge dropped its `response_format`). Fix: `scripts/litellm-bootstrap.sh` seeds
  both `*-continue-json` roles idempotently with the real standing backend + the
  pi-continue v4 schema (moved to `docker/litellm/pi-continue-v4-schema.json`); `set-role.sh`
  preserves extra `litellm_params` (response_format) on update. All four roles live:
  big-moe/big-moe-continue-json -> laguna v2 @8108, medium-moe/medium-moe-continue-json ->
  ornith q4 @8113. End-to-end JSON-schema valid, no preamble, finish_reason stop.
- 2026-08-07: swap task completed. 15GiB swapfile added via `swapDevices` in
  configuration.nix (swapDevices.size is MiB, 15360), nixos-rebuild switch deployed
  (unit `swapfile.swap` started), `swapon --show` = 15G. Pressure test through litellm
  HAProxy :4001 (the semaphore port — maxconn 1, cross-model serialization): 12 concurrent
  mixed-role requests, all completed, zero errors, zero schema-route failures, 0B swap
  touched, memory stable at ~109G/124G. Only laguna v2 + ornith q4 model containers run.

## Handoff notes
- All four roles DB-backed (db: True), static config.yaml continue-json entries removed.
- Pressure-test requests must go through :4001 (HAProxy semaphore), not :4000 directly.
- Box at 20c60bf; git clean locally, origin/main, and box.
- Baseline is now laguna v2 @8108 + ornith q4 @8113, both `restart: always`.
