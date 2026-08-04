<!--
Point-in-time snapshot of agentic-fleet/AGENTS.md (the fleet convention
spec, lives in a separate repo: ~/src/chrisjohnson/agentic-fleet/AGENTS.md
on Chris's Mac), embedded here so pi's native global-context-file
mechanism (`~/.pi/agent/AGENTS.md`, see docs/quickstart.md and
docs/usage.md's "Context Files" section) can load it for every pi-agent
and pi-web session on local-ai-machine, regardless of which project a
session is working in. This is the same snapshot-with-disclaimer approach
used for docker/turnstone/skills/agentic-fleet-printer-dashboard.md,
applied to a genuinely simpler mechanism: pi loads this automatically and
ALSO auto-discovers each project's own AGENTS.md by walking up from cwd
(confirmed - no bespoke "go read the project's AGENTS.md" instruction
needed here, unlike the Turnstone skill, which had to say that explicitly
because Turnstone has no native equivalent).

Snapshot taken 2026-07-31. NOT live-synced - re-copy this file (see
docker/README or ask whoever's doing the next real fleet-convention change
to update it here too) when agentic-fleet/AGENTS.md changes meaningfully.
-->

# AGENTS.md — Fleet

Binding for any model/agent on this machine, in every repo. §-numbers are stable anchors — cards and scripts may reference them.
Token discipline is a design goal: read deltas, not boards; frontmatter, not bodies; write cards for the many agents who will pay to read them.

## §1. Gate

Check once per session (not per turn): does the repo have `.fleet/`?
- **No** → behave normally. If tickets/planning/multi-agent work comes up, mention fleet and offer setup.
- **Yes** → everything below binds for the session. If you're about to edit/create/delete source files and haven't checked yet, stop and check now.

## §2. Base behavior (`.fleet/` present)

Before any work:
1. Read the board (paths: §2a).
2. Card already covers this work? Claim or reference it — no duplicates.
3. No card? Create one from `.fleet/templates/card.md.tmpl`:
   - Work the human just asked for → create in **now/** and claim it (their request is the promotion).
   - Work you discovered yourself (follow-ups, found bugs) → create in **backlog/**, flag it to the human, and do NOT start it (§4a).
4. Then work, via sub-agents (keeps your context clean for the conversation):

| Sub-agent | Job |
|---|---|
| Research | Investigate, read, report (incl. debugging) — no code writing |
| Implement | Write/modify code, run tests, commit |
| Review | Review diffs, find issues, verify |

**Sub-agents are exempt from this file.** They execute only their brief — no board reads, no card writes, no claims. The parent owns the card and the coordination. Brief them narrowly; have them return compact summaries, not transcripts.
You self-orchestrate: planning, card updates, coordination stay with you.
Ordinary judgment calls while working a card: proceed and record the call in the card (hard stops excepted — §7).

## §2a. Locations

```
REPO_ROOT=$(git rev-parse --git-common-dir | xargs dirname)
```

Board: `$REPO_ROOT/.fleet/board/{backlog,now,blocked,done}/` — always on main, even from a worktree.
Worktrees created by `fleet-launch.sh` have `.fleet/board` symlinked to `$REPO_ROOT/.fleet/board` (F-072) — one shared, git-tracked board, not a per-worktree copy. This does **not** remove the need for `-C "$REPO_ROOT"`: git resolves the *active* repository from your cwd, not from where a path physically points, so a relative `.fleet/board/...` path run from your worktree's own root still targets that worktree's own branch — not `main` — even though the file it names is the same shared file (confirmed dangerous in practice, not hypothetical: it silently commits to the wrong branch and leaves the real repo-root checkout with a phantom deleted/untracked entry). **Always use `-C "$REPO_ROOT"` for board git operations.** Board ops (claim/move/signal) commit **directly to main** via `git -C "$REPO_ROOT"`, scoped to the board and nothing else:

```
git -C "$REPO_ROOT" add -f .fleet/board && git -C "$REPO_ROOT" commit -m "<msg>" -- .fleet/board
```

`-f` is required: the symlink migration's shared `info/exclude` entry (see F-072) makes plain `git add` silently skip new board files even at the repo root. `-f` is harmless whether or not a given repo/worktree has migrated. A "ignored by .gitignore... use -f" advisory on board paths is expected and harmless as long as `-f` is used.
Never `add -A`, `add .`, or `commit -a` at the repo root — dirty or staged files there are not yours to commit, and a pathspec-scoped commit ignores them.
Source code stays on your worktree branch → PR. **Never push source code to main.** Wait for review on the PR before merging.

## §3. Roles

Human assigns at activation. First action: **announce yourself** — pet name (from wrapper script), role, joining the fleet.
- "begin working the queue" (or similar) → **worker**
- "watch the fleet" / "orchestrate" (or similar) → **orchestrator**

**Never claim autonomously.** Claiming requires both: the board exists AND the human has directed queue work (worker activation). Outside that, claims happen only for work the human asked for (§2).
The board is always the source of truth.

## §3b. Worker loop — WIP limit: 1

Runs until now/ is clear or the human stops you.

1. **RECONCILE** — `git -C "$REPO_ROOT" pull --ff-only origin main`.
   - HEAD unchanged → nothing moved; skip all board reads (→ 5 if holding a card, else idle in step 4). *Exception: timers tick without commits — if a claim you saw earlier would now be stale (>30 min), scan anyway.*
   - HEAD changed → read the delta (`git log --oneline ORIG_HEAD..` / `git diff --name-status ORIG_HEAD..`); open only cards the delta touches.
2. **WIP** — already hold a card in now/? → step 5.
3. **SCAN** — **now/ only**, via frontmatter + signals (never card bodies): unclaimed cards, or stale claims (claimed_at >30 min, no fresh signals). **Never pull from backlog/ or blocked/** — every move into now/ is human-gated (§4a).
4. **CLAIM** — run the before-claim guard (§6a), write claimed_by + claimed_at, commit+push main. Beaten by another claim? Skip to next candidate. Nothing claimable? Report idle **once**, with pending-confirmation counts ("idle — 6 in backlog, 2 unblockable, awaiting confirmation"), then back off per §3e; reset to active cadence when the board log shows activity. → 1.
5. **WORK** — sub-agents per the card's Plan (Research → Implement → Review or as needed). Read your own card fully; everyone else's via frontmatter/signals. Update `## Plan`, `## Decision log`, `## Handoff notes` tersely as you go; signal shared-state decisions (§3d).
6. **PR** — commit on worktree branch, push, open PR vs main. If the repo has a PR template (`.github/PULL_REQUEST_TEMPLATE.md` or `.github/PULL_REQUEST_TEMPLATE/*.md`), use it verbatim as the PR body and fill in every section — no skipped checklists, no deleted sections. PR URL goes in Handoff notes.
7. **DONE** — `git mv` card to done/, commit+push main. → 1.
8. **BLOCKED** — move to blocked/ with a note why, commit+push main. → 1.

Remember: board changes → main; source code → branch + PR. Never mix.

## §3c. Orchestrator loop — never claims cards

On activation, use `ScheduleWakeup` to re-invoke at the active cadence from §3e (session-scoped; the human re-triggers per window). Each wakeup:

1. **RECONCILE** — pull main. HEAD unchanged → silent tick: no reads, no report. *Same exception as §3b: if a known claim just crossed 30 min, proceed to DIAGNOSE.* HEAD changed → read the commit-log delta; open only affected cards.
2. **DIAGNOSE** — stuck agents (claimed_at >30 min, no progress signals); **candidates for now/** (backlog promotions; blocked cards whose blocked_by resolved) — exclude `status: needs-refinement` cards (§4b), tally them separately; imbalance (workers idle while candidates await confirmation — a gating bottleneck, surface it).
3. **REPORT — deltas only**: new claims/moves/stalls since your last report, plus now/-candidate *suggestions* with a one-line rationale each. Nothing changed → no report. You are the human's primary contact; workers stay heads-down.
4. **COORDINATE** (on human direction) — move cards, reprioritize, signal, reassign. **Execute moves into now/ (from backlog/ or blocked/) only on explicit human confirmation** — suggest freely, move never (§4a).

Escalate stuck workers or drifted worktrees (§6a) **visibly**, not passively — cost of delay compounds.
Remember: board changes → main; source code → branch + PR.

## §3d. Signals

Append-only, timestamped lines in a card's `## Signals`:

```
<!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
<!-- signal: otter 2025-07-15T15:10Z — blocked on K-003, need schema first -->
```

Signals are the fleet's cheap channel: scanners read frontmatter + signals, never decision logs — so anything a scanner must know belongs here, in one line. Others pick signals up on their next reconcile. A conflicting signal <10 min old wins — wait or pick another card; >10 min is stale, ignore.
Patterns: `claiming` · `working: <area>` · `blocked on <id>` · `handoff ready` · `done` · `priority: now|later`.
Discipline: signal on claim, on done, on block.

## §3e. Idle wakeup cadence

Applies to both loops' idle state (§3b step 4 backoff cap; §3c's tick interval). This is fleet-specific policy layered on top of `ScheduleWakeup`'s own cache-TTL guidance, not a restatement of it.
- **Active** (board delta seen in the last 10 min, or still working a card): 60s.
- **No-op ticks** (RECONCILE finds HEAD unchanged): after 3 in a row, escalate straight to **1200s** (dormant cadence) — never park in the 270–330s cache-straddle band, and never settle at a 5min cap.
- **Confirmed dormant** (still no activity after reaching 1200s): stay at 1200s; do not escalate further.
- **Reset to 60s** immediately on any HEAD change or stale-claim detection (>30 min, per §3b/§3c step 1's exception).

## §4. Cards

Markdown + YAML frontmatter: `id` (e.g. R-001, K-042.1), `title`, `initiative_id`, `claimed_by` + `claimed_at` (**null when unclaimed**), `blocks`/`blocked_by`, `related_cards`, `status` (**null** by default; see §4b for `needs-refinement`).
Frontmatter + signals must be sufficient to judge claimability — no scanner should ever need the body.

- **Claim:** edit frontmatter directly; no script.
- **Move:** `git -C "$REPO_ROOT" mv .fleet/board/<from>/<id>.md .fleet/board/<to>/<id>.md` (the `-C` is required, not optional — an absolute `$REPO_ROOT`-prefixed path with no `-C`, run from inside a worktree, fails with "outside repository").
- **Board commits:** terse conventional messages — `<verb> <id> (<pet-name>)`, e.g. `claim R-004 (otter)`, `done K-012 (heron)`. The board's git log is the fleet's event stream; this convention is what makes §3b/§3c delta reads work.
- **Edit-then-move gotcha:** edit + `git mv` + commit in quick succession can silently commit a stale pre-edit snapshot (seen in R-004: claim commit was a pure rename, claim fields missing). Verify with `git show --stat` / `git diff HEAD~1` before moving on.
- Never let a card reach done/ without a one-line *why* (not just what) in the decision log.

Boards are git-tracked; card moves are real commits. Same care as any tracked file.

## §4a. Entry into now/ is human-gated

now/ is human-approved work; **nothing enters it without explicit human confirmation** — not from backlog/, and not from blocked/, even when the blocker has resolved.
- Workers never move cards into now/. Moving your own card *out* (→ blocked/ or done/) is fine.
- The orchestrator suggests candidates with rationale (promotions and unblocks alike) and executes the move only after the human confirms.
- Human-requested work is created directly in now/ — the request itself is the confirmation (§2).

## §4b. Needs-refinement status

`status: needs-refinement` flags a backlog/blocked card that can't be planned or promoted yet — a design question, missing decision, or research gap blocks scoping itself, not just prioritization. Distinct from `blocked_by` (a dependency on another card's completion): a card can carry both, either, or neither.

- **Set it explicitly**, only after actually looking at the card and hitting a wall — not by default for every unplanned stub. Most fresh backlog cards start with an empty Plan; that alone isn't `needs-refinement`. Record why in the Decision log.
- **No claim semantics** — it's descriptive metadata, not a lifecycle state. Claiming/WIP rules (§3b) are untouched.
- **Orchestrator**: exclude `needs-refinement` cards from now/-candidate suggestions (§3c DIAGNOSE); surface their count separately so a scoping gap isn't confused with a card simply awaiting a promotion decision.
- Clear the field (`status: null`) once a card is scoped and ready.

## §5. Cross-repo initiatives

- Parent card at `agentic-fleet/initiatives/<id>/CARD.md`; child cards in each repo's board, linked via `initiative_id` (child) and `children:` (parent).
- Parent `## Rollup` is regenerated by `fleet-index.sh` from child columns — never hand-edit.
- **Always ask before bootstrapping a new repo or initiative.** Most repos don't deserve a board; the human decides.
- Any agent may edit `initiatives/`; concurrent writes resolve as ordinary git merges (§6).

## §6. Concurrency

- Pull main before scanning. Push immediately after any claim or move. Never trust cached board state — re-read frontmatter after every pull.
- `pull --ff-only` fails → someone pushed first: pull again, re-read, skip if claimed / retry if transient.
- Claim race: first commit wins; the loser's pull reveals it — skip to next candidate. No coordination beyond git.

## §6a. Worktrees — silent drift

Separate branches don't conflict until merge, so the board can drift into contradiction:

- **Fetch-check:** `git fetch origin main` each loop iteration (or every few claims); diff main's board vs yours.
- **Before-claim guard (highest-value check):** ID check is one stat — `test -f` on main's `done/<id>.md`. Title-match only against done/ cards added since your branch's merge-base (older closures predate your branch and can't be your redo). Match → skip; never redo closed work.
- **Merge rules:** ID collision (same ID, different content) → renumber yours with `.1` suffix (F-058 → F-058.1), merge content into the original, human picks which code survives. Contradictory resolutions → present both with a clear comparison; human decides; record the choice + rationale in the surviving card's decision log.
- You own your own reconciliation; the orchestrator may flag drift but never resolves it.

## §7. Hard stops — explicit human confirmation, no exceptions

Force-push / rewriting shared history · deleting branches · closing PRs · merging over someone's in-progress work · applying infra changes to production.
§2's proceed-and-record default never applies here.

---

## Local addendum (local-ai-machine only, not part of the fleet snapshot above)

Not part of `agentic-fleet/AGENTS.md` — do not fold this into that repo's file if
re-copying the snapshot above. This section is specific to pi-web sessions running
on this box and binds regardless of `.fleet/` presence in whatever project a session
is working in.

**Hard stop: archiving or deleting a pi-web session that wasn't started by the current
agent, in the current task, purely for disposable scratch/test purposes.** A pi-web
session can hold hours of real, in-progress work — not cheaply reversible. Confirmed
safe without asking, every time: a session the agent itself started via `POST
/sessions` in the same task, at a `cwd` the agent itself created solely for that test,
archived+deleted before the task ends. Everything else — any session at a real
project's own working directory, or any session the agent did not itself start in the
current task — needs the human's explicit go-ahead first, no exceptions, even if it
looks empty/stale/scratch-like. Added 2026-08-04 after building `pi-web-factory`
(`jmfederico-pi-web/pi-web-factory/`), which drives pi-web sessions programmatically —
this rule applies to it and to any future agent (including one triggered via a
`pi-web-factory` skill, per that project's design) with the same force.
