FROM alpine:3.20 AS runner

# Install structural engine dependencies 
RUN apk add --no-cache \
    nodejs \
    bun \
    git \
    bash \
    openssh-client \
    curl

# Setup user identity to safely mirror host permissions
RUN addgroup -g 1000 omp && \
    adduser -u 1000 -G omp -h /home/omp -s /bin/bash -D omp

USER omp
WORKDIR /home/omp

# Install the official bundle via Bun
RUN bun install -g @oh-my-pi/pi-coding-agent

# Set executable environments
ENV PATH="/home/omp/.bun/bin:${PATH}"
ENV PI_CONFIG_DIR="/home/omp/.omp"

WORKDIR /work
ENTRYPOINT ["omp"]
CMD ["cli"]
