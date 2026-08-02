# Global Agent Rules

## Architect/Worker Execution Loop
For any multi-file edit, new feature, or complex bugfix:

1. **Planning Phase (Architect):**
   - Delegate task planning to the `planner` subagent.
   - Request a structured `TASK_SPEC.md` containing atomic, testable sub-tasks.
   - Do not edit source files until `TASK_SPEC.md` is generated.

2. **Execution Phase (Worker):**
   - Execute sub-tasks sequentially using your native editing tools.
   - After each sub-task, run local build/test commands to verify correctness.
   - Do not attempt more than 2 retries on a failing test.

3. **Fallback Rule:**
   - If a test fails twice, issue `git reset --hard` to revert the broken attempt and delegate the test output back to the `planner` subagent to refine the spec.
