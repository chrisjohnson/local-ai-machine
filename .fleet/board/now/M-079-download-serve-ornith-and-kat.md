---
id: M-079
title: Download + serve Ornith-1.0-35B and KAT-Coder-V2.5-Dev (Qwen3.5-MoE coder pair)
initiative_id: null
claimed_by: opencode
claimed_at: 2026-08-05T00:55:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-007, M-050]
---

# M-079 — Download + serve Ornith-1.0-35B and KAT-Coder-V2.5-Dev (Qwen3.5-MoE coder pair)

## Context
Two new agentic-coder models for the box, both `qwen35moe` architecture
(same proven family as qwen3.6-35b-a3b: 40 layers, 2048 hidden, 262144
native context, ~3B active). Chris approved the downloads 2026-08-04 with
a "probably Q8, probably MTP" preference. Research outcome:

- **Ornith-1.0-35B** (deepreinforce-ai): release ships NO MTP head.
  `singulared/Ornith-1.0-35B-MTP-GGUF` Q8_0 grafts Qwen3.6-35B-A3B's
  original blk.40 `nextn` head — MTP tensors VERIFIED present via GGUF
  header parse (753 tensors incl. `blk.40.nextn.*`). `unsloth` plain Q8_0
  has none (733 tensors) — ruled out. singulared measured on Strix Halo
  gfx1151 (Vulkan): Q8_0+MTP ~63-66 tok/s (0.859 accept) vs ~50 w/o MTP.
- **KAT-Coder-V2.5-Dev** (Kwaipilot): source ships `mtp_num_hidden_layers:
  0`. Per Chris's "both" call: plain `bartowski` Q8_0 (no MTP) AND
  `gbuzhf/KAT-Coder-V2.5-Dev-MTP-GGUF` UD-Q6_K graft (MTP tensors verified
  present; donor head claimed byte-identical, sha256 in repo README).
  gbuzhf perf notes: MTP ALONE is a net loss — run `draft-mtp,ngram-mod`
  together (flags in the compose entry).
- Box capability confirmed: llama-server build 10154 (laguna container)
  supports `draft-mtp`, `ngram-mod`, and all `--spec-*` knobs; `--jinja`
  is default-on (not passed, matching box convention).

## Plan
1. [x] Research both models: config.json, GGUF repos + sizes (HF API tree),
   MTP-tensor verification (gguf-package header parse), README perf notes,
   box llama-server build capability.
2. [x] Add 3 `models` entries to configuration.nix: `llamacpp-ornith-1.0-35b-mtp-q8`,
   `llamacpp-kat-coder-v2.5-dev-q8`, `llamacpp-kat-coder-v2.5-dev-mtp-q6`.
3. [x] Add 3 llama-server compose services (ports 8110-8112) with
   README-derived MTP flags.
4. [ ] Commit + push main; deploy on box (`git pull --ff-only` +
   `nixos-rebuild switch`); confirm the 3 download services start and
   make real progress. Watch disk: / was 237G free (87%) before these
   ~105GB of downloads.
5. [ ] (after downloads complete) start a service + smoke test.

## Signals
<!-- signal: opencode 2026-08-05T00:55Z — claiming, wiring config + compose -->

## Decision log
- 2026-08-05: Ornith kept at Q8_0 per Chris's stated preference even though
  singulared's own Strix-Halo numbers recommend Q4_K_M (~80 vs ~64 tok/s,
  near-equal acceptance) — noted as cheap to switch later.
- 2026-08-05: KAT handled as "Both" (Q8_0 + MTP Q6_K) — Chris picked this
  when Q8 and MTP couldn't coexist in one file (source model stripped the
  head). Q6_K is the top MTP quant available.
- 2026-08-05: MTP tensor presence verified by parsing GGUF headers, not
  trusted from repo claims. Both graft repos share the upstream limitation
  that no imatrix statistics cover blk.40 (head never executes during
  imatrix calibration) — head quantized unguided in every build.

## Handoff notes
Deploy pending (step 4): `ssh local-ai-machine` → `git pull --ff-only` →
`sudo -n /run/current-system/sw/bin/nixos-rebuild switch --flake /etc/nixos#local-ai-machine`.
The 3 compose services stay defined-but-stopped until their `.download-complete`
markers exist (docker-compose-app gates on them). For serving, start explicitly,
e.g. `docker compose -f docker/docker-compose.yml up -d <service>`.
