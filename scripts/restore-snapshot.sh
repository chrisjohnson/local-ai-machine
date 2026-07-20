#!/usr/bin/env bash
set -euo pipefail

# Restores a restic snapshot from the Synology repository.
# Usage: ./restore-snapshot.sh <snapshot-id> <target-dir>
# Use `restic snapshots` (with the repo/password env below) to list IDs.

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <snapshot-id> <target-dir>" >&2
  exit 1
fi

SNAPSHOT_ID="$1"
TARGET_DIR="$2"

export RESTIC_REPOSITORY="/mnt/synology/restic"
export RESTIC_PASSWORD_FILE="/etc/nixos/secrets/restic-password.txt"

restic restore "${SNAPSHOT_ID}" --target "${TARGET_DIR}"
