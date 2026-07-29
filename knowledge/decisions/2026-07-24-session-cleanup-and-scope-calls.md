---
id: 2026-07-24-session-cleanup-and-scope-calls
date: 2026-07-24
source: "HANDOFF.md (\"Decisions made this session\", lines 129-162)"
tags: [secrets, git, ollama, scope, judgment-call]
status: active
---

# Session cleanup and scope judgment calls (2026-07-24)

Several small, real judgment calls made during a benchmark-rerun session, recorded for
review rather than silently made permanent.

**Secrets directories merged, not simply replaced.** This session's worktree had
accumulated all the real operational secrets (synology key, wifi/HF/grafana/litellm
credentials); repo root only had `.example` templates plus a freshly-added
`chris_github_key` pair. Did a non-destructive copy (not a mirror/delete-sync) so repo
root ended up with everything, including the private `secrets/chris_github_key` that only
existed in repo root before. Flagged for a quick visual confirmation that `secrets/` looks
complete and correct.

**Tier J's `max_tokens` bump (2048 -> 4096) was applied without final explicit sign-off.**
The evidence was strong (a failing task ran 144.6s vs 19-88s for every sibling task with
zero output — the exact reasoning-budget-exhaustion signature already known from Tiers
A/B) and matches an already-established pattern in the same harness file, but flagged
since it was a "resolve and move forward" call, not a directly confirmed one.

**This session's own worktree directory was left in place.** Fully merged into `main`,
nothing unique left on it — safe to remove (`git worktree remove ... && git branch -d
...`) whenever convenient, but left alone because an earlier explicit instruction ("leave
it for after this session") wasn't clearly re-authorized before the session ended.

**The box's old, pre-git-fix, disconnected commit history was preserved**, not deleted,
as a local-only branch on the box named `master-old-standalone-snapshot`. Harmless, a
candidate for pruning if never needed.

**Ollama skipped entirely for this benchmark pass — deliberate, not an oversight.** The
currently-registered Ollama models had a broken bare-passthrough chat template (`TEMPLATE
{{ .Prompt }}`, no tool-calling schema, `<think>` blocks leaking into `content` unparsed)
— confirmed via `curl .../api/show` showing no real template, and via harness runs scoring
far worse than llama-server on identical tasks for template-related reasons, not real
model-quality differences. `scripts/benchmark_orchestrator.py` was made to hard-skip every
`ollama-*` engine build for this reason. **Decided**: fixing the template needs a proper
Go-template translation of each model's real chat template — real work, deliberately kept
out of scope here to avoid producing bad data under time pressure. (Later fixed for 3 of 4
models — see `2026-07-26-ollama-chat-template-root-caused-fixed.md`.)
