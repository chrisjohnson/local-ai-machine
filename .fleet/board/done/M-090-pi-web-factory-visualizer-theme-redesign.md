---
id: M-090
title: pi-web-factory — visualizer redesign, match pi-web theme + SSSF-style live card grid
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T20:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-077, M-081, M-088]
---

# M-090 — pi-web-factory — visualizer redesign, match pi-web theme + SSSF-style live card grid

## Context
Chris, 2026-08-05, seven-part ask: match pi-web's own configured theme (font, spacing,
colors) exactly; real Workflow Run titles with ellipsis truncation instead of raw
adwId; restructure the main page from a plain list into a live-updating grid of cards
(SSSF's original layout), keeping the existing per-run detail drill-down; a specific
two-tier sort (running-oldest-first, then completed-newest-first); status-driven card
styling (red/green/dimmed/pulsing); persistent per-Role pastel colors in the same
visual family as pi-web's own splash colors; and explicit performance care (CSS-driven
animation, batched polling, not a CPU-heavy page).

Real pi-web theme values extracted directly from its own shipped JS bundle (not
guessed) — confirmed it ships 3 selectable presets (`pi-web-dark`, `pi-web-light`,
`classic`) and follows `prefers-color-scheme` via an "Auto" mode. Chris's own theme
picker screenshot showed "PI WEB Dark" as his selected preference but "PI WEB Light"
as currently active (his Mac's system light-mode + Auto) — decided (his call) to
support BOTH via `prefers-color-scheme`, matching pi-web's own behavior exactly,
rather than hardcoding one.

## Plan
1. [x] Extract and apply pi-web's real Light/Dark theme values + font stacks.
2. [x] Real title display: `title → request → adwId` fallback chain (display-only,
   `sessions.title` itself still isn't populated upstream — separate, later work).
3. [x] Main page restructured into a responsive live-updating card grid
   (`listView.ts`), detail drill-down (`detailView.ts`) kept and re-themed.
4. [x] Exact two-tier sort algorithm (`sortRuns.ts`), unit-tested including edge
   cases (ties, missing `endedAt`, empty list).
5. [x] Status-driven card styling: pulsing glow (CSS `@keyframes` on `box-shadow`,
   `--pi-accent`) while running; tinted + `opacity: 0.85` once success/fail.
6. [x] Six-color Role palette (`roleColor.ts`), same visual family as pi-web's
   purple, distinct from the three status colors, applied consistently in the grid's
   mini-Gantt and the detail page's Step badges/timeline.
7. [x] Performance: one outer poll drives the whole grid; only currently-`running`
   cards get their own (bounded, capped at `MAX_LIVE_MINI_GANTT_CARDS`) per-card poll
   cycle; all animation is pure CSS, no `requestAnimationFrame`/per-frame JS.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T20:45Z — done, one real bug found+fixed in review, deployed -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): delegated the implementation to an Implement sub-agent with a
  fully-specified brief (exact hex values, exact algorithms, explicit performance
  constraints) — no ambiguity left for the agent to guess on the parts that mattered.
- 2026-08-05 (claude, independent review): verified every theme/role hex value in the
  committed CSS against the spec byte-for-byte (all exact matches), read
  `sortRuns.ts`/`roleColor.ts`/`runTitle.ts`/`miniGantt.ts` in full, confirmed
  `miniGantt.ts` genuinely reuses `gantt.ts`'s `computeGanttLayout` rather than
  forking the layout math.
- 2026-08-05 (claude, independent review): **found a real, live-confirmed bug** the
  sub-agent's own (extensive) testing missed — the outer grid's `innerHTML` rebuild
  every `POLL_INTERVAL_MS` always creates fresh DOM nodes (browsers never diff/reuse
  on an `innerHTML` write), but the code only attached a `RunningCardController` to a
  NEWLY-appearing running run, silently skipping re-attachment for a run that was
  already being tracked — leaving that controller updating a now-detached, invisible
  DOM node forever after the first outer tick. Confirmed via headless Chrome
  `--virtual-time-budget` (deterministically advancing virtual time so timers/polls
  actually fire, since `--dump-dom` alone fires before any async JS resolves):
  compared the rendered DOM at 1s vs 9.5s vs 17s — the running card's content
  genuinely went from populated to completely empty and stayed empty. Fixed with a
  `rebindCardEl()` method, called on every outer tick for every still-live
  controller (not just new ones), which re-targets `cardEl` and repaints immediately
  — re-verified the same way afterward, including confirming the mini-Gantt bar's
  width was genuinely still growing (live data), not just frozen-but-present.
  Root-caused this specifically because a single point-in-time screenshot (the
  sub-agent's own verification method) can't reveal a "breaks after the SECOND poll
  tick" class of bug — worth remembering for future DOM-polling-architecture review.
- 2026-08-05 (claude): full suite (245 tests, up from 224), `tsc --noEmit` clean
  (both configs), committed, deployed to the live compose service.

## Handoff notes
Commit `6eec020` on `main`, deployed via `docker compose build/up
pi-web-factory-visualizer`. Live at `http://192.168.1.226:8090`. `sessions.title`
itself is still never populated upstream (the visualizer's `runTitle()` fallback to
`request` covers this at the display layer only) — real title population at Workflow
Run start time is separate, not-yet-done work, flagged again here since it's directly
relevant to how good this page looks with real data.
