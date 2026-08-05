/**
 * stepBarStyle.ts: combines a Step's Role color (`roleColor.ts`) with its
 * status (running/success/fail/queued) into the actual inline CSS a Step
 * bar renders with — used by BOTH `miniGantt.ts` (grid cards) and
 * `detailView.ts` (the full per-run timeline), so a Role reads identically
 * everywhere it appears.
 *
 * Found missing in review (M-090 follow-up, 2026-08-05): the first cut of
 * this redesign gave Role BADGES their own color but left the actual Step
 * BARS colored by status only (`--pi-success`/`--pi-danger`/`--pi-accent`),
 * so e.g. a `build` bar and a `review` bar both rendered the same green —
 * Role identity was invisible on the one element (the bar itself) it
 * mattered most on. Chris's own ask (point 6): "each role had an
 * in-progress color and a matching completed (success or failed) color."
 *
 * Design: Role identity is ALWAYS the bar's base hue, in every state —
 * - running: full-saturation Role color fill, bright text, a pulsing
 *   accent-colored glow (the SAME glow language the card-level "this is
 *   live" indicator already uses, so "live" reads consistently everywhere,
 *   while the FILL still carries Role identity).
 * - success / fail: a DIMMED/muted tint of that SAME Role color (via
 *   `color-mix`, not a second hardcoded palette — "matching" per Chris's
 *   own wording) as the fill, with a colored border (green/red) carrying
 *   the actual status, and Role-colored text for continued identity at a
 *   glance.
 * - queued (not yet started): neutral/muted, no Role tint yet — nothing to
 *   show a Role "as" until the Step actually starts.
 */

import { roleColor } from "./roleColor";

export interface StepBarStyle {
  /** Full inline `style` attribute VALUE (no surrounding quotes) for the bar element itself. */
  style: string;
  /** `true` for a `running` Step — callers add the pulsing-glow CSS class (`step-bar-active`) themselves, kept separate so class-based `@keyframes` still does the actual animating (CSS, not JS, per the performance requirement). */
  isActive: boolean;
}

export function stepBarStyle(role: string | null, status: string | null): StepBarStyle {
  const tokens = roleColor(role);

  if (status === "running") {
    // Text color: `--pi-bg`, NOT `--pi-text-bright`. `--pi-text-bright`
    // means "most emphasized page text," which is near-black in the LIGHT
    // theme and near-white in the DARK theme — backwards from what a solid
    // role-color fill needs. Dark-theme Role colors are deliberately light
    // pastels (readable AS TEXT against a dark page), so a role-colored
    // FILL is light there too — near-white text on it would be nearly
    // invisible. `--pi-bg` is always that theme's opposite-luminance
    // anchor (near-black in dark theme, light sand in light theme), so it
    // reads clearly against a role-color fill in BOTH themes — the same
    // trick the status-based bars already relied on for success/fail/
    // queued (`color: var(--pi-bg)`) before this redesign.
    return {
      style: `background:${tokens.color}; border-color: var(--pi-accent); color: var(--pi-bg);`,
      isActive: true,
    };
  }

  if (status === "success" || status === "fail") {
    const statusColor = status === "success" ? "var(--pi-success)" : "var(--pi-danger)";
    const dimmedFill = `color-mix(in srgb, ${tokens.color} 38%, var(--pi-surface))`;
    return {
      style: `background:${dimmedFill}; border-color:${statusColor}; color:${tokens.color};`,
      isActive: false,
    };
  }

  // queued / unknown — no Role tint yet, nothing has actually run.
  return {
    style: `background: var(--pi-dim); opacity: 0.5; border-color: transparent; color: var(--pi-bg);`,
    isActive: false,
  };
}
