#!/usr/bin/env python3
"""Hidden grading script for agentic-tasks/git-pr-ci-v1.

Grades the REAL end state of chrisjohnson/local-ai-machine-test on
GitHub after an agent's session -- not the agent's local workspace, and
not anything it could have fabricated inside its own sandbox. Every
check here goes through `gh`/the GitHub API or a fresh clone of the
repo's current `main`. Stdlib only (plus the `gh` CLI as an external
binary, same pattern this project already uses elsewhere), no LLM
judge.

This script is NOT copied into the agent's workspace and does not care
what the agent's local working directory looks like -- it only cares
about what actually landed on GitHub. It must be run AFTER the harness's
45-minute ceiling for the task has elapsed (or the agent has otherwise
finished/exited), and BEFORE the harness resets the repo back to
baseline for the next run (scripts/reset_agentic_test_repo.sh) --
grading and reset order matters, this script reads state that the reset
step destroys.

Usage:
    python3 grade.py [--repo OWNER/NAME] [--json]

Exit code 0 always (grading is percent-based) unless the script itself
can't even attempt grading (e.g. `gh` unavailable/unauthenticated).
"""
from __future__ import annotations

import argparse
import json as jsonlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


DEFAULT_REPO = "chrisjohnson/local-ai-machine-test"


@dataclass
class CheckResult:
    id: str
    description: str
    passed: bool
    detail: str = ""


class GradingError(Exception):
    """Raised when grading itself cannot proceed (not a task failure)."""


def gh_json(args: List[str]):
    proc = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise GradingError(f"gh {' '.join(args)} failed: {proc.stderr.strip()}")
    return jsonlib.loads(proc.stdout) if proc.stdout.strip() else None


def is_ancestor_of_main(repo: str, commit_sha: str) -> bool:
    """True iff commit_sha is reachable from the CURRENT tip of main.

    This is the key defense against stale history: local-ai-machine-test
    is a long-lived, repeatedly-reset shared repo (see
    scripts/reset_agentic_test_repo.sh) -- a PR merged in a PRIOR run
    stays permanently visible via `gh pr list --state merged` (GitHub
    never un-merges a PR's recorded state, even after main is
    force-reset out from under it). Without this check, a completely
    idle agent that did nothing at all would still get credit for the
    previous run's merge. GitHub's compare API says a commit is an
    ancestor of main iff main is AHEAD_OF/IDENTICAL_TO it (or they're
    the exact same commit).
    """
    # compare/{base}...{head}: status describes HEAD relative to BASE.
    # base=commit_sha, head=main. commit_sha is an ancestor of main iff
    # main is "identical" to it (same commit) or "ahead" of it (main has
    # commit_sha as an ancestor plus more commits on top). "behind" means
    # main is actually an ancestor of commit_sha instead (i.e. main was
    # reset to something OLDER, and commit_sha is not reachable from it)
    # -- exactly the stale-prior-run-merge case this function exists to
    # catch. "diverged" means neither is an ancestor of the other.
    try:
        cmp = gh_json(["api", f"repos/{repo}/compare/{commit_sha}...main"])
    except GradingError:
        return False
    if cmp is None:
        return False
    status = cmp.get("status")
    return status in ("ahead", "identical")


def find_merged_pr(repo: str) -> Optional[dict]:
    """Most-recently-merged PR against the repo's default branch whose
    merge commit is still actually reachable from current main, if any.

    We don't assume a specific PR number since the agent chooses its own
    branch name/PR -- just take the most recent such merged PR and
    validate it below. Crucially, we filter to merges still reachable
    from main's current tip (see is_ancestor_of_main) so a merge from a
    PRIOR run (since force-reset away by
    scripts/reset_agentic_test_repo.sh) is never mistaken for this run's
    submission.
    """
    prs = gh_json([
        "pr", "list", "-R", repo, "--state", "merged",
        "--json", "number,title,mergedAt,baseRefName,headRefName,mergeCommit,commits",
        "--limit", "20",
    ])
    if not prs:
        return None
    prs.sort(key=lambda p: p.get("mergedAt") or "", reverse=True)
    for pr in prs:
        merge_sha = (pr.get("mergeCommit") or {}).get("oid")
        if merge_sha and is_ancestor_of_main(repo, merge_sha):
            return pr
    return None


def check_pr_opened_and_merged(repo: str) -> tuple[CheckResult, Optional[dict]]:
    try:
        pr = find_merged_pr(repo)
    except GradingError as e:
        return CheckResult("pr_merged", "a pull request was opened and merged into main", False, str(e)), None

    if pr is None:
        return CheckResult(
            "pr_merged", "a pull request was opened and merged into main", False,
            "no merged PR found whose merge commit is reachable from current main "
            "(either nothing was merged this run, or the only merges found are from "
            "a prior run and are no longer part of main's history)",
        ), None

    base_ok = pr.get("baseRefName") == "main"
    passed = base_ok
    detail = "" if passed else f"merged PR #{pr['number']} targeted {pr.get('baseRefName')!r}, expected 'main'"
    return CheckResult(
        "pr_merged",
        f"a pull request was opened and merged into main (found PR #{pr['number']} {pr.get('title', '')!r})",
        passed,
        detail,
    ), pr


def check_not_direct_push(repo: str, pr: Optional[dict]) -> CheckResult:
    """The PR must actually contain commits (i.e. real branch work, not an
    empty/no-op PR opened just to satisfy the letter of the task)."""
    if pr is None:
        return CheckResult("pr_has_commits", "the merged PR contains at least one real commit", False, "no merged PR found")
    commits = pr.get("commits") or []
    passed = len(commits) >= 1
    detail = "" if passed else "merged PR has zero commits"
    return CheckResult("pr_has_commits", "the merged PR contains at least one real commit", passed, detail)


def check_ci_ran_and_passed(repo: str, pr: Optional[dict]) -> CheckResult:
    """CI must have actually executed against the PR's head commit (not
    been skipped/absent) and reported success -- checked via the commit
    status/check-runs API against the PR's actual head SHA, not just
    'some workflow run exists somewhere'."""
    if pr is None:
        return CheckResult("ci_passed", "CI actually ran on the PR and passed", False, "no merged PR found")

    head_ref = pr.get("headRefName")
    try:
        # Re-fetch full PR detail for the head commit SHA (list output above
        # doesn't include it).
        detail_pr = gh_json(["pr", "view", str(pr["number"]), "-R", repo, "--json", "headRefOid,commits"])
    except GradingError as e:
        return CheckResult("ci_passed", "CI actually ran on the PR and passed", False, str(e))

    head_sha = detail_pr.get("headRefOid")
    if not head_sha:
        return CheckResult("ci_passed", "CI actually ran on the PR and passed", False, "could not determine PR head SHA")

    try:
        runs = gh_json([
            "run", "list", "-R", repo, "--commit", head_sha,
            "--json", "status,conclusion,name,headSha",
        ])
    except GradingError as e:
        return CheckResult("ci_passed", "CI actually ran on the PR and passed", False, str(e))

    if not runs:
        return CheckResult(
            "ci_passed", "CI actually ran on the PR and passed", False,
            f"no workflow runs found for head commit {head_sha} (branch {head_ref!r}) -- "
            "CI must not have triggered at all",
        )

    relevant = [r for r in runs if r.get("headSha") == head_sha]
    if not relevant:
        relevant = runs

    all_completed = all(r.get("status") == "completed" for r in relevant)
    all_success = all(r.get("conclusion") == "success" for r in relevant)
    passed = all_completed and all_success and len(relevant) > 0

    detail = ""
    if not passed:
        detail = f"workflow runs for head {head_sha}: " + jsonlib.dumps(relevant)
    return CheckResult("ci_passed", "CI actually ran on the PR's head commit and completed successfully", passed, detail)


def clone_current_main(repo: str, dest: Path) -> None:
    proc = subprocess.run(
        ["gh", "repo", "clone", repo, str(dest), "--", "--depth", "50", "--branch", "main"],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise GradingError(f"failed to clone {repo}: {proc.stderr.strip()}")


def check_transfer_stock_present_and_correct(repo: str) -> List[CheckResult]:
    """Clone the CURRENT main (post-merge) and actually run the documented
    contract against the real transfer_stock implementation the agent
    merged -- not a static grep, a real functional check via subprocess,
    same spirit as this project's other hidden-check scripts."""
    tmpdir = Path(tempfile.mkdtemp(prefix="grade-git-pr-ci-"))
    results: List[CheckResult] = []
    try:
        clone_current_main(repo, tmpdir)

        inventory_file = tmpdir / "warehouse" / "inventory.py"
        if not inventory_file.exists():
            results.append(CheckResult(
                "transfer_stock_present", "transfer_stock method exists on current main", False,
                "warehouse/inventory.py not found on main after merge",
            ))
            return results

        source = inventory_file.read_text()
        has_method = "def transfer_stock" in source
        results.append(CheckResult(
            "transfer_stock_present", "transfer_stock method exists on current main", has_method,
            "" if has_method else "no 'def transfer_stock' found in warehouse/inventory.py",
        ))
        if not has_method:
            results.extend(_skipped_behavior_checks())
            return results

        behavior_results = _run_transfer_stock_behavior_checks(tmpdir)
        results.extend(behavior_results)
        return results
    except GradingError as e:
        results.append(CheckResult("transfer_stock_present", "transfer_stock method exists on current main", False, str(e)))
        results.extend(_skipped_behavior_checks())
        return results
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _skipped_behavior_checks() -> List[CheckResult]:
    ids = [
        ("transfer_success", "successful transfer moves stock between bins correctly"),
        ("transfer_insufficient_stock_atomic", "insufficient-stock transfer raises and leaves state unchanged"),
        ("transfer_rejects_nonpositive", "non-positive quantity raises InventoryError"),
        ("transfer_rejects_same_bin", "same-bin transfer raises InventoryError (no silent no-op)"),
    ]
    return [CheckResult(i, d, False, "skipped: transfer_stock not present") for i, d in ids]


def _run_transfer_stock_behavior_checks(repo_root: Path) -> List[CheckResult]:
    """Import the merged warehouse package fresh (from the clone, not this
    script's own environment) and drive transfer_stock directly against
    the documented contract."""
    sys.path.insert(0, str(repo_root))
    for mod_name in list(sys.modules):
        if mod_name == "warehouse" or mod_name.startswith("warehouse."):
            del sys.modules[mod_name]

    results: List[CheckResult] = []
    try:
        import warehouse  # type: ignore

        Inventory = warehouse.Inventory
        InventoryError = warehouse.InventoryError

        # -- 1. successful transfer --
        try:
            inv = Inventory()
            inv.add_stock("SKU-A", "BIN-1", 10)
            inv.transfer_stock("SKU-A", "BIN-1", "BIN-2", 4)
            ok = (
                inv.quantity_in_bin("SKU-A", "BIN-1") == 6
                and inv.quantity_in_bin("SKU-A", "BIN-2") == 4
            )
            results.append(CheckResult(
                "transfer_success", "successful transfer moves stock between bins correctly", ok,
                "" if ok else f"got BIN-1={inv.quantity_in_bin('SKU-A', 'BIN-1')}, BIN-2={inv.quantity_in_bin('SKU-A', 'BIN-2')}, expected 6/4",
            ))
        except Exception as e:
            results.append(CheckResult("transfer_success", "successful transfer moves stock between bins correctly", False, f"raised unexpectedly: {e!r}"))

        # -- 2. insufficient stock: must raise AND leave state unchanged --
        try:
            inv = Inventory()
            inv.add_stock("SKU-B", "BIN-1", 3)
            raised = False
            try:
                inv.transfer_stock("SKU-B", "BIN-1", "BIN-2", 4)
            except InventoryError:
                raised = True
            unchanged = (
                inv.quantity_in_bin("SKU-B", "BIN-1") == 3
                and inv.quantity_in_bin("SKU-B", "BIN-2") == 0
            )
            ok = raised and unchanged
            results.append(CheckResult(
                "transfer_insufficient_stock_atomic",
                "insufficient-stock transfer raises InventoryError and leaves state unchanged (no partial credit to to_bin)",
                ok,
                "" if ok else f"raised={raised}, BIN-1={inv.quantity_in_bin('SKU-B', 'BIN-1')} (expected 3), BIN-2={inv.quantity_in_bin('SKU-B', 'BIN-2')} (expected 0)",
            ))
        except Exception as e:
            results.append(CheckResult("transfer_insufficient_stock_atomic", "insufficient-stock transfer raises InventoryError and leaves state unchanged", False, f"unexpected error: {e!r}"))

        # -- 3. non-positive quantity --
        try:
            inv = Inventory()
            inv.add_stock("SKU-C", "BIN-1", 10)
            raised_zero = raised_neg = False
            try:
                inv.transfer_stock("SKU-C", "BIN-1", "BIN-2", 0)
            except InventoryError:
                raised_zero = True
            try:
                inv.transfer_stock("SKU-C", "BIN-1", "BIN-2", -2)
            except InventoryError:
                raised_neg = True
            ok = raised_zero and raised_neg
            results.append(CheckResult(
                "transfer_rejects_nonpositive", "non-positive quantity raises InventoryError", ok,
                "" if ok else f"raised_zero={raised_zero}, raised_neg={raised_neg}",
            ))
        except Exception as e:
            results.append(CheckResult("transfer_rejects_nonpositive", "non-positive quantity raises InventoryError", False, f"unexpected error: {e!r}"))

        # -- 4. same-bin transfer is a no-op error --
        try:
            inv = Inventory()
            inv.add_stock("SKU-D", "BIN-1", 10)
            raised = False
            try:
                inv.transfer_stock("SKU-D", "BIN-1", "BIN-1", 5)
            except InventoryError:
                raised = True
            unchanged = inv.quantity_in_bin("SKU-D", "BIN-1") == 10
            ok = raised and unchanged
            results.append(CheckResult(
                "transfer_rejects_same_bin", "same-bin transfer raises InventoryError (no silent no-op)", ok,
                "" if ok else f"raised={raised}, BIN-1={inv.quantity_in_bin('SKU-D', 'BIN-1')} (expected 10)",
            ))
        except Exception as e:
            results.append(CheckResult("transfer_rejects_same_bin", "same-bin transfer raises InventoryError", False, f"unexpected error: {e!r}"))

    except Exception as e:
        results.append(CheckResult("transfer_behavior_import", "warehouse package importable from merged main", False, repr(e)))
    finally:
        if str(repo_root) in sys.path:
            sys.path.remove(str(repo_root))
        for mod_name in list(sys.modules):
            if mod_name == "warehouse" or mod_name.startswith("warehouse."):
                del sys.modules[mod_name]

    return results


def check_existing_tests_still_pass(repo: str) -> CheckResult:
    """Sanity check: the pre-existing test suite (not just the new
    transfer_stock tests) must still pass against merged main -- catches
    an agent that broke existing behavior while adding the new method."""
    tmpdir = Path(tempfile.mkdtemp(prefix="grade-git-pr-ci-tests-"))
    try:
        clone_current_main(repo, tmpdir)
        proc = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=str(tmpdir), capture_output=True, text=True, timeout=60,
        )
        passed = proc.returncode == 0
        detail = "" if passed else (proc.stderr[-2000:] or proc.stdout[-2000:])
        return CheckResult("full_test_suite_passes", "full tests/ suite passes against merged main", passed, detail)
    except GradingError as e:
        return CheckResult("full_test_suite_passes", "full tests/ suite passes against merged main", False, str(e))
    except Exception as e:
        return CheckResult("full_test_suite_passes", "full tests/ suite passes against merged main", False, repr(e))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def check_new_tests_added(repo: str, pr: Optional[dict]) -> CheckResult:
    """The agent's own PR must have added test coverage, not just
    production code -- checked via the PR's file diff stats. Takes the
    already-validated PR from check_pr_opened_and_merged (reachable-from-
    main filtered) rather than re-querying independently, so this can't
    disagree with pr_merged about which PR is this run's submission."""
    if pr is None:
        return CheckResult("new_tests_added", "the merged PR added/modified test coverage", False, "no merged PR found")
    pr_number = pr["number"]

    try:
        file_objs = gh_json(["api", f"repos/{repo}/pulls/{pr_number}/files", "--paginate"])
    except GradingError as e:
        return CheckResult("new_tests_added", "the merged PR added/modified test coverage", False, str(e))
    touched = [f.get("filename", "") for f in (file_objs or [])]

    touched_tests = [f for f in touched if "test" in f.lower()]
    passed = len(touched_tests) > 0
    detail = "" if passed else f"PR #{pr_number} touched files: {touched!r} (none look like test files)"
    return CheckResult("new_tests_added", "the merged PR added/modified test coverage (touches a test file)", passed, detail)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=DEFAULT_REPO, help="owner/name of the test repo")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON instead of text")
    args = parser.parse_args()

    results: List[CheckResult] = []

    pr_check, pr = check_pr_opened_and_merged(args.repo)
    results.append(pr_check)
    results.append(check_not_direct_push(args.repo, pr))
    results.append(check_ci_ran_and_passed(args.repo, pr))
    results.append(check_new_tests_added(args.repo, pr))
    results.extend(check_transfer_stock_present_and_correct(args.repo))
    results.append(check_existing_tests_still_pass(args.repo))

    _emit(results, args.json)


def _emit(results: List[CheckResult], as_json: bool):
    pass_count = sum(1 for r in results if r.passed)
    total_count = len(results)

    if as_json:
        print(
            jsonlib.dumps(
                {
                    "pass_count": pass_count,
                    "total_count": total_count,
                    "checks": [r.__dict__ for r in results],
                },
                indent=2,
            )
        )
    else:
        for r in results:
            status = "PASS" if r.passed else "FAIL"
            print(f"[{status}] {r.id}: {r.description}")
            if not r.passed and r.detail:
                print(f"       {r.detail}")
        print(f"\n{pass_count}/{total_count} checks passed")


if __name__ == "__main__":
    main()
