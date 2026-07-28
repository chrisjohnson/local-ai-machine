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

1. **Harness: opencode itself**, run headless (`opencode run`) against each
   candidate model via the litellm proxy.
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

## Open question — needs Chris's call before implementation starts

**Git/PR/CI substrate for task 2 (and the "workflows" mention in #6):**
"Workflows" strongly implies real CI (GitHub Actions), not a fake stand-in.
Two real options:
- **Disposable GitHub repo(s)** — most representative (it's literally what
  he uses), but means creating real external GitHub resources under his
  account, needing either a repo reset between every model's run or fresh
  repos per run (churn/cleanup to manage), and giving opencode a real
  GitHub token scoped to it during the benchmark.
- **Self-hosted Gitea** (or similar), run as a disposable docker container —
  Gitea supports Actions using GitHub-Actions-compatible workflow YAML, so
  the agent still gets a real "push → PR → CI runs → merge" loop, fully
  local/disposable, no external account resources touched, trivial to
  reset between runs (blow away the container/volume).
Leaning Gitea for the default recommendation (same mechanics, zero external
footprint, easy reset) but this is Chris's call, not an assumption to bake
in silently.

## Plan
<!-- ordered checklist -->
1. [ ] Get Chris's call on the git/PR/CI substrate question above before
   building task 2's scaffold.
2. [ ] Research opencode headless invocation mechanics: exact `opencode run`
   flags/exit codes/output format, full session transcript/log capture
   format, how to target a specific provider/model per invocation without
   interactive `/models`, and whether tool-call/turn counts are exposed
   anywhere parseable.
3. [ ] Build the 3 task scaffolds (docs-research, git/PR/CI, docker
   lifecycle) under `catalog/agentic-tasks/`, each with hidden grading
   checks that live outside the agent's workspace until graded.
4. [ ] Build the harness script (e.g. `scripts/agentic_coding_benchmark.py`):
   per task/model, clean workspace + any needed disposable
   infra (git remote, docker sandbox), run opencode headless with a 45min
   ceiling, capture full session log, grade via hidden checks after the
   fact, record pass_count/total_count + wall-clock + full log path.
5. [ ] New methodology file `catalog/benchmarks/agentic-coding-session-v1.yaml`
   documenting harness, tasks, grading, metrics_schema — matching the
   existing `seven-tier-coding-v2.yaml` style.
6. [ ] Wire into `scripts/benchmark_orchestrator.py` — new benchmark_id,
   relies on M-023's `expected_benchmark_ids`/`missing_benchmark_ids`
   registry (PR #3) for correct idempotent pickup across already-benchmarked
   builds, appropriate GPU-contention sequencing.
7. [ ] Smoke test against 1-2 already-benchmarked models before running the
   full matrix.
8. [ ] Dashboard: make this the headline/primary-sort metric — confirmed
   direction, exact visual treatment still open, revisit once data shape
   is known.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

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
  45min. Full session transcript capture required, not just metrics. One
  new open question (git/PR/CI substrate: disposable GitHub vs. self-hosted
  Gitea) needs Chris's answer before task 2's scaffold can be built.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Next step is getting Chris's answer on the git/PR/CI substrate
question, then starting opencode headless-mechanics research in parallel
(doesn't depend on that answer).
