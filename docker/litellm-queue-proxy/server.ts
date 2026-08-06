#!/usr/bin/env bun
/**
 * litellm-queue-proxy/server.ts (M-094 Phase 1): standalone HTTP reverse
 * proxy in front of litellm-proxy (port 4000, `network_mode: host`).
 *
 * NOT a litellm callback — a fully separate `Bun.serve()` process. Every
 * request received here is forwarded transparently to litellm (same
 * method, path+query, headers including Authorization untouched, body),
 * gated by a module-level semaphore (count 1) so only one request is
 * actively being forwarded/streamed at a time. litellm itself stays
 * reachable directly on its own port at all times, completely unaffected —
 * that's the deliberate bypass/kill-switch property (see M-094's card):
 * if this proxy ever misbehaves, any caller can just point at litellm's
 * own port instead and skip the queue entirely, no config edit or restart
 * needed.
 *
 * ── Why cross-model serialization matters here ──────────────────────────
 * Strix Halo is memory-bandwidth-bound, not compute-bound (M-055/M-086
 * research). Two concurrent decodes against two different resident models
 * genuinely compete for the same ~120-135GB/s shared LPDDR5X, and their
 * combined KV-cache footprint on top of already-resident model weights can
 * OOM (same failure class as M-037/M-078, just triggered by concurrent
 * *requests* instead of concurrent container starts). This proxy holds the
 * semaphore for the FULL duration of a response — including every
 * streamed SSE chunk of a `stream: true` chat completion — releasing only
 * once the response body is fully drained/closed, not when upstream
 * headers first arrive. Releasing early would let a second request start
 * real decode work while the first is still actively streaming tokens,
 * defeating the entire point.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────
 * Zero auth logic of its own. The Authorization header (and every other
 * header) is forwarded byte-for-byte; litellm's own master-key/virtual-key
 * check remains the only real gate, exactly as if the caller hit :4000
 * directly.
 *
 * ── Configuration ────────────────────────────────────────────────────────
 * `LITELLM_QUEUE_PROXY_PORT` — port this proxy listens on (default 4001).
 * `LITELLM_QUEUE_PROXY_UPSTREAM` — full origin to forward to (default
 * `http://127.0.0.1:4000`). Overridable so tests can redirect forwarding
 * at a synthetic slow backend instead of real litellm, without touching
 * any model-serving container (M-094 Phase 1 test requirement).
 *
 * ── Phase 1 vs Phase 2 ───────────────────────────────────────────────────
 * Phase 1 (this file, done now): build + standalone-test the proxy against
 * mock endpoints. Nothing points at this proxy by default yet — pi-web
 * still talks to litellm's own port 4000 directly. Phase 2 (gated, needs a
 * fresh go-ahead from Chris): repoint pi-web/pi at :4001, tune
 * PI_WEB_FACTORY_STEP_TIMEOUT_MS, run real concurrent-model tests. Do not
 * infer Phase 2 authorization from this file's mere existence.
 */

const PORT = Number(process.env.LITELLM_QUEUE_PROXY_PORT ?? 4001);
const UPSTREAM = process.env.LITELLM_QUEUE_PROXY_UPSTREAM ?? "http://127.0.0.1:4000";

/**
 * Minimal counting semaphore, count fixed at 1 for Phase 1 (simplest
 * correct baseline — see M-094's card, deliberately not built out to be
 * per-model/configurable yet). `acquire()` resolves once a slot is free;
 * `release()` hands the slot to the next waiter (FIFO via a promise queue)
 * or frees it entirely if nobody is waiting.
 */
class Semaphore {
  private count: number;
  private waiters: Array<() => void> = [];

  constructor(count: number) {
    this.count = count;
  }

  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot directly to the next waiter rather than incrementing
      // count then having them re-acquire — avoids a race where a third
      // caller could steal the slot between increment and the waiter's
      // resume.
      next();
    } else {
      this.count += 1;
    }
  }
}

const semaphore = new Semaphore(1);

/**
 * Hop-by-hop headers per RFC 7230 §6.1 — meaningful only for a single
 * transport hop, must not be blindly forwarded by a proxy. Everything
 * else (notably Authorization) passes through completely untouched.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function filteredHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      out.append(key, value);
    }
  }
  return out;
}

/**
 * Wraps a ReadableStream so `release()` fires exactly once, the moment the
 * stream is fully drained (client read everything, i.e. `pull` sees the
 * upstream reader report `done`) OR the moment either side errors/cancels
 * — never on headers-received, never left unreleased on any exit path.
 */
function releaseOnDrain(body: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      release();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          releaseOnce();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        releaseOnce();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseOnce();
      }
    },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = UPSTREAM + url.pathname + url.search;

  // Bun's fetch() rejects a body on GET/HEAD even if present as undefined
  // is fine, but explicitly pass `undefined` for bodyless methods to avoid
  // any ambiguity; for everything else forward the raw body stream (do not
  // buffer it into memory — mirrors the same streaming discipline applied
  // to the response).
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  await semaphore.acquire();

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: filteredHeaders(req.headers),
      body: hasBody ? req.body : undefined,
      // Bun-specific fetch option required to stream a request body
      // (Node's undici otherwise buffers it) — typed directly by
      // bun-types, no suppression needed.
      duplex: hasBody ? "half" : undefined,
    });
  } catch (err) {
    // Upstream unreachable / network error: release immediately, no
    // deadlock, surface a 502 to the caller.
    semaphore.release();
    return new Response(
      JSON.stringify({ error: "litellm-queue-proxy: upstream request failed", detail: String(err) }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const responseHeaders = filteredHeaders(upstreamResponse.headers);

  if (!upstreamResponse.body) {
    // No body to stream (e.g. 204/304, or an empty response) — release now,
    // nothing left to drain.
    semaphore.release();
    return new Response(null, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  const relayedBody = releaseOnDrain(upstreamResponse.body, () => semaphore.release());

  return new Response(relayedBody, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: handleRequest,
});

console.log(
  `litellm-queue-proxy listening on :${server.port}, forwarding to ${UPSTREAM} (semaphore count=1)`,
);
