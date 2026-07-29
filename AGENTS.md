# AGENTS.md — local-ai-machine

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
1. Edit locally (Mac checkout or the box's own checkout — doesn't matter which side
   originates a commit, but never let both diverge).
2. Commit, push to `main`. **Direct pushes to `main` are explicitly authorized in this
   repo** (Chris, 2026-07-25) — no PR workflow, no worktree-branch requirement.
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

**IMPORTANT NOTE**: Prefer scripted autonomous solutions to driving things directly over
SSH. Use SSH primarily to inspect, kick things that are stuck (and then improve the code
to self-kick for next time), start and stop services, or as a last resort if nothing else
is working. Assume the agent will crash regularly or suffer flaky connection with the
machine.

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
- **Upgrading Ollama's version.** Currently pinned at 0.17.7; at least one known chat-
  template fix (Gemma-4 family) needs 0.20.0+. Upgrading is a real behavior-change
  decision (affects every registered model, not just the one being fixed), not a
  drive-by dependency bump.

## Knowledge base — read at session start

`knowledge/` contains this project's institutional memory: decisions made and
why, research findings with sources, and current operational context. Any agent
working in this repo should scan `knowledge/README.md` at session start, then
load relevant files from `knowledge/decisions/`, `knowledge/research/`, and
`knowledge/context/` as needed for the task at hand. New findings go into the
appropriate subdirectory following the format in its README.

## Where the detailed operational knowledge lives

- **`knowledge/`** — structured, agent-friendly index of decisions/research/context (see
  above) — start here for anything that isn't in the catalog itself.
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
- **`README.md`** — human-readable architecture/product description (what this repo is,
  how the stack is wired together, where things live). Not a journal — decision history and
  research findings that used to live in README's "Phased Implementation Roadmap" section
  (plus the now-deleted `HANDOFF.md`/`OPTIMIZATIONS.md`) all live in `knowledge/` instead.
