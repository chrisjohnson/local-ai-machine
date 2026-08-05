/**
 * api.ts: thin fetch wrappers for the `/api/...` routes `visualizer/server.ts`
 * exposes. Field names here match `server.ts`'s `*ToApi` mappers exactly
 * (camelCase) — this is the ONE place the frontend knows about wire shapes.
 */

export interface RunSummary {
  adwId: string;
  adwName: string | null;
  projectCwd: string | null;
  /** Shared, worktree-suffix-stripped project root (see server.ts's `projectRootOf`) — use this for grouping/filtering by project, never `projectCwd` (unique per run). */
  projectRoot: string | null;
  title: string | null;
  request: string | null;
  status: "running" | "success" | "fail" | string | null;
  engineer: string | null;
  startedAt: string | null;
  endedAt: string | null;
  totalTokens: number;
  totalCost: number;
  archived: boolean;
}

export interface Step {
  phaseId: string;
  adwId: string;
  seq: number;
  name: string | null;
  kind: string | null;
  role: string | null;
  description: string | null;
  status: "queued" | "running" | "success" | "fail" | string | null;
  attempt: number;
  retries: number;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  outputSummary: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface RunDetail {
  run: RunSummary;
  steps: Step[];
}

export interface EventRecord {
  rowid: number;
  eventId: string;
  adwId: string;
  phaseId: string | null;
  parentId: string | null;
  type: string | null;
  name: string | null;
  payload: unknown;
  tokens: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`request failed (${String(res.status)}): ${url}`);
  }
  return (await res.json()) as T;
}

export function fetchRuns(project?: string | null): Promise<RunSummary[]> {
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  return getJson<RunSummary[]>(`/api/runs${query}`);
}

export function fetchRunDetail(adwId: string): Promise<RunDetail> {
  return getJson<RunDetail>(`/api/runs/${encodeURIComponent(adwId)}`);
}

export function fetchEventsSince(adwId: string, since: number): Promise<EventRecord[]> {
  return getJson<EventRecord[]>(`/api/runs/${encodeURIComponent(adwId)}/events?since=${String(since)}`);
}
