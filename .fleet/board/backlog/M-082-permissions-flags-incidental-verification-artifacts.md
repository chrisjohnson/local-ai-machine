---
id: M-082
title: pi-web-factory — permissions enforcement flags incidental verification artifacts (e.g. __pycache__) as violations
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-064, M-080]
---

# M-082 — pi-web-factory — permissions enforcement flags incidental verification artifacts (e.g. __pycache__) as violations

## Context
Found live, 2026-08-05, while triggering demo Workflow Runs for Chris to watch. A
`plan-build-review` run's `review` Step (Role `review`, `writes: none` — deliberately
read-only) failed with `PERMISSIONS-VIOLATION`. The actual violating "write" was
`__pycache__/stack.cpython-311.pyc` — a Python bytecode cache file, the automatic,
incidental side effect of the review agent legitimately running `python3` (or
importing the module) to actually verify the build's code works, not the agent
writing content it shouldn't. `permissions.ts`'s before/after git-diff snapshot
(M-064) correctly detected a new untracked file outside the Role's `writes:`
allowlist and rolled it back per its own design — working exactly as built, just
catching something that isn't really a violation in spirit.

This is a real, likely-recurring gap: any read-only Role (`review`, `scout`) that
verifies its work by actually *running* code (Python `__pycache__/`, Node.js
`node_modules/.cache`, compiled `.pyc`/`.class`/build-output directories, etc.) will
probably keep tripping this. Worth a real design decision, not a quick patch:
- A default global exemption list (à la `.gitignore` conventions) for well-known
  incidental-artifact patterns, applied regardless of a Role's own `writes:`?
- Or should `permissions.ts` respect the target repo's own `.gitignore` for
  determining what counts as a "real" write vs. incidental? (Careful: `.gitignore`
  is also just app-owned config, arguably no more trustworthy than `writes:` itself —
  and a repo without Python-aware `.gitignore` entries wouldn't be covered anyway.)
  {{Note the design doc/M-064's own decision log explicitly reasoned about
  `.gitignore` reliance for a DIFFERENT case — re-read that reasoning before
  reusing it here, it may or may not transfer.}}
- Or should read-only Roles' system prompts explicitly instruct them not to
  execute code that leaves artifacts, only read/analyze? (Weakest fix — asking a
  model not to run `python3 file.py` to check it works is asking it to verify less
  thoroughly, probably the wrong tradeoff.)
- Or accept this as correct, conservative-by-design behavior (better to occasionally
  false-flag a review Step than silently allow an unexpected write) and just make
  the failure message clearer about *what kind* of thing was written, so a human
  glancing at a failed run immediately understands "this was almost certainly
  harmless" rather than assuming real, unwanted content changed?

## Plan
<!-- not scoped yet — needs the design decision above first -->

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T04:25Z — filed from a live finding, not started -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): filed per AGENTS.md §2 (self-discovered issue → backlog/,
  flagged, not started). Real, reproduced live (adwId `adw_7a60e384248d`), not
  speculative — but which fix (if any) is a genuine design call.

## Handoff notes
Repro trace: `gate_fail:permissions` event, `{"item":"__pycache__/stack.cpython-311.pyc","ok":false,"note":"rolled back — outside writes allowlist"}`, on the `review` Step of a `plan-build-review` run whose task involved a Python file. Session/scratch repo already cleaned up as part of this session's other demo-run cleanup — re-derive a fresh repro rather than trusting old IDs.
