---
id: 2026-07-22-download-serialization-flock
date: 2026-07-22
source: "README.md (Decision Log — 2026-07-22 later still: Download serialization, stall watchdog)"
tags: [downloads, systemd, flock, watchdog]
status: active
---

# Serialize model downloads with a shared flock; add a zero-growth stall watchdog

**Decided**: wrap each model download's actual transfer in a shared `flock` — whichever
download acquires it first runs to completion (through its own retry cycle) while others
block without consuming bandwidth, then take their turn in whatever order they acquire the
lock.

**Why**: downloads were saturating the connection. Each model download had its own
independent `systemd.timer`, uncoordinated with the others — multiple firing around the
same boot-time window meant simultaneous downloads competing for bandwidth (confirmed
directly: two Gemma models running in parallel dragged everything to a crawl). Verified
live: killed both in-flight parallel downloads so their retries would pick up the new
script, confirmed via process inspection that only one had an actual download process
running while the other's script sat blocked at the `flock` call.

**Second, separate decision — stall watchdog**: `gemma-4-26B-A4B-it`'s download hung with
zero disk growth for 10+ minutes, but with an active TCP connection showing a nonzero
receive queue (data physically arriving, sitting unread, `hf`'s process never consuming or
erroring). Distinct from earlier DNS-timeout stalls (those exit cleanly, handled by
`Restart=on-failure` already) — this one hangs forever with nothing to restart from.
**Decided**: background the `hf download` process and poll the destination directory's
total size every 2 minutes, force-killing it after 3 consecutive zero-growth checks (6
minutes) and letting the existing retry loop take over. Verified manually first (killed
the hung process, confirmed the retry resumed and made real progress) before automating
the same detection.
