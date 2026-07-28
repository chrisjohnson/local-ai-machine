---
id: M-024
title: Agentic orchestration-session benchmark tier — modeled on this Claude Code session itself
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-021
related_cards: [M-021]
status: needs-refinement
---

# M-024 — Agentic orchestration-session benchmark tier

## Context

Chris paused mid-M-021-implementation (2026-07-28) to clarify what "agentic
coding benchmark" should actually mean, after noticing this very Claude Code
session's own shape: a continuous, hours-long stream of evolving sub-goals,
heavy delegation to sub-agents for research/implementation, real bugs and
security gaps caught and fixed as a byproduct of real work, selective human
check-in (hard-stops only), and durable state (this repo's own `.fleet`
board) carrying context across the whole session.

His words: "this is the kind of session I want to do with my local models" —
i.e. he wants to measure which local model can competently *be* the
orchestrator of a session like this one, not just complete one bounded
coding task solo. This is a materially different, harder-to-grade capability
than [[M-021]]'s existing bounded 3-task design (docs-research, git-pr-ci,
docker-lifecycle — single harness invocation, 45min ceiling, objective
hidden-test pass/fail).

Full definition saved to memory:
`~/.claude/projects/-Users-chrisjohnson-src-chrisjohnson-local-ai-machine/memory/project_agentic_orchestration_benchmark_definition.md`
— read that file for the complete characteristics list and confirmed design
decisions; summarized here for the card's own self-containedness.

**This is a new, complementary tier, not a replacement for M-021.** M-021's
already-built harness/tasks stay valid as one useful (narrower) signal.

## Confirmed design decisions (2026-07-28, via AskUserQuestion)

1. **Grading: hybrid.** A composite of concrete/objective signals (did it
   delegate appropriately, did it catch+fix real bugs, was final state
   actually correct) *plus* an LLM-judge holistic review of the session
   transcript against a rubric. Explicit, deliberate exception to this
   project's established no-LLM-judge-scoring philosophy (see
   `catalog/benchmarks/seven-tier-coding-v2.yaml`) — a multi-hour
   orchestration session doesn't reduce to hidden-test pass/fail the way
   isolated coding tasks do.
2. **Scale: scaled-down but same shape.** Bounded to roughly 1-2 hours, but
   preserving real structure — multi-step, evolving scope, real sub-agent
   delegation, real infra consequences. Not a toy, not a full multi-hour
   replica.
3. **Judgment scoring: explicit.** Whether the candidate model asks for
   confirmation at the *right* moments (hard-stops, genuinely ambiguous
   decisions) vs. over/under-asking is itself part of the score — not
   simulated away by an always-approve harness.

## Open design questions (why this is `needs-refinement`, not ready to plan yet)

- What's the actual scenario/mandate given to the candidate model for its
  1-2hr session? Needs to be broad/evolving enough to elicit real
  delegation and judgment calls, bounded enough to grade in reasonable
  time and not touch Chris's real production systems. A sandboxed variant
  of this repo's own kind of work (catalog/config changes, sub-task
  delegation to scripted "sub-agent" stand-ins) is the obvious analog but
  not yet designed.
- Does the candidate model get real sub-agent-dispatch capability (e.g. can
  it actually invoke other model instances as sub-agents?), or is
  "delegation quality" graded some other way given most local models
  running via opencode/Pi won't have an equivalent multi-agent
  orchestration feature out of the box? This is a real, unresolved
  mechanics question, not just a grading-rubric question.
- What's the actual LLM-judge rubric, and which model plays judge? (This
  project's existing Tier J work on judge-role fitness is directly
  relevant prior art — check `seven-tier-coding-v2.yaml`'s Tier J before
  designing a new rubric from scratch.)
- Where does this fit relative to M-021 in build order — after M-021 fully
  ships, or can real design/build work start in parallel? Currently marked
  `blocked_by: M-021` as a placeholder; revisit once M-021 is fully done.

## Plan
<!-- ordered checklist -->
1. [ ] Resolve the open design questions above with Chris.
2. [ ] Design the actual scenario/mandate + sandboxing approach.
3. [ ] Design the sub-agent-delegation mechanics question.
4. [ ] Design the LLM-judge rubric (build on Tier J prior art).
5. [ ] Build the harness.
6. [ ] Smoke test.
7. [ ] Wire into `scripts/benchmark_orchestrator.py` (new benchmark_id(s),
   relies on M-023's idempotency registry, already merged).

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-28 — filed per Chris's direct request, after he paused M-021 work
  to point at this actual Claude Code session as the real definition of his
  target use case. `needs-refinement`: the core grading philosophy and
  scale are decided, but the actual scenario/mandate, sub-agent-delegation
  mechanics, and judge rubric are still open — real design work, not yet
  scoped enough to plan concretely.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Read the linked memory file first for the complete definition,
then work the open design questions above with Chris before writing any
code — this card is intentionally not actionable yet.
