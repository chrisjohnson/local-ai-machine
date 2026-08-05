/**
 * roleColor.test.ts: unit tests for the Role -> CSS-var color mapping
 * (spec section 1). Every known Role must map to its own distinct pair;
 * unrecognized/null Roles must fall back to a neutral color, never throw.
 */

import { describe, expect, test } from "bun:test";
import { KNOWN_ROLES, roleColor } from "./roleColor";

describe("roleColor", () => {
  test("every known Role maps to its own `--role-<name>` var pair", () => {
    for (const role of KNOWN_ROLES) {
      const tokens = roleColor(role);
      expect(tokens.color).toBe(`var(--role-${role})`);
      expect(tokens.surface).toBe(`var(--role-${role}-surface)`);
    }
  });

  test("all known Roles map to mutually distinct colors", () => {
    const colors = KNOWN_ROLES.map((r) => roleColor(r).color);
    expect(new Set(colors).size).toBe(KNOWN_ROLES.length);
  });

  test("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(roleColor("Plan")).toEqual(roleColor("plan"));
    expect(roleColor("  REVIEW  ")).toEqual(roleColor("review"));
  });

  test("treats underscore and hyphen spellings of run-tests the same", () => {
    expect(roleColor("run_tests")).toEqual(roleColor("run-tests"));
  });

  test("null falls back to the neutral pair, does not throw", () => {
    const tokens = roleColor(null);
    expect(tokens.color).toBe("var(--pi-muted)");
  });

  test("undefined falls back to the neutral pair, does not throw", () => {
    const tokens = roleColor(undefined);
    expect(tokens.color).toBe("var(--pi-muted)");
  });

  test("an unrecognized future Role name falls back to the neutral pair, does not crash or omit color", () => {
    const tokens = roleColor("some-future-role-not-yet-invented");
    expect(tokens.color).toBe("var(--pi-muted)");
    expect(tokens.surface).toBe("var(--pi-border-muted)");
  });

  test("empty string falls back to the neutral pair", () => {
    expect(roleColor("").color).toBe("var(--pi-muted)");
  });

  test("the neutral fallback is never one of the real role colors", () => {
    const fallback = roleColor(null).color;
    const realColors = KNOWN_ROLES.map((r) => roleColor(r).color);
    expect(realColors).not.toContain(fallback);
  });
});
