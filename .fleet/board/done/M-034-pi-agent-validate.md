---
id: M-034
title: pi-agent experiment — end-to-end validation + honest comparison notes
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-30T22:27:00Z
blocks: null
blocked_by: M-033
status: null
related_cards: [M-030, M-031, M-032, M-033]
---

# M-034 — pi-agent experiment — end-to-end validation + honest comparison notes

## Context
The point of tonight's work is to give the user a real, working thing to
evaluate in the morning, not a claim that it works. This card is verification
discipline (see this session's own precedent: the Turnstone `-n 8192` fix
that turned out incomplete, the "merged" claims that turned out to still be
open PRs, the Grafana/Prometheus fixes that each needed a live curl/API check)
— every claim below must be backed by something actually observed, not
inferred from the code.

## Plan
1. [x] Real workload test: drive an actual piece of work through the deployed
   pi-agent session (not a toy "say hello" prompt) — ideally something
   comparable to what broke Turnstone (a multi-step task with several tool
   calls in a row) so there's a real basis for comparing loop/repeat
   behavior between the two harnesses on the same underlying model.
2. [x] Reconnect test: start a task, actually close the browser tab (or curl
   connection) mid-task, wait, reconnect, confirm the session's work
   continued/completed server-side and the transcript is intact — this is
   the single most important claim in the whole experiment, verify it
   directly.
3. [x] Restart test: restart the supervisor container/process entirely mid-
   or post-session, confirm sessions are still listed and their history is
   intact (per M-031's manifest + `--session-dir` design).
4. [x] Write a short, honest comparison note (in this card's decision log or
   handoff notes) covering: what works, what's rough, resource footprint
   observed vs. Turnstone's stack, and specifically whether the semantic-
   loop problem diagnosed earlier this session (Turnstone's byte-literal-only
   repeat detector, advisory-only judge) shows up here too, is structurally
   avoided, or is simply untested by the workload chosen.
5. [x] Leave the whole stack running and reachable for the user to poke at
   directly — don't tear anything down at the end.

## Signals
<!-- signal: claude 2026-07-30T22:27Z — claiming, stack fully deployed + LAN-reachable per M-033, running final validation pass -->
<!-- signal: claude 2026-07-30T22:35Z — M-034 done, all four validation claims confirmed with real observed evidence, stack left running -->

## Decision log
- **Real multi-step workload test** (session `m034-workload`): asked the
  agent, in one prompt, to (1) write `fib.py` with an iterative Fibonacci
  function, (2) run it to print `fib(10)`, (3) write `fib_test.py` with
  assert statements, (4) run the test file, (5) `ls` the directory, and
  report the final value - a real multi-tool-call chain, not a "say
  hello" toy. Observed live via a WS client subscribed to the session's
  own event stream (not inferred from a final summary): the agent hit a
  real environment gap (`python3: command not found` in the slim
  container image, exit code 127), self-diagnosed by trying `python`,
  then `which`/`ls` to locate an interpreter, then ran
  `apt-get install -y python3` unprompted, and continued the original
  5-step plan correctly afterward. Confirmed directly on disk (not just
  trusted the model's own claim) that `fib.py` and `fib_test.py` exist
  with correct content, and the transcript shows `fib(10) = 55` computed
  by python3 and reported correctly in the final summary. `agent_settled`
  fired exactly once for the whole exchange - no repeat/loop behavior
  observed on this workload.
- **Reconnect-mid-task test** (session `m034-reconnect-midtask`, the
  single most important claim in the whole experiment): sent a prompt
  requiring 5 sequential bash steps each with a real `sleep 3` (so the
  task provably takes >12s wall-clock, long enough to disconnect mid-way
  through with certainty rather than accidentally after completion).
  Connected a WS client, watched it stream through step 1 and partway
  into step 2's tool execution (confirmed via the actual event log: last
  event received before disconnecting was `tool_execution_update` at
  seq 145, mid-execution of step 2 of 5), then explicitly closed that
  WS connection - with zero clients attached, steps 2-5 had not
  finished yet. Waited (polling session status, not a blind sleep) until
  the session's own status flipped back to `idle` with nobody watching.
  Reconnected and pulled `GET /events?since=145`: 246 further events
  including `tool_execution_end` for steps 2/3/4/5 in order
  (`step2-done`, `step3-done`, `step4-done`, `ALL STEPS COMPLETE`), a
  final assistant summary confirming all five steps, and a terminal
  `agent_settled` - all generated entirely without any client connected,
  then replayed correctly on reconnect. This is genuine proof of the
  core claim, not an inference from architecture: the task provably
  continued and completed server-side while disconnected.
- **Restart test**: with 7 sessions total on the manifest (including the
  two real-workload sessions above, both already `idle` with real
  history), ran `docker restart pi-agent-supervisor` for real (not a
  graceful stop/start via compose - an actual container restart).
  `GET /api/sessions` afterward still listed all 7, correctly marked
  `stopped`. Resumed `m034-workload` via `POST /resume`, confirmed its
  `fib.py`/`fib_test.py` files were still present on the `pi-agent-data`
  volume, and - without re-running anything - asked the freshly-spawned
  process "what was fib(10) and what files did we create?"; it correctly
  answered "55" and named both files from the pre-restart conversation,
  proving both the file-persistence claim (volume-backed) and the
  conversational-history claim (manifest + `--session-dir` +
  `--session <file>`) survive a real restart together, not just one or
  the other.
- **Honest comparison note vs. Turnstone**, per this card's explicit ask:
  - *Resource footprint (observed, not estimated)*: `docker stats
    --no-stream` shows `pi-agent-supervisor` at ~96MB RAM / ~0% CPU idle,
    a single container. Turnstone's equivalent footprint is 4 containers
    (`turnstone-server` ~173MB, `turnstone-db` ~52MB, `turnstone-console`
    ~94MB, `searxng` ~119MB) totaling ~438MB and requiring Postgres +
    SearxNG as hard dependencies even for basic chat functionality.
    pi-agent needs neither - the whole persistence layer is a single
    JSON manifest file plus each session's own JSONL transcript, both on
    a bind-mounted volume. This is a real, substantial "lighter
    alternative" result, not just a design intention.
  - *What works*: real streaming chat against the local `coder` model
    through litellm exactly as Turnstone uses it; multi-tool-call
    workloads (file write, bash, self-correction on a missing
    dependency) execute correctly; sessions are genuinely independent
    (concurrent-session test in M-031); the browser frontend renders the
    full event stream live and replays correctly after a real
    disconnect/reconnect and after a real container restart, both
    verified with actual disconnected/reconnected clients, not just API
    inspection.
  - *What's rough*: no autonomous "keep working with no new input" loop
    (explicitly out of scope, same boundary as Turnstone's own
    workstreams, not a gap specific to this build). No auth (explicit,
    matching scope for tonight). The frontend is minimal - no message
    editing, no session deletion UI (only stop), no model picker beyond
    `coder` (v1 scope, matches the card). The supervisor's `resumeSession`
    doesn't yet auto-fire on `GET /api/sessions/:id` load from a totally
    cold session list in the same way the frontend's `openSession()`
    proactively resumes on open - it's a small, deliberate frontend-side
    convenience today, not a supervisor-level guarantee; a raw API
    consumer has to call `/resume` explicitly. No image build layer
    caching optimization was attempted (image is 595MB largely from
    `node:22-slim` base + a global `pi` install + npm deps) -
    unoptimized but irrelevant to a home box with 124GB RAM.
  - *The semantic-loop question, stated honestly*: the workload chosen
    (fib.py + test, and the 5-step sleep chain) did NOT stress the model
    into the kind of repeat/loop pathology that broke Turnstone earlier
    this session - the self-correction on the missing `python3` binary
    is the closest thing to a "recovery from an unexpected result" moment
    in this test, and it resolved cleanly in 2 extra tool calls, not a
    loop. This means the semantic-loop problem is **simply untested by
    the workload chosen here**, not confirmed absent - it would be
    dishonest to claim pi structurally avoids it. What IS structurally
    different and worth naming plainly: pi's RPC protocol has no
    judge/loop-detection layer of its own at all (no advisory judge,
    no repeat detector, byte-literal or otherwise) - it is a thinner
    harness with less machinery, for better (nothing to be "advisory
    only" and silently ignored, per the earlier Turnstone diagnosis) and
    for worse (nothing catches a genuine loop either, if one occurred).
    A fair follow-up test (not done here, explicitly flagged as a gap)
    would be deliberately reproducing the same task shape that caused
    Turnstone's loop incident against pi, to see whether the same
    underlying model behavior recurs on a different harness - this
    card's workload wasn't chosen to reproduce that specific failure
    mode, and claiming it does or doesn't reproduce here would be
    inference, not observation.

## Handoff notes
Full stack live and left running on local-ai-machine, reachable at
`http://192.168.1.21:3002/` (or `.221`) from any device on the LAN,
including a phone - verified directly, not assumed, at every stage
(M-030 through M-034). Test sessions from this card's own validation
(`m034-workload`, `m034-reconnect-midtask`) were stopped via the API but
left in the session list along with the other cards' test sessions
(`smoke-test-1/2`, `concurrent-A/B`, `session 73b165b5`) - 7 total,
harmless, easy to identify by label and delete/ignore. `fib.py` /
`fib_test.py` are still on disk in `m034-workload`'s session directory if
useful to look at directly.

**For the human to actually evaluate in the morning**: open
`http://192.168.1.21:3002/` (works from a phone on the same WiFi), click
"+ New session", give it a real task, close the tab, come back later -
that's the whole experience this experiment set out to build. The
`pi-agent/` directory in this repo is the complete, reproducible source
for everything (supervisor service, frontend, Dockerfile,
docker-compose.yml service block, configuration.nix firewall rule) - a
fresh clone + `git pull` + `nixos-rebuild switch` +
`docker compose up -d --build pi-agent-supervisor` reproduces this
exact deployment from scratch, no manual box state involved (the one
thing that IS manual/ephemeral: the `LITELLM_MASTER_KEY` env var comes
from `docker/.env` on the box, same as every other service in this
stack - not part of this experiment's own scope to change).
