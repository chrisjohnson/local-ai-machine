---
id: M-065
title: pi-web-factory — factory.config.yaml schema + config.ts loader
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-04T04:50:04Z
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
1. [x] Define the YAML shape: top-level `defaults` (model/thinking/protected_files),
   `agents:` list (name, model role e.g. `local-litellm/big-moe`, thinking, prompts,
   `writes:`), and a new `projects:` map keyed by absolute path with per-project
   overrides (at minimum: test command, lint command — whatever M-063's `tests_pass`
   gate needs).
2. [x] `modules/config.ts`: load + Zod-validate. Mirror SSSF's own sharp edge
   deliberately: validate that a model string is well-formed (`provider/model-id`), not
   that it's reachable — but log that limitation in a comment, since SSSF's README
   calls out this exact failure mode (a stale/renamed litellm role fails silently
   mid-chain, not at startup) and this box has already been bitten by a role rename
   once (`coder`→`medium-moe`, 2026-08-03).
3. [x] Ship a starter `factory.config.yaml` with a roster mapped to this box's real
   roles (`big-moe`/`medium-moe`) and one real project's quality commands as a worked
   example — don't ship a fictional starter roster the way stock SSSF does.
4. [x] Unit tests: valid config loads; malformed `provider/model-id` rejected at load
   time; unknown project path in a `WorkItem` produces a clear error, not a silent
   fallback to some default.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T04:50Z — claiming, starting factory.config.yaml + config.ts -->
<!-- signal: claude 2026-08-04T05:20Z — done, config.ts + factory.config.yaml + tests all pass, tsc clean -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- Roster identity names match `envelopes.ts`'s `envelopeSchemas` registry keys exactly
  (`plan`, `build`, `review`, `scout`, `document`), not upstream SSSF's
  `planner`/`builder`/`reviewer`/`documenter` names, since those are the names M-066 will
  actually dispatch on.
- `plan`/`review` get `local-litellm/big-moe`; `build`/`scout`/`document` get
  `local-litellm/medium-moe` — reasoning in `factory.config.yaml`'s own comment: the two
  judgment-heavy, hard-to-cheaply-verify phases get the stronger model, the three more
  mechanical/higher-volume phases share medium-moe.
- Bridged the `provider/model-id` string -> `piwebClient.ts`'s two-parameter `setModel`
  by splitting ONCE at config-load time (`parseModelRef`), not per call site: every
  loaded `AgentConfig`/`defaults` exposes both the raw string (`model`, for
  logging/tracing) and the split form (`modelRef: {provider, modelId}`, feeds directly
  into `setModel(baseUrl, sessionId, modelRef.provider, modelRef.modelId)`).
- `printer-dashboard`'s `projects:` entry omits `lint` entirely (real repo has no lint
  script) rather than inventing one; `test` uses `npx playwright test`, `typecheck` uses
  `npx tsc --noEmit` since `typescript` is a real devDependency without a wrapping
  script.
- Added `yaml` as a new dependency (`bun add yaml`), same pattern as `envelopes.ts`
  adding `zod` — no YAML parser was already present.
- `protected_files` defaults list uses this project's real directory names
  (`modules/`, `factory.config.yaml`, `factory.db`, `chains/`, `cli.ts`) as the
  analogue of upstream's `adw_modules/`/`adw_sssf_config/` self-protection.

## Handoff notes
`modules/config.ts` exports `loadConfig`/`loadConfigFromString`, `agentConfigFor`,
`projectConfigFor`, `parseModelRef`, and the `FactoryConfig`/`AgentConfig`/
`ProjectConfig`/`ModelRef` types — everything M-066 should need to wire the roster into
`chains/` without re-parsing strings itself. `bun test` (81 pass, 28 in
`config.test.ts`) and `bunx tsc --noEmit` (clean) both verified from inside
`pi-web-factory/`. No existing module touched.
