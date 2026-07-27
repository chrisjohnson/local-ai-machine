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
#   2. The served model name from the service's --served-model-name flag
# It then updates the corresponding model entry in the litellm config
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

# --- Parse served model name from the service's command ---
MODEL_NAME=$(
  yq -r "
    .services.\"${SERVICE}\".command // \"\" |
    split(\" \") |
    map(select(. == \"--served-model-name\")) |
    length as \$idx |
    . as \$parts |
    reduce range(\$idx) as \$i (0; . + 1) |
    \$parts[.]
  " "$COMPOSE_FILE" 2>/dev/null
)

# Fallback: direct grep (more robust for multiline YAML strings)
if [[ -z "$MODEL_NAME" || "$MODEL_NAME" == "null" ]]; then
  MODEL_NAME=$(
    yq -r ".services.\"${SERVICE}\".command // \"\"" "$COMPOSE_FILE" 2>/dev/null |
    tr '\n' ' ' |
    grep -oP '(?<=--served-model-name )\S+'
  )
fi

if [[ -z "$MODEL_NAME" || "$MODEL_NAME" == "null" ]]; then
  echo "ERROR: Could not find --served-model-name in service '${SERVICE}' command" >&2
  echo "This script only supports services with a --served-model-name flag (vLLM)." >&2
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
# Update the role's block (model_name: ${ROLE}) to point at the new model.
# Two edits within the role's YAML block:
#   1. model: openai/<old> → model: openai/${MODEL_NAME}
#   2. api_base: http://... → api_base: http://127.0.0.1:${PORT}/v1

# Replace model: line within the role's block
sed -i '' "/model_name: ${ROLE}/,/model_name:/{s|model: openai/.*|model: openai/${MODEL_NAME}|}" "$LITELLM_CONFIG"

# Replace or add api_base: line within the role's block
if sed -n "/model_name: ${ROLE}/,/model_name:/p" "$LITELLM_CONFIG" |
   grep -q 'api_base:'; then
  sed -i '' "/model_name: ${ROLE}/,/model_name:/{s|api_base:.*|api_base: http://127.0.0.1:${PORT}/v1|}" "$LITELLM_CONFIG"
  echo "  Updated model + api_base for ${ROLE} -> ${MODEL_NAME} on :${PORT}"
else
  # Insert api_base after model: line
  sed -i '' "/model_name: ${ROLE}/a\\
\\        api_base: http://127.0.0.1:${PORT}/v1
" "$LITELLM_CONFIG"
  echo "  Updated model, added api_base for ${ROLE} -> ${MODEL_NAME} on :${PORT}"
fi

# --- Restart litellm ---
echo "Restarting ${LITELLM_CONTAINER}..."
docker restart "$LITELLM_CONTAINER" >/dev/null

echo "Done. ${ROLE} now routes to ${MODEL_NAME} on port ${PORT}."
echo "Verify: curl -sf http://localhost:4000/v1/models | python3 -m json.tool"
