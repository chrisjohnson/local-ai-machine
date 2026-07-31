---
id: M-042
title: Adopt pi-loop-police for repeat/thinking-loop detection
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T18:56:28Z
blocks: null
blocked_by: null
status: null
related_cards: [M-040, M-041, M-045]
---

# M-042 — Adopt pi-loop-police for repeat/thinking-loop detection

## Context
First concrete implementation of the pattern researched in M-041, picking
up the specific guardrail that started this whole line of investigation: a
session stuck re-verifying/re-attempting the same thing via trivially-
varied actions, the exact failure mode Turnstone's own byte-literal
`RepeatDetector` missed (found live, earlier this session, in the printer-
dashboard workstream).

**Scope pivot from the original plan**: before building a judge-model-
based detector from scratch (M-041's design), Chris asked that we check
for prior art first ("don't reinvent the wheel"). That search found
`pi-loop-police` (github.com/sebaxzero/pi-loop-police, npm
`pi-loop-police@1.14.0`) - a real, actively-maintained pi extension with
ten statistical loop/stagnation detectors (Jaccard cross-turn similarity,
tool-call-sequence hashing, redundant-re-read tracking, file-scan
ceilings, etc.), entirely local/statistical - no external model call, no
added latency. Its cross-turn stagnation and redundant-re-read detectors
are a close match for the original incident's shape.

This card is now scoped to adopting that tool. The one real gap it can't
cover (a repeat phrased with genuinely different vocabulary - e.g. "check
disk space" vs. "how much storage is free", near-zero word overlap) is
covered by a separate judge-model-based extension, tracked as its own
follow-on card (**M-045**, `semantic-repeat-guard`) rather than folded in
here, since it's a materially different mechanism (external model call vs.
pure statistics) with its own real bugs/fixes worth their own record.

## Plan
1. [x] Installed `pi-loop-police@1.14.0` via the same idempotent,
   version-pinned entrypoint pattern already used for `pi-claude-bridge`/
   `@juicesharp/rpiv-web-tools` (`pi-web/docker-entrypoint.sh`) - npm
   install into `$PI_CODING_AGENT_DIR/npm`, additive registration in
   `settings.json`'s `packages` array. No Dockerfile change needed.
2. [x] Shipped with default config (all ten detectors enabled) - it's
   live-tunable via `/loop-police set KEY=VAL` inside any session without
   a redeploy, so there was no reason to pre-guess tuning for a first pass.
3. [x] Verified for real, not just "container started": ran a real test
   session (`pi -p --provider local-litellm --model coder`, same
   `PI_CODING_AGENT_DIR` pi-web uses) asking the `coder` model to run the
   same disk-space check five ways, including one literal repeat. Real
   result: `**Loop detector blocked** — identical tool call repeated`
   was injected as call #2's tool result, confirmed pi-loop-police is
   loaded and actively intervening.

## Signals
<!-- signal: claude 2026-07-31T18:56Z — claiming, pivoting scope after community-research finding -->
<!-- signal: claude 2026-07-31T19:20Z — done, pi-loop-police installed and verified live; judge-based gap tracked separately as M-045 -->

## Decision log
- Original plan (build a custom judge-based detector from scratch,
  per M-041's design) was correct as far as it went, but skipped the
  "check for prior art" step - Chris caught this explicitly. Real,
  published, actively-maintained tooling already existed and covers most
  of the target incident's shape for free (no judge-model latency/
  contention cost at all). M-041's research/design work isn't wasted -
  it's exactly what M-045 (the vocabulary-different-repeat layer) builds
  on, since pi-loop-police's Jaccard-based approach can't reach that case
  by construction.
- Split into two cards rather than one, once the scope doubled (adopt
  existing tool + still build the judge layer) - each mechanism has its
  own real bugs/fixes worth their own decision log, not worth conflating.

## Handoff notes
Done. `pi-loop-police` is live in `pi-web` with default config, confirmed
blocking a real literal repeat in a live test session. See M-045 for the
judge-model-based semantic-repeat-guard extension that covers what this
tool structurally can't.
