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
9. [x] (2026-08-06, Chris's explicit go-ahead: "89, make it live instead
   of qwen") Role-switch executed: `medium-moe` now points at
   `ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1`. Old qwen backend
   stopped (nothing else referenced it). Verified end-to-end via a real
   pi-web-factory Workflow Run. See Decision log for full detail.

## Signals
<!-- signal: claude 2026-08-05T00:00Z — claiming, researching Q4_K_M provenance -->
<!-- signal: claude 2026-08-05T19:17Z — deployed via nixos-rebuild switch (clean eval, no syntax issues); download-model-llamacpp-ornith-1.0-35b-mtp-q4 service active and growing (148K -> 11M within first minute, .incomplete marker present as expected mid-transfer); laguna-s-2.1-118b-q4km and qwen3.6-35b-a3b-mtp confirmed still running untouched -->
<!-- signal: claude 2026-08-05T19:17Z — handoff ready: smoke test + role-switch decision left for later, per task instructions -->
<!-- signal: claude 2026-08-05T23:40Z — board sweep: confirmed live, .download-complete now present at /var/lib/ai-models/llamacpp-ornith-1.0-35b-mtp-q4/ — download finished. Service (ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1) not yet started. Not moving to done/ myself — this card's own handoff notes explicitly scope smoke-test+role-switch as follow-up kept open on purpose, not an oversight. -->
<!-- signal: claude 2026-08-06T03:45Z — smoke test + comparative benchmark done, catalog recorded. Role-switch decision still explicitly NOT made — staying in now/ pending that. -->
<!-- signal: claude 2026-08-06T17:36Z — role-switch executed on Chris's explicit go-ahead ("89, make it live instead of qwen"): medium-moe -> ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1. Old qwen3.6-35b-a3b-mtp container stopped (nothing else referenced port 8109). Verified via x-litellm-model-api-base header + a real pi-web-factory bounded-build-review Workflow Run (SUCCESS, real files written). Moving to done/. -->

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
- (claude, 2026-08-06 17:20-17:36 UTC) Chris: "89, make it live instead of qwen" — explicit go-ahead to
  execute the role-switch. Sequence:
  1. Snapshotted live state first (restore point): `docker ps` showed `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v2`
     (port 8109) and `laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v2` (port 8108) running; queried
     litellm's live `/model/info` (not `config.yaml`) directly and confirmed `medium-moe` ->
     `openai/qwen3.6-35b-a3b-mtp` @ `http://127.0.0.1:8109/v1` (resolves M-089's own earlier Handoff note
     that this needed fresh verification, not trusting M-084's snapshot — it had drifted since: M-084 had
     it on the Q8_0 build at one point, but by role-switch time it was back on qwen).
  2. Verified the target service (`ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1`) was still correctly
     defined in `docker-compose.yml` (port 8113, `-a ornith-1.0-35b-mtp-q4`, same MTP flags as before) and
     confirmed the model file + `.download-complete` marker still present. Started it by exact service
     name (`docker compose -f docker-compose.yml up -d ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1` —
     never a blanket `up -d`). Confirmed healthy via `/health` -> `{"status":"ok"}` and a direct
     completion request (real generation, finish_reason=stop).
  3. Checked real memory headroom with laguna (big-moe) + qwen (still running) + ornith-q4 all loaded
     simultaneously — the exact scenario Q4_K_M was chosen to fix: `rocm-smi --showmeminfo gtt` showed
     ~111GB/133GB GTT used (~22GB real headroom), `free -h` showed ~13-14GB "available" — comfortably
     positive, unlike the old Q8_0 configuration (~2GB headroom, OOM-killed twice per this card's own
     Context section).
  4. Ran `scripts/set-role.sh medium-moe ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1`. Script's own
     built-in live verification returned `VERIFIED`.
  5. Independently re-verified (not just trusting the script's own check): a direct
     `POST /v1/chat/completions` against litellm with `model: medium-moe` returned response headers
     `x-litellm-model-name: openai/ornith-1.0-35b-mtp-q4` and
     `x-litellm-model-api-base: http://127.0.0.1:8113/v1` — genuinely resolving to the new backend, not
     just a successful response. Cross-checked against `ornith-1.0-35b-mtp-q4`'s own container logs,
     which showed live `print_timing`/`draft acceptance` entries in the same time window.
  6. Checked whether anything else referenced the old qwen backend (port 8109) before stopping it —
     queried litellm's live `/model/info` for any role with `api_base` containing `8109`: none found.
     Stopped `qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v2` by exact container name (not a blanket
     command). Final `docker ps` confirms only `laguna-s-2.1-118b-q4km--llamacpp-vulkan-radv-v2` (big-moe)
     and `ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1` (medium-moe) remain as model-serving containers;
     `litellm-proxy`/`litellm-db`/`litellm-queue-haproxy`/`pi-web`/`pi-web-factory-visualizer` all
     untouched throughout, per the standing safety rules.
  7. Ran one real, substantive end-to-end test: a genuine pi-web-factory `bounded-build-review` Workflow
     Run (via `docker exec pi-web bun cli.ts --project <scratch> --workflow bounded-build-review "<prompt>"`,
     same pattern as prior cards) against a fresh scratch git repo (needed adding a minimal
     `.pi-web-factory.yaml` — the scratch repo had none; `--session-id` needed to be *omitted* on a fresh
     run, since that flag is for *resuming* an existing pi-web session, not naming a new one — passing an
     arbitrary new ID hit `PiWebClientError 404: Session not found` twice before this was understood).
     The `build` Role in `factory.config.yaml` maps to `local-litellm/medium-moe` — exactly the role just
     switched. Result: `SUCCESS` end to end (build -> review loop exited clean, not round-exhausted); the
     worktree's real output files were correct and on-task (`hello.txt` contained exactly the requested
     line, `notes.md` accurately described the action taken) — confirmed by reading the actual worktree
     contents, not just the CLI's own "SUCCESS" text. Ornith server logs showed matching inference
     activity (`print_timing`/`draft acceptance` entries) in the same ~1-minute window the run took.
     Cleaned up the scratch project afterward.
  Final live litellm state (re-queried after all changes): `medium-moe -> openai/ornith-1.0-35b-mtp-q4 @
  http://127.0.0.1:8113/v1`, `big-moe -> openai/laguna-s-2.1-118b-q4km @ http://127.0.0.1:8108/v1`
  unchanged. Memory headroom in the final configuration (laguna + ornith-q4 only, qwen stopped): still
  ~111GB/133GB GTT used, ~22GB headroom, ~13GB "available" per `free -h` — real, comfortably positive
  headroom, confirming the whole point of this card.

## Handoff notes
Download, smoke test, comparative benchmark, and the role-switch itself are all done (2026-08-06).
`medium-moe` now genuinely serves from `ornith-1.0-35b-mtp-q4--llamacpp-vulkan-radv-v1` (Q4_K_M) —
verified via litellm response headers, container logs, and a real pi-web-factory Workflow Run, not just
a raw completion ping. The old `qwen3.6-35b-a3b-mtp` backend is stopped (nothing else referenced it).
Operational note carried over from the smoke test: Ornith is a genuine reasoning model — non-trivial
prompts need generous `max_tokens` (>=1500-2000) or they can hit `finish_reason: length` with all budget
spent on invisible `reasoning_content` and no visible output; this is known, documented behavior
(M-078's decision log), not a bug in this deployment.

Still open, not part of this card: M-084 (a different agent's card, still in `now/` as of this update)
may need its own state re-synced/closed out now that `medium-moe`'s live backend has changed again —
not touched here, out of this card's scope.
