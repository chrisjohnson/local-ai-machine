#!/usr/bin/env bash
# M-053: build poolsideai/llama.cpp branch `laguna` with Vulkan/RADV (gfx1151) as
# `local-ai-machine/llamacpp-laguna-fork:vulkan-radv`. Run on the box.
set -euo pipefail

cd /home/chris/local-ai-machine

docker build \
  -f docker/llamacpp-laguna-fork-vulkan-radv.dockerfile \
  -t local-ai-machine/llamacpp-laguna-fork:vulkan-radv \
  docker/

echo "BUILD_OK"
docker run --rm local-ai-machine/llamacpp-laguna-fork:vulkan-radv \
  sh -c 'echo "fork_commit=$(cat /build/fork-commit.txt)" && /build/build/bin/llama-cli --version'
