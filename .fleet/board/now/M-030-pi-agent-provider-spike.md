---
id: M-030
title: pi-agent experiment — provider spike + headless RPC smoke test
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-30T21:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-031, M-032, M-033, M-034]
---

# M-030 — pi-agent experiment — provider spike + headless RPC smoke test

## Context
User is 2 days into Turnstone and found it heavier/rougher than expected (judge
pipeline is single-model/advisory-only, no real loop enforcement — see M-029
lineage of debugging in this session). User wants to evaluate `pi-mono`
(github.com/badlogic/pi-mono, aka `pi` / `pi-coding-agent`) as a lighter
alternative: same "browser tracks my agents, I can check in from my phone"
experience Turnstone gives, but leaner, using the same locally-hosted model
(litellm `coder` alias → qwen3.6-35b-a3b-mtp).

User is out for the evening and gave standing permission to push to main,
deploy/stop/start/remove services on local-ai-machine, and skip auth/security
entirely for this experiment. Goal: have something concrete to review in the
morning. This card is the risk-reduction spike before committing to build the
full supervisor+frontend (M-031/M-032/M-033).

Confirmed from pi-mono docs (fetched during scoping, verify firsthand — don't
trust this secondhand):
- `pi --mode rpc --session-dir <dir>` runs the agent headless: client writes
  JSONL commands to stdin, reads JSONL events from stdout. `{"type":"prompt",
  "message": "..."}` triggers `message_update` (streamed text deltas) then
  `agent_end`. This is a single-session-per-process model — no built-in
  multi-client HTTP server. `--session-dir` persists session state to disk.
- Custom OpenAI-compatible providers (litellm, vLLM, etc.) are registered via
  an extension: `pi.registerProvider("name", {baseUrl, apiKey, api:
  "openai-completions", models: [...]})`. Can dynamically discover models via
  a `fetch()` to `/v1/models` inside the extension factory.
- Repo is `github.com/badlogic/pi-mono` (also mirrored/renamed
  `earendil-works/pi` in some doc URLs — confirm which is canonical/current).
  Docs directory: `packages/coding-agent/docs/` — read `rpc.md`,
  `custom-provider.md`, `sessions.md`, `session-format.md`, `llama-cpp.md`,
  `sdk.md` directly (clone the repo, don't rely on web search summaries).

## Plan
1. [ ] Clone `pi-mono` (or install the `pi-coding-agent` CLI package) somewhere
   on local-ai-machine (or locally, whichever makes iteration faster) and read
   the actual docs listed above firsthand — confirm the RPC protocol shape,
   session persistence behavior, and provider registration mechanism exactly
   as they exist in the current release, not as summarized here.
2. [ ] Write a minimal extension that registers litellm as an OpenAI-compatible
   provider: baseUrl `http://<litellm-host>:4000/v1` (check docker-compose /
   configuration.nix for the actual reachable host/port from wherever pi runs
   — likely `127.0.0.1:4000` if colocated on local-ai-machine, or the LAN IP),
   apiKey from `LITELLM_MASTER_KEY` (see `docker/.env` on the box), model
   `coder` (currently pinned to qwen3.6-35b-a3b-mtp per
   `docker/litellm/config.yaml`).
3. [ ] Run `pi --mode rpc --session-dir /tmp/pi-spike-session` manually
   (foreground, on the box or wherever you land it), send one real prompt over
   stdin, confirm a real streamed response comes back from the actual local
   model — not a stub/mock.
4. [ ] Kill the process, restart pointed at the same `--session-dir`, confirm
   the prior turn's history is actually there (this is the load-bearing fact
   for "sessions survive restarts" — verify it, don't assume it from the docs).
5. [ ] Record findings in the decision log: does this actually work as
   documented? Any surprises (auth quirks, streaming format differences,
   context window mismatches) that change the M-031 supervisor design?

## Signals
<!-- signal: claude 2026-07-30T21:00Z — claiming, starting the spike before building the supervisor -->

## Decision log

## Handoff notes
