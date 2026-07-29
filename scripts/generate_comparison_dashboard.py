#!/usr/bin/env python3
"""Generates docs/comparison-dashboard-<date>.html from catalog/builds/*.yaml.

No dashboard generator script existed anywhere in this repo prior to M-024
(confirmed via `git log` — every prior docs/comparison-dashboard-*.html was
hand-synthesized directly by whatever agent pass produced it, not generated
by a checked-in tool). This script reconstructs one, matching the visual
style/structure of the most recent hand-authored dashboard
(docs/comparison-dashboard-2026-07-28.html) as closely as practical, and is
the vehicle for M-024's explicit "do not ship this tier's data without it"
dashboard requirement: a structurally unmistakable, visually distinct
delineation between the agentic-orchestration-session tier's OBJECTIVE
signals and its LLM-JUDGED signals — the first (and, as of this writing,
only) LLM-judge-derived metric anywhere in this project's dashboard.

This is intentionally NOT a full re-implementation of every section the
hand-authored dashboards have accumulated over time (speed comparison,
resource footprint, data-quality narrative, etc.) — those sections are
prose/analysis written by whoever ran that pass and synthesized findings,
which this script cannot responsibly fabricate. What it DOES generate,
mechanically and correctly from catalog/builds/*.yaml, every time:
  - The agentic-coding-session-*-v1 comparison (M-021: opencode vs Pi,
    per-task pass_count/total_count, wall-clock, terminated_reason) --
    fully objective, matches this project's existing rigor.
  - The agentic-orchestration-session-*-v1 comparison (M-024) -- objective
    signals (5 binary checks) and LLM-judge scores (4 rubric dimensions)
    rendered in CLEARLY SEPARATE, visually distinct blocks per model/harness
    row. This is the section M-024 exists to add.
A human (or a future agent) writing a full synthesized dashboard pass
should run this script to get these two sections right, then hand-compose
the narrative sections (Biggest findings, Speed comparison, etc.) around
it referencing the same style, same as every prior pass in this project's
history has done for the sections that require human/LLM judgment to
write well.

Usage:
    python3 generate_comparison_dashboard.py [--date YYYY-MM-DD] [--output PATH]

Reads catalog/builds/*.yaml, writes to
docs/comparison-dashboard-<date>-agentic-sections.html by default (a
STANDALONE fragment file, not a full page, so it's obvious this needs to
be composed into a real full dashboard pass rather than mistaken for a
complete replacement) -- pass --full-page to instead emit a complete,
self-contained HTML document (used for the M-024 smoke-test worked example
so it can be viewed on its own).
"""
from __future__ import annotations

import argparse
import datetime
import html
import json
from pathlib import Path
from typing import Optional

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILDS_DIR = REPO_ROOT / "catalog" / "builds"
DOCS_DIR = REPO_ROOT / "docs"

AGENTIC_CODING_IDS = {
    "agentic-coding-session-opencode-v1": "opencode",
    "agentic-coding-session-pi-v1": "pi",
}
ORCH_IDS = {
    "agentic-orchestration-session-opencode-v1": "opencode",
    "agentic-orchestration-session-pi-v1": "pi",
}

JUDGE_DIMENSIONS = [
    ("delegation_request_quality", "Delegation quality"),
    ("adaptation_coherence", "Adaptation coherence"),
    ("ask_human_appropriateness", "ask_human appropriateness"),
    ("overall_judgment", "Overall judgment"),
]


def load_builds() -> list:
    """Emit one logical "build" per version entry across every
    catalog/builds/*.yaml family file (M-002: families group a model+engine
    identity's serving-config versions into one file's `versions:` list).
    Each emitted dict is shaped like the old flat per-build dict (`model`
    from the family, plus the version's own fields) so every downstream
    consumer of `_build_id` / `benchmark_runs` here is unaffected by the
    schema change -- `_build_id` is the version's `compose_service_id`,
    which is byte-identical to the old flat file's `id`/filename stem for
    every build migrated by M-002, so existing dashboard rows/labels are
    unchanged."""
    builds = []
    for path in sorted(BUILDS_DIR.glob("*.yaml")):
        family = yaml.safe_load(path.read_text())
        model = family.get("model")
        for version in family.get("versions") or []:
            data = dict(version)
            data["model"] = model
            data["_build_id"] = version.get("compose_service_id")
            builds.append(data)
    return builds


def find_runs(build: dict, benchmark_id: str) -> list:
    return [r for r in (build.get("benchmark_runs") or []) if r.get("benchmark_id") == benchmark_id]


def esc(s) -> str:
    return html.escape(str(s)) if s is not None else ""


# --------------------------------------------------------------------------
# agentic-coding-session-*-v1 (M-021) section -- fully objective, matches
# the project's existing rigor exactly, no delineation needed.
# --------------------------------------------------------------------------

def render_agentic_coding_section(builds: list) -> str:
    rows = []
    for build in builds:
        for benchmark_id, harness in AGENTIC_CODING_IDS.items():
            for run in find_runs(build, benchmark_id):
                result = run.get("result") or {}
                for task_id, task_result in result.items():
                    if not isinstance(task_result, dict):
                        continue
                    rows.append({
                        "build_id": build["_build_id"],
                        "harness": harness,
                        "task_id": task_id,
                        "pass_count": task_result.get("pass_count"),
                        "total_count": task_result.get("total_count"),
                        "wall_clock_s": task_result.get("wall_clock_s"),
                        "terminated_reason": task_result.get("terminated_reason"),
                        "timestamp": run.get("timestamp"),
                    })

    if not rows:
        return (
            '<section id="agentic-coding">\n'
            "  <h2>Agentic-coding-session comparison (M-021)</h2>\n"
            '  <p class="callout">No <code>agentic-coding-session-opencode-v1</code> / '
            '<code>agentic-coding-session-pi-v1</code> runs are recorded in '
            "<code>catalog/builds/*.yaml</code> yet — this section will populate "
            "automatically once the real matrix pass records results.</p>\n"
            "</section>\n"
        )

    body = []
    body.append('<section id="agentic-coding">')
    body.append("  <h2>Agentic-coding-session comparison (M-021) — opencode vs. Pi</h2>")
    body.append(
        "  <p>Fully objective — hidden-test pass_count/total_count per task, "
        "same rigor as every other tier in this project. opencode and Pi are "
        "recorded as separate benchmark_ids and shown side by side here "
        "deliberately (never averaged) so the two harnesses are directly "
        "comparable, not just the models.</p>"
    )
    body.append('  <div class="scroll-x">')
    body.append("  <table>")
    body.append(
        "    <tr><th>Model build</th><th>Harness</th><th>Task</th><th>Pass/Total</th>"
        "<th>Wall clock</th><th>Outcome</th><th>Date</th></tr>"
    )
    for r in sorted(rows, key=lambda r: (r["build_id"], r["task_id"], r["harness"])):
        pct = ""
        if r["pass_count"] is not None and r["total_count"]:
            pct = f" ({100 * r['pass_count'] / r['total_count']:.0f}%)"
        outcome_class = "good" if r["terminated_reason"] == "completed" else "warn"
        body.append(
            f'    <tr><td>{esc(r["build_id"])}</td><td>{esc(r["harness"])}</td>'
            f'<td>{esc(r["task_id"])}</td>'
            f'<td class="num">{esc(r["pass_count"])}/{esc(r["total_count"])}{pct}</td>'
            f'<td class="num">{esc(r["wall_clock_s"])}s</td>'
            f'<td><span class="pill {outcome_class}">{esc(r["terminated_reason"])}</span></td>'
            f'<td class="num">{esc((r["timestamp"] or "")[:10])}</td></tr>'
        )
    body.append("  </table>")
    body.append("  </div>")
    body.append("</section>")
    return "\n".join(body) + "\n"


# --------------------------------------------------------------------------
# agentic-orchestration-session-*-v1 (M-024) section -- THE section this
# script exists to get right: objective and LLM-judged results rendered in
# clearly separate, visually distinct blocks. Never blended into one
# number, never given equal-looking rigor.
# --------------------------------------------------------------------------

def render_orch_row(build_id: str, harness: str, run: dict) -> str:
    result = run.get("result") or {}
    objective = result.get("objective") or {}
    llm_judge = result.get("llm_judge") or {}
    scores = llm_judge.get("scores") or {}

    obj_pass = objective.get("pass_count")
    obj_total = objective.get("total_count")
    obj_pct = f" ({100 * obj_pass / obj_total:.0f}%)" if obj_pass is not None and obj_total else ""
    checks = objective.get("checks") or []
    check_pills = "".join(
        f'<span class="pill {"good" if c.get("passed") else "bad"}" title="{esc(c.get("detail") or c.get("description"))}">'
        f'{esc(c.get("id"))}</span> '
        for c in checks
    )

    judge_error = llm_judge.get("error")
    if judge_error:
        judge_block = f'<div class="callout bad" style="margin:0;">LLM judge error: {esc(judge_error)}</div>'
    elif scores:
        dim_cells = ""
        for key, label in JUDGE_DIMENSIONS:
            dim = scores.get(key) or {}
            score = dim.get("score")
            score_class = "good" if isinstance(score, (int, float)) and score >= 4 else (
                "warn" if isinstance(score, (int, float)) and score == 3 else "bad"
            )
            rationale = esc(dim.get("rationale") or "")
            dim_cells += (
                f'<div class="judge-dim"><span class="judge-dim-label">{esc(label)}</span> '
                f'<span class="pill {score_class}">{esc(score)}/5</span>'
                f'<div class="judge-rationale">{rationale}</div></div>'
            )
        judge_block = dim_cells
    else:
        judge_block = '<span class="pill dim">no judge data</span>'

    wall_clock = result.get("wall_clock_s")
    terminated = result.get("terminated_reason")
    outcome_class = "good" if terminated == "completed" else "warn"

    return f"""    <tr>
      <td>{esc(build_id)}</td>
      <td>{esc(harness)}</td>
      <td class="obj-cell">
        <div class="obj-headline num"><strong>{esc(obj_pass)}/{esc(obj_total)}{obj_pct}</strong></div>
        <div class="obj-checks">{check_pills}</div>
      </td>
      <td class="judge-cell">
        <div class="judge-label-badge">LLM-JUDGED</div>
        {judge_block}
      </td>
      <td class="num">{esc(wall_clock and f"{wall_clock:.0f}s")}</td>
      <td><span class="pill {outcome_class}">{esc(terminated)}</span></td>
      <td class="num">{esc((run.get("timestamp") or "")[:10])}</td>
    </tr>"""


def render_orch_section(builds: list, worked_example: Optional[dict] = None) -> str:
    rows_html = []
    any_real_data = False
    for build in builds:
        for benchmark_id, harness in ORCH_IDS.items():
            for run in find_runs(build, benchmark_id):
                any_real_data = True
                rows_html.append(render_orch_row(build["_build_id"], harness, run))

    worked_example_html = ""
    if worked_example:
        worked_example_html = (
            '  <div class="callout">\n'
            "    <strong>Worked example (M-024 smoke test, not a recorded benchmark_runs[] "
            "entry)</strong> — shown here to demonstrate the objective/LLM-judged rendering "
            "before any real matrix data exists. Real data will replace/join this once "
            "scripts/benchmark_orchestrator.py records actual runs.\n"
            "  </div>\n"
        )
        for entry in worked_example:
            rows_html.append(render_orch_row(entry["build_id"], entry["harness"], entry["run"]))

    if not rows_html:
        return (
            '<section id="orchestration">\n'
            "  <h2>Agentic-orchestration-session comparison (M-024) — HYBRID GRADING</h2>\n"
            '  <p class="callout">No <code>agentic-orchestration-session-opencode-v1</code> / '
            '<code>agentic-orchestration-session-pi-v1</code> runs are recorded yet.</p>\n'
            "</section>\n"
        )

    header_note = "" if any_real_data else worked_example_html

    return f"""<section id="orchestration">
  <h2>Agentic-orchestration-session comparison (M-024) — <span class="hybrid-badge">HYBRID GRADING</span></h2>
  <div class="callout">
    <strong>This tier's grading is deliberately hybrid</strong> — an explicit, documented
    exception to this project's no-LLM-judge-scoring philosophy
    (<code>seven-tier-coding-v2.yaml</code> and every other methodology file are 100%
    objective). Each row below shows TWO structurally separate blocks: an
    <strong>OBJECTIVE</strong> column (5 deterministic binary signals, identical rigor to
    every other tier in this project) and a distinctly-colored <strong>LLM-JUDGED</strong>
    column (a 4-dimension rubric scored by <code>qwen2.5-vl-7b-instruct</code>). These are
    NEVER blended into one number — see
    <code>catalog/benchmarks/agentic-orchestration-session-v1.yaml</code>'s
    <code>grading_philosophy</code> for the full rationale.
  </div>
{header_note}  <div class="scroll-x">
  <table class="orch-table">
    <tr>
      <th>Model build</th><th>Harness</th>
      <th class="obj-header">OBJECTIVE (5 signals)</th>
      <th class="judge-header">LLM-JUDGED (qwen2.5-vl-7b-instruct)</th>
      <th>Wall clock</th><th>Outcome</th><th>Date</th>
    </tr>
{chr(10).join(rows_html)}
  </table>
  </div>
</section>
"""


# --------------------------------------------------------------------------
# CSS additions specific to the orchestration section's objective/LLM-judged
# visual delineation -- appended to the existing dashboard stylesheet
# convention (same variable names/palette as docs/comparison-dashboard-*.html)
# so this fragment drops into an existing dashboard's <style> block cleanly.
# --------------------------------------------------------------------------

ORCH_SECTION_CSS = """
  /* --- M-024 agentic-orchestration-session: objective vs LLM-judged --- */
  .hybrid-badge {
    display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
    padding: 2px 10px; border-radius: 999px; background: rgba(251,191,36,0.18);
    color: var(--warn); vertical-align: middle; margin-left: 4px;
  }
  table.orch-table th.obj-header {
    background: rgba(91,157,255,0.10); color: var(--accent);
  }
  table.orch-table th.judge-header {
    background: rgba(251,191,36,0.14); color: var(--warn);
  }
  table.orch-table td.obj-cell {
    background: rgba(91,157,255,0.06); border-left: 3px solid var(--accent);
    vertical-align: top; white-space: normal; min-width: 220px;
  }
  table.orch-table td.judge-cell {
    background: rgba(251,191,36,0.08); border-left: 3px solid var(--warn);
    vertical-align: top; white-space: normal; min-width: 280px;
  }
  .obj-headline { margin-bottom: 6px; }
  .obj-checks .pill { margin: 2px 3px 2px 0; cursor: help; }
  .judge-label-badge {
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; color: var(--warn);
    margin-bottom: 6px;
  }
  .judge-dim { margin: 6px 0; padding-bottom: 6px; border-bottom: 1px dashed var(--border); }
  .judge-dim:last-child { border-bottom: none; }
  .judge-dim-label { font-size: 12px; color: var(--text-dim); margin-right: 6px; }
  .judge-rationale { font-size: 11.5px; color: var(--text-dim); margin-top: 2px; font-style: italic; }
"""


def render_full_page(date_str: str, builds: list, worked_example: Optional[dict]) -> str:
    coding_section = render_agentic_coding_section(builds)
    orch_section = render_orch_section(builds, worked_example)

    # Minimal standalone page reusing the established dashboard palette
    # (see docs/comparison-dashboard-2026-07-28.html's <style> block) so a
    # standalone --full-page render looks consistent with the rest of the
    # project's dashboards, not a one-off style.
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>local-ai-machine — Agentic-benchmark sections — {date_str}</title>
<style>
  :root {{
    --bg: #0f1216; --bg-card: #171b21; --bg-card-2: #1d2229; --border: #2a2f38;
    --text: #e6e9ef; --text-dim: #9aa4b2; --accent: #5b9dff;
    --good: #4ade80; --warn: #fbbf24; --bad: #f87171;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
          background: var(--bg); color: var(--text); line-height: 1.55; }}
  .wrap {{ max-width: 1180px; margin: 0 auto; padding: 40px 24px 80px; }}
  h1 {{ font-size: 24px; }}
  h2 {{ font-size: 20px; margin: 40px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }}
  p {{ color: var(--text-dim); font-size: 14.5px; }}
  code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em;
          background: var(--bg-card); padding: 1px 5px; border-radius: 4px; color: var(--accent); }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; margin: 14px 0 8px; }}
  th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }}
  th {{ color: var(--text-dim); font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.03em; }}
  td.num {{ font-variant-numeric: tabular-nums; }}
  .pill {{ display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin-left: 2px; white-space: nowrap; }}
  .pill.good {{ background: rgba(74,222,128,0.15); color: var(--good); }}
  .pill.warn {{ background: rgba(251,191,36,0.15); color: var(--warn); }}
  .pill.bad {{ background: rgba(248,113,113,0.15); color: var(--bad); }}
  .pill.dim {{ background: rgba(154,164,178,0.15); color: var(--text-dim); }}
  .callout {{ background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid var(--accent);
              border-radius: 8px; padding: 14px 18px; margin: 16px 0; font-size: 13.5px; color: var(--text-dim); }}
  .callout.bad {{ border-left-color: var(--bad); }}
  .scroll-x {{ overflow-x: auto; }}
{ORCH_SECTION_CSS}
</style>
</head>
<body>
<div class="wrap">
<h1>local-ai-machine — Agentic-benchmark sections (M-021 + M-024)</h1>
<p>Standalone render of the two agentic-benchmark dashboard sections generated by
<code>scripts/generate_comparison_dashboard.py</code> — for composition into a full
comparison dashboard pass, not a replacement for one. Generated {date_str}.</p>
{coding_section}
{orch_section}
</div>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", default=None, help="date string for the output filename/header (default: today, UTC)")
    ap.add_argument("--output", default=None, help="output path (default: docs/comparison-dashboard-<date>-agentic-sections.html)")
    ap.add_argument("--full-page", action="store_true", help="emit a complete standalone HTML document instead of a fragment")
    ap.add_argument("--worked-example-json", default=None,
                    help="path to a JSON file with a list of {build_id, harness, run} entries "
                         "(run = a benchmark_runs[]-shaped dict) to render as a labeled worked "
                         "example when no real orchestration-session data exists yet")
    args = ap.parse_args()

    date_str = args.date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    builds = load_builds()

    worked_example = None
    if args.worked_example_json:
        worked_example = json.loads(Path(args.worked_example_json).read_text())

    if args.full_page:
        content = render_full_page(date_str, builds, worked_example)
    else:
        content = render_agentic_coding_section(builds) + "\n" + render_orch_section(builds, worked_example)

    output_path = Path(args.output) if args.output else DOCS_DIR / f"comparison-dashboard-{date_str}-agentic-sections.html"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
