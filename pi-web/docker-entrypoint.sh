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

# --- pi-claude-bridge auth (M-039) ---
#
# Previously staged a copied ~/.claude/.credentials.json here (same
# ownership-fix pattern as the SSH deploy key). Confirmed NOT to work:
# reproduced live, in isolation, that a bare-credentials-file environment
# (missing whatever interactive-login-only state the Agent SDK's own
# auth-profile-fetch step needs) hits "401 OAuth access token has been
# revoked" even though the identical file works fine through the plain
# `claude` CLI. Replaced with CLAUDE_CODE_OAUTH_TOKEN (set directly as a
# container env var in docker-compose.yml - no file staging needed at
# all) - the actual documented mechanism for headless/CI use of a Claude
# subscription (`claude setup-token`, 1-year token). Simpler and
# confirmed working, unlike the file-copy approach.

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
