---
id: M-058
title: Rank downloaded models by importance for disk cleanup
initiative_id: null
claimed_by: big-pickle
claimed_at: 2026-08-03T00:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-047, M-051]
---

# M-058 — Rank downloaded models by importance for disk cleanup

## Context
Disk at 87% (1.9T volume, 1.6T used, ~241G free). 29 model dirs, ~1.3T
total under /var/lib/ai-models. Chris wants the least-important models
identified so he can pick what to delete. All models are re-downloadable
(declarative `models` list in configuration.nix), so deletion is
recoverable — ranking weighs live-role use, uniqueness, benchmark status,
and size, not "can we get it back."

## Live production roles (from litellm DB, queried 2026-08-03, authoritative)
- `coder` -> qwen3.6-35b-a3b-mtp @ 8109 (llamacpp MTP v2) — RUNNING
- `planner` -> laguna-s-2.1-118b-q4km @ 8108 (llamacpp v2) — RUNNING
- `worker` -> qwen3.5-122b-a10b-mtp @ 8105 (llamacpp MTP)
- `judge` / `orchestrator` -> glm-4.7-flash-judge @ 8103 (llamacpp GGUF)
- `vision` -> qwen2.5-vl-7b-instruct @ 8010 (vLLM)

## Ranking — least important first (delete candidates)

### Tier A — safe to delete now (broken / never-served / superseded duplicate)
1. `ds4-deepseek-v4-flash-iq2xxs` (85G) — WRONG-variant DS4 DwarfStar
   weights (non-imatrix). Superseded by the `-imatrix` copy; M-047/M-051
   explicitly flagged this dir for deletion to reclaim ~84GB. All its
   benchmarks are recorded.
2. `north-mini-code-1.0-w4a16` (19G) — BROKEN: NVFP4 MoE backend missing
   on gfx1151, never served. Download existed despite config comment
   saying "deliberately NOT started."
3. `laguna-s-2.1-dflash-draft` (2.1G) — long-shot DFlash draft (M-052);
   stock llama.cpp very likely can't even load the architecture; never
   deployed.
4. `ollama-gemma-4-26b-a4b-it` (16G) — Ollama build genuinely broken
   (unknown `gemma4` architecture), blocked on pinned Ollama 0.17.7.
5. `llamacpp-qwen3.5-122b-a10b` (86G) — byte-identical UD-Q5_K_XL shards
   to the `-mtp` dir that serves `worker` (base weights duplicated across
   both; only extra file in mtp dir is the MTP tensor).

### Tier B — strong candidates (benchmarked, redundant or unused)
6. `qwen3.5-122b-a10b-awq4bit` (75G) — vLLM AWQ copy of worker model,
   measured slower than GGUF path (8.1-16.3 vs 22.2 tok/s).
7. `llamacpp-qwen3.6-27b-mtp` (16G) — MTP experiment on dense 27B, no role.
8. `ollama-qwen3.6-27b` (16G) — third copy of 27B (vLLM bf16 + MTP GGUF
   also present).
9. `qwen3.6-27b` (52G) — dense 27B bf16 vLLM, benchmarked, no role.
10. `gpt-oss-20b` (13G) — former judge candidate, superseded by GLM judge.
11. `qwen3.5-4b` (8.8G) — former judge (`qwen3.5-4b-judge`), superseded.
12. `laguna-xs-2.1-33b-q4km` (19G) — TESTED_NOT_VIABLE as spec draft
    (M-050); standalone benchmarked (M-049) but no role.

### Tier C — keep unless really need space (unique, good, plausible future)
13. `llamacpp-minimax-m2.7` (88G) — best 100B+ performer measured (31 tok/s),
    unique model, no role.
14. `llamacpp-nemotron-3-super-120b` (79G) — 14.86 tok/s, unique, no role.
15. `llamacpp-deepseek-v4-flash-iq2xxs` (85G) — unsloth llama.cpp GGUF of
    DS4 preview; best DS4 path so far (13.23 tok/s, 22/22 seven-tier).
16. `ds4-deepseek-v4-flash-iq2xxs-imatrix` (85G) — NEEDED for in-flight
    M-051 re-benchmark; do not delete yet.
17. `gpt-oss-120b` vLLM (61G) + `llamacpp-gpt-oss-120b` (60G) — one model,
    two formats, no role. Could free ~121G by dropping both, or ~60G by
    keeping one format.
18. `gemma-4-31b-it` (59G) — dense, benchmarked, no role.
19. `gemma-4-26b-a4b-it` vLLM (49G) — benchmarked, no role.

### Tier D — do not delete (live roles)
- `llamacpp-qwen3.6-35b-a3b-mtp` (22G) — coder, RUNNING
- `laguna-s-2.1-118b-q4km` (69G) — planner, RUNNING
- `llamacpp-qwen3.5-122b-a10b-mtp` (88G) — worker
- `ollama-glm-4.7-flash` (18G) — judge + orchestrator
- `qwen2.5-vl-7b-instruct` (16G) — vision
- `ollama-qwen3.6-35b-a3b` (21G) — plain Q4 GGUF fallback of coder, small
- `qwen3.6-35b-a3b` vLLM bf16 (67G) — former primary; keep unless
  consolidating coder permanently on the GGUF/MTP path (67G reclaimable).

## Decision log
- Tier A alone frees ~208G; Tier A+B frees ~408G. Either restores real
  headroom from the current 241G free.
- Actual deletion is Chris's call (destructive/irreversible-adjacent hard
  stop): pick tiers/items, then removal = edit configuration.nix `models`
  list + delete dirs on host, driven through git.

## Handoff notes
Nothing deleted. Follow-up (Chris's pick): drop selected configuration.nix
entries, `ssh local-ai-machine` rm dirs, commit+push, nixos-rebuild (or
manual prune) to retire the download services.
