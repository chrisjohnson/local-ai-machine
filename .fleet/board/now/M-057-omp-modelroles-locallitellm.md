---
id: M-057
title: Configure omp modelRoles routing to local litellm coder/planner roles
initiative_id: null
claimed_by: big-pickle
claimed_at: '2026-08-02T03:10:00Z'
blocks: null
blocked_by: null
status: null
related_cards:
- M-056
- M-043
---

# M-057 — Configure omp modelRoles routing to local litellm coder/planner roles

## Context
- omp (oh-my-pi container, v17.2.4) reads settings from `~/.omp/agent/config.yml`.
  Its built-in modelRoles (confirmed from the installed package's
  `types/config/model-roles.d.ts`): `default, smol, slow, vision, plan, designer,
  commit, tiny, task, advisor` — a generic `Record<string,string>`.
- We run two litellm-backed local roles: `local-litellm/coder` (qwen3.6-35b-a3b MTP
  @:8102, fast) and `local-litellm/planner` (laguna-s-2.1 @:8108, 118B deep reasoning).
- Box's live `~/.omp/agent/config.yml` only maps `default`+`plan`; commit the full
  mapping as the source of truth in `oh-my-pi/.omp/agent/config.yml` and seed it
  from the image (Dockerfile COPY + docker-entrypoint.sh seed-once).
- Per Chris: targets are coder/planner only; keep the config.yml COPY after the
  `bun install` layer so edits don't bust the slow Bun cache.

## Plan
1. [x] Write `oh-my-pi/.omp/agent/config.yml` mapping all 10 built-in roles to coder/planner
2. [x] Dockerfile: COPY config.yml after bun install layer
3. [x] docker-entrypoint.sh: seed config.yml (seed-once, no key substitution needed)
4. [ ] Commit + push; verify no cache-bust (bun layer before COPY)
5. [ ] Deploy: pull on box, apply modelRoles to live config.yml, restart omp container
6. [ ] Verify live config.yml takes effect (omp container up, no seed-overwrite)

## Signals
<!-- signal: big-pickle 2026-08-02T03:10:00Z — claiming, writing config.yml + Dockerfile + entrypoint -->

## Decision log
- 2026-08-02: map `default/smol/commit/tiny/task/vision -> coder` (fast, interactive,
  fan-out); `slow/plan/designer/advisor -> planner` (heavy reasoning/planning).
  No `:thinking` suffixes (llama.cpp serving doesn't support effort levels).

## Handoff notes
- Box already has a live `~/.omp/agent/config.yml` (default+plan only). The image
  seed-once guard will NOT overwrite it; must apply the modelRoles block to the
  live file manually (preserving its other fields like symbolPreset/theme).
