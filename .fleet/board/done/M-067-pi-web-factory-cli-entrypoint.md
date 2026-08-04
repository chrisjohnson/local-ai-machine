---
id: M-067
title: pi-web-factory — cli.ts entrypoint
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T05:15:32Z
blocks: null
blocked_by: [M-066]
status: null
related_cards: [M-061, M-062, M-063, M-064, M-065, M-066, M-068]
---

# M-067 — pi-web-factory — cli.ts entrypoint

## Context
The manually-triggered entrypoint (design doc §0 point 2, §3.4) — `factory run
--project <abs-path> --chain <name> [--session-id <id>] "<prompt or path/to/
prompt.md>"`. Its argument shape IS the `WorkItem` shape from §3.4, on purpose: this is
the seam a future `.fleet`-lite ticket worker will call through unchanged (as a library
function or a re-exec of this same CLI) once that queue layer exists — don't let this
card's design drift from that shape without updating §3.4 to match.

## Plan
1. [x] `cli.ts`: parse `--project`, `--chain`, `--session-id` (optional), and a
   positional prompt-or-path argument (same convention as SSSF's own ADW invocation).
2. [x] Wire to the chain registry from M-066; clear error (not a stack trace) for an
   unknown `--chain` name or a `--project` path `config.ts` (M-065) doesn't recognize.
3. [x] Print the minted `adw_id`/session id on start, same as SSSF does, so a human can
   immediately go find it in `factory.db` or (once M-068 lands) open it in pi-web's own
   browser UI.
4. [x] Manual smoke test: invoke a real chain against a real project directory from the
   command line, confirm it behaves identically to calling the chain function directly
   (i.e. the CLI is a thin wrapper, not where any real logic lives).

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T05:15Z — claiming, starting cli.ts -->
<!-- signal: claude 2026-08-04T05:55Z — done, moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): `--session-id` required extending `planBuildTest.ts` with an
  optional `sessionId` (skip `startSession`, reuse the given id directly) — the only
  authorized change to an existing chain file for this card, kept small.
- 2026-08-04 (claude): `PI_WEB_FACTORY_CONFIG`/`PI_WEB_FACTORY_TEST_CWD` env vars are
  dev-only escape hatches (not documented flags, not part of the `WorkItem` shape) —
  needed because the real `factory.config.yaml`'s `projects:` map only has
  `printer-dashboard`, and the dev/test setup runs `cli.ts` on a different machine
  than the target project's `cwd`. The real deployment (M-068) won't need either.
- 2026-08-04 (claude): verified independently before committing, not just the
  implementing pass's report — reran the full suite (110 pass) and `tsc --noEmit`
  myself, exercised both error paths (unknown `--project`, unknown `--chain`) directly
  from the command line, and ran one full live CLI invocation myself (a genuinely
  different code path than the automated tests cover, since `cli.test.ts` deliberately
  stays off the live server) against a real scratch project + model, independently
  confirming the exit code, the file landing on the box, and `factory.db`'s rows via a
  raw query — not just trusting stdout.
- 2026-08-04 (claude): cleaned up three scratch pi-web sessions the implementing pass
  couldn't (no confirmed delete-endpoint cwd at the time) — found the correct `cwd`
  via `GET /sessions?cwd=...` trial rather than guessing further, archived+deleted all
  three, confirmed zero remaining. `.gitignore` extended for `factory.db*`, which a
  real `cli.ts` run creates as untracked runtime state (matches upstream SSSF's own
  convention) — the implementing pass's smoke test had left these untracked in the
  working tree.

## Handoff notes
`bun cli.ts --project <path> --chain plan-build-test "<prompt>"` is the real,
verified-working entrypoint now. `chains/registry.ts`'s `chainRegistry` map is where
M-068 (or any future chain) registers. Exit codes: 0 success, 1 failed, 2
blocked-on-human, 3 unparseable, 4 permissions-violation, 64 usage/config error.
