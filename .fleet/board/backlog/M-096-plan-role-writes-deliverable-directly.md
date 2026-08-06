---
id: M-096
title: plan Role sometimes writes the actual deliverable instead of just a plan doc
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-078, M-080, M-094]
---

# M-096 — plan Role sometimes writes the actual deliverable instead of just a plan doc

## Context
First flagged in M-078's decision log (2026-08-05), unfiled at the time: "the
`plan` Role (writes: `specs/` only) directly wrote the actual deliverable file
instead of just a plan document, twice, tripping a real
`PERMISSIONS-VIOLATION` (correctly caught and rolled back) — same class of
thing as M-080. Not filed as its own card yet; flagging the pattern here in
case it recurs enough to be worth a design look at `plan`'s own system
prompt."

It recurred a third time during M-094's real concurrent-run test
(2026-08-06): a `plan-build-review` run asked to "write a detailed markdown
design doc named DESIGN2.md" failed with `permissions violation: DESIGN2.md`
— the `plan` step wrote the actual design doc directly (outside its
`specs/`-only allowlist) instead of producing a plan artifact that `build`
would later turn into `DESIGN2.md`. Per that entry's own stated threshold
("in case it recurs enough"), it has now recurred enough.

The safety net (permissions enforcement, rollback) is working correctly both
times — this isn't a security/correctness gap. It's wasted work: a whole
`plan` turn (real tokens, real time) gets thrown away and the run fails
outright rather than, e.g., retrying with a corrective message the way an
`UNPARSEABLE` envelope gets a retry.

## Plan
**Real prompt-wording problem, confirmed by direct comparison — not "the model just
doesn't follow instructions."** Read `prompts/plan.md` in full (it is a single
sentence, reproduced here verbatim since the whole problem is visible in that one
line):

> "You are the "plan" agent in a pi-web-factory chain. Your job: produce a plan for
> the given task, never implement it yourself. Reply with ONLY a single valid JSON
> object matching the required envelope schema for this phase (no prose before or
> after it, no markdown code fences)."

Compared directly against `prompts/review.md` (also read in full), which handles the
analogous problem (review's `writes: []` — a Role restricted from doing the thing it
might be tempted to do) MUCH more explicitly:

> "You are read-only: inspect the work already done, do not fix anything yourself,
> no matter how small or obviously correct the fix seems -- a reviewer that quietly
> fixes things is not a reviewer."

`plan.md` has **no equivalent sentence at all** — no mention of `specs/`, no mention
of "write a plan document, not the deliverable," no mention of what file it should
produce or where. The model is never told ANYTHING about the write-path restriction
its `writes: specs/` config enforces out-of-band (`factory.config.yaml`, confirmed by
reading in full: `plan`'s entry is `writes: [specs/]`) — `permissions.ts`'s
enforcement is entirely mechanical/after-the-fact and the prompt has zero awareness
of it. This is exactly the gap "produce a plan ABOUT a design doc" vs. "the task
literally says a filename, so just make that file" — a task like "write a detailed
markdown design doc named DESIGN2.md" is genuinely ambiguous to a model that's never
been told its own job is to describe a plan for producing DESIGN2.md, not to BE
DESIGN2.md. Confirmed this reading is consistent with the actual schema-level intent:
`envelopes.ts`'s `PlanOutputSchema` doc comment (ported from upstream) says
`commit_message`'s purpose is "subject line for committing the PLAN document itself,
not the implementation it describes" — the data model has always understood this
distinction; it was simply never communicated to the model doing the work.

### Recommended fix: rewrite `prompts/plan.md` with the same explicit,
### can't-miss-it structure `review.md` already uses successfully
Concrete new prompt text for `prompts/plan.md` (replace the file's single line
with this expanded version — keep it to a similarly tight paragraph, not a wall
of text, matching this codebase's existing terse-prompt style):

```
You are the "plan" agent in a pi-web-factory chain. Your job is to produce a
PLAN document describing how the task should be implemented -- you never
implement it yourself and you never create the actual deliverable file(s) the
task describes, no matter how the task is phrased. If the task says "write a
design doc named X.md," your job is to write a plan FOR producing X.md (what
it should contain, how build should approach it), saved under specs/ -- not
to create X.md itself. You may only write files under specs/; treat any
other path, including one named explicitly in the task, as build's job, not
yours. Reply with ONLY a single valid JSON object matching the required
envelope schema for this phase (no prose before or after it, no markdown
code fences).
```

Key changes from the current text, each addressing a specific piece of
confirmed evidence:
1. "a PLAN document describing how the task should be implemented" — states
   the actual artifact shape (a plan/spec document), not just "a plan" in
   the abstract, which is genuinely ambiguous between a data structure (the
   envelope) and a file.
2. The explicit "If the task says 'write a design doc named X.md'..." sentence
   directly names the EXACT failure pattern from the M-094/DESIGN2.md
   occurrence — this is the single highest-value addition, since it's not a
   generic "be careful" instruction but a concrete worked example matching
   the real, repeated trigger phrasing (three real occurrences, two from
   M-078, one from M-094, all plausibly this same shape — task prompts that
   name a specific deliverable filename).
3. "no matter how the task is phrased" — preempts the model rationalizing
   "well the user explicitly asked for X.md" as an override.
4. "You may only write files under specs/" — states the actual constraint
   in-band for the first time ever; today the model has zero textual
   awareness that `specs/` is even a relevant concept, despite it being the
   literal enforced allowlist.
5. Matches `review.md`'s successful pattern: a plain declarative "you are
   only allowed to do X" statement, not a soft suggestion.

### Also recommended: structural nudge via `PlanOutput.artifacts`
Lower priority than the prompt rewrite (do the prompt fix first, re-test, only
add this if the prompt fix alone doesn't fully resolve it after a few more
live occurrences) — `envelopes.ts`'s `EnvelopeBaseSchema.artifacts: string[]`
already exists and is inherited by `PlanOutputSchema` unchanged; the prompt
could explicitly instruct the model to put the spec file's path in `artifacts`
(e.g. `"artifacts": ["specs/DESIGN2-plan.md"]`), giving the model a concrete
field to "point at" the plan document rather than needing to conjure the
right behavior purely from prose. This is a prompt-only addition (no schema
change needed, the field already exists) — mention it in the same prompt
rewrite if it fits naturally, but don't over-engineer this into a second
follow-up card; try folding it into the same edit.

### Not recommended: a stronger structural constraint (e.g. gate/hard gate)
Considered and rejected as the PRIMARY fix (though the existing permissions
enforcement already IS this, and is working correctly — see below): building
some new pre-flight validation that inspects a plan step's intended output
before it's written would duplicate `permissions.ts`'s already-correct,
already-working enforcement (violations ARE always caught and rolled back,
per every one of the three real occurrences on record — this was never a
security/correctness gap, per the Context's own framing: "The safety net...
is working correctly both times... It's wasted work"). The actual problem
this card exists to fix is WASTED WORK (a whole plan turn thrown away,
real tokens/time lost, run fails outright), not insufficient enforcement —
a prompt fix that reduces how OFTEN the model tries the wrong thing is the
right lever, not a stronger backstop for something already reliably caught.

### Separately (flag, do not fold into this card): retry-on-permissions-violation
The Context notes this fails outright today rather than retrying "the way an
UNPARSEABLE envelope gets a retry." That's a real, separate, and reasonable
follow-up (a permissions violation on a `plan` step could, in principle, retry
with a corrective message the same way `run.ts`'s parse-failure loop already
does) — but it's a different mechanism (workflow-level retry-with-correction
vs. prompt wording) and a bigger change (needs to reconstruct/re-send a
corrective prompt mid-Workflow, similar in shape to `workflow.ts`'s own
`buildLoopCorrectionMessage` but for a NEW failure class it doesn't already
handle). Worth its own card if the prompt fix here doesn't fully eliminate the
pattern — do not scope it into M-096, keep this card's fix narrowly to the
prompt wording.

### Tests / verification
No automated test can directly verify "the model follows this prompt better"
(this is a live-model behavioral fix, not a code-logic one) — verification is:
1. **Critical deployment detail, confirmed by reading both files byte-for-byte
   (`prompts/plan.md` vs `plugins/pi-web-factory-prompts/roles.json`'s `"plan"`
   key — currently IDENTICAL text in both):** per `roles.ts`'s own module
   header comment, `pi-web-factory` is NOT YET baked into the `jmfederico-pi-web`
   container (that's M-068, not done yet) — the LIVE, currently-injected system
   prompt for real Workflow Runs on this box comes from
   `plugins/pi-web-factory-prompts/roles.json`'s `"plan"` key, NOT from
   `prompts/plan.md` (that file is what `factory.config.yaml`'s `system_prompt:`
   points to, which only takes effect once M-068 lands). **This means the
   real, immediately-effective fix must be applied to
   `plugins/pi-web-factory-prompts/roles.json` first** (it's what's actually
   live) — update `prompts/plan.md` in the SAME change to keep the documented
   duplication in sync (per that file's own "Known, deliberate duplication"
   section), but do not assume editing only `prompts/plan.md` does anything
   observable until M-068 ships. Get this ordering right — it's the difference
   between a fix that does nothing live today and one that actually changes
   real Workflow Run behavior immediately.
2. Re-run a `plan-build-review` Workflow with a task prompt deliberately
   shaped like the trigger case (e.g. "write a detailed markdown design doc
   named SOMETHING.md") — confirm the `plan` step's envelope produces a
   `specs/`-only artifact and the run does NOT hit `PERMISSIONS-VIOLATION`.
   A single clean pass isn't strong proof (this is a probabilistic model
   behavior, not deterministic) — note in the card's own decision log
   whether/how many trigger-shaped prompts were tried before calling this
   verified, rather than declaring success off one run.

## Signals

## Decision log
- 2026-08-06 (claude): filed after a third real occurrence during M-094
  testing — meets M-078's own "recurs enough" threshold for filing.
  `status: needs-refinement` since the root cause (prompt ambiguity in
  `prompts/plan.md`, or something else) hasn't been read/diagnosed yet.
- 2026-08-06 (claude): refined per Chris's "refine all 4" request. Read
  `prompts/plan.md`, `prompts/review.md`, `modules/roles.ts`,
  `factory.config.yaml`, `modules/envelopes.ts`, and
  `plugins/pi-web-factory-prompts/roles.json` in full. Confirmed a real
  prompt-wording gap by direct comparison: review.md explicitly and
  repeatedly states its read-only constraint in-band; plan.md never
  mentions specs/, never forbids writing the deliverable, and never
  addresses the exact "task names a filename" trigger phrasing. Wrote a
  concrete replacement prompt. Critically, confirmed via roles.ts's own
  module header that the LIVE prompt today is
  plugins/pi-web-factory-prompts/roles.json's "plan" key, not
  prompts/plan.md (pi-web-factory isn't baked into the container yet,
  M-068) — plan specifies fixing the live copy first, prompts/plan.md in
  the same change to stay in sync. Cleared `status: needs-refinement`.

## Handoff notes
Three real, reproduced occurrences on record: two from M-078's decision log
(2026-08-05), one from M-094's testing (2026-08-06, this run's title
literally contained "design doc named X.md" — worth checking whether that
specific phrasing is the trigger, since it's ambiguous between "write a
document ABOUT the design" and "write file X.md").
