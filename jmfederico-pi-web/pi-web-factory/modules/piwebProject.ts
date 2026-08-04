/**
 * piwebProject: registers a target project with pi-web's own `Project`
 * primitive, purely to obtain a real `projectId` and, from there, a real
 * `workspaceId` for a given filesystem path — M-071 card, Plan items 1+3.
 *
 * ── Why this exists (and why it's NOT config, again) ────────────────────
 * `pi-web-adw-design.md` §6.2 already ruled pi-web's Project concept out as
 * a place to store pi-web-factory's OWN config (`<project>/.pi-web-
 * factory.yaml`, M-070, is the real answer to that). This module exists for
 * a completely different reason: pi-web-factory needs *some* `projectId` to
 * build a working session deep-link
 * (`?project=<id>&workspace=<id>&session=<id>`, confirmed §6.2/§6.3 — a bare
 * `session` id does nothing, the client router short-circuits before
 * reading it if `project` is absent) and to resolve a `workspaceId` for a
 * freshly `git worktree add`-created path via the real route this module
 * also wraps, `GET /projects/:projectId/workspaces` (confirmed live against
 * the running server 2026-08-04 — see this file's `resolveWorkspaceId` doc
 * comment for the full trail; `pi-web-adw-design.md` §6.2's "trace it" note
 * is now resolved).
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 * `POST /projects` is ALREADY idempotent server-side by path (confirmed
 * live: re-POSTing the same `path` returns the existing project unchanged,
 * not a duplicate — see `ProjectStore`/`ProjectService.add` in pi-web's own
 * source, `src/server/projects/projectService.ts`). This module still does
 * its own `GET /projects` + find-by-path lookup FIRST, per the card's
 * explicit ask, rather than relying solely on that server-side behavior —
 * cheaper (no write) in the overwhelmingly common case of an
 * already-registered project, and keeps this module correct even if that
 * server-side dedup behavior is ever tightened/loosened upstream.
 */

import { PiWebClientError } from "./piwebClient.ts";

export interface PiWebProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface PiWebWorkspace {
  id: string;
  projectId: string;
  path: string;
  label: string;
  branch?: string;
  isMain: boolean;
  isGitRepo: boolean;
  isGitWorktree: boolean;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as Record<string, unknown>)["error"] === "string"
        ? ((body as Record<string, unknown>)["error"] as string)
        : text || res.statusText;
    throw new PiWebClientError(`pi-web request failed (${String(res.status)}): ${detail}`, res.status);
  }
  return body as T;
}

/** `GET /projects` — every project pi-web currently knows about. */
export async function listProjects(baseUrl: string): Promise<PiWebProject[]> {
  return requestJson<PiWebProject[]>(`${baseUrl}/projects`);
}

/**
 * Idempotent project registration by absolute path: `GET /projects`, return
 * the existing entry if one already has this exact `path`; otherwise
 * `POST /projects {path}` and return the newly-created entry.
 *
 * `path` must already be the project's real, absolute, on-disk path (the
 * MAIN worktree — the checkout `git worktree list` is run against, not any
 * one linked worktree) — this module does no path normalization of its own
 * beyond what pi-web's own `POST /projects` does server-side (`realpath`,
 * confirmed in `projectService.ts`).
 */
export async function ensureProjectRegistered(baseUrl: string, path: string): Promise<{ projectId: string }> {
  const existing = await listProjects(baseUrl);
  const found = existing.find((p) => p.path === path);
  if (found) return { projectId: found.id };

  const created = await requestJson<PiWebProject>(`${baseUrl}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return { projectId: created.id };
}

/**
 * `GET /projects/:projectId/workspaces` — the real route (confirmed live
 * 2026-08-04 against `http://192.168.1.21:8080/api`, cross-checked against
 * `@jmfederico/pi-web@v1.202607.3` source: registered in
 * `src/server/app.ts`'s `registerLocalProjectRoutes`, backed by
 * `WorkspaceService.list()` in `src/server/workspaces/workspaceService.ts`).
 * Pi-web's own workspace `id` is a deterministic
 * `sha1("<projectId>:<worktreePath>").slice(0,12)` (see that file), so it's
 * technically computable client-side without a network call — this module
 * deliberately does NOT do that: hand-deriving pi-web's own internal id
 * function would silently break the moment that implementation detail
 * changes upstream, for a call that's already cheap (one GET, and only
 * needed once per Workflow Run). Resolving it via the real route, as this
 * function does, is both correct AND future-proof against that.
 *
 * `WorkspaceService.list()` discovers workspaces by running
 * `git worktree list --porcelain` against the PROJECT's own registered path
 * (the main checkout), not the queried path — so a `git worktree add`-created
 * path only shows up here once it's a real, live worktree of that same repo
 * (confirmed live: a fresh `git worktree add` inside a project's checkout is
 * visible via this route immediately, no extra registration step).
 *
 * Returns `undefined` if no workspace with exactly this `path` is found
 * (e.g. called before the worktree was actually created, or the project's
 * main path is wrong) — callers should treat that as a real error, not
 * silently proceed without a workspace id (a deep-link missing `workspace`
 * is not "close enough," per §6.2/§6.3).
 */
export async function resolveWorkspaceId(
  baseUrl: string,
  projectId: string,
  worktreePath: string,
): Promise<string | undefined> {
  const workspaces = await requestJson<PiWebWorkspace[]>(`${baseUrl}/projects/${encodeURIComponent(projectId)}/workspaces`);
  return workspaces.find((w) => w.path === worktreePath)?.id;
}
