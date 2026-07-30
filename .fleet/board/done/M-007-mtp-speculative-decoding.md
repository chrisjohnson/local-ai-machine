---
id: M-007
title: MTP speculative decoding for llama.cpp — re-check now that the MTP-tagged GGUF has downloaded
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-30T05:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-005]
---

# M-007 — MTP (multi-token-prediction) speculative decoding

## Context

Ported from README.md §8 Phase 5, Task 5.5 (2026-07-26). The mechanism is
**confirmed real**: `llama.cpp` merged native MTP support
(`ggml-org/llama.cpp` PR #22673, 2026-05-16) for models shipping MTP heads,
including Qwen3.6-27B and Qwen3.6-35B-A3B — both already in this machine's
lineup. Community numbers (kyuz0's `mtp.html`, calebcoffie.com) on Strix
Halo/gfx1151 show **1.8x-2.5x real speedup** (e.g. Qwen3.6-27B Q4_K_M:
11.7→21.2 tok/s). Real CLI flags, independently verified against
`llama-server --help`/`llama-cli --help` on the exact toolbox build
(`kyuz0/amd-strix-halo-toolboxes:vulkan-radv`, 10107/`c0bc8591e`) and
cross-checked against the upstream PR author's own invocation: `--spec-type
draft-mtp --spec-draft-n-max N` (default N=3), no separate draft model
needed (self-speculative). Caveats: `n_parallel=1` only (no concurrent
serving while using MTP), ROCm+TP reportedly crashes — Vulkan is the safer
backend. vLLM's own `qwen3_next_mtp` path remains **unconfirmed** on ROCm —
this is a llama.cpp-specific finding, not a green light for the standing
vLLM stack.

**The original trial (2026-07-24) failed**, but with a clean, correctly
diagnosed error, not a crash: `llama_init_from_model: context type MTP
requested but model doesn't contain MTP layers`. Root cause: the
already-downloaded GGUF (`unsloth/Qwen3.6-27B-GGUF`) is a plain quant with
no MTP tensors — the MTP heads ship in a **separate repo**,
`unsloth/Qwen3.6-27B-MTP-GGUF` (and presumably an equivalent for
Qwen3.6-35B-A3B), which was not downloaded at the time per the standing
new-model-download check-in gate.

**Status update (this porting pass, 2026-07-26): the blocking artifact now
appears to exist.** `configuration.nix` already declares a
`llamacpp-qwen3.6-35b-a3b-mtp` download entry (`repo =
"unsloth/Qwen3.6-35B-A3B-MTP-GGUF"`, file
`Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`), and `/var/lib/ai-models/llamacpp-qwen3.6-35b-a3b-mtp/.download-complete`
exists on the live machine (checked via SSH 2026-07-26) — so this download
completed at some point after the original blocked attempt. **This is worth
re-checking, not assuming stale**: the original blocked run was against
Qwen3.6-27B specifically, and the artifact that landed is for
Qwen3.6-35B-A3B — confirm the file actually contains MTP tensors before
re-running the trial (don't just assume the download succeeding means it's
the right shape), then attempt the MTP-enabled `llama-cli`/`llama-server`
run against it for real.

## Plan
<!-- ordered checklist -->
1. [x] Confirm the downloaded `llamacpp-qwen3.6-35b-a3b-mtp` artifact
   actually contains MTP tensors/layers (don't just trust the download
   completed — the original failure was a shape/content mismatch, not a
   missing file). Confirmed via startup log: `common_speculative_init_result:
   creating MTP draft context against the target model` — no error, real
   MTP tensors present.
2. [x] Re-run the MTP trial: `llama-cli`/`llama-server` with `--spec-type
   draft-mtp --spec-draft-n-max 3` against this file, on
   `kyuz0/amd-strix-halo-toolboxes:vulkan-radv`. Ran successfully, `-np 1`
   as required (MTP supports only a single server slot).
3. [x] Produce a real before/after benchmark number. `llama-bench` does
   **not** support `--spec-type`/MTP at all (checked via `--help` on the
   actual image — no spec/draft/mtp flags exist), so this was measured via
   real `llama-server` request timings instead of the standard
   `llamacpp-bench-v1` harness (noted explicitly, not blended with that
   benchmark_id — see `catalog/builds/qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp.yaml`).
   **Result: draft acceptance is excellent (95-98%, occasionally dropping
   to ~80% depending on content predictability), but raw generation speed
   (~57-62 tok/s) does not beat the existing no-MTP baseline (63.43 ± 0.33
   tok/s, `qwen3.6-35b-a3b--llamacpp-vulkan-radv`)** — on par or marginally
   slower, not the ~1.8-2.5x community reference figure.
4. [x] Diagnosed rather than assumed. The mechanism works exactly as
   designed (near-perfect draft acceptance proves that) — the working
   hypothesis (not fully confirmed, worth treating as a hypothesis) is that
   this hardware is memory-bandwidth-bound rather than latency-bound: MTP's
   typical win comes from hiding per-token *overhead* (kernel launch,
   serialization), but batch-verifying several draft tokens still has to
   move roughly the same total weight data through memory as generating
   them one at a time on a bandwidth-constrained unified-memory system.
   Real, useful negative result either way — MTP isn't free lunch on this
   specific hardware class, at least not for this model.
5. [x] Downloaded the equivalent `unsloth/Qwen3.6-27B-MTP-GGUF` too (the
   originally-targeted model) — declared in `configuration.nix`, PR #11.
   Caught a real gap while closing this card: the download entry was
   declared but `nixos-rebuild switch` was never run after that merge, so
   the systemd unit didn't exist yet. Fixed 2026-07-30 — rebuild applied
   cleanly (confirmed `docker-compose-app.service` was *not* restarted, no
   disruption to the live model), download unit created and actively
   running (confirmed via `systemctl status`, real bytes in flight). Not
   yet benchmarked — a natural follow-up if the 27B tier is worth
   comparing too, but not a blocker for this card.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->
<!-- signal: claude 2026-07-30T06:30Z — done, real MTP trial run, measured, diagnosed; moved to done/ -->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 5, Task 5.5 into a fleet
  card during the fleet-bootstrap backlog migration. Checked SSH
  (`/var/lib/ai-models/llamacpp-qwen3.6-35b-a3b-mtp/.download-complete`) and
  `configuration.nix` — the previously-missing MTP GGUF artifact now exists
  on disk for Qwen3.6-35B-A3B, so this card is framed as "re-check, likely
  unblocked" rather than reusing README's stale "blocked" framing verbatim.
- 2026-07-30 — Real trial run end-to-end per Chris's direct request. Added
  the qwen3.6-27b MTP download entry (missing counterpart) and a real
  docker-compose service + catalog build entry for the 35b-a3b MTP variant
  (PR #11). MTP confirmed genuinely working (draft context created, 95-98%
  draft acceptance) but **does not beat the no-MTP baseline on raw
  throughput** on this hardware — a real, useful negative result, not a
  failure of the mechanism itself (see Plan step 4 for the bandwidth-bound
  hypothesis). This became the actual live `coder` backend for a real
  session, not just a benchmark trial — proved out under real, sustained
  use, not just a synthetic test.
- 2026-07-30 — This work directly motivated a chain of observability
  fixes, tracked separately but worth linking here since they exist because
  of this card: llama.cpp `--metrics` + fixed a stale vLLM Prometheus
  scrape config (PR #12), a real bug in that fix requiring prometheus
  `network_mode: host` (PR #13), a Grafana datasource break caused by that
  same fix (PR #14), and new Grafana panels for llama.cpp's metric names
  since the existing dashboard only ever queried `vllm:`-prefixed ones
  (PR #15). All merged and verified live with real traffic, not just
  assumed working.
- 2026-07-30 — Closing: caught and fixed a real gap while wrapping up —
  the qwen3.6-27b MTP download (config declared in PR #11) never actually
  got a `nixos-rebuild switch` to create its systemd unit. Fixed just now;
  download is actively running (confirmed real bytes in flight), not yet
  benchmarked. Moving to done/ since the card's actual scope (a real
  Qwen3.6-35B-A3B MTP trial, measured and diagnosed) is complete — the 27B
  download/benchmark is a natural follow-up, not a blocker for this card.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Nothing half-done on this card's own scope. If someone wants to extend
this: the qwen3.6-27b MTP download is in progress on the server (check
`/var/lib/ai-models/llamacpp-qwen3.6-27b-mtp/.download-complete`) — once
it lands, the same trial-and-measure pattern used here for 35b-a3b would
apply directly (no compose service exists for it yet, would need one built
same as `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1`).
