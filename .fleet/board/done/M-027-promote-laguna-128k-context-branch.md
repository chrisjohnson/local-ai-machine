---
id: M-027
title: Finish promoting laguna-s-2.1 128k context bump (open PR, merge, swap live container)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-29T00:00:00Z
blocks: null
blocked_by: null
related_cards: [M-026]
status: null
---

# M-027 — Promote laguna-s-2.1 128k context bump

## Context
Follow-up to M-026 (done). Chris asked to raise the laguna-s-2.1 `coder`-role
service's context window from the smoke-tested `-c 16384` toward the trained
max (`n_ctx_train: 262144`). Agreed target: `-c 131072` (128k).

Prior session live-validated `-c 131072` directly on the server via a raw
`docker run` (`laguna-ctx-test`, port 8101, NOT compose-managed) before
touching git — confirmed it loads (~+23GB KV cache over 16k config, ~27GB
free of 124GB total remaining), and a real completion through litellm's
`coder` role at the same ~30 tok/s throughput. Branch `laguna-ctx-128k`
(commit `b1d0638`, one-line diff `docker/docker-compose.yml` `-c 16384` ->
`-c 131072`) was created and pushed to origin but no PR was opened — the
prior session's auto-mode classifier blocked the `gh pr create` call,
reasoning that a "permanent" PR contradicted a "temporary test" framing.
That ambiguity ("reset back to branch norm" — revert live server to current
main, or finish promoting the validated branch) was handed off for Chris to
resolve directly rather than guessed at again.

Chris's answer (this session): **finish the promote** — open the PR, merge
it, then swap the live container from the ad-hoc `laguna-ctx-test` to the
real compose-managed service running the merged config.

Full detail: see `/tmp/handoff.md` (as of session start) and the M-026 card
decision log for the git/classifier pitfalls encountered.

## Plan
1. [x] Open PR for `laguna-ctx-128k` against main (branch + commit already
   exist, pushed) — https://github.com/chrisjohnson/local-ai-machine/pull/6
2. [x] Chris merged PR #5, #6, #7 together
3. [x] On server: `git pull --ff-only` to latest main (clean fast-forward,
   only the two known/expected local diffs remained: pre-existing
   untouched `transcript.jsonl`, and `set-role.sh`-driven
   `docker/litellm/config.yaml` runtime drift)
4. [x] `docker stop laguna-ctx-test && docker rm laguna-ctx-test`
5. [x] `docker compose up -d laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1`
   (now defined with `-c 131072` + `--reasoning-format deepseek` on main)
6. [x] Confirmed health on 8101 + a real completion through `coder` role via
   litellm (`finish_reason: stop`, clean content, no think leak)
7. [x] Ad-hoc `laguna-ctx-test` container removed

## Signals
<!-- signal: claude 2026-07-29T00:00Z — claiming, Chris confirmed "finish the promote" reading of the prior handoff's ambiguity -->

## Decision log
- Chris resolved the handoff ambiguity explicitly: finish promoting
  `laguna-ctx-128k` (open PR -> merge -> swap live container to
  compose-managed), rather than reverting the live server to current main.
- PR #6 opened. Chris merged PR #5, #6, #7 together, then had the server
  git-pulled to latest main and the laguna compose service recreated with
  both merged changes live. Confirmed working end to end.

## Handoff notes
Done. Laguna compose service is live on the server with `-c 131072` and
`--reasoning-format deepseek` (latter from M-028's PR #7, merged same
batch). Verified via a real `/v1/chat/completions` request through the
`coder` role: clean `stop` finish, no think-tag leak. Ad-hoc test
container fully removed.
