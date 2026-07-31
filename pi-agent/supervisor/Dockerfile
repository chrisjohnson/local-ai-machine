# pi-agent supervisor: spawns/tracks `pi --mode rpc` child processes and
# exposes them over HTTP + WebSocket. See pi-agent/supervisor/src/server.ts.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app

# Tooling agents actually need once they have real project working dirs +
# creds mounted in (see docker-compose.yml pi-agent-supervisor service):
# git + openssh-client for clone/push over the mounted SSH key, docker.io
# for the mounted docker.sock, curl/ca-certificates for the gh install
# step below.
#
# NOTE: Turnstone's own Dockerfile (docker/turnstone/Dockerfile) needed a
# separate `docker-cli` package alongside `docker.io` because ITS base
# image is Debian trixie, which split the CLI out. This image's base
# (node:22-slim) is Debian bookworm, which does NOT have a `docker-cli`
# package at all (confirmed via `apt-cache search docker` inside a real
# node:22-slim container - `docker.io` on bookworm bundles the CLI
# already, unlike trixie). Copy-pasting Turnstone's exact package list
# here failed the build (`E: Unable to locate package docker-cli`) -
# fixed by dropping it, then verified the `docker` binary actually exists
# post-install rather than assumed from the successful build alone.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        openssh-client \
        docker.io \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# gh CLI (PR creation, issue comments - GH_TOKEN covers GitHub's API, which
# doesn't accept SSH keys at all; SSH key covers git push/clone only).
# Same latest-release install approach as Turnstone's Dockerfile, for the
# same reason: no reliably-current `gh` in Debian's apt repos.
RUN GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
        | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/') \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_amd64"

# pi (the coding-agent CLI) is what the supervisor actually spawns as
# --mode rpc child processes - installed globally in the image so the
# exact version is pinned by this Dockerfile (reproducible), not by
# whatever happened to be installed on the host at deploy time (see
# M-030 decision log: the box already had a stale @mariozechner-scoped
# 0.73.1 install from an earlier session before this image existed).
RUN npm install -g @earendil-works/pi-coding-agent@0.83.0

COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=3002
ENV PI_AGENT_DATA_DIR=/data
ENV PI_BIN=pi
ENV PI_CODING_AGENT_DIR=/data/pi-agent-config
ENV PI_PROVIDER=local-litellm
ENV PI_MODEL=coder
ENV LITELLM_BASE_URL=http://127.0.0.1:4000/v1
# The frontend (M-032, plain static HTML/JS/CSS, no build step) lives at
# pi-agent/frontend/dist in the repo and is bind-mounted in at this path
# by docker-compose.yml rather than baked into the image - it's outside
# this Dockerfile's own build context (pi-agent/supervisor/), and a bind
# mount means frontend-only edits don't require an image rebuild.
ENV PI_AGENT_STATIC_DIR=/app/frontend
# Default cwd for spawned `pi --mode rpc` processes - deliberately NOT
# the same as --session-dir (which stays under PI_AGENT_DATA_DIR for
# supervisor bookkeeping regardless of this value). /workspace is where
# docker-compose.yml bind-mounts real project checkouts; a session's
# agent cd's between them itself (per a future skill/prompt layer Chris
# is iterating on separately) rather than the supervisor picking one.
ENV PI_AGENT_WORKDIR=/workspace

VOLUME ["/data"]
EXPOSE 3002

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
