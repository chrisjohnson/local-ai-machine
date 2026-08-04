---
id: M-070
title: pi-web-factory — move per-project config into the target project's own repo
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T20:45:31Z
blocks: null
blocked_by: null
status: null
related_cards: [M-065, M-066, M-067, M-071]
---

# M-070 — pi-web-factory — move per-project config into the target project's own repo

## Context
Supersedes part of M-065 (`done` — left as-is, not edited; this card is the recorded
change, not a retroactive rewrite of that history). Chris's feedback 2026-08-04: he
wants per-project config (today: `factory.config.yaml`'s centralized `projects:` map)
to live IN each target project's own repo instead — same place the future durable
ticket storage will also live (a project gets its own `.fleet`-lite board, mirroring
how this very repo has `.fleet/board/`).

Researched and ruled out pi-web's own Project concept for this (`pi-web-adw-design.md`
§6.2/§6.3): `<project>/.pi-web/config.json` is real but closed-schema
(`{version?, pathAccess?, uploads?}`, unknown keys dropped on parse) — not usable as
an extension point. Confirmed instead: pi-web-factory should read its own file, by
simple path convention, with zero interaction with pi-web's Project registry (that
registry is still used, for an unrelated reason — see M-071).

## Plan
1. [x] Decide and document the file name/format (leading candidate: `.pi-web-
   factory.yaml` at the project root — same directory a future ticket board would
   live alongside, e.g. `.pi-web-factory/board/` mirroring `.fleet/board/`). Keep the
   schema minimal: `test`/`typecheck`/`lint` commands, matching today's
   `ProjectConfig` shape in `modules/config.ts` — don't expand scope beyond what
   `gates.ts`'s `testsPass` actually needs.
2. [x] `modules/config.ts`: replace `projectConfigFor`'s centralized-map lookup with
   a function that reads the project-local file by path (`<cwd>/.pi-web-factory.yaml`
   or whatever name is chosen), still throwing a specific `ConfigError` (not falling
   back silently) when the file is missing or malformed — same discipline as today's
   `projectConfigFor`, just a different source.
3. [x] Remove `factory.config.yaml`'s `projects:` map and its schema (`RawFactory
   ConfigSchema`'s `projects` field, `ProjectEntrySchema`) — `factory.config.yaml`
   keeps only the agent roster (`defaults`, `agents`) going forward, which is
   genuinely pi-web-factory's own config, not any one project's.
4. [x] Update `cli.ts`'s config-loading step accordingly (it currently calls
   `projectConfigFor(config, args.project)` against the centralized map).
5. [x] Add `.pi-web-factory.yaml` (or the chosen name) to `printer-dashboard`'s own
   repo as the real worked example, replacing the entry that currently lives in
   `pi-web-factory/factory.config.yaml`'s `projects:` map — same honest-commands
   discipline M-065 used (no fabricated lint command).
6. [x] Update tests: `config.test.ts`'s project-lookup tests move from synthetic
   `projects:` map entries to synthetic project-local files (temp dir fixtures,
   matching the project's established real-filesystem testing style).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T20:45Z — claiming, starting project-local config lookup -->
<!-- signal: claude 2026-08-04T21:15Z — printer-dashboard's .pi-web-factory.yaml landed via PR (github.com/chrisjohnson/printer-dashboard#30), includes real go test/go vet commands (project is Go, not pure JS/TS as first assumed) -->
<!-- signal: claude 2026-08-04T21:50Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): `printer-dashboard` uses branch+PR, not this repo's direct-push
  override — two PRs opened there: #29 for pre-existing, already-committed AMS fixes
  that were sitting on a pushed branch with no PR yet (found mid-task, unrelated to
  M-070, handled per Chris's explicit instruction), and #30 for the actual
  `.pi-web-factory.yaml` addition. Confirmed the project is Go (38 real `*_test.go`
  files, `go.mod`) with a Playwright/TS e2e harness on top, not pure JS/TS as the old
  centralized `factory.config.yaml` entry assumed — `test`/`typecheck` commands cover
  both halves (`go test ./... && npx playwright test` / `go vet ./... && npx tsc
  --noEmit`), `lint` genuinely omitted (checked for a Go linter config too, none
  exists).
- 2026-08-04 (claude): `projectConfigFor` dropped its `FactoryConfig` parameter
  entirely — project-local lookup never needed the roster, and threading an unused
  param through was judged more disruptive than updating the one call site
  (`cli.ts`). Confirmed this is a clean, well-justified simplification, not scope
  creep.
- 2026-08-04 (claude): one live integration test failure hit during review —
  investigated rather than dismissed. Confirmed via diff review this card's only
  change to a live-execution-adjacent file (`chains/planBuildTest.ts`) was a single
  doc-comment line; confirmed the model backend itself responds fine to a direct
  request (7.4s); confirmed via `/status` and `/abort` that the session's own agent
  turn was genuinely stuck (`isStreaming` stayed `true` until an explicit abort
  released it), not merely slow — a real but transient live-environment issue after
  a long testing session, unrelated to this diff. Retried clean twice after cleanup.
  Left one stray aborted-but-not-archived scratch session in place per Chris's
  explicit "just leave it" — did not clean it up myself since I hadn't tracked its
  id as created directly by me in this task (the AGENTS.md hard-stop's stricter
  reading, correctly enforced by the auto-mode classifier).

## Handoff notes
`projectConfigFor(absolutePath)` (no `FactoryConfig` param) is what M-071/M-072/M-076
should call going forward. `PROJECT_CONFIG_FILENAME` (`.pi-web-factory.yaml`) is
exported from `config.ts` for anything that needs the literal filename. A stray
aborted pi-web session (`019fce96-9650-760d-b3ef-d52f27a2ead6`, cwd `/tmp/pi-web-
factory-m066-test`) was deliberately left un-cleaned-up per Chris's instruction —
whoever picks up the next card touching live sessions should know it's there,
harmless (aborted, not streaming) but not archived/deleted.
