---
id: M-049
title: Deploy + benchmark Laguna XS 2.1, record results
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-01T09:30:00Z
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-049 — Deploy + benchmark Laguna XS 2.1

## Context
`laguna-xs-2.1-33b-q4km` finished downloading (19GB, single-file GGUF,
`poolside/Laguna-XS-2.1-GGUF`, `Laguna-XS-2.1-Q4_K_M.gguf`). This is a
standard llama.cpp GGUF (unlike M-047's DS4, which is a whole new engine
integration) — 33B total / 3B active MoE, 256K native context, official
first-party GGUF from poolside. No docker-compose service or catalog
build entry exists for it yet; this card is the first deploy + real
benchmark, same pattern as every other llama.cpp model already in this
repo.

## Plan
1. [ ] Add a docker-compose service block (base on the
   `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1` block's structure,
   `-ngl 999 -fa 1 -c 262144` — this model's native context is 256K, not
   131072 like the Qwen builds — pick a free port, `--metrics`). Check
   whether it needs the same `--reasoning-format`/`-n` cap precautions
   Laguna-S-2.1 needed for its EOS/EOG bug — this is described as having
   more mature, first-party llama.cpp support, but don't assume that
   without checking the actual load-time logs for the same
   `special_eos_id is not in special_eog_ids`-style warning.
2. [ ] Deploy it, confirm clean load (watch actual startup logs, not just
   "container started").
3. [ ] Run a real generation benchmark: short prompt + a long-context
   prompt (matching this session's established methodology elsewhere),
   record actual tok/s, prompt-processing speed, and whether generation
   holds up or degrades at longer context.
4. [ ] Create `catalog/builds/laguna-xs-2.1-33b-q4km--llamacpp-vulkan-radv.yaml`
   with the real measured results, matching this repo's existing catalog
   schema/conventions.
5. [ ] Note in the decision log how it compares to Laguna-S-2.1 (the
   already-tried 8B-active sibling) and to qwen3.6-35b-a3b-mtp (the
   proven-fast 3B-active baseline) — same active-param class as the
   Qwen model, worth a direct comparison.
6. [ ] Leave the box in a clean state — Chris is actively using `coder`
   (currently `qwen3.6-35b-a3b-mtp`) live; don't disturb that role or
   its backing container. Stop whichever server this card starts when
   done unless there's a reason to leave it running.

## Signals
<!-- signal: claude 2026-08-01T09:30Z — claiming, dispatching as background work alongside M-047 -->

## Decision log

## Handoff notes
