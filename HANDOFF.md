# Handoff: benchmark re-run pass

Written 2026-07-24 for a fresh session picking this up while Chris is away. Read this whole
file before doing anything — it has the current state, the guardrails, and what's next.

## Guardrails — read this first

- **Keep moving. Don't wait for Chris and don't waste cycles deliberating.** If you hit a
  decision point that isn't covered by an explicit hard-stop below, make the reasonable call,
  do it, and log it under "Decisions for Chris to review" at the bottom of this file (append,
  don't overwrite). If something breaks, troubleshoot and fix it yourself before giving up.
- **Commit and push often.** Small, frequent commits, not one giant one at the end. Every
  real chunk of progress (a build file filled in, a benchmark run recorded, a bug fixed) is
  its own commit.
- **All changes to the box go through git. No exceptions.** Local edit → commit → push →
  `git pull` on the box (`ssh local-ai-machine`, repo at `/home/chris/local-ai-machine`) →
  `sudo -n nixos-rebuild switch` (exact invocation: `sudo -n /run/current-system/sw/bin/nixos-rebuild switch --flake /etc/nixos#local-ai-machine`
  — the passwordless-sudo rule only matches that literal command) or `docker compose up -d`
  for compose-only changes. **Never hand-patch files directly on the box over SSH** — that's
  exactly the mess this session spent real effort reconciling (two independent, drifted git
  histories). The box's repo now has GitHub access (`secrets/chris_github_key` deployed as
  `~/.ssh/github_deploy_key` on the box) specifically so this workflow works.
- **You have full authority to manage the OS/services to get the job done** — stop/start
  containers, run `nixos-rebuild`, pause/resume downloads, run benchmarks, whatever's needed.
  This is not timid, ask-first territory; it's "drive the whole machine, just do it through
  git."
- **Use sub-agents. Keep your own (top-level) context focused on the overall goal, not
  poisoned by execution detail.** Delegate the actual running of individual benchmarks,
  filling in a build file, investigating a failure, etc. to sub-agents, and stay at the level
  of tracking overall progress, sequencing work, and making judgment calls — the same
  pattern this handoff-writing session used for its own git/infra cleanup. A sub-agent
  drowning you in raw command output/tool-call noise defeats the point of delegating.
- **Sub-agents do not get to unilaterally bypass the git pipeline.** The "no hand-patching
  the box" rule above binds sub-agents by default. If a sub-agent believes an exception is
  genuinely warranted (e.g. it's stuck and a direct SSH edit seems like the only way
  forward), it must stop and get that authorized by you (the calling/top-level agent) first
  — it cannot decide that for itself. You, the top-level agent, DO have the authority to make
  that call yourself when you judge it's warranted (same standing this session operated
  under) — just do so deliberately and log it under "Decisions for Chris to review" below,
  not silently.
- **Hard stops that still need Chris directly** (per `AGENTS.md`/this repo's own established
  rules, unchanged by this handoff): force-push/rewriting shared history, deleting branches
  he didn't ask you to delete, promoting any newly-benchmarked model to be the actual
  production default in `docker-compose.yml`, the FastFlowLM IOMMU/reboot tradeoff, any new
  model download beyond what's already queued (see below).

## Current state

**Git**: everything is on `main`, pushed, repo root here is checked out on it and clean. The
box's repo (`/home/chris/local-ai-machine`) is also on `main`, tracking `origin`, clean.

**Download queue**: 6 items still in flight, one at a time behind a shared flock —
`gpt-oss-120b`, `gpt-oss-20b`, `llamacpp-gpt-oss-120b`, `llamacpp-minimax-m2.7`,
`llamacpp-nemotron-3-super-120b`, `llamacpp-qwen3.6-35b-a3b-mtp`. Check with:
```
ssh local-ai-machine 'systemctl list-units "download-model-*" --all --no-legend | grep activating'
ssh local-ai-machine 'find /var/lib/ai-models -maxdepth 2 -name ".download-complete"'
```
**No new downloads beyond this list** — that's still Chris's call, a real hard stop.

**Catalog structure** (`catalog/`): replaces the old `MODEL_STACK_CATALOG.md`/`BENCHMARKING.md`
(deleted this session, content fully migrated or confirmed superseded).
- `catalog/engines/*.yaml` — reusable engine+backend recipes (vLLM, llama.cpp x3 variants,
  Ollama x2 variants including a documented-broken one).
- `catalog/builds/*.yaml` — one file per model+engine combo, identity/config only, NO
  historical benchmark run data was backfilled (deliberate — old numbers stay in git history/
  `README.md`/`OPTIMIZATIONS.md`, not migrated). Every build has an empty `benchmark_runs: []`
  ready for real data.
- `catalog/benchmarks/*.yaml` — versioned methodology definitions. Current versions to use:
  `vllm-speed-c1c8-v2` (3 trials + mean/stddev, for production-candidate-grade comparisons —
  `v1` single-run is fine for wide-survey screening only), `seven-tier-coding-v2` (supersedes
  `six-tier-coding-v1`; applies to vLLM **and now llama.cpp/Ollama**), `ollama-warm-request-v2`
  (cold + 3 warm), `llamacpp-bench-v1` (unchanged, `llama-bench` already does internal
  repeated-pass stats), `llamacpp-server-concurrent-v1`, `llamacpp-mtp-v1` (mechanism
  verified, no successful run yet — the just-queued `llamacpp-qwen3.6-35b-a3b-mtp` download
  is for exactly this).
- `catalog/OPERATIONS.md` — the safety-critical procedure (preflight/teardown sequencing, the
  `sudo -n` requirements, the `awk '{print $2}'` gotcha, the real OOM incident that motivated
  the vLLM-restart-before-downloads-resume ordering, the run-fingerprint fields every
  benchmark run must capture, and the build-naming convention for config variants like
  testing one model at multiple context lengths). **Read this before running anything.**

**Smoke testing (this session's last activity)**: verified the expanded harness
(`scripts/coding_benchmark.py`, now 7 tiers: A/B/J/P/D/Q/L) actually works, not just that the
YAML definitions look right.
- **vLLM path: fully validated.** Ran clean against `vllm-primary` (`qwen3.6-35b-a3b`).
  Two real bugs found and fixed (committed, see `3cd8b3a`): an uncaught `RemoteDisconnected`
  that crashed the whole harness mid-run, and a Tier J token-budget bug (2048→4096 tokens,
  confirmed via evidence — the failing task ran 144.6s vs 19-88s for every sibling task with
  zero output, the exact reasoning-budget-exhaustion signature already known from Tiers A/B).
  Full smoke-test JSON at `/tmp/smoketest-vllm-primary.json` if useful for reference (not
  committed, it's scratch output).
- **llama.cpp path: NOT validated.** Every task failed — but investigate why before
  assuming the harness is broken: the actual cause was GPU memory contention. Running
  `llama-server` (a GGUF load) concurrently with `vllm-primary`+`vllm-judge` resident caused
  real, reproducible crashes — confirmed twice, `RestartCount` climbed to 4/3 respectively.
  **Fix for next attempt: stop `vllm-primary`/`vllm-judge` first** (`docker compose stop
  vllm-primary vllm-judge` from `~/local-ai-machine/docker`), exactly as `OPERATIONS.md`
  already documents for any llama.cpp benchmark — this session tried to skip that step for
  convenience and paid for it twice.
- **Ollama path: not attempted at all.** Same GPU-contention risk applies — stop vLLM first.
- Chris explicitly said concurrent downloads are fine to run during smoke/dev testing (not
  the real recorded data pass) — bandwidth contention affects PP numbers, not correctness.
  Don't extend that same looseness to the GPU-contention issue above; that's a stability risk,
  not just a data-quality one.

**Two informational (not bug) findings from the vLLM smoke test**, worth keeping in mind when
designing/reviewing future tasks: `structured_extraction` (Tier P) failed on a `#` prefix the
task never explicitly says to strip — likely a task-spec ambiguity, not a model error.
`planning_db_migration` (Tier Q) only hit 2/3 required topics — a real, if minor, result.

## What's next

1. Once the download queue is empty (or Chris says to proceed regardless), start the real
   benchmark pass following `catalog/OPERATIONS.md`'s procedure: pause downloads, run one
   benchmark at a time, correct teardown sequencing.
2. For each `catalog/builds/*.yaml` entry, run the applicable benchmark(s) from
   `catalog/benchmarks/`, capture the full run-fingerprint (see OPERATIONS.md), and append a
   `benchmark_runs[]` entry with real results — plus a raw output file (not yet committed to
   an established path; use `catalog/raw/<build-id>--<benchmark-id>--<timestamp>.{txt,json}`
   per the convention discussed but not yet exercised for real).
3. Redo the llama.cpp/Ollama smoke test properly (vLLM stopped first) before trusting any
   real numbers from those engines.
4. If a model+context-length variant is worth testing separately (e.g. the production primary
   at both 65536 and 131072), create a second build file per OPERATIONS.md's naming
   convention (`<model>--<engine>--ctx<N>.yaml`) rather than overloading one build file.
5. Commit/push as you go, per the guardrails above.

## Decisions made this session Chris should review (append more below as you make your own)

- **Secrets directories merged, not simply replaced.** This session's worktree
  (`.claude/worktrees/eventual-stirring-sunrise`) had accumulated all the *real* operational
  secrets (synology key, wifi/HF/grafana/litellm credentials); repo root only had `.example`
  templates plus a freshly-added `chris_github_key` pair. Did a non-destructive copy (not a
  mirror/delete-sync) so repo root now has everything, including the private
  `secrets/chris_github_key` that only existed in repo root. Worth a quick visual confirmation
  that `secrets/` here looks complete and correct.
- **Tier J's `max_tokens` bump (2048→4096) was applied without final explicit sign-off** — the
  evidence was strong (see smoke-test section above) and matches an already-established
  pattern in the same file, but flagging since it was a "resolve and move forward" call, not
  a directly confirmed one.
- **This session's own worktree directory
  (`.claude/worktrees/eventual-stirring-sunrise`) still exists**, still checked out on its own
  branch (fully merged into `main`, nothing unique left on it — safe to remove). Left alone
  because an earlier explicit instruction ("leave it for after this session") wasn't clearly
  re-authorized before the session ended. Safe to `git worktree remove
  .claude/worktrees/eventual-stirring-sunrise && git branch -d worktree-eventual-stirring-sunrise`
  whenever convenient.
- **The box's old, pre-git-fix, disconnected commit history was preserved** (not deleted) as
  a local-only branch on the box named `master-old-standalone-snapshot`. Harmless, but a
  candidate for pruning if it's never going to be needed.
