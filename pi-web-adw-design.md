# SSSF-on-pi-web: durable, multi-project ADW factory baked into pi-web

Status: design sketch, pre-implementation. This is a living document — expand in place,
don't fork copies.

Working name for the new system: **pi-web-factory** (placeholder, open to a better name).

## 0. The ask, precisely

Take the SSSF pattern (deterministic Python/TS control plane owns sequencing/retries/
acceptance; a coding agent works inside bounded, typed phases; envelopes carry context
across phase boundaries; gates verify claims; every event lands in a queryable trace) and
rehost it on top of the `jmfederico-pi-web` stack already running on `local-ai-machine`,
with these constraints:

1. **Lives baked into pi-web**, not stamped into each target project's git repo. One
   shared copy, not N per-project copies.
2. **Triggered manually for now**, same invocation model as stock SSSF (`uv run
   adws/adw_x.py "prompt"`) — just injected from the pi-web harness instead of a
   per-repo `.claude/skills/`.
3. **Durable ticket storage is a deferred layer**, not built now. It will eventually
   provide `backlog/ → now/ → done/` kanban queues (a trimmed variant of the `.fleet`
   skill already used for Claude Code work) that work comes from and returns to. The
   design today must leave a clean seam for that layer to slot in later without changing
   the core execution contract.
4. **Preserve pi-web's own web UI unmodified**, ideally with zero source changes to
   `@jmfederico/pi-web` itself. Open to changes only if genuinely required — not the
   default plan.

## 1. Research findings (this session)

### 1.1 What SSSF actually is

Cloned from `github.com/disler/super-simple-software-factory` to `~/src/super-simple-
software-factory`. It is **not a running service** — it's a Claude-Code-flavored skill
(`.claude/skills/sssf/`, `SKILL.md` + cookbooks) that gets *stamped* into a target repo's
root via `install.py`. Stamping generates:

- `adws/adw_*.py` — twelve starter ADW (AI Developer Workflow) scripts, one per chain
  shape (`adw_plan`, `adw_build`, `adw_plan_build_test`, `adw_simple_sdlc`, etc).
- `adws/adw_modules/` — all low-level logic: `agents.py` (config load/validate),
  `session.py`, `data_types.py` (envelope types), `gates.py`, `tracer.py`, `agent_pi.py`
  (spawns the `pi` CLI as a subprocess and tails its JSONL stdout), `permissions.py`
  (enforces `writes:`/`protected_files` via before/after repo diff), `git_helper.py`.
- `adws/adw_sssf_config/sssf.config.yaml` — the agent roster: one entry per agent
  identity (`planner`, `builder`, `scout`, `reviewer`, `documenter`), each with its own
  model (`provider/model-id`), thinking level, prompts (`system.md`/`user.md`), tools,
  and a `writes:` boundary.
- `adws/adw_data/sssf.db` — SQLite trace db, seven tables (`sessions`, `phases`,
  `events`, `envelopes`, `gate_results`, `agent_sessions`, `processes`), WAL mode, one
  cursor-poll query (`select * from events where adw_id=? and rowid>? order by rowid`)
  is the entire read transport — no websocket, no ingest endpoint.
- A separate read-only visualizer app (`apps/visualizer/`: Vue 3 + Vite frontend, Bun/TS
  server) that polls that same db. Confirmed real and functional (212+418+131 lines of
  non-trivial server/UI code), not a stub — despite `SKILL.md`'s own "v1 scope" note
  claiming it "ships in a later pass," which looks stale relative to the actual checkout.

**Core primitives worth keeping conceptually:**
- **Phases** (`engineer` / `agent` / `code` kinds), each a context manager; every phase
  defaults to `fail`, only a clean exit plus (for agent phases) a parsed envelope and
  green gates flips it to `success`.
- **Envelopes**: an agent's only output channels are files in `context_handoff/` and one
  final valid-JSON response parsed against a Pydantic `EnvelopeBase` subclass declared at
  the call site. Parse failure → re-prompt the *same* session with a correction, never a
  cold restart.
- **Gates**: `gate(envelope, run) -> GateReport`, verify claims *after* the fact
  (`artifacts_exist`, `files_non_empty`, `tests_pass(...)`, etc), never predictions.
- **The synced triad rule**: envelope type in `data_types.py`, the `## Report` JSON
  example in that agent's `user.md`, and `output_type=` at the call site are one
  contract — change one, change all three.

**What SSSF does NOT have, confirmed by reading the schema directly** (this matters a lot
for §0.3 above):
- `sessions.status` is a hard enum: `running | success | fail`. No `planned`, `pending`,
  or `backlog` state.
- `PhaseStatus = Literal["queued", "running", "success", "fail"]` — `"queued"` means "a
  phase declared in *this already-started run's* chain, not yet entered," not a
  pre-execution work item.
- **A "ticket" in SSSF is literally the CLI argument string.** `uv run adws/adw_plan.py
  "add a /health endpoint"` — the request doesn't exist as a durable record until the
  moment it's invoked. Invocation *is* creation. There is no data model anywhere for
  "work I've thought of but haven't run yet." Confirmed via `knowledge`-grade source
  read of `references/observability.md` and `templates/adws/adw_modules/data_types.py`,
  not inferred from the README.

### 1.2 This box's existing stack (context SSSF has to sit inside)

- **Model roles**: `docker/litellm/config.yaml` fronts local llama.cpp backends as
  dynamic, DB-backed litellm roles named by size+architecture, not function —
  `big-moe` (currently `laguna-s-2.1-118b-q4km`, 127.0.0.1:8108), `medium-moe`
  (currently `qwen3.6-35b-a3b-mtp`, 127.0.0.1:8109), plus `medium-dense`, `small-moe`,
  `small-dense`. Roles are reassignable live via `scripts/set-role.sh` (litellm Model
  Management API) without ever being git-tracked at their live value — git only tracks
  that a role name should exist, with an obviously-fake stub.
- **Two `pi-web` variants are deployed side by side**, both currently defined in
  `docker/docker-compose.yml`:
  - `pi-web` service (`github.com/agegr/pi-web`, build context `../pi-web`) — the
    original side-by-side comparison winner (M-037), `network_mode: host`, port 30141.
  - `jmfederico-pi-web` service (`ghcr.io/jmfederico/pi-web`, build context
    `../jmfederico-pi-web`) — bridge-networked, port 8080→3000, `working_dir: /work`
    bound to a single project (`/home/chris/turnstone-workspace/printer-dashboard`).
  - **Both service blocks declare `container_name: pi-web`** — a latent naming collision
    in the compose file, unrelated to this design work but worth a housekeeping flag.
    Confirmed live on the box: the container currently running under the name `pi-web`
    is the **jmfederico** one (`docker exec pi-web sh -c 'bun pm -g bin'` resolved to
    `/home/piweb/.bun/bin`, and `@jmfederico/pi-web` is the only globally-installed bun
    package there). All research in this doc targeted **that** running container — the
    `jmfederico/pi-web` stack the user named explicitly, not `agegr/pi-web`.
  - `jmfederico-pi-web`'s own model config already speaks the exact convention we need:
    `models.seed.json.tmpl` seeds a `local-litellm` provider (`baseUrl:
    http://host.docker.internal:4000/v1`) with model entries whose `id` is literally
    `medium-moe`, `big-moe`, `medium-moe-continue-json`, etc — i.e. **the big-moe/
    medium-moe role names are already first-class model IDs inside pi-web's own config,
    zero new plumbing needed** to reference them.
  - Installed version, confirmed via `docker exec pi-web cat .../package.json`:
    `@jmfederico/pi-web@1.202607.3`, depending on `@earendil-works/pi-coding-agent
    >=0.82.1 <0.83`. This is the version the sub-agent's source research was pinned
    against (`git checkout v1.202607.3` — exact tag match, no drift).
  - No standalone `pi` CLI binary exists anywhere in the running `pi-web` container
    (`which pi` → not found; global bun package list has nothing else). The bare `pi`
    engine is bundled as an internal dependency of `@jmfederico/pi-web`'s own server/
    sessiond processes, not exposed for outside subprocess use — this is *why* driving
    everything through pi-web's own HTTP API (rather than trying to get a bare `pi`
    binary onto PATH somewhere) is the right call, not just a workaround.
  - pi's native Agent Skills mechanism (`@earendil-works/pi-coding-agent`'s
    `core/skills.js`) already loads `SKILL.md` files from
    `$PI_CODING_AGENT_DIR/skills/<name>/` into every session's system prompt
    automatically — already exercised for `pi-web`'s (agegr variant's) own
    `adding-tools-to-pi-web` skill. Confirms the `SKILL.md` format itself is portable to
    a pi-driven session, independent of Claude Code — not that we necessarily need this
    for pi-web-factory, since it's meant to be invoked directly, not skill-routed.

### 1.3 pi-web's session REST/WebSocket API (the execution primitive we'll build on)

Researched by cloning `github.com/jmfederico/pi-web` at tag `v1.202607.3` to
`/tmp/pi-web-research` (local Mac, not over SSH) and reading source directly —
`src/server/sessions/sessionRoutes.js` registers ~44 routes. The ones that matter:

| Route | Purpose |
|---|---|
| `POST /sessions {cwd, startupToken}` | Start a session. `cwd` is validated only as a non-empty **absolute path** (`normalizeRequestCwd`, `src/server/workingDirectory.ts:26-30`) — **no** project/workspace pre-registration required. That gating (`pathAccessPolicy`/`effectivePathAccess`) only applies to file-browser routes and the LLM's own `spawn_session` tool, not to external API callers. |
| `POST /sessions/:id/model {provider, modelId}` | Set the model for a session — this is how a phase gets pinned to `local-litellm`/`big-moe` or `medium-moe`. |
| `POST /sessions/:id/prompt {text}` | Send a message. **Fire-and-forget** — returns `{accepted: true}` immediately, does not block until the turn finishes. |
| `GET /sessions/:id/status` | Returns a `SessionStatus` (booleans, not an enum): `isStreaming`, `isCompacting`, `pendingAsk`, `pendingDialogs`, `queuedMessages`, token/cost/context usage. Turn-complete = `isStreaming === false && pendingAsk === undefined`. |
| `GET /sessions/:id/events` (WebSocket) | Emits `agent.start`, `agent.end`, `message.end`, `tool.*`, `status.update`, `ask.opened/closed`, `session.error`, etc. **`agent.end`** is the authoritative "turn is fully done" signal — `message.end` fires per-message and is not the same thing when a turn has intermediate tool calls. |
| `GET /sessions/:id/messages` | Structured transcript (`projectBrowserMessageResponse`), not raw JSONL — reads off the same live in-memory session object `GET /status` does, so once `agent.end`/`isStreaming:false` is observed, the final message is guaranteed present (no race — both are published synchronously in the same subscriber callback, `piSessionService.ts:3133-3142`). |
| `POST /sessions/:id/abort`, `/stop`, `DELETE /sessions/:id` | Lifecycle/cleanup. |
| `POST /sessions/:id/queue/clear` | Clears prompts queued (`steer`/`followUp`) because `/prompt` was called while a turn was *already* streaming on an *already-active* session. Unrelated to cross-session ticket queueing (see §1.4). |

**No blocking/long-poll variant exists anywhere in the codebase** (grepped for it
directly) — polling `/status` or holding the `/events` WebSocket open for `agent.end` is
the only mechanism. This is the one place "point pi-web-factory at the API and it'll
Just Work" isn't literally true — a small wait-loop has to be built; everything else
about the API is a clean fit.

**Session identity is durable and reopenable from any process.** IDs come from
`@earendil-works/pi-coding-agent`'s own `SessionManager`, backed by real files under
`<agentDir>/sessions/--<escaped-cwd>--/`. Every session-scoped route resolves its target
generically (`getOrOpen` → in-memory `active` map → falls back to `sessionManager.list
(cwd).find(id) → sessionManager.open(path)`), so a `(sessionId, cwd)` pair minted hours
ago, in a since-restarted pi-web process, resumes exactly the same way a fresh one does.
This is at least as good as — arguably better than — SSSF's own `--session-id`
create-or-continue semantics, since it survives a full pi-web process restart, not just
within one run.

### 1.4 System prompts: architecturally separate from message history, and pi-web's API doesn't expose one

Checked directly against the installed `@earendil-works/pi-coding-agent@0.82.1` SDK
(`npm install`ed into `/tmp/pi-web-research` to read real `.d.ts` files, not guessed)
and pi-continue's actual installed source on the box
(`/home/piweb/.pi-web/npm/node_modules/pi-continue/`).

**SSSF (source) has a true per-agent system prompt.** `sssf.config.yaml`'s roster gives
each agent its own `system.md`, and `agent_pi.py:224` passes it straight to the bare
`pi` CLI's real `--system-prompt` flag.

**pi-web's session API has no equivalent, confirmed at the SDK level, not just the HTTP
layer:**
- `SessionManager.create(cwd, sessionDir?, options?)`'s `NewSessionOptions` type is
  `{id?, parentSession?}` — no `systemPrompt` field. `piSessionService.ts`'s `start()`
  (the method `POST /sessions` calls) only ever forwards `parentSession` to it.
- The persisted session message model has exactly three roles — `"user" | "assistant" |
  "toolResult"` — there is no `"system"` role to inject one into via the message history
  at all.
- `systemPrompt` **is** a real, separate, structurally distinct construct elsewhere in
  the stack — `AgentSession._baseSystemPrompt`, sourced from `ResourceLoaderOptions`
  (`resource-loader.d.ts:76`), which is itself populated from **CLI args**
  (`cli/args.d.ts:11`), not from any persisted/discoverable config file `SessionManager`
  or pi-web's HTTP layer touches. It's recomputed live at session bootstrap, not stored
  as a message, and there's a dedicated extension hook to override it per turn:
  `BeforeAgentStartEventResult.systemPrompt?: string` — "Replace the system prompt for
  this turn. If multiple extensions return this, they are chained"
  (`extensions/types.d.ts:797`, fired on `before_agent_start`).
- **This is load-bearing elsewhere in the stack, not incidental**: pi-continue's own
  prompt-construction code (`extensions/continue/src/prompt.ts:41`) builds
  `{systemPrompt: assets.system.content, userPrompt: sections.join(...)}` as two
  genuinely separate fields for its own summarizer calls.

**Why this is a real gap, not a cosmetic one.** Compaction only ever acts on message
history — a true system prompt is structurally immune to it. Our workaround (folding
role identity into the first `POST /sessions/:id/prompt` text) puts it in ordinary
message history instead, exposed to: (a) pi's own auto-compaction on a long-running
phase, and (b) a pi-continue handoff, whose `brief` schema (`task`, `done_when`,
`forbid`, `established`, `learned`, `open`, `next`) has **no slot for agent
persona/identity** — a continuation session isn't guaranteed to inherit our role framing
at all, since a true system prompt gets recomputed fresh at bootstrap regardless of
history, and our substitute doesn't. Risk is low for short, single-turn phases (the
common case) and real for phases with multi-turn gate-correction loops or anything long
enough to approach a compaction/handoff trigger.

**Decided 2026-08-03**: ship with the prepended-text workaround for now (§3.2/§3.3
unchanged), accept the risk described above as a known limitation, and track the proper
fix as **M-069**, filed to `blocked/` pending Chris's go/no-go — see §5.

**A promising correction to how M-069 should actually be scoped**, found while digging
into the mechanism above: the fix likely does **not** require patching pi-web's REST
routes or its `SessionManager`/`AgentSession` construction internals at all. The
`before_agent_start` → `systemPrompt` override hook (above) is an already-stable,
sanctioned **extension** integration point — the same mechanism `pi-continue` itself
uses to hook the agent loop, and the same "bake in a small extension" pattern already
proven in this stack via `pi-continue-companion` (§1.2). A small pi-web-factory-owned
extension that recognizes a factory-started session (e.g. via the `startupToken` field
`POST /sessions` already accepts, described in its own source as "an opaque label the
caller uses to recognise its own construction's startup reports" — exactly the kind of
marker this needs) and returns the right role's `systemPrompt` on `before_agent_start`
would get a true system prompt with **zero changes to `@jmfederico/pi-web`'s own
source** — a better fit for the "preserve pi-web as-is" constraint than the REST-route
patch this was originally framed as. M-069 records this as the primary approach to
investigate first, not a REST patch as Plan A.

### 1.5 No native queue/kanban/ticket system in pi-web, and nothing runs autonomously

Grepped the full pi-web source for `cron`, `scheduler`, `chokidar`/`fs.watch`, `ticket`,
`kanban`, `backlog`, `todo` — nothing resembling an autonomous work-picker exists.
`queue/clear` (above) is about buffered prompts *inside one already-live session*, not
cross-session work items. **Confirmed: nothing in pi-web ever starts a session or sends
a prompt on its own — every unit of work requires an explicit external `POST /sessions`
+ `POST /prompt` call.** Combined with §1.1's finding that SSSF has the identical gap,
this means: no layer in the current design does deferred/plannable ticket storage. That
has to be built (§3), and nothing existing competes with or needs to be reconciled
against it.

## 2. Design constraints restated for §3+

- **No per-project stamping.** One copy of pi-web-factory, baked into the
  `jmfederico-pi-web` image (same pattern as the already-baked, always-synced
  `pi-continue-companion` plugin — `COPY` in the Dockerfile, re-synced on every
  container start via `docker-entrypoint.sh`, so the running copy never drifts from
  what's committed to git).
- **Addresses multiple projects by `cwd`, not by repo location.** Confirmed free in
  §1.3 — no pre-registration needed, so pi-web-factory's "which project" parameter is
  just an absolute path passed straight through to `POST /sessions`.
- **Trace/config storage must live outside any project repo too**, since the whole
  point is one shared control plane. Natural home: the same persistent-volume
  convention `jmfederico-pi-web` already uses for its own state (`~/.pi-web` /
  `PI_CODING_AGENT_DIR`), e.g. a sibling directory or the same volume, not
  `<project>/adws/adw_data/` like stock SSSF.
- **Ticket storage is explicitly out of scope for this pass** — build the execution
  core so that "a human runs a command" and "a future `.fleet`-lite worker picks a
  card off `now/`" are two callers of the *same* entrypoint, not two different code
  paths.
- **Zero required changes to `@jmfederico/pi-web` itself.** Every primitive needed
  (start session, set model, prompt, detect completion, read transcript) already
  exists as a stable HTTP/WS API. pi-web-factory is a sibling process/script inside
  the same container, talking to `pi-web-server` over `http://127.0.0.1:<port>`
  (loopback, since they're in the same container/network namespace) — never a fork of
  its frontend or server code.

## 3. Design sketch

### 3.1 Shape

```
jmfederico-pi-web/                     # existing build context (docker/docker-compose.yml)
  pi-web-factory/                      # NEW — baked in, always-synced like plugins/pi-continue-companion
    package.json                       # bun project, minimal deps: zod, yaml, commander (or plain arg parsing)
    factory.config.yaml                # agent roster: identity -> {provider: local-litellm, modelId: big-moe|medium-moe|...} + per-project quality-gate commands
    chains/                            # chain definitions — the ADW "scripts", one file per chain shape, mirrors SSSF's adw_*.py 1:1 in shape
      planBuildTest.ts
      buildReview.ts
      ...
    modules/
      piwebClient.ts                   # POST/GET/WS wrapper + agent.end wait-loop (replaces agent_pi.py's subprocess/JSONL tailing) — M-062
      envelopes.ts                     # Zod envelope schemas per phase (PlanOutput, BuildOutput, ReviewOutput, ...) — M-063
      gates.ts                         # gate functions — same "verify claims from the envelope + repo diff" shape as SSSF — M-063
      tracer.ts                        # writes phase/event/envelope/gate rows to the shared trace db via bun:sqlite — M-061
      permissions.ts                   # writes:/protected_files enforcement via before/after repo diff — cwd-scoped, ports almost unchanged — M-064
      config.ts                        # factory.config.yaml loader/validator — M-065
    factory.db                         # SHARED SQLite trace db across ALL projects — sessions table gains a project_cwd column (stock SSSF's schema is per-repo single-project; this needs that one addition)
    cli.ts                             # entrypoint: `factory run --project <abs-path> --chain <name> [--session-id <id>] "<prompt or path/to/prompt.md>"` — M-067
```

(`M-06x` annotations above map each module to the fleet card that builds it — see §5.)

`factory.db` and any per-run artifacts (envelope.json, raw transcripts if we choose to
mirror them locally rather than always re-fetching via `GET /messages`) live in the
same kind of persistent volume `jmfederico-pi-web` already mounts for its own state —
survives rebuilds/redeploys the same way pi-web's own sessions already do (confirmed in
`docs/adding-tools-to-pi-web.md`: session history in the named volume survives a
rebuild).

### 3.2 The execution primitive (replaces `agent_pi.py`)

One phase call, sketched as pseudocode regardless of eventual language:

```
session_id = POST /sessions { cwd: project_path, startupToken: adw_id+phase_name }
POST /sessions/{id}/model { provider: "local-litellm", modelId: role_for(agent_identity) }
POST /sessions/{id}/prompt { text: role_identity_preamble(agent_identity) + "\n\n" + phase_prompt }
  # role_identity_preamble = today's substitute for a true system prompt (§1.4) — decided
  # 2026-08-03 to accept this for now rather than block on M-069
wait_for_agent_end(session_id)      # WebSocket agent.end, or poll /status until isStreaming==false
  # if pendingAsk appears instead of a clean end: this phase is BLOCKED-ON-HUMAN, not
  # failed — surface it distinctly (maps naturally onto a future "needs-input" queue
  # column, same spirit as .fleet's blocked/ column)
messages = GET /sessions/{id}/messages
envelope = parse_last_assistant_message_as_json(messages, output_type)
run_gates(envelope, ...)
tracer.record(...)
```

Session continuation across phases/chains: store `(session_id, cwd)` from phase N,
reuse it as the target for phase N+1 exactly like SSSF's `--adw-id` chains today —
except now backed by pi-web's own durable, restart-surviving session store rather than
a `pi --session-id` subprocess flag.

### 3.3 Implementation language — decided: TypeScript/Bun

Confirmed 2026-08-03. Matches the container's native runtime (`jmfederico-pi-web`
already ships Node 22 + Bun; `python3` there is a `node-gyp` build dependency only, not
a real Python environment) — no second toolchain added. `bun:sqlite` (Bun's built-in
SQLite binding, no external dependency) replaces `sqlite3`+Python's stdlib `sqlite3`
module for `tracer.ts`; Zod replaces Pydantic for envelope schemas. This is a real
reimplementation from spec (this doc + SSSF's schema), not a port of SSSF's Python — the
module boundaries below are chosen to mirror SSSF's own (`agent_pi.py` →
`piweb_client.ts`, `data_types.py` → `envelopes.ts`, `gates.py` → `gates.ts`,
`permissions.py` → `permissions.ts`) so anyone who's read upstream SSSF can navigate
this by name alone.

### 3.4 The ticket-layer seam (deferred, but designed for now)

Define a `WorkItem` shape today, even with no storage behind it yet:

```
WorkItem = {
  project: <abs path>,        # -> cwd
  chain: <chain name>,
  prompt: <string or path to a spec file>,
  session_id?: <existing session to resume, for a retry/continuation>,
  model_overrides?: { <agent identity>: <role> }
}
```

`cli.ts run` takes exactly these fields as arguments today (human types the command).
When the `.fleet`-lite `backlog/now/done` layer exists, its worker loop's only job is:
pull a card from `now/`, build a `WorkItem` from its frontmatter/body, and call the
*same* `run` entrypoint (as a library call, not necessarily a re-exec) — no change to
the execution core, gates, tracer, or envelope contract. This is the concrete
mechanism for "manual now, queue-driven later" being an additive change, not a
migration.

### 3.5 Web UI

No planned changes to `@jmfederico/pi-web`'s frontend or server. pi-web-factory-driven
sessions are ordinary sessions from pi-web's own point of view — they should show up
in the existing browser UI like any session started by hand, since nothing about
`POST /sessions`/`POST /prompt` distinguishes an API caller from a browser click at the
server layer. This also means a human can watch (or intervene in) a pi-web-factory-
driven phase live, mid-run, through the UI you already use daily — not available in
stock SSSF at all.

Observability for the *factory* layer itself (phase sequence, gates, trace history
across projects) is a separate question from the pi-web UI and is explicitly deferred —
options range from "no UI yet, query `factory.db` directly" (SSSF's own smoke-test
default) to porting SSSF's Vue visualizer, to a future panel inside pi-web itself (which
*would* require a pi-web source change, and is therefore not the default plan).

## 4. Open questions / explicitly deferred

- Exact `WorkItem`/card schema and the `.fleet`-lite storage format itself (§3.4) —
  intentionally not designed in this pass.
- Where `factory.db` physically lives (which volume/mount) — sketched as "same pattern
  as pi-web's own state," not pinned to a path yet.
- Gate implementations beyond the conceptual carry-over from SSSF (`artifacts_exist`,
  `files_non_empty`, `tests_pass`, etc.) — needs per-project awareness now that one
  factory instance spans N projects with potentially different test/lint commands.
  Stock SSSF's `quality.py` is per-repo and hand-edited; a shared factory needs this to
  be per-project-configurable, not hardcoded once. (Tracked by M-065's per-project
  quality-command config, M-063's gate implementations.)
- Observability/visualizer story (§3.5, last paragraph) — no card yet, deliberately;
  revisit once the execution core (M-061..M-068) is live and there's real trace data
  to look at.
- Auth/network exposure posture for anything new — inherits the existing stack's
  explicit no-auth/LAN-only choice by default, not re-litigated here.
- The `docker-compose.yml` `container_name: pi-web` collision between the `pi-web` and
  `jmfederico-pi-web` services (§1.2) — explicitly deferred, Chris will clean up later,
  not tracked as a card.
- True per-role system prompts (§1.4) — decided to ship the prepended-text workaround
  for now; the proper fix is filed as M-069, blocked on Chris's go/no-go, not on any
  other card.

## 5. Units of work

Broken out on the fleet board (`.fleet/board/`) as `M-061` through `M-069`, one card per
module boundary in §3.1's tree (plus M-069, the deferred system-prompt fix), sequenced
by real dependency (not arbitrary):

| Card | Builds | Depends on |
|---|---|---|
| M-061 | Bun/TS project scaffold + shared trace db schema (`bun:sqlite`, `sessions`/`phases`/`events`/`envelopes`/`gate_results` tables + `project_cwd` column) + `tracer.ts` | — |
| M-062 | `piwebClient.ts` — session start/model/prompt + `agent.end` wait-loop (WebSocket, poll fallback) against the live pi-web API | — |
| M-063 | `envelopes.ts` (Zod schemas per phase) + `gates.ts` (claim-verification functions) | — |
| M-064 | `permissions.ts` — `writes:`/`protected_files` enforcement via before/after repo diff | — |
| M-065 | `factory.config.yaml` schema + `config.ts` loader — agent roster (identity → role) + per-project quality-gate commands | — |
| M-066 | `chains/` — phase orchestration wiring client + envelopes + gates + permissions + config together, mirroring SSSF's `adw_*.py` shape | M-062, M-063, M-064, M-065 |
| M-067 | `cli.ts` — `factory run --project <path> --chain <name> [--session-id <id>] "<prompt>"` entrypoint | M-066 |
| M-068 | Docker bake-in (`jmfederico-pi-web/Dockerfile` `COPY` + always-synced entrypoint step, mirroring the `pi-continue-companion` plugin pattern) + first live end-to-end smoke test | M-067 |
| M-069 | True per-role system prompts via a `before_agent_start` pi extension (§1.4) — filed to `blocked/`, pending Chris's decision, not sequenced into the main build | none (independent; touches M-063's prompt construction and M-066's chain orchestration if/when picked up) |

M-061 through M-065 have no dependencies on each other and can be worked in any order
(or in parallel by separate sessions/worktrees) before M-066 wires them together. Card
bodies link back to the specific section of this doc they implement rather than
duplicating the design — this doc is the source of truth for *why*, the cards track
*done or not*.

## 6. Revision 2026-08-04: project-local config, worktrees, deep-linking, skills

M-061 through M-067 shipped and work (§5, all `done`). Chris then reviewed the running
system and gave feedback that changes real pieces of the design below — recorded here
before any of it gets built, per this doc's own "record decisions before code" practice.

### 6.1 Feedback, verbatim intent

1. Per-project config (today: `factory.config.yaml`'s `projects:` map, centralized in
   `pi-web-factory/`) should live **in the target project's own repo** instead — same
   place the future durable ticket storage (§3.4's deferred `.fleet`-lite queue) will
   also live. Question raised: does this need pi-web's own "Project" concept, or can
   it just be a file?
2. **Session safety** — resolved already, see AGENTS.md's new hard-stop (2026-08-04)
   and `docker/agentic-fleet-AGENTS.md`'s local addendum. Not a design question, a
   policy one; closed.
3. Use pi-web's own **Workspace** primitive to organize pi-web-factory's sessions,
   rather than inventing our own scheme — one shared workspace for all runs, or a
   sharding scheme, "lean into the pi-web primitives."
4. **Agentic triggering as a first-class experience**: sitting inside any pi-web
   session, say "run the pipeline for X" and have it happen — a skill calling `cli.ts`
   under the hood is fine — ideally with a link back to the new session. Also: more
   chain shapes, matching SSSF's own variety — a lightweight plan→implement→review,
   and a fuller run with a *bounded* review↔build correction loop (max 3 rounds).
5. Fold in true per-role system prompts (M-069, previously parked pending this
   decision) **before** Docker.
6. Docker (M-068) goes last.

### 6.2 Research findings (pi-web source, tag `v1.202607.3`, cross-checked live)

**Projects.** `ProjectService` (`projectService.ts:6-31`) is a thin CRUD wrapper —
`{id, name, path, createdAt}` in a JSON store. `POST /sessions {cwd}` never
references it (confirmed again from source — registration was never required for
session creation, as established in §1.3). It gates exactly one thing: an
LLM-initiated **in-session** `spawn_session`/`spawn_subsession` tool call, restricted
to a registered project's known worktree paths (`spawnTargetResolver.ts:16-19,50-57`)
— irrelevant to pi-web-factory, which never uses that tool. `<project>/.pi-web/
config.json` (`projectPiWebConfig.ts:8-12`) is real but **closed-schema**
(`{version?, pathAccess?, uploads?}`) — parsed with unknown keys dropped, no
passthrough. **Not a usable extension point.**

**Workspaces.** No creation API exists. `WorkspaceService.list()`
(`workspaceService.ts:19-41`) only *discovers* existing worktrees via `git worktree
list --porcelain` — explicitly read-only (`workspaceService.ts:47`: "we never run
`git worktree prune`"). `POST /sessions` takes only `{cwd, startupToken}` — no
workspace id. **"Workspace" in pi-web is a visualization layer over real git
worktrees, not an API resource** — creating one means pi-web-factory runs `git
worktree add` itself and points `cwd` at the result; pi-web's own UI/discovery then
picks it up automatically, with no coordination needed on our side beyond using plain
git.

**Session deep-linking.** Confirmed from the client router (`route.ts:12-22`,
`PiWebApp.ts:562-579`): the working URL is
**`http://192.168.1.21:8080/?project=<projectId>&workspace=<workspaceId>&session=<sessionId>`**
— `session` alone is **not** sufficient; the router short-circuits before reading it
if `project` is absent. This is the one finding that forces a decision: **printing a
real, working link back to Chris requires a real `projectId` and `workspaceId`**,
which means registering the target repo as a pi-web Project after all — not for
config (§6.2's Projects finding rules that out), purely so runs are addressable and
so `POST /projects` gives us an id to build a correct link. Cheap and one-time per
project.

**Skills.** `PI_CODING_AGENT_DIR=/home/piweb/.pi-web` (confirmed live via `docker exec
pi-web env`), bind-mounted from host `~/.pi-web` (`docker-compose.yml`). No `skills/`
subdirectory exists yet on this deployment (only a *plugin*, `pi-continue-companion`,
has been used here before — a different mechanism). A pi-web-factory skill lands at
`~/.pi-web/skills/pi-web-factory/SKILL.md` on the host — the directory just needs
creating; the loading mechanism itself is already proven (§1.2).

### 6.3 Decisions

- **Per-project config moves into the target project's own repo.** A new file (name
  TBD in the implementing card — leading candidate: `.pi-web-factory.yaml` at the
  project root, discovered by simple existence-check, not through pi-web's Project
  registry) replaces `factory.config.yaml`'s `projects:` map. `factory.config.yaml`
  itself keeps the agent roster (shared across projects — that's genuinely
  pi-web-factory's own config, not any one project's) and `defaults.protected_files`.
  This **supersedes part of M-065** (the `projects:` map and `projectConfigFor`'s
  centralized lookup) — filed as a new card (§6.4), M-065 itself stays `done` and
  unedited as the historical record of what was actually built then.
- **Register the target repo as a pi-web Project, once, idempotently** — not for
  config (ruled out, §6.2), purely so `POST /sessions`-created runs are visible in
  pi-web's own UI and so `cli.ts` can resolve a real `projectId` for deep-linking.
- **Worktrees, created by pi-web-factory itself via plain `git worktree add`**, not a
  pi-web API (none exists). Every chain run gets pointed at a resulting worktree path
  as its `cwd` — this is *also* the answer to the design's own long-standing deferred
  gap ("no branch-per-run isolation," §4/§0) arriving for free from this feedback,
  not a separate effort.
- **Real session deep-links in `cli.ts`'s output**, using the confirmed
  `?project=&workspace=&session=` pattern — the thing that was deliberately *not*
  fabricated back in M-067 (no confirmed URL scheme at the time) is now buildable.
- **A `pi-web-factory` Agent Skill**, `SKILL.md` at `~/.pi-web/skills/pi-web-factory/`,
  routing natural-language requests inside any pi-web session to the right chain and
  shelling out to `cli.ts` — mirroring SSSF's own `SKILL.md` routing-table pattern
  (this doc's §1.1), adapted to the fact that pi-web-factory's actual logic already
  lives in TS, not in the skill itself. The skill is UX, not execution.
- **New chain shapes**: a lightweight `planImplementReview.ts` (three phases, no
  loop), and a fuller chain with a genuinely *bounded* build↔review correction loop
  (max 3 rounds, mirroring upstream SSSF's own `adw_build_review` restraint) —
  distinct from the already-built, unbounded retry-on-parse-failure loop inside
  `run.ts` (that one retries a single phase's malformed JSON; this one is a
  multi-phase review-rejects-then-build-fixes cycle at the chain level).
- **M-069 unblocked** — moves from `blocked/` into active work, ahead of M-068.
- **M-068 (Docker) stays last**, now blocked on all of the above rather than directly
  following M-067.

### 6.4 One open question, not yet decided

**Worktree sharding scheme** — one worktree per chain *run* (maximum isolation,
directly closes the "no isolation" gap, but worktrees accumulate and need a cleanup
policy), one shared worktree reused across all pipeline runs for a given project
(simpler, no cleanup policy needed, but runs can collide with each other's
uncommitted state), or something in between (e.g. one worktree per chain *type*), is
Chris's call — asked directly, not decided here.

**Resolved 2026-08-04**: one worktree per Workflow Run (§7.5) — closes the isolation
gap; cleanup policy is M-071's job.

## 7. Terminology formalized 2026-08-04 (second revision)

Prompted by a clarifying question about how a run maps to phases/sessions/
observability (§6's "chain"/"phase"/"adwId" language was never load-bearing outside
this doc — worth locking down properly before more code or a visualizer gets built on
top of loose terms). **These four terms replace "chain," "chain run," "phase," and
"agent identity" everywhere going forward — in this doc, in code, in card titles.**
§1–§6 above are left as the historical record of how the system was actually built and
researched; they are not retroactively rewritten to the new vocabulary.

### 7.1 Definitions

- **Workflow Run** — one execution of a single, top-level, open-ended prompt. What
  §1–§6 called a "chain run" / `adwId`. The prompt can be a literal task ("add a
  /health endpoint") or, once durable ticket storage exists, something like "read
  M-066 from durable storage and complete it, then update M-066 and move it to done if
  successful" — the openness of the prompt is exactly what lets a future ticket-intake
  step be built as an ordinary Workflow Run rather than a special case.
- **Workflow** — a named, reusable *template* for an ordered sequence of Steps. What
  §1–§6 called a "chain" (`chains/planBuildTest.ts`). The important shift: a Workflow
  is now **YAML-configured data**, interpreted by one generic runner — not a
  hand-written TS file per shape. Configured **globally for the whole machine** (not
  per-project — same locality as the roster always had, §2/§6.3), since a Workflow
  template (e.g. "plan → build → test") isn't a property of any one project.
- **Step** — one unit of work inside a Workflow. What §1–§6 called a "phase." Two
  kinds:
  - **Agentic step** — one bounded agent turn (or retry-on-parse-failure sequence),
    naming which **Role** it uses.
  - **Code step** — a deterministic, non-agent action (e.g. running a project's test
    command). Also names a **Role** — for a code step, "role" resolves to an internal
    factory function reference, not a model/prompt. Same field, two meanings by kind;
    the factory wires a code step's named role to the right function internally.
- **Role** — the unified concept covering what §1–§6 split into "agent identity"
  (`AgentConfig`: model, thinking, `writes:`) and an implicit, never-quite-named
  concept for code steps. A Role is configured globally (same file as Workflows —
  §7.2), and now also carries **the agent's system prompt** (folds in M-069 once that
  extension mechanism exists — a Role's system prompt is real, first-class config,
  not the M-066-era prepended-text workaround). A code Role has no model/prompt at
  all — just a name the factory's internal function registry resolves.

### 7.2 Global config, restated

Two YAML documents, both global (machine-wide, not per-project — contrast M-070's
project-local `test`/`typecheck`/`lint` settings, which stay per-project):

- **Roles** (supersedes `factory.config.yaml`'s `agents:` list as designed in M-065):
  one entry per Role name, `kind: agent | code`. Agent roles carry model, thinking,
  `writes:`, and (once M-069 lands) a real system prompt. Code roles carry a reference
  the factory resolves to an internal function (e.g. a role named `run-tests` wires to
  `gates.ts`'s `testsPass`, parameterized by the project-local `test` command from
  M-070).
- **Workflows**: one entry per Workflow name, an ordered list of Steps. Each Step
  names its `kind` and `role`. At least two shapes ship: a simple `plan → build →
  review` (no loop — §6.1 point 4's "lightweight" ask) and a fuller one with a bounded
  build↔review correction loop (§6.1 point 4's "complete run," max 3 rounds). The
  bounded loop needs *some* control-flow expressiveness beyond a flat step list — the
  plan is a native `loop` step kind the generic runner understands (`steps: [...],
  until: <condition>, max_rounds: 3`), not a general scripting language. Scope stays
  deliberately narrow: two known shapes, not a workflow DSL.

### 7.3 Observability data model, restated

Per Workflow Run, tracked (renames `sessions` → conceptually "workflow_runs";
`phases` → "steps" — actual SQL/TS identifier renames are M-074's job, not decided
character-by-character here):

- **Workflow Run**: title, initial prompt, status, total cost/tokens, project cwd —
  all of this already exists on the `sessions` table except **title**, which is new
  (derived from the prompt when ad hoc, or from a ticket's own title once durable
  storage exists).
- **Step**: start time, stop time, `kind` (`agent` | `code` — narrower than today's
  three-value `kind`, `"engineer"` was never actually used), which Role, status,
  output (a short summary — an agent step's envelope `summary`, a code step's gate
  result headline), and **token usage (input/output/cached), per step, when known** —
  new: today's schema only accumulates tokens at the Workflow Run level
  (`sessions.total_tokens`), not per-step. Needs new columns on the steps table, not
  just reading `events.payload_json` on demand.

### 7.4 Visualizer, un-deferred

§3.5 explicitly deferred this ("no UI yet, query `factory.db` directly... a future
panel inside pi-web itself"). Un-deferred now, with real requirements:

- **One card per Workflow Run**, rendering that run's Steps as a Gantt-style
  timeline — this was always the schema's shape (§7.3's Step start/stop times,
  `parent_id`-nested tool calls within an agentic step), just never had a UI.
- **Idle/paused time is collapsed, not drawn to scale.** A Workflow Run blocked on a
  human, or simply waiting between steps, should not stretch the visual timeline —
  only active time renders at scale. (Mechanically: render each Step's actual
  start→stop span; gaps between a Step's `ended_at` and the next Step's `started_at`
  compress to a fixed small gap rather than their real duration.)
- **Real-time**: animation and highlight effects on whatever Step is currently
  active — this needs a live data path, not just a page that renders once. `events`'
  existing cursor-poll pattern (`select * from events where adw_id=? and rowid>?`,
  §1.3's read transport) is the natural fit — same "no websocket, no ingest endpoint,
  reads never block writers" design SSSF's own visualizer already proved out, just
  needs an actual frontend now.
- Not yet decided: framework/stack for this (SSSF's own is Vue+Vite+Bun; no reason to
  deviate, but not committed here) — left to the implementing card.

### 7.5 Card impact

This reshapes cards filed in §6 that hadn't been built yet (M-066/M-073's *shipped*
work stays historical, per §7's own opening note):

- **M-066 (`done`)**: stays as the historical first Workflow Run implementation
  (hand-written TS, not yet YAML-driven). Not rewritten.
- **M-073 → superseded before any work started.** Its "write more TS chain files"
  framing is now the wrong shape entirely — replaced by a generic Workflow
  interpreter (new card, §7.6) that makes *adding* a Workflow a YAML edit, not a new
  TS file. M-073 itself should be closed/withdrawn rather than worked as originally
  scoped.
- **M-069, M-070, M-071, M-072**: still valid in substance, need terminology
  alignment in their bodies when picked up (Role instead of agent identity, Workflow
  Run instead of chain run, etc.) but no architectural change.
- New cards needed, filed in §7.6.

### 7.6 New units of work

| Card | Builds | Depends on |
|---|---|---|
| M-074 | Schema/terminology migration: `sessions`→workflow-run-shaped (+`title`), `phases`→step-shaped (narrow `kind`, rename `owner`→`role`, add per-step token columns + `output_summary`) in `modules/schema.ts`/`tracer.ts`. Foundation for everything below. | — |
| M-075 | Global Roles config (§7.2) — unifies agent Roles (model/thinking/writes/system-prompt) and code Roles (internal function reference) in one YAML file, supersedes M-065's `agents:` roster shape. Folds in M-069's system prompt field once that mechanism exists. | M-069, M-074 |
| M-076 | Generic Workflow interpreter — YAML-defined Step sequences (including the native `loop` step kind for the bounded build↔review cycle), one runner (extends `run.ts`) executing any Workflow definition against the Roles registry. Replaces M-073's withdrawn scope. | M-074, M-075 |
| M-077 | Visualizer (§7.4) — one card per Workflow Run, Gantt-style Step timeline, idle-time collapsed, real-time animation via the existing cursor-poll pattern. | M-074 |

M-068 (Docker) stays last, now also blocked on M-074/075/076/077 in addition to
M-069/070/071/072 (§6.3) — still "docker last," the set it's waiting on just grew.
