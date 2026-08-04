---
id: M-066
title: pi-web-factory — chains/ (phase orchestration)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: [M-062, M-063, M-064, M-065]
status: null
related_cards: [M-061, M-062, M-063, M-064, M-065, M-067, M-068, M-069]
---

# M-066 — pi-web-factory — chains/ (phase orchestration)

## Context
Wires `piwebClient.ts` (M-062), `envelopes.ts`/`gates.ts` (M-063), `permissions.ts`
(M-064), and `config.ts` (M-065) together into actual runnable chains — SSSF's
`adw_*.py` equivalent (see `pi-web-adw-design.md` §3.1's tree and §3.2's pseudocode).
Blocked on all four of those landing first since this card has nothing to orchestrate
without them.

Mirror SSSF's own shape and restraint here: its `adw_*.py` scripts are 40–180 lines on
purpose, thin wrappers around `adw_modules/`. Don't let `chains/` accumulate logic that
belongs in one of the four modules above.

Start with the two or three chain shapes actually needed first, not all twelve of
SSSF's starter set — expand later, on demand, once there's a real workload driving
which chains matter.

## Plan
1. [ ] `run.phase()` helper (or equivalent) — the shared context-manager-like construct
   every phase goes through: default-to-fail, phase_start/phase_end tracing (M-061),
   gate evaluation on agent phases.
2. [ ] First chain: something like `planBuildTest.ts` (plan → build → gate on tests →
   done) — the smallest chain that exercises every module (client, envelope, gates,
   permissions, config) end to end.
3. [ ] Session continuation across phases within one chain: thread `(sessionId, cwd)`
   from phase N into phase N+1 exactly like SSSF's `--adw-id` (design doc §3.2, last
   paragraph) — don't mint a fresh session per phase.
4. [ ] Explicitly handle the `blocked-on-human` result from M-062's wait-loop
   (`pendingAsk`) as a distinct chain outcome, not a phase failure — this is the seam
   that will eventually map onto a future ticket-queue "needs-input" state (design doc
   §3.4), so get the vocabulary right now even without the queue behind it yet.
5. [ ] End-to-end test: run the chain against a real scratch project directory on the
   box, confirm trace rows land in `factory.db` correctly ordered and the final gate
   result is accurate.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
