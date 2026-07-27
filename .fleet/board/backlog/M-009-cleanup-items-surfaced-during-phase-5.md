---
id: M-009
title: Cleanup items surfaced during Phase 5 work
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-005]
---

# M-009 — Cleanup items surfaced along the way

## Context

Ported from README.md §8 Phase 5, Task 5.7 (2026-07-26). Low priority,
opportunistic — do when convenient, not a blocker.

**Re-checked as part of this porting pass (2026-07-26): the orphaned
`qwen3-coder-next-fp8` download README originally flagged is no longer on
disk.** `ssh local-ai-machine 'ls /var/lib/ai-models/'` shows no `fp8`-suffixed
entry (only `qwen3-coder-next-gptq4bit` remains, which is a different,
intentional build), and `configuration.nix` has no `fp8` model entry either
— only a comment noting `amd/gpt-oss-120b-w-mxfp4-a-fp8` was deliberately
disqualified/never downloaded. **This specific item is stale** — either it
was cleaned up already or README's description no longer matches disk
state. Don't port it verbatim as still-true; this card exists for the
general "sweep for stale/orphaned downloads" habit, not this one specific
already-resolved file.

## Plan
<!-- ordered checklist -->
1. [ ] Do a fresh sweep of `/var/lib/ai-models/` against `configuration.nix`'s
   declared `models` list — flag anything on disk with no corresponding
   declared entry (orphaned) and anything declared but never completed.
2. [ ] Remove or account for anything found stale; note the removal here.
3. [ ] Repeat opportunistically as Phase 5 work continues — this card can
   stay open as a standing low-priority sweep rather than being treated as
   one-shot.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 5, Task 5.7 into a fleet
  card during the fleet-bootstrap backlog migration. Verified via SSH
  (`ls /var/lib/ai-models/`) and `configuration.nix` that the specific
  `qwen3-coder-next-fp8` orphan README named is no longer present — README's
  framing was stale as of this check, so the card is worded as a general
  sweep habit instead of restating a resolved finding as current.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started as a fleet card. The one specific item README flagged
(`qwen3-coder-next-fp8`) is already gone — next agent should do a fresh
disk-vs-`configuration.nix` sweep rather than assuming there's nothing left
to check.
