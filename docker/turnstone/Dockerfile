# Adds the docker CLI to the upstream Turnstone image so a workstream's
# shell tool can actually run `docker build`/`docker compose` against a
# mounted project (see docker-compose.yml's turnstone service — the host's
# docker.sock is bind-mounted in, but the upstream image ships no docker
# client at all to talk to it).
FROM ghcr.io/turnstonelabs/turnstone:latest

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*
USER turnstone
