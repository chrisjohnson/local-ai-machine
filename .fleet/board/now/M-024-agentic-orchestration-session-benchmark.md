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
  time and not touch Chris's real production systems. Leaning toward
  extending M-021's existing sandboxed substrate (`local-ai-machine-test`
  repo, docker-lifecycle scaffolding) with a moderately-scoped starting
  task plus 1-2 scripted mid-session "complications" (a fake CI failure
  needing investigation, a scope-addition, and at least one genuinely
  hard-stop-worthy moment) rather than designing a wholly new substrate —
  not yet fully speced.
- **Delegation mechanics — decided 2026-07-28**: scripted stub tool, not
  real nested sessions. Chris's own real-world observation directly
  informed this: he's seen Gemma models *claim* they want to spin off a
  sub-agent without actually invoking the tool — a genuine, concrete
  instruction-following failure mode, not hypothetical. A scripted stub
  (`dispatch_subagent()` returning a canned result) is cheap AND lets the
  harness directly check the exact failure mode Chris described: does the
  model's stated intent in the transcript ("I'll spin off a sub-agent to
  do X") actually match a real tool invocation, or is it just talk? This
  "stated-intent vs. actual-invocation fidelity" check should be an
  explicit, concrete grading signal in its own right — probably a more
  foundational/important one than "delegation quality" in the abstract,
  since it's really testing basic instruction-following reliability under
  agentic conditions.
- **Judge model — pending a tiebreak**: "best local model per Tier J
  results" was confirmed as the approach, but Tier J
  (`seven-tier-coding-v2`) currently has a 7-way tie at 8/8:
  `qwen3.6-27b--llamacpp-vulkan-radv-server-v1`,
  `qwen3-coder-next-gptq4bit--vllm-therock-gfx1151-v1`,
  `qwen2.5-vl-7b-instruct--vllm-therock-gfx1151-v1`,
  `glm-4.7-flash--llamacpp-vulkan-radv-v1`,
  `gemma-4-31b-it--vllm-therock-gfx1151-v1`,
  `gemma-4-26b-a4b-it--vllm-therock-gfx1151-v1`,
  `deepseek-v4-flash-iq2xxs--llamacpp-vulkan-radv-v1`. Sizes range from 7B
  (`qwen2.5-vl-7b-instruct`) to 284B/13B-active
  (`deepseek-v4-flash-iq2xxs`) — real tradeoff between judge-model cost
  (competes for GPU budget alongside whatever's being tested) and judging
  care for a nuanced multi-hour transcript. Chris's tiebreak call still
  needed.
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
