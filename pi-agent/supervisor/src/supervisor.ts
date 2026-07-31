// The core supervisor: owns the manifest, spawns/tracks one pi rpc child
// process per live session, and buffers events per session so a client
// that connects later (or reconnects after a gap) can replay what it
// missed via GET /sessions/:id/events?since=N instead of losing it.
//
// Design mirrors the shape of pi's own (unpublished, Unix-socket-only)
// packages/server/src/supervisor.ts, confirmed by reading that source in
// M-030: per-session child process + manifest with recoverAfterRestart +
// subscriber fanout. This is an independent implementation (that package
// isn't published to npm and has no HTTP/WS surface), not a dependency on
// it.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Manifest } from "./manifest.js";
import { RpcProcessInstance, TERMINAL_EVENT_TYPE, type RpcMessage } from "./rpc-process.js";
import { historyToBufferedEvents, loadHistoryMessages } from "./session-history.js";
import type { BufferedEvent, SendMessageRequest, SessionRecord, SessionStatus } from "./types.js";

const MAX_BUFFERED_EVENTS_PER_SESSION = 2000;

export interface SupervisorConfig {
  dataDir: string; // root dir: manifest.json + per-session subdirs live here
  piBin: string;
  piProvider: string;
  piModel: string;
  piCodingAgentDir: string; // written once at startup (see bootstrap-models-json.ts)
  // Working directory for spawned `pi` processes - deliberately separate
  // from `record.sessionDir` (which is only ever --session-dir, pi's own
  // state). Sessions cd between mounted project dirs themselves; the
  // supervisor doesn't pick one per session (yet).
  workDir: string;
}

interface LiveSession {
  record: SessionRecord;
  rpc?: RpcProcessInstance;
  events: BufferedEvent[];
  nextSeq: number;
  subscribers: Set<(event: BufferedEvent) => void>;
  unsubscribeMessage?: () => void;
  unsubscribeExit?: () => void;
}

export class Supervisor {
  private readonly manifest: Manifest;
  private readonly live = new Map<string, LiveSession>();
  private readonly config: SupervisorConfig;

  constructor(config: SupervisorConfig) {
    this.config = config;
    mkdirSync(config.dataDir, { recursive: true });
    this.manifest = new Manifest(join(config.dataDir, "manifest.json"));
  }

  // Called once at startup. Any session that was "running"/"starting" when
  // the supervisor last stopped could not possibly still have a live child
  // process (this process just started) - mark those "stopped" so the UI
  // is honest, but keep the record (and its --session-dir contents) so the
  // session's history is still reachable and can be resumed on demand.
  recoverAfterRestart(): void {
    for (const record of this.manifest.list()) {
      if (record.status === "running" || record.status === "starting") {
        this.manifest.upsert({ ...record, status: "stopped", updatedAt: new Date().toISOString() });
      }
    }
  }

  listSessions(): SessionRecord[] {
    return this.manifest.list();
  }

  getSession(id: string): SessionRecord | undefined {
    return this.manifest.get(id);
  }

  private setStatus(sessionId: string, status: SessionStatus, extra?: Partial<SessionRecord>): void {
    const current = this.manifest.get(sessionId);
    if (!current) return;
    const updated: SessionRecord = {
      ...current,
      ...extra,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.manifest.upsert(updated);
    const live = this.live.get(sessionId);
    if (live) live.record = updated;
  }

  private pushEvent(sessionId: string, source: BufferedEvent["source"], data: unknown): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    const event: BufferedEvent = {
      seq: live.nextSeq++,
      source,
      timestamp: new Date().toISOString(),
      data,
    };
    live.events.push(event);
    if (live.events.length > MAX_BUFFERED_EVENTS_PER_SESSION) {
      live.events.splice(0, live.events.length - MAX_BUFFERED_EVENTS_PER_SESSION);
    }
    for (const subscriber of live.subscribers) subscriber(event);
  }

  // Creates a brand-new session (new --session-dir, new pi rpc child).
  async createSession(label?: string): Promise<SessionRecord> {
    const id = randomUUID();
    const sessionDir = join(this.config.dataDir, "sessions", id);
    mkdirSync(sessionDir, { recursive: true });
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      label: label?.trim() || `session ${id.slice(0, 8)}`,
      sessionDir,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };
    this.manifest.upsert(record);
    this.spawnFor(record);
    return record;
  }

  // Re-spawns a pi rpc child for an existing (previously stopped) session,
  // pointed at the same --session-dir so its history is picked back up -
  // this is what makes "restart the supervisor, sessions are still there"
  // actually mean something beyond just listing metadata.
  async resumeSession(id: string): Promise<SessionRecord> {
    const record = this.manifest.get(id);
    if (!record) throw new Error(`no such session: ${id}`);
    if (this.live.get(id)?.rpc && !this.live.get(id)!.rpc!.exited) {
      return record; // already running
    }
    this.spawnFor(record);
    return record;
  }

  // `forceFreshSessionFile`: skip `record.piSessionFile` even if one is
  // recorded, so pi starts a brand-new session file in the same
  // `sessionDir` instead of trying to resume the old one. Used by
  // `sendMessage`'s recovery path when resuming the existing file itself
  // fails (e.g. a file left corrupt/truncated by a hard supervisor kill
  // mid-write - confirmed live: pi rejected one with "Session file is not
  // a valid pi session" and every subsequent resume attempt repeated the
  // exact same failure forever, since it kept pointing at the same broken
  // file). Not exposed as a general spawnFor param beyond this call site -
  // a session's own record still tracks whatever piSessionFile pi reports
  // back after a successful spawn either way.
  private spawnFor(record: SessionRecord, options?: { forceFreshSessionFile?: boolean }): void {
    let live = this.live.get(record.id);
    if (!live) {
      // Fresh in-memory entry - either a brand-new session, or an existing
      // one whose live state was wiped by a supervisor restart (the `live`
      // map is memory-only; manifest.json survives, the event buffer
      // doesn't). Seed from pi's own persisted *.jsonl transcript before
      // any new events arrive, so the UI shows real prior history instead
      // of appearing blank until the next message is sent.
      const history = historyToBufferedEvents(loadHistoryMessages(record.sessionDir), 1);
      live = {
        record,
        events: history,
        nextSeq: history.length + 1,
        subscribers: new Set(),
      };
      this.live.set(record.id, live);
    }
    this.setStatus(record.id, "starting");

    const rpc = new RpcProcessInstance({
      sessionDir: record.sessionDir,
      sessionFile: options?.forceFreshSessionFile ? undefined : record.piSessionFile,
      provider: this.config.piProvider,
      model: this.config.piModel,
      piCodingAgentDir: this.config.piCodingAgentDir,
      piBin: this.config.piBin,
      cwd: this.config.workDir,
    });
    live.rpc = rpc;

    live.unsubscribeMessage?.();
    live.unsubscribeExit?.();
    live.unsubscribeMessage = rpc.onMessage((msg) => this.handleMessage(record.id, msg));
    live.unsubscribeExit = rpc.onExit((code, signal) => {
      const current = this.manifest.get(record.id);
      if (current && current.status !== "stopped") {
        this.setStatus(
          record.id,
          code === 0 || code === null ? "stopped" : "error",
          code !== 0 ? { lastError: `pi process exited unexpectedly (code=${code}, signal=${signal})` } : {},
        );
        this.pushEvent(record.id, "supervisor", {
          type: "process_exit",
          code,
          signal,
        });
      }
    });

    this.setStatus(record.id, "idle");
    // Ask pi for its own session id/file once the process is up, so the
    // manifest records pi's own bookkeeping alongside ours (useful for
    // debugging / manual `pi --session` inspection).
    void rpc
      .request({ type: "get_state" })
      .then((response) => {
        if (response.success && response.data && typeof response.data === "object") {
          const data = response.data as { sessionId?: string; sessionFile?: string };
          this.setStatus(record.id, "idle", {
            piSessionId: data.sessionId,
            piSessionFile: data.sessionFile,
          });
        }
      })
      .catch((error) => {
        console.error(`get_state failed for session ${record.id}:`, error);
      });
  }

  private handleMessage(sessionId: string, msg: RpcMessage): void {
    this.pushEvent(sessionId, "pi-event", msg);
    if (msg.type === "agent_start") {
      this.setStatus(sessionId, "running");
    } else if (msg.type === TERMINAL_EVENT_TYPE) {
      this.setStatus(sessionId, "idle");
    }
  }

  async sendMessage(sessionId: string, body: SendMessageRequest): Promise<{ accepted: boolean; error?: string }> {
    const live = this.live.get(sessionId);
    if (!live || !live.rpc || live.rpc.exited) {
      // Session exists in the manifest but has no live process (e.g. after
      // a supervisor restart, or a crash) - resume it transparently so
      // sending a message to a stopped/crashed session just works rather
      // than erroring: this IS the mechanism, not a fallback for it.
      await this.resumeSession(sessionId);
    }
    const result = await this.trySendToLive(sessionId, body);
    if (result.accepted || !result.retryWithFreshSession) return result;

    // The resumed process itself failed before responding - most likely
    // its session file is unloadable (confirmed live: a file left
    // truncated/corrupt by a hard supervisor kill mid-write made pi
    // reject it with "not a valid pi session", and every retry against
    // that same file failed identically forever). One recovery attempt:
    // start a brand-new session file in the same sessionDir (dropping the
    // broken --session reference) so the record keeps working going
    // forward, rather than being permanently stuck. The old transcript
    // isn't recovered by this - it's already unreadable - but the session
    // itself is, and the user's message actually gets delivered.
    const record = this.manifest.get(sessionId);
    if (!record) return result;
    this.pushEvent(sessionId, "supervisor", {
      type: "session_recovered",
      reason: result.error ?? "resume failed",
    });
    this.spawnFor(record, { forceFreshSessionFile: true });
    return this.trySendToLive(sessionId, body);
  }

  // Sends to whatever's currently live for `sessionId`. `retryWithFreshSession`
  // is set when the failure looks like a dead/never-responded process (vs.
  // e.g. pi itself rejecting the prompt) - the caller decides whether to
  // retry from there.
  private async trySendToLive(
    sessionId: string,
    body: SendMessageRequest,
  ): Promise<{ accepted: boolean; error?: string; retryWithFreshSession?: boolean }> {
    const current = this.live.get(sessionId);
    if (!current?.rpc) {
      return { accepted: false, error: "session has no live pi process", retryWithFreshSession: true };
    }
    const command: Record<string, unknown> = { type: "prompt", message: body.message };
    if (body.streamingBehavior) command.streamingBehavior = body.streamingBehavior;
    try {
      const response = await current.rpc.request(command);
      return { accepted: response.success, error: response.success ? undefined : response.error };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
        retryWithFreshSession: current.rpc.exited,
      };
    }
  }

  // Returns buffered events with seq > since (or all, if since is
  // undefined) - this is the reconnect-replay mechanism.
  getEventsSince(sessionId: string, since?: number): BufferedEvent[] {
    const live = this.live.get(sessionId);
    if (!live) return [];
    if (since === undefined) return [...live.events];
    return live.events.filter((e) => e.seq > since);
  }

  subscribe(sessionId: string, listener: (event: BufferedEvent) => void): (() => void) | undefined {
    const live = this.live.get(sessionId);
    if (!live) return undefined;
    live.subscribers.add(listener);
    return () => live.subscribers.delete(listener);
  }

  async stopSession(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (live?.rpc) {
      live.rpc.kill();
    }
    this.setStatus(sessionId, "stopped");
  }

  async shutdown(): Promise<void> {
    for (const [id, live] of this.live) {
      if (live.rpc && !live.rpc.exited) {
        live.rpc.kill();
      }
      this.setStatus(id, "stopped");
    }
  }
}
