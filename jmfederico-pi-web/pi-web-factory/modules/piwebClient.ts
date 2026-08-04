/**
 * piwebClient: the execution primitive that replaces upstream SSSF's
 * `agent_pi.py` (which spawns a bare `pi` CLI subprocess and tails its JSONL
 * stdout — confirmed not available on PATH anywhere in the running
 * `jmfederico-pi-web` container). Instead this talks to pi-web's own session
 * REST/WebSocket API over HTTP, as a sibling process in the same container
 * (loopback) or, for standalone dev/test, straight at the LAN address.
 *
 * Route shapes below are ported from `@jmfederico/pi-web@1.202607.3` source
 * (`src/server/sessions/sessionRoutes.ts`, `src/shared/apiTypes.ts`) and
 * confirmed live against the real running instance at
 * `http://192.168.1.21:8080/api` — see `piwebClient.integration.test.ts`.
 *
 * See `pi-web-adw-design.md` §1.3 (API surface) and §3.2 (execution
 * pseudocode this module implements).
 */

// ── Ported wire types (subset of src/shared/apiTypes.ts we actually use) ──

export interface SessionModel {
  provider?: string;
  id?: string;
  name?: string;
  contextWindow?: number;
  reasoning?: unknown;
}

export interface QueuedSessionMessage {
  kind: "steer" | "followUp";
  text: string;
}

export interface AskUserQuestionOption {
  value: string;
  label: string;
  detail?: string;
}

export interface AskUserQuestion {
  id: string;
  question: string;
  detail?: string;
  options: AskUserQuestionOption[];
  allowOther?: boolean;
  multiple?: boolean;
}

export interface PendingAskUser {
  askId: string;
  askedAt: string;
  questions: AskUserQuestion[];
}

export type SessionWarningSeverity = "info" | "warning" | "error";

export interface SessionWarning {
  severity: SessionWarningSeverity;
  message: string;
  source?: string;
  path?: string;
  dismiss?: { id: string };
}

/** `GET /sessions/:id/status` response shape (also returned by `POST /model`). */
export interface SessionStatus {
  sessionId: string;
  persisted?: boolean;
  model?: SessionModel;
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  queuedMessages: QueuedSessionMessage[];
  messageCount?: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  warnings?: SessionWarning[];
  pendingAsk?: PendingAskUser;
  pendingDialogs?: unknown[];
}

/** `POST /sessions` response shape (a `SessionInfo`). */
export interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  persisted?: boolean;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

/**
 * One entry of `GET /sessions/:id/messages`'s transcript array — the
 * `projectBrowserMessageResponse` projection of pi's own persisted session
 * messages, not raw JSONL. Only the fields we actually read are typed; the
 * rest of the shape (usage, stopReason, provider/model, etc.) is passed
 * through untouched.
 */
export interface SessionMessageContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface SessionMessage {
  role: "user" | "assistant" | "toolResult";
  content: SessionMessageContentPart[];
  timestamp?: number;
  [key: string]: unknown;
}

export interface MessagePage {
  messages: SessionMessage[];
  start: number;
  total: number;
}

/** Transport-level event envelope on `GET /sessions/:id/events` (WebSocket). */
export type SessionUiEvent = { type: string; seq?: number; [key: string]: unknown };

// ── Config ──────────────────────────────────────────────────────────────

/** Default base URL for this box's `jmfederico-pi-web` instance, LAN-reachable. */
export const DEFAULT_BASE_URL = "http://192.168.1.21:8080/api";

export class PiWebClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PiWebClientError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = isRecord(body) && typeof body["error"] === "string" ? body["error"] : text || res.statusText;
    throw new PiWebClientError(`pi-web request failed (${String(res.status)}): ${detail}`, res.status);
  }
  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Session lifecycle ───────────────────────────────────────────────────

/**
 * `POST /sessions {cwd, startupToken}` — starts a new session. `cwd` must be
 * a non-empty absolute path; no project/workspace pre-registration required.
 * `startupToken` is an opaque label the caller can use to recognise its own
 * construction's startup reports (see `session.startup` WS event); optional.
 */
export async function startSession(baseUrl: string, cwd: string, startupToken?: string): Promise<SessionInfo> {
  return requestJson<SessionInfo>(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(startupToken === undefined ? { cwd } : { cwd, startupToken }),
  });
}

/**
 * `POST /sessions/:id/model {provider, modelId}` — pins the session's model.
 * Returns the resulting `SessionStatus` (the route echoes the full status,
 * not just an ack — confirmed live).
 */
export async function setModel(
  baseUrl: string,
  sessionId: string,
  provider: string,
  modelId: string,
): Promise<SessionStatus> {
  return requestJson<SessionStatus>(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, modelId }),
  });
}

/**
 * `POST /sessions/:id/prompt {text}` — sends a message. **Fire-and-forget**:
 * the response is `{accepted: true}` the instant the server has queued the
 * message, well before the model has produced (or even started producing) a
 * reply. Do NOT treat this response as turn completion — use
 * `waitForCompletion` for that.
 */
export async function prompt(baseUrl: string, sessionId: string, text: string): Promise<{ accepted: true }> {
  return requestJson<{ accepted: true }>(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/** `GET /sessions/:id/status` — current streaming/ask/usage state. */
export async function getStatus(baseUrl: string, sessionId: string): Promise<SessionStatus> {
  return requestJson<SessionStatus>(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/status`);
}

/**
 * `GET /sessions/:id/messages` — structured transcript
 * (`projectBrowserMessageResponse`'s output), not raw session-file JSONL.
 * Called with no paging params, so the route returns the bare array form
 * rather than a `MessagePage`.
 */
export async function getMessages(baseUrl: string, sessionId: string): Promise<SessionMessage[]> {
  return requestJson<SessionMessage[]>(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`);
}

/**
 * Extracts the last assistant message's text content from a transcript
 * (concatenating all `type: "text"` content parts, in order — an assistant
 * message may carry `thinking` parts alongside `text`, which are excluded).
 * Returns `undefined` when no assistant message exists yet.
 */
export function lastAssistantText(messages: SessionMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const text = message.content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
    return text;
  }
  return undefined;
}

// ── Completion wait-loop ────────────────────────────────────────────────

export interface WaitForCompletionOptions {
  /** Overall timeout in ms before giving up and returning an "error" result. Default 120_000. */
  timeoutMs?: number;
  /** Poll interval in ms for the `/status` fallback. Default 1500. */
  pollIntervalMs?: number;
  /** Skip the WebSocket entirely and go straight to poll-only (mainly for tests). Default false. */
  forcePollOnly?: boolean;
}

export type WaitForCompletionResult =
  | { status: "done"; messages: SessionMessage[] }
  | { status: "blocked-on-human"; pendingAsk: PendingAskUser }
  | { status: "error"; detail: string };

/**
 * Waits for the session's in-flight turn to finish, preferring the
 * `/events` WebSocket for the authoritative `agent.end` signal (falling
 * back to a `status.update` event whose embedded status already reports
 * `isStreaming === false`), and falling back to polling `GET /status` on a
 * short interval if the socket never connects or drops before a terminal
 * signal arrives.
 *
 * There is no blocking/long-poll HTTP variant anywhere in pi-web — this is
 * the wait-loop that has to exist because of that (see design doc §1.3).
 *
 * Turn-complete = `isStreaming === false && pendingAsk === undefined`.
 * `pendingAsk` set instead means the agent is blocked on a question, a
 * distinct state from success/failure — surfaced as `blocked-on-human`,
 * never folded into `error` or a timeout.
 */
export async function waitForCompletion(
  baseUrl: string,
  sessionId: string,
  opts: WaitForCompletionOptions = {},
): Promise<WaitForCompletionResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const deadline = Date.now() + timeoutMs;

  const settleFromStatus = async (status: SessionStatus): Promise<WaitForCompletionResult | undefined> => {
    if (status.pendingAsk !== undefined) {
      return { status: "blocked-on-human", pendingAsk: status.pendingAsk };
    }
    if (!status.isStreaming) {
      const messages = await getMessages(baseUrl, sessionId);
      return { status: "done", messages };
    }
    return undefined;
  };

  if (!opts.forcePollOnly) {
    const wsResult = await waitViaWebSocket(baseUrl, sessionId, deadline, settleFromStatus);
    if (wsResult !== undefined) return wsResult;
    // WebSocket failed/dropped/timed out without a terminal signal — fall through to polling
    // with whatever time remains.
  }

  return waitViaPolling(baseUrl, sessionId, deadline, pollIntervalMs, settleFromStatus);
}

function wsUrlFor(baseUrl: string, sessionId: string): string {
  const url = new URL(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/events`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Holds the `/events` WebSocket open and resolves as soon as `agent.end` (or
 * an equivalent `status.update` with `isStreaming: false`) arrives, or a
 * `pendingAsk` is observed via `status.update`. Returns `undefined` (rather
 * than throwing) on connect failure, an unexpected close, or hitting the
 * deadline without a terminal signal — the caller falls back to polling.
 */
function waitViaWebSocket(
  baseUrl: string,
  sessionId: string,
  deadline: number,
  settleFromStatus: (status: SessionStatus) => Promise<WaitForCompletionResult | undefined>,
): Promise<WaitForCompletionResult | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrlFor(baseUrl, sessionId));
    } catch {
      resolve(undefined);
      return;
    }

    const finish = (result: WaitForCompletionResult | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed/closing — nothing to do
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(undefined), Math.max(0, deadline - Date.now()));

    ws.addEventListener("message", (event: MessageEvent) => {
      void (async () => {
        if (settled) return;
        const raw = event.data;
        const text = typeof raw === "string" ? raw : await bufferLikeToText(raw);
        if (text === undefined) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (!isRecord(parsed) || typeof parsed["type"] !== "string") return;
        const evt = parsed as SessionUiEvent;

        if (evt.type === "agent.end") {
          try {
            const messages = await getMessages(baseUrl, sessionId);
            finish({ status: "done", messages });
          } catch (error) {
            finish({ status: "error", detail: errorDetail(error) });
          }
          return;
        }

        if (evt.type === "status.update" && isRecord(evt["status"])) {
          try {
            const result = await settleFromStatus(evt["status"] as unknown as SessionStatus);
            if (result !== undefined) finish(result);
          } catch (error) {
            finish({ status: "error", detail: errorDetail(error) });
          }
          return;
        }

        if (evt.type === "session.error") {
          const message = typeof evt["message"] === "string" ? evt["message"] : "session.error event";
          finish({ status: "error", detail: message });
        }
      })();
    });

    ws.addEventListener("error", () => finish(undefined));
    ws.addEventListener("close", () => finish(undefined));
  });
}

/** Converts a Bun/Node WebSocket message payload (Buffer/ArrayBuffer/Blob) to text. */
async function bufferLikeToText(data: unknown): Promise<string | undefined> {
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as Uint8Array);
  if (data instanceof Blob) return data.text();
  // Bun delivers Node-style Buffer instances for text frames too.
  if (isRecord(data) && typeof (data as { toString?: unknown }).toString === "function") {
    return (data as { toString(encoding: string): string }).toString("utf8");
  }
  return undefined;
}

async function waitViaPolling(
  baseUrl: string,
  sessionId: string,
  deadline: number,
  pollIntervalMs: number,
  settleFromStatus: (status: SessionStatus) => Promise<WaitForCompletionResult | undefined>,
): Promise<WaitForCompletionResult> {
  for (;;) {
    let status: SessionStatus;
    try {
      status = await getStatus(baseUrl, sessionId);
    } catch (error) {
      if (Date.now() >= deadline) return { status: "error", detail: errorDetail(error) };
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      continue;
    }

    const result = await settleFromStatus(status);
    if (result !== undefined) return result;

    if (Date.now() >= deadline) {
      return { status: "error", detail: `waitForCompletion timed out after ${String(deadline)}` };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
