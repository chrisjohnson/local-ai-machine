// Bespoke frontend for the pi-agent supervisor (M-032). Plain JS, no
// framework, no build step - the supervisor serves this directory
// statically (see server.ts STATIC_DIR). Talks to the supervisor's own
// HTTP+WS API (M-031), not to pi directly.
"use strict";

const state = {
  sessions: [],
  currentSessionId: null,
  ws: null,
  lastSeq: 0,
  // Track in-progress assistant/thinking text blocks by contentIndex so
  // streaming deltas append into the same DOM node instead of creating a
  // new bubble per delta (mirrors how a real chat UI handles
  // message_update events from rpc.md).
  streamingBlocks: new Map(),
};

const el = {
  viewList: document.getElementById("view-list"),
  viewSession: document.getElementById("view-session"),
  sessionList: document.getElementById("session-list"),
  listEmpty: document.getElementById("list-empty"),
  newSessionBtn: document.getElementById("new-session-btn"),
  backBtn: document.getElementById("back-btn"),
  sessionLabel: document.getElementById("session-label"),
  sessionStatus: document.getElementById("session-status"),
  transcript: document.getElementById("transcript"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("message-input"),
  sendBtn: document.getElementById("send-btn"),
};

function apiUrl(path) {
  return path;
}

function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `request failed: ${res.status}`);
  }
  return data;
}

function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

// ---- Session list view ----

async function loadSessions() {
  const { sessions } = await fetchJson(apiUrl("/api/sessions"));
  state.sessions = sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  renderSessionList();
}

function renderSessionList() {
  el.sessionList.innerHTML = "";
  el.listEmpty.classList.toggle("hidden", state.sessions.length > 0);
  for (const session of state.sessions) {
    const li = document.createElement("li");
    li.className = "session-item";
    li.innerHTML = `
      <div class="info">
        <div class="label"></div>
        <div class="meta"></div>
      </div>
      <span class="status-pill" data-status="${session.status}">${session.status}</span>
    `;
    li.querySelector(".label").textContent = session.label;
    li.querySelector(".meta").textContent = `updated ${formatRelativeTime(session.updatedAt)}`;
    li.addEventListener("click", () => openSession(session.id));
    el.sessionList.appendChild(li);
  }
}

async function createSession() {
  const label = prompt("Session name (optional):", "") || undefined;
  const { session } = await fetchJson(apiUrl("/api/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  await loadSessions();
  openSession(session.id);
}

// ---- Session detail / chat view ----

function showListView() {
  closeStream();
  state.currentSessionId = null;
  el.viewSession.classList.add("hidden");
  el.viewList.classList.remove("hidden");
  loadSessions().catch(showError);
}

async function openSession(id) {
  state.currentSessionId = id;
  state.lastSeq = 0;
  state.streamingBlocks.clear();
  el.transcript.innerHTML = "";
  el.viewList.classList.add("hidden");
  el.viewSession.classList.remove("hidden");

  const { session } = await fetchJson(apiUrl(`/api/sessions/${id}`));
  updateSessionHeader(session);

  // If the session has no live process (e.g. after a supervisor restart),
  // resume it so the composer works immediately without a separate step.
  if (session.status === "stopped") {
    await fetchJson(apiUrl(`/api/sessions/${id}/resume`), { method: "POST" }).catch(() => {});
  }

  openStream(id);
}

function updateSessionHeader(session) {
  el.sessionLabel.textContent = session.label;
  el.sessionStatus.textContent = session.status;
  el.sessionStatus.dataset.status = session.status;
}

function closeStream() {
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
}

function openStream(sessionId) {
  closeStream();
  const ws = new WebSocket(wsUrl(`/api/sessions/${sessionId}/stream?since=${state.lastSeq}`));
  state.ws = ws;
  ws.addEventListener("message", (ev) => {
    const event = JSON.parse(ev.data);
    if (event.seq <= state.lastSeq) return; // defensive: ignore stale replays
    state.lastSeq = event.seq;
    handleEvent(event);
  });
  ws.addEventListener("close", () => {
    // Auto-reconnect with backoff-free simple retry - this is the concrete
    // mechanism behind "reconnect later and pick up where you left off":
    // the browser tab can close/lose connectivity entirely and, on
    // reopening, this same code path replays everything missed via
    // ?since=<lastSeq>.
    if (state.currentSessionId === sessionId) {
      setTimeout(() => {
        if (state.currentSessionId === sessionId) openStream(sessionId);
      }, 1500);
    }
  });
}

function scrollToBottom() {
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function appendBubble(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  el.transcript.appendChild(div);
  scrollToBottom();
  return div;
}

function blockKey(contentIndex) {
  return `${state.currentSessionId}:${contentIndex}`;
}

function handleEvent(event) {
  const data = event.data;
  if (event.source === "supervisor") {
    if (data.type === "process_exit") {
      appendBubble("system", `process exited (code=${data.code}, signal=${data.signal})`);
    } else if (data.type === "history_message") {
      // Replayed from pi's own persisted session file (see
      // session-history.ts) - a past turn from before this live buffer
      // existed (supervisor restart, or resuming an idle session), not a
      // live streaming event. Render as a plain static bubble; it never
      // goes through the message_start/message_update state machine below,
      // which only applies to pi's live RPC stdout.
      const role = data.role === "user" ? "user" : data.role === "assistant" ? "assistant" : "system";
      const text = extractText(data.content);
      if (text) appendBubble(role, text);
    }
    return;
  }
  handlePiEvent(data);
}

function handlePiEvent(msg) {
  switch (msg.type) {
    case "message_start": {
      if (msg.message?.role === "user") {
        appendBubble("user", extractText(msg.message.content));
      }
      break;
    }
    case "message_update": {
      const evt = msg.assistantMessageEvent;
      if (!evt) break;
      if (evt.type === "text_start" || evt.type === "thinking_start") {
        const kind = evt.type === "thinking_start" ? "thinking" : "assistant";
        const bubble = appendBubble(kind, "");
        state.streamingBlocks.set(blockKey(evt.contentIndex), bubble);
      } else if (evt.type === "text_delta" || evt.type === "thinking_delta") {
        const bubble = state.streamingBlocks.get(blockKey(evt.contentIndex));
        if (bubble) {
          bubble.textContent += evt.delta;
          scrollToBottom();
        }
      } else if (evt.type === "toolcall_start") {
        const bubble = appendBubble("tool", "");
        state.streamingBlocks.set(blockKey(evt.contentIndex), bubble);
      } else if (evt.type === "toolcall_end") {
        const bubble = state.streamingBlocks.get(blockKey(evt.contentIndex));
        if (bubble) {
          bubble.textContent = `tool call: ${evt.toolCall.name}(${JSON.stringify(evt.toolCall.arguments)})`;
        }
      }
      break;
    }
    case "tool_execution_end": {
      appendBubble("tool", `${msg.toolName} → ${extractText(msg.result?.content) || "(no output)"}`);
      break;
    }
    case "agent_start":
      setStatusPill("running");
      break;
    case "agent_settled":
      setStatusPill("idle");
      break;
    default:
      break;
  }
}

function setStatusPill(status) {
  el.sessionStatus.textContent = status;
  el.sessionStatus.dataset.status = status;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function sendMessage(message) {
  if (!state.currentSessionId) return;
  await fetchJson(apiUrl(`/api/sessions/${state.currentSessionId}/messages`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

function showError(err) {
  console.error(err);
  appendBubble ? appendBubble("system", `error: ${err.message || err}`) : alert(err.message || err);
}

// ---- Wiring ----

el.newSessionBtn.addEventListener("click", () => createSession().catch(showError));
el.backBtn.addEventListener("click", showListView);

el.composer.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = el.messageInput.value.trim();
  if (!text) return;
  el.messageInput.value = "";
  el.messageInput.style.height = "auto";
  sendMessage(text).catch(showError);
});

// Auto-grow textarea, Enter-to-send / Shift+Enter for newline (works fine
// on mobile keyboards too - Enter still submits via the form's submit
// event unless Shift is held).
el.messageInput.addEventListener("input", () => {
  el.messageInput.style.height = "auto";
  el.messageInput.style.height = `${Math.min(el.messageInput.scrollHeight, 128)}px`;
});
el.messageInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    el.composer.requestSubmit();
  }
});

loadSessions().catch(showError);
// Poll the list view for status changes while it's visible (cheap - a
// handful of sessions, not hundreds) so status pills update even when
// not actively viewing a session's own WS stream.
setInterval(() => {
  if (!el.viewList.classList.contains("hidden")) {
    loadSessions().catch(() => {});
  }
}, 5000);
