#!/bin/sh
# Seed pi-web's model config ONCE, only if it doesn't already exist.
# pi-web expects its models configuration in JSON format at $PI_CODING_AGENT_DIR.
# The template carries a __LITELLM_MASTER_KEY__ placeholder, substituted at 
# runtime only when the config file is first created.

set -e

if [ -z "$PI_CODING_AGENT_DIR" ]; then
  CONFIG_ROOT="$HOME/.pi-web"
else
  CONFIG_ROOT="$PI_CODING_AGENT_DIR"
fi

mkdir -p "$CONFIG_ROOT"

if [ ! -f "$CONFIG_ROOT/models.json" ]; then
  if [ -z "$LITELLM_MASTER_KEY" ]; then
    echo "LITELLM_MASTER_KEY is not set - refusing to seed models.json with no way to authenticate to litellm." >&2
    exit 1
  fi
  
  # Substitute the real key at startup
  sed "s/__LITELLM_MASTER_KEY__/$LITELLM_MASTER_KEY/" /app/.pi-web/models.seed.json.tmpl > "$CONFIG_ROOT/models.json"
fi

# Seed the settings.json file to automatically trigger package installations
if [ ! -f "$CONFIG_ROOT/settings.json" ]; then
  cp /app/.pi-web/settings.seed.json "$CONFIG_ROOT/settings.json"
fi

exec "$@"
