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
  /** M-103: the ticket this run belongs to — every run has exactly one, always. */
  ticketId: string | null;
  /** Always present on `/api/runs` list responses now (batched server-side, one extra query for the whole page — see server.ts's `runsToApi`), so every grid card can render its mini-Gantt up front, not just running ones. */
  steps: Step[];
}

/**
 * M-103: one ticket, as returned by `GET /api/tickets` — the grid's
 * ticket-level card data. `latestRun` is the SAME `RunSummary` shape a bare
 * run card already renders (steps included), so the grid can reuse its
 * existing run-card markup unchanged for a ticket's latest attempt; `null`
 * only in the defensive edge case of a ticket with no linked runs at all
 * (see server.ts's own doc comment on this — shouldn't happen in practice).
 * `runCount` tells the grid whether to show the arrow-paging affordance at
 * all (no arrows for a ticket with exactly one attempt).
 */
export interface TicketSummary {
  ticketId: string;
  filePath: string | null;
  createdAt: string | null;
  title: string | null;
  latestRun: RunSummary | null;
  runCount: number;
}

/** M-103: one ticket's FULL attempt history, as returned by `GET /api/tickets/:ticketId` — every linked run's complete summary (steps included), most recent first. The arrow-paging affordance's data source on both the grid card and the ticket detail page. */
export interface TicketDetail {
  ticketId: string;
  filePath: string | null;
  createdAt: string | null;
  title: string | null;
  runs: RunSummary[];
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

/** M-103: the grid's own data source — one row per TICKET, not per run. */
export function fetchTickets(project?: string | null): Promise<TicketSummary[]> {
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  return getJson<TicketSummary[]>(`/api/tickets${query}`);
}

/** M-103: one ticket's full attempt history — arrow-paging data source for both the grid card and the ticket detail page. */
export function fetchTicketDetail(ticketId: string): Promise<TicketDetail> {
  return getJson<TicketDetail>(`/api/tickets/${encodeURIComponent(ticketId)}`);
}

export function fetchEventsSince(adwId: string, since: number): Promise<EventRecord[]> {
  return getJson<EventRecord[]>(`/api/runs/${encodeURIComponent(adwId)}/events?since=${String(since)}`);
}
