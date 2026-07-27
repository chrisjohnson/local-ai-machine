# AGENTS.md — local-ai-machine

This repo now uses the agentic-fleet workflow (`.fleet/board/`) instead of tracking
agentic state/next-steps in `README.md`. The global fleet protocol (worker/orchestrator
roles, board mechanics, claim/signal conventions) lives in the agentic-fleet repo's own
`AGENTS.md` and applies here automatically once `.fleet/` exists — this file only covers
what's specific to *this* repo.

**Note:** `README.md`'s "Open Next Steps"/operational-state sections predate this fleet
setup (2026-07-26) and are being phased out in favor of fleet cards. Don't treat README
as the current source of truth for in-flight work — check `.fleet/board/` instead. Full
migration of README's remaining agentic content is tracked as its own card (see board).

## What this repo is

Config-as-code + benchmark catalog for a local AI inference box (`local-ai-machine`, AMD
Ryzen AI Max+ 395 / Strix Halo, gfx1151, 128GB unified memory) running vLLM, llama.cpp,
and Ollama side by side for model comparison. NixOS host config
(`configuration.nix`/`flake.nix`), a Docker Compose application stack
(`docker/docker-compose.yml`), a benchmark catalog (`catalog/`), and generated comparison
dashboards (`docs/`).

## The one rule that overrides normal instincts here: everything to the box goes through git

**Never hand-patch files directly on the box over SSH.** This burned real time once
already (two independently-drifted git histories had to be reconciled). The box's repo
(`/home/chris/local-ai-machine` on `ssh local-ai-machine`, user `chris`) has its own
GitHub deploy key specifically so it can pull (and, for automated jobs like the benchmark
orchestrator, push its own results) without ever needing a manual edit.

Workflow for any change that needs to land on the box:
1. Edit locally (wherever you're actually working — Mac checkout or the box's own
   checkout, doesn't matter which side originates a commit, but never both diverging).
2. Commit, push to `main`. **Direct pushes to `main` are explicitly authorized in this
   repo** (Chris, 2026-07-25) — no PR workflow, no worktree-branch requirement, despite
   what the global fleet AGENTS.md says for repos in general (that rule is gated on
   fleet's own worktree conventions, which this repo doesn't use for source/config
   changes — board changes still follow the global board-commit convention).
3. `ssh local-ai-machine 'cd /home/chris/local-ai-machine && git pull --ff-only'`.
4. Deploy:
   - NixOS config changes (`configuration.nix`, `flake.nix`): `sudo -n
     /run/current-system/sw/bin/nixos-rebuild switch --flake /etc/nixos#local-ai-machine`
     — this **exact literal command string** is the only thing the passwordless-sudo rule
     matches; anything else prompts for a password and silently blocks unattended
     operation.
   - Docker Compose-only changes: `docker compose up -d` (from `docker/`) — no sudo
     needed, `chris` is in the `docker` group.

You have full authority to manage the box's OS/services to get work done — start/stop
containers, run `nixos-rebuild`, pause/resume downloads, run benchmarks — this is not
timid, ask-first territory. Drive it through git, not raw SSH edits.

## Hard stops — need Chris directly, no exceptions

- **Any new model download beyond what's been explicitly approved in the moment.** A
  broad "keep working" grant does not cover this — see `configuration.nix`'s `models`
  list for what's currently approved; anything not there needs a fresh go-ahead, every
  time, even for a strong/obvious candidate.
- **Promoting any newly-benchmarked model to the actual standing production default**
  (i.e. changing what `vllm-primary`/`vllm-judge` — or their eventual replacement under
  the two-tier compose design, see the board — actually serve by default). Testing and
  swapping models in/out is fine and already-standing permission; making something *the*
  default is Chris's call regardless of how compelling the data looks.
- **The FastFlowLM IOMMU/reboot tradeoff** — a real, measured performance-vs-availability
  tradeoff Chris has explicitly deferred deciding on. Stays deferred until he revisits it.
- **Anything destructive or hard to reverse** — force-push, wiping data, rebuilding the
  box from scratch. Standard fleet-wide rule, repeated here because this repo's box-access
  authority makes it easy to reach for something destructive by accident while
  troubleshooting.
- **Upgrading Ollama's version.** Currently pinned at 0.17.7; at least one known chat-
  template fix (Gemma-4 family) needs 0.20.0+. Upgrading is a real behavior-change
  decision (affects every registered model, not just the one being fixed), not a
  drive-by dependency bump.

## Where the detailed operational knowledge lives

- **`catalog/OPERATIONS.md`** — the safety-critical benchmark procedure: preflight/
  teardown sequencing, the real OOM incident that motivated vLLM-restart-before-download-
  resume ordering, required run-fingerprint fields, build-naming conventions. Read before
  running or scripting any benchmark.
- **`catalog/engines/*.yaml`** — reusable per-engine recipes (image, flags, known
  gotchas) for vLLM / llama.cpp (3 backend variants) / Ollama (2 variants, one documented-
  broken).
- **`catalog/builds/*.yaml`** — one file per verified model+engine combination, benchmark
  identity + results (undergoing restructuring per the board — check `.fleet/board/` for
  the current target schema before assuming today's shape is final).
- **`HANDOFF.md`** — historical session-handoff log (decisions made, bugs found/fixed,
  judgment calls) from before the fleet board existed. Being superseded by fleet cards'
  own Decision logs going forward; still useful as archaeology for *why* something is the
  way it is.
