FROM node:22-bookworm-slim AS runner

# Install structural system dependencies 
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    openssh-client \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun via the official shell script
RUN curl -fsSL https://bun.sh/install | bash

# Ensure Bun is available to root during the build phase
ENV PATH="/root/.bun/bin:${PATH}"

# Modify the existing node user/group (1000:1000) to 'omp'
RUN usermod -l omp node && \
    groupmod -n omp node && \
    usermod -d /home/omp -m omp

# Create paths, copy binary, and fix permissions
RUN mkdir -p /home/omp/.bun/bin && \
    cp /root/.bun/bin/bun /home/omp/.bun/bin/bun && \
    chown -R omp:omp /home/omp/.bun

RUN mkdir -p /app/.omp/agent

# Seed-once model config (litellm provider), same pattern as pi-web: committed
# template carries a __LITELLM_MASTER_KEY__ placeholder, substituted at runtime
# only when the config file is first created. COPY/chmod run as root (before
# USER omp): BuildKit COPY'd files are root-owned even when the active USER is
# non-root, so a chmod after the USER switch would fail with EPERM.
COPY .omp/agent/models.seed.yml.tmpl /app/.omp/agent/models.seed.yml.tmpl
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch user context for runtime safety
USER omp
WORKDIR /home/omp

# Ensure pathing and environments match the new user space
ENV PATH="/home/omp/.bun/bin:${PATH}"
# PI_CONFIG_DIR is a directory NAME joined under $HOME, not an absolute path
# (@oh-my-pi/pi-utils/dirs: path.join(os.homedir(), PI_CONFIG_DIR)); an
# absolute value here silently resolves to /home/omp/home/omp/.omp and misses
# the ~/.omp:/home/omp/.omp volume mount entirely.
ENV PI_CONFIG_DIR=".omp"

# Install the official bundle via Bun. Bun blocks untrusted lifecycle scripts
# by default; onnxruntime-node (downloads its native .node binary) and
# protobufjs (bundling postinstall) are both required for runtime features
# (embeddings/memory), so trust exactly those two after install.
RUN bun install -g @oh-my-pi/pi-coding-agent \
    && bun pm -g trust onnxruntime-node protobufjs

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Original upstream used ENTRYPOINT ["omp"] + CMD ["cli"] (cli is a subcommand
# of the omp binary, not a PATH executable); the seed entrypoint replaces the
# omp ENTRYPOINT, so the subcommand must be dispatched through `omp` here.
CMD ["omp", "cli"]
