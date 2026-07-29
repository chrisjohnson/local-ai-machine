---
id: guardrails
date: 2026-07-24
source: "HANDOFF.md (Guardrails, lines 6-45)"
tags: [operations, policy, git, hard-stops]
status: active
---

# Guardrails

Standing operational policy for any agent working on this machine/repo. Distilled from a
session handoff written 2026-07-24; check `AGENTS.md` at the repo root for the current,
authoritative version of anything that might have since changed (e.g. the direct-push-to-
main vs. branch-and-PR question has been revisited more than once — `AGENTS.md` is the
live source of truth for that specific rule).

- **Keep moving. Don't wait for a human and don't waste cycles deliberating** on judgment
  calls that aren't covered by an explicit hard stop. Make the reasonable call, do it, and
  record it in a decision log. If something breaks, troubleshoot and fix it before giving
  up.
- **Commit and push often.** Small, frequent commits, not one giant one at the end. Every
  real chunk of progress is its own commit.
- **All changes to the box go through git. No exceptions.** Local edit -> commit -> push
  -> `git pull` on the box -> `nixos-rebuild switch` (for NixOS config changes) or `docker
  compose up -d` (for compose-only changes). Never hand-patch files directly on the box
  over SSH — this caused two independently-drifted git histories to have to be
  reconciled once already.
- **Full authority to manage the box's OS/services to get work done** — stop/start
  containers, run `nixos-rebuild`, pause/resume downloads, run benchmarks. Not
  ask-first territory; drive the whole machine, just do it through git.
- **Use sub-agents; keep the top-level context focused on overall goal, not execution
  detail.** Delegate the actual running of individual benchmarks, filling in a build file,
  investigating a failure, etc. Stay at the level of tracking overall progress, sequencing
  work, and making judgment calls.
- **Sub-agents do not get to unilaterally bypass the git pipeline.** The "no hand-patching
  the box" rule binds sub-agents by default; an exception needs explicit authorization
  from the calling/top-level agent, not a unilateral sub-agent decision. The top-level
  agent does have authority to make that call itself when warranted — deliberately, and
  logged, not silently.

## Hard stops — need direct human confirmation, no exceptions

- Force-push / rewriting shared history.
- Deleting branches not explicitly asked for.
- Promoting any newly-benchmarked model to the actual standing production default (i.e.
  changing what `vllm-primary`/`vllm-judge` — or their eventual replacement — actually
  serve by default). Testing/swapping models in/out is standing permission; making
  something *the* default is not.
- The FastFlowLM IOMMU/reboot tradeoff — a real, measured performance-vs-availability
  tradeoff, explicitly deferred.
- Any new model download beyond what's already explicitly approved in the moment. A broad
  "keep working" grant does not cover this, even for a strong/obvious candidate.
