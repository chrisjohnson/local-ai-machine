---
id: 2026-07-23-firewall-loopback-binding-fix
date: 2026-07-23
source: "README.md (Decision Log — 2026-07-23 later: Phase 2 results, firewall gap workaround)"
tags: [security, firewall, nixos, docker, networking]
status: active
---

# Firewall gap root-caused for real: bind vLLM ports to loopback instead of relying on nftables forward rules

**Decided**: bind `vllm-primary`/`vllm-judge` (and the swap scripts) to `127.0.0.1`
instead of `0.0.0.0` in their Docker port mappings — `"127.0.0.1:8000:8000"` instead of
`"8000:8000"`.

**Why**: the earlier `filterForward`/`extraForwardRules` fix (2026-07-22 audit) never
actually protected published ports. Root-caused by reading the live nftables ruleset
directly: NixOS's firewall module has a built-in, unconditional `ct status dnat accept`
rule in the `forward-allow` chain — not something introduced by this project's own
`extraForwardRules`. It's evaluated before `extraForwardRules` and is a terminal accept,
so it unconditionally accepts any DNAT'd (i.e. any Docker `-p`-published) connection
regardless of destination port, completely bypassing `allowedTCPPorts`. This meant the
2026-07-22 fix was solving a real but *different* problem (plain container-to-container
bridge forwarding that isn't DNAT'd) — the earlier `extraForwardRules` lines were dead
code for any published-port traffic.

**Alternatives considered**: continuing to patch the forward-chain rules directly was
rejected as fragile — the built-in `ct status dnat accept` rule is a NixOS firewall-module
internal, not something meant to be overridden safely. Binding to loopback sidesteps the
whole forward-chain/DNAT question entirely: a loopback-bound port isn't reachable from the
LAN by basic IP routing, no matter what the firewall's forward chain does.

**Verified**: external curl to both ports now returns nothing (blocked); the SSH tunnel
(`ssh -f -N -L 18000:localhost:8000 -L 18001:localhost:8001 chris@local-ai-machine.local`)
and on-box access both still work fine. Going forward, these two raw model ports are
reachable only via SSH tunnel or `docker exec` from the host — LiteLLM on port 4000
remains the only intended externally-reachable gateway, now for real.
