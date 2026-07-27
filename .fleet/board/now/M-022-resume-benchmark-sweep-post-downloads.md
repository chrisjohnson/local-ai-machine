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
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-27 — filed per Chris's direct request to resume the autonomous
  benchmark pass now that downloads are complete. Worked in strict
  succession with M-021 (not concurrently) per Chris's explicit instruction
  and the standing "no concurrent work during benchmarks" rule.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Step 1 (dry-run) is next.
