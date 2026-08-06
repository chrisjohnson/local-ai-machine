---
id: M-094
title: Cross-model request serialization — standalone queue proxy in front of litellm
initiative_id: null
claimed_by: claude
claimed_at: '2026-08-06T04:15:00Z'
blocks: null
blocked_by: null
status: null
related_cards: [M-037, M-078, M-089]
---

# M-094 — Cross-model request serialization — standalone queue proxy in front of litellm

## Context
Chris, 2026-08-06: two concurrent pi-web-factory Workflow Runs hitting *different*
roles (different physical model backends) have no protection today — litellm
forwards both immediately, and since Strix Halo is memory-bandwidth-bound (not
compute-bound — the same conclusion the M-055/M-086 DFlash research kept
reaching, ~120-135GB/s shared LPDDR5X as the hard ceiling), concurrent decode
against two different resident models means both requests genuinely compete for
that bandwidth. Worse, if their combined KV-cache footprint on top of already-
resident model weights exceeds headroom, that's a real OOM — the same failure
class already seen twice this session (M-037's incident, Ornith's two OOM kills
per M-078's decision log), just triggered by concurrent *requests* against
already-loaded models instead of concurrent container starts.

This card assumes a STABLE, already-loaded set of models mapped to roles with
acceptable memory headroom — it's specifically about request-level contention
between already-running models, not about the "too many containers loading at
once" problem (separate, already-documented failure mode, no automated fix
either, out of scope here).

**Design REVISED 2026-08-06 (superseding the original in-process-litellm-
callback idea — see prior git history of this card for that version):**
- **A standalone reverse proxy, not a litellm callback.** Listens on port
  **4001** (confirmed free — grepped `docker/docker-compose.yml` for every bound
  port), sits in front of litellm (port 4000, `network_mode: host`), forwards
  every request through transparently — same method, headers (Authorization
  included, untouched), body, and crucially the SAME streaming behavior for SSE
  chat-completion responses (buffering would break streaming; must proxy the
  response body as a stream, not read-then-rewrite). Auth is pure passthrough —
  the proxy has no auth logic of its own; litellm's own master-key/virtual-key
  check remains the only real gate, exactly as it is today.
- **Why a separate proxy instead of an in-process callback (Chris's call,
  better than my original design):** litellm itself stays reachable directly on
  port 4000 at all times, completely unaffected by the queue. That's a real,
  cheap escape hatch — if the queue ever misbehaves, any caller can just point
  at :4000 instead of :4001 and bypass it entirely, no config edit or restart
  needed. The original callback design only had an all-or-nothing kill switch
  (edit `config.yaml`, restart the whole proxy).
- **Semaphore correctness for streaming responses (the one deep correctness
  risk):** the semaphore must stay held for the ENTIRE duration of a response,
  including every streamed chunk — release only once the stream is fully
  drained/closed, not when headers first arrive. Releasing early would let a
  second request start real decode work while the first is still actively
  streaming tokens, defeating the entire point (both would compete for memory
  bandwidth exactly like today, just with extra proxy hops). This is the thing
  most likely to be gotten subtly wrong — flag it explicitly in review.
- **Networking:** litellm runs `network_mode: host` specifically so it can bind
  to the host's own port 4000; the new proxy needs to reach it at
  `127.0.0.1:4000`, which means the proxy container ALSO needs `network_mode:
  host` (a bridge-networked container's "127.0.0.1" refers to itself, not the
  host — this exact gotcha is already documented elsewhere in this compose file
  for prometheus/litellm's own reasons for host networking).
- **Every request through the proxy gets the protection, including human-
  driven pi-web sessions IF/WHEN pi-web is pointed at it** — deliberate, not a
  gap. A human just experiences a slightly slower response, the same
  "invisible, no client changes needed" property that makes this whole
  approach work, matching the existing `-np 1` llama.cpp behavior everyone
  already experiences today.
- **Two explicit phases, with a hard pause between them (Chris's instruction):**
  - **Phase 1 (do now):** build the proxy, test it completely standalone —
    correctness of the semaphore/forwarding/streaming/auth-passthrough/bypass
    properties — using synthetic/mock slow endpoints for the concurrency tests,
    NOT real models. This deliberately avoids any GPU/memory contention with
    whatever else is running on the box (a second background agent is
    currently mid-benchmark on this same box for an unrelated card, M-086) —
    Phase 1 should have zero interaction with model-serving containers.
  - **PAUSE HERE.** Do not repoint pi-web at the new port. Do not touch
    `waitForCompletion`'s timeout. Report back for explicit go-ahead first.
  - **Phase 2 (gated, needs a fresh go-ahead):** point `pi`/pi-web at
    `:4001` instead of `:4000`, THIS is when the `PI_WEB_FACTORY_STEP_
    TIMEOUT_MS` override (see Research section below) gets set to something
    real, and THIS is when real end-to-end tests with actual pi-web-factory
    Workflow Runs happen — confirming no regression vs. today's behavior and
    genuine, correct queueing under real concurrent load.

## Research: is a Workflow-step-only timeout override even possible?
**Yes — confirmed via direct code reading, relevant to Phase 2 only:**
- `modules/piwebClient.ts`'s `waitForCompletion()` is pi-web-factory's OWN
  wait-loop, built specifically because (per that function's own doc comment)
  "there is no blocking/long-poll HTTP variant anywhere in pi-web." It already
  takes an optional `timeoutMs` (default `120_000`), already plumbed as
  `waitOptions` through `modules/run.ts`'s `runAgentPhase()`, which both
  `modules/workflow.ts` and `chains/planBuildTest.ts` call. **Neither call site
  ever passes `waitOptions` today** — every Workflow Step uses the hardcoded
  120s default; the override plumbing exists end-to-end but has never been
  exercised.
- This code path is used ONLY by pi-web-factory driving pi-web programmatically.
  A human using pi-web's own browser UI never touches `piwebClient.ts` at all —
  separate frontend, separate (unbounded, human-patience) waiting behavior. So
  the timeout override cannot, by construction, change how a human waits.
- Confirmed no OTHER hardcoded timeout sits between `cli.ts`/the chains and
  `waitForCompletion`.
- **One real open question, unresolved by reading code — needs an empirical
  test in Phase 2:** `pi` (the agent CLI running inside each pi-web session)
  makes its OWN outbound call to litellm/the new proxy, with its OWN timeout,
  set by `pi`/pi-web's own config — a different layer than
  `waitForCompletion`. If a queued request sits long enough to hit THAT
  timeout first, the agent's own turn fails regardless of how generous
  pi-web-factory's own timeout is set.

## Plan
### Phase 1 — build + standalone test (do now, no model/GPU interaction)
1. [x] Implement the proxy — `docker/litellm-queue-proxy/server.ts`, a small
   `Bun.serve()` script. Module-level `Semaphore` class, count 1 (simplest
   correct baseline; scoping/raising the count is left as a documented
   future option, not built preemptively). Acquired before forwarding,
   released only after the (possibly streaming) response is fully relayed
   to the client — every exit path (success, upstream fetch error, empty
   body, stream error/cancel) releases exactly once via a single
   `releaseOnce()` guard. No deadlock on any proxied error.
2. [x] Transparent forwarding: same method, path+query, headers
   (Authorization forwarded byte-for-byte, only true hop-by-hop headers
   like `connection`/`transfer-encoding` stripped per RFC 7230 §6.1), body
   (request body streamed via Bun's `duplex: "half"`, response body
   streamed via a `ReadableStream` wrapper that releases the semaphore
   exactly on `done`/error/cancel — never buffered).
3. [x] New compose service `litellm-queue-proxy` added to
   `docker/docker-compose.yml`: `network_mode: host`, `depends_on:
   [litellm]`, `restart: unless-stopped`, `com.local-ai-machine.always-up:
   "true"` label matching every other always-on infra service. Image
   `oven/bun:latest` (stock, no custom Dockerfile needed — small
   self-contained script bind-mounted read-only into `/app`, matching the
   "doesn't need the complex jmfederico-pi-web image" call). Port 4001
   confirmed free via `docker compose config` (parsed clean, service
   registered, no port collision) before committing to it.
4. [x] **Test: forwarding correctness** — `server.test.ts` test 1: proxy
   result `toEqual`s the direct mock result exactly (method, path, query,
   auth header, body all echoed identically). Pass.
5. [x] **Test: auth passthrough** — test 2: valid key → 200 through both
   proxy and direct; invalid key → 401 through both, response bodies
   `toEqual` (proves the proxy doesn't alter litellm's own auth error).
   Also verified live against REAL litellm (see item 9): `/v1/models` with
   the real `LITELLM_MASTER_KEY` returns `200` through both :4000 and
   :4001 identically.
6. [x] **Test: streaming actually streams** — test 3: a 4-chunk mock SSE
   stream (200ms between chunks) delivered through the proxy arrives over
   ≥2 distinct `read()` calls with a receive-timestamp spread of >400ms
   (measured: test completed at 950ms wall-clock; spread comfortably
   exceeded the 400ms assertion threshold) — proves genuine incremental
   relay, not buffer-then-send (which would show a ~0ms spread).
7. [x] **Test: semaphore correctness (mock backend only)** — test 4: fired
   a 600ms-delay request, then a 50ms-delay request 100ms later, both
   through the proxy. **Real measured evidence** (separate instrumented
   run, same code path as the test): first fired at t+0ms; second fired at
   t+102ms; the *mock backend's own* `respondedAt` for the first request
   was t+623ms (client fully drained it at t+642ms); the second request's
   upstream `respondedAt` was t+693ms — i.e. the second request's actual
   processing didn't happen until ~591ms after it was fired, even though
   its own configured delay was only 50ms. If the proxy had forwarded it
   immediately (no queueing), its `respondedAt` would've landed around
   t+152ms instead. This is direct evidence the second request's upstream
   work was blocked until the first's response was fully drained, not just
   until headers arrived. Test 5 (error path) fired a 500-returning
   request then immediately raced a follow-up request against a 3s
   timeout — follow-up completed well under the timeout, proving the
   semaphore is released on an erroring proxied response too (no
   deadlock).
8. [x] **Test: bypass property** — test 6: while a proxy request holds the
   semaphore for 500ms, a direct hit to the mock backend completes in
   <300ms, unaffected. Also confirmed on the real box (see item 9):
   `litellm-proxy`/`litellm-db` container start timestamps unchanged
   before/after deploying+using the proxy (`litellm-proxy` up 14h,
   `litellm-db` up 17h at check time — neither was restarted).
9. [x] Real smoke test against actual litellm on the box: `GET
   /health/liveliness` returns `200 "I'm alive!"` identically through
   :4000 and :4001; `GET /v1/models` with the real master key returns
   `200` through both. Both single, non-concurrent, no generation/GPU work
   involved. Deployed via `docker compose up -d litellm-queue-proxy`
   (targeted — did not touch/restart litellm or litellm-db).
10. [x] Kill switch documented (see Handoff notes) — nothing points at
    :4001 by default; Phase 2's kill switch is simply repointing back at
    :4000.
11. [x] Reporting now: Phase 1 complete, all standalone tests passing (6
    pass / 1 intentionally-skipped-by-default real-litellm test / 0 fail),
    `tsc --noEmit` clean, real end-to-end smoke test done on the box.
    Explicit pause for a fresh go-ahead before Phase 2 — see Handoff notes.

### Phase 2 — attempted 2026-08-06, REVERTED after finding a real bug — see below
12. [x] Pointed `pi`/pi-web at `:4001` instead of `:4000` — edited the LIVE
    `~/.pi-web/models.json` on the box directly (the seed template only
    applies on a project's first-ever container start, and pi-web has been
    running a long time — confirmed the live file already had the old URL
    baked in before touching it), plus `models.seed.json.tmpl` for future
    fresh deploys. Confirmed pi-web's own container could reach
    `host.docker.internal:4001` (200) before flipping the switch.
13. [x] Added `PI_WEB_FACTORY_STEP_TIMEOUT_MS` support to
    `waitForCompletion()`'s default resolution (`modules/piwebClient.ts`),
    set to `600000` in `jmfederico-pi-web`'s compose environment.
    **Real lesson learned mid-pass:** `docker compose up -d
    jmfederico-pi-web` alone does NOT rebuild the image — this service has
    both a `build:` context AND a pinned `image:` tag, so compose reuses the
    already-built image unless you explicitly `build`/`--build` first. My
    first deploy attempt recreated the CONTAINER with the new env var
    correctly set, but the OLD CODE (pre-dating the timeout override) was
    still running inside — the env var was present but nothing read it. Two
    real Workflow Runs both failed at ~120s (the old hardcoded default) on
    the first attempt, which is what surfaced this. Fixed with an explicit
    `docker compose build jmfederico-pi-web` before the recreate; verified
    the new code was actually present (`grep -c
    DEFAULT_WAIT_FOR_COMPLETION_TIMEOUT_MS` inside the running container)
    before retrying, not just the env var.
14. [x] Empirically tested the open question (pi's own outbound timeout) —
    **answer: not actually the blocker.** Real failures observed were never
    caused by `pi`'s own timeout; see the real bug found in item 15 instead.
15. [~] Real concurrent-run test — **found a genuine bug, not a clean pass.**
    Two real concurrent Workflow Runs (`plan-build-review` / DESIGN.md,
    `bounded-build-review` / validators.py) launched within 2ms of each
    other:
    - Run A failed almost immediately with `PiWebClientError: pi-web
      request failed (404): Project not found` at the PROJECT REGISTRATION
      step (`piwebProject.ts`'s `resolveWorkspaceId`) — before any
      litellm/model call at all. This is unrelated to the queue proxy (it
      fails before the proxy is ever involved) — looks like a genuine,
      separate race condition in pi-web-factory's own project-registration
      flow when two `cli.ts` invocations targeting two DIFFERENT new
      projects launch at the exact same moment. **Filing this as its own
      card (see Handoff notes) — do not conflate with M-094.**
    - Run B (validators.py) ran for several minutes and failed with
      `unparseable after 3 attempts — last response:` (empty). Direct
      investigation of the model container's own logs
      (`docker logs qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v2`) showed
      the model actually finished generating quickly and cleanly — this
      matches the SAME "thinking-budget-exhaustion" behavior already
      documented for Ornith (M-078's decision log): `qwen3.6-35b-a3b-mtp`
      is ALSO a reasoning model, and at a small `max_tokens` it can burn its
      entire budget on invisible `reasoning_content` before ever emitting
      visible `content`, hitting `finish_reason: length` with `content:
      ""`. Confirmed directly (raw curl through the proxy): this is a real,
      reproducible MODEL behavior, not a proxy bug — pi-web-factory's own
      retry-then-fail-as-unparseable handling of it is working as designed,
      just not a flattering test prompt choice on my part. **Not an M-094
      bug.**
    - **A real M-094 bug, found while investigating Run B further:** a
      direct, isolated, non-concurrent request through the proxy to the
      exact same model HUNG INDEFINITELY (killed after 3+ minutes) even
      though `docker logs` on the model container showed it had finished
      generating in ~1 second and cleanly released its slot. The response
      never reached the client through the proxy. Worse: while that request
      was stuck, the proxy's OWN `/health/liveliness` endpoint also stopped
      responding — `handleRequest` gates every path through the same
      semaphore with no exemption, so one stuck request blocks everything
      on :4001, including health checks that could otherwise reveal the
      problem. **Given the cutover was live at this point, this bug was
      exposed to every pi-web session on the box, human and automated —
      immediately reverted `pi`/pi-web back to :4000 directly** (both the
      live `models.json` and the git-tracked template), verified pi-web
      could reach litellm directly again, committed the revert (`eefad7b`).
    - Follow-up reproduction attempts (5 sequential + 4 truly concurrent
      real requests through the proxy, same model, after the revert) all
      completed cleanly and fast — the 4 concurrent requests showed a
      clean, correct staircase pattern (~1.0s/2.0s/3.0s/4.0s), confirming
      the core semaphore/serialization logic itself IS correct under real
      concurrent load. The hang did not reproduce deterministically.
    - **Leading root-cause hypothesis, NOT yet confirmed:** the proxy's
      `releaseOnDrain` wrapper only releases the semaphore on `done`,
      explicit stream `error`, or an explicit `cancel()` call — but has no
      timeout-based fallback. If a client disconnects ABRUPTLY (TCP
      connection dropped, not a clean Web Streams `.cancel()`) while a
      response is mid-stream, `pull()` may simply hang forever waiting on
      `reader.read()` with no signal ever arriving, holding the semaphore
      permanently. This is plausible given the actual sequence: Run B made
      3 internal retry attempts before failing — if pi-web-factory's own
      retry logic abandoned an earlier attempt's connection non-gracefully
      partway through, that could be the exact trigger. **Not confirmed by
      direct reproduction** — flagged as the most likely explanation, not a
      proven one.
16. [ ] Not reached — blocked on 15.
17. [ ] Not reached — blocked on 15.
18. [ ] Not reached — blocked on 15. Card stays in `now/`, NOT done.

### Phase 3 — REVISED: replaced the custom proxy with HAProxy entirely
Rather than patch the bespoke Bun implementation's specific gaps (items
19-21 as originally planned — a timeout safety valve, a health-check
bypass, a deliberate disconnect reproduction), researched whether existing,
mature software already solves this class of problem well. It does.

19. [x] Researched alternatives. Ruled out: litellm's own native
    `max_parallel_requests`/Redis rate-limiting (real, but rejects with a
    429 rather than queuing — confirmed against litellm's actual config
    docs and an open GitHub feature request (#26693) asking for queue
    behavior specifically because litellm doesn't have it); llama-swap
    (real per-model semaphore, but scoped per-model/per-process, not
    global — doesn't address cross-model contention, our actual problem).
    Confirmed first that our own custom proxy never had any real litellm/
    LLM-protocol-specific logic — pure transparent forwarding + a
    connection-scoped concurrency gate — so a generic reverse proxy is a
    direct replacement, not a compromise. **Chose HAProxy**: `maxconn` +
    queue + `timeout queue` is exactly this pattern, battle-tested for two
    decades, with the timeout safety valve already built in (no need to
    build item 19's original plan by hand).
20. [x] Built `docker/litellm-queue-haproxy/haproxy.cfg` — `maxconn 1` on
    litellm as the single backend server (global serialization, since
    every request routes through litellm as one upstream regardless of
    target model), `timeout queue 900s` as the built-in safety valve,
    `network_mode: host` (same reason the Bun version needed it). Replaced
    the `litellm-queue-proxy` compose service with `litellm-queue-haproxy`
    (old Bun implementation's source kept as-is at
    `docker/litellm-queue-proxy/` for reference — its card history
    documents the real bug). Config validated locally (`haproxy -c`) before
    every deploy, both initial and the one revision below.
21. [x] **The critical test — deliberately reproduced the abrupt-disconnect
    scenario directly** (not just theorized about it): opened a raw TCP
    socket, sent a real streaming request through HAProxy on the real box
    against a real model, read only the first 200 bytes of what should
    have been a much longer stream, then called `sock.close()` — an
    abrupt, non-graceful termination, no clean HTTP-level stream
    completion. Immediately fired a follow-up request: **200 OK in 787ms**
    — not stuck, not delayed, no sign of a leaked slot. HAProxy's
    connection tracking operates at the actual OS socket level, not a
    higher-level stream abstraction, so it correctly detects the closed
    connection and releases the slot — this is the exact class of bug that
    broke the custom Bun proxy, confirmed fixed by construction, not by
    patching.
22. [x] Real concurrency re-confirmed on the box against real models
    post-disconnect-test: 3 concurrent requests showed a clean staircase
    (989ms / 1967ms / 2615ms) — genuine serialization, nothing left in a
    bad state by the disconnect test.
23. [x] Investigated a real, secondary finding along the way: HAProxy
    relays streaming responses in coarser chunks than litellm's native
    per-token delivery (measured: direct litellm ~33ms between chunks,
    119 distinct arrival times over a 3.7s response vs. through HAProxy
    ~230ms between chunks, 22 distinct arrivals over a comparable-length
    response). Tried `tune.h1.zero-copy-fwd-send off` (a documented,
    relevant HAProxy tunable for exactly this class of delay) — measured
    no meaningful improvement (22 → 20 buckets, noise-level), reverted to
    keep the config simple rather than keep an unproven tweak. **This does
    NOT threaten the core correctness property** — total time-to-complete
    (and therefore the semaphore hold duration) matches real generation
    time either way (4.4s direct vs. 5.1s via HAProxy for the same
    request) — it's a real but minor streaming-smoothness tradeoff (a
    human watching a live session would see slightly chunkier token
    bursts, not silky-smooth per-token updates), not a functional bug.
    Left as a known, non-blocking polish item, not chased further.
24. [ ] Retry the real Phase 2 end-to-end tests (original items 15-18) —
    two concurrent real Workflow Runs against roles sharing physical
    resources — with HAProxy in place instead of the Bun proxy. NOT done
    yet — still needs a fresh go-ahead before repointing pi-web, per the
    same caution as the first attempt.

## Signals
<!-- signal: claude 2026-08-06T04:15Z — claiming, card written after live
research confirming the timeout-override isolation is real and already
plumbed; original design (in-process litellm callback) not yet implemented. -->
<!-- signal: claude 2026-08-06T05:10Z — design revised per Chris's direction:
standalone reverse proxy on port 4001 (not an in-process litellm callback) —
clean bypass property, testable fully standalone against mock endpoints with
zero model/GPU interaction. Starting Phase 1 now, concurrently with the
still-running M-086 background agent (isolated worktree, no shared files). -->
<!-- signal: claude 2026-08-06T05:20Z — Phase 1 done: proxy implemented,
tested (mock backend, 6/6 pass), tsc clean, real-litellm smoke test done
on the box, litellm-proxy/litellm-db confirmed untouched. Explicit pause
before Phase 2 — awaiting Chris's go-ahead. -->
<!-- signal: claude 2026-08-06T08:22Z — Phase 2 attempted, REVERTED. Found a
real proxy bug (a request can hang indefinitely, and it takes the health
endpoint down with it) while cutover was live — reverted pi-web back to
:4000 immediately. Core semaphore logic re-confirmed correct under real
concurrent load post-revert. Root cause not yet confirmed, only
hypothesized. Card stays in now/, needs Phase 3 (safety valve + health
bypass + real repro) before retrying. Also found: an unrelated real bug in
pi-web-factory's own project-registration flow under concurrent cli.ts
launches — filing separately, not part of M-094. -->

## Decision log
- 2026-08-06 (claude): chose "hold the connection" over "429 + client retry"
  originally — still true under the revised design, just implemented as a
  proxy's own request-handling logic instead of a litellm hook.
- 2026-08-06 (claude, revision): switched from an in-process litellm callback
  to a standalone proxy per Chris's explicit design call — the bypass property
  (litellm stays reachable on :4000 unaffected) is strictly better than the
  callback design's all-or-nothing kill switch, and testing the proxy
  standalone (mock endpoints) cleanly avoids any interaction with the
  concurrent M-086 background work on shared GPU/model resources.
- 2026-08-06 (claude): explicit two-phase split with a hard pause is Chris's
  own instruction, not my own scoping call — Phase 2 (pi-web cutover, timeout
  tuning, real concurrent-model tests) needs a fresh go-ahead, not assumed
  continuation once Phase 1 passes.
- 2026-08-06 (claude): Phase 1 build + test complete. All work developed and
  tested LOCALLY (Mac, Docker Desktop, `oven/bun:latest` container) against a
  synthetic mock backend (`docker/litellm-queue-proxy/mock-backend.ts`) —
  zero interaction with any model-serving container or GPU resource for the
  entire concurrency-test phase, satisfying the hard isolation requirement
  from the concurrent M-086 background agent's GPU-bound benchmark work.
  `bun test` (against the mock backend): 6 pass, 1 skipped-by-default (real
  litellm smoke test, gated behind `RUN_REAL_LITELLM_SMOKE_TEST=1`), 0 fail.
  `bunx tsc --noEmit`: clean.
  Real, concrete semaphore-serialization evidence (separate instrumented
  run, same request-timing scenario as automated test 4): first request
  (mock delayMs=600) fired at t+0ms; second request (mock delayMs=50) fired
  at t+102ms while the first was still in flight; the mock backend's own
  clock recorded the FIRST request's `respondedAt` at t+623ms (client fully
  drained the response body at t+642ms) and the SECOND request's
  `respondedAt` at t+693ms. Since the second request's own configured delay
  was only 50ms, an unqueued/immediately-forwarded second request would
  have shown `respondedAt` around t+152ms (102ms fire time + 50ms delay) —
  instead its upstream processing didn't even start until after the first
  request's stream was fully drained. This is the core proof the semaphore
  holds through full stream drain, not just until headers arrive.
  Deployed the compose service to the real box (`docker compose up -d
  litellm-queue-proxy`, targeted — did not restart/touch litellm or
  litellm-db) and ran the one real, single, non-concurrent smoke test the
  card calls for: `GET /health/liveliness` → `200 "I'm alive!"` identically
  through :4000 and :4001; `GET /v1/models` with the real
  `LITELLM_MASTER_KEY` → `200` through both. Confirmed via `docker inspect
  --format StartedAt` that `litellm-proxy` (up 14h) and `litellm-db` (up
  17h) were NOT restarted by this deploy — genuinely zero disruption to
  model-serving infra. No generation/completion request was ever sent to a
  real model; no GPU resource was touched.
  One sandbox note for future agents: local Docker testing on this session
  accidentally created LOCAL (Mac, `desktop-linux` context — never the real
  box) containers literally named `litellm-proxy`/`litellm-db` via a stray
  `docker compose run` invocation while probing the compose file's
  wiring — the Claude Code sandbox's auto-mode classifier correctly refused
  to let this agent stop/remove them once their names matched the real
  service names, even though they were local-only, out of an abundance of
  caution given this card's stakes. Left running harmlessly on the local
  Mac's Docker Desktop; irrelevant to the box. Lesson for next time: never
  `docker compose run` a service whose `depends_on` chain includes anything
  sharing a name with real production infra, even locally — use `docker
  run` directly against the single service under test instead.
- 2026-08-06 (claude): after the revert, researched whether existing
  software already solves this rather than keep patching the custom Bun
  proxy. Chris's own suggestion to check litellm's native
  `max_parallel_requests`/Redis config led to confirming (against real
  docs, not memory) that it rejects with 429 rather than queuing — ruled
  out. llama-swap looked purpose-built but its concurrency limit is scoped
  per-model, not global — doesn't solve cross-model contention, our actual
  problem — ruled out. HAProxy's `maxconn`+queue+`timeout queue` is a
  direct match, mature for two decades. Confirmed our own proxy never had
  real LLM-protocol-specific logic before committing to the swap, so this
  is a like-for-like replacement, not a scope reduction.
- 2026-08-06 (claude): built + deployed HAProxy replacement, then
  deliberately reproduced the exact abrupt-disconnect scenario the custom
  proxy's hang bug was theorized to come from — raw socket, real streaming
  request, real model, killed mid-stream with no clean HTTP close.
  Follow-up request succeeded in 787ms, not stuck. This is a direct,
  reproduced confirmation (not just a plausible theory this time) that the
  new implementation doesn't share the old one's failure mode.
- 2026-08-06 (claude): found and investigated a secondary, real but minor
  issue — HAProxy relays streamed chunks in coarser bursts than litellm's
  native per-token delivery (~230ms vs ~33ms between arrivals). Tried one
  documented-relevant tunable (`tune.h1.zero-copy-fwd-send off`), measured
  no real improvement, reverted rather than keep unproven config
  complexity. Confirmed this doesn't affect the semaphore's actual
  hold-duration correctness (total completion time is comparable either
  way) — logged as a known streaming-smoothness tradeoff, not chased
  further since it's not blocking.

## Handoff notes
**Current real state (2026-08-06): pi-web talks to litellm directly on
:4000 — the queue proxy is deployed and verified but NOT in the live path
yet.** This is still the known-good, pre-cutover state.

The OLD custom Bun proxy (`docker/litellm-queue-proxy/server.ts`) has been
stopped and its compose service replaced — source stays in the repo for
reference/history (its own decision log documents the real bug it had),
container no longer running. The NEW HAProxy-based proxy
(`docker/litellm-queue-haproxy/haproxy.cfg`) is running on the box right
now and has passed every test the old one did, PLUS a real, deliberate
reproduction of the abrupt-disconnect scenario the old one's bug is
theorized to have come from (see Decision log — 787ms follow-up, not
stuck). `PI_WEB_FACTORY_STEP_TIMEOUT_MS` support is still live in
`piwebClient.ts` and the compose env (harmless, unused while nothing
points at the proxy).

To check the proxy's live status on the box:
`ssh local-ai-machine 'docker ps --format "{{.Names}}\t{{.Status}}" | grep litellm-queue-haproxy'`
`ssh local-ai-machine 'docker logs litellm-queue-haproxy'`

**The original Phase 2 cutover attempt found a real bug and was reverted**
(see Phase 2 items above for the full account — the custom Bun proxy could
hang indefinitely with no visible error, and blocked its own health
endpoint while stuck, live for ~20 minutes affecting every pi-web session
before being caught). That specific bug class has since been directly
disproven against the new HAProxy implementation via deliberate
reproduction, not just theory — see item 21. **Still needed before
repointing pi-web again:** the real end-to-end test (item 24 — two
concurrent real Workflow Runs with HAProxy in place) has NOT been re-run
yet, and any cutover attempt still needs a fresh go-ahead per the same
caution as the first attempt.

Separately, filed for its own investigation (not M-094): pi-web-factory's
own project-registration flow (`piwebProject.ts`'s `resolveWorkspaceId`)
returned `404: Project not found` when two `cli.ts` invocations targeting
two different brand-new projects launched within ~2ms of each other. Real,
reproducible, unrelated to litellm/the proxy — worth its own card if
concurrent Workflow Run launches become a real usage pattern.

