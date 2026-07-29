---
id: M-029
title: Run catalog-wide agentic-coding-session + agentic-orchestration-session benchmark sweep
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-29T19:50:00Z
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
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-07-29T19:50Z — claiming, Chris authorized running the full sweep now -->
<!-- signal: claude 2026-07-29T20:46Z — sweep running (systemd, real, not dry-run) after a GPU-contention crash on first attempt (laguna recovered, Chris OK'd proceeding). Checking in periodically, not blocking on it. -->

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

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started yet. Next: sync server checkout, dry-run to confirm scope,
start `benchmark-orchestrator.service`.
