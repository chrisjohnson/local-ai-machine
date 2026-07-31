# pi-web (github.com/agegr/pi-web): community web UI for the pi coding
# agent, evaluated side by side with our own bespoke pi-agent/ supervisor
# (see .fleet/board for the M-030..M-034 build and this follow-on
# comparison). Depends directly on the same @earendil-works/pi-coding-agent
# version (0.83.0) our own supervisor pins - same underlying engine, so
# this is a genuine apples-to-apples UI/orchestration comparison, not a
# different model or loop.
FROM node:22-slim

WORKDIR /app

# git: pi-web's own headline feature list includes git worktree switching;
# without git installed that panel would just fail against the mounted
# /home/chris tree.
# openssh-client: git needs a real `ssh` binary for SSH remotes - the
# uid/HOME fix in M-044 alone was NOT sufficient, confirmed live post-fix
# (`sh: 1: ssh: not found` inside the container) - this was the actual,
# more fundamental cause of the original "SSH isn't available on this
# machine" report, not just the HOME/uid mismatch. Same package turnstone
# already needed for the identical reason (its own Dockerfile comment:
# "confirmed missing on the first attempt").
# curl: needed below to fetch the gh CLI release tarball.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        openssh-client \
        curl \
    && rm -rf /var/lib/apt/lists/*

# gh (GitHub CLI) isn't packaged in Debian at all - installed from the
# upstream release tarball, same approach and reasoning as turnstone's
# Dockerfile (single-purpose image, not worth adding GitHub's apt repo +
# GPG key for one binary). Needed now that GH_TOKEN is wired into this
# service's environment (docker-compose.yml) - the token alone is useless
# without the binary that reads it.
RUN GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
        | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/') \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_amd64"

# /home/chris is bind-mounted from the host where it's owned by uid 1000.
# Confirmed live in the pi-agent-supervisor build (M-031 decision log) that
# a uid mismatch makes git refuse the directory ("detected dubious
# ownership") until told otherwise - baking the fix in up front here
# instead of waiting to rediscover the identical bug. Left in place even
# after switching to the matched uid 1000 `node` user below (M-044) -
# harmless, and cheap insurance against any future mount that isn't
# uid-1000-owned.
RUN git config --system --add safe.directory '*'

RUN npm install -g @agegr/pi-web@0.8.5

# Claude CLI (M-039): pi-claude-bridge spawns this as a subprocess via the
# Claude Agent SDK to provide a claude-bridge/* model provider + AskClaude
# tool, using Chris's own Claude Pro subscription rather than metered API
# billing. Pinned exact version, same reproducibility discipline as
# pi-web itself above. Distributed as a wrapper package that fetches a
# native per-platform binary via postinstall (confirmed from its own
# cli-wrapper.cjs) - this box is linux-x64 (confirmed via `uname -m` +
# `docker version`), so that postinstall runs at image build time here,
# baking the real binary into the image layer rather than refetching it
# at every container start.
RUN npm install -g @anthropic-ai/claude-code@2.1.220

ENV PI_CODING_AGENT_DIR=/data/pi-agent-config
ENV PORT=30141

VOLUME ["/data"]
EXPOSE 30141

COPY models.seed.json.tmpl /app/models.seed.json.tmpl
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as a matched non-root uid (M-044) rather than inheriting root by
# default like the rest of this compose file's services do - nothing here
# actually needs root (no privileged port, /data writes are the only
# runtime writes). `node:22-slim` already bakes in a `node` user at
# uid/gid 1000, matching host `chris` (confirmed live: `stat -c '%u %g'
# /home/chris` -> 1000 100) - same uid-matching approach turnstone already
# uses, just via the base image's built-in user instead of a fresh
# useradd. HOME is overridden to /home/chris (node's own image default is
# /home/node, which is NOT the bind-mounted tree) so git/ssh naturally
# find the already-mounted /home/chris/.ssh/* without any separate
# /root/.ssh-style stopgap mount - the whole-home-dir mount this service
# already had for its project browser now does double duty for SSH auth
# too, for free, once uid and $HOME both actually line up.
RUN mkdir -p /data && chown -R node:node /data
ENV HOME=/home/chris
USER node

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pi-web", "--hostname", "0.0.0.0", "--port", "30141", "--no-open"]
