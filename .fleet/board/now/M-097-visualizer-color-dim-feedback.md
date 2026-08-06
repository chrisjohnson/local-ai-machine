---
id: M-097
title: visualizer pastel colors + dim completed cards
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-06T00:00Z
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-097 — visualizer pastel colors + dim completed cards

## Context
Chris's direct feedback on the visualizer, 2026-08-06:
- The fail/danger pastel reads "too pink" — wants more of a soft red.
- The success pastel reads "too blue/green" — wants slightly more soft green.
  Both should stay pastel, this is a subtle hue shift, not a new palette.
- Completed cards (success or fail) should get "a sort of dark shade over
  the entire card that makes it look visually inactive" — stronger/more
  visible than the current `opacity: 0.85` treatment.

Current values, `visualizer/src/style.css`:
- Light theme (`:root`): `--pi-success-border: #008c82`,
  `--pi-success-surface: #d7f0ec`, `--pi-danger-border: #b51d49`,
  `--pi-danger-surface: #fbe2ea`.
- Dark theme (`@media (prefers-color-scheme: dark)`):
  `--pi-success-border: #00f0d8`, `--pi-success-surface: #092d31`,
  `--pi-danger-border: #ff4f7b`, `--pi-danger-surface: #2a0f18`.
- `.run-card.run-card-success` / `.run-card.run-card-fail` (style.css:228-244)
  apply these as `background`/`border-color` with `opacity: 0.85` (`1` on
  hover) as the current "looks done" treatment — this is the dim mechanism
  Chris wants strengthened, not a second, separate thing.
- Same two surface vars are reused elsewhere (style.css:295, 299) — check
  those usages too so a hue tweak doesn't only apply to run-cards.

## Plan
1. [ ] Shift `--pi-danger-surface`/`--pi-danger-border` (both themes) toward a
   softer red, away from pink — small hue adjustment, keep pastel/dark-theme
   contrast intent intact.
2. [ ] Shift `--pi-success-surface`/`--pi-success-border` (both themes) toward
   a more saturated green, away from blue-green/teal — same, small shift.
3. [ ] Replace or augment the `opacity: 0.85` "done" treatment on
   `.run-card-success`/`.run-card-fail` with a real dark overlay (e.g. a
   `linear-gradient`/`box-shadow: inset` dark scrim, or an `::after` overlay)
   so completed cards read as visually inactive at a glance — keep the
   `:hover` restoring full visibility.
4. [ ] Rebuild the shared image and redeploy **only**
   `pi-web-factory-visualizer` (`docker compose build` then
   `docker compose up -d pi-web-factory-visualizer` on `local-ai-machine`) —
   do NOT recreate `jmfederico-pi-web` itself as part of this, other work may
   be mid-flight against that container.
5. [ ] Verify visually: headless Chrome screenshot of the visualizer showing
   at least one running, one success, and one fail card side by side.

## Signals
<!-- signal: claude 2026-08-06T00:00Z — claiming, direct Chris request, dispatching implement sub-agent -->

## Decision log
- 2026-08-06 (claude): filed directly from Chris's verbatim feedback; scoped
  and ready to implement, no open design questions.

## Handoff notes
Redeploy must be scoped to `pi-web-factory-visualizer` only, not
`jmfederico-pi-web` — a concurrent M-089 role-switch sub-agent was mid-flight
against `jmfederico-pi-web` around the time this was filed; avoid recreating
that container as a side effect of this card's own image rebuild.
