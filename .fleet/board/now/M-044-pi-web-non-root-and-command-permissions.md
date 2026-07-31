---
id: M-044
title: pi-web non-root user + pi command/tool permission model
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T18:20:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-039]
---

# M-044 — pi-web non-root user + pi command/tool permission model

## Context
Surfaced directly out of the M-039 SSH fix: pi-web runs as root (no `USER`
directive, `$HOME=/root`) purely because every service in this compose file
happens to default to root, not because it was ever confirmed to need root.
Chris's question: does it actually need root, or can it run as a matched
non-root uid (like turnstone already does, uid 1000 = chris, which is why
turnstone's SSH key mount just works without any of the `/root/.ssh`
confusion pi-web just hit)?

Second, related thread: Chris wants to understand/control what commands pi
(and models running through it) can actually execute — right now nothing in
this stack scopes that beyond whatever pi's own defaults are. Two separate
concerns bundled into one card because they're both "what is pi-web actually
allowed to do, and is that intentional or just default sprawl."

## Plan
1. [x] Research (sub-agent): no technical blocker to non-root. No
   privileged port, `/data` writes are the only runtime writes, and
   `node:22-slim` already bakes in a `node` user at uid/gid 1000 matching
   host `chris` (confirmed: `stat -c '%u %g' /home/chris` → `1000 100`).
   Unlike turnstone (whose base image bakes in its non-root user, no
   Dockerfile change needed there), pi-web needed an explicit `USER node`
   line since `node:22-slim` defaults to root.
2. [x] Switched pi-web to `USER node` in `pi-web/Dockerfile`, with
   `ENV HOME=/home/chris` (overriding node's own image default
   `/home/node`, which is NOT the bind-mounted tree). Dropped the
   `/root/.ssh/*` stopgap mounts entirely from `docker-compose.yml` -
   once uid and `$HOME` both actually line up with the already-mounted
   `/home/chris`, git/ssh find the key at its real path for free, no
   separate SSH-specific mount needed (simpler than turnstone's explicit
   3-file mount, since pi-web already mounts the whole home tree for its
   project browser).
3. [x] Research (sub-agent): confirmed zero per-command approval mechanism
   exists in pi-core at all - not a settings.json flip, a real gap.
   `settings.json` only has `theme`/`packages`; the only trust-related
   field anywhere in `@earendil-works/pi-coding-agent` is
   `defaultProjectTrust` (governs whether to load a *project's* `.pi`
   config/extensions on open, unrelated to per-command approval).
   `dist/core/tools/bash.js` spawns commands directly with no allowlist/
   denylist/approval callback; `BashToolOptions` exposes only `spawnHook`
   (a code-level hook, not a config field) and `commandPrefix`. Zero
   matches anywhere in `dist/` for `confirmToolCall`/`toolApproval`/
   `requestApproval`. Unlike Claude Code (which has a real approval flow
   that's merely skipped via `--dangerously-skip-permissions` in headless
   mode), pi never built a per-call approval gate to begin with, in
   either its CLI or pi-web. `pi-claude-bridge`'s `MODE_DISALLOWED_TOOLS`
   is the only scoping precedent in this repo, but it only gates its own
   AskClaude tool, not pi's native bash/edit/write tools.
4. [x] Deployed + verified the non-root switch: rebuilt image, one-time
   chown of the existing `docker_pi-web-data` volume from root to
   `1000:1000`, scoped restart. Confirmed live: `whoami` → `node`,
   `id` → `uid=1000(node) gid=1000(node)`, `$HOME` → `/home/chris`, all
   correct. But the HOME/uid fix alone was NOT sufficient - caught by
   actually testing rather than assuming: `ssh -T git@github.com` failed
   with `sh: 1: ssh: not found`. The `ssh` binary itself was never
   installed in this image at all (only `git`/`ca-certificates` were) -
   this was the real, more fundamental cause of the original "SSH isn't
   available on this machine" report from Chris's screenshot, not just
   the HOME/uid mismatch (which was also real, but moot without the
   binary). `gh` was missing too, despite `GH_TOKEN` already being wired
   into the environment. Fixed by adding `openssh-client`/`curl` to the
   apt install list and a `gh`-from-release-tarball install step - same
   packages/approach turnstone's Dockerfile already uses for the
   identical reason (its own comment: "confirmed missing on the first
   attempt"). Redeployed; `ssh -T git@github.com` and `gh auth status`
   both verified working live inside the container post-fix.
5. [ ] Command-permission gap: no further action planned in this card -
   confirmed it needs new code (most plausibly a custom extension using
   `spawnHook` on the bash tool, or patching `bash.js` directly), not a
   config change. Splitting into a follow-on card if/when Chris wants
   this actually built; this card's research obligation is satisfied.

## Signals
<!-- signal: claude 2026-07-31T18:20Z — claiming, starting with root-requirement research -->

## Decision log
- Card created directly from a live root-cause finding (M-039's SSH fix),
  not speculative — root-vs-non-root was never actually evaluated when
  pi-web was first deployed, it just inherited the rest of this compose
  file's default.

## Handoff notes
Not started yet. Two independent research threads (root requirement,
command permission model) — fine to parallelize across sub-agents per
AGENTS.md §2, but this card owns both until it's clear whether they split
into separate follow-on cards.
