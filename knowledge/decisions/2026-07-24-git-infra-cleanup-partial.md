---
id: 2026-07-24-git-infra-cleanup-partial
date: 2026-07-24
source: "README.md (Decision Log — 2026-07-24: Git/infra cleanup — main fast-forwarded, box reconciliation stopped mid-way on real divergence)"
tags: [git, nixos, box, reconciliation]
status: superseded
---

# Git history reconciliation: Mac-side cleaned up, box-side deliberately stopped mid-way

**Decided (Mac-side, completed)**: the `worktree-eventual-stirring-sunrise` branch (with
all real project history — ~20 commits of benchmarking/catalog work) was a clean
fast-forward descendant of `origin/main`'s old 2-commit tip. Fast-forwarded `origin/main`
up to it (verified `merge-base` equalled `origin/main`'s prior tip first, not a real
3-way merge), then fast-forwarded the primary Mac worktree to match. The now-redundant
branch was deleted on the remote only.

**Decided (box-side, deliberately incomplete at time of writing)**: added `origin` via a
dedicated deploy key, fetched successfully, renamed the box's old disconnected `master`
to `master-old-standalone-snapshot` (preserved, not discarded). But checking out a new
`main` tracking `origin/main` was refused by git because the box's working-tree
`README.md` and `configuration.nix` were not byte-identical to `origin/main` — unlike
every other previously-diffed file (pure bookkeeping drift), these two were a genuinely
older *content* snapshot, missing ~30 commits' worth of real evolution.

**Why stop here rather than force it**: per standing instruction, did not force-reset
over a genuinely divergent working tree without first confirming whether the box's live
files reflected any real running-state changes that needed to be reconciled *into* the
repo before adopting `origin/main`'s version wholesale (judged unlikely, since
`nixos-rebuild` is the only thing that actually changes running state, but not verified
at the time).

**Status**: this specific reconciliation gap is almost certainly resolved by now (later
sessions continued git/infra work) — flagged `superseded` here since it describes a
point-in-time blocked state, not a standing fact. If the box's `main` branch state is
relevant to current work, verify directly rather than trusting this file.
