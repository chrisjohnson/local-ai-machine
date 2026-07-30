// Shared types for the pi-agent supervisor.
//
// This supervisor exists to fill exactly one gap: `pi --mode rpc` is a
// single-session-per-process, stdin/stdout-driven headless agent with no
// built-in multi-client HTTP server (confirmed directly in M-030). It does
// NOT reimplement pi's own agent loop or RPC protocol — it spawns real
// `pi --mode rpc` child processes and relays their JSONL stdin/stdout
// protocol over HTTP + WebSocket, buffering events per-session so a client
// that reconnects later (e.g. a phone browser tab reopened after a while)
// replays what it missed instead of losing it.

export type SessionStatus = "starting" | "running" | "idle" | "error" | "stopped";

// One user-visible "workstream". Persisted in manifest.json so a supervisor
// restart (docker restart, redeploy) can rediscover sessions from their
// --session-dir state rather than losing them (per M-031 plan item 1).
export interface SessionRecord {
  id: string;
  label: string;
  sessionDir: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  // Populated once known from pi's own get_state response (its own
  // sessionId/sessionFile, distinct from our supervisor-level `id`).
  piSessionId?: string;
  piSessionFile?: string;
  lastError?: string;
}

// A single buffered event for replay. `seq` is a strictly increasing
// per-session counter so a client can ask "give me everything after seq N"
// on reconnect (see GET /sessions/:id/events?since=N).
export interface BufferedEvent {
  seq: number;
  // "pi-event": a raw event line from pi's own RPC stdout (agent_start,
  // message_update, agent_end, etc. - see rpc.md). "supervisor": a
  // synthetic event we generate ourselves (status changes, errors).
  source: "pi-event" | "supervisor";
  timestamp: string;
  data: unknown;
}

export interface CreateSessionRequest {
  label?: string;
}

export interface SendMessageRequest {
  message: string;
  // Mirrors pi's own streamingBehavior for the `prompt` command (see
  // rpc.md `prompt`) - only relevant if the agent is already streaming.
  streamingBehavior?: "steer" | "followUp";
}
