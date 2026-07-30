#!/usr/bin/env bash
# Applies this repo's declarative Turnstone config (docker/turnstone/settings.json,
# docker/turnstone/skills/*.json) against a live Turnstone instance's admin API.
#
# Turnstone's judge/model settings and skills live ONLY in its Postgres database
# (turnstone_postgres_data) - nothing in docker-compose.yml or config.toml governs
# them. Without this script, that state exists only as a series of manual PUT/POST
# calls made once, with no reproducible record - a fresh Postgres volume (disaster
# recovery, a new deploy elsewhere) would silently revert everything to Turnstone's
# out-of-the-box defaults. This script is the reproducibility layer for that gap.
#
# Idempotent - safe to re-run any time (after a redeploy, after editing
# docker/turnstone/settings.json or a skill file, etc.). Settings are always
# re-applied (a plain PUT); skills are created if missing, updated only if content
# actually changed.
#
# Does NOT bootstrap: the admin user/token (a one-time identity setup, not
# reproducible config - see secrets/admin-turnstone-password.txt), or the
# "printer-dashboard" Project entity (no admin REST API or model-facing tool
# exists for project creation as of Turnstone 1.7.4 - confirmed by checking both
# the server's and console's openapi.json and the full tools/ directory; this is
# a known gap, not an oversight here).
#
# Usage:
#   TURNSTONE_ADMIN_TOKEN=ts_... ./scripts/turnstone-bootstrap.sh
# or, run on the box itself with the token already in docker/.env:
#   ./scripts/turnstone-bootstrap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CONSOLE_URL="${TURNSTONE_CONSOLE_URL:-http://127.0.0.1:8090}"
ENV_FILE="${TURNSTONE_ENV_FILE:-$REPO_ROOT/docker/.env}"

if [[ -z "${TURNSTONE_ADMIN_TOKEN:-}" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    TURNSTONE_ADMIN_TOKEN=$(grep -E '^TURNSTONE_ADMIN_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  fi
fi
if [[ -z "${TURNSTONE_ADMIN_TOKEN:-}" ]]; then
  echo "ERROR: TURNSTONE_ADMIN_TOKEN not set and not found in $ENV_FILE" >&2
  echo "Set it directly, or add TURNSTONE_ADMIN_TOKEN=ts_... to docker/.env" >&2
  echo "(a token with 'approve' scope is required - see turnstone-admin create-token --scopes read,write,approve)" >&2
  exit 1
fi

curl_admin() {
  curl -s -H "Authorization: Bearer $TURNSTONE_ADMIN_TOKEN" -H "Content-Type: application/json" "$@"
}

echo "== Applying settings from docker/turnstone/settings.json =="
python3 -c "
import json
d = json.load(open('$REPO_ROOT/docker/turnstone/settings.json'))
for k, v in d.items():
    if k.startswith('_'):
        continue
    print(k)
    print(json.dumps(v))
" | while IFS= read -r key && IFS= read -r value_json; do
  result=$(curl_admin -X PUT --data-binary "{\"value\": $value_json}" "$CONSOLE_URL/v1/api/admin/settings/$key")
  applied=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('value', d.get('error','ERROR')))" 2>/dev/null || echo "ERROR")
  echo "  $key = $applied"
done

echo "== Applying skills from docker/turnstone/skills/*.json =="
for meta_file in "$REPO_ROOT"/docker/turnstone/skills/*.json; do
  [[ -e "$meta_file" ]] || continue
  name=$(python3 -c "import json; print(json.load(open('$meta_file'))['name'])")
  content_file=$(python3 -c "import json; print(json.load(open('$meta_file'))['content_file'])")
  content_path="$REPO_ROOT/docker/turnstone/skills/$content_file"

  existing=$(curl_admin "$CONSOLE_URL/v1/api/admin/skills" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d.get('skills', d if isinstance(d, list) else []):
    if isinstance(s, dict) and s.get('name') == '$name':
        print(s.get('id') or s.get('skill_id') or s.get('template_id') or '')
        break
")

  payload=$(python3 -c "
import json
meta = json.load(open('$meta_file'))
meta.pop('content_file', None)
meta['content'] = open('$content_path').read()
print(json.dumps(meta))
")

  if [[ -z "$existing" ]]; then
    echo "  $name: not found, creating"
    result=$(curl_admin -X POST --data-binary "$payload" "$CONSOLE_URL/v1/api/admin/skills")
  else
    echo "  $name: found ($existing), updating"
    result=$(curl_admin -X PUT --data-binary "$payload" "$CONSOLE_URL/v1/api/admin/skills/$existing")
  fi
  version=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('version', d.get('error','ERROR')))" 2>/dev/null || echo "ERROR")
  echo "    -> version $version"
done

echo "== Done. Not covered by this script (see header comment): admin user/token, printer-dashboard Project entity. =="
