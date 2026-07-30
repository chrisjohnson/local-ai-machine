---
id: M-034
title: pi-agent experiment — end-to-end validation + honest comparison notes
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: M-033
status: null
related_cards: [M-030, M-031, M-032, M-033]
---

# M-034 — pi-agent experiment — end-to-end validation + honest comparison notes

## Context
The point of tonight's work is to give the user a real, working thing to
evaluate in the morning, not a claim that it works. This card is verification
discipline (see this session's own precedent: the Turnstone `-n 8192` fix
that turned out incomplete, the "merged" claims that turned out to still be
open PRs, the Grafana/Prometheus fixes that each needed a live curl/API check)
— every claim below must be backed by something actually observed, not
inferred from the code.

## Plan
1. [ ] Real workload test: drive an actual piece of work through the deployed
   pi-agent session (not a toy "say hello" prompt) — ideally something
   comparable to what broke Turnstone (a multi-step task with several tool
   calls in a row) so there's a real basis for comparing loop/repeat
   behavior between the two harnesses on the same underlying model.
2. [ ] Reconnect test: start a task, actually close the browser tab (or curl
   connection) mid-task, wait, reconnect, confirm the session's work
   continued/completed server-side and the transcript is intact — this is
   the single most important claim in the whole experiment, verify it
   directly.
3. [ ] Restart test: restart the supervisor container/process entirely mid-
   or post-session, confirm sessions are still listed and their history is
   intact (per M-031's manifest + `--session-dir` design).
4. [ ] Write a short, honest comparison note (in this card's decision log or
   handoff notes) covering: what works, what's rough, resource footprint
   observed vs. Turnstone's stack, and specifically whether the semantic-
   loop problem diagnosed earlier this session (Turnstone's byte-literal-only
   repeat detector, advisory-only judge) shows up here too, is structurally
   avoided, or is simply untested by the workload chosen.
5. [ ] Leave the whole stack running and reachable for the user to poke at
   directly — don't tear anything down at the end.

## Signals

## Decision log

## Handoff notes
