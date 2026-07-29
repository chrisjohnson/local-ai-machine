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
1. [x] Branch off main, change `--reasoning-format none` ->
   `--reasoning-format deepseek` in the laguna compose service
2. [x] Validate live on the ad-hoc `laguna-ctx-test` container (already
   running, not compose-managed, safe to recreate) before finalizing:
   recreate it with the new flag, send a real completion through it,
   confirm `<think>` no longer appears in `content` and instead lands in
   `reasoning_content`
3. [x] Push branch, open PR — https://github.com/chrisjohnson/local-ai-machine/pull/7
4. [ ] Get Chris's merge approval
5. [ ] Apply live on the real compose-managed service once merged (folded
   into the same server reset as M-027, per Chris's direction)

## Signals
<!-- signal: claude 2026-07-29T00:00Z — claiming, root-caused the leak to --reasoning-format none behavior, testing deepseek format live on ad-hoc container -->
<!-- signal: claude 2026-07-29T00:20Z — validated fix live, PR #7 open, awaiting merge alongside M-027/PR #5 -->

## Decision log
- Confirmed live: with `--reasoning-format deepseek` on the ad-hoc test
  container, a real `coder`-role completion returned clean `content` and
  populated `reasoning_content`; with a larger `max_tokens` budget the
  model reached `finish_reason: stop` naturally rather than running to the
  `-n` cap, suggesting the earlier "runaway" observation in M-026 may partly
  have been this model simply being very verbose in its reasoning rather
  than solely the tokenizer eos/eog defect — that defect is still real
  (warnings persist at load) and unaddressed by this change, `-n 8192`
  remains the safety net.
- After validating, the ad-hoc `laguna-ctx-test` container was restored to
  its prior state (`-c 131072`, `--reasoning-format none`) rather than left
  on the new flag, since neither this PR nor #6 is merged yet — avoids
  leaving unmerged config live.

## Handoff notes
Worktree at
`/private/tmp/claude-501/-Users-chrisjohnson-src-chrisjohnson-local-ai-machine/f0b580f5-2e07-4475-95e1-927509e7cb0e/scratchpad/laguna-reasoning-format`
(session-specific scratchpad — may not exist later; commit is safe on
`origin/laguna-reasoning-format`).

Waiting on Chris to merge PR #5 (M-002), #6 (M-027), and #7 (this card).
Once merged, server-side apply is folded into the same reset described in
M-027's handoff notes — clean `git pull --ff-only` on main (confirmed no
file overlap between #5/#6/#7 and the server's two expected local diffs:
the pre-existing untouched `transcript.jsonl` and the `set-role.sh`-driven
`docker/litellm/config.yaml` drift, which is deliberate runtime state, not
something to discard), then restart the laguna compose service with both
changes (`-c 131072` + `--reasoning-format deepseek`) live, verify health
and a real completion through `coder`.
