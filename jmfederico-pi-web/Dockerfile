FROM node:22-bookworm-slim AS runner

# Install structural system dependencies and build tools for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    openssh-client \
    curl \
    ca-certificates \
    unzip \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Bun via the official shell script
RUN curl -fsSL https://bun.sh/install | bash

# Ensure Bun is available to root during the build phase
ENV PATH="/root/.bun/bin:${PATH}"

# Modify the existing node user/group (1000:1000) to 'piweb'
RUN usermod -l piweb node && \
    groupmod -n piweb node && \
    usermod -d /home/piweb -m piweb

# Create paths, copy binary, and fix permissions
RUN mkdir -p /home/piweb/.bun/bin && \
    cp /root/.bun/bin/bun /home/piweb/.bun/bin/bun && \
    chown -R piweb:piweb /home/piweb/.bun

RUN mkdir -p /app/.pi-web

# Switch user context for runtime safety
USER piweb
WORKDIR /home/piweb

# Ensure pathing and environments match the new user space
ENV PATH="/home/piweb/.bun/bin:${PATH}"
ENV PI_CODING_AGENT_DIR="/home/piweb/.pi-web"

# Install the official pi-web bundle via Bun
RUN bun install -g @jmfederico/pi-web

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pi-web"]

USER root

# Install Docker dependencies for host-level tool execution if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    netcat-openbsd \
    net-tools \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Seed-once model config (litellm provider) - JSON format for pi-web
COPY models.seed.json.tmpl /app/.pi-web/models.seed.json.tmpl
COPY settings.seed.json /app/.pi-web/settings.seed.json
# Seed-once pi-continue extension config: synthesis/handoff originally had
# to be pinned to the fast medium-moe model (qwen3.6-35b, formerly named
# "coder") instead of the slow big-moe default (laguna-118B, formerly named
# "planner"), because big-moe used to blow past pi-continue's default
# synthesisTimeoutMs and fail the handoff. Even on medium-moe, large
# (~65k+ token) handoff contexts can burn 140s+ just on prompt processing
# before generation even starts, so synthesisTimeoutMs is raised to 300s to
# leave headroom.
#
# summarizerModel points at "big-moe-continue-json", NOT the plain "big-moe"
# role: big-moe (laguna) is a thinking model that reliably prepends prose
# before the JSON, which fails pi-continue's strict JSON.parse() regardless
# of timeout. "big-moe-continue-json" is a scoped litellm route (see
# docker/litellm/config.yaml) that forces a full json_schema response_format
# matching pi-continue's artifact shape, so the parseable "content" channel
# comes back as clean, schema-exact JSON every time — empirically verified
# on this backend (2026-08-03) before being adopted here; the timeout
# blow-past that originally ruled out big-moe was solved by this fix
# turning out to also run fast in practice (~19s in testing), not by the
# timeout increase alone. A same-shape "medium-moe-continue-json" route
# also exists (backed by qwen3.6-35b) as a known-good fallback if a future
# big-moe backend swap regresses this. pi-continue reads its config from
# $PI_CODING_AGENT_DIR/extensions/pi-continue.json (NOT the npm:pi-continue
# block in settings.json), so it needs its own seed here.
COPY pi-continue.seed.json /app/.pi-web/pi-continue.seed.json

# pi-continue-companion: our own PI WEB plugin (not user-editable via the UI),
# baked into the image and always-synced (not seed-once) on every container
# start so a stale on-disk copy from a previous image never lingers. See
# docker-entrypoint.sh for the sync step.
COPY plugins/pi-continue-companion /app/.pi-web/plugins-seed/pi-continue-companion

# pi-web-factory-prompts: our own pi-coding-agent EXTENSION (a different
# mechanism from the PI WEB plugin above -- see plugins/pi-web-factory-prompts/
# index.ts's header comment for the distinction). Gives pi-web-factory agent
# sessions a true per-role system prompt via the before_agent_start hook
# (M-069). Baked into the image and always-synced (not seed-once) on every
# container start, same reasoning as pi-continue-companion above. Lands at
# $PI_CODING_AGENT_DIR/extensions/pi-web-factory-prompts/index.ts, one of
# pi-coding-agent's own auto-discovered global extension locations
# (~/.pi/agent/extensions/*/index.ts, here rooted at PI_CODING_AGENT_DIR
# instead of the default ~/.pi/agent -- see docker-entrypoint.sh) -- no
# settings.json packages: entry needed, unlike npm:pi-continue.
COPY plugins/pi-web-factory-prompts /app/.pi-web/extensions-seed/pi-web-factory-prompts

# pi-web-factory: our own control-plane CLI (chains/, modules/, cli.ts) that
# drives pi-web sessions over its own REST/WebSocket API to run deterministic,
# multi-step agentic Workflows (M-068). Baked into the image and
# always-synced (not seed-once) on every container start, same reasoning as
# the plugin/extension syncs above — actively-developed code, a container
# restart must always pick up the latest build, never a stale copy from a
# previous image. Landed OUTSIDE $CONFIG_ROOT/.pi-web (it's a standalone
# tool, not pi-web/pi-coding-agent config) at a fixed path a triggering
# Skill's bash tool can reference directly (see M-072) regardless of which
# project a session targets. Dependencies (bun.lock: yaml, zod) installed
# once here at build time with a frozen lockfile, baked into the seeded
# copy, so the always-sync step in docker-entrypoint.sh is a pure file copy
# — no network access needed at container start. factory.db (the trace
# database) deliberately does NOT live under this synced directory — see
# cli.ts's PI_WEB_FACTORY_DB_PATH doc comment and this Dockerfile's ENV
# below; a `rm -rf` on every restart would otherwise destroy real
# accumulated observability history.
COPY pi-web-factory /app/.pi-web/pi-web-factory-seed
RUN cd /app/.pi-web/pi-web-factory-seed && bun install --frozen-lockfile

# pi-web-factory Agent Skill (M-072): lets any pi-web session trigger a
# Workflow Run itself ("run the pipeline for X") via its own bash tool,
# rather than requiring `cli.ts` to be invoked from outside. Pi's native
# Skills mechanism auto-loads $PI_CODING_AGENT_DIR/skills/<name>/SKILL.md
# into every session's system prompt (confirmed live, M-072's own research)
# — unlike the CLI code above, this DOES belong under $CONFIG_ROOT (it's
# exactly the kind of pi-coding-agent config that mechanism expects), but
# still baked into the image and always-synced rather than placed on the
# host's bind-mounted $PI_CODING_AGENT_DIR by hand, so it stays git-tracked
# and never drifts from what's committed — same discipline as everything
# else in this file.
COPY skills/pi-web-factory /app/.pi-web/skills-seed/pi-web-factory

# Points cli.ts's trace db at a path under $PI_CODING_AGENT_DIR (bind-mounted
# from the host, so it survives both container restarts AND image rebuilds),
# rather than its local-dev default (co-located with cli.ts itself, which
# docker-entrypoint.sh's always-sync step `rm -rf`s on every start).
ENV PI_WEB_FACTORY_DB_PATH="/home/piweb/.pi-web/pi-web-factory-data/factory.db"

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Give piweb ownership of the seed directory so it can install packages there
RUN chown -R piweb:piweb /app/.pi-web

USER piweb
