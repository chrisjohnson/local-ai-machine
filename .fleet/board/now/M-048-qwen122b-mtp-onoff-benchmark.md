---
id: M-048
title: Benchmark Qwen3.5-122B-A10B with MTP on vs off, record results
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-01T00:15:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-047]
---

# M-048 — Benchmark Qwen3.5-122B-A10B MTP on vs off

## Context
Both variants are already fully downloaded on the box:
`llamacpp-qwen3.5-122b-a10b` (plain, UD-Q5_K_XL, 3 shards) and
`llamacpp-qwen3.5-122b-a10b-mtp` (MTP variant, same UD-Q5_K_XL quant
tier — chosen specifically to make this a clean same-quant comparison,
per the original download rationale).

Existing data to build from, confirmed by reading the catalog directly:
- `catalog/builds/qwen3.5-122b-a10b--llamacpp-vulkan-radv.yaml` already
  has a **locally-measured** result: `benchmark_id: llamacpp-bench-v1`,
  `tg128_tok_s: 22.16 ± 0.02` (the standard llama-bench pp512/tg128
  harness). No docker-compose service exists for this build — it was run
  as a swap-in comparison tier, not a standing service.
- **No catalog build entry exists yet for the MTP variant** — needs to be
  created as part of this card.
- **Real methodology constraint, already discovered elsewhere in this
  repo** (see `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp.yaml`'s own
  notes): `llama-bench` does not support `--spec-type`/MTP flags at all
  (confirmed via `--help`, no spec/draft/mtp flags present) — so the
  standard `llamacpp-bench-v1` pp512/tg128 harness **cannot** be used for
  the MTP side of this comparison. The established pattern elsewhere in
  this repo is request-timing via a live `llama-server` instance instead.
  **For a fair comparison, benchmark BOTH variants (MTP and non-MTP) via
  that same live-server request-timing method** — don't compare the
  existing `llamacpp-bench-v1` number for the plain variant against a
  differently-measured MTP number; re-measure the plain variant the same
  way too, or the comparison isn't actually apples-to-apples.

## Plan
1. [ ] Deploy the plain (non-MTP) variant via a live `llama-server`
   instance (swap-in style, matching this repo's existing pattern for
   comparison-tier builds — no need for a standing compose service).
   Run a real timed-generation benchmark (short + long context, matching
   the methodology already used elsewhere this session for judging
   context-length degradation) and record actual tok/s.
2. [ ] Stop it, deploy the MTP variant (`--spec-type draft-mtp
   --spec-draft-n-max 3 -np 1`, matching the flags already proven for
   the qwen3.6-35b-a3b-mtp build), run the identical benchmark
   methodology, record actual tok/s.
3. [ ] Create the missing catalog build entry for the MTP variant
   (`catalog/builds/qwen3.5-122b-a10b-mtp--llamacpp-vulkan-radv-mtp.yaml`
   or similar, matching existing naming conventions) with the real
   measured results.
4. [ ] State the conclusion plainly: how much (if any) speedup did MTP
   give here, and does it hold up at longer context, not just short
   prompts.
5. [ ] Leave the box in a clean state when done (stop whichever llama
   server instance is left running unless there's a reason to keep one
   live — `worker`/`orchestrator`/`judge` roles should be undisturbed by
   this benchmarking work).

## Signals
<!-- signal: claude 2026-08-01T00:15Z — claiming, Chris stepping away, standing permission to operate on the host granted -->

## Decision log

## Handoff notes
