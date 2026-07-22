#!/usr/bin/env bash
set -euo pipefail

# Triggers the declarative rsync mirror service defined in configuration.nix
# (systemd.services.synology-backup). Intended for manual/on-demand runs;
# the daily schedule is handled by the systemd timer. Point-in-time recovery
# is handled by DSM's own snapshot scheduler on the tank share, not
# by this job.

systemctl start synology-backup.service
systemctl status --no-pager synology-backup.service
