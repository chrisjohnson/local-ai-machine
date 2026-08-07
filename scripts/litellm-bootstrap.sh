#!/usr/bin/env bash
# Seeds litellm's dynamic roles (big-moe, medium-moe, medium-dense,
# small-moe, small-dense - named by model size + architecture, not
# function) in its own database via the Model Management API
# (POST /model/new), if they don't already exist there. Idempotent - safe
# to re-run any time (fresh deploy, DB volume recreated, etc.).
#
# This exists because dynamic roles are DELIBERATELY not tracked in
# docker/litellm/config.yaml (see that file's own header comment for the
# full rationale - terraform-style "codified resource, runtime value
# allowed to drift without a git conflict", 2026-07-31 design). Without
# this script, a fresh litellm DB would have no "big-moe"/"medium-moe"/
# "small-moe"/etc. roles at all until someone manually ran set-role.sh
# once - this closes that gap (previously mirrored by
# scripts/turnstone-bootstrap.sh for the now-decommissioned Turnstone
# service's own DB-only settings).
#
# Role names were renamed 2026-08-03 from function-based names (coder,
# judge, vision, orchestrator, planner) to size+architecture-based names.
# judge and orchestrator, which had already collapsed onto the same
# physical backend, collapsed into the single role small-moe.
#
# The values this script seeds are DELIBERATELY non-functional stubs, not
# real model references - a role only becomes actually useful after a
# real `scripts/set-role.sh <role> <service>` call. Do NOT read this
# script's stub values as a description of any real model; do NOT assume
# editing them here changes anything live (it doesn't - they're a one-time
# seed, checked against what's already in the DB, never re-applied once
# a role exists).
#
# EXCEPTION — the two *-continue-json roles: these were static
# model_list entries in docker/litellm/config.yaml (2026-08-03) because
# set-role.sh (DB-backed only) couldn't manage them. Converted to
# DB-backed roles 2026-08-07 (Chris's directive) so set-role.sh works on
# them. Unlike the stubs above, they're seeded with REAL backend values
# (the standing laguna v2 / ornith q4 pair) PLUS their response_format
# JSON-schema (kept in docker/litellm/pi-continue-v4-schema.json - the
# hand-maintained mirror of pi-continue's HISTORY_ARTIFACT_VERSION v4
# shape), because pi-continue's handoff synthesis does a strict
# JSON.parse() with zero tolerance for preamble; the schema is what makes
# llama.cpp grammar-constrain the "content" channel. set-role.sh preserves
# extra litellm_params (incl. response_format) on update, so reassigning
# these roles later keeps the schema intact.
#
# Usage:
#   LITELLM_MASTER_KEY=sk-... ./scripts/litellm-bootstrap.sh
# or, run on the box itself with the key already in docker/.env:
#   ./scripts/litellm-bootstrap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LITELLM_URL="${LITELLM_URL:-http://127.0.0.1:4000}"
ENV_FILE="${LITELLM_ENV_FILE:-$REPO_ROOT/docker/.env}"

# The full set of dynamic roles this repo currently expects to exist.
# Add new role names here when a new one is introduced (e.g. by an
# M-0xx card) - this is the one place that needs a git commit when a
# genuinely new role category is added; which model backs it never does.
ROLES=(big-moe medium-moe medium-dense small-moe small-dense)

STUB_MODEL="UNCONFIGURED-run-set-role.sh"
STUB_API_BASE="http://unconfigured.invalid/v1"

# The two *-continue-json roles: DB-backed (see header comment), seeded
# with the schema + the current standing backends. Key: <role>, value:
# "<model>|<api_base>". Reassign later with set-role.sh, not by editing
# these values (they're a one-time seed, never re-applied once a role
# exists).
CONTINUE_JSON_SCHEMA_FILE="$REPO_ROOT/docker/litellm/pi-continue-v4-schema.json"
declare -A CONTINUE_JSON_ROLES=(
  [big-moe-continue-json]="openai/laguna-s-2.1-118b-q4km|http://127.0.0.1:8108/v1"
  [medium-moe-continue-json]="openai/ornith-1.0-35b-mtp-q4|http://127.0.0.1:8113/v1"
)

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

role_exists() {
  local role="$1"
  curl_litellm "$LITELLM_URL/model/info" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in d.get('data', []):
    # Only a DB-backed entry counts as seeded (db_model true). A config-file
    # entry (db_model false) for the same name — e.g. the old static
    # *-continue-json routes pre-migration — must NOT suppress seeding,
    # or the DB entry would never be created.
    if m.get('model_name') == '$role' and m.get('model_info', {}).get('db_model'):
        print(m.get('model_info', {}).get('id') or '')
        break
" 2>/dev/null || true
}

seed_role() {
  local role="$1"
  local params_json="$2"

  existing=$(role_exists "$role")
  if [[ -n "$existing" ]]; then
    echo "  $role: already exists (id=$existing), skipping"
    return 0
  fi

  result=$(curl_litellm -X POST "$LITELLM_URL/model/new" --data-binary "{
    \"model_name\": \"$role\",
    \"litellm_params\": $params_json,
    \"model_info\": {}
  }")
  ok=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'model_name' in d else 'ERROR: ' + str(d))" 2>/dev/null || echo "ERROR: could not parse response")
  echo "  $role: seeded - $ok"
}

echo "== Seeding dynamic roles in litellm's DB (idempotent) =="
for role in "${ROLES[@]}"; do
  seed_role "$role" "{\"model\": \"openai/$STUB_MODEL\", \"api_base\": \"$STUB_API_BASE\", \"api_key\": \"none\"}"
done

echo "== Seeding *-continue-json roles (schema-carrying) =="
if [[ ! -f "$CONTINUE_JSON_SCHEMA_FILE" ]]; then
  echo "ERROR: schema file not found: $CONTINUE_JSON_SCHEMA_FILE" >&2
  exit 1
fi
for role in "${!CONTINUE_JSON_ROLES[@]}"; do
  backend="${CONTINUE_JSON_ROLES[$role]}"
  model="${backend%%|*}"
  api_base="${backend##*|}"
  params=$(python3 -c "
import json
with open('$CONTINUE_JSON_SCHEMA_FILE') as f:
    schema = json.load(f)
params = {'model': '$model', 'api_base': '$api_base', 'api_key': 'none', 'response_format': schema}
print(json.dumps(params))
")
  seed_role "$role" "$params"
done

echo "== Done. Stub values are placeholders only - run scripts/set-role.sh <role> <service> to make a role real. =="
