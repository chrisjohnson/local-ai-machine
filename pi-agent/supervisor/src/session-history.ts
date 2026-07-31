// Reconstructs a session's prior transcript from pi's own persisted
// --session-dir *.jsonl files, so a freshly-created `live` entry (on
// supervisor restart, or on resuming a session that's been idle since the
// last restart) starts seeded with real history instead of blank.
//
// This exists because the supervisor's per-session event buffer
// (Supervisor.live.events) is in-memory only and reset on every new
// `spawnFor` — it was never wired to replay what pi itself already
// persisted to disk. The model's own context recall still worked without
// this (pi reloads its own history internally when given the same
// --session-dir), but nothing redisplayed that history in the UI. Found
// by direct inspection after the fact, not caught by M-034's restart test
// (which checked model recall, not UI transcript replay — a real gap in
// that test's coverage).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BufferedEvent } from "./types.js";

interface PersistedContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface PersistedMessageLine {
  type: "message";
  id: string;
  timestamp: string;
  message: {
    role: string;
    content: string | PersistedContentBlock[];
  };
}

function isMessageLine(obj: unknown): obj is PersistedMessageLine {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as { type?: unknown }).type === "message" &&
    typeof (obj as { message?: unknown }).message === "object"
  );
}

// pi writes one new timestamped *.jsonl file per invocation within a
// session dir; filenames are ISO-timestamp-prefixed so lexical sort is
// chronological sort. Concatenating every file's `message` lines in that
// order reconstructs the full history across respawns of the same session.
export function loadHistoryMessages(sessionDir: string): PersistedMessageLine[] {
  let files: string[];
  try {
    files = readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
  } catch {
    return [];
  }

  const messages: PersistedMessageLine[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(sessionDir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (isMessageLine(parsed)) messages.push(parsed);
    }
  }
  return messages;
}

// Converts persisted message lines into the same BufferedEvent shape the
// supervisor already streams to clients, tagged as `history_message` so
// the frontend can render them as static past turns (see app.js) rather
// than trying to run them through the live message_start/message_update
// state machine, which only applies to pi's live RPC stdout stream.
export function historyToBufferedEvents(messages: PersistedMessageLine[], startSeq: number): BufferedEvent[] {
  return messages.map((m, i) => ({
    seq: startSeq + i,
    source: "supervisor" as const,
    timestamp: m.timestamp,
    data: {
      type: "history_message",
      role: m.message.role,
      content: m.message.content,
    },
  }));
}
