---
id: M-043
title: Move dynamic litellm roles to DB-only, API-managed (terraform ignore_changes pattern)
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-31T14:45:00Z
blocks: null
blocked_by: null
status: null
related_cards: [M-040]
---

# M-043 — Move dynamic litellm roles to DB-only, API-managed

## Context
Surfaced while adding the `vision` role (M-040 follow-up): the previous
design committed role *values* to `docker/litellm/config.yaml`
(coder/judge, edited in place by `set-role.sh` via sed) while also
expecting role *structure* to be committed separately - the first time a
genuinely new role needed both a new committed block and a live runtime
flip in the same session, that collided as a real `git pull` conflict on
the box (the box's uncommitted `judge` flip vs. the incoming `vision`
block addition, same file).

Chris's explicit design direction: terraform's `lifecycle { ignore_changes
}` as the reference model - a codified resource (the role exists) whose
live value is allowed to drift on the running server without git ever
seeing that as a conflict, by construction, not by convention. Also
confirmed litellm's actual original design intent (from an earlier
conversation) was an API-managed mechanism, not file-editing - this
closes that gap using litellm's own real Model Management API,
confirmed directly against the running instance's own OpenAPI schema
(not docs prose, which had moved/404'd).

## Plan
1. [x] Enabled `general_settings.store_model_in_db: true` in
   `docker/litellm/config.yaml` (litellm already had a Postgres DB wired
   up via `DATABASE_URL` - no new infra).
2. [x] Removed `coder`/`judge`/`vision` from the static `model_list`
   entirely - confirmed the ambiguity risk directly (litellm's own docs:
   "config models are owned by the file, so they cannot be edited... from
   the UI" - keeping both a static AND DB-backed entry for the same role
   name would be genuinely ambiguous, not just messy).
3. [x] Wrote `scripts/litellm-bootstrap.sh` (same idempotent-seed pattern
   as `scripts/turnstone-bootstrap.sh`): seeds each role via `POST
   /model/new` with a DELIBERATELY non-functional stub
   (`openai/UNCONFIGURED-run-set-role.sh`,
   `http://unconfigured.invalid/v1`) only if it doesn't already exist -
   Chris's explicit refinement: a plausible-looking stale model
   reference risks a future session mistaking it for the real live value
   and "fixing" it in the wrong place.
4. [x] Rewrote `scripts/set-role.sh` to call `POST /model/update`
   (looking up the role's DB id via `GET /model/info` first) instead of
   sed-editing the file. Confirmed empirically, not just from docs: DB-
   backed changes apply live, no litellm restart needed per role change.
5. [x] Deployed for real, sequenced to minimize the live window where
   roles were unset: pulled, restarted litellm once (required for the
   `store_model_in_db` config change itself), immediately ran bootstrap
   + `set-role.sh` for all three roles to restore their real values.
6. [x] Verified independently (not just each script's own self-check):
   direct completions against `coder`/`judge`/`vision` all returned
   correct, distinguishable responses; `litellm-proxy`'s container uptime
   stayed constant across all three `set-role.sh` calls, confirming no
   restart happened for any of them.

## Signals
<!-- signal: claude 2026-07-31T14:50Z — done, verified independently, no restart needed per role change confirmed empirically -->

## Decision log
- Real API research needed two rounds: litellm's public docs page
  404'd (moved/restructured), so the exact `/model/new` and
  `/model/update` request schemas were pulled directly from our own
  running instance's `/openapi.json` instead - ground truth from the
  actual software, not stale/relocated docs.
- `/model/update` requires the DB row's `model_info.id`, not just the
  `model_name` - confirmed from the real schema (`updateDeployment`'s
  `model_info` field), not assumed. `set-role.sh` looks this up via
  `GET /model/info` before calling update.
- Any future new dynamic role needs one addition to
  `scripts/litellm-bootstrap.sh`'s `ROLES=(...)` array (a real git
  commit, since that's "a role should exist") - but never again a
  commit for *which model* backs it.

## Handoff notes
Live and verified: `coder` → qwen3.6-35b-a3b-mtp, `judge` →
glm-4.7-flash-judge, `vision` → qwen2.5-vl-7b-instruct, all confirmed via
independent completions after deploy. `docker/litellm/config.yaml` no
longer has a merge-conflict risk on role values - only structural changes
(a new role name, static entries) touch that file going forward.
