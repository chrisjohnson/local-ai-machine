---
id: M-085
title: Ornith agentic-ability test via pi-web-factory
initiative_id: null
claimed_by: opencode
claimed_at: 2026-08-05T05:10Z
blocks: null
blocked_by: null
status: null
related_cards:
  - M-084
  - M-078
---

# M-085 — Ornith agentic-ability test via pi-web-factory

## Context
Ornith-1.0-35B-MTP now backs `medium-moe` (and medium-moe-continue-json) on the
live litellm proxy (M-084). Before trusting it as a standing agentic-coding model,
run it through the pi-web-factory `bounded-build-review` workflow where the
`build`/`build-retry` roles (medium-moe) are ornith and `review` (big-moe) is
laguna — the factory exercises real agentic tool use (filesystem, bash, git) and
its output is judged by an independent reviewer model plus a real test suite.

## Plan
1. [ ] Mint a scratch stub-codebase git repo in the pi-web container's /tmp
      (matching the M-078 watch-dir pattern: self-created, disposable)
2. [ ] Run `bun cli.ts --project <scratch> --workflow bounded-build-review "<hard task>"`
      — build/build-retry = ornith (medium-moe), review = laguna (big-moe)
3. [ ] Monitor session transcript/events; record timings + token usage
4. [ ] Verify: task's own tests pass on the produced worktree, review approved,
      code quality read
5. [ ] Archive+delete the session, deregister/remove scratch project
      (AGENTS.md: self-minted scratch cwd, agent-created session — safe by construction)
6. [ ] Record verdict + evidence in this card, move to done

## Signals

## Decision log

## Handoff notes
