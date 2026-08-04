---
id: M-063
title: pi-web-factory — envelopes.ts (Zod) + gates.ts
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T04:36:20Z
blocks: null
blocked_by: null
status: null
related_cards: [M-061, M-062, M-064, M-065, M-066, M-067, M-068, M-069]
---

# M-063 — pi-web-factory — envelopes.ts (Zod) + gates.ts

## Context
Ports SSSF's typed-envelope + gate-verification pattern (see `pi-web-adw-design.md`
§1.1 "Core primitives worth keeping conceptually," and SSSF's own
`templates/adws/adw_modules/data_types.py` /
`.claude/skills/sssf/templates/prompt_engineering/*/user.md` in
`~/src/super-simple-software-factory` for the reference shapes: `EnvelopeBase`
(`status`, `summary`, `artifacts`, `notes_for_next_agent`), plus per-phase subclasses
like `PlanOutput`/`BuildOutput`). Read those files directly before writing the Zod
schemas — don't reinvent the field names from memory of the README alone.

**The synced-triad rule carries over**: the Zod schema, the `## Report` JSON example
in whatever prompt template asks the agent for it, and the parse call site must describe
the same shape. Changing one means changing all three in the same edit — call this out
in the module's own comments so it isn't lost on the TS side.

Gates verify claims *after* the fact against the envelope's own declarations
(`artifacts_exist`, `files_non_empty`, `tests_pass(...)`), never predictions — same
contract as SSSF's `gates.py`. A gate is `(envelope, runContext) -> GateReport` with one
`{item, ok, note}` check per thing examined.

## Plan
1. [x] Read SSSF's `data_types.py` and at least one `user.md` `## Report` example
   directly, not from memory of the earlier README summary.
2. [x] `modules/envelopes.ts` — `EnvelopeBase` Zod schema + subclasses for each phase
   kind the initial chains (M-066) will need: plan, build, review, scout, document.
3. [x] `modules/gates.ts` — port `artifacts_exist`, `files_non_empty`, `json_parses`,
   `diff_matches_claims`, `tests_pass(cmd)` (the last one takes a command string, since
   M-065's per-project config supplies it — no hardcoded test command here).
4. [x] Unit tests: a well-formed envelope passes its gates; a claimed-but-missing
   artifact fails `artifacts_exist` with a specific, inspectable violation (not just a
   boolean).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:36Z — claiming, starting envelopes.ts + gates.ts -->
<!-- signal: claude 2026-08-04T05:20Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): two envelope types upstream defines (`ChangesOutput`,
  `VerifyOutput`) deliberately not ported — they wrap upstream's own
  quality.py/documentation.capture() machinery, which has no port in this codebase.
  Add only when a chain actually needs them.
- 2026-08-04 (claude): upstream's `verdict_consistent` gate (checks a review's
  `approved` verdict agrees with its `findings`/`blocking`) also not ported — this
  card's own Plan enumerated five specific gates and it wasn't one of them. Caught in
  review: the implementing pass left a comment claiming it was "ported below," which
  wasn't true (grepped `gates.py` and confirmed it's real, at line 71) — fixed the
  comment to correctly describe it as unported, candidate for M-066 (first review
  chain) rather than silently adding a sixth gate beyond what was asked.
- 2026-08-04 (claude): `diffMatchesClaims` extends upstream's one-directional check
  (claimed-but-unchanged) with the reverse direction too (changed-but-unclaimed,
  prefixed `unclaimed:`) — a deliberate, documented addition, not a deviation by
  accident: an unmentioned side effect is exactly the kind of claim-vs-reality
  mismatch this gate exists to catch.
- 2026-08-04 (claude): verified independently before committing — reran `bun install`,
  `tsc --noEmit` (clean), and the full non-live test suite myself (35 pass, 89
  expect() calls across envelopes/gates/tracer/piwebClient unit tests).

## Handoff notes
`envelopeSchemas` (keyed by `plan`/`build`/`review`/`scout`/`document`) and the five
gate functions are what M-066's chains will import directly. `gates.ts` reuses
`tracer.ts`'s `GateCheck`/`GateReport` types rather than redefining them, so gate
results can flow straight into `Tracer.gateRow`/`.event({type:"gate_pass"|...})`
without a cast. `testsPass`'s command comes from M-065's per-project config, not
hardcoded here.
