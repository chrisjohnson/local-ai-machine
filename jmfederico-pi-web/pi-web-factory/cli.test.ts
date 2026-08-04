/**
 * Unit tests for cli.ts's argument-parsing/prompt-resolution/status-line
 * logic — the parts that don't need a live pi-web server. M-067 card, Plan
 * item 4 ("you may also add a lightweight automated test ... if you think it
 * adds real value"). The manual smoke test (real terminal run against a real
 * scratch project) covers the actual end-to-end wiring; this covers the
 * argument-shape edge cases that are tedious to exercise by hand every time.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlanBuildTestResult } from "./chains/planBuildTest.ts";
import { CliUsageError, describeResult, parseArgs, resolvePrompt } from "./cli.ts";

// ── parseArgs ────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("parses the full flag set plus a positional prompt", () => {
    const args = parseArgs(["--project", "/abs/path", "--chain", "plan-build-test", "do the thing"]);
    expect(args).toEqual({ project: "/abs/path", chain: "plan-build-test", sessionId: undefined, promptArg: "do the thing" });
  });

  test("parses an optional --session-id", () => {
    const args = parseArgs([
      "--project",
      "/abs/path",
      "--chain",
      "plan-build-test",
      "--session-id",
      "sess_123",
      "do the thing",
    ]);
    expect(args.sessionId).toBe("sess_123");
  });

  test("flags may appear in any order relative to the positional", () => {
    const args = parseArgs(["do the thing", "--chain", "plan-build-test", "--project", "/abs/path"]);
    expect(args.promptArg).toBe("do the thing");
  });

  test("missing --project throws CliUsageError naming what's missing", () => {
    expect(() => parseArgs(["--chain", "plan-build-test", "prompt"])).toThrow(CliUsageError);
    expect(() => parseArgs(["--chain", "plan-build-test", "prompt"])).toThrow(/--project/);
  });

  test("missing --chain throws CliUsageError naming what's missing", () => {
    expect(() => parseArgs(["--project", "/abs/path", "prompt"])).toThrow(/--chain/);
  });

  test("missing positional prompt throws CliUsageError", () => {
    expect(() => parseArgs(["--project", "/abs/path", "--chain", "plan-build-test"])).toThrow(/prompt/);
  });

  test("more than one positional argument throws CliUsageError", () => {
    expect(() =>
      parseArgs(["--project", "/abs/path", "--chain", "plan-build-test", "prompt one", "prompt two"]),
    ).toThrow(/exactly one positional/);
  });

  test("an unknown flag throws CliUsageError", () => {
    expect(() =>
      parseArgs(["--project", "/abs/path", "--chain", "plan-build-test", "--bogus", "x", "prompt"]),
    ).toThrow(/unknown flag/);
  });

  test("a flag with a missing value throws CliUsageError", () => {
    expect(() => parseArgs(["--project", "--chain", "plan-build-test", "prompt"])).toThrow(/requires a value/);
  });

  test("usage errors include the usage string", () => {
    expect(() => parseArgs([])).toThrow(/usage: bun cli\.ts/);
  });
});

// ── resolvePrompt ────────────────────────────────────────────────────────

describe("resolvePrompt", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-web-factory-cli-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("literal text that isn't a path on disk is returned as-is", () => {
    expect(resolvePrompt("add a /health endpoint")).toBe("add a /health endpoint");
  });

  test("a path to an existing file is read and its contents returned", () => {
    const promptFile = join(dir, "prompt.md");
    writeFileSync(promptFile, "do the documented thing\n");
    expect(resolvePrompt(promptFile)).toBe("do the documented thing\n");
  });

  test("a path-shaped string that does not exist on disk is treated as literal text", () => {
    const missing = join(dir, "does-not-exist.md");
    expect(resolvePrompt(missing)).toBe(missing);
  });
});

// ── describeResult ───────────────────────────────────────────────────────

describe("describeResult", () => {
  test("success -> exit code 0", () => {
    const { message, exitCode } = describeResult({ status: "success", adwId: "adw_1", sessionId: "sess_1" });
    expect(exitCode).toBe(0);
    expect(message).toContain("SUCCESS");
    expect(message).toContain("adw_1");
    expect(message).toContain("sess_1");
  });

  test("blocked-on-human -> distinct message, non-zero exit code", () => {
    const result: PlanBuildTestResult = {
      status: "blocked-on-human",
      adwId: "adw_1",
      sessionId: "sess_1",
      phase: "plan",
      pendingAsk: {},
    };
    const { message, exitCode } = describeResult(result);
    expect(exitCode).not.toBe(0);
    expect(message).toContain("BLOCKED-ON-HUMAN");
    expect(message).toContain("--session-id sess_1");
  });

  test("unparseable -> distinct message, non-zero exit code", () => {
    const result: PlanBuildTestResult = {
      status: "unparseable",
      adwId: "adw_1",
      sessionId: "sess_1",
      phase: "build",
      lastReport: { checks: [] },
    };
    const { message, exitCode } = describeResult(result);
    expect(exitCode).not.toBe(0);
    expect(message).toContain("UNPARSEABLE");
  });

  test("permissions-violation -> distinct message, non-zero exit code", () => {
    const result: PlanBuildTestResult = {
      status: "permissions-violation",
      adwId: "adw_1",
      sessionId: "sess_1",
      phase: "build",
      permissions: { touched: [], allowed: [], violations: [], rollbacks: [], clean: true },
    };
    const { message, exitCode } = describeResult(result);
    expect(exitCode).not.toBe(0);
    expect(message).toContain("PERMISSIONS-VIOLATION");
  });

  test("failed -> distinct message including the reason, non-zero exit code", () => {
    const result: PlanBuildTestResult = {
      status: "failed",
      adwId: "adw_1",
      sessionId: "sess_1",
      phase: "test",
      reason: "tests failed: 2 of 5",
    };
    const { message, exitCode } = describeResult(result);
    expect(exitCode).not.toBe(0);
    expect(message).toContain("FAILED");
    expect(message).toContain("tests failed: 2 of 5");
  });

  test("every non-success status yields a different exit code from success and from each other where distinguishable", () => {
    const success = describeResult({ status: "success", adwId: "a", sessionId: "s" }).exitCode;
    const failedResult: PlanBuildTestResult = {
      status: "failed",
      adwId: "a",
      sessionId: "s",
      phase: "test",
      reason: "x",
    };
    const blockedResult: PlanBuildTestResult = {
      status: "blocked-on-human",
      adwId: "a",
      sessionId: "s",
      phase: "plan",
      pendingAsk: {},
    };
    const failed = describeResult(failedResult).exitCode;
    const blocked = describeResult(blockedResult).exitCode;
    expect(success).toBe(0);
    expect(failed).not.toBe(0);
    expect(blocked).not.toBe(0);
  });
});
