---
id: M-087
title: pi-web-factory — surface real failure detail in UNPARSEABLE/PERMISSIONS-VIOLATION messages
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T18:35:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-072, M-080, M-082]
---

# M-087 — pi-web-factory — surface real failure detail in UNPARSEABLE/PERMISSIONS-VIOLATION messages

## Context
Chris, 2026-08-05: "Find ways to add more details for when it fails, all I saw was a
python permission denied error but had no idea what that meant. errors should be
intuitive." Confirmed live before starting: `UNPARSEABLE` captured NOTHING about
what the agent actually said or why it didn't parse — not even in the trace db, let
alone the printed message. `PERMISSIONS-VIOLATION` had the violating filename
sitting right there in the trace db but the printed message never surfaced it.

## Plan
1. [x] `run.ts`: capture the raw last-attempt response text (already sitting in a
   local variable at the give-up point, previously discarded), truncated via a new
   `truncateRawResponse()` helper (500 char cap, notes how much was cut). Threaded
   into `phases.error`/`output_summary` and the `unparseable` result variant.
2. [x] `workflow.ts` / `planBuildTest.ts`: thread `rawResponse` through into their
   `WorkflowRunResult`/`PlanBuildTestResult` `unparseable` variants (narrow
   discriminated-union addition, no `unknown` blobs).
3. [x] `cli.ts` `describeResult`: prints the raw response for unparseable, and the
   actual violating filename(s) for permissions-violation (data was already
   flowing through `result.permissions.violations`, just never read).
4. [x] Delegated to an Implement sub-agent, independently reviewed the diff myself
   before committing (see decision log for what the review caught).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T18:50Z — done, deployed, one real bug caught in review and fixed before/after deploy -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): reviewed the sub-agent's diff, ran the full suite myself
  (221 pass), `tsc --noEmit` clean, committed and deployed.
- 2026-08-05 (claude): **immediately after deploying, a real live failure exposed a
  gap the sub-agent's own tests didn't catch**: `rawResponse: ""` (the agent
  returned genuinely no text after 3 retries) — `cli.ts`'s `rawResponse ? detail :
  fallback` ternary treats an empty string as falsy, silently reverting to the OLD
  generic message in exactly the case easiest for a human to understand ("the agent
  said nothing"). The sub-agent's own pre-existing test used `rawResponse: ""` but
  only asserted `message.toContain("UNPARSEABLE")`, which passed even with the bug
  — an assertion-strength gap, not a missing test. Fixed by checking presence
  (`"rawResponse" in result`) instead of truthiness, with a distinct "returned no
  response text at all (empty)" message; strengthened the existing test to assert
  the specific wording. Redeployed, then confirmed the fix live on a genuine
  empty-response failure (`adw_13f0a315a5d9`): message correctly read "the agent
  returned no response text at all (empty) after retries".
- 2026-08-05 (claude): **the empty-response failures turned out to have a real root
  cause worth recording**, found while investigating why they were so common today:
  litellm test completion against `medium-moe` (ornith) returned `content: ""` with
  a non-empty `reasoning_content` field and `finish_reason: "length"` — ornith is a
  genuine reasoning/thinking model, and a completion can exhaust its `max_tokens`
  budget entirely inside the invisible "thinking" phase, leaving zero budget for
  real output content. This is very likely the dominant cause of today's empty
  UNPARSEABLE failures, not model "misbehavior" so much as a token-budget mismatch
  with a newly-swapped reasoning model (contrast: `qwen3.6-35b`, the previous
  medium-moe backend, was specifically routed through a `-continue-json` scoped
  litellm route elsewhere in this stack BECAUSE thinking models cause exactly this
  class of problem — pi-web-factory's own Role config has no equivalent handling).
  Not fixed as part of this card (a real, separate design question — does
  `roles.ts` need thinking-budget-aware handling for reasoning-model backends? —
  worth its own card if this keeps recurring now that medium-moe is back on qwen
  for stability).
- 2026-08-05 (claude): separately, live testing surfaced a DIFFERENT, real
  infrastructure bug unrelated to this card's own scope — Ornith's container had no
  port actually published to the host despite its compose config declaring one
  (`docker port` returned empty despite a matching config-hash) — fixed via
  `docker compose up -d --force-recreate`. Logged for completeness since it was
  discovered via this card's own live verification pass, not because it belongs to
  this card.

## Handoff notes
Commits: `3492e18` (main fix), `f1b976b` (empty-response follow-up fix). Both
deployed and live. The reasoning-model token-budget question above is real,
unaddressed follow-up work — not filed as its own card yet since medium-moe is back
on qwen (not currently exhibiting this) as of this session's end; worth revisiting
if/when a reasoning model backs any Role again.
