---
id: M-021
title: Add agentic-coding-session benchmark tier (opencode-driven), emphasize in dashboard
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-021 — Agentic-coding-session benchmark tier

## Context

Every existing coding methodology (`seven-tier-coding-v2`) is single-shot or
scripted multi-turn — even Tier D ("multi-turn interactive debugging") is a
fixed 3-turn conversation, not a real agentic session with autonomous tool
use across a real task. Chris's actual primary use case for this whole
benchmarking effort is running models *as a coding agent* day-to-day (he
just had opencode wired up to this box's litellm proxy) — none of the
current data measures that directly.

Chris confirmed two design decisions (2026-07-27, via AskUserQuestion):
1. **Harness: opencode itself**, run headless (`opencode run`) against each
   candidate model via the litellm proxy — most representative since it's
   literally the tool he plans to use, not a synthetic stand-in for it.
2. **Tasks: synthetic multi-step, objectively graded** — bigger versions of
   the existing Tier A/D style (scaffolded scratch repo, hidden test suite
   graded after the fact), not real open-source repo tasks. Keeps the
   project's established no-LLM-judge-scoring philosophy
   (`seven-tier-coding-v2` id docstring: "Objective-grading, stdlib-only,
   no-LLM-judge-scoring").

Also requested: once this data exists, **emphasize it in the comparison
dashboard** as the primary/headline signal, not just another column —
this is explicitly Chris's most-desired-use-case metric, everything else is
secondary context.

## Design sketch (starting point, refine during implementation)

Harness mechanics:
- Per task, per candidate model: create a clean scratch workspace (temp dir),
  seed it with the task's starter files (a small broken/incomplete package
  + a *hidden* test suite not visible to the agent), `cd` into it, run
  `opencode run --model local-litellm/<alias> "<task prompt>"` with a
  reasonable wall-clock/turn budget, then — after opencode exits or the
  budget is hit — run the hidden test suite against the final workspace
  state to grade pass/fail. Record: pass/fail, wall-clock time, and
  whatever step/tool-call count opencode's own output exposes.
- Requires each candidate model to have a corresponding entry in
  opencode's provider config (`~/.config/opencode/opencode.json` or a
  project-scoped one for this harness) — likely one generic custom
  provider pointing at litellm with each candidate's litellm alias as a
  distinct "model" entry, or dynamically writing a scoped config per run.
  Needs research: does opencode support pointing at an arbitrary alias
  without pre-declaring every one, or does the harness need to manage the
  provider config file per run?

Candidate starter tasks (3, matching this project's existing tier sizing):
1. **Multi-file bug fix** — small scaffolded package, a real bug whose
   symptoms span 2-3 files (e.g. a bad shared helper used incorrectly in
   two call sites), failing pytest-style suite. Task: "make the tests
   pass." Grade: hidden suite green at the end.
2. **Feature addition + own tests** — given a spec for a new
   function/endpoint, implement it. Grade: a hidden reference test suite
   (not visible to the agent) validates behavior, not the agent's own
   tests.
3. **Refactor preserving behavior** — split/clean up a small tangled
   module. Grade: the *existing* visible test suite must still pass
   unchanged at the end (behavior-only grading, avoids subjective
   structural judging calls that would break the no-LLM-judge philosophy).

## Plan
<!-- ordered checklist -->
1. [ ] Research opencode headless invocation mechanics: exact `opencode run`
   flags/exit codes/output format, how to target a specific provider/model
   per invocation without interactive `/models`, and whether tool-call/turn
   counts are exposed anywhere parseable (log file, `--json` output, etc).
2. [ ] Finalize the 3 starter task definitions (scaffold files + hidden test
   suites) under a new directory (e.g. `catalog/agentic-tasks/`).
3. [ ] Build the harness script (e.g. `scripts/agentic_coding_benchmark.py`)
   implementing the design sketch above.
4. [ ] New methodology file `catalog/benchmarks/agentic-coding-session-v1.yaml`
   documenting the harness, tasks, grading, metrics_schema — matching the
   existing `seven-tier-coding-v2.yaml` documentation style.
5. [ ] Wire into `scripts/benchmark_orchestrator.py` (new benchmark_id,
   `already_has_run` resumability, appropriate GPU-contention sequencing —
   opencode calls out over HTTP to litellm -> vLLM/llama.cpp/Ollama, same
   contention class as the existing coding harness).
6. [ ] Smoke test against 1-2 already-benchmarked models before running the
   full matrix.
7. [ ] Dashboard: make this the headline/primary-sort metric in the
   generated comparison dashboard once real data exists across enough
   builds — exact visual treatment (dedicated top section vs. reordered
   columns vs. weighted composite score) still open, revisit once data
   shape is known.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-27 — filed per Chris's direct request; harness (opencode headless)
  and task style (synthetic multi-step, objectively graded) confirmed via
  AskUserQuestion. Task-set specifics and dashboard-emphasis mechanics
  intentionally left as open design points to refine during implementation,
  not blocking card creation on them.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. First real step is step 1 (research opencode's headless/
scripting interface in detail) — everything else depends on knowing exactly
what opencode exposes for programmatic invocation and result parsing.
