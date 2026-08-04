---
id: M-067
title: pi-web-factory — cli.ts entrypoint
initiative_id: null
claimed_by: null
claimed_at: null
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
1. [ ] `cli.ts`: parse `--project`, `--chain`, `--session-id` (optional), and a
   positional prompt-or-path argument (same convention as SSSF's own ADW invocation).
2. [ ] Wire to the chain registry from M-066; clear error (not a stack trace) for an
   unknown `--chain` name or a `--project` path `config.ts` (M-065) doesn't recognize.
3. [ ] Print the minted `adw_id`/session id on start, same as SSSF does, so a human can
   immediately go find it in `factory.db` or (once M-068 lands) open it in pi-web's own
   browser UI.
4. [ ] Manual smoke test: invoke a real chain against a real project directory from the
   command line, confirm it behaves identically to calling the chain function directly
   (i.e. the CLI is a thin wrapper, not where any real logic lives).

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
