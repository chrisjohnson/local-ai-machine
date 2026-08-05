/**
 * gantt.ts: lays out a Workflow Run's Steps as a horizontal timeline where
 * each Step's own duration is drawn to scale, but idle/paused gaps BETWEEN
 * Steps are compressed to a small fixed width regardless of their real
 * duration — the explicit M-077 requirement (a Step sequence that sat
 * blocked-on-human for an hour must not produce an hour-long blank stretch).
 *
 * This module only computes layout (x positions + widths in pixels); it has
 * no DOM/rendering code, so it's cheap to reason about / test independently.
 */

import type { Step } from "./api";

export const PIXELS_PER_SECOND = 8;
export const MIN_BAR_WIDTH_PX = 24;
/** Fixed visual width standing in for ANY gap between one Step's end and the next Step's start, no matter how long that gap really was. */
export const GAP_WIDTH_PX = 28;
/** Leading padding before the first Step's bar. */
export const START_PADDING_PX = 12;

export interface StepLayout {
  step: Step;
  /** left edge, in px, within the timeline's own coordinate space */
  x: number;
  /** bar width, in px — proportional to the Step's own real duration, floored at MIN_BAR_WIDTH_PX */
  width: number;
  /** real duration in ms, if both started_at/ended_at (or "now" for a running step) are known */
  durationMs: number | null;
  /** true when this Step has no ended_at and is presumed still in progress */
  stillRunning: boolean;
}

export interface GanttLayout {
  steps: StepLayout[];
  /** total width of the timeline, in px — for setting the scroll container's content width */
  totalWidth: number;
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function widthForDuration(durationMs: number): number {
  const raw = (durationMs / 1000) * PIXELS_PER_SECOND;
  return Math.max(MIN_BAR_WIDTH_PX, raw);
}

/**
 * Computes the compressed-gap layout for a Workflow Run's Steps (already
 * ordered by `seq` — same order the `/api/runs/:adwId` route returns them
 * in). `nowMs` is injected (rather than read via `Date.now()` internally) so
 * a "still running" Step's in-progress width is deterministic/testable and
 * updates naturally on each re-render as the caller re-invokes this with a
 * fresh timestamp.
 */
export function computeGanttLayout(steps: Step[], nowMs: number): GanttLayout {
  const layouts: StepLayout[] = [];
  let cursorX = START_PADDING_PX;
  let prevEndMs: number | null = null;

  for (const step of steps) {
    const startedMs = parseMs(step.startedAt);
    const endedMs = parseMs(step.endedAt);
    const stillRunning = startedMs !== null && endedMs === null;

    // Compressed gap: any space between the previous Step's end and this
    // Step's start becomes a small FIXED width, never proportional to the
    // real elapsed time — this is the core M-077 requirement.
    if (prevEndMs !== null && startedMs !== null) {
      cursorX += GAP_WIDTH_PX;
    }

    let durationMs: number | null = null;
    let width: number;
    if (startedMs !== null) {
      const effectiveEndMs = endedMs ?? (stillRunning ? nowMs : startedMs);
      durationMs = Math.max(0, effectiveEndMs - startedMs);
      width = widthForDuration(durationMs);
    } else {
      // No started_at at all (e.g. a queued Step never begun) — render a
      // minimal placeholder bar so it's still visible in sequence.
      width = MIN_BAR_WIDTH_PX;
    }

    layouts.push({ step, x: cursorX, width, durationMs, stillRunning });
    cursorX += width;
    prevEndMs = endedMs ?? (stillRunning ? nowMs : startedMs);
  }

  return { steps: layouts, totalWidth: cursorX + START_PADDING_PX };
}
