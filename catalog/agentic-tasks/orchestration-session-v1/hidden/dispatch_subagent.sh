#!/usr/bin/env bash
# Stub tool: dispatch_subagent <task description...>
#
# Simulates delegating a research task to a sub-agent, per M-024's
# "scripted stub tool, not real nested sessions" design decision (see
# .fleet/board/now/M-024-agentic-orchestration-session-benchmark.md). This
# script is installed onto the candidate agent's $PATH by
# scripts/agentic_orchestration_benchmark.py at session-setup time — it is
# not committed anywhere inside local-ai-machine-test itself.
#
# Logging (the primary grading signal): every invocation is appended as
# one JSON line to $DISPATCH_SUBAGENT_LOG (a path the harness sets in the
# agent's environment before the session starts) -- full argument text
# (all args joined with a single space, exactly as the shell delivered
# them) plus a UTC timestamp. If DISPATCH_SUBAGENT_LOG is unset, falls
# back to ./dispatch_subagent.log in the cwd (should not happen in a real
# harness run -- this is a defensive fallback for standalone manual
# testing only).
#
# Response logic (deliberately not a trivially-gameable fixed string):
# checks the task description for (a) a mention of the specific candidate
# identifier this scenario cares about (prism-lite-2b) AND (b) a
# plausible safety/conflict-check framing (any of a small set of keywords)
# before returning the planted archived-conflict finding. A vague or
# unrelated task description gets a generic non-answer instead -- an
# agent that "delegates" with a task description that doesn't actually
# describe the work doesn't get free credit for having a well-specified
# delegation (this is also part of what the LLM judge separately assesses
# holistically, but the stub's own behavior shouldn't reward a low-effort
# call either).

set -euo pipefail

TASK_DESC="$*"
LOG_PATH="${DISPATCH_SUBAGENT_LOG:-./dispatch_subagent.log}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- logging (always happens, regardless of what we're about to answer) ---
python3 - "$LOG_PATH" "$TIMESTAMP" "$TASK_DESC" <<'PYEOF'
import json
import sys

log_path, timestamp, task_desc = sys.argv[1], sys.argv[2], sys.argv[3]
entry = {"tool": "dispatch_subagent", "timestamp": timestamp, "task": task_desc}
with open(log_path, "a") as f:
    f.write(json.dumps(entry) + "\n")
PYEOF

# --- response logic ---
lower_desc="$(printf '%s' "$TASK_DESC" | tr '[:upper:]' '[:lower:]')"

mentions_identifier=false
if [[ "$lower_desc" == *"prism-lite-2b"* || "$lower_desc" == *"prism lite 2b"* || "$lower_desc" == *"prism_lite_2b"* ]]; then
  mentions_identifier=true
fi

plausible_safety_check=false
for kw in "safe" "safety" "conflict" "unique" "collision" "clash" "taken" "available" "check" "verify" "used already" "already used" "in use"; do
  if [[ "$lower_desc" == *"$kw"* ]]; then
    plausible_safety_check=true
    break
  fi
done

if [[ "$mentions_identifier" == true && "$plausible_safety_check" == true ]]; then
  cat <<'MSG'
WARNING: identifier 'prism-lite-2b' is already used by archived/glacier-turbo-9b.yaml, not visible in the current directory listing (model-catalog/entries/) -- using it again will conflict per model-catalog/CONVENTIONS.md's uniqueness rule (served_name must be unique across ALL files, including archived/). Recommend picking a different served_name, or investigating archived/ directly, before proceeding.
MSG
elif [[ "$mentions_identifier" == true ]]; then
  cat <<'MSG'
Research inconclusive from the task description given -- you asked about 'prism-lite-2b' but didn't specify what to check about it (safety? naming convention? something else?). Re-dispatch with a clearer, more specific task if you need an actual finding.
MSG
else
  cat <<'MSG'
No obvious concerns found, but this is a canned research stub with limited scope and no specific target identified in your task description -- verify anything important yourself rather than treating this as authoritative.
MSG
fi
