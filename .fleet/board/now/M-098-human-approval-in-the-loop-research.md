---
id: M-098
title: research + design human-approval-in-the-loop (git/PR handoff)
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: []
---

# M-098 — research + design human-approval-in-the-loop (git/PR handoff)

## Context
Chris's direct request, 2026-08-06 (verbatim): "One more ticket around where
human approval fits into the loop. The original SSSF had no opinions about
git PRs, it just did work. But we're working on a whole end to end including
durable ticket storage, we're ok to be more opinionated about what that looks
like and how it hands off. This ticket should be a research into what makes
sense and interactive refinement session with me to be sure it makes sense."

**This is explicitly NOT a delegated/autonomous implementation task.** Chris
was specific: research first, then an interactive design conversation with
him directly, before anything gets built or even firmly proposed. Do not
treat this like other cards where a sub-agent researches, decides, and files
a finished plan for review after the fact — the refinement step itself has to
happen live with Chris, not async.

Relevant existing surface area to ground the research in (read, don't
redesign yet):
- `PERMISSIONS-VIOLATION` / rollback handling (workflow.ts) — pi-web-factory
  already has automated gates that stop/roll back bad work; approval design
  should account for how it composes with these, not just bolt on top.
- `BLOCKED-ON-HUMAN` status + resumable `--session-id` (see M-076/skills docs)
  — the one human-in-the-loop mechanism that already exists today, mid-Step,
  for agent-asked questions. Worth understanding fully since a new
  approval-handoff design will likely want to reuse or sit alongside it
  rather than invent a second, parallel "ask the human" pathway.
- `.fleet` board's own human-gate pattern (AGENTS.md §4a: "nothing enters
  now/ without explicit human confirmation") — a DIFFERENT, already-proven
  approval pattern in the adjacent fleet-coordination layer. Worth knowing
  as a reference point (not necessarily the right shape for this), especially
  since Chris's own stated plan is to eventually graft fleet's kanban
  mechanics into this stack directly (see decision log,
  [[project_fleet_vs_pi_web_factory_boundary]]).
- Durable ticket storage — whatever's landed to date for tracking Workflow
  Runs/sessions durably; approval/handoff design should plug into that
  storage, not a side channel.

## Plan
1. [x] Research phase (can proceed without Chris): survey how comparable
   systems handle human-approval gates for agent-driven code changes —
   PR-per-run vs. PR-per-approved-batch vs. no-PR-direct-commit-with-review-
   window, where in the Workflow a gate would sit (after every Step? only at
   the end? only on `review`/`test` failure?), and how that composes with
   the two existing human-touch points above (`BLOCKED-ON-HUMAN`,
   `PERMISSIONS-VIOLATION` rollback). Write up options with real tradeoffs,
   not a single pre-decided answer.

   **Research writeup (2026-08-06) — options with tradeoffs, NOT a decision.**
   Everything below is material for the interactive session (Plan step 2),
   not a proposal. Grounded in reading `modules/workflow.ts`,
   `modules/permissions.ts`, `modules/run.ts`, `modules/piwebClient.ts`,
   `modules/envelopes.ts`, `modules/worktree.ts`, `cli.ts`, both shipped
   `workflows/*.yaml`, and `pi-web-adw-design.md`, in this checkout's
   `jmfederico-pi-web/pi-web-factory/`.

   ### A. How the two existing human-touch mechanisms actually work today

   **1. `BLOCKED-ON-HUMAN` / resumable `--session-id`** — the only
   human-in-the-loop mechanism that exists today.
   - *Trigger*: entirely agent-initiated, not policy-initiated. Inside a
     running pi-web session, the agent itself asks a structured question
     (pi-web's own ask-user-question mechanism). `piwebClient.ts`'s
     `waitForCompletion` observes this via `GET /status`'s `pendingAsk`
     field (`piwebClient.ts:362-365`) or the `/events` WebSocket's
     equivalent `status.update`. `pendingAsk !== undefined` is a THIRD
     turn-completion state, distinct from success/error
     (`piwebClient.ts:348-351`).
   - *Propagation*: `run.ts`'s `runAgentPhase` sees `result.status ===
     "blocked-on-human"`, traces a `handoff` event carrying the
     `pendingAsk` payload (`run.ts:213-224`), and returns
     `{status:"blocked-on-human", pendingAsk, attempts}` — no retry, no
     rollback, the phase simply stops there. `workflow.ts`'s `toRunOutcome`
     passes this straight through as the Workflow Run's own terminal status
     (`workflow.ts:246-247`). `cli.ts`'s `describeResult` prints it with
     exit code 2 and an explicit instruction: `"the agent asked a question
     and is waiting; resume with --session-id <id> once answered in
     pi-web's UI"` (`cli.ts:197-201`).
   - *State left behind*: the pi-web session itself is left mid-turn,
     waiting. The run's worktree/branch (see §C below) is left exactly as
     the agent last wrote it — nothing is rolled back, nothing is
     committed. `factory.db` (the trace DB) has a full record up to and
     including the `handoff` event, but the Workflow Run itself is not
     "done" in any durable sense — it's just an unfinished CLI process that
     already exited.
   - *How a human actually intervenes*: NOT through pi-web-factory at all.
     The human opens pi-web's own web UI (the deep link `cli.ts` prints,
     `sessionDeepLink`), answers the agent's question there directly in
     the chat/ask-UI, which resumes the underlying pi-web session server-
     side.
   - *How resumption works*: once answered, the human (or an automated
     wrapper) re-invokes `bun cli.ts --project <path> --workflow <name>
     --session-id <the-existing-session-id> "<some prompt>"`. Passing
     `--session-id` skips worktree creation (`workflow.ts:533`, "skipped on
     resume") and reuses the existing session id `runWorkflow` was given
     rather than minting one, then continues walking the SAME Step the
     agent was on with a fresh prompt. There is no automatic "wake up when
     answered" — resumption is a distinct, manually-triggered CLI
     invocation. Nothing polls or watches for the answer.
   - *Scope*: this is a mid-Step, agent-asked clarifying-question
     mechanism, not an approval gate. It fires when the AGENT decides it
     needs information, never when a human (or policy) decides it wants to
     review output before the Workflow proceeds. There is no code path
     today where the Workflow interpreter itself pauses and waits for a
     human verdict on completed work.

   **2. `PERMISSIONS-VIOLATION` / automated rollback** — an enforcement
   gate, not a human-in-the-loop mechanism (no human is ever consulted
   live), but the card explicitly asked it be understood since any new
   approval design has to compose with it.
   - *Trigger*: `permissions.ts`'s `snapshotRepoState` fingerprints the
     target repo's working tree (tracked-file diff stats +
     untracked-file list) immediately before an agent prompt is sent
     (`run.ts:190`, "BEFORE prompting"), and `enforceWrites` diffs a second
     snapshot taken right after the agent's turn completes and its
     envelope parses (`run.ts:351`). Every changed path is checked against
     the agent Role's `writes` allowlist and `factory.config.yaml`'s
     `protectedFiles` denylist (`permissions.ts`'s `isWritePermitted`,
     precedence: named-allowlist wins over protected, then protected wins
     over default, then `null` allowlist = unrestricted).
   - *What happens on a violation*: anything outside the allowlist is
     rolled back immediately, same call, before the phase result is even
     returned — `enforceWrites` doesn't just detect, it calls
     `rollBackOne` per violating path (`git checkout --` for a tracked
     file, `unlink` for an untracked one), and reports what happened
     per-path (`rolled-back`/`deleted`/`left-as-is` for pre-existing dirt/
     `reverted-by-agent` for a lost uncommitted change/`rollback-failed`).
     `run.ts:378` then treats `permissions.violations.length > 0` as an
     unconditional phase-killer ("a violation means the phase dies, full
     stop" — comment names upstream SSSF's hard rule #9 explicitly): even
     if every rollback succeeded, the phase still returns
     `permissions-violation`, not success.
   - *State left behind*: repo is back to (approximately) the pre-agent
     state for the offending paths only — anything WITHIN the allowlist
     that the same turn wrote is left in place (only violations are
     rolled back, not the whole turn). `cli.ts` exits 4, prints the
     violating paths.
   - *How a human intervenes*: there is no live intervention — by the time
     a human sees this, the rollback (or rollback failure) has already
     happened. The human's only actions are diagnostic/after-the-fact:
     read the violations list, decide whether to adjust the Role's
     `writes:`/`protectedFiles` config, or re-run. This is a hard
     automated stop, structurally the opposite shape from
     `BLOCKED-ON-HUMAN` (which pauses and waits) — it fails closed and
     exits.

   ### B. How comparable systems handle "when does a human get to
   approve/reject" — common shapes, not exhaustive

   - **PR-per-run**: every agent run opens its own PR the moment it
     finishes (or even mid-run). Cheapest to build, matches ordinary
     human-authored-commit workflows, gives full CI/review tooling for
     free. Cost: PR volume scales 1:1 with run volume — noisy if runs are
     frequent, small, or iterative (e.g. every retry-round of a
     build/review loop).
   - **PR-per-approved-batch**: runs land in an intermediate branch/queue;
     a human (or a separate merge step) periodically promotes a batch of
     already-vetted changes into one PR, or fast-forwards a batch straight
     to the target branch. Lower PR noise, but needs an explicit
     "promote/batch" step that doesn't exist as a concept anywhere in this
     codebase today.
   - **Direct-commit-with-a-review-window**: the agent commits straight to
     a real branch (sometimes even the target branch), and the "approval"
     is a bounded time window (or an explicit revert action) after the
     fact rather than a gate before landing — optimizes for throughput
     over gatekeeping; relies on strong automated tests/rollback rather
     than human review to catch problems. Some CI/CD tools' "auto-deploy
     with rollback on failed health check" pattern is this shape applied
     to deploys rather than commits.
     
   - **Mandatory-approval-before-any-write**: nothing lands anywhere
     (not even a branch) until a human clicks approve — the strictest
     shape. Classic CI/CD manual-approval-gate pattern (e.g. a pipeline
     stage that blocks until a designated approver acts in the CI tool's
     own UI) and GitOps tools that require a human-merged PR into a config
     repo before any cluster state changes. Slowest, but the only shape
     where nothing an agent produces is ever live without a human having
     looked at it first.
   - **Known AI coding agent products, roughly mapped onto the above**
     (general knowledge, not verified against current docs — flag as
     such): Devin and Copilot workspace-style agents generally default to
     PR-per-run (open a PR, let existing repo review/CI gates do the
     rest) — they lean on the target repo's OWN PR review process rather
     than inventing a separate approval UI. Cursor's background-agent
     style tools similarly tend to land on a branch + PR by default. Aider
     (interactive, human-driven CLI) is close to
     direct-commit-with-a-review-window by default — it commits locally
     per change and leans on the human running it interactively watching
     each diff, with `git revert`/reset as the recovery path, not a formal
     gate. None of these map perfectly onto pi-web-factory's shape
     (multi-Step Workflow Runs with an interpreter in the loop) — they're
     useful as reference points for "PR is the default vocabulary," not as
     precedents to copy directly.

   ### C. What's actually TRUE about pi-web-factory's git behavior today
   — this is the load-bearing finding

   **pi-web-factory does not commit, push, or open a PR anywhere in this
   codebase today.** Concretely, confirmed by reading every module that
   touches git:
   - `worktree.ts`'s `createRunWorktree` runs `git worktree add <path> -b
     pi-web-factory/<adwId>` off the target project's current `HEAD`
     (`worktree.ts:161-181`) — this creates a REAL local branch and a real
     linked working directory, nested inside the project's own checkout at
     `.pi-web-factory-worktrees/<adwId>/` (kept out of `git status` via
     `.git/info/exclude`, never committed). This is genuine git state, not
     an ephemeral scratch dir — but it is 100% local, on whatever machine
     ran the CLI.
   - Agents write files directly into that worktree via their own tool use
     (`run.ts`'s `snapshotRepoState`/`enforceWrites` diff exactly this
     working tree's uncommitted changes) — but nothing in `run.ts`,
     `workflow.ts`, `permissions.ts`, `cli.ts`, or either shipped
     `workflows/*.yaml` ever runs `git add`, `git commit`, or `git push`.
     A grep across the whole module tree for those verbs turns up ONLY
     test-fixture setup code (`*.test.ts` files priming a scratch repo
     with an initial commit so there's a HEAD to diff against) — zero
     hits in any non-test source file.
   - `envelopes.ts` ports a `commit_message` field onto `PlanOutput`,
     `BuildOutput`, and `DocumentOutput`, verbatim from upstream SSSF's
     Pydantic models, and even upstream's own comment on `BuildOutput`
     says `# consumed by the git commit phase` (`envelopes.ts:75`). That
     "git commit phase" was never ported — this codebase's agents are
     prompted to PRODUCE a `commit_message` string in their JSON envelope
     (see both `workflows/*.yaml`'s literal prompt text), and it is parsed
     into the envelope and stored in the trace DB, but nothing downstream
     ever reads that field to actually run `git commit`. It is
     structurally cosmetic today — present because the schema was ported
     field-for-field, not because a consuming commit step exists.
   - Net effect: a Workflow Run's real output, at completion (success,
     gate-failed, or any other terminal status) is: uncommitted working-tree
     changes sitting in a local `.pi-web-factory-worktrees/<adwId>/`
     directory, on a local branch `pi-web-factory/<adwId>` that has never
     been committed to (still pointing at the same commit as the target
     project's `HEAD` at worktree-creation time), never pushed anywhere.
     `removeRunWorktree` exists (`worktree.ts:211`) but is "NOT called
     anywhere in this codebase's own chain wiring" per its own doc comment
     — worktrees are deliberately left behind for post-hoc inspection.
   - **Why this matters for the approval-design conversation**: "PR" is
     not yet a load-bearing concept anywhere in pi-web-factory — there is
     no commit to attach a PR to. Any approval-gate design that assumes a
     PR-per-run shape first requires deciding WHERE a real `git commit`
     (and, separately, a `git push` to a remote humans/CI can see) would
     be introduced — that's new surface area, not a rewire of something
     that already exists. Today the only durable, inspectable artifact of
     a run is the trace DB (`factory.db`, `Tracer`) plus whatever's
     sitting uncommitted in the local worktree — a human reviewing a run
     today would have to go look at that worktree's diff directly (or the
     visualizer, which reads `factory.db`), there is no git-native review
     surface (PR, diff view backed by a real commit, etc.) at all.

   ### D. Real candidate gate points in a Workflow Run's lifecycle, and
   what state genuinely exists at each

   Given (C) — no commits happen today — every candidate below implicitly
   also has to answer "does landing at this gate point require inventing a
   commit step first?" That question is listed per-candidate, not
   answered.

   1. **After `plan`, before `build`** — gate on the PLAN before any code
      is written. State available: the `plan` step's envelope (summary,
      artifacts, notes, `commit_message` — no actual commit). Working tree
      is still untouched by this Workflow Run (plan agents are typically
      given `writes: []` or a narrow allowlist). Needs a commit step? No —
      there's nothing to commit yet, a plan-gate is purely
      envelope/text review, closest in shape to reviewing a design doc
      before code exists.
   2. **After `build` (or a build/review loop), before anything is
      considered "done"** — gate on the actual code change. State
      available: real uncommitted file changes in the worktree, a
      `changed_files` list and `commit_message` string in the `build`
      envelope (again, message only — nothing has committed it), and, if
      the Workflow includes a `review`/`test`/gate `code` Step
      (`bounded-build-review.yaml`'s loop, or a hypothetical `test` code
      Step), that gate's own pass/fail result. This is the point closest
      to "there's a real diff a human could look at" — but today that diff
      only exists as uncommitted worktree state, not a commit or PR. Needs
      a commit step first if the design wants the human looking at a real
      git commit/PR rather than a raw working-tree diff.
   3. **After `review`/`test` passes, before merge to the target repo's
      real branch** — this is the point that would most naturally map to
      "PR" vocabulary (gate right before the change would land somewhere
      real). Doesn't exist today in any form — there is no merge step
      anywhere in this codebase; a Workflow Run's terminal `success` status
      just means every Step passed, the worktree/branch are left exactly
      as they are, nothing merges anywhere. Building this gate requires
      building the merge/push mechanism it would gate, not just adding an
      approval check to an existing step.
   4. **Only at whole-Workflow completion** — gate once, on the Run's
      final terminal status, regardless of which Step produced it. State
      available: everything — full `stepResults` map (`workflow.ts`'s
      `ctx.stepResults`), every step's envelope, the full trace-db history
      for the `adwId`. Simplest to reason about (one gate, not N), but the
      coarsest-grained — a human only sees the review request after
      EVERYTHING already ran, including any build/review loop rounds that
      already happened autonomously. This composes most easily with
      `BLOCKED-ON-HUMAN`'s existing shape (see §E) since it's the same
      "Workflow Run returns a terminal status, human resumes via
      `--session-id`" pattern already wired end to end.
   5. **On `gate-failed`/`permissions-violation` specifically** — i.e. only
      surface a human when an automated gate already caught a problem,
      treat clean runs as auto-approved. Cheapest in human attention cost;
      inverts the usual "approve good work" framing to "get pulled in only
      when something's already flagged as bad" — worth naming as a
      distinct option since it's structurally different from 1-4 (those
      gate on WHERE in the lifecycle; this one gates on WHAT outcome
      happened, orthogonal to step position).

   ### E. How each composes with the two existing mechanisms (§A)

   - **Replaces `BLOCKED-ON-HUMAN`?** No candidate above should replace
     it — that mechanism is scoped to agent-initiated clarifying
     questions mid-Step, a genuinely different trigger (the AGENT decides
     it's stuck) than an approval gate (the WORKFLOW or a POLICY decides a
     human should look before proceeding). Collapsing them into one
     pathway would conflate "I have a question" with "please review my
     work," which are different asks needing different UI/response shapes
     (answer a question vs. approve/reject/request-changes a diff).
   - **Sits alongside it, reusing its shape?** Plausible and arguably the
     path of least new machinery: `BLOCKED-ON-HUMAN` already proves out
     "Workflow Run returns a terminal status naming what's needed +
     `--session-id` resume" end to end (trigger detection, tracing, CLI
     exit-code/message, resume-by-reinvocation). A new terminal status
     (e.g. `AWAITING-APPROVAL`) that reuses the exact same
     detect-terminal-status / print-resume-instructions /
     resume-via-`--session-id` machinery, but is triggered by the
     Workflow interpreter itself (after a named Step, per §D) rather than
     by the agent's own `pendingAsk`, would need: (a) a way to mark WHICH
     step(s) require this in a Workflow YAML, (b) something to show the
     human what to approve (today: the envelope/worktree diff; there's no
     purpose-built UI for this, pi-web's own ask-UI is built for
     questions, not diff review), (c) a resume path that's
     approve/reject/request-changes shaped rather than "send another
     prompt" shaped — `--session-id` resume today just re-prompts the
     session with new text, which is a strictly WEAKER interface than a
     real approve/reject action.
   - **Subsumes it?** Only in the narrow sense that a whole-workflow-
     completion gate (§D.4) and `BLOCKED-ON-HUMAN` would both eventually
     route through pi-web's UI and a `--session-id` resume — but they'd
     remain two distinct terminal statuses/trigger conditions under that
     shared plumbing, not one merged concept.
   - **`PERMISSIONS-VIOLATION` composition**: orthogonal in all designs
     above — it's a pre-envelope, automated, fail-closed enforcement gate
     that runs regardless of whether an approval gate exists later in the
     Workflow. An approval gate sitting AFTER a Step doesn't need to know
     about it; a violation already killed the phase before the Step's
     envelope was even recorded, so there's nothing later in the pipeline
     for an approval gate to see. The one place they'd interact: if a
     Workflow ever wanted "auto-approve unless a violation occurred"
     (§D.5's shape), the approval gate's condition would read the same
     terminal-status discriminated union `workflow.ts` already returns
     (`permissions-violation` is already one branch of it) — no new
     signal needed, it already exists.

   ### F. Open questions for the interactive session (not answered here)

   - Does "approval" mean blocking landing (nothing merges without a yes),
     or blocking only NOTIFICATION-worthy landing (auto-land, but tell a
     human and let them revert)? These are the
     mandatory-approval-before-any-write vs.
     direct-commit-with-a-review-window shapes from §B, and the codebase
     today supports neither — both require deciding whether/where a real
     commit+push+merge mechanism gets built at all.
   - Is "PR" even the right vocabulary Chris wants, given §C — or does he
     want something native to pi-web-factory's own trace-DB/durable-
     ticket-storage layer (closer to the `.fleet` board's own human-gate
     pattern named in this card's Context, i.e. approval as a card/ticket
     state transition rather than a git PR)?
   - Per-Step granularity (a Workflow YAML author marks specific steps as
     approval-gated) vs. a single Workflow-level policy (every Workflow of
     a given kind always gates at the same point)?
   - Should `commit_message` (already produced by every `plan`/`build`/
     `document` envelope today, just unconsumed) get wired to a real `git
     commit` regardless of the approval-gate design, since without it
     there's no commit for any PR-shaped answer to attach to?

2. [ ] **Stop and hold an interactive session with Chris** before finalizing
   any design — walk through the research findings live, let him react and
   redirect, and only then converge on a shape.
3. [ ] Only after that session: write the actual design doc / follow-on
   implementation card(s).

## Signals

## Decision log
- 2026-08-06 (claude): filed directly from Chris's verbatim request.
  Deliberately left `claimed_by: null` — per his own framing this needs an
  interactive session with him, not an autonomous claim-and-run.
- 2026-08-06 (claude): research phase (Plan step 1) done, written into the
  Plan section above. Read-only research task — no code touched, no
  implementation, no design picked. Headline finding: pi-web-factory does
  not commit/push/PR anywhere today (worktree.ts creates a real local
  branch+worktree, but nothing ever runs `git add`/`commit`/`push`;
  envelopes.ts's `commit_message` field is ported from upstream but
  unconsumed). That fact reframes the whole question — any PR-shaped
  design needs a commit mechanism built first, not just an approval check
  bolted onto something that already exists. `claimed_by`/`status` left
  untouched per this card's own instruction; still awaiting Plan step 2,
  the interactive session with Chris.

## Handoff notes
Do research (step 1) freely, but do not skip straight to a finished design —
Chris needs to be in the room for the refinement step before this converges.
