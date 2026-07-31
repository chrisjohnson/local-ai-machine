---
id: M-045
title: semantic-repeat-guard - judge-model layer for vocabulary-different repeats
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T18:56:28Z
blocks: null
blocked_by: null
status: null
related_cards: [M-040, M-041, M-042]
---

# M-045 — semantic-repeat-guard: judge-model layer for vocabulary-different repeats

## Context
Follow-on to M-042: `pi-loop-police` (adopted in that card) covers almost
everything from M-041's original design goal for free, via pure statistics
(Jaccard cross-turn similarity, tool-call-sequence hashing, redundant-
re-read tracking). The one real gap it can't close by construction: a
repeat phrased with genuinely different vocabulary but the same underlying
meaning - e.g. `rocm-smi --showuse` vs. `cat /sys/class/drm/card1/device/
gpu_busy_percent` (both check GPU utilization, zero shared tokens). Chris's
explicit decision: build this as a standalone judge-model-based layer
(using the GLM-4.7-Flash judge from M-040), not integrated with
pi-loop-police's internals, triggered every 5 tool calls within a 2-minute
burst window, blocking when possible with steer as fallback.

## Plan
1. [x] Built `pi-web/extensions/semantic-repeat-guard/` (local, non-npm
   extension - `package.json` with `"pi": {"extensions": ["./src/
   index.ts"]}`, confirmed exact shape from the already-installed
   `pi-claude-bridge`'s own package.json). Registered via a bare
   filesystem path in `settings.json`'s `packages` array (confirmed pi
   supports this, not just `npm:`/`git:` sources, from
   `package-manager.js`'s `parseSource`).
2. [x] Per-session rolling window keyed by `ctx.sessionManager.
   getSessionId()` in a `Map`, not module-level singleton state -
   deliberately avoiding the exact bug class already found this session
   in `pi-claude-bridge`'s own `sharedSession` variable.
3. [x] Trigger: every 5th tool call, only if that burst spans under 2
   minutes wall-clock - skips the check during normal, unhurried work.
4. [x] Judge call via `ctx.modelRegistry.find("local-litellm", "judge")`.
5. [x] Verified end-to-end against a real test case designed specifically
   for the gap pi-loop-police can't cover (GPU-busy-check via two
   zero-word-overlap commands, 3 unrelated filler calls in between) - the
   judge correctly answered `VERDICT: yes, EARLIER_CALL: 1`, and the tool
   call was genuinely blocked (confirmed from the raw session JSONL's
   `tool_result`, `isError: true`, content matching the extension's exact
   injected reason - not just the model's own summary, which turned out
   to be unreliable, see decision log).

## Signals
<!-- signal: claude 2026-07-31T18:56Z — claiming -->
<!-- signal: claude 2026-07-31T20:10Z — done, verified end-to-end after two real bugs found and fixed via live testing -->

## Decision log
- **Bug 1 - judge needs real reasoning headroom.** First test used
  `maxTokens: 200`. Real result: `finish_reason: "length"`, empty
  `content`, because GLM-4.7-Flash does chain-of-thought reasoning before
  answering and 200 tokens was consumed entirely by that reasoning.
  Tried disabling reasoning via `chat_template_kwargs: {enable_thinking:
  false}` for speed (0.4s response) - it got the verdict **wrong** on the
  real GPU-busy test case (missed the connection entirely). With
  reasoning enabled and `maxTokens: 1500`, it correctly answered
  `VERDICT: yes, EARLIER_CALL: 1` (~7-8s, ~500-700 completion tokens).
  Correctness matters more than speed for exactly this kind of case -
  it's the entire reason this extension exists over pi-loop-police's
  free-but-shallow matching - so reasoning stays on and the real ~8s cost
  every 5th call is an accepted tradeoff, not an oversight.
- **Bug 2 - `complete()` breaks the outer tool_call block, more
  fundamental.** Even with a correct positive verdict, the blocked tool
  still executed. Root-caused via controlled diagnostics (not guessed):
  an unconditional `{block: true}` returned immediately worked; the
  identical unconditional block after a real `complete()` call (the
  documented API, used exactly per the bundled `custom-compaction.ts`
  example) did NOT take effect, while the same unconditional block after
  a plain `setTimeout` of equal duration, or after a raw `fetch()` of
  equal duration, both worked correctly. This isolates the cause to
  `complete()` itself, not call duration, not `ctx.modelRegistry` access,
  not `ctx.signal` reuse (all tested independently). Leading theory:
  `complete()` fires its own nested `before_provider_request`/
  `after_provider_response` extension hooks, and that reentrant dispatch
  into the same extension runner - while already inside a `tool_call`
  handler - corrupts the outer block decision. Not traced further into
  `pi-agent-core`'s internals; fixed pragmatically by calling litellm's
  OpenAI-compatible endpoint directly via `fetch()` instead of
  `complete()` for this specific side-channel call. `complete()` remains
  correct for its documented use case outside a `tool_call` handler (e.g.
  custom-compaction's own summarization call) - this is a narrow,
  confirmed incompatibility specific to calling it from inside
  `tool_call`, worth flagging for anyone else writing a similar extension
  against this same framework version.
- The model's own final summary text in the verification session
  fabricated a plausible-looking "rocm-smi not installed" result for the
  blocked call, rather than accurately reporting that it saw a block
  message - only the raw session JSONL's `tool_result` entries are
  reliable evidence of what actually happened; a model's own narrative
  summary is not sufficient verification on its own.
- Steer-as-fallback (part of the original design decision) was never
  exercised in testing - block worked in every real test once the two
  bugs above were fixed, so there was no case where blocking wasn't
  viable. Left in the "what if the judge call itself fails" path (logged,
  skipped, not steered, since there's no verdict to act on) rather than
  building a parallel steer-on-block-failure path that was never
  triggered in practice - would revisit if real usage ever shows block
  failing for a reason other than a failed judge call.

## Handoff notes
Done, deployed, verified end-to-end with real test cases for both the
target scenario (vocabulary-different repeat) and confirmed the two real
implementation bugs found via testing are fixed. `pi-web/extensions/
semantic-repeat-guard/src/index.ts`'s own module docstring carries the
same root-cause detail as this decision log, for anyone reading the code
directly. No config/tuning system built (window size, cadence, judge
model id are constants) - a reasonable follow-on if this proves out
in real use, not needed for a first pass.
