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
1. [x] Clone `pi-mono` (or install the `pi-coding-agent` CLI package) somewhere
   on local-ai-machine (or locally, whichever makes iteration faster) and read
   the actual docs listed above firsthand — confirm the RPC protocol shape,
   session persistence behavior, and provider registration mechanism exactly
   as they exist in the current release, not as summarized here.
2. [x] Write a minimal extension that registers litellm as an OpenAI-compatible
   provider: baseUrl `http://<litellm-host>:4000/v1` (check docker-compose /
   configuration.nix for the actual reachable host/port from wherever pi runs
   — likely `127.0.0.1:4000` if colocated on local-ai-machine, or the LAN IP),
   apiKey from `LITELLM_MASTER_KEY` (see `docker/.env` on the box), model
   `coder` (currently pinned to qwen3.6-35b-a3b-mtp per
   `docker/litellm/config.yaml`).
3. [x] Run `pi --mode rpc --session-dir /tmp/pi-spike-session` manually
   (foreground, on the box or wherever you land it), send one real prompt over
   stdin, confirm a real streamed response comes back from the actual local
   model — not a stub/mock.
4. [x] Kill the process, restart pointed at the same `--session-dir`, confirm
   the prior turn's history is actually there (this is the load-bearing fact
   for "sessions survive restarts" — verify it, don't assume it from the docs).
5. [x] Record findings in the decision log: does this actually work as
   documented? Any surprises (auth quirks, streaming format differences,
   context window mismatches) that change the M-031 supervisor design?

## Signals
<!-- signal: claude 2026-07-30T21:00Z — claiming, starting the spike before building the supervisor -->
<!-- signal: claude 2026-07-30T21:50Z — M-030 done, real end-to-end + restart-survival confirmed, moving to M-031 -->

## Decision log
- Cloned `github.com/badlogic/pi-mono` (`main`, shallow) to read docs/source
  firsthand. Canonical repo/npm scope has moved: `package.json` `repository`
  fields point at `git+https://github.com/earendil-works/pi.git`, and the
  current npm org is `@earendil-works/*` (pi-coding-agent 0.83.0, published
  2026-07-29 — much newer than `@mariozechner/pi-coding-agent` 0.73.1, the
  old scope). The box already had `@mariozechner/pi-coding-agent` 0.73.1
  installed globally from an earlier session on 2026-07-28 — uninstalled it
  and installed `@earendil-works/pi-coding-agent` 0.83.0 instead so tonight's
  work is on the current release, not a 2-day-stale mirror.
- Cloned repo also contains `packages/server` (`@earendil-works/pi-server`,
  v0.83.0, explicitly marked "Experimental" in its own README) — this is
  NOT published to npm (confirmed: `npm view @earendil-works/pi-server`
  404s). Its source is a real gift for M-031 design even though we can't
  `npm install` it: `packages/server/src/supervisor.ts` already implements
  almost exactly what M-031 needs — a `ServerSupervisor` class managing
  multiple named `RpcProcessInstance`s (one per "instance"/session), a
  flat-file-backed manifest (`instances.json` via `storage.ts`) with
  `recoverAfterRestart()`, per-instance event-subscriber fanout
  (`Set<AgentSessionEventListener>`), and status tracking
  (starting/online/error/stopping/stopped). Its transport is a **local Unix
  socket only** (`~/.pi/server/server.sock`, see `config.ts`
  `getSocketPath()`) with a CLI (`server serve/spawn/list/rpc/rpc-stream`) —
  no HTTP/WebSocket/browser-facing surface at all. It also has an optional
  `radius.ts` module that heartbeats instance presence to a hosted SaaS
  (`https://radius.pi.dev/`, opt-in via `RADIUS_API_KEY` or OAuth, disabled
  by default) — irrelevant/out-of-scope for us, not used.
  **Net effect on M-031**: the manifest/recovery/fanout *design* this package
  uses is exactly right and I'll mirror its shape (per-session RPC child +
  subscriber set + flat-file/sqlite manifest + recoverAfterRestart), but
  since it's unpublished and Unix-socket-only, M-031 still needs its own
  implementation with an HTTP+WS layer on top — not a dependency on this
  package.
- Provider registration: confirmed `~/.pi/agent/models.json` (declarative,
  reloaded live on `/model`, no restart, no TypeScript extension file
  needed) is simpler than the `pi.registerProvider()` extension-factory path
  for our case (static single local model, no dynamic per-request auth).
  Used `api: "openai-completions"`, `baseUrl: http://127.0.0.1:4000/v1`
  (litellm, host-networked on the box per docker-compose), `apiKey` = the
  real `LITELLM_MASTER_KEY` value read from `docker/.env`, model id `coder`.
  Set `compat.supportsDeveloperRole: false` since litellm/llama.cpp doesn't
  understand the `developer` role pi's default prompt uses for
  reasoning-capable models (per models.md guidance) — untested without it,
  chose not to risk a subtle prompt-format bug for a quick experiment.
  `contextWindow: 131072` / `maxTokens: 8192` set to match the *actual* live
  llama.cpp command line (`docker inspect
  qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1` → `-c 131072 -n 8192`), not
  guessed.
- Real end-to-end smoke test (not a stub): started
  `pi --mode rpc --session-dir /tmp/pi-spike-session --provider
  local-litellm --model coder` on local-ai-machine with stdin held open via
  a named pipe (a plain heredoc closes stdin immediately after one line and
  kills the process before the async response streams back — hit this on
  the first attempt, switched to a FIFO). Sent
  `{"type":"prompt","message":"Reply with exactly the words: PI SPIKE OK"}`.
  Got a real streamed response through litellm → `coder` alias →
  `qwen3.6-35b-a3b-mtp`: `thinking_start`/`thinking_delta` events with
  actual reasoning content ("The user wants me to reply with exactly..."),
  then `message_update` text deltas, `message_end`, `turn_end`, `agent_end`
  (`willRetry: false`), `agent_settled`. Final assistant text: exactly
  `"PI SPIKE OK"`. No stderr, no errors, no stub content — genuine model
  round-trip confirmed.
- Restart/persistence test (the single most load-bearing check): killed
  that process, started a **new** `pi --mode rpc` process pointed at the
  same `--session-dir` and the session file it had just written
  (`--session <path>`), sent `get_messages` and `get_state`. Response
  contained the exact prior user + assistant messages (same `sessionId:
  019fb4fb-...`, `messageCount: 2`) — confirmed directly, not inferred from
  docs: session state genuinely survives a process restart via
  `--session-dir` + `--session <path>`.
- Streaming format matches `rpc.md` exactly as documented — no surprises in
  event shape. One real surprise worth flagging for M-031: `agent_end` can
  fire multiple times per prompt if there's a retry/compaction cycle
  (`willRetry: true`); the terminal signal a supervisor should wait on is
  `agent_settled`, not the first `agent_end` — matches the doc's own
  wording ("may still be followed by retry...") but easy to get wrong if
  skimmed. Recorded here so M-031 doesn't reintroduce a "done too early"
  bug on the wrapper side.
- `pi-web-ui` (`@earendil-works/pi-web-ui`, npm) exists and is published,
  contra my assumption going in — but it wasn't present in this repo
  checkout's `packages/` dir (must live in a different package or be
  git-submoduled/split out). Time-boxed check deferred properly to M-032
  per that card's own instructions; noting here only that the package does
  exist on npm so M-032 should do its own real check rather than assume
  it's vaporware.

## Handoff notes
pi 0.83.0 installed globally on local-ai-machine
(`/home/chris/.npm-global/bin/pi`, on PATH via `.npm-global/bin`).
`~/.pi/agent/models.json` on the box now declares the `local-litellm`
provider + `coder` model — this is machine-local state, NOT yet
reproducible via git; M-031/M-033 needs to either bake an equivalent config
into the supervisor's own startup (preferred — keeps it out of `~/.pi` and
scoped to the service) or commit this file's content under `pi-agent/` and
have the deploy step install it. Test artifacts left at
`/tmp/pi-spike-session/` and `/tmp/pi-spike-out*.jsonl` on the box — harmless,
not cleaned up, safe to ignore/delete later.
