---
id: M-065
title: pi-web-factory — factory.config.yaml schema + config.ts loader
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-061, M-062, M-063, M-064, M-066, M-067, M-068]
---

# M-065 — pi-web-factory — factory.config.yaml schema + config.ts loader

## Context
Ports SSSF's `sssf.config.yaml` roster concept (agent identity → model/thinking/
prompts/tools/writes — see `pi-web-adw-design.md` §1.1) but adds what a *shared,
multi-project* factory needs that a per-repo one didn't: per-project settings, starting
with quality-gate commands (SSSF's `quality.py` is hand-edited per repo; this factory
can't hardcode one repo's test command since it targets N projects — see design doc §4).

Model values point at pi-web's already-seeded `local-litellm` provider — confirmed in
`jmfederico-pi-web/models.seed.json.tmpl` that `big-moe`, `medium-moe`, and the
`-continue-json` variants are already valid model IDs there, zero new litellm plumbing
needed for the roster itself.

## Plan
1. [ ] Define the YAML shape: top-level `defaults` (model/thinking/protected_files),
   `agents:` list (name, model role e.g. `local-litellm/big-moe`, thinking, prompts,
   `writes:`), and a new `projects:` map keyed by absolute path with per-project
   overrides (at minimum: test command, lint command — whatever M-063's `tests_pass`
   gate needs).
2. [ ] `modules/config.ts`: load + Zod-validate. Mirror SSSF's own sharp edge
   deliberately: validate that a model string is well-formed (`provider/model-id`), not
   that it's reachable — but log that limitation in a comment, since SSSF's README
   calls out this exact failure mode (a stale/renamed litellm role fails silently
   mid-chain, not at startup) and this box has already been bitten by a role rename
   once (`coder`→`medium-moe`, 2026-08-03).
3. [ ] Ship a starter `factory.config.yaml` with a roster mapped to this box's real
   roles (`big-moe`/`medium-moe`) and one real project's quality commands as a worked
   example — don't ship a fictional starter roster the way stock SSSF does.
4. [ ] Unit tests: valid config loads; malformed `provider/model-id` rejected at load
   time; unknown project path in a `WorkItem` produces a clear error, not a silent
   fallback to some default.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
