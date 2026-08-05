/**
 * listView.ts: main page — a responsive, live-updating GRID of condensed
 * run cards (spec section 3), replacing the old plain vertical list.
 * Clicking a card still navigates to `#/runs/:adwId` (DetailView),
 * unchanged in spirit.
 *
 * ── polling architecture / performance decisions ────────────────────────
 * ONE poll of `/api/runs` every `POLL_INTERVAL_MS` drives the whole grid's
 * summary data (unchanged pattern from the old list view) — this alone is
 * enough to update status pills, sort order, and dim/tint a card the moment
 * it transitions to success/fail.
 *
 * Each card whose `status === "running"` additionally gets its OWN
 * `RunningCardController`, which polls `/api/runs/:adwId` (steps + status)
 * on its own short interval — bounded to exactly the currently-running
 * subset, never one poll per card across the whole grid. A run's mini-Gantt
 * needs each Step's `status`/`startedAt`/`endedAt`, which only changes via
 * the `phases` table (not the `events` stream) — so `/api/runs/:adwId` is
 * the right endpoint here, not `/api/runs/:adwId/events?since=` (that
 * cursor-poll is what DetailView uses for the nested tool-call list, which
 * the condensed grid card deliberately does NOT show — the spec asks for a
 * mini TIMELINE here, not the full nested-event drill-down, which stays on
 * the detail page).
 *
 * ── render diffing strategy ──────────────────────────────────────────────
 * Chosen approach, documented per the spec's explicit ask: on every
 * `/api/runs` tick, the grid's outer HTML (card shells + `run-grid`
 * container) is rebuilt via one `innerHTML` write — but a completed
 * (success/fail) card's own inner content is a static string produced once
 * and cached (`finishedCardHtml`), so re-running the outer render is cheap
 * string concatenation, not re-computing Gantt layouts or role lookups for
 * cards that can no longer change. A RUNNING card's inner HTML (including
 * its mini-Gantt) is only recomputed by its OWN `RunningCardController` on
 * ITS OWN poll tick (via a targeted `innerHTML` write scoped to that one
 * card element), never by the outer grid refresh — so a grid of e.g. 30
 * finished + 3 running cards only ever does real work for those 3 on their
 * own cadence, not 30 on every outer tick. This was judged simpler and
 * plenty fast for the realistic scale here (a handful to a few dozen
 * concurrent/recent runs) versus a full VDOM-style keyed diff, which would
 * add real complexity for a page that, per the spec, must stay CPU-light —
 * the extra diffing machinery itself has a cost. If real-world card counts
 * grow into the hundreds, a keyed/windowed approach would be the next step
 * (see also the "cap live mini-Gantt cards" fallback the spec explicitly
 * allows, applied below via `MAX_LIVE_MINI_GANTT_CARDS`).
 *
 * Animations (the pulsing glow on running cards) are pure CSS
 * `@keyframes`/class toggles (`style.css`'s `.run-card-running`) — never
 * JS-driven inline-style-per-frame or `requestAnimationFrame`.
 */

import { fetchRunDetail, fetchRuns, type RunSummary, type Step } from "./api";
import { escapeHtml, formatCost, formatDateTime, formatDuration, formatTokens } from "./format";
import { miniGanttHtml } from "./miniGantt";
import { runTitle } from "./runTitle";
import { sortRuns } from "./sortRuns";

const POLL_INTERVAL_MS = 4000;
/** Running cards poll their own Steps a bit faster than the outer grid summary poll, so the mini-Gantt visibly grows/updates while a run is active. */
const RUNNING_CARD_POLL_INTERVAL_MS = 2500;

/**
 * Explicit, documented performance fallback (spec section 3: "pagination or
 * a similar fallback is acceptable if the full real-time-grid approach
 * doesn't perform well"). Tested locally against ~24 seeded runs (several
 * running) via headless Chrome — CPU stayed low and rendering felt smooth
 * at that scale, so this cap is set generously above what was actually
 * tested, as a circuit breaker against a pathological number of
 * simultaneously-running Workflow Runs rather than a routinely-hit limit.
 * Cards beyond this count still show full summary info (status, timing,
 * tokens) — they just fall back to a static "N Steps, no live preview"
 * notice instead of a live per-card Gantt+poll controller.
 */
const MAX_LIVE_MINI_GANTT_CARDS = 24;

function statusPill(status: string | null): string {
  const cls = status ? `status-${status}` : "status-queued";
  return `<span class="status-pill ${cls}"><span class="status-dot"></span>${escapeHtml(status ?? "unknown")}</span>`;
}

function runCardStatusClass(status: string | null): string {
  if (status === "running") return "run-card-running";
  if (status === "success") return "run-card-success";
  if (status === "fail") return "run-card-fail";
  return "";
}

function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

function runMetaHtml(run: RunSummary, nowMs: number): string {
  return `
    <div class="run-meta">
      <span>started ${formatDateTime(run.startedAt)}</span>
      <span>duration ${formatDuration(run.startedAt, run.endedAt, nowMs)}</span>
      <span>${formatTokens(run.totalTokens)} tokens</span>
      <span>${formatCost(run.totalCost)}</span>
      ${run.projectCwd ? `<span title="${escapeHtml(run.projectCwd)}">${escapeHtml(shortenPath(run.projectCwd))}</span>` : ""}
    </div>
  `;
}

/** Card shell shared by both running and finished cards — everything except the mini-Gantt body, which callers fill in (live for running, static/omitted for finished). */
function runCardShellOpenHtml(run: RunSummary, nowMs: number): string {
  const title = runTitle(run);
  return `
    <div class="run-card-top">
      <div class="run-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      ${statusPill(run.status)}
    </div>
    ${runMetaHtml(run, nowMs)}
  `;
}

/**
 * Fully static HTML for a card that can no longer change (success/fail) —
 * computed once, then reused verbatim on every outer grid re-render until
 * the underlying run data itself changes (it won't, once terminal).
 *
 * Includes the mini-Gantt: `run.steps` now arrives pre-batched on every
 * `/api/runs` list response (`server.ts`'s `runsToApi`), so ALL cards show
 * their timeline inline, not just running ones — found missing in review
 * against the reference screenshot (M-090 follow-up, 2026-08-05): a
 * finished card previously showed only the shell (title/status/meta), no
 * timeline at all, until clicked through to the detail page.
 */
function finishedCardHtml(run: RunSummary, nowMs: number): string {
  const gantt = `<div class="mini-gantt">${miniGanttHtml(run.steps, nowMs)}</div>`;
  return `${runCardShellOpenHtml(run, nowMs)}${gantt}`;
}

function cardOuterHtml(run: RunSummary, innerHtml: string): string {
  const cls = runCardStatusClass(run.status);
  return `
    <a class="run-card ${cls}" href="#/runs/${encodeURIComponent(run.adwId)}" data-adw-id="${escapeHtml(run.adwId)}">
      ${innerHtml}
    </a>
  `;
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

/**
 * Owns exactly one currently-`running` card's own poll cycle
 * (`/api/runs/:adwId`, steps + status) and re-renders just that card's DOM
 * node in place — never touches the rest of the grid.
 *
 * IMPORTANT: `.innerHTML =` on the OUTER grid container (`ListView.refresh`,
 * every `POLL_INTERVAL_MS`) always parses and replaces the ENTIRE subtree —
 * browsers never diff/reuse existing nodes on an innerHTML write, even when
 * the resulting markup is textually identical. That means the placeholder
 * `<a data-live-card="1">` element THIS controller was originally bound to
 * gets detached from the document on every single outer tick, including
 * ticks where this exact run is still running and "unchanged" from the
 * controller's perspective. A first version of this code kept the same
 * controller instance alive but never re-pointed `cardEl` at the fresh
 * placeholder the next outer render created — confirmed live (headless
 * Chrome, `--virtual-time-budget` spanning 3 outer ticks): the card
 * rendered correctly once, then went back to a completely empty
 * placeholder forever, while the orphaned controller kept ticking against
 * a detached node no one could see. `rebindCardEl` is `ListView`'s fix:
 * called on EVERY outer tick for every still-live controller (not just
 * newly-created ones), it retargets `cardEl` to the fresh node and
 * immediately re-renders into it so there's no visible blank gap, while
 * leaving the controller's own poll interval running uninterrupted (no
 * wasted extra `/api/runs/:adwId` calls from tearing down and recreating).
 */
class RunningCardController {
  private cardEl: HTMLElement;
  private adwId: string;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private steps: Step[] = [];
  private latestRun: RunSummary;

  constructor(cardEl: HTMLElement, run: RunSummary) {
    this.cardEl = cardEl;
    this.adwId = run.adwId;
    this.latestRun = run;
    // `run.steps` already arrived batched on the outer /api/runs poll — seed
    // with it so the first paint shows the real (if slightly stale) Gantt
    // immediately, instead of an empty "no Steps yet" flash while the first
    // per-card `/api/runs/:adwId` fetch is still in flight.
    this.steps = run.steps;
  }

  start(): void {
    this.renderCurrent();
    void this.refresh();
    this.pollHandle = setInterval(() => {
      void this.refresh();
    }, RUNNING_CARD_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.disposed = true;
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  /** Re-points this controller at a freshly-rendered DOM node (see class doc comment) and immediately repaints it — the outer grid re-creates every card element on each of ITS OWN poll ticks, so a still-running controller must be re-bound every time, not just once at creation. */
  rebindCardEl(cardEl: HTMLElement): void {
    this.cardEl = cardEl;
    this.renderCurrent();
  }

  private async refresh(): Promise<void> {
    try {
      const detail = await fetchRunDetail(this.adwId);
      if (this.disposed) return;
      this.latestRun = detail.run;
      this.steps = detail.steps;
    } catch {
      // best-effort — a transient failure just skips this tick, the shell
      // (status pill/meta) still reflects the last-known-good outer grid poll
      return;
    }
    if (this.disposed) return;
    this.renderCurrent();
  }

  private renderCurrent(): void {
    const nowMs = Date.now();
    const shell = runCardShellOpenHtml(this.latestRun, nowMs);
    const gantt = `<div class="mini-gantt">${miniGanttHtml(this.steps, nowMs)}</div>`;
    this.cardEl.className = `run-card ${runCardStatusClass(this.latestRun.status)}`;
    this.cardEl.innerHTML = `${shell}${gantt}`;
  }
}

export class ListView {
  private container: HTMLElement;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  /** Selected project filter (`projectRoot` match), or `null` for "All projects" — owned by `main.ts`'s hash router, mirrored here so polling refreshes can keep using it without re-parsing the hash every tick. */
  private selectedProject: string | null;
  /** Distinct known `projectRoot` values, derived once from an unfiltered fetch, populates the `<select>`'s options regardless of which project is currently selected. */
  private allProjects: string[] = [];
  /** One controller per currently-running card, keyed by adwId — torn down/rebuilt whenever the running set changes across an outer poll tick. */
  private runningControllers: Map<string, RunningCardController> = new Map();

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
    for (const controller of this.runningControllers.values()) controller.stop();
    this.runningControllers.clear();
  }

  private async loadProjectOptions(): Promise<void> {
    try {
      const allRuns = await fetchRuns();
      const distinct = new Set<string>();
      for (const r of allRuns) {
        // projectRoot (worktree-suffix-stripped), NOT projectCwd — every
        // run's projectCwd is its own unique worktree path (M-071), so
        // grouping by it would put every single run in its own "project".
        if (r.projectRoot) distinct.add(r.projectRoot);
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
      for (const controller of this.runningControllers.values()) controller.stop();
      this.runningControllers.clear();
      this.container.innerHTML = `<div class="error-banner">Failed to load runs: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}</div>`;
      return;
    }
    if (this.disposed) return;

    const nowMs = Date.now();
    const sorted = sortRuns(runs);
    const filterBar = filterBarHtml(this.allProjects, this.selectedProject);

    if (sorted.length === 0) {
      for (const controller of this.runningControllers.values()) controller.stop();
      this.runningControllers.clear();
      const emptyHtml = `<div class="empty-state">${
        this.selectedProject ? "No Workflow Runs recorded for this project." : "No Workflow Runs recorded yet."
      }</div>`;
      this.container.innerHTML = `${filterBar}${emptyHtml}`;
      this.wireFilterSelect();
      return;
    }

    // Which currently-visible runs are eligible for a live mini-Gantt
    // controller — running status, capped at MAX_LIVE_MINI_GANTT_CARDS
    // (see that const's doc comment for the fallback rationale). The cap
    // applies in current sort order, i.e. the oldest-started running runs
    // (already first per sortRuns) win the live slots.
    const liveEligibleIds = new Set(
      sorted
        .filter((r) => r.status === "running")
        .slice(0, MAX_LIVE_MINI_GANTT_CARDS)
        .map((r) => r.adwId),
    );

    this.container.innerHTML = `${filterBar}<div class="run-grid">${sorted
      .map((run) => {
        if (liveEligibleIds.has(run.adwId)) {
          // Placeholder shell — the RunningCardController wired up below
          // fills this in immediately and owns it from then on.
          return `<a class="run-card run-card-running" href="#/runs/${encodeURIComponent(run.adwId)}" data-adw-id="${escapeHtml(run.adwId)}" data-live-card="1"></a>`;
        }
        if (run.status === "running") {
          // Over the live cap — still a real running card (status pill,
          // pulsing glow) with its Gantt from the last outer-grid poll
          // (`run.steps`, batched — see finishedCardHtml), it just doesn't
          // get its OWN faster per-card poll cycle on top of that.
          return cardOuterHtml(run, `${finishedCardHtml(run, nowMs)}<div class="mini-gantt-note">not live-updating (too many concurrent runs)</div>`);
        }
        return cardOuterHtml(run, finishedCardHtml(run, nowMs));
      })
      .join("")}</div>`;

    this.wireFilterSelect();

    // Tear down controllers for runs no longer running/visible. For every
    // still-live run, REBIND the existing controller (if any) to the fresh
    // DOM node this very innerHTML write just created — never skip an
    // already-existing controller silently, or it keeps updating a node
    // that's no longer attached to the document (see RunningCardController's
    // class doc comment for the real bug this fixes, confirmed live). Only
    // construct a genuinely NEW controller (and start its own independent
    // poll cycle) for a run that wasn't already being tracked.
    const stillLive = new Set(liveEligibleIds);
    for (const [adwId, controller] of this.runningControllers) {
      if (!stillLive.has(adwId)) {
        controller.stop();
        this.runningControllers.delete(adwId);
      }
    }
    for (const run of sorted) {
      if (!liveEligibleIds.has(run.adwId)) continue;
      const cardEl = this.container.querySelector<HTMLElement>(`[data-adw-id="${cssEscape(run.adwId)}"][data-live-card="1"]`);
      if (!cardEl) continue;
      const existing = this.runningControllers.get(run.adwId);
      if (existing) {
        existing.rebindCardEl(cardEl);
        continue;
      }
      const controller = new RunningCardController(cardEl, run);
      this.runningControllers.set(run.adwId, controller);
      controller.start();
    }
  }

  private wireFilterSelect(): void {
    const select = this.container.querySelector<HTMLSelectElement>("#project-filter");
    select?.addEventListener("change", () => {
      this.onFilterChange(select.value);
    });
  }
}

/** Minimal `CSS.escape` fallback for the `data-adw-id` attribute selector above — adwIds are plain identifiers in practice, but this avoids relying on a DOM global that may not exist in every test/runtime context. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
