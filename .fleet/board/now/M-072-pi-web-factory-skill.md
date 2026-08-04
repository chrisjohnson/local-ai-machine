---
id: M-072
title: pi-web-factory — Agent Skill for triggering chains from inside any pi-web session
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: [M-071]
status: null
related_cards: [M-066, M-067, M-071, M-073]
---

# M-072 — pi-web-factory — Agent Skill for triggering chains from inside any pi-web session

## Context
Chris's feedback 2026-08-04: agentic triggering should be first-class. Sitting inside
any pi-web session, say "run the pipeline for X" and have it happen — a skill calling
`cli.ts` under the hood is fine — ideally with a link back to the new session
(`pi-web-adw-design.md` §6.1 point 4, §6.3). Blocked on M-071 since the "link back to
the session" part needs `cli.ts` to already print a real deep-link, not a bare id.

pi's native Agent Skills mechanism is already confirmed working on this box (loaded
automatically from `$PI_CODING_AGENT_DIR/skills/<name>/SKILL.md` into every session's
system prompt) — used today only for a *plugin* (`pi-continue-companion`), never yet
for an actual Skill. Confirmed live: `PI_CODING_AGENT_DIR=/home/piweb/.pi-web`
(bind-mounted from host `~/.pi-web`), no `skills/` subdirectory exists there yet.

**The skill is UX, not execution** — SSSF's own `SKILL.md` pattern (this doc's §1.1:
routing table, lazy-loaded cookbooks, "print available workflows, wait for the
request") is the model, adapted to the fact that pi-web-factory's real logic already
lives in TS (`chains/`, `run.ts`, etc.), not in the skill's own instructions. The
skill's job is: recognize a request that matches an available chain, resolve the
right `--project`/`--chain`/prompt arguments, run `bun cli.ts ...` via the session's
own bash tool, and report the real result (including the link M-071 makes possible)
back to the human in the same conversation.

## Plan
1. [ ] `~/.pi-web/skills/pi-web-factory/SKILL.md` — frontmatter (`name`, `description`
   with clear trigger keywords, per pi's Skill format — same shape SSSF's own
   `SKILL.md` uses, confirmed compatible with pi's loader in earlier research) +
   startup behavior: list available chains (from `chains/registry.ts`'s
   `chainNames()`) with a one-line description each, wait for the human's actual
   request — mirror SSSF's own explicit "don't volunteer state, don't probe, wait"
   discipline (this doc's §1.1's SKILL.md excerpt) rather than inventing new startup
   behavior.
2. [ ] Routing: map a natural-language request to `--project` (needs the project's
   real absolute path — how does the skill learn this? likely: the session's own
   `cwd` already IS the target project in the common case, since a human triggering
   this from inside a project's own pi-web session is the expected flow — confirm
   this assumption or handle the case where it isn't explicitly), `--chain` (pick the
   shape that matches the request — "quick fix" -> `plan-build-test`, "review this
   carefully" -> the bounded build↔review chain from M-073, etc. — needs M-073's
   chain names to exist first, or ship with just today's `plan-build-test` and extend
   later).
3. [ ] Have the skill instruct the model to run `bun cli.ts ...` (absolute path to
   this project's `pi-web-factory/` dir) via its bash tool, capture the printed
   adwId/sessionId/deep-link, and relay it back to the human directly in the
   conversation — not just dump raw CLI stdout.
4. [ ] Deploy: land the file on the box (`~/.pi-web/skills/pi-web-factory/SKILL.md`),
   confirm it's actually loaded (check a fresh pi-web session's system prompt, or the
   pi-web-factory-prompts extension work from M-069 if that lands first and offers
   an easy way to inspect what's loaded).
5. [ ] Live verification: from an ordinary pi-web session (not via `cli.ts` directly),
   make a natural-language request, confirm the skill triggers, a real chain runs,
   and the reported link actually opens the resulting session.

## Signals
<!-- append-only -->

## Decision log
<!-- append-only, one line per entry, newest last -->

## Handoff notes
