---
id: M-082
title: pi-web-factory — permissions enforcement flags incidental verification artifacts (e.g. __pycache__) as violations
initiative_id: null
claimed_by: claude
claimed_at: "2026-08-06T00:00Z"
blocks: null
blocked_by: null
status: null
related_cards: [M-064, M-080]
---

# M-082 — pi-web-factory — permissions enforcement flags incidental verification artifacts (e.g. __pycache__) as violations

## Context
Found live, 2026-08-05, while triggering demo Workflow Runs for Chris to watch. A
`plan-build-review` run's `review` Step (Role `review`, `writes: none` — deliberately
read-only) failed with `PERMISSIONS-VIOLATION`. The actual violating "write" was
`__pycache__/stack.cpython-311.pyc` — a Python bytecode cache file, the automatic,
incidental side effect of the review agent legitimately running `python3` (or
importing the module) to actually verify the build's code works, not the agent
writing content it shouldn't. `permissions.ts`'s before/after git-diff snapshot
(M-064) correctly detected a new untracked file outside the Role's `writes:`
allowlist and rolled it back per its own design — working exactly as built, just
catching something that isn't really a violation in spirit.

This is a real, likely-recurring gap: any read-only Role (`review`, `scout`) that
verifies its work by actually *running* code (Python `__pycache__/`, Node.js
`node_modules/.cache`, compiled `.pyc`/`.class`/build-output directories, etc.) will
probably keep tripping this. Worth a real design decision, not a quick patch:
- A default global exemption list (à la `.gitignore` conventions) for well-known
  incidental-artifact patterns, applied regardless of a Role's own `writes:`?
- Or should `permissions.ts` respect the target repo's own `.gitignore` for
  determining what counts as a "real" write vs. incidental? (Careful: `.gitignore`
  is also just app-owned config, arguably no more trustworthy than `writes:` itself —
  and a repo without Python-aware `.gitignore` entries wouldn't be covered anyway.)
  {{Note the design doc/M-064's own decision log explicitly reasoned about
  `.gitignore` reliance for a DIFFERENT case — re-read that reasoning before
  reusing it here, it may or may not transfer.}}
- Or should read-only Roles' system prompts explicitly instruct them not to
  execute code that leaves artifacts, only read/analyze? (Weakest fix — asking a
  model not to run `python3 file.py` to check it works is asking it to verify less
  thoroughly, probably the wrong tradeoff.)
- Or accept this as correct, conservative-by-design behavior (better to occasionally
  false-flag a review Step than silently allow an unexpected write) and just make
  the failure message clearer about *what kind* of thing was written, so a human
  glancing at a failed run immediately understands "this was almost certainly
  harmless" rather than assuming real, unwanted content changed?

## Plan
Design decision (resolved by reading `modules/permissions.ts` in full, `modules/
config.ts` in full, and M-064's own decision log): **add a small, hardcoded default
exemption list, checked in `isWritePermitted` ahead of the existing `protectedFiles`
denylist** — not a per-project config option, and not reliance on the target repo's
own `.gitignore`. Reasoning:
- Confirmed by direct test (`git ls-files --others --exclude-standard`, the exact
  call `snapshotRepoState` makes at `permissions.ts:78`): `--exclude-standard`
  ALREADY makes gitignored untracked files invisible to snapshotting — so the
  `__pycache__/stack.cpython-311.pyc` violation from the incident could only have
  happened because the target scratch repo's own `.gitignore` did NOT list
  `__pycache__/` (or had no `.gitignore` at all). This directly answers the card's
  second bullet: relying on `.gitignore` doesn't need a new code path — the
  mechanism already exists and already ran — the actual gap is that a fresh/
  minimal/non-Python-aware target repo's `.gitignore` can't be trusted to cover
  this, which is precisely the scenario the incident hit.
- Rejected: per-project `.pi-web-factory.yaml` config option. Read `config.ts` in
  full — `ProjectConfigFileSchema` (`config.ts:111-115`) is narrowly scoped to
  `test`/`typecheck`/`lint` quality-gate commands, all describing HOW to run a
  check, not what pi-web-factory's OWN enforcement should ignore. Bolting a
  permissions-exemption concern onto that file would conflate "the target
  project's own build tooling" with "pi-web-factory's safety-enforcement
  internals" — a worse fit than it first looks, and it would only help projects
  that remember to opt in, leaving every other project (including any scratch/
  demo repo, which is exactly where this was first hit) exposed to the same
  false-positive.
- Rejected: relying on the target repo's `.gitignore` as the sole signal (already
  covered above) — real gap for repos without Python-aware entries, and per the
  card's own note, M-064's prior `.gitignore`-avoidance reasoning was actually
  about a DIFFERENT thing (upstream's `always_writable(data_dir)` exemption for
  pi-web-factory's OWN report directory, which this port doesn't even have — see
  M-064 card decision log, 2026-08-04 entry) — that reasoning doesn't transfer
  here and shouldn't be cited as a reason to avoid `.gitignore`-awareness broadly.
- Rejected: prompt-only fix (tell read-only Roles not to run code that leaves
  artifacts) — correctly identified in Context as the weakest option; not
  pursued further, would degrade review quality for a marginal enforcement gain.
- Accepted alongside the default list: ALSO improve the failure message/summary so
  a human glancing at a real (non-exempted) violation can tell what kind of thing
  was written — cheap, and worth doing regardless of the exemption list, per the
  Context's fourth bullet.

Concrete implementation plan:
1. In `modules/permissions.ts`, add a new exported constant near the top of the
   "permission decision" section (before `isWritePermitted`, ~line 134):
   ```
   /**
    * Default-exempt patterns: incidental verification/build artifacts a
    * read-only or write-restricted Role's own tool use (running a test,
    * importing a module to check it works) commonly leaves behind, that are
    * never meaningful CONTENT changes an agent authored. Checked ahead of
    * protectedFiles/writes — same "naming a path is what unlocks it" spirit
    * as the writes: allowlist, just an always-on list instead of a per-Role
    * one. Uses the same globToRegex/matchesPattern machinery as writes:/
    * protectedFiles (directory-prefix trailing "/" semantics included).
    */
   export const DEFAULT_EXEMPT_ARTIFACTS: string[] = [
     // Each artifact type gets a bare (repo-root) form AND a "**/"-suffixed
     // nested form — see Plan item 2's verified matchesPattern/globToRegex
     // findings for exactly why both are required (a "**/"-prefixed pattern
     // that ALSO ends in a bare "/" is a no-op; a "**/"-prefixed glob never
     // matches a root-level file with no directory component).
     "__pycache__/", "**/__pycache__/**",
     "*.pyc", "**/*.pyc",
     "*.pyo", "**/*.pyo",
     ".pytest_cache/", "**/.pytest_cache/**",
     ".mypy_cache/", "**/.mypy_cache/**",
     ".ruff_cache/", "**/.ruff_cache/**",
     "node_modules/.cache/", "**/node_modules/.cache/**",
     ".next/cache/", "**/.next/cache/**",
     "*.class", "**/*.class",
     ".DS_Store", "**/.DS_Store",
   ];
   ```
   Scope the list conservatively — these are all well-known, tool-generated,
   never-hand-authored paths (same bar as `.gitignore`'s own community-standard
   templates, e.g. GitHub's `Python.gitignore`/`Node.gitignore`) — do not add
   broader patterns (e.g. generic `dist/`/`build/`) without a real second
   incident motivating them, since those CAN legitimately be hand-authored
   deliverables in some projects.
2. Update `isWritePermitted` (`permissions.ts:151-163`) to check
   `DEFAULT_EXEMPT_ARTIFACTS` FIRST, before the `writes:` allowlist check —
   note this is the OPPOSITE precedence from `writes:` vs `protectedFiles`
   (where naming a path in `writes:` overrides `protectedFiles`): an exempt
   artifact should never even count as "touched" in spirit, regardless of
   what a Role's own `writes:`/`protectedFiles` say, since it was never a
   content decision the agent made. Concretely:
   ```
   export function isWritePermitted(
     path: string,
     allowedWrites: string[] | null,
     protectedFiles: string[],
   ): boolean {
     if (DEFAULT_EXEMPT_ARTIFACTS.some((p) => matchesPattern(path, p))) {
       return true;
     }
     if (allowedWrites !== null && allowedWrites.some((p) => matchesPattern(path, p))) {
       return true;
     }
     if (protectedFiles.some((p) => matchesPattern(path, p))) {
       return false;
     }
     return allowedWrites === null;
   }
   ```
   **VERIFIED BUG in the exemption list's naive form** — actually ran
   `matchesPattern`/`globToRegex` (permissions.ts:106-132) standalone against
   candidate patterns before finalizing this plan, do not skip this step when
   implementing:
   - `matchesPattern("__pycache__/x.pyc", "**/__pycache__/")` -> **false**.
     A `**/`-prefixed pattern that ALSO ends in `/` takes the directory-prefix
     branch (line 129: `pattern.endsWith("/") -> path.startsWith(pattern)`),
     which does a LITERAL `startsWith("**/__pycache__/")` — `**` is not glob-
     expanded on that branch at all, so this form can never match anything.
     Confirmed via direct execution, not just reading: this exact form is a
     real bug the exemption list would hit immediately if written naively as
     `"**/__pycache__/"`.
   - `matchesPattern("__pycache__/x.pyc", "__pycache__/")` (bare, no `**/`
     prefix) -> **true** (repo-root-relative directory prefix, the
     `startsWith` branch working as intended). But
     `matchesPattern("sub/__pycache__/x.pyc", "__pycache__/")` -> **false**
     (only matches at repo root, `changedPaths` returns repo-root-relative
     paths so a NESTED `__pycache__/` inside a subdirectory of the working
     tree is missed by the bare form).
   - `matchesPattern("sub/__pycache__/x.pyc", "**/__pycache__/**")` (no
     trailing bare slash, goes through `globToRegex`'s regex branch instead)
     -> **true**. This is the correct nested-directory form.
   - `matchesPattern("x.pyc", "**/*.pyc")` -> **false** — `globToRegex("**/*.pyc")`
     compiles to `/^.*\/[^/]*\.pyc$/`, which requires a literal `/` after the
     `.*`, so a ROOT-LEVEL `x.pyc` (no directory component) does not match a
     `**/`-prefixed glob at all. Needs a bare `*.pyc` entry too for root-level
     coverage.
   FIX: for each artifact type, list BOTH a bare pattern (root-level coverage:
   `__pycache__/`, `*.pyc`) AND a `**/`-suffixed-no-trailing-slash nested form
   (`**/__pycache__/**`, `**/*.pyc`) — NOT a `**/`-prefixed form that also ends
   in a bare `/`, which is the broken shape above. Do not extend
   `matchesPattern`'s directory-prefix branch to special-case a `**/` prefix —
   smaller/safer to just supply both forms in the exemption list than to change
   the shared matching primitive that `writes:`/`protectedFiles` (YAML-authored,
   human-facing) also depend on.
3. Improve the violation message (Context's fourth bullet, worth doing
   regardless of the exemption list for whatever a human still sees when a
   REAL violation occurs): in `cli.ts`'s `describeResult`
   `permissions-violation` case (cli.ts:225-237, confirmed also relevant to
   M-080's plan item 4), no change needed there specifically for M-082 — the
   message already lists violating paths. Optional, lower-priority addition
   if time allows: have `PermissionsResult` (`permissions.ts:218-229`)
   annotate each violation with whether it LOOKED build/cache-artifact-shaped
   even after the exemption list (e.g. matches a broader, non-exempted-by-
   default pattern like `dist/`/`*.log`) so a human can eyeball "probably
   harmless but not on our exempt list yet" vs "real content change" — cut
   this if it adds meaningful scope, the exemption list itself is the real
   fix.
4. Tests: add to `modules/permissions.test.ts`'s existing `describe("isWritePermitted"`
   block (permissions.test.ts:33+): cases for `__pycache__/x.pyc` at repo root
   AND nested (`sub/dir/__pycache__/x.pyc`), `.pytest_cache/`, a `*.pyc` file
   NOT inside a `__pycache__/` dir, all exempted regardless of `allowedWrites`/
   `protectedFiles` args (even `allowedWrites: []` / fully read-only). Also add
   an `enforceWrites` integration-style test (alongside the existing scenarios
   at permissions.test.ts:90+) mirroring the actual incident: a real git repo
   fixture, snapshot before, create `__pycache__/stack.cpython-311.pyc` after,
   `allowedWrites: []` (read-only Role, matches the actual `review` Role
   config) — assert `violations` is empty and the file is left in place (not
   rolled back) — this is the actual regression test for the incident.
5. Update this module's own header comment (permissions.ts:1-27) with a short
   note on the new exemption tier, same documentation discipline the existing
   "One upstream tier deliberately NOT ported" paragraph (lines 42-56)
   already follows — future readers should find the rationale in the module,
   not have to find this card.

## Signals
<!-- append-only -->
<!-- signal: claude 2026-08-05T04:25Z — filed from a live finding, not started -->

## Decision log
<!-- append-only, one line per entry, newest last -->
- 2026-08-05 (claude): filed per AGENTS.md §2 (self-discovered issue → backlog/,
  flagged, not started). Real, reproduced live (adwId `adw_7a60e384248d`), not
  speculative — but which fix (if any) is a genuine design call.
- 2026-08-06 (claude): refined per Chris's "refine all 4" request. Read
  `modules/permissions.ts` and `modules/config.ts` in full, plus M-064's own
  decision log for the prior `.gitignore` reasoning (confirmed it does NOT
  transfer — that was about upstream's always_writable(data_dir) exemption
  for pi-web-factory's own report dir, not a target repo's build artifacts).
  Confirmed via direct execution that `snapshotRepoState`'s `git ls-files
  --others --exclude-standard` already respects a target repo's .gitignore —
  the incident repo's .gitignore just didn't cover __pycache__/. Decision:
  hardcoded default exemption list in isWritePermitted, not a per-project
  config option (config.ts's ProjectConfigFileSchema is scoped to test/
  typecheck/lint commands, wrong fit). Also verified by direct execution that
  a naive "**/__pycache__/" pattern is a no-op bug in matchesPattern's
  directory-prefix branch — plan specifies the corrected bare+nested pattern
  pairs, verified working. Cleared `status: needs-refinement`.
- 2026-08-06 (claude): implemented per the Plan exactly. `modules/
  permissions.ts`: added `export const DEFAULT_EXEMPT_ARTIFACTS: string[]`
  (bare + `**/...**` nested pattern pairs for `__pycache__/`, `*.pyc`,
  `*.pyo`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`,
  `node_modules/.cache/`, `.next/cache/`, `*.class`, `.DS_Store` -- the
  corrected shape from the Plan, not the naive `**/__pycache__/` no-op
  form); `isWritePermitted` now checks it FIRST, ahead of `writes:`/
  `protectedFiles`, unconditionally exempting a match regardless of those
  args. Updated the module header comment with the new exemption tier's
  rationale, matching the existing "One upstream tier deliberately NOT
  ported" documentation discipline. Tests added to
  `modules/permissions.test.ts`: 7 new `isWritePermitted` unit cases
  (repo-root + nested `__pycache__`/`.pytest_cache`, root-level stray
  `*.pyc`, exemption overriding even an explicit `protectedFiles` entry, a
  precise-substring-match negative case, and a regression guard against the
  naive no-op pattern) plus one `enforceWrites` integration test mirroring
  the actual incident exactly (`allowedWrites: []`, a fully read-only
  `review`-shaped config, `__pycache__/stack.cpython-311.pyc` created ->
  asserts `violations: []`, file left in place, not rolled back).
  Verification: `bun test modules/permissions.test.ts` -- 25/25 pass; full
  suite 257/278 pass, same 21 pre-existing environment-only failures as
  before this change (confirmed identical failing-test-name set). `bunx tsc
  --noEmit` clean. Pushed to `main` at `33adf5b` (bundled with M-080/M-095/
  M-096 in one commit per the coordinating agent's instruction). No deploy
  step needed for this card specifically -- pure logic change in
  pi-web-factory's own always-synced code, picked up by whatever combined
  `docker compose build jmfederico-pi-web` the coordinator runs once all
  parallel work lands (deliberately not run by this session, per
  coordination to avoid racing M-103/M-099's own deploys).

## Handoff notes
Repro trace: `gate_fail:permissions` event, `{"item":"__pycache__/stack.cpython-311.pyc","ok":false,"note":"rolled back — outside writes allowlist"}`, on the `review` Step of a `plan-build-review` run whose task involved a Python file. Session/scratch repo already cleaned up as part of this session's other demo-run cleanup — re-derive a fresh repro rather than trusting old IDs.
