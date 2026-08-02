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
# Seed-once model config (litellm provider) - JSON format for pi-web
COPY models.seed.json.tmpl /app/.pi-web/models.seed.json.tmpl
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install Docker dependencies for host-level tool execution if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    netcat-openbsd \
    net-tools \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

USER piweb
