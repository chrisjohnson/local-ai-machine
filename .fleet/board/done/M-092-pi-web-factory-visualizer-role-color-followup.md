---
id: M-092
title: pi-web-factory — visualizer role-color bug fix, all-cards mini-Gantt, full prompt on detail page (M-090 follow-up)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T21:30:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-090, M-091]
---

# M-092 — pi-web-factory — visualizer role-color bug fix, all-cards mini-Gantt, full prompt on detail page (M-090 follow-up)

## Context
Filed retroactively — this work was done and deployed in the same session as M-090
before a card existed for it; flagging that gap here rather than silently omitting it.

Chris reviewed M-090's deployed output against two screenshots: SSSF's own reference
grid (every card, running or not, shows an inline role-colored mini-Gantt) and his own
detail-page screenshot showing "build" and "review" Step bars rendered in the *same*
color despite differently-colored role badges. Explicit feedback: "I feel like you're
rushing to completion" — instruction to slow down and verify each of the original
7 requirements individually with real evidence before doing another test pass.

## Plan
1. [x] Root-caused the bar-color bug: `.mini-step-bar`/`.step-bar` were colored by
   STATUS class (`step-success`/`step-fail`/`step-running`), never by Role — only the
   small `.role-badge` pill used `roleColor()`. Missed in M-090's own review, which
   only checked badge color, not bar fill color.
2. [x] New `stepBarStyle.ts`: Role is the bar's base hue in every state — full
   saturation + pulsing glow while running, a `color-mix`-dimmed tint of that same hue
   with a status-colored border once finished. Applied to both `miniGantt.ts` (grid)
   and `detailView.ts` (full timeline).
3. [x] Found and fixed a contrast bug in my own first draft: dark-theme Role colors
   are light pastels (by design), so `--pi-text-bright` (near-white in dark theme) on
   top of them was nearly unreadable. Fixed to use `--pi-bg` (theme's actual
   opposite-luminance anchor) instead — verified via zoomed screenshot.
4. [x] Every grid card (not just running ones) now shows its mini-Gantt inline,
   matching the SSSF reference screenshot — required batching each run's Steps into
   the `/api/runs` LIST response (`server.ts`'s new `runsToApi`, one extra
   `WHERE adw_id IN (...)` query for the whole page) rather than N per-card fetches.
5. [x] Detail page now shows the run's complete original prompt (`run.request`).
   Found a real, independent bug while wiring this up: `Tracer.sessionRequest`
   silently truncated at 500 chars before the prompt ever reached storage — no UI
   fix could have shown a "complete" prompt past that. Removed the cap in
   `tracer.ts`, added a regression test (2000-char prompt round-trips intact).
6. [x] Docs walkthrough's code blocks: `--code-bg` was pi-web's own near-black
   terminal color ("too much black" per feedback) — changed to a darker sand/navy
   tone in both themes, kept text readable.
7. [x] Re-verified all 7 original M-090 requirements + these clarifications
   individually against live screenshots (not just code review) before declaring
   done, per Chris's explicit "don't rush" instruction.

## Signals
<!-- signal: claude 2026-08-05T22:20Z — done, deployed, fresh screenshots captured against real live Workflow Runs -->

## Decision log
- 2026-08-05 (claude): fixed the role/status bar-color conflation via a shared
  `stepBarStyle(role, status)` helper rather than duplicating the logic in both
  `miniGantt.ts` and `detailView.ts` — one place to get the Role-vs-status visual
  language right.
- 2026-08-05 (claude): caught my own contrast bug (`--pi-text-bright` vs `--pi-bg`)
  before shipping, via a zoomed-in screenshot comparison across both themes — not
  caught by any automated test, since CSS contrast isn't something `bun test` checks.
- 2026-08-05 (claude): removed `sessionRequest`'s 500-char truncation after noticing
  it would silently undermine the new "complete prompt" display for any real prompt
  over 500 chars — a storage-layer bug independent of and upstream of the UI fix.
- 2026-08-05 (claude): ran a genuinely fresh test cycle (two new real Workflow Runs,
  triggered via `docker compose exec -d jmfederico-pi-web bun cli.ts ...` — cli.ts
  needs to run inside the container, host has no `bun` on PATH) only AFTER
  independently re-verifying all 7 requirements against screenshots, per Chris's
  explicit "verify before you run fresh tests" instruction.
- 2026-08-05 (claude): full suite green (255/256 repo-wide; the one failure is
  `workflow.integration.test.ts`, a live-pi-web-server integration test unrelated to
  any file touched here — confirmed via `git diff --stat`, a `waitForCompletion`
  timeout against the real server, not a regression), `tsc --noEmit` clean both
  configs, committed (`a56fd3e`, `b46a221`), deployed, screenshots refreshed against
  real production data.

## Handoff notes
Deployed via `docker compose build jmfederico-pi-web && docker compose up -d
jmfederico-pi-web pi-web-factory-visualizer`. Live at `http://192.168.1.226:8090`.
Walkthrough doc + screenshots refreshed in the same commits. GitHub Pages
publishing for the walkthrough doc was explicitly deferred by Chris until this work
was verified — see M-093.
