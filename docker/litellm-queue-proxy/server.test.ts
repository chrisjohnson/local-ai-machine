/**
 * server.test.ts (M-094 Phase 1): standalone correctness tests for
 * litellm-queue-proxy, run against a synthetic mock backend
 * (mock-backend.ts) — NOT real litellm, NOT any real model/GPU resource.
 * The one exception is `smoke: real litellm end-to-end`, gated behind
 * `RUN_REAL_LITELLM_SMOKE_TEST=1` and skipped by default, per the card's
 * explicit Phase 1 scope (a single lightweight non-concurrent real request
 * is wanted, but must never run as part of routine/CI test runs that could
 * coincide with concurrent GPU-bound work on the box).
 *
 * Each test spins up its own mock backend + proxy pair on fresh ports so
 * tests can run in isolation (bun test's default is sequential per file,
 * but isolation avoids any cross-test port/semaphore-state leakage
 * regardless).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

let nextPort = 20000;
function allocPort(): number {
  nextPort += 1;
  return nextPort;
}

type Harness = {
  mockPort: number;
  proxyPort: number;
  mockProc: ReturnType<typeof Bun.spawn>;
  proxyProc: ReturnType<typeof Bun.spawn>;
  stop: () => Promise<void>;
};

async function waitForListening(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`nothing listening on :${port} after ${timeoutMs}ms`);
}

async function startHarness(): Promise<Harness> {
  const mockPort = allocPort();
  const proxyPort = allocPort();

  const mockProc = Bun.spawn({
    cmd: ["bun", `${import.meta.dir}/mock-backend.ts`],
    env: { ...process.env, MOCK_BACKEND_PORT: String(mockPort) },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForListening(mockPort);

  const proxyProc = Bun.spawn({
    cmd: ["bun", `${import.meta.dir}/server.ts`],
    env: {
      ...process.env,
      LITELLM_QUEUE_PROXY_PORT: String(proxyPort),
      LITELLM_QUEUE_PROXY_UPSTREAM: `http://127.0.0.1:${mockPort}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForListening(proxyPort);

  return {
    mockPort,
    proxyPort,
    mockProc,
    proxyProc,
    stop: async () => {
      mockProc.kill();
      proxyProc.kill();
      await Promise.all([mockProc.exited, proxyProc.exited]);
    },
  };
}

describe("litellm-queue-proxy", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startHarness();
  });

  afterEach(async () => {
    await h.stop();
  });

  test("1: forwarding correctness — proxy result matches direct mock result", async () => {
    const directRes = await fetch(`http://127.0.0.1:${h.mockPort}/v1/chat/completions?foo=bar`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer abc123" },
      body: JSON.stringify({ hello: "world" }),
    });
    const directBody = await directRes.json();

    const proxyRes = await fetch(`http://127.0.0.1:${h.proxyPort}/v1/chat/completions?foo=bar`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer abc123" },
      body: JSON.stringify({ hello: "world" }),
    });
    const proxyBody = await proxyRes.json();

    expect(proxyRes.status).toBe(directRes.status);
    // respondedAt/timestamps aren't in play for echo mode, so bodies should
    // be identical modulo nothing — genuinely byte-identical semantics.
    expect(proxyBody).toEqual(directBody);
    expect(proxyBody).toEqual({
      method: "POST",
      path: "/v1/chat/completions",
      query: "?foo=bar",
      authorization: "Bearer abc123",
      body: JSON.stringify({ hello: "world" }),
    });
  });

  test("2: auth passthrough — valid key succeeds, invalid key gets litellm's exact error", async () => {
    const goodDirect = await fetch(`http://127.0.0.1:${h.mockPort}/anything?mode=auth`, {
      headers: { authorization: "Bearer good-key" },
    });
    const goodProxy = await fetch(`http://127.0.0.1:${h.proxyPort}/anything?mode=auth`, {
      headers: { authorization: "Bearer good-key" },
    });
    expect(goodProxy.status).toBe(200);
    expect(goodProxy.status).toBe(goodDirect.status);
    expect(await goodProxy.json()).toEqual(await goodDirect.json());

    const badDirect = await fetch(`http://127.0.0.1:${h.mockPort}/anything?mode=auth`, {
      headers: { authorization: "Bearer wrong-key" },
    });
    const badProxy = await fetch(`http://127.0.0.1:${h.proxyPort}/anything?mode=auth`, {
      headers: { authorization: "Bearer wrong-key" },
    });
    expect(badProxy.status).toBe(401);
    expect(badProxy.status).toBe(badDirect.status);
    expect(await badProxy.json()).toEqual(await badDirect.json());

    const missingDirect = await fetch(`http://127.0.0.1:${h.mockPort}/anything?mode=auth`);
    const missingProxy = await fetch(`http://127.0.0.1:${h.proxyPort}/anything?mode=auth`);
    expect(missingProxy.status).toBe(401);
    expect(missingProxy.status).toBe(missingDirect.status);
    expect(await missingProxy.json()).toEqual(await missingDirect.json());
  });

  test("3: streaming actually streams — chunks arrive incrementally over real wall-clock time", async () => {
    const res = await fetch(
      `http://127.0.0.1:${h.proxyPort}/v1/chat/completions?mode=stream&chunks=4&delayMs=200`,
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const receiveTimestamps: number[] = [];
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receiveTimestamps.push(Date.now());
      buffer += decoder.decode(value, { stream: true });
    }

    // 4 real data chunks + the [DONE] sentinel; Bun's ReadableStream pull
    // loop delivers each controller.enqueue() as its own read() in
    // practice for this payload size, but to be robust against any chunk
    // coalescing, assert on the *content* markers themselves rather than
    // strictly on frame count.
    const chunkMarkers = [...buffer.matchAll(/"chunk":(\d+)/g)].map((m) => Number(m[1]));
    expect(chunkMarkers).toEqual([0, 1, 2, 3]);
    expect(buffer).toContain("[DONE]");

    // The core "not buffer-then-send" proof: at least two distinct client
    // read() calls happened, AND the spread between the first and last
    // receive timestamp is close to the expected total streaming duration
    // (4 chunks * 200ms), not near-zero (which is what a buffer-then-send
    // implementation would produce — everything arriving in one read()
    // immediately after the full 800ms server-side wait, i.e. spread ~0).
    expect(receiveTimestamps.length).toBeGreaterThanOrEqual(2);
    const firstTimestamp = receiveTimestamps[0];
    const lastTimestamp = receiveTimestamps[receiveTimestamps.length - 1];
    if (firstTimestamp === undefined || lastTimestamp === undefined) {
      throw new Error("expected at least one receive timestamp");
    }
    const spread = lastTimestamp - firstTimestamp;
    expect(spread).toBeGreaterThan(400); // well above "arrived basically at once"
  });

  test("4: semaphore correctness — second request's processing starts only after first's response is fully drained", async () => {
    const events: Array<{ label: string; at: number }> = [];

    const first = (async () => {
      const res = await fetch(
        `http://127.0.0.1:${h.proxyPort}/v1/chat/completions?mode=slow&delayMs=600`,
      );
      const body = await res.json();
      events.push({ label: "first-fully-drained", at: Date.now() });
      return body;
    })();

    // Give `first` a head start to acquire the semaphore before firing
    // `second`, then fire `second` while `first` is still in flight.
    await new Promise((r) => setTimeout(r, 100));

    const secondStartRequestedAt = Date.now();
    const second = (async () => {
      const res = await fetch(
        `http://127.0.0.1:${h.proxyPort}/v1/chat/completions?mode=slow&delayMs=50`,
      );
      const body = (await res.json()) as { respondedAt: number };
      events.push({ label: "second-fully-drained", at: Date.now() });
      return body;
    })();

    const [firstBody, secondBody] = (await Promise.all([first, second])) as [
      { respondedAt: number },
      { respondedAt: number },
    ];

    // The critical assertion: the mock backend didn't even receive/start
    // processing the second request's `?mode=slow` handler until AFTER the
    // first request's body was fully drained by the client — i.e. the
    // second request's own upstream respondedAt is well after the first's,
    // and specifically after (secondStartRequestedAt + first's remaining
    // delay), proving the proxy queued it rather than forwarding
    // immediately.
    expect(firstBody.respondedAt).toBeLessThan(secondBody.respondedAt);

    const firstDrainedEvent = events.find((e) => e.label === "first-fully-drained")!;
    const secondDrainedEvent = events.find((e) => e.label === "second-fully-drained")!;
    expect(firstDrainedEvent.at).toBeLessThanOrEqual(secondDrainedEvent.at);

    // secondBody.respondedAt is the mock backend's OWN clock at the moment
    // it finished sleeping for the second request — this must be after the
    // first request was sent to the proxy (obviously) AND after roughly
    // (first request's full 600ms) has elapsed since second was fired,
    // proving second's upstream work didn't start until first was done,
    // not merely that second's *response* happened to arrive later.
    const elapsedSinceSecondFired = secondBody.respondedAt - secondStartRequestedAt;
    // second's own delayMs is 50ms; if it had started immediately upon
    // being fired (i.e. no queueing), elapsedSinceSecondFired would be
    // ~50ms. Because it must wait for first's remaining ~500ms first, the
    // real elapsed time should be well over 400ms.
    expect(elapsedSinceSecondFired).toBeGreaterThan(400);
  });

  test("5: erroring proxied request still releases the semaphore — no deadlock", async () => {
    const errorRes = await fetch(`http://127.0.0.1:${h.proxyPort}/anything?mode=error`);
    expect(errorRes.status).toBe(500);
    await errorRes.text();

    // If the semaphore weren't released on the error path, this next
    // request would hang forever. Race it against a timeout to prove it
    // resolves promptly.
    const start = Date.now();
    const followUp = await Promise.race([
      fetch(`http://127.0.0.1:${h.proxyPort}/anything?mode=echo`).then((r) => r.json()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out — deadlock")), 3000)),
    ]);
    const elapsed = Date.now() - start;

    expect(followUp).toMatchObject({ method: "GET" });
    expect(elapsed).toBeLessThan(3000);
  });

  test("6: bypass property — hitting the mock backend directly is unaffected by proxy activity", async () => {
    // Start a slow request through the proxy (holds the semaphore)...
    const slowThroughProxy = fetch(
      `http://127.0.0.1:${h.proxyPort}/v1/chat/completions?mode=slow&delayMs=500`,
    );

    await new Promise((r) => setTimeout(r, 50));

    // ...and confirm a direct hit to the backend (standing in for litellm
    // on :4000) completes immediately, unaffected by the proxy's held
    // semaphore.
    const directStart = Date.now();
    const directRes = await fetch(`http://127.0.0.1:${h.mockPort}/anything?mode=echo`);
    const directElapsed = Date.now() - directStart;
    expect(directRes.status).toBe(200);
    expect(directElapsed).toBeLessThan(300); // nowhere near the proxy's 500ms hold

    await slowThroughProxy;
  });
});

describe("litellm-queue-proxy — real litellm smoke test (gated, opt-in only)", () => {
  test.skipIf(process.env.RUN_REAL_LITELLM_SMOKE_TEST !== "1")(
    "7: single lightweight real request through the proxy to real litellm",
    async () => {
      const proxyPort = allocPort();
      const proxyProc = Bun.spawn({
        cmd: ["bun", `${import.meta.dir}/server.ts`],
        env: {
          ...process.env,
          LITELLM_QUEUE_PROXY_PORT: String(proxyPort),
          LITELLM_QUEUE_PROXY_UPSTREAM: "http://127.0.0.1:4000",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      try {
        await waitForListening(proxyPort);
        const res = await fetch(`http://127.0.0.1:${proxyPort}/health/liveliness`);
        expect(res.status).toBe(200);
      } finally {
        proxyProc.kill();
        await proxyProc.exited;
      }
    },
  );
});
