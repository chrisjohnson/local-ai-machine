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
4. [x] Deployed + verified the non-root switch. Three real, independently
   discovered problems, each caught by actually testing rather than
   trusting the previous fix (worth recording precisely, since each one
   looked complete until tested):
   - **uid/HOME**: rebuilt image, one-time chown of the existing
     `docker_pi-web-data` volume from root to `1000:1000`, scoped
     restart. Confirmed `whoami` → `node`, `$HOME` → `/home/chris`.
   - **Missing binaries**: `ssh -T git@github.com` then failed with
     `sh: 1: ssh: not found` - the `ssh` binary itself was never
     installed in this image (only `git`/`ca-certificates` were). This
     was the real, more fundamental cause of the original "SSH isn't
     available on this machine" report from Chris's screenshot, not just
     the HOME/uid mismatch. `gh` was missing too despite `GH_TOKEN`
     already being wired into the environment. Fixed by adding
     `openssh-client`/`curl` to the apt install list plus a
     gh-from-release-tarball install step - same packages/approach
     turnstone's Dockerfile already uses for the identical reason.
   - **ENV HOME doesn't bind ssh**: still failed after that with
     `Host key verification failed`. Verbose ssh debug showed it only
     ever read `/etc/ssh/ssh_config` and looked for
     `/home/node/.ssh/known_hosts` - it never touched
     `/home/chris/.ssh/config` at all. Root cause: OpenSSH resolves the
     invoking user's home directory via the real `/etc/passwd` entry
     (`getpwuid`), not `$HOME`, for its own default config/known-hosts/
     identity path expansion - unlike git, which does honor `$HOME`
     directly. Fixed with `usermod -d /home/chris node` at build time so
     both resolution mechanisms agree.
   - **Final verification**: `ssh -T git@github.com` →
     "Hi chrisjohnson! You've successfully authenticated"; `gh auth
     status` → logged in via `GH_TOKEN`; a real
     `git clone git@github.com:chrisjohnson/local-ai-machine.git` over
     SSH from inside the container as `node` succeeded end to end
     (exit 0, files present). This is the actual test case Chris asked
     for - a real pi session's SSH path, not just a config check.
5. [x] Command-permission gap: no further action planned in this card -
   confirmed it needs new code (most plausibly a custom extension using
   `spawnHook` on the bash tool, or patching `bash.js` directly), not a
   config change. Splitting into a follow-on card if/when Chris wants
   this actually built; this card's research obligation is satisfied.
6. [x] Follow-on: Chris asked for a documented process for adding new
   tools/packages mid-session (rebuild + relaunch pi-web's own
   container), and ideally scoped so pi itself could eventually drive it.
   Written up as `docs/adding-tools-to-pi-web.md` - covers the manual
   process today (edit Dockerfile, rebuild, scoped redeploy, reconnect to
   the same session by ID) and what self-service would actually require
   (docker.sock access, same real privilege-escalation tradeoff already
   accepted for turnstone - not done automatically without Chris's
   explicit sign-off, matching this session's established discipline
   around new capability grants).

## Signals
<!-- signal: claude 2026-07-31T18:20Z — claiming, starting with root-requirement research -->
<!-- signal: claude 2026-07-31T19:05Z — done, non-root switch verified end-to-end, command-permission gap documented as needing new code -->

## Decision log
- Card created directly from a live root-cause finding (M-039's SSH fix),
  not speculative — root-vs-non-root was never actually evaluated when
  pi-web was first deployed, it just inherited the rest of this compose
  file's default.
- The non-root switch took three separate real fixes, not one -
  discovered strictly by testing after each change rather than trusting
  the diagnosis: (1) uid/HOME mismatch, (2) `ssh`/`gh` binaries missing
  entirely from the image, (3) OpenSSH ignoring `$HOME` in favor of the
  real `/etc/passwd` home directory. Worth remembering as a pattern: a
  plausible-looking root cause (uid mismatch) can be real AND incomplete
  at the same time — each fix was necessary, none was sufficient alone.
- Command-permission scoping (pi-core, not pi-claude-bridge) is a real
  gap, not a config change — deliberately not implemented here without
  Chris's explicit direction on what restrictions he actually wants,
  consistent with this session's standing discipline that new capability/
  restriction decisions need his sign-off, not autonomous judgment.

## Handoff notes
Non-root switch (Plan 1-4) is fully done, deployed, and verified with a
real SSH clone from inside the container. Command-permission research
(Plan 5) is done — the conclusion is "needs new code," and no
implementation was started; if Chris wants this built, it should be a
new card scoped around `spawnHook` on pi-core's bash tool, informed by
the exact source paths in the decision log above. `docs/adding-tools-to-
pi-web.md` (Plan 6) documents the rebuild/redeploy process this card's
own work already exercised three times over.
