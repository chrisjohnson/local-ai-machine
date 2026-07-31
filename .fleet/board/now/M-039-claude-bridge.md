---
id: M-039
title: Wire up pi-claude-bridge so Claude is dialable from pi
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-035, M-037]
---

# M-039 — Wire up pi-claude-bridge so Claude is dialable from pi

## Context
Chris wants Claude reachable from within pi (pi-web), using his own
Claude Pro subscription rather than metered API billing. Tool:
`github.com/elidickinson/pi-claude-bridge` (npm `pi-claude-bridge`) - a pi
extension built on the Claude Agent SDK. Confirmed directly from its own
README, not assumed:

- It's an extension (`pi install npm:pi-claude-bridge`), not a separate
  server. It spawns the real `claude` CLI as a subprocess internally and
  needs `~/.claude` to exist with working auth - same as a normal local
  Claude Code install, not an extracted API token/env var.
- Gives two things: a **provider** (`/model claude-bridge/claude-sonnet-5`
  etc. - Claude models selectable like any other pi model, all tool calls
  flow through pi's own TUI/tools) and an **AskClaude tool** (any other
  provider can delegate a question/task to Claude Code and get an answer
  back, modes `read`/`none`/`full`).
- Config lives at `~/.pi/agent/claude-bridge.json` (global) -
  **`provider.plan` MUST be set to `"pro"`, not left default or set to
  `"max"`** - Chris is explicitly on Pro, which has different limits than
  Max/API, and the extension's own 1M-context defaults assume Max unless
  told otherwise.
- Needs the actual `claude` CLI binary present and reachable
  (`pathToClaudeCodeExecutable` config option exists for nonstandard
  install locations).
- Confirmed real requirement from its own test docs: needs write access
  to `~/.claude` for Claude Code's own session state, or resume fails
  with "No conversation found with session ID" - don't mount it read-only.

Chris's own local Claude Code credentials (`~/.claude/.credentials.json`
on his Mac) were copied to the box at
`/home/chris/secrets/claude-code-credentials.json` (chmod 600) already,
with his explicit confirmation - copied as a raw file transfer (scp),
never inspected/printed/materialized in any transcript along the way.
This card's job is wiring that file into wherever `pi` actually runs
inside `pi-web`'s container, installing the `claude` CLI binary itself,
installing the extension, and configuring `provider.plan: "pro"`.

## Plan
1. [ ] Figure out exactly what `~/.claude` state the extension needs
   beyond `.credentials.json` alone (its own README flags session state
   under `~/.claude` more broadly, not just the credentials file) - check
   whether a bare credentials-file-only copy is sufficient for a fresh
   `claude` CLI install to authenticate, or whether more of `~/.claude`
   needs to come along. Don't assume - the integration tests' own
   sandbox-probe behavior (fails fast if `~/.claude` isn't writable) is a
   strong hint this matters.
2. [ ] Install the `claude` CLI (Claude Code) inside `pi-web`'s Docker
   image - check how it's normally distributed (npm package, standalone
   binary) and pin an explicit version, same reproducibility discipline
   as everything else in this repo.
3. [ ] Mount the copied credentials file (and whatever else step 1
   determines is needed) into the container at the path `claude`/the SDK
   expects. Same ownership gotcha already hit twice tonight (SSH key,
   git safe.directory) is very likely here too - the container runs as
   root, the mounted file will be owned by a different uid. Check for it
   proactively rather than rediscovering "Bad owner"-style errors a
   third time; the docker-entrypoint.sh staging-copy pattern already
   used for the SSH key is the known-working fix if so.
4. [ ] Install `pi-claude-bridge` as a pi extension (shared extensions
   location, same idea as M-036/M-038).
5. [ ] Write `PI_CODING_AGENT_DIR/claude-bridge.json` with
   `provider.plan: "pro"` explicitly set. Do NOT set `"max"` or leave
   default.
6. [ ] Verify for real: switch a live pi-web session to
   `claude-bridge/claude-sonnet-5` (or similar), send a real prompt,
   confirm an actual Claude response comes back using Chris's own
   subscription (not a billing error, not a stub). Also sanity-check the
   AskClaude tool from a non-claude-bridge session if time allows.
7. [ ] If genuinely blocked on anything in this card specifically,
   stop and leave clear handoff notes rather than guessing further -
   Chris said to report this one tomorrow if stuck, unlike the others.

## Signals

## Decision log

## Handoff notes
