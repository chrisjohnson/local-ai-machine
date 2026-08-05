---
id: M-072
title: pi-web-factory — Agent Skill for triggering chains from inside any pi-web session
initiative_id: null
claimed_by: claude
claimed_at: 2026-08-05T03:15:00Z
blocks: null
blocked_by: [M-071, M-068]
status: null
related_cards: [M-066, M-067, M-068, M-071, M-073]
---

# M-072 — pi-web-factory — Agent Skill for triggering chains from inside any pi-web session

## Context
Chris's feedback 2026-08-04: agentic triggering should be first-class. Sitting inside
any pi-web session, say "run the pipeline for X" and have it happen — a skill calling
`cli.ts` under the hood is fine — ideally with a link back to the new session
(`pi-web-adw-design.md` §6.1 point 4, §6.3). Blocked on M-071 since the "link back to
the session" part needs `cli.ts` to already print a real deep-link, not a bare id.

pi's native Agent Skills mechanism is already confirmed working on this box (loaded
automatically from `$PI_CODING_AGENT_DIR/skills/<name>/SKILL.md` into every session's
system prompt) — used today only for a *plugin* (`pi-continue-companion`), never yet
for an actual Skill. Confirmed live: `PI_CODING_AGENT_DIR=/home/piweb/.pi-web`
(bind-mounted from host `~/.pi-web`), no `skills/` subdirectory exists there yet.

**The skill is UX, not execution** — SSSF's own `SKILL.md` pattern (this doc's §1.1:
routing table, lazy-loaded cookbooks, "print available workflows, wait for the
request") is the model, adapted to the fact that pi-web-factory's real logic already
lives in TS (`chains/`, `run.ts`, etc.), not in the skill's own instructions. The
skill's job is: recognize a request that matches an available chain, resolve the
right `--project`/`--chain`/prompt arguments, run `bun cli.ts ...` via the session's
own bash tool, and report the real result (including the link M-071 makes possible)
back to the human in the same conversation.

## Plan
1. [ ] `~/.pi-web/skills/pi-web-factory/SKILL.md` — frontmatter (`name`, `description`
   with clear trigger keywords, per pi's Skill format — same shape SSSF's own
   `SKILL.md` uses, confirmed compatible with pi's loader in earlier research) +
   startup behavior: list available chains (from `chains/registry.ts`'s
   `chainNames()`) with a one-line description each, wait for the human's actual
   request — mirror SSSF's own explicit "don't volunteer state, don't probe, wait"
   discipline (this doc's §1.1's SKILL.md excerpt) rather than inventing new startup
   behavior.
2. [ ] Routing: map a natural-language request to `--project` (needs the project's
   real absolute path — how does the skill learn this? likely: the session's own
   `cwd` already IS the target project in the common case, since a human triggering
   this from inside a project's own pi-web session is the expected flow — confirm
   this assumption or handle the case where it isn't explicitly), `--chain` (pick the
   shape that matches the request — "quick fix" -> `plan-build-test`, "review this
   carefully" -> the bounded build↔review chain from M-073, etc. — needs M-073's
   chain names to exist first, or ship with just today's `plan-build-test` and extend
   later).
3. [ ] Have the skill instruct the model to run `bun cli.ts ...` (absolute path to
   this project's `pi-web-factory/` dir) via its bash tool, capture the printed
   adwId/sessionId/deep-link, and relay it back to the human directly in the
   conversation — not just dump raw CLI stdout.
4. [ ] Deploy: land the file on the box (`~/.pi-web/skills/pi-web-factory/SKILL.md`),
   confirm it's actually loaded (check a fresh pi-web session's system prompt, or the
   pi-web-factory-prompts extension work from M-069 if that lands first and offers
   an easy way to inspect what's loaded).
5. [ ] Live verification: from an ordinary pi-web session (not via `cli.ts` directly),
   make a natural-language request, confirm the skill triggers, a real chain runs,
   and the reported link actually opens the resulting session.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T02:30Z — investigated, hit a real architectural fork, marked needs-refinement -->
<!-- signal: claude 2026-08-05T03:15Z — refined with Chris, plan set, waiting on M-077's live testing to clear before touching pi-web -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): M-071 (blocker) is done, so I started this — but hit the
  question the Plan itself flagged as open ("how does the skill learn the project's
  real absolute path... confirm this assumption or handle the case where it isn't")
  and it's bigger than routing. Investigated the actual box topology:
  - The `pi-web` container (`ghcr.io/jmfederico/pi-web:latest`) is where every
    session's Skill/bash-tool actually executes — confirmed `bun` is present inside
    it, `PI_CODING_AGENT_DIR=/home/piweb/.pi-web` (skills load from here, matches
    M-072's own earlier research), and its current bind mounts are: docker.sock
    (rw), `~/turnstone-workspace/printer-dashboard` → `/work`, `~/.pi-web` →
    `/home/piweb/.pi-web`, `~/.ssh` → `/home/piweb/.ssh` (github deploy key only,
    no general host-reachable key).
  - `pi-web-factory` itself is NOT mounted into that container (expected — M-068,
    the Docker bake-in card, is explicitly the LAST card and hasn't happened). So a
    Skill's bash tool, running inside `pi-web`, has no path to `cli.ts` today.
  - Found the box also has its own separate clone of this repo at
    `/home/chris/local-ai-machine` (currently a bit behind origin/main — being used
    concurrently by a different agent, "opencode", on the unrelated M-079 card;
    left entirely alone, not my concern).
  - Two real ways to make `cli.ts` reachable from inside a live session, before
    M-068 exists to do it properly: (a) add a new bind mount into the *existing*
    `pi-web` container's compose config for `pi-web-factory`'s own checkout, which
    requires restarting that container to pick up the new mount — but unlike
    M-069's medium-moe restart (a headless backend model server with no live user
    state), `pi-web` is the container hosting every actual interactive session;
    restarting it risks interrupting live WebSocket connections/sessions in a way
    I can't fully characterize from here (unknown whether session state survives a
    container restart), and touches this repo's own hard-stop rule's spirit even
    though it isn't a literal session archive/delete. (b) Use the mounted
    docker.sock to `docker run` a disposable sibling container per invocation
    (mounting the factory checkout + target project path fresh each time) — avoids
    touching the live `pi-web` container at all, but is a genuinely new, untested
    invocation pattern (image pull/cache behavior, path-mapping correctness,
    latency) that deserves its own real verification pass, not a first try wired
    directly into a Skill a human might trigger for real work.
  - Neither is a "just proceed" call given the blast radius of (a) and the
    unvalidated-new-mechanism risk of (b) — this is a genuine design fork, not a
    routing detail, so marked `needs-refinement` rather than pushed through solo.
    Left in `now/` (already human-promoted via the original feedback that created
    this card) — the refinement gap is about approach, not whether this should be
    worked at all.

## Handoff notes
**Refined with Chris 2026-08-05.** While investigating, found the live `pi-web`
container is running a stale config relative to `docker/docker-compose.yml`
(config-hash mismatch: running `74411c27...` vs current file `67ae535d...`) — the
compose file has pointed at a local Dockerfile build (`../pi-web`) with Claude-bridge
env vars (`IS_SANDBOX`, `CLAUDE_CODE_OAUTH_TOKEN`, M-039) and a named volume at
`/data` since 2026-07-31, but the running container never actually picked any of
that up (still `ghcr.io/jmfederico/pi-web:latest`, still the old
`~/.pi-web`-bind-mount config) despite being recreated as recently as tonight's
M-069 deploy. Chris confirmed (2026-08-05): "nothing super sensitive in the
container, fire away" — authorized redeploying pi-web to match current compose
state, and separately confirmed nothing (him or any other agent) currently needs
the live container to stay up.

**Refined again 2026-08-05, same conversation:** Chris pointed out a better option
than the bind mount above — `pi-web-factory` should just be `COPY`'d into the
`jmfederico-pi-web` image itself, exactly the pattern `plugins/pi-continue-companion`
already uses (image build + entrypoint re-sync on every container start, never a
bind mount tied to a host-side checkout staying in sync). This is literally what
`M-068`'s own Plan items 1-2 already specify (`COPY` into `jmfederico-pi-web/Dockerfile`,
re-synced by the entrypoint) — M-068 was just sequenced to happen dead last,
*after* M-072, on the assumption the skill mechanism would be figured out first.
That assumption is now backwards: M-072 needs the bake-in to exist before the
Skill can run `cli.ts` at all. Resolved by flipping the dependency: M-072 is now
`blocked_by` M-068 (added above) instead of the reverse (removed from M-068's
`blocked_by` — see that card's own decision log). M-068's *remaining* scope (the
real box deploy via `git pull` + scoped rebuild, the first live end-to-end smoke
test, and the design-doc update) still makes sense to do last, after M-077 too —
only its Dockerfile/entrypoint COPY step is being pulled forward, done as part of
unblocking this card.

**Resulting plan for M-072**: no bind mount, no disposable sibling container. Add
`pi-web-factory/` to `jmfederico-pi-web/Dockerfile` (`COPY`, mirroring
`pi-continue-companion`'s exact pattern) and the entrypoint's always-sync step,
rebuild+redeploy the `jmfederico-pi-web` image (this also happens to be the same
redeploy that finally picks up the pending Claude-bridge compose drift noted
above — one deliberate redeploy, not two). Once live, the Skill's bash tool
(running inside pi-web's own container) can run `bun /pi-web-factory/cli.ts ...`
directly against the one real pi-web server over HTTP — same server, same API,
just invoked from inside instead of from this Mac.

**Sequencing:** deliberately NOT executed yet as of this note — M-077's
implementing sub-agent was still live-testing against the real pi-web server when
this was decided; rebuilding/restarting pi-web mid-flight would have pulled the
rug out from under its in-progress verification. Do the Dockerfile/entrypoint
change + rebuild + redeploy once that settles, then resume the rest of the
original Plan (SKILL.md content, routing, deploy, live verification) unchanged.
