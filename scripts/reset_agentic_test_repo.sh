#!/usr/bin/env bash
set -euo pipefail

# Resets chrisjohnson/local-ai-machine-test back to its canonical clean
# baseline. This repo is shared/long-lived across every agentic-coding-
# session benchmark run (task git-pr-ci-v1, see
# catalog/agentic-tasks/git-pr-ci-v1/) -- it is intentionally NOT
# recreated per run. This script is what makes that safe: run it before
# (and/or after) every model's run so each run starts from an identical,
# known-good state.
#
# What it does, in order:
#   1. Closes every open PR against the repo.
#   2. Deletes every branch except the default branch (main).
#   3. Force-pushes the `baseline` tag's tree onto `main`, so main's
#      history/content exactly matches the baseline commit again.
#   4. Re-verifies: no open PRs, no other branches, main == baseline tag.
#
# Idempotent -- safe to run repeatedly, including against an
# already-clean repo (in which case steps 1-2 are no-ops).
#
# Auth: uses whatever `gh`/`git` are already authenticated as in the
# calling environment. On the box, this should be the fine-grained PAT
# scoped to just local-ai-machine-test (see secrets/gh-agentic-test-repo-token.env.example)
# -- export GH_TOKEN from that file before calling this script, e.g.:
#   set -a; source secrets/gh-agentic-test-repo-token.env; set +a
#   scripts/reset_agentic_test_repo.sh
#
# Real gap found 2026-07-28 (M-021 harness smoke testing): this fine-grained
# PAT can READ the Git Data API (GET .../git/refs/...) fine but cannot WRITE
# to it -- PATCH (force-update a ref) and DELETE (delete a ref) both return
# "403 Resource not accessible by personal access token", confirmed directly
# against this exact repo/token, despite `permissions.push: true` showing at
# the repo level. This is a documented-elsewhere fine-grained-PAT quirk (the
# low-level Git Data API's ref-mutation endpoints are more restricted than
# the Contents/Pulls REST APIs for this token type), not a scope Chris
# forgot to grant. Branch delete and the main-branch force-reset below
# therefore go over plain `git push` via SSH (the account-level deploy key,
# already confirmed working for push/pull against this repo in M-021's own
# auth investigation) instead of `gh api .../git/refs/...` PATCH/DELETE.
# PR listing/closing still goes through `gh` (Pulls API, not Git Data API --
# confirmed working with this token, untouched by this gap).
#
# Usage:
#   scripts/reset_agentic_test_repo.sh [--repo OWNER/NAME] [--baseline-ref REF]

REPO="chrisjohnson/local-ai-machine-test"
BASELINE_REF="baseline"
DEFAULT_BRANCH="main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"; shift 2 ;;
    --baseline-ref)
      BASELINE_REF="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

# SSH_REMOTE derived AFTER arg parsing so a --repo override is respected.
SSH_REMOTE="git@github.com:${REPO}.git"

command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

echo "== Resetting $REPO to '$BASELINE_REF' baseline =="

echo "-- Closing open PRs --"
open_prs="$(gh pr list -R "$REPO" --state open --json number -q '.[].number' || true)"
if [[ -n "$open_prs" ]]; then
  while IFS= read -r pr_number; do
    [[ -z "$pr_number" ]] && continue
    echo "   closing PR #$pr_number"
    gh pr close "$pr_number" -R "$REPO" --delete-branch || \
      gh pr close "$pr_number" -R "$REPO"
  done <<< "$open_prs"
else
  echo "   none open"
fi

echo "-- Deleting non-default branches --"
other_branches="$(gh api "repos/$REPO/branches" --paginate -q '.[].name' \
  | grep -v -x "$DEFAULT_BRANCH" || true)"
if [[ -n "$other_branches" ]]; then
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    echo "   deleting branch $branch"
    # git push --delete over SSH, NOT `gh api -X DELETE .../git/refs/...` --
    # the latter 403s with this fine-grained PAT (see the auth note at the
    # top of this file), confirmed directly 2026-07-28.
    git push "$SSH_REMOTE" --delete "$branch" >/dev/null 2>&1 || \
      echo "   (already gone: $branch)"
  done <<< "$other_branches"
else
  echo "   none to delete"
fi

echo "-- Force-resetting $DEFAULT_BRANCH to $BASELINE_REF --"
baseline_sha="$(gh api "repos/$REPO/git/refs/tags/$BASELINE_REF" -q '.object.sha')"
# Tags can point at annotated tag objects rather than commits directly --
# resolve to the underlying commit SHA either way.
baseline_type="$(gh api "repos/$REPO/git/refs/tags/$BASELINE_REF" -q '.object.type')"
if [[ "$baseline_type" == "tag" ]]; then
  baseline_sha="$(gh api "repos/$REPO/git/tags/$baseline_sha" -q '.object.sha')"
fi
echo "   baseline commit: $baseline_sha"

# git push --force over SSH, NOT `gh api -X PATCH .../git/refs/heads/main`
# -- the latter 403s with this fine-grained PAT (see the auth note at the
# top of this file: this token can read the Git Data API but not write to
# it), confirmed directly 2026-07-28. Uses a local bare-ish temp clone
# rather than pushing from any existing on-box checkout, so this never
# touches/depends on this repo's own working tree.
reset_tmpdir="$(mktemp -d)"
trap 'rm -rf "$reset_tmpdir"' EXIT
git clone --quiet --no-checkout "$SSH_REMOTE" "$reset_tmpdir" >/dev/null 2>&1
git -C "$reset_tmpdir" push --force "$SSH_REMOTE" "${baseline_sha}:refs/heads/${DEFAULT_BRANCH}" >/dev/null

echo "-- Verifying clean state --"
remaining_prs="$(gh pr list -R "$REPO" --state open --json number -q '. | length')"
remaining_branches="$(gh api "repos/$REPO/branches" --paginate -q '.[].name' \
  | { grep -v -x "$DEFAULT_BRANCH" || true; } | wc -l | tr -d ' ')"
current_main_sha="$(gh api "repos/$REPO/git/refs/heads/$DEFAULT_BRANCH" -q '.object.sha')"

echo "   open PRs: $remaining_prs"
echo "   non-default branches: $remaining_branches"
echo "   $DEFAULT_BRANCH sha: $current_main_sha (expected $baseline_sha)"

if [[ "$remaining_prs" != "0" || "$remaining_branches" != "0" || "$current_main_sha" != "$baseline_sha" ]]; then
  echo "RESET VERIFICATION FAILED" >&2
  exit 1
fi

echo "== $REPO is clean at baseline =="
