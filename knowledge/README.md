# knowledge/ — institutional memory for this repo

This directory is a file-based memory system for this project: decisions made and why,
research findings with sources, and current operational context. It is designed to be
read and extended by any agent or model, running under any harness or framework — there
is nothing here that assumes a specific tool, runtime, or vendor. Plain markdown files
with YAML frontmatter, nothing else.

It exists alongside — not instead of — the three large root files (`README.md`,
`HANDOFF.md`, `OPTIMIZATIONS.md`) that historically held this project's running journal.
Those files remain valid as narrative/historical records. `knowledge/` is the structured,
grep-and-scan-friendly view of the same underlying project memory, purpose-built for an
agent to load only what it needs instead of parsing thousand-line files front to back.

## Subdirectories

- **`decisions/`** — one file per concrete decision: what was decided, why, what
  alternatives were considered (if any), and where it came from. Use this for anything
  where a choice was made among real options — a config default, a tool pick, a policy,
  an architecture call.
- **`research/`** — one file per discrete research finding or benchmark result: what was
  found, how (methodology/source), and what it means. Use this for investigation output —
  benchmark numbers, hardware/software compatibility findings, third-party tool
  evaluations — regardless of whether it fed directly into a decision.
- **`context/`** — standing operational information that isn't a one-time decision or a
  research finding: current state, open next steps, guardrails/policies that apply going
  forward, environment facts an agent needs to know before acting. Use this for anything
  that reads as "here is how things are" or "here is what to do/not do," rather than "here
  is what we chose and why."

Each subdirectory has its own `README.md` with the exact frontmatter fields, naming
convention, and a worked example — read the one for the subdirectory you're adding to
before writing a new file.

## Frontmatter format

Every file in `decisions/`, `research/`, and `context/` (except each subdirectory's own
`README.md`) starts with YAML frontmatter:

```yaml
---
id: 2026-07-24-mtp-gguf-missing-head
date: 2026-07-24
source: OPTIMIZATIONS.md (MTP speculative decoding, real attempt on Qwen3.6-27B)
tags: [mtp, llamacpp, qwen, speculative-decoding]
status: active
---
```

- **`id`** — matches the filename (without `.md`). Gives every file a stable, quotable
  identifier independent of its path.
- **`date`** — `YYYY-MM-DD`. The date the decision was made or the research was
  conducted/verified, not the date it was migrated into this directory.
- **`source`** — where this came from: a file + section name if migrated from one of the
  root files, a URL if it's from external research, or a person/session reference if it's
  new. Always cite something checkable.
- **`tags`** — a flat YAML list of lowercase, hyphenated keywords. Used for grep-based
  discovery (see below). Reuse existing tags where they fit rather than inventing near-
  duplicates — skim a few existing files in the target subdirectory first.
- **`status`** — lifecycle state of the content itself:
  - `active` — still accurate and relevant as far as anyone knows.
  - `superseded` — a newer file has replaced or corrected this one; that newer file should
    exist and, ideally, reference this one back (e.g. via a `related:` field or a note in
    its body).
  - `open` — (context/ only, optional) an item that's tracked but not yet resolved, e.g. a
    standing next-step. Use `active` if unsure whether `open` vs `active` applies.

## Naming conventions

- **`decisions/` and `research/`**: `YYYY-MM-DD-<slug>.md`. The date is when the decision
  was made or the finding was produced/verified — filenames are the interface, so an
  agent should be able to tell what a file is about and roughly when, without opening it.
- **`context/`**: `<topic>.md` — no date prefix, since context files describe an ongoing
  state that gets updated in place as things change, not a point-in-time event. Keep
  topic names short and specific (e.g. `guardrails.md`, `open-next-steps.md`).

## How to use this directory

If you are an agent working in this repo, read this file once at the start of a session,
then:

1. Skim the `id`/`date`/`tags` frontmatter across the subdirectory relevant to your task
   (or grep for a tag — see below) rather than reading every file in full.
2. Open only the specific files whose frontmatter suggests they're relevant to the task at
   hand.
3. If your work produces a new decision, research finding, or a change to standing
   context, add a new file in the right subdirectory following its README's format.
   **Append, don't edit.** Existing files are not rewritten when new information arrives —
   if something is superseded, create a new file and mark the old one's `status:
   superseded` (a one-line frontmatter edit to the old file is fine for this specific
   purpose; rewriting its body is not).
4. Grep-based discovery works without loading full file contents, e.g.:
   ```
   grep -rl "tags:.*vllm" knowledge/**/*.md
   ```

That's the whole protocol. No special tooling, no framework integration — any agent that
can read and write text files can use this directory.
