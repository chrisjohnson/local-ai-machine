---
id: M-041
title: Research and design a watchdog/judge pattern for pi sessions
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:17:00Z
blocks: null
blocked_by: M-040
status: null
related_cards: [M-040, M-042]
---

# M-041 — Research and design a watchdog/judge pattern for pi sessions

## Context
Motivating problem, established earlier this session with direct evidence
(not speculation): the local `coder` model got stuck re-verifying an
already-answered question for 4 minutes via trivially-varied read-only
commands, sidestepping Turnstone's own `RepeatDetector` (byte-literal
match only, 3-in-a-row). Chris wants a general pattern for a fast/cheap
model (the GLM-4.7-Flash judge from M-040) watching ANOTHER session for
thinking loops, spiraling, off-goal drift, and deadlocks - not every
possible guardrail implemented now, but a real pattern to build on.

**What's actually available, confirmed directly from pi's own
`extensions.md` and `pi-agent-core`'s README this session (not assumed):**
- `tool_call` hook: can **block** a tool call outright
  (`{block: true, reason}`) or mutate its arguments before execution.
  Real enforcement, not advisory.
- `tool_result` hook: can transform a tool's result before it reaches the
  LLM (post-execution).
- Message injection: `pi.sendMessage(text, {deliverAs: "steer" |
  "followUp" | "nextTurn"})` - `steer` reaches the agent at the next tool
  boundary mid-turn, not just after the whole turn finishes.
- `session_before_compact` / `session_compact`: hooks specifically around
  compaction, can supply a custom summary.
- **No true loop veto exists at the extension level** - confirmed
  directly: extensions cannot force-stop the agent, override retries, or
  veto continuing to the next turn. `ctx.shutdown()` exists but is a
  *deferred* graceful shutdown (waits for idle), not an interrupt - and
  pi-web explicitly no-ops it anyway ("shutdown is not supported in Pi
  Web"). The "sub-agents" capability that sounds like an exception is
  actually just spawning an entirely separate `pi` subprocess (confirmed
  from the real `subagent` example's source: literal `spawn(...)` of
  another `pi` CLI) - it doesn't grant control over the *current* loop.
- Session history is inspectable: `ctx.sessionManager` (current in-memory
  state) and the persisted `*.jsonl` file directly (already parsed once
  in `session-history.ts` from the abandoned pi-agent-supervisor - same
  message shape applies here).

**So the real lever available is: intercept and redirect, not stop.**
A watchdog extension can't force a runaway session to halt, but it CAN:
1. Watch the stream of `tool_call` events (and/or periodically inspect
   recent history) for a drift signature - not just literal repeats
   (Turnstone's blind spot) but *semantic* repetition: same underlying
   question/action attempted a different way. This is exactly the kind
   of judgment call a small, fast model (the judge) is suited for - feed
   it the last N tool calls + their args and ask "is this session stuck
   re-doing the same thing."
2. On a positive detection, either **block** the specific tool call with
   a corrective `reason` message the model will see, or **steer** in a
   message telling it to stop and reconsider - both are real, confirmed
   mechanisms, unlike a hoped-for "force stop."
3. Treat "can't truly force a stop" as an accepted, documented limitation
   of this pattern, not a gap to paper over - matches the same honesty
   this whole project has applied elsewhere (e.g. M-031's explicit
   "there is NOT an autonomous keep-working loop" boundary statement).

## Plan
1. [ ] Confirm the exact extension API call shapes needed (import
   surface, `pi.on("tool_call", ...)` signature, how to call the judge
   model FROM an extension - does pi's extension API expose a way to
   make an LLM call using a *different* model than the session's own,
   e.g. for the judge? Check directly rather than assume - this is the
   one open technical question this research pass should close before
   M-042 starts implementing).
2. [ ] Write up the confirmed pattern as a short design doc (this card's
   decision log is fine, or a small markdown file in the repo if it'll
   be referenced across multiple future guardrail extensions) covering:
   the detection loop shape, what "intercept and redirect" can and can't
   do, and how a new guardrail (beyond the repeat-detector in M-042)
   would plug into the same shape.
3. [ ] Do NOT implement every guardrail Chris listed (drift-from-goal,
   deadlock-breaking, etc.) in this card - that's explicitly out of
   scope here. This card is research + pattern only; M-042 implements
   ONE concrete instance (repeat/thinking-loop detection) using it.

## Signals
<!-- signal: claude 2026-07-31T06:17Z — claiming, this is primarily synthesis of research already done this session, not a fresh investigation -->

## Decision log

## Handoff notes
