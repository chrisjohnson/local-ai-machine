// HTTP + WebSocket API for the pi-agent supervisor, plus static file
// serving for the bundled frontend (M-032) - one container serves both to
// keep the deploy shape simple (per M-033's own stated preference).
//
// No auth, no TLS - explicit scope decision for this home-LAN experiment
// (see M-032/M-033 cards). Do not add without the human's direction.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { Supervisor } from "./supervisor.js";
import { writeModelsJson } from "./bootstrap-models-json.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3002);
const DATA_DIR = process.env.PI_AGENT_DATA_DIR ?? "/data";
const PI_BIN = process.env.PI_BIN ?? "pi";
const PI_PROVIDER = process.env.PI_PROVIDER ?? "local-litellm";
const PI_MODEL = process.env.PI_MODEL ?? "coder";
const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL ?? "http://127.0.0.1:4000/v1";
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY ?? "";
// PI_CODING_AGENT_DIR is pi's own env var (see environment-variables.md) -
// it overrides pi's config dir directly (default ~/.pi/agent), so this
// already points AT the directory models.json lives in, no extra "agent"
// segment needed (see bootstrap-models-json.ts for the bug this fixed).
const PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(DATA_DIR, "pi-agent-config");
const STATIC_DIR = process.env.PI_AGENT_STATIC_DIR ?? join(__dirname, "..", "..", "frontend", "dist");
// Working directory for spawned pi processes - separate from --session-dir
// (always under DATA_DIR). docker-compose.yml bind-mounts real project
// checkouts under here; sessions cd between them via the agent's own bash
// tool, not via supervisor-side selection (yet).
const PI_AGENT_WORKDIR = process.env.PI_AGENT_WORKDIR ?? "/workspace";

async function main() {
  if (!LITELLM_MASTER_KEY) {
    console.error("LITELLM_MASTER_KEY is not set - refusing to start with no way to authenticate to litellm.");
    process.exit(1);
  }

  writeModelsJson({
    piCodingAgentDir: PI_CODING_AGENT_DIR,
    providerName: PI_PROVIDER,
    modelId: PI_MODEL,
    baseUrl: LITELLM_BASE_URL,
    apiKey: LITELLM_MASTER_KEY,
  });

  const supervisor = new Supervisor({
    dataDir: DATA_DIR,
    piBin: PI_BIN,
    piProvider: PI_PROVIDER,
    piModel: PI_MODEL,
    piCodingAgentDir: PI_CODING_AGENT_DIR,
    workDir: PI_AGENT_WORKDIR,
  });
  supervisor.recoverAfterRestart();

  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/sessions", (_req, res) => {
    res.json({ sessions: supervisor.listSessions() });
  });

  app.post("/api/sessions", async (req, res) => {
    const label = typeof req.body?.label === "string" ? req.body.label : undefined;
    const record = await supervisor.createSession(label);
    res.status(201).json({ session: record });
  });

  app.get("/api/sessions/:id", (req, res) => {
    const record = supervisor.getSession(req.params.id);
    if (!record) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ session: record });
  });

  app.post("/api/sessions/:id/resume", async (req, res) => {
    try {
      const record = await supervisor.resumeSession(req.params.id);
      res.json({ session: record });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/sessions/:id/messages", async (req, res) => {
    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const result = await supervisor.sendMessage(req.params.id, {
      message,
      streamingBehavior: req.body?.streamingBehavior,
    });
    res.status(result.accepted ? 202 : 409).json(result);
  });

  app.post("/api/sessions/:id/stop", async (req, res) => {
    await supervisor.stopSession(req.params.id);
    res.json({ ok: true });
  });

  // Replay endpoint: everything buffered for this session with seq > since.
  // This is the HTTP fallback/complement to the WS live stream below - a
  // client can poll this on load, then upgrade to WS for live updates, and
  // on reconnect ask for events since the last seq it saw.
  app.get("/api/sessions/:id/events", (req, res) => {
    const since = req.query.since !== undefined ? Number(req.query.since) : undefined;
    const events = supervisor.getEventsSince(req.params.id, Number.isNaN(since) ? undefined : since);
    res.json({ events });
  });

  if (existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(join(STATIC_DIR, "index.html"));
    });
  } else {
    console.warn(`static frontend dir not found at ${STATIC_DIR} - API-only mode`);
  }

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const sessionId = match[1];
    if (!supervisor.getSession(sessionId)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleStreamConnection(ws, sessionId, url);
    });
  });

  function handleStreamConnection(ws: WebSocket, sessionId: string, url: URL): void {
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam !== null ? Number(sinceParam) : undefined;

    // Replay-on-connect: send everything missed since the client's last
    // known seq (or everything, for a fresh connection) before switching
    // to live streaming. This is the concrete mechanism behind "reconnect
    // later and not lose what happened while disconnected."
    const backlog = supervisor.getEventsSince(sessionId, Number.isNaN(since as number) ? undefined : since);
    for (const event of backlog) {
      ws.send(JSON.stringify(event));
    }

    const unsubscribe = supervisor.subscribe(sessionId, (event) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });

    ws.on("message", (raw) => {
      // Clients may send {"type": "prompt", "message": "..."} directly
      // over the socket as a lower-latency alternative to the POST
      // endpoint above; both paths go through the same supervisor method.
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed?.type === "prompt" && typeof parsed.message === "string") {
          void supervisor.sendMessage(sessionId, { message: parsed.message, streamingBehavior: parsed.streamingBehavior });
        }
      } catch (error) {
        console.error("failed to parse client WS message:", error);
      }
    });

    ws.on("close", () => {
      unsubscribe?.();
    });
  }

  httpServer.listen(PORT, () => {
    console.log(`pi-agent supervisor listening on :${PORT} (provider=${PI_PROVIDER} model=${PI_MODEL})`);
  });

  const shutdown = async () => {
    console.log("shutting down...");
    await supervisor.shutdown();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
