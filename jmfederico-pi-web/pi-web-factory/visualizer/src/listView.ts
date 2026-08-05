/**
 * listView.ts: renders the list of Workflow Runs, one card per run, polling
 * `/api/runs` every few seconds so new/updated runs show up without a manual
 * refresh (M-077 plan item 3).
 *
 * ── project filter ──────────────────────────────────────────────────────
 * A `<select>` above the list narrows the visible runs to one `projectCwd`
 * (server-side, via `/api/runs?project=<cwd>` — see `server.ts`). The
 * filter's known options are derived client-side from an always-unfiltered
 * fetch (`fetchRuns()` with no `project` arg, kept in `allProjects`) rather
 * than a dedicated `/api/projects` endpoint (see `server.ts`'s doc comment
 * on `/api/runs` for the reasoning) — this runs once on `start()`, not on
 * every poll tick, since the set of known projects changes far less often
 * than run status does and re-deriving it every 4s would just be wasted work.
 *
 * The selected filter is owned by `main.ts`'s hash router (`#/?project=<cwd>`),
 * not local component state — `main.ts` passes the initial value in via the
 * constructor, and this view writes back through `location.hash` on change
 * (triggering a re-route) rather than keeping its own source of truth, so a
 * filtered view is always linkable/bookmarkable/reload-safe. The poll cycle
 * only ever re-fetches the currently selected project's runs, so the filter
 * naturally survives polling refreshes without any extra bookkeeping.
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

function filterBarHtml(allProjects: string[], selected: string | null): string {
  const options = [
    `<option value=""${selected ? "" : " selected"}>All projects</option>`,
    ...allProjects.map(
      (p) => `<option value="${escapeHtml(p)}"${p === selected ? " selected" : ""}>${escapeHtml(shortenPath(p))}</option>`,
    ),
  ].join("");
  return `
    <div class="run-filter-bar">
      <label for="project-filter">Project</label>
      <select id="project-filter" class="project-filter-select">${options}</select>
    </div>
  `;
}

export class ListView {
  private container: HTMLElement;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  /** Selected project filter (`projectCwd` exact match), or `null` for "All projects" — owned by `main.ts`'s hash router, mirrored here so polling refreshes can keep using it without re-parsing the hash every tick. */
  private selectedProject: string | null;
  /** Distinct known `projectCwd` values, derived once from an unfiltered fetch (see module doc comment) — populates the `<select>`'s options regardless of which project is currently selected. */
  private allProjects: string[] = [];

  constructor(container: HTMLElement, initialProject: string | null = null) {
    this.container = container;
    this.selectedProject = initialProject;
  }

  async start(): Promise<void> {
    await this.loadProjectOptions();
    await this.refresh();
    this.pollHandle = setInterval(() => {
      void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    this.disposed = true;
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  private async loadProjectOptions(): Promise<void> {
    try {
      const allRuns = await fetchRuns();
      const distinct = new Set<string>();
      for (const r of allRuns) {
        if (r.projectCwd) distinct.add(r.projectCwd);
      }
      this.allProjects = [...distinct].sort();
    } catch {
      // best-effort — if this fails, the filter bar just shows "All projects"
      // only; the main refresh() below will surface any real fetch problem.
      this.allProjects = [];
    }
  }

  private onFilterChange(value: string): void {
    // Write the new selection into the URL hash (not local state) so
    // `main.ts`'s router owns it — reload/bookmark/back-button all keep
    // working, and this view is simply re-constructed with the new value.
    window.location.hash = value ? `#/?project=${encodeURIComponent(value)}` : "#/";
  }

  private async refresh(): Promise<void> {
    let runs: RunSummary[];
    try {
      runs = await fetchRuns(this.selectedProject);
    } catch (error) {
      if (this.disposed) return;
      this.container.innerHTML = `<div class="error-banner">Failed to load runs: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}</div>`;
      return;
    }
    if (this.disposed) return;

    const nowMs = Date.now();
    const filterBar = filterBarHtml(this.allProjects, this.selectedProject);
    const listHtml =
      runs.length === 0
        ? `<div class="empty-state">${
            this.selectedProject ? "No Workflow Runs recorded for this project." : "No Workflow Runs recorded yet."
          }</div>`
        : `<div class="run-list">${runs.map((r) => runCardHtml(r, nowMs)).join("")}</div>`;

    this.container.innerHTML = `${filterBar}${listHtml}`;

    const select = this.container.querySelector<HTMLSelectElement>("#project-filter");
    select?.addEventListener("change", () => {
      this.onFilterChange(select.value);
    });
  }
}
