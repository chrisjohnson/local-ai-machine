---
id: M-096
title: plan Role sometimes writes the actual deliverable instead of just a plan doc
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: needs-refinement
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
<!-- not scoped yet -- needs someone to read prompts/plan.md (the plan
Role's actual system prompt) and figure out why it's ambiguous enough to
sometimes produce a direct deliverable instead of a plan artifact,
especially for tasks phrased as "write a design doc" (arguably a genuinely
confusing prompt for a Role whose job is producing plans, since "write a
design doc named X.md" sounds like a literal deliverable to a model that
doesn't know only `build` is supposed to write X.md) -->

## Signals

## Decision log
- 2026-08-06 (claude): filed after a third real occurrence during M-094
  testing — meets M-078's own "recurs enough" threshold for filing.
  `status: needs-refinement` since the root cause (prompt ambiguity in
  `prompts/plan.md`, or something else) hasn't been read/diagnosed yet.

## Handoff notes
Three real, reproduced occurrences on record: two from M-078's decision log
(2026-08-05), one from M-094's testing (2026-08-06, this run's title
literally contained "design doc named X.md" — worth checking whether that
specific phrasing is the trigger, since it's ambiguous between "write a
document ABOUT the design" and "write file X.md").
