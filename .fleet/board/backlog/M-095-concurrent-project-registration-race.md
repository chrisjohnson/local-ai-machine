---
id: M-095
title: pi-web-factory project registration races when two cli.ts runs against different new projects launch simultaneously
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-094]
---

# M-095 — pi-web-factory project registration races under concurrent launch

## Context
Found 2026-08-06 while testing M-094 (litellm cross-model request queue) —
unrelated to that card, filed separately per its own decision log.

Two real Workflow Runs, each targeting a DIFFERENT brand-new scratch project
(`/tmp/pi-web-factory-m094-retry-a`, `/tmp/pi-web-factory-m094-retry-b`),
launched via `cli.ts` within ~2ms of each other (two `docker compose exec -d`
invocations backgrounded and `wait`ed together in the same shell).

Run A failed almost immediately:
```
PiWebClientError: pi-web request failed (404): Project not found
    at requestJson (/home/piweb/pi-web-factory/modules/piwebProject.ts:67:15)
    at async resolveWorkspaceId (/home/piweb/pi-web-factory/modules/piwebProject.ts:134:28)
    at async runWorkflow (/home/piweb/pi-web-factory/modules/workflow.ts:538:29)
```
Run B (launched at the same moment, different project) succeeded in
registering its project and proceeded normally (failed later, separately,
for an unrelated reason — a real "unparseable" model response, see M-094's
own decision log for that part).

This looks like a genuine race in `piwebProject.ts`'s project-registration
flow when TWO calls are racing to register/resolve DIFFERENT new projects at
the same moment — not simply "the same project registered twice" (a more
obvious, probably-already-handled case), but something about concurrent
registration of unrelated projects tripping a lookup that expects to run
serially.

## Plan
**Reliably reproduced, root cause confirmed server-side, not in pi-web-factory's own
code.** This is NOT a check-then-act race in `piwebProject.ts`'s `ensureProjectRegistered`
(read `resolveWorkspaceId`/`ensureProjectRegistered`/`listProjects` in full — the
TypeScript logic here is straightforward, sequential, correctly `await`ed, and does
not itself contain a race). The bug is a **lost-write race in pi-web's own server-side
`ProjectStore`/`ProjectService.add`** under concurrent `POST /projects` — this repo has
no access to fix that (pi-web ships as a prebuilt image,
`ghcr.io/jmfederico/pi-web:latest`, not source in this repo) — so this card's own
Plan is a client-side mitigation in `piwebProject.ts`, not a server-side fix.

### Reproduction (2026-08-06, this session — all evidence captured directly, scratch
resources fully cleaned up afterward, see Handoff notes)
1. **Confirmed the ORIGINAL "two different projects" framing is incidental, not
   causal.** Reproduced the identical failure (`PiWebClientError: pi-web request
   failed (404): Project not found` at `piwebProject.ts:134` `resolveWorkspaceId`)
   with THREE concurrent `cli.ts` launches against the exact SAME project path
   (`/tmp/m095-same`) — 2 of 3 succeeded (correctly deduped to the same `projectId`),
   1 of 3 still hit the 404. So "different projects" was never the necessary
   condition — any concurrent registration burst can trigger it, same-path or not.
2. **Isolated the failure to `POST /projects` itself, bypassing pi-web-factory's
   client entirely** — fired 6 concurrent raw `curl -X POST
   http://localhost:3000/api/projects` calls (6 distinct fresh paths) directly
   inside the `jmfederico-pi-web` container. All 6 requests received
   HTTP 2xx-shaped JSON responses with real, distinct `id`s (i.e. the SERVER
   claimed success to every caller) — but `GET /projects` immediately after
   showed **only 2 of the 6 had actually persisted** (`m095-direct-2`,
   `m095-direct-6`; the other 4's ids never appear in any later `GET /projects`
   response, at all, ever). Repeated with a 10-way burst: 4 of 10 survived
   (`m095-burst-2/4/6/10` — not simply "last writer wins," a scattered subset).
3. **Conclusion**: `POST /projects`'s handler acknowledges every request
   individually (each caller gets back what looks like a fully valid, unique,
   persisted Project record) but the underlying store loses all but a handful
   under concurrent writes — textbook non-atomic read-modify-write: each
   concurrent handler likely reads the current project list, appends its own
   new entry in memory, and writes the whole list back; whichever write is
   physically LAST to land wins, silently discarding every other concurrent
   handler's addition even though that handler's own HTTP response already
   claimed success. This is consistent with everything observed: variable
   survival count (event-loop/write-timing dependent, not a fixed N), successful
   responses for ALL callers (the in-memory object is correctly returned to each
   caller before the lossy persist step clobbers it), and same-path bursts
   failing too (the race is in the WRITE mechanism, not in the `GET`+`find`
   dedup logic pi-web-factory's own client does first).
4. This means `piwebProject.ts`'s own `ensureProjectRegistered` (module doc
   comment: "`POST /projects` is ALREADY idempotent server-side by path...This
   module still does its own `GET /projects` + find-by-path lookup FIRST...
   cheaper...in the overwhelmingly common case") has a real, now-confirmed gap
   in its own reasoning: it assumes `POST /projects`'s response can be trusted
   as durable. It cannot, under concurrency. `resolveWorkspaceId`'s immediately-
   following `GET /projects/:projectId/workspaces` call is what actually surfaces
   the loss — by the time that runs, the project the `POST` claimed to create is
   already gone.

### Fix: verify-after-write in `ensureProjectRegistered`, with a short retry
Concrete implementation, `modules/piwebProject.ts`:
1. After the `POST /projects` call in `ensureProjectRegistered` (currently
   `piwebProject.ts:93-98`, returns `created.id` directly and trusts it), add a
   verification step: re-`GET /projects` and confirm an entry with this exact
   `path` (not necessarily the same `id` the POST response claimed — a
   concurrent OTHER process's write may have won and registered the SAME path
   with a DIFFERENT id, which is fine, that's still a correctly-registered
   project for this path) now actually exists.
2. If verification fails (the just-POSTed path is still absent from a fresh
   `GET /projects`), retry the whole `POST` + verify cycle — small bounded
   retry (e.g. 3 attempts, short fixed or linear backoff, e.g. 50/150/400ms —
   no need for anything elaborate, the race window demonstrated above is a
   single event-loop tick wide, not a slow contention pattern) — mirroring the
   bounded-retry discipline `run.ts`'s own parse-failure retry loop already
   established elsewhere in this codebase (check `run.ts` for its exact
   retry/backoff shape before inventing a new one — reuse the pattern/constants
   if a shared helper already exists, otherwise keep this one local and small).
3. Exhausting retries: throw a specific, clearly-worded error (not a generic
   network error) — e.g. `PiWebClientError` or a new dedicated error naming
   what happened: "project registration for <path> appears to have been lost
   under concurrent load after N attempts — this is a known pi-web server-side
   race (see M-095), not a client bug." Concurrent Workflow Runs against pi-web
   are real and expected (M-094's own test triggered this), so silently
   proceeding with an unverified `projectId` must never happen again after this
   fix — better to fail loudly and let the caller retry the whole Workflow Run
   than to hand `resolveWorkspaceId` an id already known to be unreliable.
4. Apply the SAME verify-after-write treatment to `resolveWorkspaceId`'s own
   404 case if triggered by a similar server-side race one layer down (verify:
   does `GET /projects/:id/workspaces` on an id that legitimately exists but
   whose WORKSPACE list write also races similarly? Out of this incident's
   direct evidence — item 2's `curl` test only exercised `POST /projects`, not
   workspace creation — but `createRunWorktree`'s `git worktree add` runs
   between project registration and this call, so a parallel race there is
   plausible and worth a quick separate repro pass (fire concurrent SAME-project
   `cli.ts` runs and check whether workspace lookups are ever similarly lossy)
   before deciding whether item 1-3's retry wrapper needs to also wrap this call
   — if picking this up, spend 15 minutes confirming/ruling this out before
   deciding scope, do not assume symmetry without checking.
5. Tests: `piwebProject.test.ts` (check if it exists; if not, this is a good
   reason to add one) — mock `fetch` to simulate the exact observed failure
   mode (POST returns 2xx with a valid-looking body, but a subsequent GET
   /projects does not include the path) and assert `ensureProjectRegistered`
   retries and either succeeds (path shows up on a later GET) or throws the
   new specific error after exhausting retries — do NOT write a test that
   depends on hitting the real race live (non-deterministic, would be a flaky
   CI test) — mock the exact lossy-write behavior instead.
6. Document the finding in `piwebProject.ts`'s own module header (currently
   asserts flatly "`POST /projects` is ALREADY idempotent server-side by
   path" at lines 22-30 — this is now known to be FALSE under concurrency,
   confirmed live 2026-08-06, correct the claim and reference this card).

### Not recommended: waiting on/patching pi-web itself
pi-web ships as a prebuilt image in this deployment (`ghcr.io/jmfederico/pi-web:
latest`, confirmed via `docker compose ps` on the box — no source checkout
mounted for it, unlike `pi-web-factory` itself) — a genuine server-side fix isn't
actionable from this repo. If pi-web's own upstream source becomes available to
patch (e.g. a vendored fork), the RIGHT server-side fix would be to make
`ProjectStore`'s write path atomic (a single-writer queue, a real DB
transaction, or an actual file lock around read-modify-write) — flag this
verbally to Chris as worth reporting upstream to `jmfederico/pi-web`, but do
not block this card on that; the client-side retry above is a real, complete,
independently-shippable fix for pi-web-factory's own reliability regardless
of whether upstream ever fixes the root cause.

## Signals

## Decision log
- 2026-08-06 (claude): filed from a real, reproduced (once) failure during
  M-094 testing. Not investigated further — M-094 was the priority at the
  time. `status: needs-refinement` since the actual root cause in
  `piwebProject.ts` hasn't been read/diagnosed yet, only the symptom.
- 2026-08-06 (claude): refined per Chris's "refine all 4" request. Read
  `piwebProject.ts` in full (small, no client-side race found there).
  Deliberately reproduced on the live box: 4-way concurrent cli.ts against 4
  distinct fresh projects (2/4 failed with the exact incident stack trace),
  3-way concurrent against the SAME project (1/3 failed — ruling out
  "different projects" as the necessary condition), and isolated the failure
  to raw concurrent `POST /projects` calls against pi-web's API directly,
  bypassing pi-web-factory's client entirely (6-way burst: only 2/6
  persisted despite all 6 getting 2xx responses; 10-way burst: only 4/10
  persisted). Root cause confirmed server-side: a lost-write race in pi-web's
  own ProjectStore under concurrent POST /projects (non-atomic
  read-modify-write, not fixable from this repo — pi-web ships as a prebuilt
  image here, no source mounted). Plan is a client-side verify-after-write
  retry in ensureProjectRegistered. All scratch projects/dirs cleaned up
  after (verified via GET /projects before/after). Cleared
  `status: needs-refinement`.

## Handoff notes
Now reproduced reliably and deliberately, multiple times, with the root
cause isolated to pi-web's server, not pi-web-factory's client. Repro
recipe (works against the live box, `jmfederico-pi-web` container):
```
docker compose exec -T jmfederico-pi-web bash -c '
for i in 1 2 3 4 5 6; do
  mkdir -p /tmp/scratch-$i
  curl -s -X POST http://localhost:3000/api/projects \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/tmp/scratch-$i\"}" -o /tmp/scratch-${i}.json &
done
wait'
# then: curl -s http://localhost:8080/api/projects — compare against the 6
# ids the POSTs returned; typically only 2-4 of 6 actually persisted.
```
All scratch projects created during this investigation
(`m095-repro-{a,b,c,d}`, `m095-same`, `m095-direct-{1..6}`,
`m095-burst-{1..10}`) were deleted via `DELETE /projects/:id` and their
`/tmp/m095-*` directories removed from the container filesystem — verified
clean via a final `GET /projects` (back to the pre-investigation count of
10) before ending this session. No lingering state on the box.
