---
id: M-063
title: pi-web-factory — envelopes.ts (Zod) + gates.ts
initiative_id: null
claimed_by: null
claimed_at: null
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
1. [ ] Read SSSF's `data_types.py` and at least one `user.md` `## Report` example
   directly, not from memory of the earlier README summary.
2. [ ] `modules/envelopes.ts` — `EnvelopeBase` Zod schema + subclasses for each phase
   kind the initial chains (M-066) will need: plan, build, review, scout, document.
3. [ ] `modules/gates.ts` — port `artifacts_exist`, `files_non_empty`, `json_parses`,
   `diff_matches_claims`, `tests_pass(cmd)` (the last one takes a command string, since
   M-065's per-project config supplies it — no hardcoded test command here).
4. [ ] Unit tests: a well-formed envelope passes its gates; a claimed-but-missing
   artifact fails `artifacts_exist` with a specific, inspectable violation (not just a
   boolean).

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
