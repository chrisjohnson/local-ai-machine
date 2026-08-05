/**
 * roleColor.ts: maps a Step's `role` string (`step.role`, from the API —
 * ultimately `phases.owner` in the trace db) to the `--role-*` CSS custom
 * property pair (text/border color + a matching light "surface" tint for
 * badge backgrounds) defined in `style.css`.
 *
 * A fixed palette for the known Roles (plan/build/review/scout/document/
 * run-tests — pi-web-adw-design.md's Role vocabulary), each visually
 * distinct from the others AND from the three STATUS colors
 * (--pi-success/--pi-warning/--pi-danger) — role identity and run/Step
 * status are deliberately separate visual systems; reusing status colors
 * for roles would make them ambiguous at a glance.
 *
 * `step.role`/`phases.owner` is a free-text column (see schema.ts) — a
 * future Role not in this fixed list must NOT crash or silently omit
 * color, so any unrecognized name (including `null`) falls back to the
 * neutral `--pi-muted` pair rather than throwing.
 */

export interface RoleColorTokens {
  /** CSS var reference for text/border/icon color, e.g. "var(--role-plan)" */
  color: string;
  /** CSS var reference for a light background tint (badge/pill fill), e.g. "var(--role-plan-surface)" */
  surface: string;
}

const KNOWN_ROLES = ["plan", "build", "review", "scout", "document", "run-tests"] as const;

const FALLBACK: RoleColorTokens = { color: "var(--pi-muted)", surface: "var(--pi-border-muted)" };

/**
 * Normalizes a raw Role string for lookup — case-insensitive, trims
 * whitespace, and treats underscores the same as hyphens (`run_tests` and
 * `run-tests` should color identically; both spellings have shown up across
 * this codebase's own Role vocabulary discussions).
 */
function normalize(role: string): string {
  return role.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Returns the `--role-<name>` CSS var pair for a given Role name, or the
 * neutral fallback for `null`/unrecognized names. Never throws.
 */
export function roleColor(role: string | null | undefined): RoleColorTokens {
  if (!role) return FALLBACK;
  const key = normalize(role);
  const match = (KNOWN_ROLES as readonly string[]).find((r) => r === key);
  if (!match) return FALLBACK;
  return { color: `var(--role-${match})`, surface: `var(--role-${match}-surface)` };
}

export { KNOWN_ROLES };
