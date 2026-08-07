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
**Research pass complete, 2026-08-07 (claude) — not implemented, no design
picked. Below: how routing works today (traced through the actual code, not
assumed), the two candidate shapes made concrete with real file-level costs,
a third option surfaced by this research, and the ambiguity-handling
question worked through for each. `status` left `needs-refinement` — real
open questions remain (see end of this section) that only Chris can settle,
this is not yet an implementable spec.**

### How routing works today (traced through the real files)
- `skills/pi-web-factory/SKILL.md` is the fallback skill for open-ended
  requests ("run the pipeline for X" without naming a shape). Its whole
  routing mechanism is a 3-row Markdown table (Name / Shape / "When to pick
  it", one prose sentence each) that the calling Claude Code agent reads and
  reasons about by eye, plus an explicit default ("Default choice for most
  requests" -> `plan-build-review`) and an explicit ambiguity rule: *"If it's
  ambiguous whether they want you to just do the work directly vs. delegate
  it to a tracked Workflow Run, ask which they mean — don't guess."* Note
  precisely what that rule covers today: agent-does-it-here vs.
  delegate-to-a-Workflow-Run. It does NOT currently cover "ambiguous which
  Workflow shape to delegate to" — that case isn't addressed at all in the
  current skill text, which matters for the failure-mode question below.
- Each Workflow additionally has its own dedicated skill
  (`skills/plan-build-review/SKILL.md`, `skills/bounded-build-review/SKILL.md`,
  `skills/plan-build-test/SKILL.md`) for a user who already names the shape
  explicitly (`/skill:plan-build-review <task>`) — these bypass routing
  entirely, not relevant to the routing problem itself, but they're the
  "already decided" escape hatch worth keeping regardless of what M-104
  builds.
- On the pi-web-factory side, `chains/registry.ts` is the only place
  Workflow names are actually registered for `cli.ts --workflow <name>`:
  a `Record<string, WorkflowRunner>` with exactly 3 keys today
  (`plan-build-review`, `bounded-build-review` — both generic-YAML-
  interpreter-driven, loaded from `workflows/*.yaml` via a hardcoded
  `WORKFLOW_FILES` array — and `plan-build-test`, a structurally separate
  hand-written TS chain, `chains/planBuildTest.ts`, kept independent per
  M-076). **Confirmed: the registry carries NO description/metadata field
  today** — `workflowRegistry`'s value type is `WorkflowRunner` (a function),
  and `modules/workflowDef.ts`'s `Workflow` interface (the YAML-loaded shape)
  is just `{ name: string; steps: Step[] }`. There is nothing today a router
  could read generically to learn "when to pick `bounded-build-review`" —
  that knowledge exists ONLY as hand-written prose in `SKILL.md`'s table and
  in each dedicated skill's own `description:` frontmatter. Registry and
  routing-knowledge are fully decoupled right now; that decoupling is
  exactly the scaling problem this card exists to fix.
- `modules/workflowDef.ts`'s Zod schema (`AgentStepSchema`/`CodeStepSchema`/
  `LoopStepSchema`) has no free-text/metadata field anywhere — adding a
  "when to pick me" field would be a real (if small) schema change, not
  something that already fits. Directly relevant precedent: M-105 (Chris's
  own fresh card, item 5) already asks for a `title`/`summary` field to be
  added at the Workflow-step level for a different reason (human-friendly
  UI labels on the visualizer detail page) — that's the same kind of schema
  surgery a self-describing router would need, just for a different
  metadata field, and would be sensible to land in the same pass if both
  move forward (same file, same discriminated-union edit, same
  `workflowDef.test.ts` pattern to extend).

### Candidate (a): keep it a Claude Code skill, but make the input scale
The calling Claude Code agent still does the reasoning — the question is
what it reads to do that reasoning, so a 4th/5th/6th Workflow doesn't
require hand-editing `SKILL.md` prose every time.
- **Naive version (status quo, doesn't actually solve the card):** just keep
  adding rows to the Markdown table by hand each time a Workflow ships. This
  is explicitly the thing the card says won't scale — noted here only to
  rule it out, not as a real candidate.
- **Real version — self-describing registry, skill reads it generically:**
  add a `description`/`when_to_pick` string field to `workflowDef.ts`'s
  `Workflow`-level schema (sibling to `name`, not per-step — routing
  operates at the whole-Workflow granularity, matching how `SKILL.md`'s
  table already works one row per Workflow, not per step). Each
  `workflows/*.yaml` file carries its own routing metadata inline, e.g.:
  ```yaml
  workflows:
    - name: plan-build-review
      description: "Default choice for most requests — a clear task where a second agent's review is enough quality gate."
      steps: [...]
  ```
  `chains/registry.ts` already has a `workflowNames()` export (used by
  `cli.ts` for its "unknown --workflow" error message) — extend it (or add a
  sibling `workflowDescriptions()`) to also surface each registered
  Workflow's `description`, **including `plan-build-test`'s**, which isn't
  YAML-driven (it's the hand-written `chains/planBuildTest.ts`) and so needs
  its description supplied a different way — either a small hardcoded
  constant alongside its registration in `registry.ts`, or (cleaner, more
  consistent) giving it a matching sidecar description even though it has no
  YAML file, e.g. a `WORKFLOW_DESCRIPTIONS: Record<string, string>` the
  registry exports uniformly for both kinds. Then `skills/pi-web-factory/
  SKILL.md` (or a small script it shells out to first) would need to
  actually fetch that list at routing time — this is the real new
  complexity versus today's static table: **a skill has no standing way to
  execute pi-web-factory TS code and read its output today.** Concretely
  this means either (i) the skill's own instructions tell the calling agent
  to run something like `bun $HOME/pi-web-factory/cli.ts --list-workflows`
  (a new CLI flag that doesn't exist yet — small, `cli.ts`-side addition:
  parse the flag, print `workflowNames()` + descriptions, exit 0, no run
  performed) and read the JSON/text output before picking, or (ii) the
  descriptions get duplicated into the skill's own Markdown (defeats the
  point — back to hand-maintenance, just in two places instead of one). (i)
  is the only version that actually solves the scaling problem; it turns
  "hand-edit a table" into "add a `description:` line to your new Workflow's
  YAML, the skill picks it up automatically next time it's invoked."
- **Effort estimate:** small-to-moderate. `workflowDef.ts` schema change +
  `workflowDef.test.ts` additions (mirrors the pattern already used for
  every other schema field): a few hours. New `--list-workflows` CLI flag
  in `cli.ts` + wiring in `registry.ts` for `plan-build-test`'s non-YAML
  description: a few more hours, including tests. `SKILL.md` rewrite to
  shell out and read the list instead of embedding a static table: small,
  mostly prose. Total: well under a day for someone fluent in the codebase,
  smaller than M-099's Option 2 estimate (half-day-to-a-day) since this adds
  one metadata field rather than new interpreter/conditional-execution
  logic. **Ceiling worth flagging:** this design still leaves the actual
  matching judgment (which description best fits this prompt) inside the
  calling Claude Code agent's own reasoning, unversioned and untestable the
  way pi-web-factory's own code is (no unit test can assert "given prompt X,
  the skill picks Workflow Y" the way `workflowDef.test.ts` can assert a
  schema invariant) — it scales the INPUT cleanly, not the decision quality
  or its testability.

### Candidate (b): push the decision into pi-web-factory itself
A real pre-execution step, invoked by `cli.ts` (or a wrapper around it)
given the task prompt, that returns which registered Workflow to run before
the real run starts.
- **Where it would live:** not `cli.ts` itself (that file's job is arg
  parsing + dispatch to an already-known `--workflow` name, per its own
  header comment — folding a routing decision into it would blur that
  boundary). Cleanest fit: a new module, e.g. `modules/routeWorkflow.ts`,
  called from `cli.ts` BEFORE the existing `if (!workflow) throw ...`
  required-flag check — i.e. `--workflow` becomes optional; if omitted,
  `routeWorkflow(taskPrompt, workflowNames_with_descriptions)` is called and
  its result substitutes for the flag. This mirrors how `chains/registry.ts`
  already centralizes workflow-name knowledge — a router module would sit
  right next to it, consuming the same `workflowNames()`/description export
  candidate (a) would also need, meaning **(a)'s self-describing-registry
  schema work is not wasted if (b) is chosen instead — it's a shared
  prerequisite either way,** the two candidates diverge on WHO reads that
  metadata (a Claude Code skill vs. pi-web-factory's own code), not on
  whether the metadata needs to exist.
- **Is it a trackable Step, per the M-099/M-103 "real model-call time needs
  a named Step" discussion?** Yes, concretely, if the routing decision is a
  real model call (not a deterministic rules engine) — this is exactly the
  pattern flagged in M-103's Plan §5 for its own decision Role ("Track the
  decision call's own cost/time somewhere in the trace DB... a model call is
  exactly the kind of thing that shouldn't be silent runner glue"). Same
  conclusion applies here directly: if candidate (b) uses a real `kind:
  "agent"` Role to pick the Workflow, that call happens BEFORE a Workflow
  (and therefore before a `tracer`/`adwId`/session) even exists yet — a
  structural wrinkle M-103 doesn't have to deal with (its decision Role runs
  mid-flow, after a ticket/adwId already exist). Two real options: (i) mint
  a lightweight tracer/adwId specifically for the routing decision itself
  (its own tiny 1-step "run", closed out immediately, before the real
  Workflow's run begins) so it's not silent, or (ii) treat routing as
  legitimately pre-run infrastructure exempt from Step-tracking, on the
  theory that it's choosing which run to start, not part of the run itself
  — this needs Chris's call, it's a real precedent-setting architecture
  question, not an implementation detail. If (b) instead uses a
  deterministic rules engine (e.g. simple keyword/pattern matching against
  each Workflow's `description`, no model call) this question disappears
  entirely — cheaper to build AND avoids the tracking question — but is
  also weaker: a hand-written keyword matcher has the same "doesn't scale to
  subtle overlaps" problem the card opens with (e.g. "with tests AND a
  review loop"), just moved from Markdown prose into TS pattern-matching
  code. A real classification decision (does this prompt want a review loop
  vs. a single pass vs. a test gate) is squarely an NLU task, not pattern
  matching — pushes towards a real (if small/cheap) model call being the
  only version that actually generalizes, which reopens the Step-tracking
  question above.
- **Effort estimate:** larger than (a). New module + `cli.ts` wiring
  (`--workflow` optional-with-fallback, a `CliUsageError` path becomes a
  router-invocation path instead) + a new Role in `factory.config.yaml` if
  model-call-based + the Step-tracking mechanism from the paragraph above +
  test coverage (unit tests for the router's own logic, mirroring
  `workflowDef.test.ts`'s discipline, PLUS integration coverage the way
  `chains/planBuildTest.integration.test.ts` exercises a real end-to-end
  path) — realistically more than M-099's Option 2 estimate
  (half-day-to-a-day), likely 1-2 days for someone fluent in the codebase,
  given it's new infrastructure (a pre-run decision point that doesn't
  structurally exist anywhere today) rather than an addition to an existing
  interpreter branch. **What this buys over (a):** the decision becomes
  testable/versioned pi-web-factory code (a real unit test CAN assert
  "given prompt X, router picks Workflow Y" the way it can't for a skill's
  own reasoning), and works uniformly regardless of which client triggers a
  run (today only a Claude Code skill triggers `cli.ts`, but M-103's Plan
  already gestures at automated retry/new-run triggering more invocations
  programmatically — e.g. M-103 §5's "kick off the next attempt... the same
  way anything else does today" — a programmatic caller has no "skill" to
  reason with a table at all, so if non-interactive/automated Workflow-
  triggering grows, only (b) covers that path; (a) is Claude-Code-session-
  bound by construction).

### Option (c), newly surfaced by this research: hybrid — skill does routing, pi-web-factory validates/exposes the menu
A middle ground worth naming explicitly since it wasn't in the card's
original two: candidate (a)'s CLI-flag idea (`--list-workflows`) is useful
regardless of which side makes the final decision. Ship JUST that (the
self-describing registry + a way to list it) as a first phase, keep the
actual decision-making in the Claude Code skill (candidate a) for now, and
treat "move the decision itself into pi-web-factory" (candidate b) as a
distinct, separately-triggerable follow-up once/if a non-interactive caller
(e.g. M-103's automated retry path) actually needs to make this same
decision without a Claude Code session in the loop. This sequencing avoids
speculatively building (b)'s Step-tracking/new-Role machinery before there's
a concrete second caller that needs it, while still fixing the actual
"doesn't scale past a hand-maintained table" problem the card opens with —
worth Chris weighing against just picking (a) or (b) outright up front.

### Failure mode: ambiguous routing
Today's skill's "ask, don't guess" rule (quoted above) covers a DIFFERENT
ambiguity (delegate-vs-do-it-yourself) than this card's ambiguity (WHICH
Workflow to delegate to) — the two shouldn't be conflated, and neither
candidate inherits an existing answer to the second one for free:
- **Candidate (a):** stays cheap to extend — "ask, don't guess" is already
  the exact register a Claude Code skill operates in (it can literally ask
  the user a clarifying question mid-conversation, the way it already does
  for the do-it-yourself-vs-delegate case). Natural extension: add one more
  sentence to the skill instructing it to do the same when the description
  list doesn't clearly single out one Workflow. Costs ~nothing extra beyond
  what's already estimated above.
- **Candidate (b):** does NOT carry the standard over cleanly — a
  non-interactive `cli.ts`/router invocation has no human to ask
  synchronously (this is the same shape of problem `BLOCKED-ON-HUMAN`
  already solves for mid-run agent questions). Two real sub-options, needs
  Chris's call, not resolved here: (i) reuse the existing
  `BLOCKED-ON-HUMAN` status/pause mechanism for routing ambiguity too — the
  router returns `BLOCKED-ON-HUMAN` instead of a Workflow name, the CLI
  prints the same deep-link-and-wait UX callers already understand, no new
  status vocabulary needed; or (ii) default to the most conservative/
  full-featured Workflow on genuine ambiguity (today that's arguably
  `bounded-build-review` — has a correction loop, the closest thing to "when
  in doubt, add more checking") and log the ambiguity rather than pausing,
  trading a possibly-wrong-shape run for never blocking unattended
  pipelines. (i) matches the card's own "ask, don't guess" spirit most
  faithfully; (ii) is friendlier to any automated/unattended caller (again,
  relevant to M-103's retry-triggering path) but is a real philosophy
  departure from "don't guess" that Chris should explicitly bless, not
  something to default into silently.

### Connection to M-103 / M-105 (not implemented, just noted per this
research's brief)
- **M-103** (evidence-driven retry-vs-new-run, ticket table): its Plan
  already independently arrives at the same "a model call outside a normal
  run needs deliberate Step/trace-tracking" question this card's option (b)
  raises (M-103 Plan §5's closing paragraph). If both M-103's decision Role
  and M-104's candidate-(b) router end up as real pre/post-run model calls,
  worth designing their tracking mechanism ONCE, shared, rather than twice
  independently — flagging for whoever picks this up, not resolving here.
  Also: M-103's auto-ticket-creation-per-run (`cli.ts` today has no
  `--ticket-id`, one gets minted per run) is a plausible NATURAL HOME for
  logging a routing decision's reasoning even under option (ii) above
  (log-not-block) — the ticket's row could carry which Workflow got picked
  and why, giving a human something to audit after the fact even in the
  no-pause path.
- **M-105** (visualizer tweaks, item 5): already asks for a `title`/
  `summary` field on Workflow steps for UI display, independent of this
  card's needs — but it's the same kind of `workflowDef.ts` schema surgery
  candidate (a)/(b) both need for a `description`/`when_to_pick` field.
  Worth sequencing/landing together if both move forward (same file, same
  discriminated-union touch, same test-file pattern) — not a hard
  dependency either direction, just an efficiency note for whoever
  implements either.

### Genuinely open questions (why `status: needs-refinement` stays)
1. Candidate (a) vs (b) vs the (c) hybrid sequencing — Chris's call, not
   attempted here per this task's brief.
2. If (b): real model call (Step-tracking question) vs. deterministic rules
   engine (weaker but avoids that question) — needs a decision on how much
   routing-quality matters vs. how much new tracking infrastructure is
   worth building right now.
3. Ambiguity handling for (b) specifically: `BLOCKED-ON-HUMAN`-reuse vs.
   conservative-default-and-log — a real behavioral/philosophy choice, not
   just an implementation detail.
4. Whether `plan-build-test`'s description (non-YAML, hand-written chain)
   should live in `registry.ts` as a hardcoded constant or get its own
   small YAML-adjacent sidecar file for consistency with the other two —
   minor, but affects how "add a description" instructions get written for
   future Workflow authors.

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
- 2026-08-07 (claude), deeper research pass at Chris's request (read-only —
  no implementation): traced today's routing mechanism through the real
  files (`skills/pi-web-factory/SKILL.md`'s 3-row table,
  `chains/registry.ts`'s metadata-free registry, `workflowDef.ts`'s schema
  with no description field anywhere) and confirmed the registry genuinely
  carries no machine-readable routing metadata today — that gap is real,
  not assumed. Made both candidates from the card concrete with file-level
  changes and effort estimates: (a) skill-side, needs a `description` field
  added to `workflowDef.ts` plus a new `cli.ts --list-workflows` flag so the
  skill can read Workflow metadata generically instead of embedding a
  static table (well under a day); (b) pi-web-factory-side, needs a new
  `modules/routeWorkflow.ts` invoked from `cli.ts` before workflow dispatch,
  raises a real Step-tracking question (mirrors M-103's own "a model call
  needs a named Step" finding) if it's a real model call rather than a
  rules engine (1-2 days, larger and more novel than (a)). Surfaced a third
  option (c): ship (a)'s self-describing-registry schema work first
  (shared prerequisite either design needs) while deferring the actual
  decision-owner question until a concrete non-interactive caller (e.g.
  M-103's automated retry path) demonstrates (a) alone isn't enough. Worked
  through the "ask, don't guess" ambiguity standard for both candidates —
  carries over cheaply to (a) (a skill can just ask), does NOT carry over
  for free to (b) (no human in the loop for a non-interactive router;
  either reuse `BLOCKED-ON-HUMAN` or default-to-conservative-and-log, a real
  philosophy choice). Noted M-105 item 5 (step `title`/`summary` schema
  field) touches the same `workflowDef.ts` file/pattern a routing
  `description` field would, worth sequencing together if both proceed.
  No design picked — that's explicitly Chris's call per this task's brief.
  `status: needs-refinement` retained: candidate choice, model-call-vs-
  rules-engine, and ambiguity-handling-for-(b) are all still genuinely open
  and only resolvable by Chris's own judgment, not further research.

## Handoff notes
Read M-099's Plan section first for the concrete Workflow-variant work
that's already in flight (a `plan-build-review-with-tests` variant) — that's
the first real second data point (beyond today's three) this router will
need to route to, useful as a concrete test case for whatever design gets
picked here.

Whichever design gets picked, `chains/registry.ts`'s `WORKFLOW_FILES` array
and `workflowRegistry` object are the exact two places a new Workflow
already must be registered today — both candidates above build ON TOP of
that existing registration point rather than replacing it, so a future
`plan-build-review-with-tests` (M-099) still registers exactly the way it
does today regardless of which routing design M-104 eventually picks.
