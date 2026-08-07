---
id: M-105
title: Visualizer tweaks
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
---

# M-105 — Visualizer tweaks

## Context
Chris made this ticket, pardon errors

## Plan
1. The colors are decent, but not quite beautiful. The sand colored background and borders and text are all fine, but the role color choices are just a little dull. Using the common sand brown and black as a pallete, plus the purple you used for hte plan step, do some web research for beautiful color palettes based around those starting colors. Make sure to include a better choice for the red and green on the grid page as well (I'm not attached to red or green here, I just want to visually highlight failure in some way). Really focus on trying to make the colors beautiful here.
2. Ensure that we have either a very large bank of chosen colors or a scalable system for expanding, since we're adding more steps and roles as time goes on. As such, while researching, build a mini-palette for each of the color roles to be used in their different variations. For example, when you have the light purple for the plan role background, you might have a darker purple for its border, and a good contrasting color for the text. You probably want another lighter and darker variation of the background, such as on the grid page for inactive work. Then, make sure that color palette is used consistently everywhere that the role is referenced visually. Steps also get their own colors, so e.g. the new setup code step. I also don't want the colors shifting over time, plan is always purple, but whatever scheme we devise should not require an AI agent to have to actively come up with the next step color palette, the bank of researched matching mini-palettes should be robust as a result of this ticket.
3. On the detail page, when you mouse over each step, it should flip to that steps' details at the bottom automatically. Also, the details should be in a box with a color selection from that role's mini-palette
4. Too many repetitions of the role on the detail page. You have plan, then plan in a purple pill, then the purple plan time bar below it with the word plan on it. Ditch the title and pill and just do the timebars.
5. If they aren't already, add a field for step title in the workflow steps schema, and give a succinct but human friendly name. The keyword for the step might be plan, and it's fine to show the keyword in the gantt timebar, but then in the detail section below, where you've got plan (in black) follwoed by plan (in purple), we can replace that with the human friendly step title from the workflow definition, such as "Construct a Plan"
6. Likewise, a human-friendly description of what the step is *generally* supposed to accomplish, also in the workflow definition. Call this field the "summary" on the details page, and what you currently have as "summary" should actually be "result"
7. attempt 0 == we should be indexing from 1, at least in the UI
8. On page load for details page, if there's and active step, activate/highlight that step as though we moused over it already

## Signals

## Decision log
- 2026-08-07 (claude): renamed from Chris's own placeholder `M-10X` to a
  real board ID — no content changes, this card is verbatim as Chris wrote
  it.

## Handoff notes
Relates to [[M-103]]'s ticket/multi-attempt UI work (item 7's "attempt 0
should be attempt 1" applies directly to M-103's arrow-navigation design)
and to the step-title/summary schema fields M-103 doesn't otherwise touch —
worth sequencing after M-103's ticket-detail-page rework lands, since this
card's items 3/4/5/6 are all detail-page changes that would otherwise
conflict with M-103's own detail-page rework happening concurrently.
