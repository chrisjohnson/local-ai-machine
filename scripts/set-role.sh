#!/usr/bin/env bash
# Updates a LiteLLM role (big-moe, medium-moe, small-moe,
# big-moe-continue-json, medium-moe-continue-json, etc.) to point at a
# different model service. Reads the port from docker-compose.yml — no
# manual port lookup needed. Changes the role via litellm's Model
# Management API (POST /model/update) — does NOT edit
# docker/litellm/config.yaml, and does NOT restart litellm (DB-backed
# model changes apply live).
#
# The *-continue-json roles carry a response_format JSON schema (pi-continue
# handoff synthesis needs it for strict JSON.parse()); this script preserves
# existing non-model litellm_params on update, since litellm's /model/update
# replaces litellm_params wholesale rather than merging (verified empirically
# 2026-08-07). The roles themselves are seeded by litellm-bootstrap.sh.
#
# Why the API instead of editing a file (2026-07-31 redesign): dynamic
# roles are deliberately NOT tracked in config.yaml at all anymore - see
# that file's own header comment. The old version of this script
# sed-edited config.yaml directly, which meant a role's live value and
# its git-tracked value were the same field, and the first time a
# genuinely NEW role (vision) needed both a committed block AND a live
# flip in one session, that collided as a real git pull conflict.
# Terraform's `lifecycle { ignore_changes }` is the reference model here:
# git codifies that a role exists, the live value is free to drift on
# the server without git ever seeing it, by construction.
#
# Usage:
#   set-role.sh <role> <service-name>
#
# Examples:
#   set-role.sh medium-moe gemma-4-26b-a4b-it--vllm-therock-gfx1151-v1
#   set-role.sh small-moe qwen3.5-4b--vllm-therock-gfx1151-v1
#   set-role.sh big-moe-continue-json laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v2
#
# The service name must match a service defined in docker-compose.yml.
# The role must already exist in litellm's DB (run
# scripts/litellm-bootstrap.sh once if this is a brand-new role name).
#
# Prerequisites:
#   - The target service must be running (docker compose up -d <service>)
#   - yq (YAML processor) must be available
#   - LITELLM_MASTER_KEY available (env var, or read from docker/.env)
#   - litellm's general_settings.store_model_in_db must be true (it is,
#     as of 2026-07-31 - see docker/litellm/config.yaml)

set -euo pipefail

ROLE="${1:?Usage: set-role.sh <role> <service-name>}"
SERVICE="${2:?Usage: set-role.sh <role> <service-name>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="${DOCKER_DIR:-${REPO_ROOT}/docker}"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.yml"
LITELLM_URL="${LITELLM_URL:-http://127.0.0.1:4000}"
ENV_FILE="${LITELLM_ENV_FILE:-${DOCKER_DIR}/.env}"

if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    LITELLM_MASTER_KEY=$(grep -E '^LITELLM_MASTER_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  fi
fi
if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  echo "ERROR: LITELLM_MASTER_KEY not set and not found in $ENV_FILE" >&2
  exit 1
fi

curl_litellm() {
  curl -s -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H "Content-Type: application/json" "$@"
}

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

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Invalid port '${PORT}' for service '${SERVICE}'" >&2
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
  exit 1
fi

echo "Setting ${ROLE} -> ${MODEL_NAME} on port ${PORT}"

# --- Look up the role's existing DB entry (bootstrap or a prior set-role.sh call) ---
# Fetch the role's current entry INCLUDING its litellm_params so we can
# preserve extra params (e.g. response_format on the *-continue-json roles)
# on update - litellm's /model/update REPLACES litellm_params wholesale
# rather than merging (verified empirically 2026-08-07), so a naive
# {model, api_base, api_key} update would silently drop the JSON-schema
# forcing pi-continue depends on. We keep any non-standard keys; model/
# api_base/api_key are overwritten below.
EXISTING_INFO=$(curl_litellm "$LITELLM_URL/model/info" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in d.get('data', []):
    # Prefer the DB-backed entry (db_model true). A config-file entry for the
    # same name can only appear if it's still a static model_list route (the
    # old *-continue-json design) and is not updatable via /model/update.
    if m.get('model_name') == '${ROLE}' and m.get('model_info', {}).get('db_model'):
        out = {
            'id': m.get('model_info', {}).get('id') or '',
            'extra_params': {k: v for k, v in m.get('litellm_params', {}).items()
                             if k not in ('model', 'api_base', 'api_key')}
        }
        print(json.dumps(out))
        break
" 2>/dev/null || echo "{}")

EXISTING_ID=$(echo "$EXISTING_INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
EXTRA_PARAMS=$(echo "$EXISTING_INFO" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('extra_params',{})))" 2>/dev/null || echo "{}")

NEW_PARAMS=$(python3 -c "
import json
params = {'model': 'openai/${MODEL_NAME}', 'api_base': 'http://127.0.0.1:${PORT}/v1', 'api_key': 'none'}
extra = json.loads('${EXTRA_PARAMS}')
if extra:
    params = {**extra, **params}
print(json.dumps(params))
")

if [[ -n "$EXISTING_ID" ]]; then
  RESULT=$(curl_litellm -X POST "$LITELLM_URL/model/update" --data-binary "{
    \"model_info\": {\"id\": \"${EXISTING_ID}\"},
    \"litellm_params\": ${NEW_PARAMS}
  }")
  OK=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if not d.get('error') else 'ERROR: ' + str(d))" 2>/dev/null || echo "ERROR: could not parse response: $RESULT")
else
  echo "  No existing DB entry for role '${ROLE}' - creating one (did you mean to run scripts/litellm-bootstrap.sh first? proceeding anyway)." >&2
  RESULT=$(curl_litellm -X POST "$LITELLM_URL/model/new" --data-binary "{
    \"model_name\": \"${ROLE}\",
    \"litellm_params\": ${NEW_PARAMS},
    \"model_info\": {}
  }")
  OK=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'model_name' in d else 'ERROR: ' + str(d))" 2>/dev/null || echo "ERROR: could not parse response: $RESULT")
fi

if [[ "$OK" != "ok" ]]; then
  echo "ERROR: update/create failed - $OK" >&2
  exit 1
fi

# Verify the change actually landed and answers real requests, rather
# than trusting the API's 200 response alone (same discipline this repo
# applies everywhere else - never call an update "done" without checking).
sleep 1
VERIFY=$(curl_litellm "$LITELLM_URL/v1/chat/completions" --data-binary "{\"model\": \"${ROLE}\", \"messages\": [{\"role\": \"user\", \"content\": \"reply with exactly: OK\"}], \"max_tokens\": 300}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
choice = (d.get('choices') or [{}])[0]
content = choice.get('message', {}).get('content')
print('VERIFIED' if content else 'NOT VERIFIED: ' + str(d))
" 2>/dev/null || echo "NOT VERIFIED: response was not valid JSON")

echo "Done. ${ROLE} now routes to ${MODEL_NAME} on port ${PORT} (no restart needed - DB-backed change applies live)."
echo "Live verification: ${VERIFY}"
