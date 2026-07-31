#!/usr/bin/env bash
# Updates a LiteLLM role (coder, judge, etc.) to point at a different model
# service. Reads the port from docker-compose.yml — no manual port lookup
# needed. Updates the litellm config file and restarts the litellm container.
#
# Usage:
#   set-role.sh <role> <service-name>
#
# Examples:
#   set-role.sh coder gemma-4-26b-a4b-it--vllm-therock-gfx1151-v1
#   set-role.sh judge qwen3.5-4b--vllm-therock-gfx1151-v1
#
# The service name must match a service defined in docker-compose.yml.
# The script reads:
#   1. The host port from the service's port mapping
#   2. The model's public name from the service's command — either vLLM's
#      --served-model-name or llama.cpp's -a/--alias flag (whichever is
#      present; --served-model-name is tried first)
# It then updates the corresponding role entry in the litellm config
# and restarts the litellm container.
#
# Prerequisites:
#   - The target service must be running (docker compose up -d <service>)
#   - yq (YAML processor) must be available

set -euo pipefail

ROLE="${1:?Usage: set-role.sh <role> <service-name>}"
SERVICE="${2:?Usage: set-role.sh <role> <service-name>}"

DOCKER_DIR="${DOCKER_DIR:-$(dirname "$0")/../docker}"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.yml"
LITELLM_CONFIG="${LITELLM_CONFIG:-${DOCKER_DIR}/litellm/config.yaml}"
LITELLM_CONTAINER="${LITELLM_CONTAINER:-litellm-proxy}"

# --- Parse port from docker-compose.yml ---
PORT=$(
  yq -r "
    .services.\"${SERVICE}\".ports[] |
    select(startswith(\"127.0.0.1:\")) |
    split(\":\")[1]
  " "$COMPOSE_FILE" 2>/dev/null | head -1
)

if [[ -z "$PORT" ]]; then
  echo "ERROR: Could not find port for service '${SERVICE}' in ${COMPOSE_FILE}" >&2
  echo "Available services:" >&2
  yq -r '.services | keys[]' "$COMPOSE_FILE" 2>/dev/null | grep -v '^\.' >&2
  exit 1
fi

# --- Parse the model's public name from the service's command ---
# Try vLLM's --served-model-name first, then llama.cpp's -a/--alias.
COMMAND_STR=$(yq -r ".services.\"${SERVICE}\".command // \"\"" "$COMPOSE_FILE" 2>/dev/null | tr '\n' ' ')

MODEL_NAME=$(grep -oP '(?<=--served-model-name )\S+' <<< "$COMMAND_STR" || true)

if [[ -z "$MODEL_NAME" || "$MODEL_NAME" == "null" ]]; then
  MODEL_NAME=$(grep -oP '(?<=--alias )\S+' <<< "$COMMAND_STR" || true)
fi

if [[ -z "$MODEL_NAME" || "$MODEL_NAME" == "null" ]]; then
  MODEL_NAME=$(grep -oP '(?<=-a )\S+' <<< "$COMMAND_STR" || true)
fi

if [[ -z "$MODEL_NAME" || "$MODEL_NAME" == "null" ]]; then
  echo "ERROR: Could not find --served-model-name (vLLM) or -a/--alias (llama.cpp) in service '${SERVICE}' command" >&2
  echo "This script only supports services with one of those flags." >&2
  echo "For Ollama or other backends, update the litellm config manually." >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Invalid port '${PORT}' for service '${SERVICE}'" >&2
  exit 1
fi

if [[ ! -f "$LITELLM_CONFIG" ]]; then
  echo "ERROR: LiteLLM config not found at ${LITELLM_CONFIG}" >&2
  exit 1
fi

echo "Setting ${ROLE} -> ${MODEL_NAME} on port ${PORT}"

# --- Update litellm config ---
# Uses temp file + mv for GNU/BSD sed portability. Deliberately text-based
# (sed/awk), not `yq -i` on the whole file: this config.yaml has extensive
# header/inline comments (two-tier design rationale, per-service GPU notes)
# that a full YAML-parse-and-reserialize risks reformatting or dropping -
# minimal targeted line edits only.

if grep -qE "^  - model_name: ${ROLE}\$" "$LITELLM_CONFIG"; then
  # --- Role already exists: update its block in place ---
  # Two edits within the role's YAML block:
  #   1. model: openai/<old> → model: openai/${MODEL_NAME}
  #   2. api_base: http://... → api_base: http://127.0.0.1:${PORT}/v1
  TMPFILE=$(mktemp)
  trap 'rm -f "$TMPFILE"' EXIT

  sed "/model_name: ${ROLE}/,/model_name:/{s|model: openai/.*|model: openai/${MODEL_NAME}|}" "$LITELLM_CONFIG" > "$TMPFILE"
  mv "$TMPFILE" "$LITELLM_CONFIG"

  if sed -n "/model_name: ${ROLE}/,/model_name:/p" "$LITELLM_CONFIG" |
     grep -q 'api_base:'; then
    TMPFILE=$(mktemp)
    sed "/model_name: ${ROLE}/,/model_name:/{s|api_base:.*|api_base: http://127.0.0.1:${PORT}/v1|}" "$LITELLM_CONFIG" > "$TMPFILE"
    mv "$TMPFILE" "$LITELLM_CONFIG"
    echo "  Updated model + api_base for ${ROLE} -> ${MODEL_NAME} on :${PORT}"
  else
    # Existing block has no api_base line yet - insert one right after
    # this block's `model:` line. (Bug fixed here: the previous version
    # used a literal `role` string in the awk pattern instead of the
    # shell variable's value, so this branch could never actually match
    # anything - silently did nothing while still printing success.)
    TMPFILE=$(mktemp)
    awk -v role="$ROLE" -v port="$PORT" '
      $0 ~ ("model_name: " role) { found=1 }
      found && /model: openai/ { print; printf "      api_base: http://127.0.0.1:%s/v1\n", port; found=0; next }
      { print }
    ' "$LITELLM_CONFIG" > "$TMPFILE"
    mv "$TMPFILE" "$LITELLM_CONFIG"
    echo "  Updated model, added api_base for ${ROLE} -> ${MODEL_NAME} on :${PORT}"
  fi
else
  # --- Role doesn't exist yet: create a new block ---
  # The old version of this script silently did nothing in this case (a
  # sed range on a non-matching address is a no-op, but the script still
  # printed "Done" regardless) - confirmed live, 2026-07-31, creating the
  # `vision` role for the first time. Insert a new block, anchored on the
  # "Static roles" comment marker if present (keeps new roles grouped
  # with the other set-role.sh-managed ones), or appended at the end of
  # model_list otherwise. Error loudly if neither anchor can be found,
  # rather than silently doing nothing again.
  if grep -qF '# Static roles — not managed by set-role.sh.' "$LITELLM_CONFIG"; then
    TMPFILE=$(mktemp)
    awk -v role="$ROLE" -v model="$MODEL_NAME" -v port="$PORT" '
      /# Static roles — not managed by set-role\.sh\./ && !inserted {
        printf "  - model_name: %s\n    litellm_params:\n      model: openai/%s\n      api_base: http://127.0.0.1:%s/v1\n      api_key: \"none\"\n\n", role, model, port
        inserted=1
      }
      { print }
    ' "$LITELLM_CONFIG" > "$TMPFILE"
    mv "$TMPFILE" "$LITELLM_CONFIG"
    echo "  Created new role ${ROLE} -> ${MODEL_NAME} on :${PORT} (before the Static roles marker)"
  elif grep -qE '^model_list:' "$LITELLM_CONFIG"; then
    printf '\n  - model_name: %s\n    litellm_params:\n      model: openai/%s\n      api_base: http://127.0.0.1:%s/v1\n      api_key: "none"\n' \
      "$ROLE" "$MODEL_NAME" "$PORT" >> "$LITELLM_CONFIG"
    echo "  Created new role ${ROLE} -> ${MODEL_NAME} on :${PORT} (appended to end of file)"
  else
    echo "ERROR: Could not find an anchor to insert a new role block (no 'Static roles' marker, no 'model_list:' key found in ${LITELLM_CONFIG})" >&2
    echo "Add the ${ROLE} block manually." >&2
    exit 1
  fi
fi

# Verify the edit actually landed - the whole point of this fix is to
# never again print success when nothing changed.
if ! grep -qE "^  - model_name: ${ROLE}\$" "$LITELLM_CONFIG"; then
  echo "ERROR: ${ROLE} block still not found in ${LITELLM_CONFIG} after edit - something went wrong, not restarting litellm." >&2
  exit 1
fi

# --- Restart litellm ---
echo "Restarting ${LITELLM_CONTAINER}..."
docker restart "$LITELLM_CONTAINER" >/dev/null

echo "Done. ${ROLE} now routes to ${MODEL_NAME} on port ${PORT}."
echo "Verify: curl -sf http://localhost:4000/v1/models | python3 -m json.tool"
