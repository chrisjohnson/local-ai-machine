#!/usr/bin/env bash
set -euo pipefail

# Triggers the declarative restic backup service defined in configuration.nix
# (services.restic.backups.synology). Intended for manual/on-demand runs;
# the daily schedule is handled by the systemd timer.

systemctl start restic-backups-synology.service
systemctl status --no-pager restic-backups-synology.service
