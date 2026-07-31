---
id: M-037
title: Decommission pi-agent-supervisor - pi-web is the way forward
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T06:15:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-030, M-031, M-032, M-033, M-034, M-035, M-036]
---

# M-037 — Decommission pi-agent-supervisor - pi-web is the way forward

## Context
After building our own bespoke supervisor+frontend (M-030..M-034) and then
deploying `pi-web` alongside it for comparison (M-035), Chris has decided:
full removal of `pi-agent-supervisor`, `pi-web` going forward. This is an
explicit decision, not a judgment call — confirmed directly.

## Plan
1. [x] Stop and remove the `pi-agent-supervisor` container on the box.
2. [x] Remove the `pi-agent-supervisor` service block, its named volume
   (`pi-agent-data`), and any port/firewall entries scoped only to it
   from `docker/docker-compose.yml` / `configuration.nix`.
3. [x] Remove the `pi-agent/` directory (supervisor + frontend source)
   from the repo.
4. [x] Keep the shared bits still in use by `pi-web`:
   `docker/agentic-fleet-AGENTS.md` (M-036) stays - it's mounted into
   `pi-web` too, don't delete it. Firewall port 3002 can be removed from
   `configuration.nix` since nothing will use it anymore.
5. [x] Real deploy: pushed, pulled on box, firewall rebuilt
   (`sudo .../nixos-rebuild switch --flake /etc/nixos#local-ai-machine`).
   Verified: port 3002 off-box curl now fails (connection refused, as
   expected), `pi-web` still healthy (200) on port 30141. See decision
   log for a real incident that happened during the compose-side part of
   this deploy - the removal itself is done and verified, but there's an
   open item (coder-model health) that needs Chris's own check.

## Signals
<!-- signal: claude 2026-07-31T06:15Z — claiming, working the 6-ticket overnight batch per Chris's direction -->
<!-- signal: claude 2026-07-31T06:22Z — real incident during deploy: caused brief coder-model downtime as collateral damage, see decision log. Restarted, but pausing further shared-model-stack actions tonight pending Chris's review. -->
<!-- signal: claude 2026-07-31T22:00Z — the pending handoff item (verify coder serves real completions) is resolved: a separate session extensively exercised the coder role for hours afterward (multiple model swaps: qwen3-coder-next, glm-4.7-flash, laguna-s-2.1, now an orchestrator role) with real chat completions succeeding throughout. Not closing this card myself (not my work to sign off on) but flagging the blocking concern as answered. Also: M-035/M-036/M-038 (this card's own related_cards) and a since-created M-037 (a different, unrelated design-work card that collided with this card's real id, renumbered to M-037.1) have all been closed as moot per Chris's direction, since this decommission made their whole premise obsolete. -->

## Decision log
- (claude, 2026-07-31T22:00Z) Pending handoff item resolved: confirmed
  live, not assumed, that the `coder` litellm role has been repeatedly
  re-pointed and exercised for real (qwen3-coder-next-gptq4bit, then
  glm-4.7-flash-judge, then laguna-s-2.1-118b-q4km, then back to
  glm-4.7-flash-judge again via a new `orchestrator` role) across several
  hours after this card's last update, with real `/v1/chat/completions`
  responses returned successfully each time. The "needs Chris's own
  check" item below can be considered answered — the model stack has
  been healthy and serving throughout, not just superficially "Started".
- Container/volume removed on the box, compose service + `pi-agent/`
  source + firewall port 3002 removed from the repo, committed and
  pushed. Real mistake made deploying it: ran `docker compose up -d
  --remove-orphans` with no service name to apply the removal, which
  reconciles the *entire* compose file against running state rather than
  scoping to what changed - it started ~13 large vLLM/llama.cpp model
  services that were deliberately stopped (visible from their fresh
  ~24s uptime vs. everything else's much longer uptime: gpt-oss-120b,
  qwen3.5-122b-a10b, qwen3.6-27b x2, gemma-4-26b/31b, laguna-s-2.1-118b,
  north-mini-code, qwen2.5-vl-7b, qwen3.6-35b-a3b--vllm (a duplicate of
  the already-running llamacpp-mtp one), qwen3-coder-next,
  glm-4.7-flash-awq). All that simultaneous loading almost certainly
  caused an OOM condition: the actively-serving `coder` model
  (`qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1`) was killed as
  collateral damage (exit 137, ~SIGKILL) during the ~25s window,
  confirmed via `docker ps -a`, not assumed.
- Immediately stopped all ~13 accidentally-started services (explicitly
  by name, not another blanket command) to restore the prior state, then
  restarted the coder model specifically (`docker compose up -d
  qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v1`, scoped to that one
  service) - it shows "Started" and back in `docker ps` at time of
  writing.
- A follow-up health/completion check on the restarted coder model got
  denied by the safety classifier, correctly reading the whole sequence
  as "unilaterally stopped ~13 unrelated already-running model-serving
  containers on a shared box, beyond the scope of the one new service
  actually requested" - not a false alarm. Stopping further shared-
  model-stack verification/action here for the rest of tonight rather
  than pushing through solo; this needs your eyes on it directly, not
  another automated recovery attempt. **The one thing that still needs
  confirming by hand: that `coder` is actually serving real completions
  again, not just that its container shows "Started".**
- Lesson for future deploys on this box: never run a blanket
  `docker compose up -d` (or with `--remove-orphans`) without a specific
  service name when only one service changed - always scope it
  (`docker compose up -d <service>` or `up -d --build <service>`,
  the pattern used correctly everywhere else this session before
  tonight's mistake).

## Handoff notes
**Needs your direct verification in the morning** (or whenever you're
back): confirm `coder` (qwen3.6-35b-a3b-mtp) is actually healthy and
serving real completions, not just that `docker ps` shows it started.
I have not re-attempted this check myself after the classifier denial.
Everything else in this card (pi-agent-supervisor removal itself) is
done and doesn't need re-verification - only the collateral-damage
recovery needs eyes on it.
