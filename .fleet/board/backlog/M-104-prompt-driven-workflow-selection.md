---
id: M-104
title: prompt-driven workflow selection — scale routing past a hand-maintained table
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
related_cards: [M-099]
---

# M-104 — prompt-driven workflow selection — scale routing past a hand-maintained table

## Context
Chris's direct request, 2026-08-07: "I want to file another ticket about an
abstraction skill that I simply give it a prompt to and it decides the best
workflow." Raised in the same breath as explicitly authorizing more Workflow
variants going forward (see M-099's Plan — "feel free to create workflow
variants as needed and we'll settle that better over time... having a with
and without test variant seems ok"). The two are directly connected: today's
routing is a small, hand-maintained table in `skills/pi-web-factory/SKILL.md`
(three rows: `plan-build-review`/`bounded-build-review`/`plan-build-test`,
each with a one-line "when to pick it" description a calling agent reads and
reasons about). That table already reads as a stopgap for exactly three
shapes — Chris's own "feel free to create variants" license means this
number is about to grow (a with-tests/without-tests split alone doubles it),
and a hand-maintained table doesn't scale cleanly as shapes multiply and
start overlapping in subtler ways (e.g. "with tests AND a review loop").

## Plan
<!-- not scoped yet -- open questions:
     - Where does this decision actually live? Two real shapes worth
       weighing, not obviously equivalent:
       (a) Keep it as a Claude Code skill (evolve
           `skills/pi-web-factory/SKILL.md` itself, or a new skill) — the
           calling agent still does the reasoning, just with a richer/
           smarter prompt instead of a static table it reads by eye.
       (b) Push the decision INTO pi-web-factory itself — a real
           pre-execution step (a small model call, or even a deterministic
           rules engine) that `cli.ts`/the job runner invokes given the task
           prompt, returning which registered Workflow to run. This would be
           testable/versioned the same way the rest of pi-web-factory is
           (unit tests, no dependence on which Claude Code skill happened to
           read the prompt) but is a bigger, more central piece of new
           infrastructure.
     - If (b): is this itself a trackable `kind: "code"` (deterministic
       rules) or `kind: "agent"` (a real model call) Step, i.e. does this
       connect to the M-099/architecture-hardening discussion about what
       belongs in a Step vs. runner glue? A model call to decide routing is
       exactly the kind of "real work outside a named Step" that discussion
       flagged as a thing to watch for.
     - How does this scale as MORE workflow variants get added over time
       (per Chris's own "we'll settle that better over time")? A one-time
       hardcoded routing prompt/table has the same scaling problem as
       today's SKILL.md table, just moved — needs either a self-describing
       Workflow registry (each Workflow YAML carries its own "when to pick
       me" metadata the router reads generically, rather than a
       router that must be hand-updated every time a Workflow is added) or
       an explicit acceptance that the router itself gets touched whenever a
       new Workflow ships.
     - Failure mode: what happens when the router genuinely can't tell which
       Workflow fits (ambiguous prompt)? Today's skill explicitly says "if
       it's ambiguous... ask which they mean, don't guess" — does that
       standard carry over to an automated/model-driven router, or does it
       need its own distinct "ask for clarification" path? -->

## Signals

## Decision log
- 2026-08-07 (claude): filed directly from Chris's verbatim request, raised
  alongside his decision (in M-099) to prefer explicit Workflow variants
  over conditional-step logic — the two are linked, this ticket exists
  because that decision makes routing scale into a real problem.
  `status: needs-refinement` — genuinely open where this decision should
  live (Claude Code skill vs. inside pi-web-factory itself) and how it
  should scale as Workflow variants multiply; not scoped enough to
  implement yet.

## Handoff notes
Read M-099's Plan section first for the concrete Workflow-variant work
that's already in flight (a `plan-build-review-with-tests` variant) — that's
the first real second data point (beyond today's three) this router will
need to route to, useful as a concrete test case for whatever design gets
picked here.
