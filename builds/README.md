# builds/ — llm-inference-bench stack (M-101)

This top-level directory is the NEW benchmark stack, deliberately separate
from `catalog/` (which stays the old stack's catalog). One directory per
build, named exactly after the build's docker-compose service name:

```
builds/
  qwen3.6-27b--vllm-therock-gfx1151-v1/
    build.yaml                 # hand-authored build identity (see below)
    benchmarks/
      llm-inference-bench/
        <timestamp>.json       # raw structured output (untainted, never edited)
        <timestamp>-stdout.log # tool stdout (captured progress/errors)
        <timestamp>-crash.log  # docker logs from a twice-crashed container
```

## build.yaml

Hand-authored per build by a human/agent — the orchestrator NEVER writes it.
It is (1) the verbatim docker-compose service blob plus (2) derived metadata,
plus (3) optional `bench:` CLI overrides for the harness invocation. A missing
build.yaml is fine — the build still benchmarks using the default matrix.

```yaml
name: qwen3.6-27b--vllm-therock-gfx1151-v1
compose: |              # verbatim service block, exactly as in docker-compose.yml
  qwen3.6-27b--vllm-therock-gfx1151-v1:
    image: docker.io/kyuz0/vllm-therock-gfx1151:latest
    command: > ...      # (copied verbatim)
    ports:
      - "127.0.0.1:8002:8000"
derived:
  engine: vllm-therock-gfx1151-v1
  model: Qwen3.6-27B
  params: 27B
  active_params: null
  quant: bf16
  mtp: false
  dflash: false
  notes: >-
    any hand-authored context about this build
bench:                 # optional overrides; all keys optional
  concurrency: "1,2,4,8"
  contexts: "0,16384,32768,65536"
  duration: 30
  max_tokens: 8192
  kv_budget: 0          # 0 = auto/no limit; see llm_decode_bench.py --help
  model: qwen3.6-27b    # override the tool's auto-detected model id if needed
```

Raw benchmark JSON is preserved byte-for-byte as written by the tool ("raw
untainted"). The orchestrator's own run/commit context is the only place the
true engine is recorded (the tool labels llama.cpp builds "sglang (assumed)"
because it only understands vllm:/sglang: Prometheus metrics and falls back
to client-side timing — the numbers are valid, the label is not).

## Queuing runs — the orchestrator API

Runs are enqueued and monitored over the orchestrator's JSON API — never by
tailing container logs. **`docs/benchmark-api.md` is the reference**: `POST
/run` to enqueue, then poll `GET /runs/<id>` (a small JSON doc) until
`status` is `done`/`failed`; consume `GET /runs/<id>/log?stream=1` (SSE) for
live progress. Enqueueing is also available from the web UI
(`http://192.168.1.226:8092/`). Remember: a run stops every non-target model
service, so restore what was serving before the run afterwards
(`docker compose up -d <svc>` on the box).
