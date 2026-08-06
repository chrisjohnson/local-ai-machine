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
1. [ ] Implement the proxy — proposed location `docker/litellm-queue-proxy/
   server.ts`, a small `Bun.serve()` script (matches this repo's existing
   convention for small custom Bun services, e.g. the visualizer). Module-level
   semaphore (start at count 1 — simplest correct baseline; leave a documented,
   easy path to raise it or scope it per-model later, don't build that
   flexibility preemptively). Acquire before forwarding, release only after
   the (possibly streaming) response is fully relayed to the client — success
   AND failure paths both release (no deadlock on a proxied error).
2. [ ] Transparent forwarding: same method, path, query, headers (Authorization
   untouched), body; stream the response back (do not buffer-then-return —
   verify this explicitly, see test below).
3. [ ] New compose service `litellm-queue-proxy`: `network_mode: host` (see
   Context — required to reach litellm at `127.0.0.1:4000`), depends_on
   litellm, restart: unless-stopped, same `com.local-ai-machine.always-up`
   labeling convention as other always-on infra. Port 4001 confirmed free.
4. [ ] **Test: forwarding correctness.** A plain non-streaming request through
   :4001 returns byte-identical results to the same request against :4000
   directly (modulo latency).
5. [ ] **Test: auth passthrough.** A request with a valid key succeeds through
   the proxy; an invalid/missing key gets the SAME error litellm itself would
   give directly — confirms the proxy adds no auth logic of its own.
6. [ ] **Test: streaming actually streams.** A `stream: true` chat completion
   through the proxy arrives as incremental chunks over time (verify via
   real timestamps on received chunks, not just that the final concatenated
   result is correct) — this is the detail most likely to be silently broken
   by a naive proxy implementation.
7. [ ] **Test: semaphore correctness, using MOCK slow endpoints (not real
   models)** — fire two overlapping slow requests through the proxy against a
   synthetic slow backend standing in for litellm, assert the second's
   processing genuinely starts only after the first's response is fully
   drained, not just after its headers arrive. Also test that a proxied
   request which itself errors still releases the semaphore (no deadlock).
8. [ ] **Test: bypass property.** Confirm hitting litellm directly on :4000
   still works completely normally and is entirely unaffected by whatever
   the proxy on :4001 is doing — the whole point of this design.
9. [ ] One lightweight, non-concurrent real smoke test against litellm through
   the proxy (a single quick request, not a concurrency test) to confirm
   real end-to-end wiring works, without generating any real GPU contention
   risk for the concurrent M-086 benchmark work also running on this box.
10. [ ] Document the kill switch (already inherent to the design, but write it
    down): nothing points at :4001 by default in Phase 1, so there's nothing
    to "switch off" yet — once Phase 2 happens, the kill switch is simply
    repointing back at :4000.
11. [ ] Report back: Phase 1 complete, all standalone tests passing, explicit
    pause for a fresh go-ahead before Phase 2.

### Phase 2 — gated on explicit go-ahead, NOT part of this pass
12. [ ] Point `pi`/pi-web at `:4001` instead of `:4000`.
13. [ ] Add `PI_WEB_FACTORY_STEP_TIMEOUT_MS` env var support to
    `waitForCompletion()`'s default resolution and set a real, higher value.
14. [ ] Empirically test the open question: does `pi`'s own outbound timeout
    to the proxy cut off a genuinely queued request before pi-web-factory's
    own (now-longer) timeout would? Test from inside a real pi-web session,
    not just curl.
15. [ ] Real end-to-end test: two concurrent Workflow Runs against roles that
    share physical resources, confirmed genuinely serialized (no overlapping
    in-flight windows) via litellm's own logs, no regression, no OOM.
16. [ ] Confirm human pi-web sessions behave correctly under the same
    conditions.
17. [ ] `tsc --noEmit` clean, full `bun test` green.
18. [ ] Update `docs/pi-web-factory.html`'s "Concurrency" section with the
    real, tested design, replacing the "planned, not yet built" framing.

## Signals
<!-- signal: claude 2026-08-06T04:15Z — claiming, card written after live
research confirming the timeout-override isolation is real and already
plumbed; original design (in-process litellm callback) not yet implemented. -->
<!-- signal: claude 2026-08-06T05:10Z — design revised per Chris's direction:
standalone reverse proxy on port 4001 (not an in-process litellm callback) —
clean bypass property, testable fully standalone against mock endpoints with
zero model/GPU interaction. Starting Phase 1 now, concurrently with the
still-running M-086 background agent (isolated worktree, no shared files). -->

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

## Handoff notes
Phase 1 in progress. Phase 2 is explicitly gated — do not proceed to it
without Chris confirming Phase 1's results first.
