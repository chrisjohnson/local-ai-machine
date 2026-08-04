#!/usr/bin/env bun
/**
 * cli.ts: the manually-triggered entrypoint for pi-web-factory — design doc
 * §0 point 2, §3.4 ("the ticket-layer seam"), M-067 card.
 *
 * Invocation (mirrors upstream SSSF's own `uv run adws/adw_x.py "<prompt or
 * path/to/prompt.md>" [--config ...] [--adw-id ...]`, adapted to this
 * project's flag names):
 *
 *   bun cli.ts --project <abs-path> --chain <name> [--session-id <id>] "<prompt or path/to/prompt.md>"
 *
 * The four flags/positional above are deliberately exactly the `WorkItem`
 * shape from design doc §3.4:
 *
 *   WorkItem = {
 *     project: <abs path>,        # --project -> cwd
 *     chain: <chain name>,        # --chain -> chains/registry.ts lookup
 *     prompt: <string or path>,   # positional arg
 *     session_id?: <existing session to resume>,  # --session-id
 *     model_overrides?: { <agent identity>: <role> }  # NOT implemented here —
 *       no chain/config plumbing for per-run model overrides exists yet;
 *       left out rather than half-wired. Flagging the omission per the
 *       card's brief rather than silently dropping it.
 *   }
 *
 * This file is deliberately a thin wrapper — argument parsing, config/
 * registry lookups, and I/O only. All real chain logic lives in chains/ and
 * modules/; see chains/planBuildTest.ts for the one chain currently wired.
 *
 * When the future `.fleet`-lite ticket-queue worker exists (design doc §3.4),
 * its job is: pull a card from `now/`, build this same WorkItem shape from
 * the card's frontmatter/body, and call `runChain()` below directly as a
 * library function (or re-exec this CLI) — no change to this shape without
 * updating §3.4 to match.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chainNames, chainRegistry, type ChainResultBase } from "./chains/registry.ts";
import { ConfigError, loadConfig, projectConfigFor } from "./modules/config.ts";
import { Tracer } from "./modules/tracer.ts";

// ── argument parsing ────────────────────────────────────────────────────

export interface ParsedArgs {
  project: string;
  chain: string;
  sessionId?: string;
  promptArg: string;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const USAGE =
  'usage: bun cli.ts --project <abs-path> --chain <name> [--session-id <id>] "<prompt or path/to/prompt.md>"';

/**
 * Parses `argv` (i.e. everything after `bun cli.ts`) into `--project`,
 * `--chain`, `--session-id` (optional), and exactly one positional
 * prompt-or-path argument. Throws `CliUsageError` (never a bare stack trace)
 * for anything malformed — unknown flags, missing required flags, a missing
 * flag value, more than one positional argument, or zero positional
 * arguments.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let project: string | undefined;
  let chain: string | undefined;
  let sessionId: string | undefined;
  const positionals: string[] = [];

  const knownFlags = new Set(["--project", "--chain", "--session-id"]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      if (!knownFlags.has(arg)) {
        throw new CliUsageError(`unknown flag ${JSON.stringify(arg)}\n${USAGE}`);
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(`flag ${arg} requires a value\n${USAGE}`);
      }
      i += 1;
      if (arg === "--project") project = value;
      else if (arg === "--chain") chain = value;
      else if (arg === "--session-id") sessionId = value;
      continue;
    }
    positionals.push(arg);
  }

  if (!project) throw new CliUsageError(`missing required --project <abs-path>\n${USAGE}`);
  if (!chain) throw new CliUsageError(`missing required --chain <name>\n${USAGE}`);
  if (positionals.length === 0) {
    throw new CliUsageError(`missing required prompt argument (literal text or a path to a prompt file)\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `expected exactly one positional prompt argument, got ${String(positionals.length)}: ` +
        `${positionals.map((p) => JSON.stringify(p)).join(", ")}\n${USAGE}`,
    );
  }

  return { project, chain, sessionId, promptArg: positionals[0] as string };
}

/**
 * Resolves the positional prompt argument: if it names an existing file on
 * disk, read that file's contents as the prompt; otherwise treat the
 * argument itself as literal prompt text. Matches SSSF's own convention
 * (`"<prompt or path/to/prompt.md>"`).
 */
export function resolvePrompt(promptArg: string): string {
  if (existsSync(promptArg)) {
    return readFileSync(promptArg, "utf8");
  }
  return promptArg;
}

// ── status line ──────────────────────────────────────────────────────────

/**
 * Renders the final status line for any registered chain's result. Handles
 * every branch of planBuildTest.ts's discriminated union (and, structurally,
 * any future chain's result carrying the same {status, adwId, sessionId}
 * base) distinctly — never collapsed into a generic pass/fail. Returns the
 * message plus the process exit code that should follow it.
 */
export function describeResult(result: ChainResultBase): { message: string; exitCode: number } {
  const idLine = `adwId=${result.adwId} sessionId=${result.sessionId}`;
  switch (result.status) {
    case "success":
      return { message: `SUCCESS — ${idLine}`, exitCode: 0 };
    case "blocked-on-human": {
      const phase = "phase" in result ? String((result as { phase?: unknown }).phase) : "unknown";
      return {
        message: `BLOCKED-ON-HUMAN (phase=${phase}) — ${idLine} — the agent asked a question and is waiting; resume with --session-id ${result.sessionId} once answered in pi-web's UI`,
        exitCode: 2,
      };
    }
    case "unparseable": {
      const phase = "phase" in result ? String((result as { phase?: unknown }).phase) : "unknown";
      return {
        message: `UNPARSEABLE (phase=${phase}) — ${idLine} — the agent's response never matched the required envelope schema after retries`,
        exitCode: 3,
      };
    }
    case "permissions-violation": {
      const phase = "phase" in result ? String((result as { phase?: unknown }).phase) : "unknown";
      return {
        message: `PERMISSIONS-VIOLATION (phase=${phase}) — ${idLine} — the agent wrote outside its allowed paths; changes were rolled back`,
        exitCode: 4,
      };
    }
    case "failed": {
      const phase = "phase" in result ? String((result as { phase?: unknown }).phase) : "unknown";
      const reason = "reason" in result ? String((result as { reason?: unknown }).reason) : "(no reason given)";
      return { message: `FAILED (phase=${phase}) — ${idLine} — ${reason}`, exitCode: 1 };
    }
    default:
      return { message: `UNKNOWN STATUS ${JSON.stringify(result.status)} — ${idLine}`, exitCode: 1 };
  }
}

// ── main ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_PATH = join(import.meta.dir, "factory.config.yaml");
const DEFAULT_DB_PATH = join(import.meta.dir, "factory.db");

/**
 * Config path is resolved relative to THIS file's own location (not the
 * caller's cwd), same convention the test suite already uses
 * (`join(import.meta.dir, "..", "factory.config.yaml")` from chains/modules
 * subdirs — see config.test.ts / planBuildTest.integration.test.ts) — so
 * `bun cli.ts ...` behaves identically no matter what directory it's invoked
 * from. `PI_WEB_FACTORY_CONFIG` is an escape hatch for exactly one situation:
 * ad hoc smoke-testing against a scratch project that isn't (and shouldn't
 * be) registered in the real, committed `factory.config.yaml` — not a
 * documented/supported flag, not part of the WorkItem shape, never touched by
 * ordinary `--project`/`--chain` invocations.
 */
function resolveConfigPath(): string {
  return process.env["PI_WEB_FACTORY_CONFIG"] ?? DEFAULT_CONFIG_PATH;
}

/**
 * `gates.ts`'s `testsPass` shells out LOCALLY, on the machine cli.ts itself
 * runs on (`Bun.spawn`, refuses a nonexistent cwd) — correct in production,
 * where cli.ts runs as a sibling process inside the same container as the
 * target project (design doc §2), so `--project`'s path IS a real local
 * path there. `PI_WEB_FACTORY_TEST_CWD` is the same kind of dev-only escape
 * hatch as `PI_WEB_FACTORY_CONFIG` above, for the one case that assumption
 * doesn't hold: running cli.ts from a dev machine against a project that
 * only exists inside a remote container, with a self-contained ssh/docker-
 * exec `test` command (see planBuildTest.ts's own `testCwd` doc comment,
 * and planBuildTest.integration.test.ts, which establishes exactly this
 * pattern). Defaults to `--project`'s path, matching planBuildTest.ts's own
 * default.
 */
function resolveTestCwd(projectPath: string): string {
  return process.env["PI_WEB_FACTORY_TEST_CWD"] ?? projectPath;
}

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(Bun.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      return 64; // EX_USAGE
    }
    throw error;
  }

  const chainRunner = chainRegistry[args.chain];
  if (!chainRunner) {
    console.error(
      `unknown --chain ${JSON.stringify(args.chain)} — available chains: ${chainNames().join(", ") || "(none registered)"}`,
    );
    return 64;
  }

  let config;
  let testCmd: string | undefined;
  try {
    config = loadConfig(resolveConfigPath());
    // projectConfigFor's own thrown ConfigError already names what IS
    // configured (config.ts) — surfaced verbatim, never rewrapped into
    // something less specific. Its `test` command (when present) is threaded
    // through to the chain explicitly: planBuildTest.ts's own `testCmd`
    // option does not look this up itself (see that file's doc comment on
    // `testCmd` vs its actual behavior) — cli.ts, as the thin wrapper, is
    // where "look up this project's configured test command" belongs. As of
    // M-070 this reads `<project>/.pi-web-factory.yaml` (a file the target
    // project owns) rather than a centralized map in `config` — `config`
    // itself is no longer a parameter here.
    testCmd = projectConfigFor(args.project).test;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 64;
    }
    throw error;
  }

  const taskPrompt = resolvePrompt(args.promptArg);

  // Mint the adwId here (same shape planBuildTest.ts mints internally when
  // omitted) so it can be printed and handed to the chain via `adwId`,
  // rather than waiting for the chain to finish to learn it. When resuming
  // (--session-id given), the sessionId is already known too, so both ids
  // print immediately, before any network call happens. When minting a
  // fresh session, only the adwId is knowable up front — the real sessionId
  // is reported the moment the chain returns it, not withheld until the
  // whole chain (plan+build+test) completes.
  const adwId = `adw_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  console.log(
    `${args.sessionId ? "resuming" : "starting"} chain ${JSON.stringify(args.chain)}: adwId=${adwId}` +
      (args.sessionId ? ` sessionId=${args.sessionId}` : " sessionId=(minting a fresh pi-web session...)") +
      " — visible in pi-web's own session picker",
  );

  const tracer = new Tracer(DEFAULT_DB_PATH);
  try {
    const result = await chainRunner({
      tracer,
      config,
      cwd: args.project,
      taskPrompt,
      sessionId: args.sessionId,
      adwId,
      testCmd,
      testCwd: resolveTestCwd(args.project),
      engineer: process.env["USER"] ?? undefined,
    });

    const { message, exitCode } = describeResult(result);
    console.log(message);
    return exitCode;
  } finally {
    tracer.close();
  }
}

// Only auto-run when executed directly (`bun cli.ts ...`), not when imported
// by a test that wants `parseArgs`/`resolvePrompt`/`describeResult` alone.
if (import.meta.main) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
