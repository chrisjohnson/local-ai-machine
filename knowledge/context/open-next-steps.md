---
id: open-next-steps
date: 2026-07-26
source: "HANDOFF.md (\"What's next\", lines 112-127) and README.md (\"Open Next Steps\", lines 1392-1439)"
tags: [operations, roadmap, todo]
status: open
---

# Open next steps

This file distills two separate "what's next" sections that existed side by side in
`HANDOFF.md` and `README.md` as of late July 2026. Both are historical snapshots — check
the fleet board (`.fleet/board/`) for the current, authoritative task list; this file is
useful mainly as a record of what was already known/planned at that point, not a live
todo list going forward.

## From HANDOFF.md (2026-07-24 session handoff)

1. Once the download queue is empty (or explicitly told to proceed regardless), start the
   real benchmark pass following `catalog/OPERATIONS.md`'s procedure: pause downloads, run
   one benchmark at a time, correct teardown sequencing.
2. For each `catalog/builds/*.yaml` entry, run the applicable benchmark(s), capture the
   full run-fingerprint, append a `benchmark_runs[]` entry with real results plus a raw
   output file (`catalog/raw/<build-id>--<benchmark-id>--<timestamp>.{txt,json}`).
3. Redo the llama.cpp/Ollama smoke test properly (vLLM stopped first) before trusting any
   real numbers from those engines.
4. If a model+context-length variant is worth testing separately, create a second build
   file per the naming convention (`<model>--<engine>--ctx<N>.yaml`) rather than
   overloading one build file.
5. Commit/push as you go.

**Standing gates at the time (do NOT cross autonomously)**:
1. Any new model download beyond an already-approved queue.
2. FastFlowLM's IOMMU + reboot tradeoff — explicitly deferred, stays deferred until
   revisited.
3. Promoting any newly-benchmarked model to standing production primary.
4. Anything destructive/irreversible (force-push, deleting data, the Phase 7 wipe-and-
   rebuild).

## From README.md ("Open Next Steps — resume here after context compaction")

As of 2026-07-24/26, tracked as not-yet-done:
- **North Mini Code 1.0** — weight download needed to finish, then a vLLM benchmark pass
  (speed + coding harness).
- A full re-run of every already-benchmarked model under the newer `BENCHMARKING.md`/
  catalog SOP was deliberately deferred (existing data judged solid and well-caveated;
  full re-run costs significant GPU time for comparatively low marginal value at the
  time) — revisit only if explicitly requested.
- `scripts/benchmark_orchestrator.py`'s skip logic needed updating to allow the 3
  now-fixed Ollama models through a full sweep (while still skipping Gemma-4's Ollama
  build, which remained genuinely blocked on the pinned Ollama version).

Both sections describe a moment in an ongoing, actively-worked project — treat as
historical context for understanding *why* the project reached its current state, not as
a live task list. For current open work, use the fleet board.
