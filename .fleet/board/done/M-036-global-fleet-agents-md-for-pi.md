---
id: M-036
title: Wire global fleet AGENTS.md into pi-agent-supervisor and pi-web
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T05:16:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-030, M-031, M-035]
---

# M-036 — Wire global fleet AGENTS.md into pi-agent-supervisor and pi-web

## Context
Chris asked how agentic-fleet conventions fit into the pi-agent/pi-web
setup, specifically whether a global AGENTS.md mechanism (like his own
`~/.claude/AGENTS.md` symlink to `agentic-fleet/AGENTS.md`) exists for
pi. It does, natively: pi loads `PI_CODING_AGENT_DIR/AGENTS.md` for every
session regardless of project, plus each project's own AGENTS.md by
walking up from cwd (docs/quickstart.md, docs/usage.md "Context Files") -
no bespoke skill needed the way Turnstone required, since Turnstone has
no native equivalent.

Chris's own mechanism is a live symlink (same filesystem, Mac-only). That
doesn't reach across machines - the box has no filesystem access to the
Mac. Considered cloning agentic-fleet onto the box itself for a live
reference (confirmed the mounted SSH deploy key can actually read that
repo too, not just local-ai-machine's own), but Chris clarified he was
only illustrating the global-vs-cwd distinction, not asking for that -
the snapshot approach (same pattern already used for the Turnstone
skill) is fine.

## Plan
1. [x] Commit `docker/agentic-fleet-AGENTS.md` - point-in-time snapshot
   of `agentic-fleet/AGENTS.md`, staleness disclaimer, same pattern as
   `docker/turnstone/skills/agentic-fleet-printer-dashboard.md`.
2. [x] Bind-mount it read-only at `/data/pi-agent-config/AGENTS.md` for
   both `pi-agent-supervisor` and `pi-web` - direct mount, no entrypoint
   step needed (no secret involved, unlike `models.json`).
3. [x] Deploy and verify for real: a fresh session in each service,
   asked a fleet-specific question it was never told in-prompt ("what's
   the WIP limit, where do board changes commit vs source code") -
   correctly answered "1" and "board→main, source→branch+PR" purely from
   the loaded global context in both services.

## Signals
<!-- signal: claude 2026-07-31T05:25Z — done, confirmed live in both pi-agent-supervisor and pi-web via real functional test -->

## Decision log
- Confirmed pi's native context-file mechanism (not something we needed
  to build) directly from docs/quickstart.md and docs/usage.md: global
  `~/.pi/agent/AGENTS.md` (= `PI_CODING_AGENT_DIR/AGENTS.md`) plus
  automatic per-project discovery walking up from cwd. This is why the
  Turnstone skill had to manually embed fleet conventions AND explicitly
  instruct "read the project's own AGENTS.md live" - Turnstone has
  neither mechanism natively; pi has both.
- Verified the snapshot is real, not just "file exists": sent a fresh
  prompt to a new session in each service asking for two specific facts
  (WIP limit, board-vs-source commit destination) with an explicit
  instruction not to search/read files - both correctly answered from
  system context alone.
- Considered and rejected (per Chris's clarification) a live-reference
  approach (clone `agentic-fleet` onto the box, bind-mount its AGENTS.md
  directly instead of a snapshot) - confirmed technically feasible (the
  mounted SSH deploy key can read that private repo too), but out of
  scope for what was actually asked; the snapshot-with-disclaimer
  pattern already in use for the Turnstone skill is the accepted
  approach here too.

## Handoff notes
If `agentic-fleet/AGENTS.md` changes meaningfully, re-copy its content
into `docker/agentic-fleet-AGENTS.md` and redeploy
(`docker compose up -d pi-agent-supervisor pi-web` - no rebuild needed,
it's a bind mount) - same manual-resync obligation as the Turnstone
skill snapshot.
