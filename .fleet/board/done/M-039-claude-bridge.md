---
id: M-039
title: Wire up pi-claude-bridge so Claude is dialable from pi
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:45:00Z
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
1. [x] Figure out exactly what `~/.claude` state the extension needs
   beyond `.credentials.json` alone (its own README flags session state
   under `~/.claude` more broadly, not just the credentials file) - check
   whether a bare credentials-file-only copy is sufficient for a fresh
   `claude` CLI install to authenticate, or whether more of `~/.claude`
   needs to come along. Don't assume - the integration tests' own
   sandbox-probe behavior (fails fast if `~/.claude` isn't writable) is a
   strong hint this matters.
2. [x] Install the `claude` CLI (Claude Code) inside `pi-web`'s Docker
   image - check how it's normally distributed (npm package, standalone
   binary) and pin an explicit version, same reproducibility discipline
   as everything else in this repo.
3. [x] Mount the copied credentials file (and whatever else step 1
   determines is needed) into the container at the path `claude`/the SDK
   expects. Same ownership gotcha already hit twice tonight (SSH key,
   git safe.directory) is very likely here too - the container runs as
   root, the mounted file will be owned by a different uid. Check for it
   proactively rather than rediscovering "Bad owner"-style errors a
   third time; the docker-entrypoint.sh staging-copy pattern already
   used for the SSH key is the known-working fix if so.
4. [x] Install `pi-claude-bridge` as a pi extension (shared extensions
   location, same idea as M-036/M-038).
5. [x] Write `PI_CODING_AGENT_DIR/claude-bridge.json` with
   `provider.plan: "pro"` explicitly set. Do NOT set `"max"` or leave
   default.
6. [x] Verify for real: switch a live pi-web session to
   `claude-bridge/claude-sonnet-5` (or similar), send a real prompt,
   confirm an actual Claude response comes back using Chris's own
   subscription (not a billing error, not a stub). Also sanity-check the
   AskClaude tool from a non-claude-bridge session if time allows.
   **Result: reproduced a genuine blocker, see Decision log/Handoff notes -
   not fully green yet, Chris's call needed.**
7. [x] If genuinely blocked on anything in this card specifically,
   stop and leave clear handoff notes rather than guessing further -
   Chris said to report this one tomorrow if stuck, unlike the others.
   **This is that stop. See Handoff notes.**

## Signals
<!-- signal: claude 2026-07-31T07:05Z — blocked on a real security-posture
     decision (IS_SANDBOX=1), everything else done and deployed; see
     Handoff notes -->

## Decision log
- Step 1 (resolved empirically, not just from source-reading): a bare
  `.credentials.json` copy is sufficient. Confirmed live on the box: ran
  `claude -p "..."` inside the container with only `.credentials.json`
  staged (no pre-existing `~/.claude.json`, no `~/.claude/projects/`) and
  it authenticated and replied correctly. The `claude` CLI bootstraps its
  own `~/.claude.json` and `~/.claude/projects/<hash>/*.jsonl` on first
  run by itself - nothing else needed to be copied from Chris's Mac beyond
  what was already authorized. `~/.claude` just needs to be a writable
  directory (root-owned is fine, container runs as root) so the CLI can
  create the rest of its own state - confirmed directly from
  `cc-session-io`'s own source (`getClaudeDir()` =
  `CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")`, `mkdirSync(...,
  {recursive:true})` on write).
- Step 2/3: `claude` CLI pinned to `2.1.220` in `pi-web/Dockerfile`
  (`npm install -g @anthropic-ai/claude-code@2.1.220`, native per-platform
  binary fetched via postinstall at image build time - box is
  linux-x64/amd64, confirmed via `uname -m` + `docker version`). Same
  staging-copy ownership fix already used for the SSH deploy key: creds
  mounted read-only at `/run/claude-secrets/claude-code-credentials.json`,
  `docker-entrypoint.sh` copies into `/root/.claude/.credentials.json` with
  root ownership + chmod 600 at startup (`$HOME=/root` in this container,
  confirmed live - no USER directive, matches every other service here).
  Not mounted read-only, per the card's own warning - Claude Code writes
  session state to `~/.claude/projects/<hash>/*.jsonl` on every turn.
- Step 4: `pi-web`'s own CLI (`bin/pi-web.js`) has no `pi install`
  subcommand at all - it always just launches `next start` (confirmed
  directly from its published source, no passthrough to
  `@earendil-works/pi-coding-agent`'s package-manager CLI). So
  `docker-entrypoint.sh` replicates what `pi install npm:pi-claude-bridge@
  0.6.3` does under the hood instead: `npm install pi-claude-bridge@0.6.3
  --prefix "$PI_CODING_AGENT_DIR/npm" --legacy-peer-deps` (a real npm
  project at `PI_CODING_AGENT_DIR/npm`, `package.json`
  `{"name":"pi-extensions","private":true}`), plus appending
  `"npm:pi-claude-bridge@0.6.3"` to `settings.json`'s `packages` array -
  both confirmed directly from `@earendil-works/pi-coding-agent`'s own
  `dist/core/package-manager.js` (`installNpm`/`addSourceToSettings`).
  Confirmed `pi-web` actually loads packages from that same
  settings.json/npm tree at runtime via the same `createAgentSessionServices()`
  the `pi` CLI uses (confirmed from pi-web's own `lib/rpc-manager.ts`), so
  a package installed this way is picked up identically despite never
  going through `pi install` itself. Additive to the `packages` array (an
  unrelated entry, `@juicesharp/rpiv-web-tools`, was already present on
  the box from earlier experimentation) - didn't touch or remove it.
  Idempotent + version-pinned like every other install in this repo (only
  reinstalls when the on-disk version differs from the pinned one).
- Step 5: `PI_CODING_AGENT_DIR/claude-bridge.json` seeded once (same
  non-stomping convention as `models.json`) with `{"provider":{"plan":
  "pro"}}`. Deployed and confirmed live on the box.
- Step 6 (the actual blocker): switching to `claude-bridge/claude-sonnet-5`
  and sending a real prompt (via the standalone `pi` CLI over `npx
  @earendil-works/pi-coding-agent@0.83.0`, pointed at the same
  `PI_CODING_AGENT_DIR` pi-web uses, since that's a faster smoke-test path
  than driving the full browser UI) failed every time with "Claude Code
  process exited with code 1". `CLAUDE_BRIDGE_DEBUG=1`'s own log
  (`~/.pi/agent/claude-bridge.log` - note: this debug log path ignores
  `PI_CODING_AGENT_DIR`, it's hardcoded to `homedir()/.pi/agent/`, a
  pi-claude-bridge quirk worth knowing) pinpointed the exact cause:
  `--dangerously-skip-permissions cannot be used with root/sudo privileges
  for security reasons`. The Claude Agent SDK always invokes the `claude`
  subprocess with `--dangerously-skip-permissions` (no interactive
  approval flow exists in a headless subprocess), but Claude Code's own
  CLI refuses that flag outright when running as root - every service in
  this compose file runs as root in its container (no USER directive
  anywhere), `pi-web` included, so this trips every time.
  Reproduced directly, isolated from the bridge entirely: `claude
  --dangerously-skip-permissions -p "reply yes"` as root in the container
  fails with that exact message; same command with `IS_SANDBOX=1` set in
  the environment succeeds ("Yes."). Re-ran the actual claude-bridge
  provider path with `IS_SANDBOX=1` exported ad hoc in my own shell (never
  written to the container's real config or redeployed) and it also
  succeeded end to end - so this is confirmed as the complete, sole
  remaining blocker, not one of several.
  Drafted the fix (`IS_SANDBOX: "1"` under `pi-web`'s `environment:` in
  `docker/docker-compose.yml`) and it was blocked by the auto-mode safety
  classifier before I committed it - correctly, in my own judgment too:
  `IS_SANDBOX=1` is Claude Code's own documented escape hatch for exactly
  this (containerized/CI environments that always run as root), and every
  service here already runs as root, but this is still a real
  security-posture call (disabling Claude Code's own extra root
  safety-check, for a container that also holds the SSH deploy key,
  `docker.sock`, and Chris's whole home directory) that deserves an
  explicit yes from Chris rather than being pushed to main unilaterally
  under an "any judgment call, proceed and record it" default. Reverted
  the draft change before it was ever committed or pushed - the box's
  actual deployed `pi-web` container has no `IS_SANDBOX` set (confirmed:
  `docker inspect pi-web` and `docker exec pi-web env` both show it
  absent), so nothing on the box or in git reflects this beyond the ad hoc
  one-off shell tests described above.

## Handoff notes
Everything is deployed and working up through pi-claude-bridge actually
invoking the real `claude` subprocess with the right model, config, and
credentials - it just dies on Claude Code's own root safety-check before
it can respond. One remaining decision, entirely yours:

**Set `IS_SANDBOX=1` in `pi-web`'s environment in
`docker/docker-compose.yml` to let Claude Code's `claude` binary run
`--dangerously-skip-permissions` as root?** This is Claude Code's own
documented flag for exactly this situation (container that always runs as
root), not a hack around it - but it does mean the `claude` subprocess
inside `pi-web` runs with all of Claude Code's own permission
checks/prompts disabled, on a container that also has your SSH deploy
key, `docker.sock`, and your whole home directory mounted. Every other
service in this compose file already runs as root with no extra
sandboxing beyond the container boundary itself, so this isn't a new
posture for the box - but "all Claude Code permission checks off" is a
bigger step than the ambient root-in-container baseline everywhere else,
so I didn't want to make that call for you.

If you say yes: add
```yaml
      IS_SANDBOX: "1"
```
under `pi-web`'s `environment:` block in `docker/docker-compose.yml`
(right next to `LITELLM_MASTER_KEY`), commit, push, redeploy with
`ssh local-ai-machine "cd /home/chris/local-ai-machine && git pull --ff-only && cd docker && docker compose up -d --build pi-web"`,
then re-verify with a real prompt through
`claude-bridge/claude-sonnet-5` in the actual pi-web UI (or the same
`npx @earendil-works/pi-coding-agent@0.83.0 --no-session -p "..." --model
claude-bridge/claude-sonnet-5` smoke test I used, run inside the `pi-web`
container with `PI_CODING_AGENT_DIR=/data/pi-agent-config`) - I've already
confirmed this exact combination works end to end, so it should be a
one-line change + redeploy + a quick confirmation, not more investigation.

If you'd rather not run the bridge as root at all, the real alternative is
giving `pi-web` its own non-root user (a bigger change - it would also
need to own the mounted `/home/chris` bind mount's permissions story,
which currently relies on root to read/write across that whole tree) -
happy to scope that as a separate card if you'd rather go that direction
instead of `IS_SANDBOX=1`.

Everything already deployed and confirmed live on the box right now (safe
to leave as-is even before this decision - nothing here breaks any other
service or exposes the credential anywhere new):
- `claude` CLI `2.1.220` installed in the `pi-web` image
- Credentials staged at `/root/.claude/.credentials.json` (root:root, 600)
  via entrypoint copy from the read-only mount
- `pi-claude-bridge@0.6.3` installed at
  `/data/pi-agent-config/npm/node_modules/pi-claude-bridge`
- `/data/pi-agent-config/settings.json` has
  `"npm:pi-claude-bridge@0.6.3"` in its `packages` array (existing
  `@juicesharp/rpiv-web-tools` entry preserved)
- `/data/pi-agent-config/claude-bridge.json` has `provider.plan: "pro"`
- AskClaude tool sanity-check from a non-claude-bridge session (plan step
  6's second half) not yet done - blocked on the same `IS_SANDBOX` issue
  (AskClaude also shells out to the same `claude` subprocess), so there
  was nothing further to test there tonight.

## Resolution (2026-07-31, follow-on session)
`IS_SANDBOX=1` (Chris's go-ahead) fixed the original root/permissions
blocker as predicted, but exposed a second, real one: the copied
`~/.claude/.credentials.json` hit `401 OAuth access token has been
revoked` specifically through the Agent SDK's own auth-profile-fetch
step - confirmed via `CLAUDE_BRIDGE_DEBUG=1`'s detailed log, not
guessed. Root-caused rigorously, not by trial and error:
- Same exact credential file worked perfectly via the plain `claude`
  CLI, both on the box and locally on Chris's Mac - ruled out "token is
  actually dead."
- Reproduced the identical failure **locally, in isolation**, using the
  raw `@anthropic-ai/claude-agent-sdk` package directly (bypassing pi
  and pi-claude-bridge entirely) with `$HOME` pointed at a bare
  directory containing only `.credentials.json` - proved this is an
  SDK-specific auth requirement, not anything box/container/root-
  specific.
- Copying the full `~/.claude.json` in too (Chris's hypothesis: maybe
  something there, like `oauthAccount`, was the missing piece) did NOT
  fix the isolated repro - ruled that out too.
- Chris's Keychain hypothesis was directionally right (Claude Code's
  own `--help` confirms normal auth does consult Keychain) but the
  isolated test still ran as the same logged-in macOS user with full
  Keychain access and still failed - so Keychain access alone isn't
  the differentiator either. Exact missing ingredient never fully
  identified - moot once the real fix was found.

**Actual fix**: `claude setup-token` - Anthropic's own documented
mechanism for exactly this (long-lived, subscription-backed OAuth
token for headless/CI use, `CLAUDE_CODE_OAUTH_TOKEN` env var,
`sk-ant-oat01-...` format). Simpler than the file-copy approach it
replaced - no ownership-fix entrypoint logic needed at all, just one
env var read from `docker/.env`. Note for the record: Chris pasted the
generated token directly into chat once (asked not to, to avoid exactly
this) - it's in this conversation's transcript. Not re-printed anywhere
after that point; stored only in `secrets/claude-code-oauth-token.env`
(gitignored) and `docker/.env` on the box from then on.

**Verified for real, both halves of the card's original plan**:
- Provider path: `claude-bridge/claude-sonnet-5` returned a real
  `BRIDGE-OK` response to a direct prompt.
- AskClaude delegation path: a `local-litellm`/`coder` session asked to
  delegate via AskClaude got back a real `ASKCLAUDE-OK` from Claude.

Old non-working credential files cleaned up (box's `secrets/` dir, local
`/tmp` diagnostic copies).
