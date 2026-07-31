#!/bin/sh
# The container runs as root (no USER directive - needed for docker.sock
# access via group_add, and simpler than migrating the pre-existing
# pi-agent-data volume to a non-root uid). docker-compose.yml mounts the
# SSH key/config/known_hosts read-only, owned by the HOST uid (1000,
# chris) - OpenSSH's strict-mode check refuses to use config/key files
# not owned by the current euid (0) or root, so using them directly at
# /root/.ssh fails with "Bad owner or permissions" (confirmed directly,
# not assumed - see pi-agent-experiment fleet card decision log).
# docker-compose.yml mounts them at /run/ssh-secrets instead; this copies
# them into /root/.ssh with root ownership (copying, not just chmod'ing
# the read-only mount, since that mount can't be chmod'd in place) before
# handing off to the real command.
set -e
if [ -d /run/ssh-secrets ]; then
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  for f in config github_deploy_key known_hosts; do
    if [ -f "/run/ssh-secrets/$f" ]; then
      cp "/run/ssh-secrets/$f" "/root/.ssh/$f"
      chmod 600 "/root/.ssh/$f"
    fi
  done
fi
exec "$@"
