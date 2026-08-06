---
id: M-089
title: Download + serve Ornith-1.0-35B Q4_K_M (memory headroom for concurrent big-moe+medium-moe)
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T00:00:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-079, M-084, M-085]
---

# M-089 — Download + serve Ornith-1.0-35B Q4_K_M (memory headroom for concurrent big-moe+medium-moe)

## Context
Confirmed live 2026-08-05: with `laguna-s-2.1-118b-q4km` (big-moe) and the
Ornith Q8_0 build (medium-moe) both loaded, the box sits at ~122GB/124GB
total memory — essentially zero headroom. Running concurrent agentic coding
workflows against both models OOM-killed the Ornith container twice in one
afternoon (`docker inspect` confirmed `OOMKilled: true`, exit 137).

M-079's own decision log already flagged this exact fix as cheap to do
later: *"Ornith kept at Q8_0 per Chris's stated preference even though
singulared's own Strix-Halo numbers recommend Q4_K_M (~80 vs ~64 tok/s,
near-equal acceptance) — noted as cheap to switch later."* Chris asked for
that switch now: "Is there a smaller quant of this same ornith build that
would give the breathing room needed? If so, let's get the download on
that started."

Medium-moe is currently pinned back to `qwen3.6-35b-a3b-mtp` (the stable
fallback) — this card does NOT touch that or `set-role.sh`. Purely
additive: new model definition + triggering its download, so a smoke-test
+ role-switch can happen later once the file is down and verified.

## Plan
1. [x] Confirm Q4_K_M genuinely exists in `singulared/Ornith-1.0-35B-MTP-GGUF`
   (same repo as Q8_0) via HF API tree listing — exact file, exact size.
2. [x] Verify MTP tensors present via direct GGUF header parse (ranged HTTP
   GET of the first ~20MB, hand-rolled struct parser — same rigor M-079
   used, not trusting the filename or repo README claims).
3. [x] Read the existing Q8_0 `configuration.nix` model entry + compose
   service block in full; confirm the NixOS-managed-model-path pattern
   (declarative `models` list → per-model `download-model-<name>` oneshot
   systemd service, `.timer`-triggered so `nixos-rebuild switch` never
   blocks on a multi-hour download, gated on `.download-complete` marker;
   `docker-compose-app` polls all markers before `docker compose up -d`).
4. [x] Add `llamacpp-ornith-1.0-35b-mtp-q4` to `configuration.nix` `models`,
   mirroring the Q8_0 entry's provenance-comment style.
5. [x] Add `ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1` compose service,
   port 8113 (8110-8112 already taken by the 3 M-079 services), same
   `--spec-type draft-mtp --spec-draft-n-max 4 --spec-draft-p-min 0.6 -np 1`
   flags as the Q8_0 entry (README confirms identical recommended flags for
   both quants). Q8_0 entries untouched — additive only, both coexist as
   defined services.
6. [x] Check disk space on box before triggering (needed comfortably more
   than the ~20.6GiB download).
7. [x] Commit + push to main; deploy on box (`git pull --ff-only` +
   `nixos-rebuild switch`); confirm download triggered and actually
   progressing (growing file size / hf cache, not just command exit 0).
8. [x] (follow-up, NOT this card originally — done here anyway per Chris's
   explicit "smoke test and benchmark the new models" instruction) once
   download completes: smoke test the service. Role-switch decision to
   Chris is still NOT made here — left open, see Decision log/Handoff.

## Signals
<!-- signal: claude 2026-08-05T00:00Z — claiming, researching Q4_K_M provenance -->
<!-- signal: claude 2026-08-05T19:17Z — deployed via nixos-rebuild switch (clean eval, no syntax issues); download-model-llamacpp-ornith-1.0-35b-mtp-q4 service active and growing (148K -> 11M within first minute, .incomplete marker present as expected mid-transfer); laguna-s-2.1-118b-q4km and qwen3.6-35b-a3b-mtp confirmed still running untouched -->
<!-- signal: claude 2026-08-05T19:17Z — handoff ready: smoke test + role-switch decision left for later, per task instructions -->
<!-- signal: claude 2026-08-05T23:40Z — board sweep: confirmed live, .download-complete now present at /var/lib/ai-models/llamacpp-ornith-1.0-35b-mtp-q4/ — download finished. Service (ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1) not yet started. Not moving to done/ myself — this card's own handoff notes explicitly scope smoke-test+role-switch as follow-up kept open on purpose, not an oversight. -->
<!-- signal: claude 2026-08-06T03:45Z — smoke test + comparative benchmark done, catalog recorded. Role-switch decision still explicitly NOT made — staying in now/ pending that. -->

## Decision log
- 2026-08-05: Confirmed via HF API tree (`/api/models/singulared/Ornith-1.0-35B-MTP-GGUF/tree/main`)
  that `ornith-1.0-35b-MTP-Q4_K_M.gguf` exists in the same repo as the
  deployed Q8_0 build. Exact size: 22,064,714,912 bytes (~20.55 GiB).
- 2026-08-05: MTP tensor presence verified by parsing the real GGUF header
  (ranged HTTP GET, hand-rolled little-endian GGUF v3 struct parser — not
  trusting `gguf-dump` against a truncated file, not trusting the
  filename/README). Result: 753 tensors total (matches the Q8_0 build
  exactly), including all 4 `blk.40.nextn.{eh_proj,enorm,hnorm,shared_head_norm}`
  MTP tensors. `blk.40.*` has 20 tensors (16 ordinary + 4 nextn) vs
  `blk.39.*`'s 16 — confirms the MTP graft survived the re-quant, not a
  naive quantization that dropped the head.
- 2026-08-05: Repo's own README (fetched directly, not assumed) states the
  MTP head is kept at **Q8_0 precision in both builds** — the
  `nextn.eh_proj` tensor (~9MB) is deliberately not quantized down with the
  rest of the body, which is *why* acceptance barely drops between builds
  (0.859 Q8_0 vs 0.847 Q4_K_M — only 1.2 points). README's own recommended
  usage flags for Q4_K_M are byte-identical to the Q8_0 entry's:
  `--spec-type draft-mtp --spec-draft-n-max 4 --spec-draft-p-min 0.6`.
  README also lists their own Strix-Halo Vulkan measurement: Q4_K_M+MTP
  80.2 tok/s vs Q8_0+MTP 63-66 tok/s — matches the number M-079 already
  cited secondhand.
- 2026-08-05: Picked port 8113 — grepped `docker-compose.yml` for every
  `127.0.0.1:81xx` binding; 8100-8112 all taken (highest prior was 8112,
  the M-079 KAT MTP service), 8113 free.
- 2026-08-05: Disk check before triggering: `/` on the box had 136G free
  (93% used) — down from M-079's 237G because of the intervening ~105GB of
  M-079 downloads (all now complete) plus other work; still comfortably
  enough for a ~20.6GiB download with wide margin.
- 2026-08-05: Did not touch the Q8_0 `models` entry, its compose service,
  or `set-role.sh` — purely additive per the task constraints. Did not
  touch the currently-running `laguna-s-2.1-118b-q4km` or
  `qwen3.6-35b-a3b-mtp` containers.
- (claude, 2026-08-06) Smoke test + comparative benchmark, per Chris's explicit "smoke test and
  benchmark the new models" instruction. Snapshotted running state first (qwen3.6-35b-a3b-mtp-v2 +
  laguna-s-2.1-v2, the only two model containers running), stopped both by name, started ONLY
  `ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1` (port 8113) by name. Confirmed healthy
  (`/health` -> ok) and MTP draft context created (server log). **Real generated completions
  confirmed**: a short coding request with a generous budget (max_tokens=1000, "keep thinking brief")
  returned real code, finish_reason=stop, 97.98 tok/s, 87.2% MTP draft acceptance. A harder/broader
  request at max_tokens=1200 hit finish_reason=length with empty visible content — confirmed via
  `reasoning_content` this was the known thinking-budget-exhaustion behavior (per M-078's decision log),
  not a broken deployment; re-run at max_tokens=2500 on the same prompt produced real substantive
  content (1695 chars, on-topic). Conclusion: genuinely serving, but needs generous max_tokens
  (>=1500-2000) for non-trivial prompts, same operational lesson as the Q8_0 build.

  Comparative benchmark vs the existing Q8_0 catalog entry, same methodology (llama-bench pp512/tg128
  plain baseline, then live-server MTP timing with `--spec-draft-n-max 3` matching the Q8_0 entry's own
  benchmark run): Q4_K_M plain tg128 76.76 tok/s (Q8_0: 55.26, +39%); MTP live avg 110.39 tok/s across 3
  runs (Q8_0: 64.73, +71%); draft acceptance 0.849 (Q8_0: 0.583). Q4_K_M is faster on every axis measured
  here, not just smaller — no speed tradeoff found, contrary to the naive expectation. GPU memory: ~20.5GiB
  resident (Q8_0 catalogued at 35.86GiB GTT peak) — ~15GB headroom recovered, the whole point of this card.
  New catalog entry: `catalog/builds/ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv.yaml`. Raw results saved
  to `catalog/raw/ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1--llamacpp-mtp-v1--20260806T034300Z-run{1,2,3}.json`.
  Stopped the Q4 service again afterward (not left running as new default), restarted the original two
  containers by name, confirmed both healthy with real completions, no OOM. Did NOT touch `set-role.sh`
  or any litellm role — that decision explicitly stays with Chris.

## Handoff notes
Download, smoke test, and comparative benchmark are all done (2026-08-06) — see Decision log above for
real numbers. **What's still open, deliberately not done here:** the role-switch decision
(`set-role.sh medium-moe ornith-1.0-35b-mtp-q4 ...` or similar) to actually make Q4_K_M the standing
`medium-moe` backend — that's explicitly Chris's call per this card's own original text, not something
to do unilaterally. The comparative numbers above (Q4_K_M faster on every axis, ~15GB less memory) are
real data for that decision whenever Chris wants to make it. Leaving this card in `now/` for exactly
that reason — not an oversight.

Also worth noting for whoever picks up the role-switch: M-084 (claimed by a different agent, "opencode",
still in `now/`) shows `medium-moe` was set to the Q8_0 build at one point (2026-08-05); by the time this
card's work started, no Ornith container was running at all and `medium-moe`'s actual current backend
was not independently re-verified here (out of scope — this card never touches `set-role.sh` or reads
litellm's live role state). Whoever makes the role-switch call should check current live role state
fresh rather than trust either card's snapshot.
