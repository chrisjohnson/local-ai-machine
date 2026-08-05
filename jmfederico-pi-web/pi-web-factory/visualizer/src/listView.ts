/**
 * listView.ts: renders the list of Workflow Runs, one card per run, polling
 * `/api/runs` every few seconds so new/updated runs show up without a manual
 * refresh (M-077 plan item 3).
 */

import { fetchRuns, type RunSummary } from "./api";
import { escapeHtml, formatCost, formatDateTime, formatDuration, formatTokens } from "./format";

const POLL_INTERVAL_MS = 4000;

function statusPill(status: string | null): string {
  const cls = status ? `status-${status}` : "status-queued";
  return `<span class="status-pill ${cls}"><span class="status-dot"></span>${escapeHtml(status ?? "unknown")}</span>`;
}

function runCardHtml(run: RunSummary, nowMs: number): string {
  const title = run.title ?? run.adwId;
  return `
    <a class="run-card" href="#/runs/${encodeURIComponent(run.adwId)}" data-adw-id="${escapeHtml(run.adwId)}">
      <div class="run-card-top">
        <div class="run-title">${escapeHtml(title)}</div>
        ${statusPill(run.status)}
      </div>
      <div class="run-meta">
        <span>started ${formatDateTime(run.startedAt)}</span>
        <span>duration ${formatDuration(run.startedAt, run.endedAt, nowMs)}</span>
        <span>${formatTokens(run.totalTokens)} tokens</span>
        <span>${formatCost(run.totalCost)}</span>
        ${run.projectCwd ? `<span title="${escapeHtml(run.projectCwd)}">${escapeHtml(shortenPath(run.projectCwd))}</span>` : ""}
      </div>
    </a>
  `;
}

function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

export class ListView {
  private container: HTMLElement;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.pollHandle = setInterval(() => {
      void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    this.disposed = true;
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  private async refresh(): Promise<void> {
    let runs: RunSummary[];
    try {
      runs = await fetchRuns();
    } catch (error) {
      if (this.disposed) return;
      this.container.innerHTML = `<div class="error-banner">Failed to load runs: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}</div>`;
      return;
    }
    if (this.disposed) return;

    const nowMs = Date.now();
    if (runs.length === 0) {
      this.container.innerHTML = `<div class="empty-state">No Workflow Runs recorded yet.</div>`;
      return;
    }
    this.container.innerHTML = `<div class="run-list">${runs.map((r) => runCardHtml(r, nowMs)).join("")}</div>`;
  }
}
