#!/usr/bin/env bun
/**
 * cli.ts: the manually-triggered entrypoint for pi-web-factory — design doc
 * §0 point 2, §3.4 ("the ticket-layer seam"), M-067 card. `--chain` renamed
 * to `--workflow` by M-076, matching the design doc §7 terminology
 * ("Workflow" replaces "chain" everywhere) — the underlying registry
 * (`chains/registry.ts`) now resolves both generic-interpreter-driven YAML
 * Workflows AND the one remaining hand-written chain
 * (`chains/planBuildTest.ts`) behind the SAME name, so this flag covers
 * every runnable shape regardless of how it's implemented.
 *
 * Invocation (mirrors upstream SSSF's own `uv run adws/adw_x.py "<prompt or
 * path/to/prompt.md>" [--config ...] [--adw-id ...]`, adapted to this
 * project's flag names):
 *
 *   bun cli.ts --project <abs-path> --workflow <name> [--session-id <id>] "<prompt or path/to/prompt.md>"
 *
 * The four flags/positional above are deliberately exactly the `WorkItem`
 * shape from design doc §3.4:
 *
 *   WorkItem = {
 *     project: <abs path>,        # --project -> cwd
 *     workflow: <workflow name>,  # --workflow -> chains/registry.ts lookup
 *     prompt: <string or path>,   # positional arg
 *     session_id?: <existing session to resume>,  # --session-id
 *     model_overrides?: { <agent identity>: <role> }  # NOT implemented here —
 *       no chain/config plumbing for per-run model overrides exists yet;
 *       left out rather than half-wired. Flagging the omission per the
 *       card's brief rather than silently dropping it.
 *   }
 *
 * This file is deliberately a thin wrapper — argument parsing, config/
 * registry lookups, and I/O only. All real execution logic lives in
 * `modules/workflow.ts` (the generic interpreter, M-076) and `chains/`
 * (`planBuildTest.ts`, the one remaining hand-written chain).
 *
 * When the future `.fleet`-lite ticket-queue worker exists (design doc §3.4),
 * its job is: pull a card from `now/`, build this same WorkItem shape from
 * the card's frontmatter/body, and call `runWorkflow()`/the registry below
 * directly as a library function (or re-exec this CLI) — no change to this
 * shape without updating §3.4 to match.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { workflowNames, workflowRegistry, type WorkflowResultBase } from "./chains/registry.ts";
import { ConfigError, projectConfigFor } from "./modules/config.ts";
import { loadRolesConfig } from "./modules/roles.ts";
import { DEFAULT_BASE_URL } from "./modules/piwebClient.ts";
import { Tracer } from "./modules/tracer.ts";

// ── argument parsing ────────────────────────────────────────────────────

export interface ParsedArgs {
  project: string;
  workflow: string;
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
  'usage: bun cli.ts --project <abs-path> --workflow <name> [--session-id <id>] "<prompt or path/to/prompt.md>"';

/**
 * Parses `argv` (i.e. everything after `bun cli.ts`) into `--project`,
 * `--workflow`, `--session-id` (optional), and exactly one positional
 * prompt-or-path argument. Throws `CliUsageError` (never a bare stack trace)
 * for anything malformed — unknown flags, missing required flags, a missing
 * flag value, more than one positional argument, or zero positional
 * arguments.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let project: string | undefined;
  let workflow: string | undefined;
  let sessionId: string | undefined;
  const positionals: string[] = [];

  const knownFlags = new Set(["--project", "--workflow", "--session-id"]);

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
      else if (arg === "--workflow") workflow = value;
      else if (arg === "--session-id") sessionId = value;
      continue;
    }
    positionals.push(arg);
  }

  if (!project) throw new CliUsageError(`missing required --project <abs-path>\n${USAGE}`);
  if (!workflow) throw new CliUsageError(`missing required --workflow <name>\n${USAGE}`);
  if (positionals.length === 0) {
    throw new CliUsageError(`missing required prompt argument (literal text or a path to a prompt file)\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `expected exactly one positional prompt argument, got ${String(positionals.length)}: ` +
        `${positionals.map((p) => JSON.stringify(p)).join(", ")}\n${USAGE}`,
    );
  }

  return { project, workflow, sessionId, promptArg: positionals[0] as string };
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

// ── deep link (M-071) ────────────────────────────────────────────────────

/**
 * Derives pi-web's browser origin from its own API base URL. `DEFAULT_BASE_URL`
 * (`piwebClient.ts`) is `http://<host>:<port>/api` — the API mount point, not
 * where the browser UI itself is served — but confirmed (`pi-web-adw-design.md`
 * §6.2, `app.ts`'s route registration) that pi-web serves both its static
 * client AND its `/api` routes off the SAME host/port, just different path
 * prefixes. So the browser origin is exactly `baseUrl` with a trailing
 * `/api` (only) stripped — derived from the one existing source of truth
 * rather than hardcoding a second copy of the host/port here, per this
 * card's explicit instruction not to duplicate that string.
 */
export function browserOriginFromApiBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/api") ? baseUrl.slice(0, -"/api".length) : baseUrl;
}

/**
 * Builds the working session deep-link — `?project=<id>&workspace=<id>&
 * session=<id>` (confirmed against pi-web's client router, `route.ts`/
 * `PiWebApp.ts`: `session` alone does nothing, `project` is read first and
 * short-circuits if absent — pi-web-adw-design.md §6.2/§6.3). `workspaceId`
 * is optional in the URL (an absent `workspace` param still opens the
 * project, just not pinned to a specific worktree) since
 * `resolveWorkspaceId` can itself come back `undefined` in an edge case
 * (e.g. the workspace list hasn't caught up yet) — never block printing a
 * link over one missing piece when the other two are real.
 */
export function sessionDeepLink(baseUrl: string, link: { projectId: string; workspaceId?: string }, sessionId: string): string {
  const origin = browserOriginFromApiBaseUrl(baseUrl);
  const params = new URLSearchParams({ project: link.projectId, session: sessionId });
  if (link.workspaceId) params.set("workspace", link.workspaceId);
  return `${origin}/?${params.toString()}`;
}

// ── status line ──────────────────────────────────────────────────────────

/**
 * Renders the final status line for any registered workflow's result.
 * Handles every branch of `PlanBuildTestResult`'s AND `WorkflowRunResult`'s
 * discriminated unions (and, structurally, any future runner's result
 * carrying the same {status, adwId, sessionId, link} base) distinctly —
 * never collapsed into a generic pass/fail. `step`/`phase` are read
 * generically (`workflow.ts`'s results use `step`, `planBuildTest.ts`'s use
 * `phase` — both narrow to a step/phase NAME string, rendered under one
 * shared label). Returns the message plus the process exit code that should
 * follow it. `baseUrl` defaults to `DEFAULT_BASE_URL` (the same base every
 * run itself defaults to when the caller doesn't override it) so the
 * printed link always points at the SAME server the run actually used.
 */
export function describeResult(result: WorkflowResultBase, baseUrl: string = DEFAULT_BASE_URL): { message: string; exitCode: number } {
  const idLine = `adwId=${result.adwId} sessionId=${result.sessionId}`;
  const link = `link=${sessionDeepLink(baseUrl, result.link, result.sessionId)}`;
  const stepName = (): string => {
    if ("step" in result) return String((result as { step?: unknown }).step);
    if ("phase" in result) return String((result as { phase?: unknown }).phase);
    return "unknown";
  };
  switch (result.status) {
    case "success":
      return { message: `SUCCESS — ${idLine} — ${link}`, exitCode: 0 };
    case "blocked-on-human": {
      return {
        message: `BLOCKED-ON-HUMAN (step=${stepName()}) — ${idLine} — ${link} — the agent asked a question and is waiting; resume with --session-id ${result.sessionId} once answered in pi-web's UI`,
        exitCode: 2,
      };
    }
    case "unparseable": {
      const rawResponse = "rawResponse" in result ? String((result as { rawResponse?: unknown }).rawResponse) : undefined;
      const detail = rawResponse
        ? ` — last response: ${rawResponse}`
        : " — the agent's response never matched the required envelope schema after retries";
      return {
        message: `UNPARSEABLE (step=${stepName()}) — ${idLine} — ${link}${detail}`,
        exitCode: 3,
      };
    }
    case "permissions-violation": {
      const permissions = "permissions" in result
        ? (result as { permissions?: { violations?: string[] } }).permissions
        : undefined;
      const violations = permissions?.violations ?? [];
      const detail = violations.length > 0
        ? ` — the agent wrote outside its allowed paths (${violations.join(", ")}); changes were rolled back`
        : " — the agent wrote outside its allowed paths; changes were rolled back";
      return {
        message: `PERMISSIONS-VIOLATION (step=${stepName()}) — ${idLine} — ${link}${detail}`,
        exitCode: 4,
      };
    }
    case "failed": {
      const reason = "reason" in result ? String((result as { reason?: unknown }).reason) : "(no reason given)";
      return { message: `FAILED (step=${stepName()}) — ${idLine} — ${link} — ${reason}`, exitCode: 1 };
    }
    case "gate-failed": {
      const report = "report" in result ? (result as { report?: { checks?: { item: string; ok: boolean; note?: string }[] } }).report : undefined;
      const firstFailure = report?.checks?.find((c) => !c.ok);
      const reason = firstFailure ? `${firstFailure.item}: ${firstFailure.note ?? "failed"}` : "a code step's gate failed";
      return { message: `GATE-FAILED (step=${stepName()}) — ${idLine} — ${link} — ${reason}`, exitCode: 5 };
    }
    case "loop-exhausted": {
      const rounds = "rounds" in result ? String((result as { rounds?: unknown }).rounds) : "unknown";
      return {
        message: `LOOP-EXHAUSTED (step=${stepName()}, rounds=${rounds}) — ${idLine} — ${link} — the loop's until condition was never satisfied within max_rounds`,
        exitCode: 6,
      };
    }
    default:
      return { message: `UNKNOWN STATUS ${JSON.stringify(result.status)} — ${idLine} — ${link}`, exitCode: 1 };
  }
}

// ── main ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_PATH = join(import.meta.dir, "factory.config.yaml");
const DEFAULT_DB_PATH = join(import.meta.dir, "factory.db");

/**
 * `factory.db` accumulates real observability history across every run — it
 * must NOT default to a path that a deploy mechanism might periodically wipe
 * (M-068's Docker bake-in re-syncs `pi-web-factory`'s own code directory
 * wholesale, `rm -rf` included, on every container start, exactly like the
 * existing `pi-continue-companion`/`pi-web-factory-prompts` plugin/extension
 * syncs already do — see `docker-entrypoint.sh`). `PI_WEB_FACTORY_DB_PATH`
 * lets the container set this to a path OUTSIDE that resynced directory
 * (under the bind-mounted, persistent `$PI_CODING_AGENT_DIR`) so the trace
 * db survives both container restarts and code redeploys. Defaults to the
 * historical co-located path for local dev, unchanged.
 */
function resolveDbPath(): string {
  const path = process.env["PI_WEB_FACTORY_DB_PATH"] ?? DEFAULT_DB_PATH;
  // bun:sqlite's `create: true` makes the FILE if missing, not missing
  // parent directories — needed once PI_WEB_FACTORY_DB_PATH can point
  // somewhere that doesn't yet exist (e.g. a fresh bind-mounted config
  // volume on a container's first ever start).
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

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
 * ordinary `--project`/`--workflow` invocations.
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

  const workflowRunner = workflowRegistry[args.workflow];
  if (!workflowRunner) {
    console.error(
      `unknown --workflow ${JSON.stringify(args.workflow)} — available workflows: ${workflowNames().join(", ") || "(none registered)"}`,
    );
    return 64;
  }

  let config;
  let testCmd: string | undefined;
  try {
    config = loadRolesConfig(resolveConfigPath());
    // projectConfigFor's own thrown ConfigError already names what IS
    // configured (config.ts) — surfaced verbatim, never rewrapped into
    // something less specific. Its `test` command (when present) is threaded
    // through to the runner explicitly: planBuildTest.ts's own `testCmd`
    // option does not look this up itself (see that file's doc comment on
    // `testCmd` vs its actual behavior), and the generic interpreter's `code`
    // steps get it via their own Role function (roles.ts's `run-tests`
    // reading `project.test` from `projectConfigFor` directly) — cli.ts, as
    // the thin wrapper, is where "look up this project's configured test
    // command" belongs regardless of which runner ends up using it. As of
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

  // Mint the adwId here (same shape planBuildTest.ts/workflow.ts mint
  // internally when omitted) so it can be printed and handed to the runner
  // via `adwId`, rather than waiting for the run to finish to learn it. When
  // resuming (--session-id given), the sessionId is already known too, but
  // the real working deep-link (project/workspace ids, M-071) is NOT
  // knowable until the run itself resolves them (workspace resolution needs
  // a real, already-created worktree path to query pi-web for) — so this
  // line stays a short "starting/resuming" progress note, and the full link
  // prints once via `describeResult` after the run returns (both success and
  // every failure branch — replaces the M-067-era "visible in pi-web's own
  // session picker" placeholder, which was never a REAL working link).
  const adwId = `adw_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  console.log(
    `${args.sessionId ? "resuming" : "starting"} workflow ${JSON.stringify(args.workflow)}: adwId=${adwId}` +
      (args.sessionId ? ` sessionId=${args.sessionId}` : " sessionId=(minting a fresh pi-web session...)"),
  );

  const tracer = new Tracer(resolveDbPath());
  try {
    const result = await workflowRunner({
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
