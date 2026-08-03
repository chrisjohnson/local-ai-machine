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

# Seed the pi-continue extension config once. pi-continue reads this path
# ($PI_CODING_AGENT_DIR/extensions/pi-continue.json), not the npm:pi-continue
# block in settings.json. Defaults would put handoff synthesis on the slow
# planner/laguna model (summarizerModel: "inherit" -> session default) and
# fail the default timeout; pin it to "coder-continue-json" (a scoped
# litellm route, see docker/litellm/config.yaml, that forces a json_schema
# response_format matching pi-continue's artifact shape — the plain "coder"
# role is a thinking model that prepends prose the strict JSON.parse()
# rejects) and give it a 300s synthesisTimeoutMs (large handoff contexts can
# burn 140s+ on prompt processing alone before generation starts).
if [ ! -f "$CONFIG_ROOT/extensions/pi-continue.json" ]; then
  mkdir -p "$CONFIG_ROOT/extensions"
  cp /app/.pi-web/pi-continue.seed.json "$CONFIG_ROOT/extensions/pi-continue.json"
fi

exec "$@"
