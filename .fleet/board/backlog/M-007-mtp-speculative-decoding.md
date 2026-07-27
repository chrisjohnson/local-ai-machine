---
id: M-007
title: MTP speculative decoding for llama.cpp — re-check now that the MTP-tagged GGUF has downloaded
initiative_id: null
claimed_by: null
claimed_at: null
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
1. [ ] Confirm the downloaded `llamacpp-qwen3.6-35b-a3b-mtp` artifact
   actually contains MTP tensors/layers (don't just trust the download
   completed — the original failure was a shape/content mismatch, not a
   missing file).
2. [ ] Re-run the MTP trial: `llama-cli`/`llama-server` with `--spec-type
   draft-mtp --spec-draft-n-max 3` against this file, on
   `kyuz0/amd-strix-halo-toolboxes:vulkan-radv`.
3. [ ] If it loads, produce a real before/after benchmark number against the
   existing no-MTP baseline (`results/qwen3.6-35b-a3b--llamacpp.txt`) and
   compare against the ~1.8-2.5x community reference figure.
4. [ ] If it still fails, diagnose for real (don't assume) and record the
   exact error — this card should end with either a real speedup number or a
   clearly diagnosed reason it's still not possible.
5. [ ] Consider whether the equivalent `unsloth/Qwen3.6-27B-MTP-GGUF` (the
   originally-targeted model) is worth downloading too, per the standing
   two-step download check-in gate — not a blocker for this card's own
   Qwen3.6-35B-A3B attempt.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 5, Task 5.5 into a fleet
  card during the fleet-bootstrap backlog migration. Checked SSH
  (`/var/lib/ai-models/llamacpp-qwen3.6-35b-a3b-mtp/.download-complete`) and
  `configuration.nix` — the previously-missing MTP GGUF artifact now exists
  on disk for Qwen3.6-35B-A3B, so this card is framed as "re-check, likely
  unblocked" rather than reusing README's stale "blocked" framing verbatim.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started as a fleet card. The download that previously blocked this is
now complete on the live machine — next agent should verify the file
actually has MTP layers before re-attempting the trial, since "downloaded"
and "correct artifact" aren't automatically the same thing here.
