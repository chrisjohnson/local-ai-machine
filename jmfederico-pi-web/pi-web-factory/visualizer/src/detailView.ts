/**
 * detailView.ts: one Workflow Run's Gantt-style Step timeline (M-077 plan
 * items 4-6). Idle/paused gaps between Steps are compressed to a fixed
 * width (gantt.ts's `computeGanttLayout`) — only each Step's own real
 * duration is drawn proportionally.
 *
 * While the run's status is "running", polls `/api/runs/:adwId/events?since=`
 * to (a) discover which Step is currently active (an events-derived signal,
 * more precise than just "the phases row with status=running" alone — an
 * agent_start/tool_call/log event arriving for a phase is direct evidence of
 * live activity) and (b) collect `tool_call` events nested (via `parent_id`)
 * under that Step, rendered as a simple timestamped list in the Step's
 * expanded detail panel.
 */

import { fetchEventsSince, fetchRunDetail, type EventRecord, type RunDetail, type Step } from "./api";
import { computeGanttLayout, type GanttLayout } from "./gantt";
import {
  escapeHtml,
  formatClockTime,
  formatCost,
  formatDateTime,
  formatDuration,
  formatMs,
  formatTokens,
} from "./format";
import { roleColor } from "./roleColor";
import { stepBarStyle } from "./stepBarStyle";
import { runTitle } from "./runTitle";

const RUN_POLL_INTERVAL_MS = 3000;
const EVENTS_POLL_INTERVAL_MS = 2000;
/** A Step counts as "actively live" if an event touched it within this window — keeps the pulse honest (not stuck highlighted forever off stale data). */
const ACTIVITY_WINDOW_MS = 15000;

/** Small pill badge for a Step's Role, colored via `roleColor.ts` — the same mapping used by the grid's mini-Gantt, so a Role reads consistently everywhere it appears. */
function roleBadgeHtml(role: string | null): string {
  if (!role) return "";
  const tokens = roleColor(role);
  return `<span class="role-badge" style="color:${tokens.color};background:${tokens.surface}">${escapeHtml(role)}</span>`;
}

export class DetailView {
  private container: HTMLElement;
  private adwId: string;
  private runPollHandle: ReturnType<typeof setInterval> | null = null;
  private eventsPollHandle: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  private detail: RunDetail | null = null;
  private events: EventRecord[] = [];
  private eventsCursor = 0;
  private lastEventAtByPhase: Map<string, number> = new Map();
  private expandedPhaseId: string | null = null;

  constructor(container: HTMLElement, adwId: string) {
    this.container = container;
    this.adwId = adwId;
  }

  async start(): Promise<void> {
    await this.refreshRun();
    this.runPollHandle = setInterval(() => {
      void this.refreshRun();
    }, RUN_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.disposed = true;
    if (this.runPollHandle) clearInterval(this.runPollHandle);
    if (this.eventsPollHandle) clearInterval(this.eventsPollHandle);
  }

  private async refreshRun(): Promise<void> {
    try {
      this.detail = await fetchRunDetail(this.adwId);
    } catch (error) {
      if (this.disposed) return;
      this.container.innerHTML = `<div class="error-banner">Failed to load run ${escapeHtml(this.adwId)}: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}</div>`;
      return;
    }
    if (this.disposed) return;

    const isRunning = this.detail.run.status === "running";
    if (isRunning && !this.eventsPollHandle) {
      this.eventsPollHandle = setInterval(() => {
        void this.refreshEvents();
      }, EVENTS_POLL_INTERVAL_MS);
      void this.refreshEvents();
    } else if (!isRunning && this.eventsPollHandle) {
      // Run finished — stop polling events, one final fetch to catch any
      // trailing events already written before the terminal status landed.
      clearInterval(this.eventsPollHandle);
      this.eventsPollHandle = null;
      void this.refreshEvents();
    }

    this.render();
  }

  private async refreshEvents(): Promise<void> {
    let newEvents: EventRecord[];
    try {
      newEvents = await fetchEventsSince(this.adwId, this.eventsCursor);
    } catch {
      return; // events polling is best-effort — a transient failure shouldn't blank the page
    }
    if (this.disposed || newEvents.length === 0) return;

    for (const evt of newEvents) {
      this.events.push(evt);
      this.eventsCursor = Math.max(this.eventsCursor, evt.rowid);
      if (evt.phaseId) {
        const tsMs = evt.endedAt ? Date.parse(evt.endedAt) : evt.startedAt ? Date.parse(evt.startedAt) : Date.now();
        const prev = this.lastEventAtByPhase.get(evt.phaseId) ?? 0;
        this.lastEventAtByPhase.set(evt.phaseId, Math.max(prev, tsMs));
      }
    }
    this.render();
  }

  private activePhaseIds(nowMs: number): Set<string> {
    const active = new Set<string>();
    if (!this.detail || this.detail.run.status !== "running") return active;
    for (const step of this.detail.steps) {
      if (step.status === "running") active.add(step.phaseId);
    }
    for (const [phaseId, lastMs] of this.lastEventAtByPhase) {
      if (nowMs - lastMs <= ACTIVITY_WINDOW_MS) active.add(phaseId);
    }
    return active;
  }

  private toolCallsFor(phaseId: string): EventRecord[] {
    return this.events.filter((e) => e.phaseId === phaseId && e.type === "tool_call");
  }

  private otherEventsFor(phaseId: string): EventRecord[] {
    return this.events.filter((e) => e.phaseId === phaseId && e.type !== "tool_call" && e.type !== "phase_start" && e.type !== "phase_end");
  }

  private render(): void {
    if (!this.detail) return;
    const { run, steps } = this.detail;
    const nowMs = Date.now();
    const layout = computeGanttLayout(steps, nowMs);
    const active = this.activePhaseIds(nowMs);

    const title = runTitle(run);
    const isLive = run.status === "running";

    this.container.innerHTML = `
      <a class="back-link" href="#/">&larr; all runs</a>
      <div class="run-detail-header">
        <div class="run-card-top">
          <div class="run-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <span class="status-pill status-${run.status ?? "queued"}"><span class="status-dot"></span>${escapeHtml(run.status ?? "unknown")}</span>
        </div>
        <div class="run-meta">
          <span>adwId ${escapeHtml(run.adwId)}</span>
          <span>started ${formatDateTime(run.startedAt)}</span>
          <span>duration ${formatDuration(run.startedAt, run.endedAt, nowMs)}</span>
          <span>${formatTokens(run.totalTokens)} tokens</span>
          <span>${formatCost(run.totalCost)}</span>
          ${run.projectCwd ? `<span title="${escapeHtml(run.projectCwd)}">${escapeHtml(run.projectCwd)}</span>` : ""}
          ${isLive ? `<span class="live-indicator"><span class="status-dot"></span>LIVE — polling for updates</span>` : ""}
        </div>
        ${run.request ? `<div class="run-prompt"><h3>initial prompt</h3><pre class="run-prompt-text">${escapeHtml(run.request)}</pre></div>` : ""}
      </div>

      <div class="timeline-wrap">
        <h2>Steps</h2>
        <div class="timeline-note">Each Step's bar is drawn to scale (${String(8)}px/s, min width ${String(24)}px). Idle/paused time between Steps is compressed to a fixed gap and NOT drawn to scale.</div>
        <div class="timeline-track" style="width:${String(layout.totalWidth)}px">
          ${layout.steps.map((sl) => this.stepRowHtml(sl.step, sl, active)).join("")}
        </div>
        ${this.expandedPhaseId ? this.stepDetailHtml(this.expandedPhaseId, active) : ""}
      </div>
    `;

    this.container.querySelectorAll<HTMLElement>("[data-step-toggle]").forEach((el) => {
      el.addEventListener("click", () => {
        const phaseId = el.dataset["stepToggle"];
        if (!phaseId) return;
        this.expandedPhaseId = this.expandedPhaseId === phaseId ? null : phaseId;
        this.render();
      });
    });
  }

  private stepRowHtml(step: Step, sl: { x: number; width: number }, active: Set<string>): string {
    // `active` (events-derived "truly live right now") takes precedence over
    // the phases row's own `status` for the pulsing-glow treatment — a Step
    // can sit at status=running while actually stalled; `stepBarStyle`'s
    // "running" branch is reserved for genuine live activity here.
    const isActive = active.has(step.phaseId);
    const bar = stepBarStyle(step.role, isActive ? "running" : step.status);
    const label = step.name ?? step.phaseId;
    return `
      <div class="timeline-row">
        <span class="step-label" style="left:${String(sl.x)}px">${escapeHtml(label)}${roleBadgeHtml(step.role)}</span>
        <div class="step-bar${bar.isActive ? " step-active" : ""}"
             style="left:${String(sl.x)}px; width:${String(sl.width)}px; ${bar.style}"
             data-step-toggle="${escapeHtml(step.phaseId)}"
             title="${escapeHtml(label)} — ${escapeHtml(step.status ?? "unknown")}">
          ${escapeHtml(label)}
        </div>
      </div>
    `;
  }

  private stepDetailHtml(phaseId: string, active: Set<string>): string {
    const step = this.detail?.steps.find((s) => s.phaseId === phaseId);
    if (!step) return "";
    const nowMs = Date.now();
    const toolCalls = this.toolCallsFor(phaseId);
    const others = this.otherEventsFor(phaseId);
    const isActive = active.has(phaseId);

    return `
      <div class="step-detail-panel">
        <h3>${escapeHtml(step.name ?? step.phaseId)} ${roleBadgeHtml(step.role)} ${isActive ? `<span class="live-indicator"><span class="status-dot"></span>active now</span>` : ""}</h3>
        <dl class="step-detail-grid">
          <dt>role</dt><dd>${step.role ? roleBadgeHtml(step.role) : "—"}</dd>
          <dt>kind</dt><dd>${escapeHtml(step.kind ?? "—")}</dd>
          <dt>status</dt><dd>${escapeHtml(step.status ?? "unknown")}</dd>
          <dt>attempt</dt><dd>${String(step.attempt)}${step.retries ? ` (retries: ${String(step.retries)})` : ""}</dd>
          <dt>duration</dt><dd>${formatDuration(step.startedAt, step.endedAt, nowMs)}</dd>
          <dt>tokens</dt><dd>in ${formatTokens(step.inputTokens)} / out ${formatTokens(step.outputTokens)} / cached ${formatTokens(step.cachedTokens)}</dd>
          ${step.outputSummary ? `<dt>summary</dt><dd>${escapeHtml(step.outputSummary)}</dd>` : ""}
          ${step.error ? `<dt>error</dt><dd>${escapeHtml(step.error)}</dd>` : ""}
        </dl>
        ${
          toolCalls.length > 0 || others.length > 0
            ? `<div><strong style="font-size:12.5px;color:var(--text-dim)">nested events (tool calls, etc. — via events.parent_id)</strong>
                <ul class="tool-call-list">
                  ${[...toolCalls, ...others]
                    .sort((a, b) => a.rowid - b.rowid)
                    .map((e) => this.eventLineHtml(e))
                    .join("")}
                </ul>
              </div>`
            : `<div style="color:var(--text-dim);font-size:12px">${step.status === "running" ? "no tool-call events observed yet" : "no nested events recorded for this Step"}</div>`
        }
      </div>
    `;
  }

  private eventLineHtml(e: EventRecord): string {
    const durationTxt = e.startedAt && e.endedAt ? ` (${formatMs(Math.max(0, Date.parse(e.endedAt) - Date.parse(e.startedAt)))})` : "";
    const payloadTxt = e.payload && typeof e.payload === "object" ? JSON.stringify(e.payload) : String(e.payload ?? "");
    return `
      <li>
        <span class="tool-call-time">${formatClockTime(e.startedAt)}</span>
        <span class="tool-call-name">${escapeHtml(e.type ?? "event")}${e.name ? `:${escapeHtml(e.name)}` : ""}</span>
        <span class="tool-call-payload" title="${escapeHtml(payloadTxt)}">${escapeHtml(payloadTxt)}${durationTxt}</span>
      </li>
    `;
  }
}

export type { GanttLayout };
