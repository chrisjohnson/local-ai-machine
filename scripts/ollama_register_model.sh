#!/usr/bin/env bash
# Registers a downloaded GGUF file with the running Ollama container via
# `ollama create`, using a minimal Modelfile (just a FROM line - the GGUF
# already carries its own chat template/metadata). Pairs with the
# ollama-* entries in configuration.nix's `models` list, which download
# the GGUF but don't register it with Ollama themselves (a one-time,
# on-demand step, not worth a systemd unit for a handful of comparison
# models).
#
# Usage:
#   ./ollama_register_model.sh <model-dir-name> <gguf-filename> <ollama-model-name>
# Example:
#   ./ollama_register_model.sh ollama-gemma-4-26b-a4b-it gemma-4-26B-A4B-it-UD-Q4_K_M.gguf gemma-4-26b-a4b-it
set -euo pipefail

MODEL_DIR="$1"; GGUF_FILE="$2"; OLLAMA_NAME="$3"
GGUF_PATH="/gguf-source/$MODEL_DIR/$GGUF_FILE"

if ! docker exec ollama test -f "$GGUF_PATH"; then
  echo "Not found inside the ollama container: $GGUF_PATH" >&2
  echo "(check the download completed: /var/lib/ai-models/$MODEL_DIR/.download-complete)" >&2
  exit 1
fi

docker exec ollama sh -c "printf 'FROM %s\n' '$GGUF_PATH' > /tmp/Modelfile-$OLLAMA_NAME"
docker exec ollama ollama create "$OLLAMA_NAME" -f "/tmp/Modelfile-$OLLAMA_NAME"
docker exec ollama ollama list
