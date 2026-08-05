/**
 * main.ts: tiny hash-router entrypoint. Two routes:
 *   `#/`             -> ListView (all Workflow Runs)
 *   `#/runs/:adwId`  -> DetailView (one run's Gantt timeline)
 *
 * A hash router (not the History API) keeps this genuinely dependency-free —
 * no server-side route fallback needed, `Bun.serve`'s single `"/"` HTML
 * route is the only page ever served, and the hash never leaves the client.
 */

import { DetailView } from "./detailView";
import { ListView } from "./listView";

const appEl = document.getElementById("app");
if (!appEl) throw new Error("missing #app root element");

let currentView: { stop(): void } | null = null;

function renderHeader(): string {
  return `
    <header class="top-bar">
      <div>
        <h1>pi-web-factory</h1>
        <div class="subtitle">Workflow Run visualizer</div>
      </div>
    </header>
  `;
}

function route(): void {
  currentView?.stop();
  currentView = null;

  const hash = window.location.hash || "#/";
  const detailMatch = /^#\/runs\/([^/]+)$/.exec(hash);

  appEl!.innerHTML = `${renderHeader()}<div id="view-root"></div>`;
  const viewRoot = document.getElementById("view-root");
  if (!viewRoot) return;

  if (detailMatch && detailMatch[1]) {
    const adwId = decodeURIComponent(detailMatch[1]);
    viewRoot.innerHTML = `<div class="loading">Loading run…</div>`;
    const view = new DetailView(viewRoot, adwId);
    currentView = view;
    void view.start();
    return;
  }

  viewRoot.innerHTML = `<div class="loading">Loading runs…</div>`;
  const view = new ListView(viewRoot);
  currentView = view;
  void view.start();
}

window.addEventListener("hashchange", route);
route();
