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
1. [x] Deploy the plain (non-MTP) variant via a live `llama-server`
   instance (swap-in style, matching this repo's existing pattern for
   comparison-tier builds — no need for a standing compose service).
   Run a real timed-generation benchmark (short + long context, matching
   the methodology already used elsewhere this session for judging
   context-length degradation) and record actual tok/s.
2. [x] Stop it, deploy the MTP variant (`--spec-type draft-mtp
   --spec-draft-n-max 3 -np 1`, matching the flags already proven for
   the qwen3.6-35b-a3b-mtp build), run the identical benchmark
   methodology, record actual tok/s.
3. [x] Create the missing catalog build entry for the MTP variant
   (`catalog/builds/qwen3.5-122b-a10b-mtp--llamacpp-vulkan-radv-mtp.yaml`
   or similar, matching existing naming conventions) with the real
   measured results.
4. [x] State the conclusion plainly: how much (if any) speedup did MTP
   give here, and does it hold up at longer context, not just short
   prompts.
5. [x] Leave the box in a clean state when done (stop whichever llama
   server instance is left running unless there's a reason to keep one
   live — `worker`/`orchestrator`/`judge` roles should be undisturbed by
   this benchmarking work).

## Signals
<!-- signal: claude 2026-08-01T00:15Z — claiming, Chris stepping away, standing permission to operate on the host granted -->
<!-- signal: claude 2026-08-01T02:10Z — done, MTP gave +63-67% tok/s, held at long context -->

## Decision log

- Pre-flight checks: `docker ps`/`free -h`/`rocm-smi --showmeminfo vram gtt`
  confirmed only `glm-4.7-flash--llamacpp-vulkan-radv-v1` (port 8103) was
  running a GPU model, using ~192MB VRAM / ~22GB GTT baseline. Litellm's
  `/model/info` confirmed `judge`, `orchestrator`, and `coder` roles all
  point at that same service (`openai/glm-4.7-flash-judge` @ 127.0.0.1:8103)
  — that container was never touched. The two active download services
  (`download-model-ds4-deepseek-v4-flash-iq2xxs`,
  `download-model-laguna-xs-2.1-33b-q4km`) were left running throughout —
  confirmed disk/network I/O only, no GPU conflict, still `activating`
  at the end of this work.
- Added two new docker-compose.yml services (not previously present):
  `qwen3.5-122b-a10b--llamacpp-vulkan-radv-v1` (port 8104, plain, no MTP
  flags) and `qwen3.5-122b-a10b-mtp--llamacpp-vulkan-radv-mtp-v1` (port
  8105, `--spec-type draft-mtp --spec-draft-n-max 3 -np 1`), both based
  directly on the `qwen3.6-35b-a3b-mtp` block's structure, `-c 131072`,
  `--metrics`. Committed directly to main (`8ae15aa`) per this repo's
  direct-push convention, then pulled on the host before deploying.
  Neither service was wired into any litellm role — swap-in comparison
  tiers only, matching this repo's existing pattern for
  `laguna-s-2.1-118b-q4km` and `qwen3.6-35b-a3b-mtp`.
- Confirmed via server logs that MTP actually engaged:
  `common_speculative_init_result: creating MTP draft context against the
  target model`, `n_slots = 1, kv_unified = 'false'`.
- Methodology: per the card's own note (and `qwen3.6-35b-a3b-mtp`'s prior
  finding that `llama-bench --help` has no spec/draft/mtp flags), both
  variants were benchmarked identically via live `llama-server` request
  timing against `/v1/chat/completions`, reading the `timings` block
  llama-server returns (authoritative per-request `predicted_per_second`/
  `prompt_per_second`, not a hand-rolled wall-clock estimate). Two prompts
  per variant: a short prompt (30 prompt tokens) and a long-context prompt
  (7845 prompt tokens, ~44KB of filler text ending in a question), both
  capped at `max_tokens=400`. As a sanity check, the plain variant's
  live-request tg number (21.90/21.18 tok/s) closely matched its existing
  `llamacpp-bench-v1` figure (22.16 tok/s) — confirms the two methodologies
  agree within noise, so the live-request numbers are trustworthy for the
  MTP-side comparison too.
- **Result — MTP gave a real, substantial speedup that HELD UP (in fact
  strengthened slightly) as context grew, not just on short prompts:**
  - Short prompt (30 tok prompt): plain 21.90 tok/s -> MTP 35.63 tok/s
    (**+62.7%**), draft acceptance 286/336 = 85.1%.
  - Long context (7845 tok prompt): plain 21.18 tok/s -> MTP 35.38 tok/s
    (**+67.0%**), draft acceptance 290/327 = 88.7%.
  - Prompt-processing (prefill) speed was essentially unaffected either
    way (257-268 tok/s), as expected — MTP only accelerates decode.
  - Conclusion: MTP is a clear win for Qwen3.5-122B-A10B at this quant
    tier — worth treating as the standing choice over the plain variant
    for any generation-heavy workload. No degradation observed out to
    ~8K context; draft acceptance rate, if anything, improved slightly
    at longer context in this run (not enough samples to call that a
    trend, just noting it didn't get worse).
- Catalog updated: new entry
  `catalog/builds/qwen3.5-122b-a10b-mtp--llamacpp-vulkan-radv-mtp.yaml`
  with the full `llamacpp-live-request-v1` benchmark_run (both prompts,
  fingerprint, raw response files under `catalog/raw/`). Existing
  `catalog/builds/qwen3.5-122b-a10b--llamacpp-vulkan-radv.yaml` got a new
  `benchmark_run` (live-request, additive — the original `llamacpp-bench-v1`
  entry was left untouched) with a note explaining why a second measurement
  method was used.
- Box left clean: both benchmark containers stopped and removed after use,
  `rocm-smi` GTT usage back to the pre-work ~22GB baseline, `docker ps`
  container list identical to the pre-work snapshot, litellm's
  `judge`/`orchestrator`/`coder` roles re-verified unchanged and still
  pointed at `glm-4.7-flash--llamacpp-vulkan-radv-v1`.
- Why this card is done: both variants were live-benchmarked with the
  same methodology as required, MTP's benefit was measured and confirmed
  to hold at long context (not just short prompts), the missing MTP
  catalog entry was created, the plain variant's catalog entry got a
  second, comparable measurement, and the box was returned to its
  original state with worker/orchestrator/judge undisturbed.

## Handoff notes

No blockers hit. Both models loaded and ran without issue on the first
attempt; no sudo needed beyond what was already granted for docker
operations. If a future benchmark wants tighter numbers, consider a
larger completion budget than `max_tokens=400` (both runs hit
`finish_reason: length` while still inside `<think>` content, since this
is a reasoning model) — didn't affect the tok/s measurement itself
(llama-server's own per-token timings), but a full non-thinking answer
would make the raw transcripts more useful for qualitative review later.
