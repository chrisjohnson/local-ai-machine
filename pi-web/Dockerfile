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
# /home/chris tree. Pinned exact version, matching this repo's
# reproducibility convention elsewhere (Turnstone/pi-agent Dockerfiles).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Container runs as root (no USER directive); /home/chris is bind-mounted
# from the host where it's owned by uid 1000. Confirmed live in the
# pi-agent-supervisor build (M-031 decision log) that this exact
# combination makes git refuse the directory ("detected dubious
# ownership") until told otherwise - baking the fix in up front here
# instead of waiting to rediscover the identical bug.
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
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pi-web", "--hostname", "0.0.0.0", "--port", "30141", "--no-open"]
