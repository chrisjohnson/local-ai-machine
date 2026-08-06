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
2. [ ] Make `chrisjohnson/local-ai-machine` public.
3. [ ] Add a GitHub Actions workflow that publishes `docs/` (or a `gh-pages` branch
   built from it) on push to `main`.
4. [ ] Enable GitHub Pages for the repo, pointed at that workflow's output.
5. [ ] Verify the walkthrough doc + its screenshots actually render correctly at the
   published Pages URL (not just that the workflow succeeded).

## Signals
<!-- signal: claude 2026-08-05T23:05Z — claiming, starting now -->

## Decision log
- 2026-08-05 (claude): filed this card retroactively-but-in-now/ since it's work
  Chris just explicitly directed ("proceed") — §2's human-request-is-the-promotion
  rule, not a backlog pull.

## Handoff notes
Nothing done yet beyond the safety check. Repo currently PRIVATE, no
`.github/workflows/` directory exists yet.
