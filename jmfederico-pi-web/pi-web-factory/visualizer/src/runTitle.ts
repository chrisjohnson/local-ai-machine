/**
 * runTitle.ts: display-layer-only title fallback (spec section 2).
 *
 * `sessions.title` is currently always `null` for every real run — nothing
 * populates it yet (separate, not-yet-done upstream work; confirmed live
 * 2026-08-05). `sessions.request` (the original task prompt) IS always
 * populated and is what a human would actually recognize a run by. This is
 * a display-only fix: `modules/tracer.ts`/`workflow.ts` and the trace db
 * itself are untouched — only how the frontend CHOOSES what to show changes.
 *
 * Precedence: `run.title` if present, else `run.request` (the task prompt
 * text), else `run.adwId` as the last resort (always present).
 *
 * Long text is truncated via CSS (`.run-title`'s `text-overflow: ellipsis`),
 * not here — more robust across different card widths than a JS string
 * truncation. Callers should also set the untruncated string as a native
 * `title=""` attribute for hover tooltips.
 */

export function runTitle(run: { title: string | null; request: string | null; adwId: string }): string {
  if (run.title) return run.title;
  if (run.request) return run.request;
  return run.adwId;
}
