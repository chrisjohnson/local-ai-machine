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
1. [x] Add a docker-compose service block (base on the
   `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1` block's structure,
   `-ngl 999 -fa 1 -c 262144` — this model's native context is 256K, not
   131072 like the Qwen builds — pick a free port, `--metrics`). Check
   whether it needs the same `--reasoning-format`/`-n` cap precautions
   Laguna-S-2.1 needed for its EOS/EOG bug — this is described as having
   more mature, first-party llama.cpp support, but don't assume that
   without checking the actual load-time logs for the same
   `special_eos_id is not in special_eog_ids`-style warning.
2. [x] Deploy it, confirm clean load (watch actual startup logs, not just
   "container started").
3. [x] Run a real generation benchmark: short prompt + a long-context
   prompt (matching this session's established methodology elsewhere),
   record actual tok/s, prompt-processing speed, and whether generation
   holds up or degrades at longer context.
4. [x] Create `catalog/builds/laguna-xs-2.1-33b-q4km--llamacpp-vulkan-radv.yaml`
   with the real measured results, matching this repo's existing catalog
   schema/conventions.
5. [x] Note in the decision log how it compares to Laguna-S-2.1 (the
   already-tried 8B-active sibling) and to qwen3.6-35b-a3b-mtp (the
   proven-fast 3B-active baseline) — same active-param class as the
   Qwen model, worth a direct comparison.
6. [x] Leave the box in a clean state — Chris is actively using `coder`
   (currently `qwen3.6-35b-a3b-mtp`) live; don't disturb that role or
   its backing container. Stop whichever server this card starts when
   done unless there's a reason to leave it running.

## Signals
<!-- signal: claude 2026-08-01T09:30Z — claiming, dispatching as background work alongside M-047 -->
<!-- signal: claude 2026-08-01T19:10Z — done -->

## Decision log
- Deployed `laguna-xs-2.1-33b-q4km--llamacpp-vulkan-radv-v1` on port 8106
  (`docker/docker-compose.yml`), based on the Qwen MTP block's
  devices/group_add/image pattern but with no `--spec-type` flags (no
  MTP-tensor build exists for this model) and `-c 262144` for its native
  256K context. Model loaded cleanly in ~16s; container healthy
  throughout.
- Load-time logs DID show `special_eos_id is not in special_eog_ids`
  (plus a companion `special_eot_id is not in special_eog_ids`) — the
  same warning family that caused confirmed runaway generation on the
  older Laguna-S-2.1 sibling. Checked from real logs, not assumed clean.
  However, real generation behavior differs from Laguna-S-2.1: three
  separate test requests (a short factual question with a 4096-token
  budget, a "list primes" prompt that ran to an explicit 800-token cap,
  and a ~5236-token long-context summarization prompt) all completed
  with `finish_reason: stop` well short of their token budgets (one
  stopped naturally at 121 tokens against a 4096 budget), producing
  coherent, correct, on-topic output every time — no runaway observed.
  Concluded this warning is a cosmetic tokenizer-config mismatch for
  this build, not a live generation-loop bug, and did NOT add the
  `-n`/`--reasoning-format` mitigations Laguna-S-2.1 needed. This
  conclusion rests on observed behavior across multiple prompts/budgets,
  not on the model's official-support status alone, per the card's own
  instruction not to assume either way.
- Real measured speed (llama-server request timings, same methodology/
  caveat as the Qwen MTP build — no llama-bench pp512/tg128 harness
  since this is a live-server comparison): short-context generation
  90.5-92.4 tok/s across 3 samples (avg ~91.2 tok/s, peak 92.4 tok/s),
  prompt processing 142-308 tok/s. Long-context (5236 prompt tokens):
  generation 80.7 tok/s (~13% degradation from peak, holds up well, not
  a cliff), prompt processing 974 tok/s.
- Comparison: ~3x faster than Laguna-S-2.1 (91.2 vs 30.0 tok/s avg
  generation) — expected given roughly 1/3 the total params and no known
  EOS-bug workaround needed in practice. More interestingly, *faster*
  than qwen3.6-35b-a3b-mtp's own measured numbers (91.2 vs ~62.9 tok/s
  avg, 92.4 vs 76.9 tok/s peak) despite Qwen's build using MTP
  speculative decoding and this one having no assist at all — both are
  nominally ~3B-active MoE. Flagged in the catalog notes as worth a
  follow-up: an apples-to-apples comparison against the *plain*
  (non-MTP) qwen3.6-35b-a3b build, and whether Laguna-XS-2.1 could gain
  further if an MTP-tensor build ever appears upstream.
- Verified before and after: `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1`
  was running at task start; partway through, the coordinator relayed
  that Chris stopped it himself (intentional, not something I did or
  needed to restore). litellm's `coder`/`worker`/`orchestrator`/`judge`
  roles were checked before and after this task's work and are
  unchanged (still pointing at their pre-existing targets). All other
  containers (pi-web, litellm, grafana, etc.) unaffected throughout.
  Memory during the benchmark: ~35GB system-wide used with the ~19GB
  model resident, comfortably within budget.
- Stopped the `laguna-xs-2.1-33b-q4km` container after the benchmark —
  it's not part of the standing/always-on serving set, matching the
  card's default (stop unless there's a reason to leave it running).

## Handoff notes
- Compose service: `laguna-xs-2.1-33b-q4km--llamacpp-vulkan-radv-v1`,
  port 127.0.0.1:8106, currently stopped. `docker compose up -d
  laguna-xs-2.1-33b-q4km--llamacpp-vulkan-radv-v1` (from
  `~/local-ai-machine/docker` on the host) to bring it back.
- Catalog entry: `catalog/builds/laguna-xs-2.1-33b-q4km--llamacpp-vulkan-radv.yaml`.
  Code/catalog changes pushed directly to `main`
  (commit 6cc30ce, per this repo's own direct-push-to-main convention).
- Follow-up idea (not actioned, just flagged): benchmark Laguna-XS-2.1
  against the *plain* non-MTP qwen3.6-35b-a3b build for a cleaner
  apples-to-apples "no speculative decoding on either side" comparison.
