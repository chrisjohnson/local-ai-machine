---
id: M-075
title: pi-web-factory — global Roles config (agent + code, unified)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: [M-069, M-074]
status: null
related_cards: [M-065, M-070, M-074, M-076]
---

# M-075 — pi-web-factory — global Roles config (agent + code, unified)

## Context
`pi-web-adw-design.md` §7.1 (Role definition), §7.2 (config shape). Supersedes M-065's
`agents:` roster shape (M-065 itself stays `done`, unedited historical record — see
its own `related_cards` pointer to this card). Blocked on M-069 (need the real
system-prompt delivery mechanism before Roles can carry a real `system_prompt` field
meaningfully — no point adding the field before there's a way to honor it) and M-074
(the Role/Step vocabulary this config maps onto).

Two kinds of Role, one registry:
- **Agent Role** — model (`provider/model-id`, `config.ts`'s existing `ModelRef`
  bridge to `piwebClient.ts`'s `setModel`), thinking level, `writes:`, and now a real
  **system prompt** (M-069's mechanism, not M-066-era prepended text).
- **Code Role** — a name the factory's internal function registry resolves to an
  actual TS function (e.g. a Role named `run-tests` wires to `gates.ts`'s `testsPass`,
  parameterized by the calling project's M-070 config). No model/prompt fields at all.

Global, machine-wide — not per-project (same locality the roster always had; distinct
from M-070's project-local `test`/`typecheck`/`lint` settings).

## Plan
1. [ ] Define the YAML shape: one `roles:` list (or map), each entry `{name, kind:
   agent|code, ...kind-specific fields}`. Agent fields: today's `AgentConfig` shape
   (model, thinking, writes) plus `system_prompt` (M-069's field — a literal string,
   or a path to a `.md` file, implementer's call, but be consistent with how M-069's
   own extension actually expects to receive it). Code fields: just the internal
   function reference name — decide whether that's a free-text string resolved via a
   registry map in code, or something more structured; keep it simple, this doesn't
   need to be extensible beyond "name -> function" for now.
2. [ ] `modules/roles.ts` (or extend `config.ts` — implementer's call, but consider a
   separate file now that Roles are a bigger concept than the old `agents:` list):
   Zod schema + loader, `roleFor(name)` lookup throwing a specific error for an
   unknown name (same discipline every other lookup in this project already has).
3. [ ] A code-role registry: `{"run-tests": (project, cwd) => testsPass(project.test,
   cwd), ...}` or similar — the actual mapping from a code Role's name to a callable.
   Keep this small and explicit; don't build a plugin-loading mechanism for what's
   currently one entry.
4. [ ] Migrate the real `factory.config.yaml` roster to the new shape — same five
   agent identities (plan/build/review/scout/document) as Roles now, plus at least one
   real code Role (`run-tests`, wired to what `chains/planBuildTest.ts`'s "test" phase
   already does by hand today — M-076 is what actually rewires the runner to use this
   registry instead of that hand-written phase, but the config entry belongs here).
5. [ ] Tests: valid Roles config loads (both kinds); malformed agent Role (bad
   `provider/model-id`, same check M-065/`config.ts` already has) rejected; unknown
   code-role function reference rejected at load time, not first-use; `roleFor` throws
   a specific, actionable error for an unknown name.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
