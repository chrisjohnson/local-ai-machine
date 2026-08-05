/**
 * gantt.test.ts: unit tests for the compressed-gap Gantt layout (M-077's
 * central, explicit requirement — idle/paused time between Steps must NOT
 * be drawn to scale). Runs under plain `bun test` (no DOM needed — this
 * module has none).
 */

import { describe, expect, test } from "bun:test";
import { computeGanttLayout, GAP_WIDTH_PX, MIN_BAR_WIDTH_PX, PIXELS_PER_SECOND, START_PADDING_PX } from "./gantt";
import type { Step } from "./api";

function mkStep(overrides: Partial<Step>): Step {
  return {
    phaseId: "p1",
    adwId: "adw1",
    seq: 1,
    name: "step",
    kind: "agent",
    role: "role",
    description: "",
    status: "success",
    attempt: 0,
    retries: 0,
    error: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    outputSummary: null,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

describe("computeGanttLayout", () => {
  test("a single Step's bar width is proportional to its real duration", () => {
    const steps = [
      mkStep({ startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:10.000Z" }), // 10s
    ];
    const { steps: layout } = computeGanttLayout(steps, Date.parse("2026-01-01T00:01:00.000Z"));
    expect(layout).toHaveLength(1);
    expect(layout[0]!.durationMs).toBe(10_000);
    expect(layout[0]!.width).toBe(10 * PIXELS_PER_SECOND);
    expect(layout[0]!.x).toBe(START_PADDING_PX);
  });

  test("a long idle gap between two Steps is compressed to the fixed GAP_WIDTH_PX, not drawn to scale", () => {
    const steps = [
      mkStep({ phaseId: "p1", seq: 1, startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:05.000Z" }), // 5s
      // huge gap: an HOUR between step 1 ending and step 2 starting
      mkStep({ phaseId: "p2", seq: 2, startedAt: "2026-01-01T01:00:05.000Z", endedAt: "2026-01-01T01:00:15.000Z" }), // 10s
    ];
    const { steps: layout, totalWidth } = computeGanttLayout(steps, Date.parse("2026-01-01T02:00:00.000Z"));

    const step1 = layout[0]!;
    const step2 = layout[1]!;

    expect(step1.width).toBe(5 * PIXELS_PER_SECOND);
    // step2's x must be step1's end + the FIXED gap width, regardless of the
    // real 1-hour gap — this is the whole point of the requirement.
    expect(step2.x).toBe(step1.x + step1.width + GAP_WIDTH_PX);
    expect(step2.width).toBe(10 * PIXELS_PER_SECOND);

    // Total layout width stays small (proves nothing scaled the hour-long gap).
    expect(totalWidth).toBeLessThan(1000);
  });

  test("a fast Step still gets a visible minimum bar width", () => {
    const steps = [mkStep({ startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:00.050Z" })]; // 50ms
    const { steps: layout } = computeGanttLayout(steps, Date.now());
    expect(layout[0]!.width).toBe(MIN_BAR_WIDTH_PX);
  });

  test("a still-running Step (no ended_at) is drawn up to `nowMs`, marked stillRunning, and grows on each recompute", () => {
    const steps = [mkStep({ startedAt: "2026-01-01T00:00:00.000Z", endedAt: null })];
    const nowMs1 = Date.parse("2026-01-01T00:00:05.000Z");
    const nowMs2 = Date.parse("2026-01-01T00:00:15.000Z");

    const layout1 = computeGanttLayout(steps, nowMs1).steps[0]!;
    const layout2 = computeGanttLayout(steps, nowMs2).steps[0]!;

    expect(layout1.stillRunning).toBe(true);
    expect(layout2.stillRunning).toBe(true);
    expect(layout1.durationMs).toBe(5_000);
    expect(layout2.durationMs).toBe(15_000);
    expect(layout2.width).toBeGreaterThan(layout1.width);
  });

  test("a queued Step with no startedAt yet gets a minimal placeholder bar, not an error", () => {
    const steps = [mkStep({ startedAt: null, endedAt: null, status: "queued" })];
    const { steps: layout } = computeGanttLayout(steps, Date.now());
    expect(layout[0]!.width).toBe(MIN_BAR_WIDTH_PX);
    expect(layout[0]!.durationMs).toBeNull();
    expect(layout[0]!.stillRunning).toBe(false);
  });

  test("three Steps with two gaps of very different real lengths (1 minute vs 2 hours) still produce two IDENTICAL fixed-width gaps", () => {
    const steps = [
      mkStep({ phaseId: "p1", seq: 1, startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:02.000Z" }),
      mkStep({ phaseId: "p2", seq: 2, startedAt: "2026-01-01T00:01:02.000Z", endedAt: "2026-01-01T00:01:04.000Z" }), // 1 min gap
      mkStep({ phaseId: "p3", seq: 3, startedAt: "2026-01-01T02:01:04.000Z", endedAt: "2026-01-01T02:01:06.000Z" }), // 2 hour gap
    ];
    const { steps: layout } = computeGanttLayout(steps, Date.parse("2026-01-01T03:00:00.000Z"));
    const gap1 = layout[1]!.x - (layout[0]!.x + layout[0]!.width);
    const gap2 = layout[2]!.x - (layout[1]!.x + layout[1]!.width);
    expect(gap1).toBe(GAP_WIDTH_PX);
    expect(gap2).toBe(GAP_WIDTH_PX);
    expect(gap1).toBe(gap2);
  });
});
