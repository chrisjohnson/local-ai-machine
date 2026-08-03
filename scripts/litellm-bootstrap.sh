#!/usr/bin/env bash
# Seeds litellm's dynamic roles (coder, judge, vision, orchestrator) in its own database
# via the Model Management API (POST /model/new), if they don't already
# exist there. Idempotent - safe to re-run any time (fresh deploy, DB
# volume recreated, etc.).
#
# This exists because dynamic roles are DELIBERATELY not tracked in
# docker/litellm/config.yaml (see that file's own header comment for the
# full rationale - terraform-style "codified resource, runtime value
# allowed to drift without a git conflict", 2026-07-31 design). Without
# this script, a fresh litellm DB would have no "coder"/"judge"/"vision"
# roles at all until someone manually ran set-role.sh once - this closes
# that gap (previously mirrored by scripts/turnstone-bootstrap.sh for the
# now-decommissioned Turnstone service's own DB-only settings).
#
# The values this script seeds are DELIBERATELY non-functional stubs, not
# real model references - a role only becomes actually useful after a
# real `scripts/set-role.sh <role> <service>` call. Do NOT read this
# script's stub values as a description of any real model; do NOT assume
# editing them here changes anything live (it doesn't - they're a one-time
# seed, checked against what's already in the DB, never re-applied once
# a role exists).
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
ROLES=(coder judge vision orchestrator planner)

STUB_MODEL="UNCONFIGURED-run-set-role.sh"
STUB_API_BASE="http://unconfigured.invalid/v1"

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

echo "== Seeding dynamic roles in litellm's DB (idempotent) =="
for role in "${ROLES[@]}"; do
  existing=$(curl_litellm "$LITELLM_URL/model/info" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in d.get('data', []):
    if m.get('model_name') == '$role':
        print(m.get('model_info', {}).get('id') or '')
        break
" 2>/dev/null || true)

  if [[ -n "$existing" ]]; then
    echo "  $role: already exists (id=$existing), skipping"
    continue
  fi

  result=$(curl_litellm -X POST "$LITELLM_URL/model/new" --data-binary "{
    \"model_name\": \"$role\",
    \"litellm_params\": {\"model\": \"openai/$STUB_MODEL\", \"api_base\": \"$STUB_API_BASE\", \"api_key\": \"none\"},
    \"model_info\": {}
  }")
  ok=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'model_name' in d else 'ERROR: ' + str(d))" 2>/dev/null || echo "ERROR: could not parse response")
  echo "  $role: seeded stub - $ok"
done

echo "== Done. Stub values are placeholders only - run scripts/set-role.sh <role> <service> to make a role real. =="
