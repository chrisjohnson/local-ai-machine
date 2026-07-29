# knowledge/context/

Standing operational information: current state, open next steps, guardrails/policies
that apply going forward, environment facts an agent needs before acting. This is the
"here is how things are" / "here is what to do or not do" category — not a one-time
choice (`knowledge/decisions/`) and not an investigation result (`knowledge/research/`).

Because context describes an ongoing state rather than a point-in-time event, files here
are expected to be updated more often than decision/research files — but still append new
information rather than rewriting history. If something changes meaningfully, prefer
adding a dated note within the file (or a `related:`-linked follow-up file) over silently
overwriting what used to be true.

## Filename

`<topic>.md` — no date prefix. Keep topic names short and specific: `guardrails.md`,
`open-next-steps.md`, `download-queue-policy.md`, not `misc.md` or `notes.md`.

## Frontmatter

```yaml
---
id: guardrails
date: 2026-07-24
source: HANDOFF.md (Guardrails)
tags: [operations, policy]
status: active
---
```

See `knowledge/README.md` for the full field definitions (`id`, `date`, `source`, `tags`,
`status`). For context files, `date` means "last confirmed/updated," not "date of an
event" — bump it when the file's content is re-verified or amended.

## Body format

No fixed structure — context files vary more than decisions/research. Common shapes:

- A **standing policy or guardrail**: what's authorized, what needs sign-off, what the
  hard stops are.
- **Current state**: what's running, what's in flight, what's finished as of the last
  update.
- **Open next steps**: a concrete, prioritized list of what to do next, written so a
  fresh agent with zero prior context can act on it directly.

Whatever the shape, state things as present-tense facts ("the download queue currently
has N items in flight") rather than session narrative ("I then checked the queue and
found..."). Narrative belongs in `HANDOFF.md`; context files are the distilled, current
answer.

## Example

```markdown
---
id: guardrails
date: 2026-07-24
source: HANDOFF.md (Guardrails)
tags: [operations, policy]
status: active
---

# Guardrails

- All changes to the box go through git — no hand-patching files directly on the box over
  SSH. Local edit -> commit -> push -> `git pull` on the box -> `nixos-rebuild switch` (for
  NixOS config changes) or `docker compose up -d` (for compose-only changes).
- Full authority to manage the box's OS/services to get work done: start/stop containers,
  run `nixos-rebuild`, pause/resume downloads, run benchmarks. Not ask-first territory —
  just route it through git, not raw SSH edits.
- Hard stops needing direct human confirmation: force-push/rewriting shared history,
  deleting branches not explicitly asked for, promoting any newly-benchmarked model to
  the actual production default, any new model download beyond what's already
  queued/approved.
```
