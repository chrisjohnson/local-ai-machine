/**
 * miniGantt.ts: condensed rendering of a Workflow Run's Step timeline for
 * the main grid's cards (spec section 3) — reuses `gantt.ts`'s
 * `computeGanttLayout` layout math UNCHANGED (same compressed-gap algorithm
 * the full detail-page Gantt uses), only the RENDERING is adapted to a
 * small fixed-height strip: layout pixel coordinates are converted to
 * PERCENTAGES of the computed total width, so the same bars scale to
 * whatever width a given card ends up at (grid cards are responsive,
 * `auto-fill`/`minmax` — a fixed-px mini timeline would either overflow
 * narrow cards or look tiny in wide ones).
 *
 * Each Step also gets a small role-color dot beneath its bar, so the same
 * Role-color system (`roleColor.ts`) used on the detail page's full Gantt
 * and nested-event lists is visible at a glance on the grid too.
 */

import type { Step } from "./api";
import { computeGanttLayout } from "./gantt";
import { roleColor } from "./roleColor";
import { escapeHtml } from "./format";

function statusClass(status: string | null): string {
  return status ? `step-${status}` : "step-queued";
}

/**
 * Renders a condensed, percentage-scaled Gantt strip for one run's Steps.
 * `nowMs` is injected (not read internally) for the same testability reason
 * `computeGanttLayout` itself takes it — deterministic output, and a
 * "still running" Step's bar grows naturally as the caller re-invokes this
 * with a fresh timestamp on each poll tick.
 */
export function miniGanttHtml(steps: Step[], nowMs: number): string {
  if (steps.length === 0) {
    return `<div class="mini-gantt-empty">no Steps yet</div>`;
  }

  const layout = computeGanttLayout(steps, nowMs);
  const totalWidth = Math.max(1, layout.totalWidth);

  const bars = layout.steps
    .map((sl) => {
      const leftPct = (sl.x / totalWidth) * 100;
      const widthPct = Math.max(0.6, (sl.width / totalWidth) * 100);
      const roleTokens = roleColor(sl.step.role);
      const label = sl.step.name ?? sl.step.phaseId;
      const title = `${label}${sl.step.role ? ` · ${sl.step.role}` : ""} — ${sl.step.status ?? "unknown"}`;
      return `
        <div class="mini-step-bar ${statusClass(sl.step.status)}"
             style="left:${leftPct.toFixed(2)}%; width:${widthPct.toFixed(2)}%"
             title="${escapeHtml(title)}"></div>
        <div class="mini-step-role-dot" style="left:${leftPct.toFixed(2)}%; background:${roleTokens.color}" title="${escapeHtml(sl.step.role ?? "unknown role")}"></div>
      `;
    })
    .join("");

  return `<div class="mini-gantt-track">${bars}</div>`;
}
