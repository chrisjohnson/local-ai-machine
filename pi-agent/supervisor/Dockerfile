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

ENV PORT=3002
ENV PI_AGENT_DATA_DIR=/data
ENV PI_BIN=pi
ENV PI_CONFIG_DIR=/data/pi-config
ENV PI_PROVIDER=local-litellm
ENV PI_MODEL=coder
ENV LITELLM_BASE_URL=http://127.0.0.1:4000/v1
ENV PI_AGENT_STATIC_DIR=/app/frontend

VOLUME ["/data"]
EXPOSE 3002

CMD ["node", "dist/server.js"]
