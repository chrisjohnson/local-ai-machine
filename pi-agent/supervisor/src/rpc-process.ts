// Wraps a single `pi --mode rpc` child process.
//
// Framing per packages/coding-agent/docs/rpc.md (confirmed directly in
// M-030): JSONL over stdin/stdout, LF-only delimiter. Node's `readline`
// is explicitly NOT protocol-compliant (it also splits on U+2028/U+2029,
// which are valid inside JSON strings) - so this parses lines manually
// instead of using readline, exactly as the doc warns.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

export interface RpcResponse {
  type: "response";
  command: string;
  success: boolean;
  id?: string;
  data?: unknown;
  error?: string;
}

export type RpcMessage = RpcEvent | RpcResponse;

export interface RpcProcessOptions {
  sessionDir: string;
  sessionFile?: string;
  provider: string;
  model: string;
  piConfigDir: string;
  piBin: string;
  cwd: string;
}

function isResponse(msg: RpcMessage): msg is RpcResponse {
  return (msg as RpcResponse).type === "response";
}

// One "low-level agent run settles" cycle can legitimately emit multiple
// agent_end events (retry / compaction retry per rpc.md) before the whole
// thing is done - agent_settled is the real terminal signal. Confirmed
// directly in M-030's decision log; recorded here so the supervisor
// doesn't repeat that "done too early" mistake.
export const TERMINAL_EVENT_TYPE = "agent_settled";

export class RpcProcessInstance {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private readonly eventListeners = new Set<(msg: RpcMessage) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private pendingResponses = new Map<string, { resolve: (r: RpcResponse) => void; reject: (e: Error) => void }>();
  private nextRequestId = 1;
  private _exited = false;

  constructor(options: RpcProcessOptions) {
    const args = ["--mode", "rpc", "--session-dir", options.sessionDir, "--provider", options.provider, "--model", options.model];
    if (options.sessionFile) {
      args.push("--session", options.sessionFile);
    }
    this.proc = spawn(options.piBin, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PI_CONFIG_DIR: options.piConfigDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      console.error(`[pi-rpc stderr pid=${this.proc.pid}] ${chunk.toString()}`);
    });
    this.proc.on("exit", (code, signal) => {
      this._exited = true;
      for (const { reject } of this.pendingResponses.values()) {
        reject(new Error(`pi rpc process exited (code=${code}, signal=${signal}) before responding`));
      }
      this.pendingResponses.clear();
      for (const listener of this.exitListeners) listener(code, signal);
    });
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  get exited(): boolean {
    return this._exited;
  }

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    this.drainBuffer();
  }

  private drainBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch (error) {
      console.error(`pi rpc: failed to parse line: ${line}`, error);
      return;
    }
    if (isResponse(msg) && msg.id && this.pendingResponses.has(msg.id)) {
      const pending = this.pendingResponses.get(msg.id)!;
      this.pendingResponses.delete(msg.id);
      pending.resolve(msg);
    }
    for (const listener of this.eventListeners) listener(msg);
  }

  onMessage(listener: (msg: RpcMessage) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  // Fire-and-forget send (used for prompt/steer/abort where we don't need
  // to block on the ack - the real result streams via events anyway).
  send(command: Record<string, unknown>): void {
    if (this._exited) {
      throw new Error("cannot send to an exited pi rpc process");
    }
    this.proc.stdin.write(`${JSON.stringify(command)}\n`);
  }

  // Send and wait for the matching `response` (matched by id) - used for
  // get_state/get_messages where the caller wants the actual data back.
  async request(command: Record<string, unknown>, timeoutMs = 15000): Promise<RpcResponse> {
    const id = `sup-${this.nextRequestId++}`;
    const withId = { ...command, id };
    const responsePromise = new Promise<RpcResponse>((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingResponses.has(id)) {
          this.pendingResponses.delete(id);
          reject(new Error(`timed out waiting for response to ${String(command.type)}`));
        }
      }, timeoutMs);
    });
    this.send(withId);
    return responsePromise;
  }

  kill(): void {
    if (!this._exited) {
      this.proc.kill("SIGTERM");
    }
  }
}
