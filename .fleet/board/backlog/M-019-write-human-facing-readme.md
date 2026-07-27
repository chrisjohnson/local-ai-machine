---
id: M-019
title: "Task 8.3: Write a proper human-facing README.md"
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
related_cards: [M-003, M-020]
---

# M-019 — Write a proper human-facing README.md

## Context

Ported from README.md §8 Phase 8 (requested 2026-07-23), Task 8.3
(2026-07-26). Phase 8's objective: this project has grown from a one-shot
deployment task into a long-lived, ongoingly-maintained system, and its
documentation needs to reflect that. README has functioned as a running
project journal/decision-log this entire time — genuinely useful for that
purpose, but not what a human needs when they sit down to actually operate
or rebuild this machine. Split it into purpose-built pieces.

Write what this project *is* and its architecture, at a level a new reader
can actually use — not a chronological journal. Must include, concretely:

- **How to destroy-and-recreate the machine from scratch**, including the
  real bootstrapping gotchas found this project: `nmcli` (not raw
  `wpa_supplicant`) for WiFi during install; the BIOS one-time
  boot-override trick (not a permanent boot-order change); the
  kernel-version requirement for the M5's MT7925 WiFi chip (needs ≥6.7,
  NixOS 24.11's default 6.6.94 silently doesn't work); the iGPU UMA memory
  BIOS configuration (`UMA_SPECIFIED` + smallest frame buffer, not the
  `Auto` default which silently carves out 64GB as static VRAM).
- **How to obtain/generate every secret this stack needs** — what each one
  is for and the mechanism to create it (LiteLLM master key, per-user
  virtual keys via `/key/generate`, Grafana admin password via
  `grafana-cli admin reset-admin-password`, HF token, Synology backup SSH
  key) — not the live values themselves.
- **Day-to-day operational instructions**: how to swap in and benchmark a
  model, how to check what's currently loaded (`docker ps`, `/v1/models`),
  how to reach services (SSH tunnel vs. LiteLLM gateway vs. on-box only),
  and anything else a human would actually need to maintain this machine
  going forward.

Related to [[M-003]] (migrating remaining agentic content from README into
AGENTS.md/fleet cards) — that card handles pulling *agentic-process*
content out; this card is about writing the *replacement human-facing*
README from scratch. The two overlap in scope (both touch what stays vs.
leaves README) but are distinct deliverables.

## Plan
<!-- ordered checklist -->
1. [ ] Draft README's new structure: project identity/architecture,
   destroy-and-recreate instructions, secrets-generation reference,
   day-to-day operational instructions.
2. [ ] Write the destroy-and-recreate section, including all four
   bootstrapping gotchas listed in Context — don't drop any of them.
3. [ ] Write the secrets reference (mechanism only, never live values).
4. [ ] Write the day-to-day operations section.
5. [ ] Cross-check against [[M-003]]'s classification work (product docs
   vs. agentic process) so the two efforts don't conflict.

## Signals
<!-- append-only. Leave signals for other agents. Format:
     <!-- signal: <pet-name> <ISO8601-UTC> — <short message> -->
-->

## Decision log
<!-- append-only, one line per entry, newest last. Never move this card to done/
     without a line here explaining why. -->
- 2026-07-26 — filed by porting README.md §8 Phase 8, Task 8.3 into a fleet
  card during the fleet-bootstrap backlog migration; linked to [[M-003]]
  since both touch README's scope but aren't the same deliverable.

## Handoff notes
<!-- what's half-done, what the next agent picking this up should do first. -->
Not started. Check [[M-003]]'s status before starting — its docs-vs-process
classification may inform what content survives into this new README.
