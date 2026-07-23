#!/usr/bin/env bash
# Stops the standard stack's vllm-primary/vllm-judge to free the full GPU
# budget, starts a single comparison-tier model alone on port 8000, and
# waits for it to become healthy. Pairs with swap_model_stop.sh. Split out
# of speed_benchmark_swap.sh so the coding-capability harness (which runs
# from the Mac, not the target) can drive the swap from outside without
# duplicating this logic.
#
# Usage:
#   ./swap_model_start.sh <model-dir-name> <served-name> <max-model-len> [extra vllm serve args...]
#
# Set SWAP_ENV_VARS (space-separated KEY=VALUE pairs) before invoking to pass
# extra environment variables into the container, e.g. for the 122B AWQ
# tier's VLLM_USE_TRITON_AWQ=1:
#   SWAP_ENV_VARS="VLLM_USE_TRITON_AWQ=1" ./swap_model_start.sh ...
set -euo pipefail

MODEL_DIR="$1"; SERVED_NAME="$2"; MAX_LEN="$3"; shift 3
EXTRA_ARGS=("$@")

ENV_FLAGS=()
for kv in ${SWAP_ENV_VARS:-}; do
  ENV_FLAGS+=(-e "$kv")
done

cd "$HOME/local-ai-machine/docker"
echo "=== Stopping standard stack's vllm-primary/vllm-judge to free GPU budget ==="
docker compose stop vllm-primary vllm-judge

docker rm -f vllm-bench-swap >/dev/null 2>&1 || true

echo "=== Starting $SERVED_NAME (max-model-len $MAX_LEN) ==="
docker run -d --name vllm-bench-swap \
  --device /dev/kfd --device /dev/dri \
  --group-add video --group-add render \
  --security-opt seccomp=unconfined \
  --ipc host \
  --network docker_default \
  -v /var/lib/ai-models:/models \
  -v vllm_swap_cache:/root/.cache/vllm \
  -p 8000:8000 \
  "${ENV_FLAGS[@]}" \
  docker.io/kyuz0/vllm-therock-gfx1151:latest \
  vllm serve "/models/$MODEL_DIR" \
    --served-model-name "$SERVED_NAME" \
    --host 0.0.0.0 --port 8000 \
    --tensor-parallel-size 1 \
    --gpu-memory-utilization 0.90 \
    --dtype auto --trust-remote-code \
    --max-num-seqs 64 --enable-prefix-caching \
    --max-model-len "$MAX_LEN" \
    "${EXTRA_ARGS[@]}"

echo "=== Waiting for $SERVED_NAME to become healthy (up to 20 min) ==="
for i in $(seq 1 120); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "Healthy after $((i * 10))s"
    exit 0
  fi
  if ! docker ps --filter name=vllm-bench-swap --filter status=running -q | grep -q .; then
    echo "Container exited before becoming healthy - dumping logs:" >&2
    docker logs vllm-bench-swap --tail 100 >&2
    docker rm -f vllm-bench-swap >/dev/null 2>&1 || true
    docker compose up -d vllm-primary vllm-judge
    exit 1
  fi
  sleep 10
done
echo "Timed out waiting for health check" >&2
docker logs vllm-bench-swap --tail 100 >&2
docker rm -f vllm-bench-swap >/dev/null 2>&1 || true
docker compose up -d vllm-primary vllm-judge
exit 1
