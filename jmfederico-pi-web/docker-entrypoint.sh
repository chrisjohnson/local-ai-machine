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
# big-moe/laguna model (summarizerModel: "inherit" -> session default) and
# used to fail the default timeout; pin it to "big-moe-continue-json" (a
# scoped litellm route, see docker/litellm/config.yaml, that forces a
# json_schema response_format matching pi-continue's artifact shape — the
# plain "big-moe" role is a thinking model that prepends prose the strict
# JSON.parse() rejects) and give it a 300s synthesisTimeoutMs (large handoff
# contexts can burn 140s+ on prompt processing alone before generation
# starts). The json_schema fix was empirically verified against the laguna
# backend (2026-08-03, ~19s in testing) before this route replaced the
# earlier "medium-moe-continue-json" (qwen3.6-35b, formerly "coder-
# continue-json") pin, which remains available as a known-good fallback.
if [ ! -f "$CONFIG_ROOT/extensions/pi-continue.json" ]; then
  mkdir -p "$CONFIG_ROOT/extensions"
  cp /app/.pi-web/pi-continue.seed.json "$CONFIG_ROOT/extensions/pi-continue.json"
fi

# Always sync pi-continue-companion (our own PI WEB plugin, not user-editable
# via the UI) into place on every start, overwriting whatever was there
# before. Unlike the seed-once files above, this should never go stale: it's
# actively-developed code baked into the image, so a container restart must
# always pick up the latest build rather than keep an old copy from a
# previous image around.
if [ -d /app/.pi-web/plugins-seed/pi-continue-companion ]; then
  mkdir -p "$CONFIG_ROOT/plugins"
  rm -rf "$CONFIG_ROOT/plugins/pi-continue-companion"
  cp -r /app/.pi-web/plugins-seed/pi-continue-companion "$CONFIG_ROOT/plugins/pi-continue-companion"
fi

# Always sync pi-web-factory-prompts (our own pi-coding-agent EXTENSION, not
# user-editable via the UI, and not a PI WEB plugin like the one above -- see
# plugins/pi-web-factory-prompts/index.ts) into place on every start, same
# reasoning as pi-continue-companion's sync above: actively-developed code
# baked into the image, a container restart must always pick up the latest
# build. Lands in extensions/ (one of pi-coding-agent's own auto-discovered
# global extension locations, *.ts or */index.ts under
# $PI_CODING_AGENT_DIR/extensions/), not plugins/ -- these are two genuinely
# different mechanisms (M-069).
if [ -d /app/.pi-web/extensions-seed/pi-web-factory-prompts ]; then
  mkdir -p "$CONFIG_ROOT/extensions"
  rm -rf "$CONFIG_ROOT/extensions/pi-web-factory-prompts"
  cp -r /app/.pi-web/extensions-seed/pi-web-factory-prompts "$CONFIG_ROOT/extensions/pi-web-factory-prompts"
fi

# Always sync pi-web-factory (our own control-plane CLI, M-068) into place on
# every start, same reasoning as the syncs above: actively-developed code
# baked into the image, a container restart must always pick up the latest
# build. Lands OUTSIDE $CONFIG_ROOT at a fixed, well-known path
# ($HOME/pi-web-factory) so a triggering Skill's bash tool (M-072) can invoke
# `bun $HOME/pi-web-factory/cli.ts ...` regardless of which project a
# session targets. factory.db is NOT under this path (the Dockerfile points
# PI_WEB_FACTORY_DB_PATH at $CONFIG_ROOT instead, which this rm -rf never
# touches) — see cli.ts's PI_WEB_FACTORY_DB_PATH doc comment.
if [ -d /app/.pi-web/pi-web-factory-seed ]; then
  rm -rf "$HOME/pi-web-factory"
  cp -r /app/.pi-web/pi-web-factory-seed "$HOME/pi-web-factory"
fi

# Always sync the pi-web-factory Agent Skill (M-072) into place on every
# start, same reasoning as the syncs above. Lands in skills/ under
# $CONFIG_ROOT (pi's own auto-discovered $PI_CODING_AGENT_DIR/skills/<name>/
# SKILL.md location), unlike the CLI code sync above which deliberately
# lands outside $CONFIG_ROOT.
if [ -d /app/.pi-web/skills-seed/pi-web-factory ]; then
  mkdir -p "$CONFIG_ROOT/skills"
  rm -rf "$CONFIG_ROOT/skills/pi-web-factory"
  cp -r /app/.pi-web/skills-seed/pi-web-factory "$CONFIG_ROOT/skills/pi-web-factory"
fi

exec "$@"
