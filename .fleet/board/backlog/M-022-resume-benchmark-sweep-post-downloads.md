---
id: M-022
title: Resume benchmark sweep now that all downloads are complete
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-022 — Resume benchmark sweep post-downloads

## Context

All 22 declared models finished downloading (2026-07-27). Most already have
recorded `benchmark_runs` from the original weekend sweep and subsequent
per-model fixes. Two llama.cpp builds finished downloading most recently and
have never been benchmarked at all (`benchmark_runs: []`):

- `deepseek-v4-flash-iq2xxs--llamacpp-vulkan-radv-v1` (284B total/13B active
  MoE, IQ2_XXS imatrix GGUF, ~84.6GiB)
- `gpt-oss-120b--llamacpp-vulkan-radv-v1` (120B total/5.1B active MoE,
  native MXFP4 GGUF, ~59GB)

Both are `status: UNTESTED-BUT-DOWNLOADED`, not `BROKEN`, so
`benchmark_orchestrator.py`'s plan should pick them up as `RUN` on the next
pass while everything else shows `SKIP (already has ... runs)` —
`already_has_run()` is engine-agnostic and was already verified correct for
this exact scenario during the Ollama-enablement work (M-0xx, see
HANDOFF.md). Expectation, to be confirmed via `--dry-run` before actually
starting: **only these two builds run**, nothing else.

Mechanism note: `benchmark-orchestrator.timer` was removed entirely
2026-07-27 (it fired unexpectedly via an OnBootSec re-arm during an
unrelated `nixos-rebuild`, see AGENTS.md/configuration.nix decision log) —
this now has to be started explicitly
(`systemctl start benchmark-orchestrator.service`), it will not fire on its
own. That's intentional and is how this card actually kicks the sweep off.

Chris authorized proceeding autonomously and documenting decisions here for
later review (2026-07-27) — same posture as the original weekend sweep.

## Plan
<!-- ordered checklist -->
1. [ ] `--dry-run` the orchestrator first, confirm the plan is exactly the
   two new builds as `RUN` and everything else `SKIP` — don't launch a real
   pass on an unexpected plan.
2. [ ] Start the real pass via `systemctl start benchmark-orchestrator.service`
   (persists on the box independent of any agent session, per established
   preference for server-side persistence over piloted SSH steps).
3. [ ] Watch for stalls/OOM/crashes per `catalog/OPERATIONS.md`'s safety
   procedure — same watchfulness posture as the original weekend sweep, not
   fire-and-completely-forget.
4. [ ] Once complete, verify both builds have real (non-zero, sane)
   `benchmark_runs` entries recorded, and update each build file's
   `status`/`role`/notes to reflect real results instead of
   "UNTESTED-BUT-DOWNLOADED".
5. [ ] Regenerate the comparison dashboard once the new data is in.

## Signals
<!-- signal: claude 2026-07-31T03:26Z — demoted to backlog per human request, deprioritized for pi-agent projects work (M-035) -->
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-07-29T05:32Z — claimed_at is stale (2 days old), systemd unit finished ("=== Done ===" 2026-07-28T01:27:55Z) but did NOT fully complete: gpt-oss-120b--llamacpp-vulkan-radv still has zero benchmark_runs. Root cause confirmed via journalctl: "FAILED: build has no model.files entries — cannot construct -m path". Catalog entry (post-M-002 migration: catalog/builds/gpt-oss-120b--llamacpp-vulkan-radv.yaml) has `model.files: null`, but the real file is on disk and complete: /var/lib/ai-models/llamacpp-gpt-oss-120b/gpt-oss-120b-MXFP4.gguf (.download-complete present). Fix is a one-line `files: [gpt-oss-120b-MXFP4.gguf]` data-entry correction, then re-run just this one build. Chris directed "3 then 22" sequencing and noted he's actively using the currently-loaded model — do not stop/swap services for the M-022 re-run until confirmed clear. -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-27 — filed per Chris's direct request to resume the autonomous
  benchmark pass now that downloads are complete. Worked in strict
  succession with M-021 (not concurrently) per Chris's explicit instruction
  and the standing "no concurrent work during benchmarks" rule.
- 2026-07-27 — `--dry-run` plan came back broader than expected: not just
  the 2 new llama.cpp builds, but also 3 Ollama builds
  (glm-4.7-flash/qwen3.6-27b/qwen3.6-35b-a3b--ollama-vulkan-0177-v1), which
  legitimately have `benchmark_runs: []` too — the earlier Ollama-enablement
  work only ever dry-run tested them, the real pass never actually executed
  before downloads paused everything. Correct/expected given the resumability
  logic, just wider scope than the card's initial framing assumed. Proceeding
  with the full 5-build plan as shown, not narrowing it.

- 2026-07-28 — Sweep completed (1h48m wall clock). 4/5 builds recorded real
  results: deepseek-v4-flash-iq2xxs--llamacpp (success), glm-4.7-flash /
  qwen3.6-27b / qwen3.6-35b-a3b--ollama (all 3 success). 1/5 failed:
  gpt-oss-120b--llamacpp-vulkan-radv-v1 — `FAILED: build has no model.files
  entries — cannot construct -m path`. Real orchestrator bug: this build's
  catalog file has `files: null` (single ~59GB file, no shard list — the
  download is a local BF16->GGUF conversion, not a fixed HF filename), and
  the llama.cpp dispatch path apparently requires a non-empty `files` list.
  Failed cleanly — vLLM services were correctly restored afterward, no data
  corruption, just no benchmark recorded for this build. Needs a code fix
  (handle the single-converted-file case) + re-run.
- 2026-07-28 — **Bigger finding**: all 4 successful results, plus this
  entire run, executed against the box's shared checkout
  (`/home/chris/local-ai-machine`) while it was checked out on
  `worktree-gentle-genet-star`, NOT main — a different fleet worker
  (pet name gentle-genet-star) claimed M-001 2026-07-26T14:00Z and has been
  actively implementing the two-tier catalog/compose migration there, with
  an **open PR #2** currently outstanding
  (github.com/chrisjohnson/local-ai-machine/pull/2). Their signals show a
  2026-07-27T14:30Z orchestrator refactor ("removed swap_model_start/stop.sh
  calls, all vLLM builds go through compose services") — meaning tonight's
  sweep actually ran gentle-genet-star's in-progress, unreviewed refactor of
  `benchmark_orchestrator.py`, not the version on main. My 4 "Record ...
  results" commits landed as additional commits on top of their open PR
  branch, mixing unrelated benchmark-data commits into their code PR. Main
  currently has none of tonight's data — only this card's own filing/claim
  commits. Not attempting to merge/cherry-pick/reconcile unilaterally since
  it touches another worker's active PR — flagging to Chris directly.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
In progress. Started via `systemctl start benchmark-orchestrator.service` at
2026-07-27T23:39:43Z, running persistently on the box independent of any
agent session — check `journalctl -u benchmark-orchestrator.service` for
live status, `systemctl is-active benchmark-orchestrator.service` for
done/still-running. Plan is 5 builds (see decision log): 2 llama.cpp
(deepseek-v4-flash-iq2xxs, gpt-oss-120b) + 3 Ollama
(glm-4.7-flash/qwen3.6-27b/qwen3.6-35b-a3b). First build
(deepseek-v4-flash-iq2xxs) confirmed loading and running the coding harness
as of 2026-07-27T23:54:52Z — startup took ~10min for the standing default
services' cold vLLM start (normal torch.compile/cudagraph capture time on
this GPU, not a stall) before the orchestrator could stop them and hand the
full GPU budget to llama.cpp. Next agent: check status, don't restart if
already active, move to done/ once all 5 builds show real recorded
benchmark_runs and step 4/5 (catalog status updates + dashboard regen) are
done.
