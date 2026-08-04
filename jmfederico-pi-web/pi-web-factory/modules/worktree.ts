/**
 * worktree.ts: one git worktree per Workflow Run — M-071 card, Plan item 2.
 * Closes the design's long-standing "no branch-per-run isolation" gap
 * (`pi-web-adw-design.md` §0/§4/§6.4) by giving every run its own checkout
 * and branch, created via plain `git worktree add` (pi-web has no
 * worktree-creation API of its own — confirmed §6.2 — pi-web's UI/
 * `WorkspaceService` only *discovers* real worktrees after the fact).
 *
 * ── Naming convention ────────────────────────────────────────────────────
 * Both the worktree directory and its branch are named directly from the
 * run's own `adwId` (`adw_<12 lowercase hex chars>`, minted by `cli.ts`/
 * `planBuildTest.ts`) — the same id every trace-db row for this run is keyed
 * by (`tracer.ts`'s `sessions.adw_id`, `phases.adw_id`, `events.adw_id`).
 * One id, one lookup key, everywhere — a worktree directory or branch name
 * found on disk or in `git branch -a` traces straight back to its trace-db
 * rows with a single `grep`/`select ... where adw_id=?`, no separate mapping
 * table to keep in sync.
 *
 *   - Branch: `pi-web-factory/<adwId>` (e.g. `pi-web-factory/adw_a1b2c3d4e5f6`)
 *     — namespaced under `pi-web-factory/` so these branches are visibly
 *     machine-created in `git branch -a`/any GUI, distinct from a human's
 *     own feature branches, and trivially bulk-matchable
 *     (`git branch --list 'pi-web-factory/*'`) for a future cleanup sweep.
 *   - Directory: `<adwId>` alone, nested under a fixed subdirectory (see
 *     below) — the parent directory name already supplies the
 *     `pi-web-factory` namespacing, so repeating it in every leaf directory
 *     name would be redundant.
 *
 * ── Location: nested inside the project's own checkout, not a true sibling ─
 * The obvious-looking alternative — `<project-parent>/<project-name>-
 * worktrees/<adwId>/`, a true sibling directory outside the project's own
 * tree — was considered and rejected for a concrete, verified reason, not a
 * style preference: in the actual deployment this runs in
 * (`jmfederico-pi-web`'s container, `docker/docker-compose.yml`), a target
 * project is reached through exactly ONE bind mount
 * (`/home/chris/turnstone-workspace/printer-dashboard:/work` today) — there
 * is no bind mount, and no reason to add one per project, covering a
 * sibling directory OUTSIDE that mount's host path. A worktree created at
 * `/work/../printer-dashboard-worktrees/<adwId>` would resolve to a host
 * path the container simply cannot see. Nesting under the project's own
 * checkout (`<cwd>/.pi-web-factory-worktrees/<adwId>/`) stays entirely
 * inside the one mount that's guaranteed to exist for any project
 * pi-web-factory is pointed at — confirmed live 2026-08-04 (`git worktree
 * add` + pi-web's own `GET /projects/:id/workspaces` discovery both work
 * identically whether the worktree is nested or a true sibling; nesting is
 * the only one of the two that's actually reachable in this deployment).
 *
 * ── Keeping nested worktrees invisible to permissions.ts ────────────────
 * `permissions.ts`'s `snapshotRepoState`/`enforceWrites` diff the SAME repo
 * this worktree is nested inside (`opts.cwd`, per that module's own cwd-
 * scoped-by-design docstring) — an untracked `.pi-web-factory-worktrees/`
 * directory sitting inside the project tree would otherwise show up as an
 * untracked path on every single phase's before/after snapshot and get
 * rolled back (deleted) by `enforceWrites` as an unauthorized write, which
 * would be actively destructive here (deleting a worktree out from under
 * its own in-flight session). Two ways to hide a path from git's untracked-
 * file listing: `.gitignore` (tracked, committed, a footprint on every
 * target project) or `.git/info/exclude` (repo-local, NEVER committed, no
 * footprint on the project's own tracked files at all). This module uses
 * `.git/info/exclude` — confirmed live 2026-08-04: with an entry there,
 * neither `git diff HEAD --numstat` nor `git ls-files --others --exclude-
 * standard` (permissions.ts's own two snapshot queries) surface anything
 * under the excluded directory, so it's genuinely invisible to
 * `enforceWrites`, not just hidden from a casual `git status`. Written once,
 * idempotently (a repeat line is harmless but avoided), before the first
 * worktree is ever created for a given project.
 *
 * ── Isolation from a chain's own file operations ────────────────────────
 * Nesting does mean an agent with unrestricted (`writes: null`) file access
 * COULD in principle read/traverse into `.pi-web-factory-worktrees/` if it
 * went looking — no stronger sandbox exists here than anywhere else in this
 * codebase (`permissions.ts`'s own docstring: "`tools:` is a capability
 * list, not a sandbox"). In practice an agent is never told this path exists
 * (it's not part of any prompt), and `enforceWrites`'s allow/deny precedence
 * still applies to whatever it touches there the same as anywhere else in
 * the tree — the `.git/info/exclude` entry only controls whether an
 * UNTOUCHED worktree directory shows up as noise on every snapshot, not
 * whether writes into it are governed. That's an accepted, documented
 * tradeoff, not an oversight.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Subdirectory (relative to a project's main checkout) all run worktrees nest under. */
export const WORKTREE_SUBDIR = ".pi-web-factory-worktrees";

/** Branch namespace prefix — see module docstring. */
export const BRANCH_PREFIX = "pi-web-factory/";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Branch name for a given run id — `pi-web-factory/<adwId>`. */
export function branchNameFor(adwId: string): string {
  return `${BRANCH_PREFIX}${adwId}`;
}

/** Worktree directory (absolute path) for a given run id, nested under `projectPath`. */
export function worktreePathFor(projectPath: string, adwId: string): string {
  return join(projectPath, WORKTREE_SUBDIR, adwId);
}

/**
 * Ensures `WORKTREE_SUBDIR` is excluded from `projectPath`'s own git status
 * (via `.git/info/exclude`, never `.gitignore` — see module docstring),
 * idempotently. Safe to call before every worktree creation; a no-op if the
 * entry is already present.
 */
export function ensureWorktreeDirExcluded(projectPath: string): void {
  const excludePath = join(projectPath, ".git", "info", "exclude");
  const entry = `${WORKTREE_SUBDIR}/`;

  let existing = "";
  if (existsSync(excludePath)) {
    existing = readFileSync(excludePath, "utf8");
    if (existing.split("\n").some((line) => line.trim() === entry)) return; // already present
  } else {
    // `.git/info/` always exists for a real repo (created by `git init`);
    // this mkdir is defensive only, in case some unusual git layout omits it.
    mkdirSync(join(projectPath, ".git", "info"), { recursive: true });
  }

  const needsNewline = existing.length > 0 && !existing.endsWith("\n");
  writeFileSync(excludePath, `${existing}${needsNewline ? "\n" : ""}${entry}\n`);
}

export interface CreateRunWorktreeResult {
  /** Absolute path to the new worktree — use as the chain's `cwd`. */
  path: string;
  /** Branch created for this worktree. */
  branch: string;
}

/**
 * Creates one worktree for a Workflow Run: `git worktree add <path> -b
 * <branch>` at `worktreePathFor(projectPath, adwId)` /
 * `branchNameFor(adwId)`, off `projectPath`'s current `HEAD` (git's own
 * default base for `-b` with no explicit start-point). Ensures the
 * containing subdirectory is excluded first (see
 * `ensureWorktreeDirExcluded`).
 *
 * Throws `WorktreeError` (never a bare `git` stderr dump without context) on
 * any failure — including the case where `adwId`'s worktree/branch already
 * exists (a caller minting a fresh `adwId` per run, as `cli.ts`/
 * `planBuildTest.ts` both do, should never hit this in practice; a
 * `--session-id`-resume run reuses the SAME worktree rather than calling
 * this again — see `chains/planBuildTest.ts`'s wiring).
 */
export function createRunWorktree(projectPath: string, adwId: string): CreateRunWorktreeResult {
  if (!existsSync(join(projectPath, ".git"))) {
    throw new WorktreeError(`${projectPath} does not look like a git checkout (no .git found) — cannot create a worktree`);
  }

  ensureWorktreeDirExcluded(projectPath);

  const path = worktreePathFor(projectPath, adwId);
  const branch = branchNameFor(adwId);

  if (existsSync(path)) {
    throw new WorktreeError(`worktree path ${path} already exists — refusing to overwrite (adwId collision?)`);
  }

  const result = git(projectPath, ["worktree", "add", path, "-b", branch]);
  if (result.status !== 0) {
    throw new WorktreeError(`git worktree add ${path} -b ${branch} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  return { path, branch };
}

export type WorktreeRemovalOutcome =
  | { status: "removed" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; detail: string };

/**
 * Removes a run's worktree — `git worktree remove [--force] <path>` — run
 * from `projectPath` (the main checkout), never from inside the worktree
 * being removed. Does NOT delete the branch (`branchNameFor(adwId)` is left
 * behind on purpose — the branch is the durable, cheap-to-keep artifact;
 * the worktree's checked-out files are the disposable, expensive-to-keep
 * one).
 *
 * NOT called anywhere in this codebase's own chain wiring (`planBuildTest.ts`
 * deliberately never calls this — see that file's own "cleanup policy"
 * comment for the full reasoning: worktrees are kept around after a run for
 * post-hoc inspection, not auto-removed). Exported/tested here for a future
 * cleanup sweep (a separate, explicit tool — not part of this card's scope)
 * or for a caller with a genuinely different policy need.
 *
 * Never throws — a cleanup step failing must not mask/replace the chain's
 * own result. Returns a discriminated outcome instead:
 *   - `"removed"` — worktree gone.
 *   - `"skipped"` — path didn't exist (already removed, or never created);
 *     not an error, just nothing to do.
 *   - `"failed"` — `git worktree remove` itself failed (e.g. uncommitted
 *     changes and `force` was false) — surfaced, never swallowed silently.
 */
export function removeRunWorktree(projectPath: string, worktreePath: string, force: boolean): WorktreeRemovalOutcome {
  if (!existsSync(worktreePath)) {
    return { status: "skipped", reason: "worktree path does not exist" };
  }

  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreePath);

  const result = git(projectPath, args);
  if (result.status !== 0) {
    return { status: "failed", detail: result.stderr.trim() || result.stdout.trim() || "git worktree remove failed" };
  }
  return { status: "removed" };
}

/** Random suffix helper, exported for tests that need a throwaway adwId shape without pulling in the CLI's own minting logic. */
export function randomAdwIdForTests(): string {
  return `adw_${randomBytes(6).toString("hex")}`;
}

/**
 * Resolves the MAIN checkout path for whatever git working tree `cwd` is —
 * `cwd` itself, if it already IS the main checkout, or the main checkout's
 * path if `cwd` is a linked worktree (nested or not). Needed because
 * `PlanBuildTestOptions.cwd` means two different things depending on
 * whether a run is fresh or resumed (see that file's `sessionId` doc
 * comment): on a resume, `cwd` is often already a worktree path, and
 * `ensureProjectRegistered`/`resolveWorkspaceId` both need the PROJECT's
 * main path (what pi-web's own Project registry and `git worktree list`
 * are keyed by), not the worktree's own path, to resolve the right
 * `projectId`/`workspaceId` — registering a worktree path itself as its own
 * separate pi-web Project would be wrong (confirmed live 2026-08-04: a
 * worktree's own path is never equal to any Project's registered `path` in
 * pi-web's data model — `WorkspaceService.list()` is only ever called with
 * the PROJECT's path, and returns per-worktree entries FROM that call, it
 * never treats a worktree as a project of its own).
 *
 * `git rev-parse --git-common-dir` returns `<mainCheckout>/.git` from ANY
 * worktree of that repo, including the main one itself — but git is
 * inconsistent about WHICH form depending on which of those two cases it
 * is: from a linked worktree it returns an absolute, symlink-resolved path;
 * from the main checkout itself it returns a bare relative `.git` (resolved
 * here against the CALLER's own, possibly symlinked, `cwd` — e.g. macOS's
 * `/tmp` -> `/private/tmp`). Confirmed live 2026-08-04 (both forms, from a
 * real repo and a real nested worktree). `realpathSync` on the final result
 * normalizes both cases to the same real path regardless of which form git
 * happened to return, so this function's output is stable no matter which
 * of the two `cwd` might be.
 */
export function resolveMainCheckoutPath(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (result.status !== 0) {
    throw new WorktreeError(`could not resolve git-common-dir for ${cwd}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  const gitCommonDir = result.stdout.trim();
  const absoluteGitDir = gitCommonDir.startsWith("/") ? gitCommonDir : join(cwd, gitCommonDir);
  // absoluteGitDir is always "<mainCheckout>/.git" (git-common-dir names the
  // real .git directory, never a bare repo root) — strip exactly that suffix.
  if (!absoluteGitDir.endsWith("/.git")) {
    throw new WorktreeError(`unexpected git-common-dir shape for ${cwd}: ${gitCommonDir}`);
  }
  return realpathSync(absoluteGitDir.slice(0, -"/.git".length));
}
