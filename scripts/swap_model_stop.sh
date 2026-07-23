#!/usr/bin/env bash
# Tears down the temp container started by swap_model_start.sh and restores
# the standard compose stack. Always run this even if the caller failed
# partway through, so vllm-primary/vllm-judge don't get left down.
set -uo pipefail

cd "$HOME/local-ai-machine/docker"
docker rm -f vllm-bench-swap >/dev/null 2>&1 || true
docker volume rm -f vllm_swap_cache >/dev/null 2>&1 || true
docker compose up -d vllm-primary vllm-judge
echo "Standard stack restored."
