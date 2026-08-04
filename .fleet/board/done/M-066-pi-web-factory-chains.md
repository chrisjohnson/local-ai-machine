---
id: M-066
title: pi-web-factory — chains/ (phase orchestration)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T04:56:03Z
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
1. [x] `run.phase()` helper (or equivalent) — the shared context-manager-like construct
   every phase goes through: default-to-fail, phase_start/phase_end tracing (M-061),
   gate evaluation on agent phases.
2. [x] First chain: something like `planBuildTest.ts` (plan → build → gate on tests →
   done) — the smallest chain that exercises every module (client, envelope, gates,
   permissions, config) end to end.
3. [x] Session continuation across phases within one chain: thread `(sessionId, cwd)`
   from phase N into phase N+1 exactly like SSSF's `--adw-id` (design doc §3.2, last
   paragraph) — don't mint a fresh session per phase.
4. [x] Explicitly handle the `blocked-on-human` result from M-062's wait-loop
   (`pendingAsk`) as a distinct chain outcome, not a phase failure — this is the seam
   that will eventually map onto a future ticket-queue "needs-input" state (design doc
   §3.4), so get the vocabulary right now even without the queue behind it yet.
5. [x] End-to-end test: run the chain against a real scratch project directory on the
   box, confirm trace rows land in `factory.db` correctly ordered and the final gate
   result is accurate.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:56Z — claiming, starting run.phase() + first chain -->
<!-- signal: claude 2026-08-04T06:10Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): **real bug caught and fixed in review, worth flagging above
  the usual noise.** The implementing pass's permissions handling used
  `PermissionsResult.clean` (whether rollback *attempts* succeeded) as the phase
  pass/fail signal instead of `violations.length` (whether an unauthorized write
  happened at all) — `clean` is trivially `true` whenever there are zero violations,
  so a real permissions violation was being traced as `gate_fail` while the phase was
  *still unconditionally returned as `"success"`* to the caller. Directly contradicts
  upstream SSSF's hard rule #9 ("unauthorized changes are rolled back AND THE PHASE
  DIES" — not "and continues if the rollback happened to work"). Added a
  `permissions-violation` result variant to both `RunAgentPhaseResult` and
  `PlanBuildTestResult`, wired it through `planBuildTest.ts`'s outcome handling, and
  added two regression tests to `run.test.ts` (a real violation fails the phase; the
  no-violation path is unaffected) — neither existed before since every prior test
  config used `writes: null` (unrestricted), so this path had zero coverage.
- 2026-08-04 (claude): re-ran the live integration test myself after the fix (not
  just the non-live suite) to confirm the working plan→build→test path still passes
  end to end against the real server/model — 1 pass, 13.92s. Confirmed cleanup
  (scratch container dir removed, no lingering pi-web sessions) independently via SSH
  after my re-run, not just trusting the implementing pass's report of its own run.
- 2026-08-04 (claude): retry-on-parse-failure did not trigger during any live run —
  both `plan` and `build` returned valid JSON on the first attempt every time. The
  mechanism itself is proven via `run.test.ts`'s mocked retry/bounded-exhaustion
  tests, not the live run.

## Handoff notes
`runAgentPhase` (`modules/run.ts`) is the one place every future chain calls for an
agent-driven phase — genuinely generic, no plan/build-specific logic. `chains/
planBuildTest.ts` is the reference shape for M-067's CLI to wire up and for any future
chain (design doc mentions `buildReview.ts` etc. as later candidates) to copy. The
live integration test's `testCwd` parameter and its ssh/docker-exec bridging exist
only because this dev/test setup runs the factory process on a different machine than
the target project's `cwd` — the real deployment (M-068, factory baked into the
`jmfederico-pi-web` image itself) is co-located, so that bridge won't be needed there;
don't carry the pattern forward as if it's a permanent design feature.
