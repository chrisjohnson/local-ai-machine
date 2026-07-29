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
2. [ ] Get Chris's merge approval (or merge directly if authorized) — do not
   merge unilaterally without confirming. Also waiting on PR #5 (catalog
   format migration, M-002) to merge first per Chris's request — no file
   overlap with this PR (#5 only touches `catalog/`), so ordering doesn't
   matter for conflicts, just for a clean sequential apply on the server.
3. [ ] On server: `git fetch && git checkout main && git pull --ff-only`
4. [ ] `docker stop laguna-ctx-test` (ad-hoc test container)
5. [ ] `docker compose up -d laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1`
   (now defined with `-c 131072` on main)
6. [ ] Confirm health on 8101 + a real completion through `coder` role via
   litellm
7. [ ] Remove/clean up the ad-hoc `laguna-ctx-test` container definitively

## Signals
<!-- signal: claude 2026-07-29T00:00Z — claiming, Chris confirmed "finish the promote" reading of the prior handoff's ambiguity -->

## Decision log
- Chris resolved the handoff ambiguity explicitly: finish promoting
  `laguna-ctx-128k` (open PR -> merge -> swap live container to
  compose-managed), rather than reverting the live server to current main.
- PR #6 opened. Chris is separately merging PR #5 (M-002 catalog format
  migration) and asked that once everything's merged, the server be reset
  to a clean git state on latest main and the laguna model restarted —
  this folds the M-027 server-side steps into that reset rather than doing
  them as an isolated swap.

## Handoff notes
Worktree for this branch exists at
`/private/tmp/claude-501/-Users-chrisjohnson-src-chrisjohnson-local-ai-machine/d839afed-eb5a-48c6-8dbc-c209def35f01/scratchpad/laguna-ctx-128k`
(session-specific scratchpad path — may not exist in a future session; the
commit is safe on `origin/laguna-ctx-128k` regardless).

Waiting on Chris to merge PR #5, #6 (and #7 from M-028). Once merged: on
the server, get to a clean git state on latest main (there's a known
pre-existing unrelated modified file in the checkout,
`catalog/raw/.../transcript.jsonl` — do not touch/discard it, it's not
ours; "clean working tree" refers to our own changes, not this file, so
confirm with Chris if `git status` isn't clean after checking out main),
then restart the laguna compose service and verify.
