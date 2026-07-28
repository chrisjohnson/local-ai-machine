---
id: M-021
title: Add agentic-coding-session benchmark tier (opencode-driven), emphasize in dashboard
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-023]
---

# M-021 — Agentic-coding-session benchmark tier

## Context

Every existing coding methodology (`seven-tier-coding-v2`) is single-shot or
scripted multi-turn — even Tier D ("multi-turn interactive debugging") is a
fixed 3-turn conversation, not a real agentic session with autonomous tool
use across a real task. Chris's actual primary use case for this whole
benchmarking effort is running models *as a coding agent* day-to-day (he
just had opencode wired up to this box's litellm proxy) — none of the
current data measures that directly. **This is explicitly his headline
metric** — the existing benchmark data is "just the foundation" (his words).

Design decisions confirmed via two rounds of questions (2026-07-27/28):

1. **Harness: opencode AND Pi agent, both, compared head-to-head** (revised
   2026-07-28 — originally opencode-only). Chris wants a second benchmark
   using Pi agent (`@mariozechner/pi-coding-agent`, `badlogic/pi-mono`) run
   against the *same* task set/criteria, specifically to see how the two
   harnesses compare, not just the models. Both run headless against each
   candidate model via the litellm proxy. Recorded as two separate
   benchmark_ids per build (e.g. `agentic-coding-session-opencode-v1` /
   `agentic-coding-session-pi-v1`), not merged into one metric — the whole
   point is to compare them, not average them away.

   Pi CLI mechanics researched 2026-07-28 (real, verified via its GitHub
   README/docs, not guessed):
   - Headless: `pi -p "<prompt>"` (print mode, text out) or
     `pi --mode json "<prompt>"` (full JSON event stream — this is what the
     harness should use, matches wanting a full transcript per point 5
     above).
   - Model targeting: `--model <pattern>`; custom OpenAI-compatible
     endpoints (litellm) supported via a model's `baseUrl` config, same
     mechanism used for Ollama/vLLM/SGLang per its own docs — needs a
     config entry per candidate model/alias, similar to opencode's
     provider-config requirement.
   - No documented sandboxing — full filesystem access by default (same as
     opencode), confirmed via its own README; there's a known community
     concern about blast radius (a "pi-less-yolo" Docker wrapper project
     exists specifically because of this). Scratch-workspace-per-run
     confinement (already planned regardless, for the hidden-test
     mechanism) covers this, but worth being deliberate about — don't rely
     on Pi to self-restrict.
   - Exit codes, max-turns/step limits, and timeout flags were **not**
     found documented anywhere — the harness will likely need to enforce
     the 45min ceiling itself externally (process-level timeout/kill)
     rather than relying on a built-in Pi flag. Needs confirming during
     implementation, not assumed solved.
2. **Hidden tests, never visible to the agent.** The grading suite must live
   entirely outside the scratch workspace the agent operates in (opencode
   has full filesystem/shell access inside it, so anything present could be
   read) — copy grading artifacts in only after the session ends.
3. **Grading: percent, not binary.** Each task's hidden suite has multiple
   checks; record pass_count/total_count, matching the existing tier_x_pass
   /tier_x_total convention.
4. **Per-task time budget: generous, not stingy — real sessions with
   qwen3.6-35b-a3b already ran 15+ minutes.** GPU cycles spent finding the
   right model/build for his actual workflow are considered well spent, not
   a cost to minimize — this machine's entire current purpose is that
   search. Do not compromise budget or task richness to save runtime.
   Working ceiling: **45 minutes/task** (not the originally-proposed 10) —
   record actual wall-clock time as its own data point regardless, so a
   slow-but-eventually-correct model is distinguishable from a real
   timeout, not conflated with it.
5. **Record the complete session log/transcript, not just summary
   metrics** — every tool call, file edit, message. Disk space is not a
   constraint ("disk is cheap, record lots of data"). This also sets up his
   stated longer-term plan: capturing real work sessions with him directly
   and assessing models against how he actually works, not just synthetic
   tasks — the logging infrastructure built here should be reusable for
   that later, not a one-off.
6. **Task nature — bigger scope change than originally sketched.** Chris's
   own words: "It's less about the specific code and more about the flow.
   When I'm working, my agent is researching documentation, reading the
   codebase, planning changes, making PRs and merging them and watching
   their workflows for completion, connecting to real systems to validate
   that the changes were successful, building/stopping/starting docker
   containers and then directly interacting with them to test things."
   This is **not** 3 small isolated scaffolded-repo-plus-pytest tasks — it's
   a realistic DevOps-flavored loop: docs research → codebase navigation →
   real git/PR/CI workflow → live-system validation → container lifecycle
   management. The original 3 draft tasks (multi-file bug fix / feature-add
   / refactor) are too narrow and are **superseded** by this — see revised
   task sketch below. Notably, this closely mirrors what this very repo
   already looks like (NixOS config, docker-compose, catalog/YAML docs,
   PR-based changes) — there may be real value in modeling task scaffolds
   after a small disposable repo styled similarly to this one, since that's
   literally representative of his real workflow.
7. **Dashboard: yes, primary/headline metric, confirmed** — "performance
   (speed, throughput) and quality during agentic loops are really my
   biggest focuses. The underlying benchmark data so far has really just
   been the foundation." Existing seven-tier/speed data becomes supporting
   context underneath this.

Related: **M-023** (orchestrator per-benchmark-id idempotency, PR #3 open)
was filed and completed specifically to make sure adding this new
benchmark_id later slots in cleanly against already-benchmarked builds.

## Revised task sketch (supersedes the original 3 toy tasks)

Needs a realistic substrate for each of: docs/codebase research, a real
git/PR/CI workflow, docker container lifecycle, live-system validation.
Concretely still being worked out (see open question below), but shape:

1. **Docs-research + implementation task** — given a small
   scaffolded repo with real (if compact) documentation the agent must
   actually read to understand a convention/constraint, implement a change
   that only makes sense if it read the docs. Grade: hidden checks against
   the resulting code/config.
2. **Git/PR/CI workflow task** — agent must create a branch, make a change,
   push, open a PR, wait for CI to run, merge it. Grade: objective checks
   against the resulting repo state (PR merged, CI actually ran and passed,
   correct commit history) — needs a real git remote + CI substrate, open
   question below.
3. **Docker lifecycle + live-system validation task** — agent must
   build/start a small multi-container app, make a change, validate the
   change against the *running* system (e.g. hit a health endpoint, check
   expected behavior via a real request), stop things cleanly. Grade:
   objective checks against real runtime state at each stage, not just
   final files.

## Git/PR/CI substrate — decided

**Real GitHub, one long-lived shared repo**, not per-run disposable, not
self-hosted Gitea. Created 2026-07-28:
`https://github.com/chrisjohnson/local-ai-machine-test` (private).

Chris's explicit clarification: this is **one repo shared across every
task run, that he will not clean up himself** — the harness owns resetting
it to a clean baseline before/after each model's run, not Chris. Concretely
this means the harness needs a reset routine as a first-class piece of the
task-2 implementation:
- A known-good baseline (e.g. a `template` branch or tagged commit)
  representing the pristine starting state (scaffold files, docs, starter
  CI workflow).
- Before each model's run: force-reset the default branch to that baseline,
  delete any branches left over from the previous run, close/delete any
  stray open PRs — via `git push --force` + `gh pr list`/`gh pr close` +
  `git push origin --delete <branch>` (exact mechanism TBD during
  implementation, not fully speced yet).
- Auth: still open how the box/opencode authenticates against this repo
  (the existing GitHub deploy key for `local-ai-machine` itself is
  per-repo and won't cover this new one) — likely a separate deploy key or
  scoped PAT for `local-ai-machine-test` specifically. Needs resolving
  during harness implementation, not blocking further design work.

## Plan
<!-- ordered checklist -->
1. [x] Get Chris's call on the git/PR/CI substrate question — real GitHub,
   one shared long-lived repo, harness-owned reset (see above).
2. [x] Research opencode headless invocation mechanics (see prior session's
   findings: `opencode run --model provider/model "<prompt>"`, requires
   `opencode.json` custom-provider config pointing at litellm).
3. [x] Research Pi agent headless invocation mechanics (see point 1 above:
   `pi --mode json`, `baseUrl` config, no documented exit-code/timeout
   conventions — harness must self-enforce the 45min ceiling for both
   tools, don't assume either has a built-in one).
4. [x] Set up `local-ai-machine-test` repo auth and the baseline/reset
   mechanism. Auth resolved 2026-07-28: plain git push/pull already worked
   via the existing `github_deploy_key` (turns out to be an account-level
   SSH key, not narrowly repo-scoped — confirmed via `git ls-remote`
   succeeding against the test repo). PR create/merge/CI-status checks
   need the GitHub API though, which SSH can't reach — `gh` CLI added to
   `configuration.nix`'s systemPackages for that, authenticated on the box
   via a fine-grained PAT Chris created (scoped only to
   `local-ai-machine-test`; contents/pull-requests/actions all read+write),
   synced to `/etc/nixos/secrets/gh-agentic-test-repo-token.env`. Verified:
   `gh auth status` on the box shows `GH_TOKEN` active, `gh repo view`
   returns `ADMIN` permission scoped to exactly this one repo.
5. [ ] Build the 3 task scaffolds (docs-research, git/PR/CI, docker
   lifecycle) under `catalog/agentic-tasks/`, each with hidden grading
   checks that live outside the agent's workspace until graded — harness-
   and model-agnostic, since both opencode and Pi run the identical tasks.
6. [ ] Build the harness script (e.g. `scripts/agentic_coding_benchmark.py`):
   per task/model/**harness** (opencode, Pi — both), clean workspace +
   reset the shared test repo/any docker sandbox to baseline, run the
   harness headless with a 45min ceiling (externally enforced), capture
   full session log/transcript, grade via hidden checks after the fact,
   record pass_count/total_count + wall-clock + full log path, tagged by
   which harness produced it.
7. [ ] Two new methodology files (or one file covering both, TBD during
   implementation): `agentic-coding-session-opencode-v1` and
   `agentic-coding-session-pi-v1` — same tasks/grading/metrics_schema,
   different benchmark_id per harness so results are directly comparable
   side by side, not blended.
8. [ ] Wire into `scripts/benchmark_orchestrator.py` — both new
   benchmark_ids, relies on M-023's `expected_benchmark_ids`/
   `missing_benchmark_ids` registry (PR #3, merged) for correct idempotent
   pickup across already-benchmarked builds, appropriate GPU-contention
   sequencing.
9. [ ] Smoke test both harnesses against 1-2 already-benchmarked models
   before running the full matrix.
10. [ ] Dashboard: make this the headline/primary-sort metric, with
    opencode vs. Pi shown as a direct comparison (not averaged) — exact
    visual treatment still open, revisit once data shape is known.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-07-28T00:00Z — done: docs-research-v1 and docker-lifecycle-v1 task scaffolds built under catalog/agentic-tasks/, committed+pushed to main (2c4604d). git-pr-ci-v1 (task 3) not touched -- being built separately, still uncommitted in this working tree as of my push. -->
<!-- signal: claude 2026-07-28T00:00Z — done: local-ai-machine-test repo auth+baseline+reset (step 4) and git-pr-ci-v1 task scaffold (step 5, 3/3) built, tested, committed+pushed to main (2acd4bf). Did not touch docs-research-v1/docker-lifecycle-v1. One item needs Chris directly: a fine-grained GitHub PAT can only be created via the web UI, not gh/API -- exact steps left in secrets/gh-agentic-test-repo-token.env.example and in Handoff notes below. -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-27 — filed per Chris's direct request; harness (opencode headless)
  and task style (synthetic multi-step, objectively graded) confirmed via
  AskUserQuestion.
- 2026-07-28 — full design "grilling session" answered (see Context above,
  points 1-7). Major revision: task scope significantly widened from 3 toy
  scaffolded-repo tasks to a realistic docs/git-PR-CI/docker-lifecycle loop
  per Chris's actual described workflow. Per-task budget raised 10min ->
  45min. Full session transcript capture required, not just metrics.
- 2026-07-28 — Git/PR/CI substrate decided: real GitHub, not Gitea. Created
  `github.com/chrisjohnson/local-ai-machine-test` (private). Chris clarified
  it's one long-lived repo shared across all runs that he won't clean up —
  the harness must own resetting it to baseline before/after every model's
  run, not a per-run disposable repo as originally sketched.
- 2026-07-28 — Scope widened again: benchmark Pi agent alongside opencode,
  same tasks/criteria, recorded as separate benchmark_ids so the two
  harnesses are directly comparable, not just the models. Pi's CLI mechanics
  researched and recorded above (point 1) — real gaps found (no documented
  exit codes, no built-in timeout/max-turns), harness will need to enforce
  the time budget itself for both tools rather than trusting either one's
  internals.
- 2026-07-28 — Built 2 of the 3 task scaffolds under `catalog/agentic-tasks/`
  (step 5, partial): `docs-research-v1` and `docker-lifecycle-v1`, each with
  a `starter/` (agent-visible), `hidden/grade.py` (stdlib-only, no LLM
  judge, never present in the agent's workspace), `task.md` prompt, and a
  top-level `README.md` documenting the starter/hidden split for whoever
  builds the harness. `docs-research-v1`: a `ledgerclient` library whose
  `DOCS.md` documents a non-obvious HTTP retry/backoff contract (honor
  `Retry-After` exactly, max 3 retries, 503-without-header is
  non-retryable) that only a docs-read (not a code-read or generic
  best-practice guess) gets right — verified the grader scores 0/7
  unimplemented, 7/7 on a contract-correct reference solution, and 5/7 on a
  plausible-but-docs-ignorant exponential-backoff implementation, so it
  actually discriminates "read the docs" from "wrote reasonable-looking
  code." `docker-lifecycle-v1`: a 2-service docker-compose app (python:3-slim,
  stdlib-only, no pip installs) with a misconfigured `BACKEND_URL` port
  (infra-layer bug) and an inverted sort-order bug in a `/top` endpoint
  (application-layer bug that runs and returns 200 but is silently wrong) —
  the hidden grader starts/uses the agent-modified stack itself, sends real
  HTTP requests (including reading the backend directly to catch a frontend
  that fabricates results), and always tears the stack down after; verified
  2/5 unmodified, 4/5 with only one bug fixed, 5/5 fully fixed, and clean
  teardown (no leftover containers/images) in every case. Did NOT touch
  `git-pr-ci-v1/` (task 3, GitHub/PR/CI-flavored) — that's separate work by
  another agent, left completely alone including not staging/committing it.
  Did NOT touch the harness script, methodology YAML, or
  `benchmark_orchestrator.py` — out of scope for this pass.
- 2026-07-28 — Step 4 (repo auth + baseline/reset mechanism) done, plus
  step 5's third scaffold (`git-pr-ci-v1`). Auth: a fine-grained GitHub PAT
  scoped only to `local-ai-machine-test` (contents/pull-requests/actions:
  read+write) is the right shape — confirmed fine-grained PATs cannot be
  created via `gh`/the GitHub API, only the web UI, so this one step needs
  Chris directly (exact instructions in
  `secrets/gh-agentic-test-repo-token.env.example` and Handoff notes below).
  Baseline: pushed a compact stdlib-only Python `warehouse` inventory
  library (add/remove stock across bins, `transfer_stock` deliberately
  unimplemented) plus a real GitHub Actions CI workflow to
  `local-ai-machine-test`'s `main`, tagged `baseline`. `scripts/
  reset_agentic_test_repo.sh` force-resets main to that tag, closes open
  PRs, deletes stray branches — tested against a clean repo (no-op), a
  dirty repo (real throwaway branch+PR opened and cleaned up), and a stray
  direct-to-main commit; all three recovered correctly, verified via fresh
  `gh api` calls after each reset (not just the script's own report).
  `catalog/agentic-tasks/git-pr-ci-v1/`: task prompt (implement
  `transfer_stock` per the baseline repo's documented contract, branch, PR,
  wait for CI, merge) plus a hidden stdlib-only grader (no LLM judge) that
  checks the real GitHub end state — PR opened+merged, CI actually ran and
  passed on the PR's head commit (not just present/skipped), test coverage
  added, `transfer_stock` present and behaviorally correct on merged main
  (functional checks against a fresh clone, not a grep), full suite still
  green. Real bug found and fixed during testing: since
  `local-ai-machine-test` is long-lived and reset between runs, `gh pr list
  --state merged` keeps returning PRs from prior runs forever (GitHub never
  un-merges a PR's recorded state even after the underlying commits are
  force-reset away) — an idle agent that did nothing would have scored
  credit for a previous run's merge. Fixed by filtering to merge commits
  actually reachable from main's current tip (`gh api compare`) before
  treating a PR as "this run's submission." Verified end-to-end against
  three real simulated submissions on the actual GitHub repo: a correct
  implementation (10/10), no submission at all (1/10 — only the
  unrelated-sanity check passes, zero false credit from the stale merge),
  and a naive buggy implementation matching the README's documented
  partial-credit/same-bin traps (7/10 — both planted bugs correctly
  caught). Repo left reset to clean baseline afterward.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Step 5 is 2/3 done: `docs-research-v1` and `docker-lifecycle-v1` are built,
tested end-to-end (including hand-verified partial-credit scoring and clean
docker teardown), committed, and pushed to main (`2c4604d`). `git-pr-ci-v1`
(the GitHub/PR/CI task) is being built separately — check its state before
assuming step 5 is fully done. Step 4 (repo auth + reset mechanism for
`local-ai-machine-test`) is still not started as far as this pass's author
knows. Step 6 (harness script) needs step 4 AND all of step 5 done first
since it drives both harnesses against all three tasks — don't start it
until `git-pr-ci-v1`'s status is confirmed. Both new task READMEs spell out
exactly what a harness needs to copy where and when (starter -> workspace
before the session, hidden/grade.py invoked with --workspace after) — read
those before writing the harness's copy-in/copy-out logic rather than
re-deriving it.

**Update — step 4 and step 5's third scaffold (`git-pr-ci-v1`) are now
done too, so step 5 is 3/3 complete** (pending only a final confirmation
that nothing was missed across the two parallel passes — the two agents
never touched each other's files). Pushed to main (`2acd4bf`).

**One thing needs Chris directly before the harness (step 6) can actually
run task 2 for real: creating the fine-grained GitHub PAT.** This is a
genuine web-UI-only step — confirmed fine-grained PATs cannot be created
via `gh` or the GitHub API. Exact steps (also in
`secrets/gh-agentic-test-repo-token.env.example`):
1. Go to `https://github.com/settings/personal-access-tokens/new`.
2. Resource owner: `chrisjohnson`. Repository access: "Only select
   repositories" → `local-ai-machine-test`.
3. Repository permissions: **Contents: Read and write**, **Pull requests:
   Read and write**, **Actions: Read and write**. (Metadata: Read-only is
   auto-included, no action needed.)
4. Generate, copy the token (`github_pat_...`), and paste it as `GH_TOKEN=`
   into `secrets/gh-agentic-test-repo-token.env` (gitignored — create this
   file locally/on the box, don't commit it; the `.example` file is the
   tracked template).
Until that token exists, `scripts/reset_agentic_test_repo.sh` and the
future harness both currently fall back to whatever `gh` is already
authenticated as in the calling environment (Chris's own broad-scope `gh
auth login` session, confirmed via `gh auth status` to have `repo`/`gist`/
`read:org` OAuth scopes) — that's what this pass's own testing used, and
it works, but it's Chris's personal credential, not the repo-scoped one
the task asked for, and shouldn't be what the unattended benchmark harness
ends up relying on long-term.

**What's built and verified (step 4):**
- `local-ai-machine-test`'s `main` now holds a real baseline: a compact
  stdlib-only Python `warehouse` inventory library (`add_stock`/
  `remove_stock`/queries implemented, `transfer_stock` deliberately
  missing) with a `tests/` unittest suite and a real `.github/workflows/
  ci.yml` that runs those tests on every push/PR. Tagged `baseline` —
  this is the exact ref `scripts/reset_agentic_test_repo.sh` resets to.
- `scripts/reset_agentic_test_repo.sh` (in this repo, `chmod +x`'d):
  closes every open PR (`gh pr close --delete-branch`), deletes every
  non-default branch, force-resets `main` to the `baseline` tag's commit
  via `gh api -X PATCH .../git/refs/heads/main -f sha=... -F force=true`,
  then re-verifies (0 open PRs, 0 other branches, `main` sha == baseline
  sha) and exits nonzero if verification fails. Idempotent — safe to run
  repeatedly. Tested for real against the live repo three times (clean
  no-op, dirty-repo full recovery, stray-direct-push recovery) — all
  passed, each independently re-verified via fresh `gh api` calls after
  the script exited, not just trusting its own printed report.

**What's built and verified (step 5, `git-pr-ci-v1`):**
- `catalog/agentic-tasks/git-pr-ci-v1/task.md`: prompt asks the agent to
  read the baseline repo's README "Transfer semantics" spec, implement
  `transfer_stock` matching it exactly, add test coverage, branch, PR,
  wait for CI, merge — small/clearly-scoped per M-021's own instructions,
  the mechanics (not the code) are the point.
- `catalog/agentic-tasks/git-pr-ci-v1/hidden/grade.py`: stdlib-only (uses
  `gh` as an external binary, same pattern as this project's other hidden
  graders), `--json`/pass_count/total_count output matching the sibling
  scaffolds' `CheckResult`/`_emit` convention. Checks: a PR was opened and
  merged into `main`; the merged PR has real commits; CI actually ran
  (not skipped) and passed on the PR's exact head SHA (checked via `gh run
  list --commit <sha>`, not just "some run exists"); the PR touched a
  test file; `transfer_stock` exists and is behaviorally correct on
  current `main` (fresh clone + direct functional exercise of all four
  documented contract rules, not a static grep); the full pre-existing
  test suite still passes against merged main (catches an agent that
  broke something unrelated while adding the new method).
- **Load-bearing bug found and fixed during testing, worth flagging
  loudly for whoever builds the harness**: because this repo persists
  across runs and only gets reset by the script above, `gh pr list
  --state merged` returns every PR ever merged against it, forever — a
  reset does NOT erase a PR's GitHub-recorded `MERGED` state, it just
  makes the underlying commits unreachable from `main` again. A grader
  that trusted "most recently merged PR" without checking reachability
  would give an idle/no-op agent free credit for whatever the *previous*
  run's agent merged. Fixed by resolving each merged PR's merge-commit
  SHA and checking `gh api repos/.../compare/<merge_sha>...main` — the
  PR only counts if `main`'s current tip is "ahead of" or "identical to"
  that commit (i.e. still reachable), not "behind" it (reset away). This
  matters for the harness design generally, not just this one script: any
  future check that reads `local-ai-machine-test`'s GitHub history (not
  just its current file tree) needs the same reachability filter, or
  grading will silently leak state across runs. Verified with 3 full
  real submissions run against the live repo end-to-end (branch → PR →
  CI wait → merge → grade → reset): correct impl scored 10/10, a
  clean/untouched repo (no submission) scored 1/10 with zero false credit
  from the earlier run's stale merge, and a naive buggy implementation
  (adds to `to_bin` before validating `from_bin`, and doesn't reject a
  same-bin transfer — exactly the two traps the README spec calls out)
  scored 7/10, correctly failing both planted-bug checks and the
  missing-test-coverage check while still passing CI (since it didn't
  break any *existing* test). Repo was left reset to clean `baseline`
  state after all testing.
- 2026-07-28 — Auth fully resolved. Chris pushed back on needing a new PAT
  at all, correctly — confirmed the existing `github_deploy_key` already
  covers plain git push/pull to `local-ai-machine-test` (it's an
  account-level SSH key, not a narrowly-scoped classic deploy key). PR
  create/merge/CI-status checks still need the GitHub API though (SSH
  can't reach that surface) — `gh` wasn't installed on the box at all;
  added via `configuration.nix`. Considered reusing Chris's own broad `gh
  auth` OAuth session (`repo`/`gist`/`read:org` scopes, works for
  everything) to avoid the manual PAT step, but the auto-mode security
  classifier correctly flagged persisting that broadly-scoped personal
  credential onto the box as a bigger blast-radius increase than intended
  — the benchmarked models run with full unsandboxed shell access via
  opencode/Pi, so a broad token would let a buggy/adversarial model touch
  *any* of Chris's repos, not just this disposable one. Chris agreed and
  created the fine-grained PAT properly scoped to just
  `local-ai-machine-test`. Verified live on the box.

**Next real step for whoever picks this up**: step 6 (harness script) —
now fully unblocked. Chris created the fine-grained PAT 2026-07-28; it's
live at `/etc/nixos/secrets/gh-agentic-test-repo-token.env` on the box,
verified working (`gh auth status` shows `GH_TOKEN` active, `ADMIN` perm
scoped to exactly `local-ai-machine-test`). `gh` CLI itself was not
previously installed on the box at all — added to `configuration.nix`
systemPackages and deployed. Source that env file (`set -a; source
/etc/nixos/secrets/gh-agentic-test-repo-token.env; set +a`) before any
`gh`/git-against-that-repo call in the harness so it picks up the scoped
token rather than falling back to any other ambient credential.
