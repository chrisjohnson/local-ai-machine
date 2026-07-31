---
id: M-029
title: Run catalog-wide agentic-coding-session + agentic-orchestration-session benchmark sweep
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-021, M-022, M-024]
---

# M-029 — Catalog-wide agentic-session benchmark sweep

## Context

Discovered as a side effect of a `--dry-run` while working [[M-022]] tonight:
[[M-021]] (`agentic-coding-session-opencode-v1`/`-pi-v1`) and [[M-024]]
(`agentic-orchestration-session-opencode-v1`/`-pi-v1`) are both fully
implemented and verified — harnesses, task scaffolds, methodology YAMLs,
orchestrator wiring all real and correct (see both cards' decision logs
and independent verification passes, 2026-07-29). Both cards' Plans are
otherwise complete except for one thing: **no one has actually run these
four new benchmark_ids against the existing catalog yet.** Every build
currently shows all four as missing.

This is a large, disruptive job, not a quick fix — it will run the full
7-tier/agentic harness sweep across essentially every non-BROKEN build in
`catalog/builds/*.yaml`, repeatedly stopping/starting vLLM and llama.cpp
services for GPU exclusivity, likely for many hours. Chris explicitly
authorized running it now (2026-07-29), after being walked through why the
scope is this large (M-021/M-024 already built, just never run at scale)
and confirming he's done needing the currently-loaded model undisturbed
for the duration.

This also carries forward [[M-022]]'s original still-open item: the
`gpt-oss-120b--llamacpp-vulkan-radv` `files: null` data bug is already
fixed (2026-07-29, pushed to main) — this sweep's `--dry-run` should
confirm it now correctly shows as `RUN`, not `FAILED`.

## Plan
<!-- ordered checklist -->
1. [x] Sync the server's checkout to latest `main` (picks up the
   `gpt-oss-120b` fix and `deepseek` status update).
2. [x] `--dry-run` on the box, confirm: `gpt-oss-120b--llamacpp-vulkan-radv-v1`
   now shows `RUN` (not `FAILED`), and the plan's scope matches expectations
   (25 builds queued, missing the 4 new agentic-session ids).
3. [x] Start the real sweep via `systemctl start benchmark-orchestrator.service`
   (server-side persistent unit, not a piloted SSH loop — survives session
   disconnects). Running as of 2026-07-29T20:46Z.
4. [ ] Watch for stalls/OOM/crashes per `catalog/OPERATIONS.md`'s safety
   procedure — check in periodically via `journalctl`/`systemctl is-active`,
   not fire-and-forget, but also not blocking the whole conversation on a
   multi-hour run.
5. [ ] Once complete, verify every non-BROKEN build has real, sane
   `benchmark_runs` entries for all 4 new ids (and confirm `gpt-oss-120b`
   specifically got its long-overdue first-ever benchmark run).
6. [ ] Regenerate the comparison dashboard with the new data.
7. [ ] Once data shape is known, revisit [[M-021]]'s Plan step 10 (dashboard
   headline/primary-sort treatment for the agentic-coding-session tier) —
   likely a small follow-up, possibly its own card.
8. [ ] Move [[M-021]] and [[M-024]] to done/ once this sweep's data confirms
   their tiers work at scale, not just in smoke tests (their own Plans are
   otherwise complete already).

## Signals
<!-- signal: claude 2026-07-31T03:26Z — demoted to backlog per human request, deprioritized for pi-agent projects work (M-035) -->
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-07-29T19:50Z — claiming, Chris authorized running the full sweep now -->
<!-- signal: claude 2026-07-29T20:46Z — sweep running (systemd, real, not dry-run) after a GPU-contention crash on first attempt (laguna recovered, Chris OK'd proceeding). Checking in periodically, not blocking on it. -->
<!-- signal: claude 2026-07-29T21:20Z — second incident (36x crash loop, real root cause: orchestrator blind to laguna entirely). Sweep stopped. Real fix in PR #9, review in progress, do not restart sweep until merged. -->
<!-- signal: claude 2026-07-29T21:58Z — PR #9 merged, no data poisoned by prior crashes, fix confirmed working live (laguna correctly stopped, no crash-loop). Sweep running again, 25 builds queued. -->
<!-- signal: claude 2026-07-29T23:52Z — third incident: full-system hang, hard power-cycle required. Root cause (per-build stop/restore churn) fixed in PR #10, also drops restart:unless-stopped from model services. Sweep stopped, awaiting PR #10 review/merge before restarting. -->
<!-- signal: claude 2026-07-30T01:50Z — PR #10 merged+deployed, recovered 2 unpushed commits of real data (gemma-4-26b-a4b-it/gemma-4-31b-it) plus 24 missing raw files, pushed. Sweep running again, 23 builds remain, fix confirmed working live. -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-29 — filed and claimed directly per Chris's explicit "let's just
  run the big sweep" — this is genuinely new-scope work (a catalog-wide
  run, not the narrow single-build fix [[M-022]] was originally about), so
  tracked as its own card rather than silently folded into M-022's history.
- 2026-07-29 — **Real incident on first start attempt**: `benchmark_orchestrator.py`
  has a hardcoded "ensure default services (qwen3.6-35b-a3b, qwen3.5-4b) are
  up" startup step that predates the laguna deployment — it doesn't know
  `coder` now points at laguna (llama-server), and unconditionally brought
  both old vLLM builds up alongside it. This caused a real GPU-contention
  crash of the live `laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1`
  container (`RestartCount` 0→1) mid-generation on an actual in-flight
  request — exactly the failure mode documented in
  `knowledge/research/2026-07-24-llamacpp-vllm-gpu-contention-crash.md`.
  Stopped the service, cleaned up the stray vLLM containers, confirmed
  laguna recovered and healthy. Chris explicitly said disrupting his
  session is fine and to proceed anyway — restarted the service without
  fixing the underlying hardcoded-default-services bug (out of scope for
  tonight; worth a follow-up card so this doesn't bite again on every
  future sweep start). Real sweep now running as of 2026-07-29T20:46Z.
- 2026-07-29 — **Second incident, worse than the first**: the restarted
  sweep crashed at 21:07 ("Timed out waiting for qwen3.6-35b-a3b to become
  healthy"), auto-restarted via systemd (`Restart=on-failure`,
  `RestartSec=180`) at 21:10, and got stuck in a genuine crash loop —
  `qwen3.6-35b-a3b--vllm-therock-gfx1151-v1` hit `RestartCount=36` with a
  real HIP/ROCm OOM error in its own logs, never successfully starting.
  Root cause confirmed deeper than the first incident's framing: it's not
  just that the hardcoded default-services step is stale, it's that
  `stop_all_vllm_services()`/`find_running_vllm_services()` were scoped to
  the vLLM port range (8000-8099) only — completely blind to laguna
  (llama.cpp-server, port 8101). Laguna was **never going to be stopped by
  any benchmark run in this sweep**, vLLM or otherwise — every single
  build would have run with it still resident. Chris confirmed benchmarks
  must have exclusive GPU access, no exceptions. Stopped the sweep again,
  cleaned up stray containers, confirmed laguna healthy
  (`RestartCount` stayed at 1, no further damage).
- 2026-07-29 — **Real fix implemented** (not deferred this time, given two
  incidents): `docker-compose.yml` services now carry a
  `com.local-ai-machine.always-up: "true"` label on the 9 genuine infra
  services; the 14 model-serving builds (including laguna) carry no label
  and are exclusive/stoppable by default — new builds need no label to be
  correctly covered, only infra needs the flag (fail-safe default).
  `benchmark_orchestrator.py`'s `ensure_default_services_up()` removed
  entirely; `list_vllm_services`/`find_running_vllm_services`/
  `stop_all_vllm_services`/`restore_vllm_services` renamed and generalized
  to `*_exclusive_services*`, driven by the label instead of a hardcoded
  vLLM port range. `catalog/OPERATIONS.md` and the compose file's own
  comment block updated to document the convention. PR:
  https://github.com/chrisjohnson/local-ai-machine/pull/9 — review pass
  in progress (includes a live `--dry-run` comparison on the real box)
  before merging or restarting the sweep again.
- 2026-07-29 — Review verdict: ready to merge — independently reproduced
  the exact incident (old logic returns `[]` for laguna, new logic
  correctly finds it) and confirmed the dry-run plan is byte-identical
  otherwise (same 28 builds, only wording changed). Chris merged PR #9
  (`6dbe41c`). Before restarting: confirmed no data was poisoned by
  either crash — both happened during the orchestrator's startup phase,
  before any individual build was ever benchmarked, so `catalog/builds/`
  and `catalog/raw/` show zero commits/files from either crash window
  (checked both the git history and the server's working tree directly).
  Server synced to merged `main`, confirmed clean state (only laguna +
  infra running, laguna `RestartCount` still 1, no further damage),
  `--dry-run` re-run against the merged fix: same 25-build plan,
  `gpt-oss-120b` still correctly `RUN`, and
  `find_running_exclusive_services()` directly confirmed to return
  exactly `['laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v1']` against
  live state. Restarted `benchmark-orchestrator.service` — this time it
  correctly stopped laguna as part of its exclusivity step and moved on
  to the first real candidate build (`gemma-4-26b-a4b-it`) cleanly, no
  crash-loop. Watching for stability before stepping back to periodic
  check-ins.
- 2026-07-29 — **Third incident: full-system hang, hard power-cycle
  required.** After `gemma-4-26b-a4b-it` and partway into
  `glm-4.7-flash-awq`, the whole box became unresponsive — Docker health
  checks timed out across containers, Postgres checkpoints took 66s
  instead of ~1s, internal DNS resolution broke entirely, kernel logging
  went completely silent for over an hour. No OOM/panic/GPU-reset message
  in the kernel log this time (unlike the earlier 21:18:39 OOM, which was
  part of the *second* incident, already fixed) — consistent with a deep
  kernel/GPU-driver lockup. Chris hard-power-cycled the box. Verified: no
  data poisoned (neither build recorded new benchmark_runs before the
  freeze). Found and fixed a second, compounding problem on reboot:
  Docker's `restart: unless-stopped` brought back nearly every model
  container simultaneously (~111GB/124GB memory used) since none were in
  an explicit "stopped" state at the moment of the crash — stopped
  everything back to just infra before touching anything else.
- 2026-07-29 — **Root cause identified and fixed**: the per-build
  stop/restore cycle (introduced by PR #9) meant laguna got cycled off and
  back on between *every single build* across the 25+-build sweep — real,
  unnecessary GPU/driver churn, a very plausible contributor to the hang.
  Chris's direction: stop everything once at sweep start, restore once at
  sweep end, not in between. Also removed `restart: unless-stopped` from
  all 14 model-serving services (kept on the 9 infra services) so a future
  hard-crash-during-sweep doesn't cause the same reboot pileup; which model
  should auto-start on boot is explicitly deferred, not decided here. PR:
  https://github.com/chrisjohnson/local-ai-machine/pull/10 — awaiting
  Chris's review/merge before deploying and restarting the sweep again.
- 2026-07-30 — Chris merged PR #10 (`3e0c113`). Before redeploying,
  discovered the server had **2 unpushed local commits with real data**:
  `gemma-4-26b-a4b-it--vllm-therock-gfx1151-v1` and
  `gemma-4-31b-it--vllm-therock-gfx1151-v1` both fully completed all 4 new
  agentic-session legs (22:03Z and 22:15Z respectively) before the sweep
  moved on to `glm-4.7-flash-awq` and hit the hang — this revises the
  earlier "no data was recorded" read, which only checked pushed history.
  Also found 24 untracked raw evidence files (transcripts/logs) that never
  got committed — a real, separate gap in `git_commit_and_push()`'s glob
  (it only matches the build-start timestamp; individual agentic-task legs
  finish, and generate their transcript files, at their own later
  timestamps). Verified all 24 are genuinely referenced by the two builds'
  `benchmark_runs` entries (none extraneous), committed them, then
  reconciled: stashed the two pre-existing unrelated local mods (not
  mine), rebased the 3 commits onto merged `main` (clean, zero conflicts —
  pure data files, no overlap with PR #10), restored the stashed mods,
  pushed (`b29e5a3`). Confirmed via `--dry-run`: both gemma vLLM builds now
  correctly `SKIP` with all 6 benchmark_ids, `gpt-oss-120b` still `RUN`,
  23 builds remain (down from 25). Restarted the sweep — confirmed the
  one-time exclusivity stop fired correctly at sweep start ("0 currently
  running: []", matching reality) with none of the old per-build chatter,
  then moved straight to `glm-4.7-flash-awq` (correctly resuming, not
  re-running the two completed builds).

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
PR #10 merged and deployed. Sweep is **running** again as of
2026-07-30T01:48Z, 23 builds remaining — confirmed the fix works
correctly live (one-time stop at sweep start, no per-build churn). Real
data for `gemma-4-26b-a4b-it`/`gemma-4-31b-it` (recovered from unpushed
server-local commits, see decision log) is safely on `main`. Check
`journalctl -u benchmark-orchestrator.service`/`systemctl is-active` for
status, don't restart if already active. **If picking this up after
another gap**: check for unpushed local commits on the server
(`git log origin/main..HEAD`) before assuming nothing was recorded — this
bit us once already tonight. Once the sweep actually completes: steps 4-8
of the original plan still apply (verify all builds got sane
`benchmark_runs`, confirm `gpt-oss-120b`'s long-overdue first run,
regenerate the dashboard, revisit
M-021 step 10, move M-021/M-024 to done/).
