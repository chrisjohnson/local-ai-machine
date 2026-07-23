#!/usr/bin/env bash
# Swaps a single comparison-tier model into port 8000 alone (stops
# vllm-primary + vllm-judge to free the full GPU budget, matching how the
# GPTQ-80B and 122B-AWQ tiers were benchmarked earlier this session), runs
# `vllm bench serve` at concurrency 1 and 8 against it, saves raw JSON
# results, then tears the temp container down and restores the standard
# compose stack. Run from the target host as `chris`, from anywhere (cds
# into the compose dir itself).
#
# Usage:
#   ./speed_benchmark_swap.sh <model-dir-name> <served-name> <max-model-len> [extra vllm serve args...]
#
# Example:
#   ./speed_benchmark_swap.sh gemma-4-31b-it gemma-4-31b-it 65536 \
#     --enable-auto-tool-choice --tool-call-parser gemma4 --reasoning-parser gemma4
set -euo pipefail

MODEL_DIR="$1"; SERVED_NAME="$2"; MAX_LEN="$3"; shift 3
EXTRA_ARGS=("$@")

RESULTS_DIR="$HOME/bench-results"
mkdir -p "$RESULTS_DIR"

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
READY=0
for i in $(seq 1 120); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "Healthy after $((i * 10))s"
    READY=1
    break
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
if [ "$READY" -ne 1 ]; then
  echo "Timed out waiting for health check" >&2
  docker logs vllm-bench-swap --tail 100 >&2
  docker rm -f vllm-bench-swap >/dev/null 2>&1 || true
  docker compose up -d vllm-primary vllm-judge
  exit 1
fi

# Same random-dataset/--ignore-eos methodology as the existing report:
# 2048-token input throughout; 512-token output at concurrency 1 (single
# stream, so few prompts needed for a stable read), 256-token output at
# concurrency 8 (more prompts so percentiles over the concurrent window
# are meaningful).
run_bench() {
  local conc="$1" out_len="$2" num_prompts="$3"
  echo "=== Benchmarking $SERVED_NAME @ concurrency $conc ==="
  docker exec vllm-bench-swap vllm bench serve \
    --backend openai-chat \
    --base-url http://localhost:8000 \
    --endpoint /v1/chat/completions \
    --model "$SERVED_NAME" \
    --tokenizer "/models/$MODEL_DIR" \
    --dataset-name random \
    --random-input-len 2048 \
    --random-output-len "$out_len" \
    --max-concurrency "$conc" \
    --num-prompts "$num_prompts" \
    --ignore-eos \
    --save-result --result-dir /tmp \
    --result-filename "${SERVED_NAME}-c${conc}.json"
  docker cp "vllm-bench-swap:/tmp/${SERVED_NAME}-c${conc}.json" "$RESULTS_DIR/"
}

run_bench 1 512 20
run_bench 8 256 100

docker logs vllm-bench-swap --tail 80 > "$RESULTS_DIR/${SERVED_NAME}-server.log" 2>&1 || true
docker rm -f vllm-bench-swap
docker volume rm -f vllm_swap_cache >/dev/null 2>&1 || true

echo "=== Restoring standard stack ==="
docker compose up -d vllm-primary vllm-judge

echo "Done: $SERVED_NAME results in $RESULTS_DIR/${SERVED_NAME}-c1.json and -c8.json"
