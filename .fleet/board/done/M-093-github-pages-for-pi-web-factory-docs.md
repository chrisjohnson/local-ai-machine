---
id: M-093
title: Publish pi-web-factory walkthrough docs to GitHub Pages
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T23:05:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-090, M-092]
---

# M-093 — Publish pi-web-factory walkthrough docs to GitHub Pages

## Context
Chris wants to link people to the `docs/pi-web-factory-walkthrough-*.html` dashboard
directly, rather than sharing a raw file. Explicitly deferred until the visualizer
redesign (M-090/M-092) was fully verified — "I did say WHEN YOU'RE DONE... spend the
majority of your attention completing the visualizer changes now, then circle back to
that other stuff later." That's done now (M-092), so this is next.

Chris confirmed: make the repo public. Before doing that, a hard safety requirement:
confirm `docker/.env` (holds `LITELLM_MASTER_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
`GH_TOKEN`) has never been committed to git history — completed 2026-08-05, clean
(`.gitignore` covers it, `git log --all --full-history` for any `.env` file and for
the raw secret-value patterns both came back empty except placeholder/`process.env`
references).

## Plan
1. [x] Safety check: confirm no real secrets in git history before going public.
2. [x] Make `chrisjohnson/local-ai-machine` public.
3. [x] Add a GitHub Actions workflow that publishes `docs/` to a `gh-pages` branch
   on push to `main` (`.github/workflows/pages.yml`) — plain git commands, no
   third-party Actions, since the repo just went public. Also generates an
   `index.html` listing every `.html` doc (there were already 8 with no index).
4. [x] Enable GitHub Pages for the repo (`gh-pages` branch, root) via the REST API.
5. [x] Verified live, not just "workflow succeeded": fetched the Pages index (200),
   the walkthrough page (200), and a screenshot image referenced from it (200,
   real PNG data, correct dimensions) — then a full headless-Chrome screenshot of
   the actual published URL to confirm it renders correctly end-to-end, including
   images, under the `/local-ai-machine/` project-site subpath (checked in advance
   that the walkthrough HTML uses only relative paths, so the subpath wouldn't
   break image/link resolution).

## Signals
<!-- signal: claude 2026-08-05T23:05Z — claiming, starting now -->
<!-- signal: claude 2026-08-05T22:28Z — done, verified live at https://chrisjohnson.github.io/local-ai-machine/ -->

## Decision log
- 2026-08-05 (claude): filed this card retroactively-but-in-now/ since it's work
  Chris just explicitly directed ("proceed") — §2's human-request-is-the-promotion
  rule, not a backlog pull.
- 2026-08-05 (claude): chose plain git (checkout/worktree/push) over a third-party
  gh-pages Action — the repo just went public, no reason to add external
  supply-chain surface for a job this simple.
- 2026-08-05 (claude): repo's default Actions token permission is read-only
  (checked via `gh api .../actions/permissions/workflow`) — left that repo-wide
  default alone and used the workflow's own `permissions: contents: write` block
  to scope the elevation to just this one job, rather than loosening the default
  for every future workflow.

## Handoff notes
Live at https://chrisjohnson.github.io/local-ai-machine/ — commit `caf5753`
(workflow), first `gh-pages` publish from the same commit, Pages enabled via
`gh api -X POST .../pages`. Re-runs automatically on any future push to `main`
that touches `docs/**`.
