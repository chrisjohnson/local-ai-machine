/**
 * Unit tests for piwebProject.ts's pure request-shaping logic, against a
 * mocked `fetch` (same pattern as run.test.ts/piwebClient.test.ts) — no live
 * server needed. Live end-to-end coverage (a real project registered, a real
 * worktree's workspace id resolved) lives in
 * chains/planBuildTest.integration.test.ts (M-071).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureProjectRegistered, listProjects, resolveWorkspaceId } from "./piwebProject.ts";
import { PiWebClientError } from "./piwebClient.ts";

const BASE_URL = "http://fake-pi-web.test/api";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── ensureProjectRegistered ──────────────────────────────────────────────

describe("ensureProjectRegistered", () => {
  test("returns the existing project's id when GET /projects already has this path — never POSTs", async () => {
    let postCalled = false;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/projects") && (init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify([
            { id: "proj_existing", name: "existing", path: "/tmp/my-project", createdAt: "2026-01-01T00:00:00Z" },
          ]),
          { status: 200 },
        );
      }
      if (url.endsWith("/projects") && init?.method === "POST") {
        postCalled = true;
        throw new Error("should not POST when a matching project already exists");
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const result = await ensureProjectRegistered(BASE_URL, "/tmp/my-project");
    expect(result.projectId).toBe("proj_existing");
    expect(postCalled).toBe(false);
  });

  test("POSTs a new project when no existing entry matches the path, and returns its id", async () => {
    let postBody: unknown;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/projects") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/projects") && init?.method === "POST") {
        postBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ id: "proj_new", name: "new", path: "/tmp/my-new-project", createdAt: "2026-01-01T00:00:00Z" }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const result = await ensureProjectRegistered(BASE_URL, "/tmp/my-new-project");
    expect(result.projectId).toBe("proj_new");
    expect(postBody).toEqual({ path: "/tmp/my-new-project" });
  });

  test("matches by EXACT path — a project at a different path is not treated as already-registered", async () => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/projects") && (init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify([{ id: "proj_other", name: "other", path: "/tmp/other-project", createdAt: "2026-01-01T00:00:00Z" }]),
          { status: 200 },
        );
      }
      if (url.endsWith("/projects") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ id: "proj_new", name: "new", path: "/tmp/my-project", createdAt: "2026-01-01T00:00:00Z" }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const result = await ensureProjectRegistered(BASE_URL, "/tmp/my-project");
    expect(result.projectId).toBe("proj_new");
  });

  test("a non-2xx response surfaces as PiWebClientError, not a swallowed failure", async () => {
    globalThis.fetch = (async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as typeof fetch;
    await expect(ensureProjectRegistered(BASE_URL, "/tmp/x")).rejects.toThrow(PiWebClientError);
  });
});

// ── listProjects ─────────────────────────────────────────────────────────

describe("listProjects", () => {
  test("returns the parsed project array", async () => {
    globalThis.fetch = (async (_input: string | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify([{ id: "p1", name: "a", path: "/a", createdAt: "2026-01-01T00:00:00Z" }]),
        { status: 200 },
      )) as typeof fetch;
    const result = await listProjects(BASE_URL);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("p1");
  });
});

// ── resolveWorkspaceId ───────────────────────────────────────────────────

describe("resolveWorkspaceId", () => {
  test("returns the workspace id whose path exactly matches", async () => {
    globalThis.fetch = (async (input: string | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe(`${BASE_URL}/projects/proj_1/workspaces`);
      return new Response(
        JSON.stringify([
          { id: "ws_main", projectId: "proj_1", path: "/tmp/proj", label: "master", isMain: true, isGitRepo: true, isGitWorktree: true },
          {
            id: "ws_run",
            projectId: "proj_1",
            path: "/tmp/proj/.pi-web-factory-worktrees/adw_abc123",
            label: "pi-web-factory/adw_abc123",
            isMain: false,
            isGitRepo: true,
            isGitWorktree: true,
          },
        ]),
        { status: 200 },
      );
    }) as typeof fetch;

    const id = await resolveWorkspaceId(BASE_URL, "proj_1", "/tmp/proj/.pi-web-factory-worktrees/adw_abc123");
    expect(id).toBe("ws_run");
  });

  test("returns undefined when no workspace matches the given path", async () => {
    globalThis.fetch = (async (_input: string | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify([
          { id: "ws_main", projectId: "proj_1", path: "/tmp/proj", label: "master", isMain: true, isGitRepo: true, isGitWorktree: true },
        ]),
        { status: 200 },
      )) as typeof fetch;

    const id = await resolveWorkspaceId(BASE_URL, "proj_1", "/tmp/proj/.pi-web-factory-worktrees/adw_nonexistent");
    expect(id).toBeUndefined();
  });
});
