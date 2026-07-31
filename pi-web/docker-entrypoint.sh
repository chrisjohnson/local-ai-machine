#!/bin/sh
# Seed models.json ONCE, only if it doesn't already exist - unlike our own
# pi-agent/supervisor (which deliberately rewrites models.json on every
# startup, since that service has no user-facing model-management UI),
# pi-web's whole point includes its own Models panel for reading AND
# writing this same file interactively. Overwriting it every restart would
# silently stomp anything configured through that UI. Seeding only when
# absent gives it the same litellm/coder starting point as our own
# supervisor without fighting its own management surface afterward.
set -e
mkdir -p "$PI_CODING_AGENT_DIR"
if [ ! -f "$PI_CODING_AGENT_DIR/models.json" ]; then
  if [ -z "$LITELLM_MASTER_KEY" ]; then
    echo "LITELLM_MASTER_KEY is not set - refusing to seed models.json with no way to authenticate to litellm." >&2
    exit 1
  fi
  # Substitute the real key at startup - the committed template has a
  # placeholder, never a real secret (docker/.env, read at runtime only).
  sed "s/__LITELLM_MASTER_KEY__/$LITELLM_MASTER_KEY/" /app/models.seed.json.tmpl > "$PI_CODING_AGENT_DIR/models.json"
fi

# --- pi-claude-bridge (M-039) ---
#
# Stage Chris's Claude Code credentials with root ownership. Container runs
# as root (no USER directive), but docker-compose.yml mounts the host file
# read-only at /run/claude-secrets/, owned by uid 1000 (chris) on the host -
# same "container runs as root, mounted file owned by a different uid"
# ownership gotcha already hit and fixed twice tonight for the SSH deploy
# key (pi-agent/supervisor/docker-entrypoint.sh) and git safe.directory
# (this same Dockerfile, see above). Same known-working fix: stage at a
# read-only mount path, copy into place with root ownership + tight perms
# at startup rather than mounting directly where `claude` expects it.
#
# $HOME is /root here (root, no HOME override) - the Claude Agent SDK and
# cc-session-io both resolve Claude Code's state directory as
# `$CLAUDE_CONFIG_DIR || join(homedir(), ".claude")` (confirmed directly
# from cc-session-io's own dist/chunk-*.js, not assumed), so this must land
# at /root/.claude, not /app or anywhere pi-web-specific.
#
# Not read-only: pi-claude-bridge's own test docs confirm Claude Code
# writes session state under ~/.claude/projects/<hash>/*.jsonl on every
# turn (mkdirSync + writeFileSync, confirmed from cc-session-io source) -
# mounting/staging this read-only reproduces exactly the "No conversation
# found with session ID" resume failure its README warns about.
if [ -f /run/claude-secrets/claude-code-credentials.json ]; then
  mkdir -p /root/.claude
  chmod 700 /root/.claude
  cp /run/claude-secrets/claude-code-credentials.json /root/.claude/.credentials.json
  chmod 600 /root/.claude/.credentials.json
fi

# Install pi-claude-bridge as a pi extension. pi-web's own CLI (bin/pi-web.js)
# only ever launches the Next.js server - it has no `pi install` subcommand
# to shell out to (confirmed: it always spawns `next start`, no CLI
# passthrough) - so this replicates what `pi install npm:<pkg>@<version>`
# does under the hood instead of invoking it: an `npm install <pkg>@<version>
# --prefix "$PI_CODING_AGENT_DIR/npm" --legacy-peer-deps` into a real npm
# project at PI_CODING_AGENT_DIR/npm (package.json `{"name":
# "pi-extensions", "private": true}`), plus the package source string in
# PI_CODING_AGENT_DIR/settings.json's `packages` array - both confirmed
# directly from @earendil-works/pi-coding-agent's own
# dist/core/package-manager.js (installNpm/addSourceToSettings). pi-web
# loads that same settings.json/npm tree at runtime via the same
# createAgentSessionServices() used by the `pi` CLI (confirmed from
# pi-web's own lib/rpc-manager.ts), so a package installed this way is
# picked up identically despite never going through `pi install` itself.
#
# Idempotent and version-pinned like every other install in this repo:
# only runs npm install when the installed version differs from the
# pinned one, so a restart doesn't refetch/reinstall on every boot.
CLAUDE_BRIDGE_VERSION="0.6.3"
CLAUDE_BRIDGE_DIR="$PI_CODING_AGENT_DIR/npm/node_modules/pi-claude-bridge"
CLAUDE_BRIDGE_INSTALLED_VERSION=""
if [ -f "$CLAUDE_BRIDGE_DIR/package.json" ]; then
  CLAUDE_BRIDGE_INSTALLED_VERSION=$(node -e "console.log(require('$CLAUDE_BRIDGE_DIR/package.json').version)" 2>/dev/null || echo "")
fi
if [ "$CLAUDE_BRIDGE_INSTALLED_VERSION" != "$CLAUDE_BRIDGE_VERSION" ]; then
  mkdir -p "$PI_CODING_AGENT_DIR/npm"
  if [ ! -f "$PI_CODING_AGENT_DIR/npm/package.json" ]; then
    printf '{\n  "name": "pi-extensions",\n  "private": true\n}\n' > "$PI_CODING_AGENT_DIR/npm/package.json"
  fi
  if [ ! -f "$PI_CODING_AGENT_DIR/npm/.gitignore" ]; then
    printf '*\n!.gitignore\n' > "$PI_CODING_AGENT_DIR/npm/.gitignore"
  fi
  npm install "pi-claude-bridge@$CLAUDE_BRIDGE_VERSION" --prefix "$PI_CODING_AGENT_DIR/npm" --legacy-peer-deps
fi

# Register the package in settings.json's `packages` array (same array
# `pi install` writes to) - additive, preserves any packages already
# recorded there (e.g. rpiv-web-tools, installed separately) rather than
# overwriting the whole file.
node -e "
const fs = require('fs');
const path = '$PI_CODING_AGENT_DIR/settings.json';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
settings.packages = settings.packages || [];
const spec = 'npm:pi-claude-bridge@$CLAUDE_BRIDGE_VERSION';
const alreadyPresent = settings.packages.some((p) => {
  const s = typeof p === 'string' ? p : p.source;
  return typeof s === 'string' && s.startsWith('npm:pi-claude-bridge');
});
if (!alreadyPresent) {
  settings.packages.push(spec);
  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
}
"

# Seed claude-bridge.json ONCE, same non-stomping convention as models.json
# above. provider.plan MUST be "pro" - Chris is on Claude Pro, not Max,
# and the extension's own README confirms its defaults (1M context on
# Opus 4.6/Sonnet 4.6) assume Max unless told otherwise.
if [ ! -f "$PI_CODING_AGENT_DIR/claude-bridge.json" ]; then
  printf '{\n  "provider": {\n    "plan": "pro"\n  }\n}\n' > "$PI_CODING_AGENT_DIR/claude-bridge.json"
fi

# --- @juicesharp/rpiv-web-tools (M-038) ---
#
# Web search for pi, backed by the SearxNG instance already running for
# Turnstone (docker/docker-compose.yml `searxng` service, published on
# 127.0.0.1:8091). Chris's explicit, named confirmation of this exact
# package (2026-07-31) - general-purpose text search is all that's
# needed, no video/PDF backends, over the heavier pi-web-access; see
# M-038's decision log for the full comparison. Same idempotent,
# version-pinned, additive-to-settings.json pattern as pi-claude-bridge
# above.
RPIV_VERSION="2.2.0"
RPIV_DIR="$PI_CODING_AGENT_DIR/npm/node_modules/@juicesharp/rpiv-web-tools"
RPIV_INSTALLED_VERSION=""
if [ -f "$RPIV_DIR/package.json" ]; then
  RPIV_INSTALLED_VERSION=$(node -e "console.log(require('$RPIV_DIR/package.json').version)" 2>/dev/null || echo "")
fi
if [ "$RPIV_INSTALLED_VERSION" != "$RPIV_VERSION" ]; then
  mkdir -p "$PI_CODING_AGENT_DIR/npm"
  if [ ! -f "$PI_CODING_AGENT_DIR/npm/package.json" ]; then
    printf '{\n  "name": "pi-extensions",\n  "private": true\n}\n' > "$PI_CODING_AGENT_DIR/npm/package.json"
  fi
  npm install "@juicesharp/rpiv-web-tools@$RPIV_VERSION" --prefix "$PI_CODING_AGENT_DIR/npm" --legacy-peer-deps
fi

node -e "
const fs = require('fs');
const path = '$PI_CODING_AGENT_DIR/settings.json';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
settings.packages = settings.packages || [];
const spec = 'npm:@juicesharp/rpiv-web-tools@$RPIV_VERSION';
const alreadyPresent = settings.packages.some((p) => {
  const s = typeof p === 'string' ? p : p.source;
  return typeof s === 'string' && s.startsWith('npm:@juicesharp/rpiv-web-tools');
});
if (!alreadyPresent) {
  settings.packages.push(spec);
  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
}
"

exec "$@"
