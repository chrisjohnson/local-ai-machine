---
id: M-028
title: Stop laguna-s-2.1 <think> tags leaking into coder completions
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-29T00:00:00Z
blocks: null
blocked_by: null
related_cards: [M-026, M-027]
status: null
---

# M-028 — Fix laguna-s-2.1 think-tag leak

## Context
M-026's decision log flagged that the `coder` role (laguna-s-2.1 via
llama.cpp) leaks `<think>...</think>` reasoning into the visible
`message.content` of completions, and separately can run generation to the
`-n 8192` cap without ever emitting real content on long/complex prompts.
Chris asked this session to address the leak.

Root-caused: the compose service sets `--reasoning-format none`, which
llama-server's own `--help` documents as *"leaves thoughts unparsed in
`message.content`"* — i.e. the flag itself guarantees the leak, this is not
a bug in that specific flag's behavior. `--reasoning-format deepseek` (or
`deepseek-legacy`) makes llama-server split reasoning into a separate
`message.reasoning_content` field and keep `content` clean; server logs
confirm this build's chat template supports reasoning extraction ("chat
template supports preserving reasoning, consider enabling it via
--reasoning-preserve").

Separately, real and unfixed by this: startup logs show
`special_eos_id is not in special_eog_ids` and
`special_eot_id is not in special_eog_ids` warnings — a tokenizer/GGUF
metadata defect that may explain why generation doesn't always stop cleanly
on its own (`finish_reason: length` instead of `stop` observed on long
prompts in M-026). Not addressed by the reasoning-format change; the `-n`
cap remains the safety net for this.

Chris decided: ship this as its own branch/PR, separate from the 128k
context bump (M-027), since they're independently reviewable/revertable
changes to the same compose service.

## Plan
1. [ ] Branch off main, change `--reasoning-format none` ->
   `--reasoning-format deepseek` in the laguna compose service
2. [ ] Validate live on the ad-hoc `laguna-ctx-test` container (already
   running, not compose-managed, safe to recreate) before finalizing:
   recreate it with the new flag, send a real completion through it,
   confirm `<think>` no longer appears in `content` and instead lands in
   `reasoning_content`
3. [ ] Push branch, open PR
4. [ ] Get Chris's merge approval
5. [ ] Apply live on the real compose-managed service once merged

## Signals
<!-- signal: claude 2026-07-29T00:00Z — claiming, root-caused the leak to --reasoning-format none behavior, testing deepseek format live on ad-hoc container -->

## Decision log
(pending)

## Handoff notes
(pending)
