#!/usr/bin/env python3
"""Coding-capability benchmark harness for local-ai-machine models.

Runs from the Mac (has Python readily available, unlike the target's
minimal NixOS host) against a model's OpenAI-compatible vLLM endpoint
directly. Two objective grading tiers, no LLM-judge scoring:

  Tier A - correctness: extract generated code, execute it against test
  assertions in a sandboxed subprocess, pass/fail.

  Tier B - tool-calling: send a real tool schema, check the response's
  tool_calls field structurally against the expected tool/arguments.

Usage:
  python3 coding_benchmark.py --base-url http://local-ai-machine.local:8000 \
      --model qwen3.6-35b-a3b --output results/qwen3.6-35b-a3b.json

Stdlib only - no external dependencies required.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

SCRATCH_DIR = Path(tempfile.gettempdir()) / "coding-benchmark-sandbox"

TIER_A_TASKS = [
    {
        "id": "palindrome",
        "prompt": (
            "Write a Python function `is_palindrome(s: str) -> bool` that "
            "returns True if the string is a palindrome, ignoring case and "
            "non-alphanumeric characters. Only output the function, no "
            "explanation, no example usage."
        ),
        "test_code": """
assert is_palindrome("A man, a plan, a canal: Panama") == True
assert is_palindrome("race a car") == False
assert is_palindrome("") == True
assert is_palindrome("Was it a car or a cat I saw?") == True
assert is_palindrome("hello") == False
print("OK")
""",
    },
    {
        "id": "merge_sorted",
        "prompt": (
            "Write a Python function `merge_sorted(a: list, b: list) -> list` "
            "that merges two sorted lists of integers into one sorted list, "
            "without using the built-in sort() or sorted(). Only output the "
            "function, no explanation, no example usage."
        ),
        "test_code": """
assert merge_sorted([1, 3, 5], [2, 4, 6]) == [1, 2, 3, 4, 5, 6]
assert merge_sorted([], [1, 2, 3]) == [1, 2, 3]
assert merge_sorted([1, 2, 3], []) == [1, 2, 3]
assert merge_sorted([1, 1, 2], [1, 2, 2]) == [1, 1, 1, 2, 2, 2]
assert merge_sorted([], []) == []
print("OK")
""",
    },
    {
        "id": "expr_eval",
        "prompt": (
            "Write a Python function `evaluate(expr: str) -> float` that "
            "evaluates a simple arithmetic expression string containing +, "
            "-, *, /, parentheses, and integers (no variables, no function "
            "calls). Do not use eval() or exec(). Only output the function, "
            "no explanation, no example usage."
        ),
        "test_code": """
assert evaluate("2 + 3") == 5
assert evaluate("2 + 3 * 4") == 14
assert evaluate("(2 + 3) * 4") == 20
assert evaluate("10 / 2 - 3") == 2
assert abs(evaluate("2 * (3 + (4 - 1))") - 12) < 1e-9
print("OK")
""",
    },
]

TIER_B_TASKS = [
    {
        "id": "single_tool_call",
        "prompt": "Read the file at /tmp/data.txt and summarize its contents.",
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read the contents of a file",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                },
            }
        ],
        "expect_name": "read_file",
        "expect_args": {"path": "/tmp/data.txt"},
    },
    {
        "id": "multi_step_tool_call",
        "prompt": (
            "Write a Python file implementing FizzBuzz to /tmp/fizzbuzz.py, "
            "then run its tests."
        ),
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "write_file",
                    "description": "Write content to a file",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["path", "content"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "run_tests",
                    "description": "Run tests for a given file",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                },
            },
        ],
        # Only the first call is graded — correct sequencing (write before
        # test) matters more here than whether it eventually also calls
        # run_tests, and grading just the first call keeps this objective
        # rather than needing to simulate a full multi-turn tool exchange.
        "expect_name": "write_file",
        "expect_args_contains": {"path": "/tmp/fizzbuzz.py"},
    },
]


def call_model(base_url, model, prompt, tools=None, max_tokens=1024, timeout=900):
    # 900s: at an 8192-token Tier A budget, the 122B tier's observed
    # 7.87 tok/s single-stream speed alone could take 15+ minutes for a
    # response that actually uses the full budget — this needs real
    # headroom, not just enough for the faster models.
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read())
    elapsed = time.monotonic() - start
    return body, elapsed


def extract_code(text):
    """Pull python out of the LAST markdown fence — models sometimes show
    a draft before a final version, so the last block is the safer bet
    than the first. Falls back to the raw text if no fence is found."""
    matches = re.findall(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    return matches[-1] if matches else text


def run_tier_a_task(base_url, model, task):
    result = {"id": task["id"], "tier": "A"}
    try:
        # 8192, not 1024: these are reasoning models (Qwen3.6 native
        # thinking mode) — a too-small budget gets burned entirely on the
        # reasoning trace, leaving `content` null/truncated before the
        # model ever reaches the actual answer. Confirmed directly twice:
        # at 1024 tokens, 3/3 tasks failed outright; at 3072, the hardest
        # task (expr_eval) still failed with the model 11,941 characters
        # into its reasoning trace (tracing through test cases by hand)
        # and still not done. Correctness of the comparison matters more
        # here than runtime, so erring generous rather than risk another
        # false failure from budget starvation, not genuine incapability.
        resp, elapsed = call_model(base_url, model, task["prompt"], max_tokens=8192)
        message = resp["choices"][0]["message"]
        content = message.get("content") or ""
        result["elapsed_s"] = round(elapsed, 2)
        result["raw_content"] = content
        result["raw_reasoning"] = message.get("reasoning_content") or message.get("reasoning")
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as e:
        result.update(passed=False, error=f"request failed: {e}")
        return result

    code = extract_code(content)
    result["extracted_code"] = code
    full_source = code + "\n\n" + task["test_code"]

    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, dir=SCRATCH_DIR
    ) as f:
        f.write(full_source)
        script_path = f.name

    try:
        proc = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=SCRATCH_DIR,
        )
        result["passed"] = proc.returncode == 0 and "OK" in proc.stdout
        if not result["passed"]:
            result["error"] = (proc.stderr or proc.stdout or "unknown failure")[-2000:]
    except subprocess.TimeoutExpired:
        result["passed"] = False
        result["error"] = "execution timed out (10s)"
    finally:
        Path(script_path).unlink(missing_ok=True)

    return result


def run_tier_b_task(base_url, model, task):
    result = {"id": task["id"], "tier": "B"}
    try:
        # 2048, not 512: same root cause as Tier A's budget bug - reasoning
        # models can burn the whole budget on their thinking trace before
        # ever emitting a tool_calls entry. Confirmed directly: a run against
        # qwen3.6-35b-a3b produced a fully-correct reasoning trace for
        # multi_step_tool_call (correctly planning to write FizzBuzz +
        # tests) but hit the 512-token cap before emitting the actual call,
        # leaving tool_calls empty.
        resp, elapsed = call_model(
            base_url, model, task["prompt"], tools=task["tools"], max_tokens=2048
        )
        result["elapsed_s"] = round(elapsed, 2)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        result.update(passed=False, error=f"request failed: {e}")
        return result

    try:
        msg = resp["choices"][0]["message"]
        tool_calls = msg.get("tool_calls") or []
    except KeyError as e:
        result.update(passed=False, error=f"malformed response: {e}")
        return result

    if not tool_calls:
        result.update(passed=False, error="no tool_calls in response",
                       raw_message=msg)
        return result

    first_call = tool_calls[0]["function"]
    name = first_call.get("name")
    try:
        args = json.loads(first_call.get("arguments", "{}"))
    except json.JSONDecodeError:
        result.update(passed=False, error="tool call arguments not valid JSON",
                       raw_arguments=first_call.get("arguments"))
        return result

    result["called_tool"] = name
    result["called_args"] = args

    if name != task["expect_name"]:
        result["passed"] = False
        result["error"] = f"expected tool '{task['expect_name']}', got '{name}'"
        return result

    if "expect_args" in task:
        if args != task["expect_args"]:
            result["passed"] = False
            result["error"] = f"expected args {task['expect_args']}, got {args}"
            return result
    elif "expect_args_contains" in task:
        missing = {
            k: v for k, v in task["expect_args_contains"].items()
            if args.get(k) != v
        }
        if missing:
            result["passed"] = False
            result["error"] = f"args missing/mismatched: {missing}, got {args}"
            return result

    result["passed"] = True
    return result


def run_all(base_url, model):
    results = []
    for task in TIER_A_TASKS:
        print(f"  [Tier A] {task['id']}...", end=" ", flush=True)
        r = run_tier_a_task(base_url, model, task)
        print("PASS" if r.get("passed") else f"FAIL ({r.get('error', '?')[:80]})")
        results.append(r)
    for task in TIER_B_TASKS:
        print(f"  [Tier B] {task['id']}...", end=" ", flush=True)
        r = run_tier_b_task(base_url, model, task)
        print("PASS" if r.get("passed") else f"FAIL ({r.get('error', '?')[:80]})")
        results.append(r)
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", required=True, help="e.g. http://local-ai-machine.local:8000")
    ap.add_argument("--model", required=True, help="served-model-name")
    ap.add_argument("--output", required=True, help="path to write JSON results")
    args = ap.parse_args()

    print(f"Running coding-capability benchmark against {args.model} @ {args.base_url}")
    results = run_all(args.base_url, args.model)

    tier_a_pass = sum(1 for r in results if r["tier"] == "A" and r.get("passed"))
    tier_b_pass = sum(1 for r in results if r["tier"] == "B" and r.get("passed"))
    summary = {
        "model": args.model,
        "base_url": args.base_url,
        "tier_a_pass": tier_a_pass,
        "tier_a_total": len(TIER_A_TASKS),
        "tier_b_pass": tier_b_pass,
        "tier_b_total": len(TIER_B_TASKS),
        "results": results,
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))

    print(f"\nTier A: {tier_a_pass}/{len(TIER_A_TASKS)}  Tier B: {tier_b_pass}/{len(TIER_B_TASKS)}")
    print(f"Results written to {out_path}")


if __name__ == "__main__":
    main()
