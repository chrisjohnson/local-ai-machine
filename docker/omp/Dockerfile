FROM node:22-alpine AS runner

# Install system dependencies (excluding bun)
RUN apk add --no-cache \
    git \
    bash \
    openssh-client \
    curl

# Install Bun via the official shell script
RUN curl -fsSL https://bun.sh | bash

# Ensure Bun is available during the build phase
ENV PATH="/root/.bun/bin:${PATH}"

# Setup user identity to mirror host permissions
RUN addgroup -g 1000 omp && \
    adduser -u 1000 -G omp -h /home/omp -s /bin/bash -D omp

# Copy bun binary to the non-root user's path and fix permissions
RUN mkdir -p /home/omp/.bun/bin && \
    cp /root/.bun/bin/bun /home/omp/.bun/bin/bun && \
    chown -R omp:omp /home/omp/.bun

USER omp
WORKDIR /home/omp

# Ensure pathing and environments match the new user space
ENV PATH="/home/omp/.bun/bin:${PATH}"
ENV PI_CONFIG_DIR="/home/omp/.omp"

# Install the official bundle via Bun
RUN bun install -g @oh-my-pi/pi-coding-agent

WORKDIR /work
ENTRYPOINT ["omp"]
CMD ["cli"]
