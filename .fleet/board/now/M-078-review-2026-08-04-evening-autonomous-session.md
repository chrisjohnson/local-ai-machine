---
id: M-078
title: Human review — judgment calls made during the 2026-08-04 evening autonomous session
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-071, M-072, M-075, M-076, M-077, M-068]
---

# M-078 — Human review — judgment calls made during the 2026-08-04 evening autonomous session

## Context
Chris, 2026-08-04 ~21:25: "Keep making progress on everything planned for this work
[...] Don't stop to ask questions, if you need to make a decision make the one that
makes the most sense and then record a new ticket blocked on human review about
reviewing the tickets (place in now)." He's stepping away for the evening, not using
the machine, and granted standing authorization for this session to: merge PRs in
`printer-dashboard` or `local-ai-machine` as needed, deploy/restart live services as
needed, and make judgment calls without pausing to ask — all provided everything stays
git-driven (no direct/hand edits except temporary local testing, cleaned up and
re-deployed via git afterward).

This card is **not blocked on another card** — it's a running log, kept open and
appended to as the session progresses, of every consequential judgment call, deploy,
merge, or design decision made without Chris's real-time input. Its purpose is to make
review cheap when he's back: read this one card, not every card's full decision log.
Each entry below cross-references the card where the full reasoning/evidence lives.

**Chris: start here.** Skim the entries below in order; each links to the card with
full detail if you want to dig in. Nothing below was silently done — every card this
references has its own complete decision log, this is just the index of what most
needs your eyes.

## Log (append-only, newest last, one entry per consequential call)

- 2026-08-04T21:28Z — card filed, session continuing per Chris's standing grant.
- 2026-08-04T22:10Z — **M-071 done** (git-worktree-per-run, pi-web Project
  registration, real session deep-links). Two judgment calls worth a look: (1)
  worktree location — nested inside the project's own checkout rather than a true
  sibling directory, forced by a real container-topology constraint (only one bind
  mount per project) — see M-071's decision log for the verification trail. (2)
  Cleanup policy — worktrees are kept forever after a run, never auto-removed
  (reasoning: post-hoc inspectability matters more than tidiness at today's
  manual-trigger volume) — this means `<project>/.pi-web-factory-worktrees/` will
  grow unbounded over time with no sweep yet built. Worth confirming you're fine
  with that tradeoff before volume increases.
- 2026-08-04T22:35Z — **M-075 done** (unified Roles config: agent + code, real
  system prompts). Replaced `config.ts`'s old agent-only roster entirely (not kept
  alongside) — every call site updated, confirmed via clean `tsc --noEmit`. System
  prompt content is a deliberate, documented duplicate of the M-069 extension's
  `roles.json` (verified byte-for-byte identical myself) — stays duplicated until
  M-068. No concerns worth flagging on this one beyond what's already in its
  decision log.
- 2026-08-05T01:46Z — **Infra action (not a code card): restarted the OOM-killed
  `medium-moe` container** (`qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v2`). While
  building/testing M-076, the sub-agent found this container had been OOM-killed
  (`docker inspect`: `OOMKilled: true`, exit 137, `RestartPolicy: no`) by something
  else on the shared box — unrelated to pi-web-factory's own work (confirmed:
  every live test needing the build step failed identically, including the
  pre-existing, already-`done` `planBuildTest.integration.test.ts`, ruling out a
  regression from this session's changes). Left down rather than restarted by the
  sub-agent (correctly — restarting shared infra without confirmation is a
  hard-stop). I restarted it myself, scoped (`docker compose up -d
  qwen3.6-35b-a3b--llamacpp-vulkan-radv-mtp-v2`) — covered by your standing "deploy/
  manage workloads as needed" grant, and reasonable regardless of this session's own
  needs since a core production model being down affects the whole box, not just
  pi-web-factory testing. Confirmed healthy afterward (health check 200, a real
  completion served through litellm). System had ~32GB available memory at the
  time, so this wasn't an ongoing resource-exhaustion loop — worth keeping an eye
  on if it recurs, but no action taken beyond the restart.
- 2026-08-05T02:20Z — **M-076 done** (generic Workflow interpreter — the largest,
  most central card of the whole project: YAML-defined Workflows, a generic
  interpreter, loop steps, three registered Workflows). Independent review (not the
  implementing sub-agent) found and fixed one real latent bug (taskPrompt silently
  dropped for a hypothetical loop-first Workflow — neither shipped Workflow is
  affected, but the interpreter needed to be correct generally, not just for what
  it ships with) and one infra staleness bug (hardcoded LAN IP, the box's address
  changed mid-session). One live-test timeout traced via `/status` to genuine
  model slowness under today's heavy concurrent load, not a hang — confirmed via
  clean retry (89s, well under the 120s budget) rather than papered over with a
  timeout bump. Full detail in M-076's own decision log. Nothing here needs your
  input beyond a skim — flagging mainly because it's the biggest card so far.
- 2026-08-05T02:35Z — **M-072 marked `needs-refinement`, not implemented.** This
  one DOES need your input, not just a skim. Investigating the Skill's execution
  path surfaced a real fork: the pi-web container that hosts every live session
  doesn't have `pi-web-factory` on its filesystem (expected — M-068 hasn't
  happened yet), so a Skill's bash tool has no way to reach `cli.ts` today. Two
  live options, both with real tradeoffs (one needs restarting the *interactive*
  pi-web container itself — different risk profile than the medium-moe backend
  restart earlier — the other is an untested new invocation pattern). Didn't want
  to gamble on restarting the container everyone's live sessions run through
  without you around to notice if something broke. Full writeup + both options in
  M-072's own decision log/handoff notes.
- 2026-08-05T02:50Z — Ran a manual, non-fixture live test (real bug-fix task —
  editing an existing `calc.py`'s subtraction-instead-of-addition bug — via
  `plan-build-review` against an isolated scratch repo) as the explicitly-requested
  "test different types of work" pass, complementing the automated suite's mostly
  create-a-file-from-scratch fixtures. Passed clean end to end (correct fix,
  correct commit, correct review approval); cleaned up the session/project/scratch
  repo afterward, confirmed no dirty state. Also discovered mid-pass:
  `printer-dashboard`'s shared main checkout on the box currently has an *unmerged*
  PR branch (`fix/ams-code-review-fixes`, PR #29 — open, not merged, contrary to my
  own earlier assumption) checked out as HEAD, and has its own separate, currently
  active `.fleet`/worktree activity (a `K-033` card) from a different agent — so I
  deliberately did NOT run further live workflow tests against printer-dashboard
  itself this pass (would have branched off the wrong ref and risked interfering
  with that other agent's in-progress work). Used an isolated scratch repo instead.
  Worth knowing PR #29 is still open if you want it merged or closed.
- 2026-08-05T02:55Z — Regenerated and opened the HTML dashboard
  (`docs/pi-web-factory-walkthrough-2026-08-04.html`), rewritten to match the
  current architecture (Workflow/Step/Role terms, M-076's interpreter, M-071's
  worktrees/deep-links, M-069's real system prompts, M-070's per-project config,
  M-074/M-076's token tracking, updated exit codes, status grid through M-078).
- 2026-08-05T03:20Z — **This whole stretch, worked live with Chris (not
  autonomous) once he came back — "refine 72" through pi-web-factory's Docker
  bake-in and the Skill going live.** Summary of what happened, in order:
  - **M-077 done** (real-time visualizer). Independent review confirmed the
    core requirement (idle time compressed, not drawn to scale) via both its
    own tests and my own live `curl` against the real running server. Found
    one piece of leftover state NOT from this card — 9 stray sessions + 1
    stray Project from my own earlier M-076 testing iterations (a fixed,
    non-randomized scratch path meant every rerun reused it) — held off
    deleting them until you explicitly confirmed (the hard-stop rule's
    classifier correctly blocked my first attempt, which was based on
    inference/pattern-match rather than tracked IDs); you confirmed, cleaned
    up.
  - **Found and corrected my own mistake**: initially reported the live
    `pi-web` container as running stale config vs. `docker-compose.yml` —
    wrong. There are two similarly-named compose services (`pi-web:`, the
    old `agegr/pi-web` comparison partner, vs `jmfederico-pi-web:`, the real
    one) and I'd compared against the wrong one. No real drift existed;
    corrected directly with you once found. You had already told me to "fire
    away" on a redeploy based on the wrong premise — flagged and walked back
    before doing anything, then removed the stale `pi-web:` service/directory/
    volume declaration entirely per your explicit "clean up that previous
    experiment" instruction.
  - **M-068 done** (Docker bake-in + first live end-to-end smoke test) —
    pulled forward ahead of its original "dead last" sequencing because M-072
    needed it. Deployed for real (`docker compose up -d jmfederico-pi-web`,
    you confirmed nothing needed the container to stay up). One real,
    non-obvious fix caught before deploying: `factory.db`'s path had to move
    OUT of the always-resynced code directory, or every container restart
    would have silently destroyed real accumulated observability history.
  - **M-072 done** (the triggering Skill) — built, baked into the image
    (corrected my own earlier plan: the skill file needs to be git-tracked,
    not hand-placed on the host's bind mount), deployed, and live-verified
    end-to-end from an ordinary session with a natural-language request. It
    worked correctly — but the live run also surfaced a real bug in
    `plan-build-review` itself (M-076): a `build` Step hallucinated success
    without writing anything, `review` correctly caught it in its own
    summary, but the overall run still reported top-level `SUCCESS` since
    nothing propagates `review`'s `approved` field to the run's own status.
    Filed as **M-080** (backlog, not started — needs your design call on the
    right fix, not something I should decide unilaterally). This is real and
    worth your attention even though it's not urgent.
  - Full detail for all of the above is in each card's own decision log
    (M-077, M-068, M-072, M-080, all in `done/` except M-080 in `backlog/`).
- 2026-08-05T19:20Z — **A second, later work block, this time live with you
  ("The limits are reset, proceed... Set the model back to qwen...").** Summary:
  - **Box outage, mid-session.** SSH/HTTP both stopped responding (TCP connected
    instantly, application layer never answered — classic resource-starvation
    signature, not a crash). Reported it plainly and asked how you wanted to
    proceed rather than guessing; you confirmed it was back and mentioned another
    agent had been swapping models via a worktree, board might have drifted —
    it hadn't (clean fast-forward pull once reachable again).
  - **M-086.1 done** (renamed from M-086 due to a real ID collision with an
    unrelated, pre-existing card — renumbered per `AGENTS.md` §6a rather than
    overwriting). Per-Workflow `/skill:plan-build-review <task>` etc. commands,
    pi's real native mechanism, confirmed via reading the installed SDK's own
    docs rather than guessing. Live-verified via a real slash-command trigger.
  - **M-087 done** — error messages now show the agent's actual raw response (or
    explicitly say "returned no response text at all" for a genuinely empty one)
    and the actual violating filename(s), instead of generic unhelpful text. Found
    and fixed a real bug in my OWN fix immediately after deploying it (empty
    string being treated as falsy, silently reverting to the old message in
    exactly the case easiest to explain) — full account in that card.
  - **M-088 done** — visualizer project filter. Same pattern: shipped, then
    immediately found a real bug live (every Workflow Run's `projectCwd` is a
    unique per-run worktree path, not shared across a project's runs, so the
    filter only ever matched one run) and fixed it properly with a real
    regression test. Full account in that card.
  - **Infra, mid-testing:** found ornith's container had a real port-binding bug
    (compose declared a port mapping that silently wasn't active — fixed via
    force-recreate) and was OOM-killed twice during concurrent test runs (laguna +
    ornith co-resident leaves ~2GB headroom on a 124GB box — essentially none).
    Also found, via a direct litellm completion test, that **ornith is a genuine
    reasoning/thinking model** — a completion can exhaust its token budget
    entirely inside invisible "thinking" before any real content emits, which is
    very likely the real cause of most of today's empty-response failures (not
    "misbehavior" so much as a token-budget mismatch with a newly-swapped
    reasoning model — qwen, the previous backend, had special handling for
    exactly this elsewhere in the stack that pi-web-factory's own Roles don't
    have). Per your instruction, switched `medium-moe` back to qwen for stability
    and spawned a worktree-isolated sub-agent to find/deploy a smaller Ornith
    quant for more headroom — **M-089** confirmed a real Q4_K_M quant exists
    (MTP tensors verified via raw GGUF header parsing, not trusted from
    filenames), deployed its service definition, download genuinely in progress
    (~20.6GB, confirmed growing). Left in `now/` since the download itself takes
    a while — smoke-testing it is real follow-up work for later.
  - **New test round + screenshots + dashboard**: captured real in-progress/
    failed/passing screenshots from both pi-web's own UI and the visualizer
    (list + detail views, including the fixed project filter grouping a
    project's runs correctly). Regenerated the HTML dashboard leading with the
    `/skill:` triggering flow (your explicit ask — you said you'll basically
    never drive `cli.ts` directly).
  - **One thing worth your attention, not urgent:** during live testing, the
    `plan` Role (writes: `specs/` only) directly wrote the actual deliverable
    file instead of just a plan document, twice, tripping a real
    `PERMISSIONS-VIOLATION` (correctly caught and rolled back) — same class of
    thing as M-080. Not filed as its own card yet; flagging the pattern here in
    case it recurs enough to be worth a design look at `plan`'s own system
    prompt.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-04T21:28Z — filed, session continuing autonomously -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-04 (claude): filed per Chris's explicit instruction, placed directly in
  `now/` (his own instruction, not the usual human-request-promotes-to-now/ default —
  same effect either way here).

## Handoff notes
Read the Log section above first. This card should stay open (not moved to `done/`)
until Chris has actually reviewed it — closing it is his call, not something to do
automatically when the session's work is finished.
