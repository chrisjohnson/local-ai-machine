#!/usr/bin/env bun
/**
 * mock-backend.ts (M-094 Phase 1 test support): a trivial synthetic
 * "litellm-alike" HTTP server used ONLY by the proxy's own standalone test
 * suite (server.test.ts) — never used against a real model or GPU
 * resource. Stands in for litellm so the proxy's forwarding/streaming/
 * semaphore/error-handling behavior can be tested without any interaction
 * with model-serving containers.
 *
 * Routes (all under whatever path is requested — routing is by query
 * param / header so a single mock process can serve every test case):
 *  - `?mode=echo`            → immediately returns a small JSON body
 *    echoing method/headers/body, for plain forwarding-correctness checks.
 *  - `?mode=auth`            → 401 unless `Authorization: Bearer good-key`
 *    is present, mirroring litellm's own auth-gate shape closely enough
 *    to test passthrough (not asserting litellm's exact error body, just
 *    that the proxy doesn't alter/short-circuit it).
 *  - `?mode=slow&delayMs=N`  → sleeps N ms, then returns a small JSON body
 *    with a server-side `respondedAt` timestamp — used for the
 *    fully-drained-before-second-starts semaphore test.
 *  - `?mode=stream&chunks=N&delayMs=M` → SSE-shaped streaming response,
 *    emitting N chunks with an M ms sleep between each, each chunk
 *    embedding the server's own send timestamp — used to prove genuine
 *    incremental streaming (not buffer-then-send) and to prove the
 *    semaphore is held for the full stream duration.
 *  - `?mode=error`           → immediately returns HTTP 500.
 */

const PORT = Number(process.env.MOCK_BACKEND_PORT ?? 4999);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "echo";

  if (mode === "auth") {
    const auth = req.headers.get("authorization");
    if (auth !== "Bearer good-key") {
      return new Response(JSON.stringify({ error: { message: "Authentication Error" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (mode === "slow") {
    const delayMs = Number(url.searchParams.get("delayMs") ?? "500");
    await sleep(delayMs);
    return new Response(
      JSON.stringify({ respondedAt: Date.now(), delayMs, method: req.method }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  if (mode === "stream") {
    const chunkCount = Number(url.searchParams.get("chunks") ?? "5");
    const delayMs = Number(url.searchParams.get("delayMs") ?? "200");
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        for (let i = 0; i < chunkCount; i++) {
          await sleep(delayMs);
          const payload = JSON.stringify({ chunk: i, sentAt: Date.now() });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  if (mode === "error") {
    return new Response(JSON.stringify({ error: "synthetic mock failure" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // echo
  const bodyText = req.method === "GET" || req.method === "HEAD" ? null : await req.text();
  return new Response(
    JSON.stringify({
      method: req.method,
      path: url.pathname,
      query: url.search,
      authorization: req.headers.get("authorization"),
      body: bodyText,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: handle,
});

console.log(`mock-backend listening on :${server.port}`);
