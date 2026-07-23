#!/usr/bin/env python3
"""Coding-capability and role-fitness benchmark harness for local-ai-machine
models.

Runs from the Mac (has Python readily available, unlike the target's
minimal NixOS host) against a model's OpenAI-compatible vLLM endpoint
directly. Six objective grading tiers, no LLM-judge scoring (a model
judging another model's open-ended output would be exactly the kind of
unreliable circularity this harness is designed to avoid):

  Tier A - correctness: extract generated code, execute it against test
  assertions in a sandboxed subprocess, pass/fail.

  Tier B - tool-calling: send a real tool schema, check the response's
  tool_calls field structurally against the expected tool/arguments.

  Tier J - judge-role fitness: give the model a rubric plus a code sample
  (one correct, one deliberately buggy) and require a strict-JSON verdict.
  Grades both the ability to follow a structured-output contract (what
  Turnstone's safety judge actually needs) and whether the verdict itself
  is right in both directions, catching a degenerate "always pass" or
  "always fail" judge that a single-sample test would miss.

  Tier P - personal-assistant fitness: instruction-following and
  extraction tasks representative of general-assistant use (not coding) —
  a constrained-length summary and a structured-data extraction — graded
  objectively since the input and expected output are both fully known.

  Tier D - long-running interactive debugging: a real multi-turn
  conversation (not single-shot) where each user turn reveals a new clue
  about a planted bug, testing whether context threads correctly across
  many messages. Graded the same way as Tier A — execute the FINAL turn's
  code against known-correct test assertions — since "did it actually fix
  the bug after the whole conversation" is the only fully objective signal
  available for a multi-turn exchange; grading intermediate turns would
  need judging open-ended reasoning quality, which this harness avoids.

  Tier Q - planning/requirements-gathering ("grill me") fitness: give the
  model a deliberately underspecified project brief with known-missing
  critical details (audience, tech constraints, timeline, budget, success
  criteria, etc.) and check whether its response actually asks about a
  minimum number of those missing dimensions via keyword matching, rather
  than diving in and inventing assumptions. Heuristic (keyword presence
  isn't a perfect proxy for "asked a good question"), but deterministic
  and directionally meaningful, same tradeoff already accepted for Tier P.

All tiers run against every model by default so any model later being
considered for the judge or assistant role (not just the coding role)
already has this data on hand, rather than needing a special-cased re-run.

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

TIER_J_TASKS = [
    {
        "id": "judge_correct",
        "prompt": (
            "You are a code-review judge. Given a rubric and a code "
            "sample, decide whether the sample satisfies the rubric. "
            "Respond with ONLY a JSON object of the form "
            '{"passes": true or false, "reason": "one short sentence"}. '
            "No other text.\n\n"
            "Rubric: the function must return True only for strings that "
            "are palindromes (ignoring case and non-alphanumeric "
            "characters), and False otherwise.\n\n"
            "Code:\n"
            "def is_palindrome(s: str) -> bool:\n"
            "    cleaned = [c.lower() for c in s if c.isalnum()]\n"
            "    return cleaned == cleaned[::-1]\n"
        ),
        "expect_passes": True,
    },
    {
        "id": "judge_incorrect",
        # Deliberately buggy: slices off the last character before
        # comparing, so it silently accepts some non-palindromes and
        # rejects some real palindromes — subtle enough that a judge
        # skimming for "looks plausible" rather than reasoning about it
        # would default to passing it.
        "prompt": (
            "You are a code-review judge. Given a rubric and a code "
            "sample, decide whether the sample satisfies the rubric. "
            "Respond with ONLY a JSON object of the form "
            '{"passes": true or false, "reason": "one short sentence"}. '
            "No other text.\n\n"
            "Rubric: the function must return True only for strings that "
            "are palindromes (ignoring case and non-alphanumeric "
            "characters), and False otherwise.\n\n"
            "Code:\n"
            "def is_palindrome(s: str) -> bool:\n"
            "    cleaned = [c.lower() for c in s if c.isalnum()]\n"
            "    return cleaned[:-1] == cleaned[::-1][:-1]\n"
        ),
        "expect_passes": False,
    },
]

TIER_P_TASKS = [
    {
        "id": "constrained_summary",
        "prompt": (
            "Summarize the following text in EXACTLY two sentences, no "
            "more, no fewer. Output only the summary, nothing else.\n\n"
            "Text: The Bosgame M5 is a mini PC built around AMD's Strix "
            "Halo APU, which pairs a Zen 5 CPU with an RDNA 3.5 "
            "integrated GPU and shares up to 128GB of unified LPDDR5X "
            "memory between them. Because the GPU can address a large "
            "pool of that unified memory directly, the machine can load "
            "large language models that would normally require a "
            "dedicated GPU with substantial VRAM, making it an unusually "
            "capable platform for local AI inference despite having no "
            "discrete graphics card at all."
        ),
        "expect_sentence_count": 2,
    },
    {
        "id": "structured_extraction",
        "prompt": (
            "Extract the order details from the text below into a JSON "
            "object with exactly these keys: order_id (string), "
            "total_usd (number), item_count (integer). Respond with ONLY "
            "the JSON object, no other text.\n\n"
            "Text: Order confirmation #A-58291 has shipped. Your package "
            "contains 3 items and the total charge was $47.50."
        ),
        "expect_fields": {
            "order_id": "A-58291",
            "total_usd": 47.50,
            "item_count": 3,
        },
    },
]

TIER_D_TASKS = [
    {
        "id": "debug_off_by_one",
        # Scripted "human" side of a real debugging back-and-forth: each
        # turn narrows the bug down further, the way an actual interactive
        # session would, rather than dumping the whole diagnosis up front.
        #
        # Deliberately a per-element boolean flag (1:1 input:output length),
        # not a "combine adjacent elements" transform - an earlier version
        # of this task used a combine/merge function, and a live test
        # against qwen3.6-35b-a3b produced a *plausible alternative*
        # algorithm (consuming index pairs, i += 2) that changed the output
        # length instead of just adding a bounds check. That wasn't a
        # harness bug - the original task genuinely had no single "correct"
        # fix without pinning down more spec than the conversation gave it.
        # A 1:1 per-element flag has no such ambiguity: the only defensible
        # fix is a bounds check at the true boundary case, and turn 3 below
        # pins down the one remaining open question (what to return when
        # there's no next element to compare against) explicitly, so
        # there's exactly one correct answer to grade against.
        "turns": [
            (
                "I've got a function that flags whether a big value (over "
                "100) is immediately followed by a smaller one - a 'drop' "
                "- but it sometimes crashes on real data even though it "
                "passes my basic tests. Here's the code:\n\n"
                "def flag_big_drops(orders):\n"
                "    results = []\n"
                "    for i in range(len(orders)):\n"
                "        if orders[i] > 100:\n"
                "            results.append(orders[i] > orders[i+1])\n"
                "        else:\n"
                "            results.append(False)\n"
                "    return results\n\n"
                "What's going on?"
            ),
            (
                "I added some print statements and reproduced it: "
                "flag_big_drops([50, 90, 150]) throws IndexError: list "
                "index out of range. But flag_big_drops([50, 150, 90]) "
                "works fine and returns [False, True, False]. Does that "
                "help narrow it down?"
            ),
            (
                "That matches what I'm seeing. When there's no next "
                "element to compare against, treat it as not a drop "
                "(False). Please give me the complete corrected function "
                "so I can drop it in directly — respond with ONLY the "
                "corrected Python function definition, no explanation, no "
                "example usage."
            ),
        ],
        "test_code": """
assert flag_big_drops([50, 90, 150]) == [False, False, False]
assert flag_big_drops([50, 150, 90]) == [False, True, False]
assert flag_big_drops([150, 90]) == [True, False]
assert flag_big_drops([150]) == [False]
assert flag_big_drops([]) == []
assert flag_big_drops([200, 50, 300]) == [True, False, False]
print("OK")
""",
    },
]

TIER_Q_TASKS = [
    {
        "id": "planning_new_tool",
        "prompt": "I want to build a new internal tool for our team. Help me plan it out.",
        # Each topic is a critical planning dimension deliberately omitted
        # from the brief above; a keyword hit anywhere in the response is
        # treated as "asked about this dimension." Substrings are matched
        # case-insensitively, so keep them lowercase.
        "topics": {
            "users": ["user", "audience", "who will use", "who's using", "stakeholder"],
            "tech_stack": ["language", "tech stack", "framework", "technology", "platform"],
            "timeline": ["deadline", "timeline", "when do you need", "launch", "ship by", "due date"],
            "budget": ["budget", "resource", "team size", "headcount", "cost"],
            "success_criteria": ["success look", "metric", "goal", "measure success", "kpi"],
        },
        "expect_min_topics": 3,
    },
    {
        "id": "planning_db_migration",
        "prompt": "I want to migrate our database from Postgres to a new system. Help me plan it out.",
        "topics": {
            "motivation": ["why", "pain point", "problem you're", "reason for", "motivat"],
            "scale": ["how much data", "data size", "volume", "how large", "rows", "gb", "tb"],
            "downtime": ["downtime", "outage", "availability", "cutover"],
            "timeline": ["timeline", "deadline", "when", "schedule"],
            "rollback": ["rollback", "revert", "fallback", "contingency", "roll back"],
        },
        "expect_min_topics": 3,
    },
]


def call_model(base_url, model, prompt=None, messages=None, tools=None, max_tokens=1024, timeout=1500):
    # 1500s: 900s undershot in practice - confirmed directly against the
    # 122B tier generating at ~7.5-8 tok/s, where an 8192-token Tier A
    # response needs ~18 minutes just for a legitimate full-length answer,
    # already past the old 900s/15min cap before counting TTFT/variance.
    # 1500s (25min) leaves real margin for the slowest model tested.
    payload = {
        "model": model,
        "messages": messages if messages is not None else [{"role": "user", "content": prompt}],
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


def extract_json(text):
    """Pull the LAST {...} block out of free-form text — same rationale
    as extract_code: models sometimes narrate before/after the JSON
    despite being told not to, and reasoning models may also echo a draft
    JSON object inside their thinking trace before the final one."""
    matches = re.findall(r"\{.*?\}", text, re.DOTALL)
    if not matches:
        raise json.JSONDecodeError("no JSON object found", text, 0)
    return json.loads(matches[-1])


def execute_code_test(code, test_code):
    """Write generated code + known-correct test assertions to a sandboxed
    temp file, execute it, and return (passed, error). Shared by Tier A
    (single-shot code generation) and Tier D (final turn of a multi-turn
    debugging conversation) — same objective grading mechanism either way."""
    full_source = code + "\n\n" + test_code
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
        passed = proc.returncode == 0 and "OK" in proc.stdout
        error = None if passed else (proc.stderr or proc.stdout or "unknown failure")[-2000:]
    except subprocess.TimeoutExpired:
        passed = False
        error = "execution timed out (10s)"
    finally:
        Path(script_path).unlink(missing_ok=True)

    return passed, error


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
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        # TimeoutError (not just urllib.error.URLError): a read-phase
        # socket timeout during http.client.getresponse() propagates as a
        # raw TimeoutError, not wrapped in URLError - confirmed directly,
        # this crashed the whole harness (killing every other task's
        # result) the first time a request genuinely ran past the timeout.
        result.update(passed=False, error=f"request failed: {e}")
        return result

    code = extract_code(content)
    if not code.strip() and result.get("raw_reasoning"):
        # `content` can come back empty even at an 8192-token budget if the
        # model spins excessively on an easy task and never exits its
        # thinking block - confirmed directly (27,438-char reasoning trace
        # on the trivial palindrome task, correct code visible inside it
        # multiple times, budget exhausted before ever emitting `content`).
        # The reasoning trace still contains a real answer worth grading,
        # so fall back to extracting from it instead of failing outright.
        code = extract_code(result["raw_reasoning"])
    result["extracted_code"] = code
    result["passed"], error = execute_code_test(code, task["test_code"])
    if error:
        result["error"] = error

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
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
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


def run_tier_j_task(base_url, model, task):
    result = {"id": task["id"], "tier": "J"}
    try:
        # Same reasoning-budget-exhaustion pattern as Tiers A/B - a judge
        # verdict is short, but a reasoning model can still burn a lot of
        # its budget deliberating before emitting the JSON.
        resp, elapsed = call_model(base_url, model, task["prompt"], max_tokens=2048)
        message = resp["choices"][0]["message"]
        content = message.get("content") or ""
        result["elapsed_s"] = round(elapsed, 2)
        result["raw_content"] = content
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        result.update(passed=False, error=f"request failed: {e}")
        return result

    try:
        verdict = extract_json(content)
    except json.JSONDecodeError:
        reasoning = message.get("reasoning_content") or message.get("reasoning")
        if reasoning:
            try:
                verdict = extract_json(reasoning)
            except json.JSONDecodeError:
                result.update(passed=False, error="no valid JSON verdict found")
                return result
        else:
            result.update(passed=False, error="no valid JSON verdict found")
            return result

    if "passes" not in verdict or not isinstance(verdict["passes"], bool):
        result.update(passed=False, error=f"missing/non-bool 'passes' field: {verdict}")
        return result

    result["verdict"] = verdict
    result["passed"] = verdict["passes"] == task["expect_passes"]
    if not result["passed"]:
        result["error"] = f"expected passes={task['expect_passes']}, got {verdict['passes']}"
    return result


def run_tier_p_task(base_url, model, task):
    result = {"id": task["id"], "tier": "P"}
    try:
        resp, elapsed = call_model(base_url, model, task["prompt"], max_tokens=2048)
        message = resp["choices"][0]["message"]
        content = (message.get("content") or "").strip()
        result["elapsed_s"] = round(elapsed, 2)
        result["raw_content"] = content
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        result.update(passed=False, error=f"request failed: {e}")
        return result

    if not content and (message.get("reasoning_content") or message.get("reasoning")):
        content = (message.get("reasoning_content") or message.get("reasoning")).strip()

    if "expect_sentence_count" in task:
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", content) if s.strip()]
        result["sentence_count"] = len(sentences)
        result["passed"] = len(sentences) == task["expect_sentence_count"]
        if not result["passed"]:
            result["error"] = (
                f"expected {task['expect_sentence_count']} sentences, "
                f"got {len(sentences)}"
            )
        return result

    if "expect_fields" in task:
        try:
            extracted = extract_json(content)
        except json.JSONDecodeError:
            result.update(passed=False, error="no valid JSON object found")
            return result
        result["extracted"] = extracted
        mismatched = {
            k: v for k, v in task["expect_fields"].items()
            if extracted.get(k) != v
        }
        result["passed"] = not mismatched
        if mismatched:
            result["error"] = f"fields missing/mismatched: {mismatched}, got {extracted}"
        return result

    raise ValueError(f"Tier P task {task['id']} has no known grading strategy")


def run_tier_d_task(base_url, model, task):
    result = {"id": task["id"], "tier": "D"}
    messages = []
    try:
        for i, user_turn in enumerate(task["turns"]):
            messages.append({"role": "user", "content": user_turn})
            is_last = i == len(task["turns"]) - 1
            # Same reasoning-budget headroom as Tier A on the final turn
            # (it's asking for real code); earlier turns are discussion
            # only, so a smaller budget is enough and keeps the run faster.
            resp, elapsed = call_model(
                base_url, model, messages=messages, max_tokens=8192 if is_last else 2048
            )
            message = resp["choices"][0]["message"]
            content = message.get("content") or ""
            if not content.strip() and (message.get("reasoning_content") or message.get("reasoning")):
                # Same empty-content-on-easy-task fallback as Tier A - a
                # multi-turn conversation is exactly where this matters
                # most, since losing a turn's content also breaks the
                # conversation history fed into the next turn.
                content = message.get("reasoning_content") or message.get("reasoning")
            # Appending {} content (never None) keeps the message list a
            # valid alternating user/assistant transcript for the next turn
            # regardless of which fallback fired above.
            messages.append({"role": "assistant", "content": content})
            if is_last:
                result["elapsed_s"] = round(elapsed, 2)
                result["final_content"] = content
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        result.update(passed=False, error=f"request failed: {e}")
        return result

    code = extract_code(result["final_content"])
    result["extracted_code"] = code
    result["passed"], error = execute_code_test(code, task["test_code"])
    if error:
        result["error"] = error

    return result


def run_tier_q_task(base_url, model, task):
    result = {"id": task["id"], "tier": "Q"}
    try:
        resp, elapsed = call_model(base_url, model, task["prompt"], max_tokens=2048)
        message = resp["choices"][0]["message"]
        content = (message.get("content") or "").strip()
        result["elapsed_s"] = round(elapsed, 2)
        result["raw_content"] = content
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        result.update(passed=False, error=f"request failed: {e}")
        return result

    if not content and (message.get("reasoning_content") or message.get("reasoning")):
        content = (message.get("reasoning_content") or message.get("reasoning")).strip()

    content_lower = content.lower()
    hit_topics = [
        topic for topic, keywords in task["topics"].items()
        if any(kw in content_lower for kw in keywords)
    ]
    result["topics_hit"] = hit_topics
    result["passed"] = len(hit_topics) >= task["expect_min_topics"]
    if not result["passed"]:
        missing = [t for t in task["topics"] if t not in hit_topics]
        result["error"] = (
            f"only asked about {len(hit_topics)}/{task['expect_min_topics']} "
            f"required topics; missing: {missing}"
        )
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
    for task in TIER_J_TASKS:
        print(f"  [Tier J] {task['id']}...", end=" ", flush=True)
        r = run_tier_j_task(base_url, model, task)
        print("PASS" if r.get("passed") else f"FAIL ({r.get('error', '?')[:80]})")
        results.append(r)
    for task in TIER_P_TASKS:
        print(f"  [Tier P] {task['id']}...", end=" ", flush=True)
        r = run_tier_p_task(base_url, model, task)
        print("PASS" if r.get("passed") else f"FAIL ({r.get('error', '?')[:80]})")
        results.append(r)
    for task in TIER_D_TASKS:
        print(f"  [Tier D] {task['id']}...", end=" ", flush=True)
        r = run_tier_d_task(base_url, model, task)
        print("PASS" if r.get("passed") else f"FAIL ({r.get('error', '?')[:80]})")
        results.append(r)
    for task in TIER_Q_TASKS:
        print(f"  [Tier Q] {task['id']}...", end=" ", flush=True)
        r = run_tier_q_task(base_url, model, task)
        print("PASS" if r.get("passed") else f"FAIL ({r.get('error', '?')[:80]})")
        results.append(r)
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", required=True, help="e.g. http://local-ai-machine.local:8000")
    ap.add_argument("--model", required=True, help="served-model-name")
    ap.add_argument("--output", required=True, help="path to write JSON results")
    args = ap.parse_args()

    print(f"Running coding + role-fitness benchmark against {args.model} @ {args.base_url}")
    results = run_all(args.base_url, args.model)

    tier_a_pass = sum(1 for r in results if r["tier"] == "A" and r.get("passed"))
    tier_b_pass = sum(1 for r in results if r["tier"] == "B" and r.get("passed"))
    tier_j_pass = sum(1 for r in results if r["tier"] == "J" and r.get("passed"))
    tier_p_pass = sum(1 for r in results if r["tier"] == "P" and r.get("passed"))
    tier_d_pass = sum(1 for r in results if r["tier"] == "D" and r.get("passed"))
    tier_q_pass = sum(1 for r in results if r["tier"] == "Q" and r.get("passed"))
    summary = {
        "model": args.model,
        "base_url": args.base_url,
        "tier_a_pass": tier_a_pass,
        "tier_a_total": len(TIER_A_TASKS),
        "tier_b_pass": tier_b_pass,
        "tier_b_total": len(TIER_B_TASKS),
        "tier_j_pass": tier_j_pass,
        "tier_j_total": len(TIER_J_TASKS),
        "tier_p_pass": tier_p_pass,
        "tier_p_total": len(TIER_P_TASKS),
        "tier_d_pass": tier_d_pass,
        "tier_d_total": len(TIER_D_TASKS),
        "tier_q_pass": tier_q_pass,
        "tier_q_total": len(TIER_Q_TASKS),
        "results": results,
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))

    print(
        f"\nTier A: {tier_a_pass}/{len(TIER_A_TASKS)}  Tier B: {tier_b_pass}/{len(TIER_B_TASKS)}  "
        f"Tier J: {tier_j_pass}/{len(TIER_J_TASKS)}  Tier P: {tier_p_pass}/{len(TIER_P_TASKS)}  "
        f"Tier D: {tier_d_pass}/{len(TIER_D_TASKS)}  Tier Q: {tier_q_pass}/{len(TIER_Q_TASKS)}"
    )
    print(f"Results written to {out_path}")


if __name__ == "__main__":
    main()
