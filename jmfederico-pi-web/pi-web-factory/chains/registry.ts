/**
 * registry.ts: chain-name -> chain-runner-function lookup for `cli.ts`.
 *
 * A CLI-facing chain name is deliberately its own thing, distinct from the
 * TS export name (`planBuildTest` the function vs `"plan-build-test"` the
 * flag value) — kebab-case reads better as a `--chain` argument and keeps
 * the CLI surface stable even if a chain's internal export is ever renamed.
 * This is also the seam a second chain (`buildReview`, per the design doc's
 * `chains/` sketch) registers into later — one map, one place to look, no
 * `cli.ts` changes beyond adding a line here.
 *
 * Every entry must share the same narrow shape `cli.ts` depends on: an
 * async function taking `{tracer, config, cwd, taskPrompt, sessionId?,
 * baseUrl?, adwId?, engineer?}`-compatible options and returning a
 * discriminated `{status: ...}` result with `adwId`/`sessionId` on every
 * branch. `ChainRunner` below is intentionally loose (not literally
 * `PlanBuildTestOptions`) so a future chain with a different envelope shape
 * can register here without widening this file's own types.
 */

import { planBuildTest, type PlanBuildTestOptions, type PlanBuildTestResult } from "./planBuildTest.ts";
import type { FactoryConfig } from "../modules/config.ts";
import type { Tracer } from "../modules/tracer.ts";

/** Fields every registered chain runner accepts — the CLI only ever supplies these. */
export interface ChainRunOptions {
  tracer: Tracer;
  config: FactoryConfig;
  cwd: string;
  taskPrompt: string;
  sessionId?: string;
  baseUrl?: string;
  adwId?: string;
  engineer?: string;
  /** Project's configured test/quality-gate command, when known (config.ts's projectConfigFor(...).test). */
  testCmd?: string;
  /** Local cwd for the test gate's shell-out, when it must differ from `cwd` — see planBuildTest.ts's own testCwd doc comment. */
  testCwd?: string;
}

/** Fields every registered chain result carries, regardless of its own status union. */
export interface ChainResultBase {
  status: string;
  adwId: string;
  sessionId: string;
}

export type ChainRunner = (opts: ChainRunOptions) => Promise<ChainResultBase>;

/** CLI-facing chain name -> runner. Keys are the exact `--chain` values accepted. */
export const chainRegistry: Record<string, ChainRunner> = {
  "plan-build-test": planBuildTest as unknown as ChainRunner,
};

export function chainNames(): string[] {
  return Object.keys(chainRegistry);
}

/** Re-exported so callers that need the concrete, non-widened types can get them from one place. */
export type { PlanBuildTestOptions, PlanBuildTestResult };
