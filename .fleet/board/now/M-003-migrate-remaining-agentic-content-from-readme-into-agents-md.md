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

1. **Create `knowledge/` directory structure:**
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

2. **Write `knowledge/README.md`** — the index. Must:
   - Describe each subdirectory and when to put content there.
   - Define the minimal frontmatter/metadata format (YAML frontmatter for each file: `id`, `date`, `source`, `tags`, `status`).
   - Specify naming conventions: `YYYY-MM-DD-<slug>.md` for decisions/research, `<topic>.md` for context.
   - Include a "How to use this directory" section written for *any* agent, not
     framework-specific. No mentions of Claude, opencode, or any particular harness.
     Just: "Read the README in each subdirectory. Follow the format. Append, don't edit."

3. **Migrate from `HANDOFF.md`:** Extract decisions and operational context into
   `knowledge/decisions/` and `knowledge/context/`. Each decision becomes its own file
   with: what was decided, why, what alternatives were considered, date, and source
   reference. Session narrative stays in `HANDOFF.md` (it's a handoff log, not a
   knowledge base — but its *decisions* belong in knowledge/).

4. **Migrate from `OPTIMIZATIONS.md`:** Extract research findings into
   `knowledge/research/`. Each major finding (MTP results, NPU+iGPU analysis,
   Lemonade evaluation, Ollama version tradeoff, etc.) becomes its own file.
   The Qwen3.6-27B/35B-A3B performance data, the community benchmark verification,
   the FastFlowLM research — all of these are discrete research artifacts.

5. **Migrate from `README.md`:** Extract the decision history and standing operational
   context (the "Open Next Steps" task tracking, standing-permission notes) into
   `knowledge/context/` and `knowledge/decisions/`. Architecture spec and product
   documentation stays in `README.md`.

6. **Update `AGENTS.md`** to add a section pointing agents at `knowledge/`:
   ```markdown
   ## Knowledge base — read at session start

   `knowledge/` contains this project's institutional memory: decisions made and
   why, research findings with sources, and current operational context. Any agent
   working in this repo should scan `knowledge/README.md` at session start, then
   load relevant files from `knowledge/decisions/`, `knowledge/research/`, and
   `knowledge/context/` as needed for the task at hand. New findings go into the
   appropriate subdirectory following the format in its README.
   ```

7. **Do not delete the original files** — `HANDOFF.md`, `OPTIMIZATIONS.md`, and
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

## Decision log
- 2026-07-26 — rewritten to reflect knowledge-directory approach per Chris's
  direction; prior needs-refinement scope (classify README sections) superseded.
- 2026-07-26 — moved to now/ — Chris promoted this directly.

## Handoff notes
- Not started. Start by creating the directory structure and `knowledge/README.md`
  (the index), then migrate HANDOFF.md decisions first (smallest, most discrete
  content), then OPTIMIZATIONS.md research, then README.md context.
