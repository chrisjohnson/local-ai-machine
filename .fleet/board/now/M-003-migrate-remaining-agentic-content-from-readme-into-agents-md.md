---
id: M-003
title: Create knowledge/ directory and migrate decisions/research/context from README, HANDOFF, OPTIMIZATIONS
initiative_id: null
claimed_by: claude
claimed_at: 2026-07-29T05:32Z
blocks: null
blocked_by: null
status: null
related_cards: [M-019, M-004]
---

# M-003 — Create knowledge/ directory and migrate decisions/research/context

## Context

This repo's institutional knowledge — decisions, benchmark research, hardware findings,
operational context — is scattered across three large, unstructured root `.md` files:
`README.md` (1400+ lines of mixed architecture spec + running journal), `HANDOFF.md`
(session handoff log with embedded decisions), and `OPTIMIZATIONS.md` (research notes +
benchmark data + community findings). None of these are structured for an agent to
efficiently load only what it needs.

The goal: create a `knowledge/` directory as a **file-based memory system** that any
model or harness (not Claude-specific, not tied to any agent framework) can read and
contribute to. Any agent — regardless of runtime — should be able to:
1. Scan `knowledge/` at session start and load relevant context.
2. Append new findings/decisions in a consistent format without restructuring existing files.
3. Find what it needs by filename convention, not by parsing 1400-line monoliths.

## Plan

1. [x] **Create `knowledge/` directory structure:**
   ```
   knowledge/
   ├── README.md              # Index: what's in this dir, naming conventions, how to add
   ├── decisions/             # One file per decision, filename = slug + date
   │   └── README.md          # Explains format, gives examples
   ├── research/              # Research findings, benchmark data, hardware analysis
   │   └── README.md          # Explains format, gives examples
   └── context/               # Current state, operational notes, standing config
       └── README.md          # Explains format, gives examples
   ```

2. [x] **Write `knowledge/README.md`** — the index. Must:
   - Describe each subdirectory and when to put content there.
   - Define the minimal frontmatter/metadata format (YAML frontmatter for each file: `id`, `date`, `source`, `tags`, `status`).
   - Specify naming conventions: `YYYY-MM-DD-<slug>.md` for decisions/research, `<topic>.md` for context.
   - Include a "How to use this directory" section written for *any* agent, not
     framework-specific. No mentions of Claude, opencode, or any particular harness.
     Just: "Read the README in each subdirectory. Follow the format. Append, don't edit."

3. [x] **Migrate from `HANDOFF.md`:** Extract decisions and operational context into
   `knowledge/decisions/` and `knowledge/context/`. Each decision becomes its own file
   with: what was decided, why, what alternatives were considered, date, and source
   reference. Session narrative stays in `HANDOFF.md` (it's a handoff log, not a
   knowledge base — but its *decisions* belong in knowledge/).

4. [x] **Migrate from `OPTIMIZATIONS.md`:** Extract research findings into
   `knowledge/research/`. Each major finding (MTP results, NPU+iGPU analysis,
   Lemonade evaluation, Ollama version tradeoff, etc.) becomes its own file.
   The Qwen3.6-27B/35B-A3B performance data, the community benchmark verification,
   the FastFlowLM research — all of these are discrete research artifacts.

5. [x] **Migrate from `README.md`:** Extract the decision history and standing operational
   context (the "Open Next Steps" task tracking, standing-permission notes) into
   `knowledge/context/` and `knowledge/decisions/`. Architecture spec and product
   documentation stays in `README.md`.

6. [x] **Update `AGENTS.md`** to add a section pointing agents at `knowledge/`:
   ```markdown
   ## Knowledge base — read at session start

   `knowledge/` contains this project's institutional memory: decisions made and
   why, research findings with sources, and current operational context. Any agent
   working in this repo should scan `knowledge/README.md` at session start, then
   load relevant files from `knowledge/decisions/`, `knowledge/research/`, and
   `knowledge/context/` as needed for the task at hand. New findings go into the
   appropriate subdirectory following the format in its README.
   ```

7. [x] **Do not delete the original files** — `HANDOFF.md`, `OPTIMIZATIONS.md`, and
   `README.md` stay as-is. The originals remain valid (HANDOFF as a historical log,
   OPTIMIZATIONS as a flat reference, README as architecture spec). Knowledge/ is the
   structured, agent-friendly view, not a replacement.

## Design constraints (model/harness-agnostic)

- **No framework-specific syntax.** No Claude system-prompt injection, no opencode
  plugin APIs, no agent-framework imports. Everything is plain markdown files with
  YAML frontmatter. Any tool that can read files can use this.
- **Append-only by convention.** Existing files in knowledge/ are never restructured
  when new content is added. New files are created; old files get a one-line
  `related:` link in frontmatter if needed.
- **Filename IS the interface.** An agent doesn't need to parse file contents to know
  what's relevant — the directory structure and filenames (`2026-07-24-mtp-gguf-missing-head.md`)
  are self-describing.
- **Frontmatter is the index.** `tags` in frontmatter let any agent do grep-based
  discovery without loading full file contents: `grep -l "tags:.*vllm" knowledge/**/*.md`.

## Signals
<!-- signal: claude 2026-07-29T05:32Z — claiming, per Chris's "3 then 22" sequencing -->
<!-- signal: claude 2026-07-29T06:40Z — PR #8 open (m-003-knowledge-base -> main), all 7 plan steps done, awaiting review -->
<!-- signal: claude 2026-07-29T07:05Z — review complete, 3 minor fixes applied and pushed, PR #8 ready to merge -->

## Decision log
- 2026-07-26 — rewritten to reflect knowledge-directory approach per Chris's
  direction; prior needs-refinement scope (classify README sections) superseded.
- 2026-07-26 — moved to now/ — Chris promoted this directly.
- 2026-07-29 — did the migration work in a branch + PR (`m-003-knowledge-base`) rather
  than a direct push to main, per the fleet-root AGENTS.md default, even though this
  repo's own AGENTS.md currently states "direct pushes to main are explicitly
  authorized" — the task instructions for this card explicitly called for branch+PR,
  which takes precedence as the more specific/current direction for this piece of work.
- 2026-07-29 — synthesized (not copy-pasted) every migrated file: read each source
  section in full, then wrote it in the decision/research format the card specifies
  (what/why/alternatives for decisions; finding/methodology/tags for research), citing
  the originating file+section in `source:` frontmatter.
- 2026-07-29 — judgment call on splitting vs. combining: several OPTIMIZATIONS.md
  "Fourth pass" leads (llama-server concurrency, Ollama version tradeoff, new MoE
  candidates) were three distinct topics under one prose header — split into 3 separate
  research files rather than 1, since each has its own tags/relevance and an agent
  searching by tag shouldn't have to load all three to get one. Similarly split the
  llama-server concurrency research (the gap/bug writeup) from its own later benchmark
  run (the actual results) into two files, since they're dated the same day but are a
  "here's a gap" finding vs. a "here's what we measured" finding — different `tags`
  relevance for a future search.
- 2026-07-29 — judgment call on decisions vs. context: `HANDOFF.md`'s "Guardrails"
  section went to `knowledge/context/guardrails.md` (standing policy, not a one-time
  choice) per the card's own suggested framing. The two "Current state"-shaped sections
  (HANDOFF.md's catalog-structure paragraph, README.md's Open Next Steps) both went to
  context/ for the same reason — narrative-shaped but describing "how things are," not
  a decision with alternatives.
- 2026-07-29 — one file (`2026-07-24-git-infra-cleanup-partial.md`) was marked
  `status: superseded` at creation rather than `active`, since it describes a
  deliberately-incomplete, point-in-time blocked state (box-side git reconciliation)
  that later sessions almost certainly continued past — flagged as such in its own body
  rather than presented as still-current fact.
- 2026-07-29 — added light-touch, one-line pointer notes into all three original files
  (near the relevant sections) rather than leaving zero connection back to the new
  `knowledge/` files — no content in the originals was removed or rewritten, confirmed
  via `git diff` showing additive-only changes (one line replaced in AGENTS.md's
  existing bullet list to extend it, not delete it).
- 2026-07-29 — **Review pass complete (isolated worktree).** Verdict: high-quality,
  faithful migration, minor fixes needed before merge. Spot-checked 8+ files across all
  three subdirectories against `main`'s originals — content fidelity strong (exact
  benchmark numbers preserved, hedge/caveat language like "later flagged as likely
  partly fabricated" kept intact, not laundered into fact), zero
  Claude/opencode/Anthropic mentions anywhere in `knowledge/`, "light-touch" claim on
  the three originals confirmed genuine via diff. Found and fixed 3 mechanical issues:
  two dangling cross-references (`2026-07-22-qwen36-27b-unverified-chatbot-tips.md` and
  `knowledge/research/README.md`'s own worked example pointed at filenames that don't
  exist — both now point at the real files, `2026-07-24-qwen36-27b-llamacpp-vs-ollama.md`
  and `2026-07-24-fastflowlm-and-mtp-confirmed.md` respectively) and one transposed
  identifier typo (`gemma-4-26a4b-gguf` → `gemma-4-26b-a4b-gguf` in
  `2026-07-26-ollama-chat-template-root-caused-fixed.md`). Fixes pushed directly to
  `m-003-knowledge-base` (commit `eb213b6`). PR #8 ready for merge.
- 2026-07-29 — **Scope change, Chris's direct instruction, overrides the card's original
  Plan step 7 ("do not delete the original files").** Now that the migration is reviewed
  and content-fidelity-verified, Chris wants the originals actually cleaned up rather than
  left in place with pointers: `HANDOFF.md` and `OPTIMIZATIONS.md` deleted outright (their
  content is fully preserved in `knowledge/`), `README.md` rewritten into a standard
  human-readable project description (architecture/how-it-works), stripped of the
  journal/decision-log/roadmap-history content that's now in `knowledge/`. Doing this on
  the same `m-003-knowledge-base` branch before merge, then re-reviewing before Chris
  merges.
- 2026-07-29 — **Cleanup pass complete (isolated worktree, commit `fcc40d4` on
  `m-003-knowledge-base`).** Before deleting, spot-checked both files' content against
  `knowledge/` section by section (all of `OPTIMIZATIONS.md`'s major findings — the
  4-lead "fourth pass," the MTP negative result, the GPT-OSS-120B/20B benchmark, the
  Ollama version reassessment, the new-MoE-candidate survey — and all of `HANDOFF.md`'s
  guardrails/catalog-structure/decision-log/open-next-steps content) — everything was
  already faithfully migrated, nothing new needed backfilling. `git rm`'d both files.
  Rewrote `README.md` from 1453 lines (mixed architecture spec + running journal) down to
  278 lines: kept and refreshed the genuine architecture sections (repo layout, system
  topology diagram, `configuration.nix`/`docker-compose.yml`/LiteLLM design, Hermes
  delegation, catalog structure) after checking each against the actual current files —
  found and fixed real drift, since the old README still described the original
  single-primary/single-judge 2-container vLLM design and a stale model roadmap, while the
  actual `docker-compose.yml` has moved to M-001's two-tier per-build design (13+ model
  services on individual fixed ports, `scripts/set-role.sh` for dynamic LiteLLM role
  aliasing) with a much larger, versioned (M-002) `catalog/` and the Laguna deployment
  present. Cut the entire "Phased Implementation Roadmap" section (mermaid phase diagram,
  per-phase COMPLETE checklists, 10+ embedded "Decision Log — <date>" entries, "Open Next
  Steps") since all of it is already in `knowledge/decisions/`/`knowledge/context/` — left
  only a brief "current state" paragraph. Deleted the old "Implementation Directives for
  Coding Agent" section entirely (not moved) since everything in it — declarative-state
  discipline, secrets hygiene — was already covered by `AGENTS.md`. Updated `AGENTS.md`'s
  "Where the detailed operational knowledge lives" list (removed the now-stale
  `HANDOFF.md`/`OPTIMIZATIONS.md`/old-README-shape bullets) and fixed two stale
  `HANDOFF.md` references in `scripts/benchmark_orchestrator.py`'s docstring. Left board
  cards' own historical references to the deleted files alone (M-005, M-022) — accurate
  provenance for what was true when written, not live pointers. Pushed to
  `m-003-knowledge-base`, PR #8 still open for Chris's review before merge.

## Handoff notes
- Done: all 7 original plan steps complete, plus the 2026-07-29 scope-change cleanup
  (HANDOFF.md/OPTIMIZATIONS.md deleted, README.md rewritten as a human-readable
  architecture doc, AGENTS.md pointers updated). `knowledge/` has an index README + 3
  subdirectory READMEs, 15 files in `decisions/`, 16 in `research/`, 3 in `context/`
  (34 total content files, all with valid `id`/`date`/`source`/`tags`/`status`
  frontmatter, verified via a PyYAML parse pass).
- PR: https://github.com/chrisjohnson/local-ai-machine/pull/8 (branch
  `m-003-knowledge-base` -> `main`, now at commit `fcc40d4`). Not merged — left for
  Chris's review per the task instructions.
- Nothing genuinely ambiguous enough to block on came up during either the original
  migration or this cleanup pass — judgment calls (splitting multi-topic sections,
  decisions-vs-context framing, which architecture drift to fix, what to cut vs. keep in
  README) were all resolved using the card's own stated criteria and Chris's explicit
  instructions, recorded above rather than guessed silently.
- Do NOT move this card to done/ — leave that for after PR review/merge.
