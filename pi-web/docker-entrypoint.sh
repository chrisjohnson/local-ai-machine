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
exec "$@"
