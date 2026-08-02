#!/bin/sh
# Seed oh-my-pi's model config ONCE, only if it doesn't already exist — same
# non-stomping convention as pi-web/docker-entrypoint.sh (which seeds pi-web's
# models.json at $PI_CODING_AGENT_DIR). omp reads its provider registry from
# $PI_CONFIG_DIR/agent/models.yml (YAML preferred; .yaml fallback; a legacy
# models.json at the same path is auto-migrated to YAML on first load), so this
# seeds the native YAML path. Unlike pi-web, omp has no in-session Models panel
# that writes this same file, but the seed-once convention is kept anyway: omp's
# /models and plugin flows both mutate config under the agent dir, and a config
# the user deliberately edited should not be resurrected on every restart.
#
# Guard is deliberately stricter than "does models.yml exist": seeding a fresh
# models.yml when the user already has models.yaml (the fallback) or a legacy
# models.json would create a higher-precedence file that silently shadows what
# they configured. Skip seeding if any of the three exists.
set -e

# PI_CONFIG_DIR is a directory NAME joined under $HOME (default ".omp"), per
# omp's own resolution (path.join(os.homedir(), PI_CONFIG_DIR) in
# @oh-my-pi/pi-utils/dirs). An absolute value is honored as-is for completeness.
if [ -z "$PI_CONFIG_DIR" ]; then
  CONFIG_ROOT="$HOME/.omp"
elif [ "${PI_CONFIG_DIR#/}" != "$PI_CONFIG_DIR" ]; then
  CONFIG_ROOT="$PI_CONFIG_DIR"
else
  CONFIG_ROOT="$HOME/$PI_CONFIG_DIR"
fi
MODELS_DIR="$CONFIG_ROOT/agent"

mkdir -p "$MODELS_DIR"

if [ ! -f "$MODELS_DIR/models.yml" ] && [ ! -f "$MODELS_DIR/models.yaml" ] && [ ! -f "$MODELS_DIR/models.json" ]; then
  if [ -z "$LITELLM_MASTER_KEY" ]; then
    echo "LITELLM_MASTER_KEY is not set - refusing to seed models.yml with no way to authenticate to litellm." >&2
    exit 1
  fi
  # Substitute the real key at startup - the committed template has a
  # placeholder, never a real secret (docker/.env, read at runtime only).
  sed "s/__LITELLM_MASTER_KEY__/$LITELLM_MASTER_KEY/" /app/.omp/agent/models.seed.yml.tmpl > "$MODELS_DIR/models.yml"
fi

exec "$@"
