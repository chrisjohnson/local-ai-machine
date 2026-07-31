---
id: M-041
title: Research and design a watchdog/judge pattern for pi sessions
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:17:00Z
blocks: null
blocked_by: null
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
1. [x] Confirm the exact extension API call shapes needed - see decision
   log. Closed the one open question (can an extension call a
   *different* model than the session's own) via direct source check.
2. [x] Write up the confirmed pattern as a design doc - see decision log.
3. [x] Scope held: no guardrails beyond repeat-detection implemented
   here - that's M-042's job, using this design.

## Signals
<!-- signal: claude 2026-07-31T06:17Z — claiming, this is primarily synthesis of research already done this session, not a fresh investigation -->
<!-- signal: claude 2026-07-31T06:35Z — done, design confirmed and written up, unblocking M-042 (M-040 itself is separately paused tonight per M-037's incident) -->

## Decision log
- Closed the open question on calling a different model from an
  extension: `ctx.modelRegistry.find(provider, modelId)` /
  `ctx.modelRegistry.getProvider(id)` resolve any registered model/
  provider, not just the session's current one (confirmed directly in
  `extensions.md`'s `ctx.modelRegistry` docs and a real usage example
  under `pi.setModel()`). That example switches the *session's own*
  active model, which is NOT what a watchdog wants - the judge should
  run a side-channel call while the main session keeps using its own
  model. `pi-agent-core`'s own README (confirmed earlier this session,
  building pi-web) shows the underlying pattern that makes this
  possible: `models.streamSimple.bind(models)` is a plain callable
  method on the model registry, model + messages in, stream out,
  independent of any particular `Agent`/session instance. The extension
  context's `ctx.modelRegistry` is the same kind of registry object, so
  the same side-channel call shape should be available - **the exact
  method name/signature for a bare one-off completion (as opposed to
  `pi.setModel()`'s session-switching) is the first thing M-042 should
  nail down empirically, not assumed further here.**

- **The confirmed pattern** (this is the design M-042 should implement
  against):
  1. A pi extension subscribes to `tool_call` (fires before each tool
     executes) and maintains a small rolling window of recent calls for
     the session - just name + args + a timestamp, not full history;
     keep it cheap.
  2. On some cadence (not necessarily every single call - a judge call
     has real latency even on a small model; consider gating on "N calls
     in the last M seconds" rather than firing on every single tool_call)
     it sends the recent window to the judge model via a side-channel
     call (per above), asking a narrow, specific question: does this
     look like a semantic repeat of a recent action (same underlying
     goal/question, different surface form) - explicitly NOT just
     byte-identical (Turnstone's own `RepeatDetector` already covers
     that case adequately; this pattern exists specifically for what
     that one misses).
  3. On a positive judge verdict, the extension has exactly two real
     levers, both confirmed, neither hypothetical:
     - **Block** the current tool call: `return { block: true, reason:
       "<specific, corrective message>" }` from the `tool_call` handler.
       The model sees the reason and can act on it *before* the call
       executes - the cleanest intervention when the judge fires in time.
     - **Steer**: `pi.sendMessage(text, { deliverAs: "steer" })` - reaches
       the agent at the next tool boundary, mid-turn, not just after the
       whole turn. Use this when the judge's verdict comes back after
       the tool already ran, or when redirecting rather than blocking is
       the better fit for what was detected.
  4. **What this pattern explicitly cannot do, stated plainly rather
     than glossed over**: force the agent to stop, veto continuing to
     the next turn, or override retry behavior. If the model receives a
     block/steer and simply ignores it and tries again a different way,
     there is no extension-level "hard stop" available - that ceiling is
     a real, documented limitation of pi's extension system, not a gap
     in this design. A genuinely hard stop would require building
     directly on `pi-agent-core`'s own `Agent`/`agentLoop` (which does
     expose `shouldStopAfterTurn` and `agent.abort()`) instead of pi's
     extension system - a materially different, bigger undertaking than
     "write an extension," out of scope for this pattern.
  5. This same shape (rolling window → judge call → block-or-steer) is
     meant to generalize beyond repeat-detection: a future "drifting off
     the stated goal" guardrail or "deadlock between two cooperating
     sessions" guardrail would plug into the identical intercept point
     and the identical two levers - only the judge's *question* and the
     *window contents* change per guardrail. M-042 should build the
     repeat-detector in a way that keeps that generalization real (e.g.
     a small reusable "ask the judge about this window" helper), not
     hardcode repeat-detection logic so tightly that a second guardrail
     would need to duplicate the whole mechanism.

## Handoff notes
Design is complete and unblocks M-042. The one thing M-042's own
implementation needs to nail down first (not resolved by this research
pass, deliberately left concrete-and-empirical rather than guessed): the
exact API call for a one-off judge completion from inside an extension,
distinct from `pi.setModel()`'s session-switching behavior.
