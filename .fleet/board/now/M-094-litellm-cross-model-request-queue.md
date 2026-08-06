---
id: M-094
title: Cross-model request serialization at the litellm layer (real-time queue, not backpressure/retry)
initiative_id: null
claimed_by: claude
claimed_at: '2026-08-06T04:15:00Z'
blocks: null
blocked_by: null
status: null
related_cards: [M-037, M-078, M-089]
---

# M-094 — Cross-model request serialization at the litellm layer

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
once" problem (that's a separate, already-documented failure mode with no
automated fix either, but out of scope here).

**Design, decided in conversation 2026-08-06 (see that conversation for the
full reasoning):**
- **Option chosen: hold the connection open, don't reject-and-retry.** A queued
  request just takes longer — no error, no client-side retry logic needed. This
  is the SAME behavior already happening for free at the llama.cpp `-np 1`
  layer today (a second request to a single-slot model server queues silently,
  no special client handling) — this card extends the identical pattern up to
  the litellm-proxy layer so it also covers requests to *different* models that
  happen to share the same physical GPU/memory bus.
- **Where it lives: a custom litellm callback**, not a change to pi-web-factory
  or to `pi` itself. litellm already supports this exact mechanism
  (`async_pre_call_hook`/`async_post_call_success_hook`/
  `async_post_call_failure_hook`) and this box already uses it —
  `docker/litellm/config.yaml`'s `litellm_settings.callbacks` already loads
  `jsonl_logger.JsonlFileLogger`, a working example of the same pattern. A new
  callback (proposed: `docker/litellm/queue_semaphore.py`, same directory/mount
  convention as the existing one) implements a module-level `asyncio.Semaphore`
  — pre-call hook does `await semaphore.acquire()`, post-call hooks (success
  AND failure) release it in a way that can't deadlock on an errored request.
- **This only works because litellm-proxy runs as a single worker process** —
  confirmed by reading the actual compose command (`--config /app/config.yaml
  --port 4000`, no `--num_workers` set — litellm's single-worker default). An
  in-process `asyncio.Semaphore` does NOT coordinate across separate worker
  processes; if litellm-proxy is ever scaled to multiple workers, this needs a
  cross-process primitive instead (litellm has Redis-backed distributed
  rate-limiting for exactly that case) — noted here so a future reader doesn't
  assume this design survives a worker-count change silently.
- **Every request through litellm gets the protection, including human-driven
  pi-web sessions** — this is deliberate, not a gap. A human's own browser
  session hitting a semaphored model just experiences a slightly slower
  response, exactly the same "invisible, no special handling needed" property
  that makes option 1 work at all. What must NOT change for humans is
  pi-web-factory's own automated wait-loop *timeout* (below) — that's a
  pi-web-factory-specific patience setting, unrelated to and not shared with
  how a human's browser session waits.

## Research: is a Workflow-step-only timeout override even possible?
**Yes — confirmed via direct code reading, and the isolation Chris asked for
already exists by construction, no new plumbing needed for the isolation
itself:**
- `modules/piwebClient.ts`'s `waitForCompletion()` is pi-web-factory's OWN
  wait-loop, built specifically because (per that function's own doc comment)
  "there is no blocking/long-poll HTTP variant anywhere in pi-web." It already
  takes an optional `timeoutMs` (default `120_000`), already plumbed as
  `waitOptions` through `modules/run.ts`'s `runAgentPhase()`, which is what
  both `modules/workflow.ts` (the generic interpreter) and
  `chains/planBuildTest.ts` (the hand-written chain) call. **Today, neither
  call site ever passes `waitOptions`** — every Workflow Step across the whole
  project currently uses the same hardcoded 120s default; the override
  plumbing exists end-to-end but has never been exercised.
- This code path is used ONLY by pi-web-factory driving pi-web programmatically
  (the module doc comment: "REST/WebSocket API over HTTP, as a sibling process
  in the same container"). A human interacting with pi-web through its own
  browser UI never touches `piwebClient.ts` at all — that's pi-web's own
  Next.js frontend, entirely separate code, with its own (unbounded, human-
  patience) waiting behavior. So bumping `waitForCompletion`'s default timeout
  cannot, by construction, change anything about how a human waits in the
  browser — there's no shared code path to accidentally affect.
- Confirmed no OTHER hardcoded timeout sits between `cli.ts`/the chains and
  `waitForCompletion` that could cut a queued run off earlier (grepped
  `cli.ts`, `modules/workflow.ts`, `chains/planBuildTest.ts` for
  `timeout`/`Timeout` — nothing else found).
- **One real open question, NOT resolved by reading code — needs an empirical
  test (see Plan):** `pi` (the actual agent CLI running inside each pi-web
  session) makes its OWN outbound HTTP call to litellm when it wants a
  completion. That call has ITS OWN timeout, set by `pi`'s/pi-web's own
  config — a completely different, not-yet-investigated layer from
  `waitForCompletion`. If a semaphore-queued request sits long enough to hit
  THAT timeout first, the agent's own turn fails with an error *before*
  pi-web-factory's outer `waitForCompletion` timeout would ever matter, no
  matter how generous `waitForCompletion`'s own timeout is set. This needs to
  be tested for real, not assumed away.

## Plan
1. [ ] Implement `docker/litellm/queue_semaphore.py`: a `CustomLogger` subclass
   (matching `jsonl_logger.py`'s existing pattern) with a module-level
   `asyncio.Semaphore(1)` (start fully serial — see Decision log for why not a
   higher initial count), acquired in `async_pre_call_hook`, released in BOTH
   `async_post_call_success_hook` and `async_post_call_failure_hook` (a
   `try`/`finally`-equivalent — a hook that only releases on success would
   deadlock the semaphore forever after the first failed request). Register it
   in `docker/litellm/config.yaml`'s `callbacks` list alongside the existing
   `jsonl_logger.JsonlFileLogger`.
2. [ ] Decide + implement scope: which deployments actually need to serialize
   against each other? Starting default: ALL of them (simplest correct
   baseline — a tiny model contending with a huge one is rare enough not to
   special-case yet). Leave a clear, documented way to exempt specific small
   models later if this proves overly conservative in practice — don't build
   that exemption mechanism preemptively, just don't make it hard to add.
3. [ ] Add `PI_WEB_FACTORY_STEP_TIMEOUT_MS` env var support to
   `modules/piwebClient.ts`'s `waitForCompletion()` default resolution
   (`opts.timeoutMs ?? Number(process.env["PI_WEB_FACTORY_STEP_TIMEOUT_MS"]) ||
   120_000`), matching this codebase's existing `PI_WEB_FACTORY_*` env-var
   convention (`cli.ts`'s `PI_WEB_FACTORY_DB_PATH`/`PI_WEB_FACTORY_CONFIG`,
   `piwebClient.ts`'s own `PI_WEB_FACTORY_BASE_URL`). Set a real, higher
   default in the deployed environment (compose env or the container's own
   entrypoint) — 120s is almost certainly too short once a step can genuinely
   queue behind another model's full generation.
4. [ ] **Testing — semaphore correctness, in isolation:**
   - A test that fires two overlapping slow requests through litellm (or a
     minimal mock server standing in for a backend, if hitting a real model is
     too slow/expensive for a unit test) and asserts they do NOT overlap in
     processing time — the second's start time must be >= the first's end
     time.
   - A test confirming a FAILED request still releases the semaphore (fire a
     request that errors, then confirm a second request isn't stuck waiting
     forever).
5. [ ] **Testing — the real open question (pi's own litellm-call timeout):**
   deliberately hold a request in the queue for several minutes (e.g., a slow
   dummy first request, or literally just a low semaphore count plus two real
   slow model calls) and confirm, from inside an ACTUAL pi-web session (not
   just a raw curl), whether the agent's own turn fails with a timeout error
   before the queued request ever gets its turn. If it does, this card isn't
   done — it needs deeper investigation into `pi`'s own client timeout config
   before "queueing" is a viable end-to-end design, not just a working litellm
   callback.
6. [ ] **Testing — end-to-end, two real concurrent Workflow Runs:** launch two
   real Workflow Runs (via `cli.ts`, same pattern used for this session's own
   verification rounds) against two different roles that share physical
   resources, confirm via the trace db / visualizer AND litellm's own
   `docker/litellm/logs/litellm.jsonl` that requests were genuinely serialized
   (no overlapping in-flight windows), both runs complete successfully, no
   OOM, no unexpected errors, and total wall-clock time roughly matches serial
   expectations (not faster — that would mean the semaphore isn't actually
   engaging).
7. [ ] **Testing — confirm human pi-web sessions are unaffected in the way
   that matters:** a human-driven session hitting a semaphored model while a
   Workflow Run holds the lock should just wait (same as any other queued
   request) — verify this doesn't error or behave differently for
   human-originated traffic, since the semaphore has no way to distinguish
   traffic source and isn't supposed to.
8. [ ] Document a kill switch: removing/commenting the callback entry from
   `docker/litellm/config.yaml`'s `callbacks` list and restarting the
   `litellm` compose service fully disables this — write this down clearly in
   the Handoff notes so a future incident doesn't require re-deriving it.
9. [ ] `tsc --noEmit` clean (pi-web-factory side), full `bun test` still
   green, before calling this done.
10. [ ] Update `docs/pi-web-factory.html` (renamed from the dated walkthrough,
    see M-093/this session's doc-rename work) with the real, tested design —
    not the speculative version already added there ahead of implementation.

## Signals
<!-- signal: claude 2026-08-06T04:15Z — claiming, card written after live
research confirming the timeout-override isolation is real and already
plumbed; design decided in conversation (option 1: hold-connection, litellm
custom-callback layer, not pi-web-factory or pi itself); not yet implemented. -->

## Decision log
- 2026-08-06 (claude): chose "hold the connection" over "429 + client retry"
  because it needs zero client-side cooperation and matches the pattern
  already proven at the llama.cpp `-np 1` layer — `pi`/pi-web-factory/any
  OpenAI-SDK client already just waits for slow responses today, so extending
  the same idea to litellm doesn't require touching any client code, only the
  proxy.
- 2026-08-06 (claude): starting semaphore count at 1 (fully serial across ALL
  deployments) rather than something smarter (e.g., allow N=2 for "small"
  models) — simplest correct baseline for a first implementation; scope
  refinement is explicitly deferred, not designed away.
- 2026-08-06 (claude): flagged, not resolved, that `pi`'s own outbound
  litellm-call timeout is a genuinely separate, unresearched layer from
  pi-web-factory's `waitForCompletion` — reading pi-web-factory's own code
  cannot answer this; it needs a real empirical test (Plan item 5) before this
  design can be trusted end-to-end.

## Handoff notes
Nothing implemented yet — this card is fully scoped/designed but zero code
written. Recommended implementation order: semaphore callback first (item 1-2,
testable in isolation without touching pi-web-factory at all), then the
timeout env var (item 3, small/isolated), then the two real-world tests (items
5-7) — item 5 in particular could invalidate the whole approach if `pi`'s own
timeout turns out to be short, so don't build out the full end-to-end test
harness (item 6) before confirming item 5 doesn't kill the design outright.
