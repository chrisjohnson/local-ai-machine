# Comprehensive Master Architecture Specification: Bosgame M5 AI Node

**Target Device:** Bosgame M5 AI (AMD Ryzen AI Max+ 395 "Strix Halo", 128GB LPDDR5X Unified RAM, 2TB NVMe)
**Host Architecture:** NixOS (Flakes) Declarative OS + Docker Compose Container Stack

This specification reflects all clarified design decisions, incorporating NixOS declarative host management, dual-vLLM static slots with parallel tool parsing, Herdr PTY multiplexing with real-time agent status tracking, Hermes multi-topic orchestration, Turnstone governance and deferred MCP tool discovery, and multi-tenant edge isolation.

**Design Principles carried forward from Phase 1/2:**
1. **Cattle, Not Pets:** The physical host OS is completely declared via a single Git-backed Nix Flake (`flake.nix` & `configuration.nix`). A fresh install converts into an identical state in minutes via `nixos-rebuild switch`.
2. **Unified Memory Allocation:** The Ryzen AI Max+ 395 APU (`gfx1151`) shares 128GB of LPDDR5X RAM between CPU and iGPU. BIOS `iGPU Configuration` must be `UMA_SPECIFIED` with the smallest `UMA Frame Buffer Size` (1GB) — leaving it on `Auto` silently reserves a fixed 64GB, defeating the point. Kernel params (`amdgpu.gttsize=126976`, `ttm.pages_limit=32505856`, `amd_iommu=off`) then let the GPU draw dynamically on nearly the full ~124GB via GTT.
3. **Headless Execution:** Desktop display managers are disabled (`multi-user.target`) to eliminate GUI VRAM overhead.
4. **Strict Declarative State:** Do NOT issue manual `apt`, `pip`, or `systemctl` commands on the host outside `configuration.nix`/`docker-compose.yml`. Ordinary judgment calls made while bringing the box up are recorded in the roadmap below, not applied invisibly.
5. **Secrets Hygiene:** All passwords, tokens, and keys live in `secrets/` (gitignored, `.example` templates tracked) or `.env` files — never in tracked config.

---

## 1. Target Repository Structure

```text
local-ai-machine/
├── flake.nix                  # Flake entrypoint referencing host configuration
├── configuration.nix          # Declarative OS, kernel params, systemd, backups
├── hardware-configuration.nix # Auto-generated host hardware specs
├── secrets/
│   ├── synology_backup_key    # SSH private key for ai_backup_svc (rsync-over-SSH)
│   ├── wifi.env                # Fallback WiFi SSID/PSK (NetworkManager)
│   ├── chris-password-hash.txt # Local console password fallback (SSH stays key-only)
│   └── hf-token.env            # HuggingFace token, sourced at shell login for faster downloads
# (public SSH keys, e.g. drew's, aren't secrets — they go inline in
# configuration.nix as string literals, same as chris's, not in this directory)
├── docker/
│   ├── docker-compose.yml     # vLLM x2, Ollama sandbox, LiteLLM, Turnstone, Open WebUI, Prometheus, Grafana
│   ├── .env.example           # Template for LITELLM_MASTER_KEY, LITELLM_DB_PASSWORD, DB_PASSWORD, TURNSTONE_JWT_SECRET, ANTHROPIC_API_KEY
│   ├── litellm/
│   │   └── config.yaml        # Model routes, virtual keys per tenant, rate limits
│   # No docker/turnstone/ directory — Turnstone's own config is TOML at
│   # ~/.config/turnstone/config.toml (0600) inside the container, not a
│   # bind-mounted YAML file; that judge/reranker wiring is still deferred
│   # (Task 3.5). Open WebUI is likewise config-free here — it's entirely
│   # driven by env vars pointed at LiteLLM, with its own state (auth, chat
│   # history) in a named Docker volume, not a bind-mounted directory.
│   ├── prometheus/
│   │   └── prometheus.yml     # Metric scraping targets (currently incomplete — see Section 8 open work)
│   └── grafana/
│       └── dashboards/
│           └── strix-halo.json # Placeholder only — no datasource provisioned, no real panels yet
├── docs/
│   └── benchmark-report-2026-07-22.html # vllm bench serve results across 35B/80B-GPTQ/4B models + hardware audit
└── scripts/
    └── sync-backup.sh         # Manual trigger for the rsync backup mirror
```

---

## 2. End-to-End System Topology

```mermaid
flowchart TD
    subgraph Host OS & Hardware [Bosgame M5 - Strix Halo 128GB Unified VRAM - NixOS Flake]
        A[NixOS Flake Configuration] --> B[Kernel Params: gfx1151 ~124GB iGPU VRAM]
        A --> C[Systemd rsync-over-SSH Backup Timer -> Synology NAS]
        A --> D[Herdr Systemd User Daemon: /run/user/1000/herdr.sock]
    end

    subgraph Inference & Gateway Layer [Containerized Compute]
        E[vLLM Primary Slot - Port 8000\nQwen3.6-35B-A3B bf16\n--tool-call-parser qwen3_coder]
        F[vLLM Judge Slot - Port 8001\nQwen3.5-4B\n--tool-call-parser qwen3_coder]
        G[Optional Ollama Sandbox - Port 11434\nDynamic Lazy-Loading & Offloading]

        H[LiteLLM Proxy - Port 4000\nVirtual Keys, Concurrency, Token Telemetry]
        R[Open WebUI - Port 3001\nBrowser Chat UI over LiteLLM's\nOpenAI-compatible endpoint]

        E --> H
        F --> H
        G --> H
        H --> R
    end

    subgraph Governance & Tool Services [Turnstone Platform]
        I[Turnstone Server - Port 8080\n- Safety Judge wiring to Port 8001 DEFERRED (empty model registry)\n- Deferred BM25 MCP Tool Gateway\n- turnstone-eval & turnstone-doctor]
        I <--> H
    end

    subgraph User Workspace & Control Plane [Server User: chris]
        J[Hermes Agent Orchestrator\n- Telegram Topics: #app-alpha, #app-beta\n- Profiles, USER.md, MEMORY.md\n- Direct & Governed Sub-Agent Routing]

        K[Herdr PTY Workspaces & Panes]
        K1[Pane 1: OpenCode / Pi Agent]
        K2[Pane 2: Headless Claude Code]
        K3[Pane 3: System / Build Shells]

        K --> K1
        K --> K2
        K --> K3

        J -- Socket API Control --> D
        J -- Spawns & Monitors --> K
    end

    subgraph Telemetry [Observability - running but not yet wired up, see Section 8]
        P[Prometheus - Port 9090\nNo vLLM scrape targets;\nlitellm/node targets both down]
        Q[Grafana - Port 3000\nProvisioned datasource + real dashboard,\nreal admin password]
        P -.-> Q
    end

    subgraph External Clients & Multi-Tenancy [Hybrid Access]
        L[Local Laptop: OpenCode / Pi\nDirect Local Shell Execution]
        M[Edge Friend: Drew's Laptop\nLocal Hermes/OpenCode -> WireGuard VPN]
        N[Phone: Telegram App\nMulti-Topic Supergroup]
        O[Browser: Open WebUI\nhttp://host:3001]

        L -- sk-chris-master --> H
        M -- sk-drew-edge Rate Limited --> H
        N <--> J
        O --> R
    end
```

---

## 3. Declarative System Nix Configuration (`configuration.nix`)

This mirrors the actual deployed file exactly. `herdr`'s package/service and the `drew` account are applied; `drew` has no SSH key wired up yet (public keys aren't secrets — when available it goes straight into `authorizedKeys.keys` as a string literal, same as chris's).

The `models` list is now hoisted into a top-level `let` binding (rather than scoped inside `systemd.services`) so the download services, their triggering timers, and `docker-compose-app`'s marker-poll loop can all share it without duplicating the list three times. Current entries, in the order they were added, with the reasoning that got each one there:

1. **`qwen3.6-35b-a3b`** (`Qwen/Qwen3.6-35B-A3B`, bf16) — primary. gfx1151 (RDNA3.5) has no FP8 matrix-core hardware at all (FP8 WMMA support starts at RDNA4), and every real-world report of Qwen3-Next-family FP8 checkpoints on this exact toolbox/hardware fails to load or stalls at Triton autotune, not just runs slow. A plain bf16 release of Qwen3-Coder-Next is ~160GB, too large for the 124GB GPU allocation regardless. Qwen3.6-35B-A3B is proven working at bf16 on this exact hardware via this exact toolbox, and independently benchmarks ahead of gpt-oss-120b on coding despite being a third the size.
2. **`qwen3.5-4b`** (`Qwen/Qwen3.5-4B`, bf16) — judge / quick tasks.
3. **`qwen3-coder-next-gptq4bit`** (`btbtyler09/Qwen3-Coder-Next-GPTQ-4bit`, ~50GB GPTQ 4-bit, 80B total/3B active) — a larger "does this actually compete" comparison tier. No gfx1151 report exists for this exact checkpoint, but the identical `Qwen3NextForCausalLM` architecture (the non-coder predecessor) has a real ROCm TP=1 benchmark in the toolbox's own repo (177.9 tok/s aggregate) — never promoted to their official tested-models list, so treated as moderate-, not high-, confidence. Downloaded and benchmarked (Section 4 / `docs/benchmark-report-2026-07-22.html`); **not run concurrently with the primary model** — swapped in temporarily for the benchmark pass and currently stopped.
4. **`qwen3.5-122b-a10b-awq4bit`** (`cyankiwi/Qwen3.5-122B-A10B-AWQ-4bit`, ~80GB on disk) — the 100B+ tier candidate. Explicitly **not** DeepSeek-V4-Flash (284B, FP4/FP8-native experts — same no-FP8-hardware wall as above) or MiniMax-M2 (its AWQ-4bit quant requires `tensor-parallel-size 2` / RDMA 2-node clustering, not usable single-node). The toolbox's own model table marks this entry "too big for single GPU," but that comment turned out to be a stale copy-paste from a different (8-bit) table entry — real evidence it runs at TP=1 exists (toolbox issue #22, ~9.5-10 tok/s single-stream), and a real ROCm bug that did block this hybrid mamba/attention architecture (bad `block_size`) was fixed upstream and merged into the toolbox image in March 2026. 80GB on disk is bigger than raw parameter math suggests because it bundles a vision encoder. **Currently downloading**; KV cache headroom will be tight at the usual 0.70 utilization, so it's planned to run without the judge model loaded concurrently once it lands (see Section 8 open work).

Four more models are confirmed as good next candidates but not yet queued for download: `Qwen/Qwen3.6-27B` (55.6GB), `google/gemma-4-31B-it` (62.6GB), `google/gemma-4-26B-A4B-it` (51.6GB), and `Qwen/Qwen2.5-VL-7B-Instruct` (16.6GB, vision/OCR — will need `--limit-mm-per-prompt` flags not yet used anywhere in this stack). DeepSeek-V4-Flash and MiniMax-M2 are formally ruled out per the reasoning above, not just deferred.

A full benchmark pass (`vllm bench serve` across the 35B, judge, and GPTQ-80B models at concurrency 1 and 8) plus a hardware/system audit is written up in **[`docs/benchmark-report-2026-07-22.html`](docs/benchmark-report-2026-07-22.html)**. Headline finding: there's no clean speed winner — the GPTQ 80B model wins single-stream (14.34 vs 11.91 tok/s) while the 35B bf16 model wins at concurrency 8 (33.19 vs 26.13 tok/s) with better latency scaling under load. Also notable: the 80B GPTQ model is *smaller on disk and leaves more KV cache headroom* than the 35B bf16 model (46.49GiB weights / 40.42GiB KV vs 66.97GiB weights / 18.49GiB KV) — quantization beats raw parameter count for memory footprint once it's actually measured rather than assumed.

That same audit found and fixed three real system issues, now live below:
- **CPU governor** was `powersave` on all 32 threads (~1.6-1.8GHz on a 5GHz-capable CPU) — forced to `performance` via `powerManagement.cpuFreqGovernor`.
- **Router DNS resolver** was intermittently timing out — root cause of a cascade of downloads that looked like "network flakiness." Fixed with `networking.nameservers` listing the router first and public resolvers (1.1.1.1, 8.8.8.8) as fallback, plus `networking.networkmanager.dns = "none"` — NetworkManager manages `/etc/resolv.conf` itself by default and was silently ignoring `networking.nameservers` without it (confirmed: the first attempt at this fix had zero effect on the live file).
- **`rocm-smi`'s VRAM metric is misleading on this unified-memory APU** — it only reports the 1GB static BIOS carve-out, not real GTT/unified-memory usage (showed 208MB used while tens of GB were genuinely allocated). Added `amdgpu_top` and `nvtopPackages.amd` as GTT-aware alternatives, plus a batch of common shell tools (`jq`, `ripgrep`, `yq`, `zsh`, `vim`, `asdf-vm`, `fzf`, `fd`, `netcat-gnu`, `dnsutils`, `curl`, `lsof`, `net-tools`) to `environment.systemPackages`.

A fourth, more serious finding came out of the same audit: **Docker manages its own FORWARD-chain iptables rules, which bypass NixOS's firewall entirely for published container ports.** Confirmed directly — port 8000 (raw vLLM, zero auth, never in `allowedTCPPorts`) was externally reachable on the LAN the whole time regardless of what was declared here. Fixed with `networking.firewall.filterForward = true`, which required switching to the nftables backend (`networking.nftables.enable = true` — `filterForward` doesn't exist on the classic iptables backend at all). Ports 8000/8001 (raw vLLM) are now deliberately excluded from the allowlist going forward; LiteLLM on 4000 is the intended authenticated gateway, and direct vLLM access is meant to stay host-local only (`docker exec`, `vllm bench serve`), never LAN-reachable.

**Deployment pipeline redesign.** The root problem: `nixos-rebuild switch` blocks synchronously on starting or restarting any systemd unit that takes a long time — like a multi-GB model download — turning repeated, unrelated config pushes into 15-40 minute stalls. Two fixes, both live below:
- `restartIfChanged = false` on the model-download and `docker-compose-app` services — an unrelated config change no longer force-restarts (and blocks on) an in-flight download; the new unit definition just takes effect the next time the unit naturally starts.
- Model downloads and `docker-compose-app` moved from a direct `wantedBy = [ "multi-user.target" ]` to timer-triggered (`systemd.timers`, `OnBootSec`). Arming a timer is near-instant regardless of how long the triggered work takes, unlike a direct `wantedBy` on an already-active target, which `nixos-rebuild switch` tries to start synchronously as part of activation.
- `docker-compose-app` deliberately does **not** use `after=`/`wants=` against the download services to express "wait for downloads." Those retry indefinitely on failure, so ordering against them only proves "the most recent attempt exited," not "eventually succeeded." Instead it polls the same `.download-complete` marker files the downloads already produce.
- Verified end-to-end: killed an in-flight download mid-transfer, pushed a config change, confirmed the switch completed in ~3.4 seconds (not 15-40 minutes), the download resumed from where it was killed rather than restarting from scratch, and downstream services correctly waited without blocking anything else.

The same effort also found a genuine data-integrity bug: `hf download`'s own exit code is **not** reliable evidence of completeness — it can exit 0 while leaving an incomplete directory when the network is unreachable (observed directly: a "complete" 35B model download was actually missing 6 of 26 shards). Fixed by checking for leftover `.incomplete` marker files under the download cache and cross-checking sharded models' `model.safetensors.index.json` manifests before trusting a download, rather than trusting `hf download`'s exit code alone — both checks are in the download script below.

```nix
{ config, pkgs, lib, ... }:

let
  # Declarative model downloads — hoisted here (not scoped inside
  # systemd.services) so both the download services and their triggering
  # timers, plus docker-compose-app's marker-poll loop, can all reference
  # the same list without duplicating it three times.
  models = [
    # Qwen3.6-35B-A3B (bf16), not Qwen3-Coder-Next-FP8: gfx1151 (RDNA3.5)
    # has no FP8 matrix-core hardware at all (FP8 WMMA support starts at
    # RDNA4), and every real-world report of Qwen3-Next-family FP8 on this
    # exact toolbox/hardware fails to load or stalls at Triton autotune —
    # not just slow, broken. BF16 Qwen3-Coder-Next is ~160GB, too large for
    # our 124GB GPU allocation regardless. Qwen3.6-35B-A3B is proven
    # working at bf16 on this exact hardware via this exact toolbox, and
    # independently benchmarks ahead of gpt-oss-120b on coding despite
    # being a third the size — best real "local Sonnet" fit available.
    { name = "qwen3.6-35b-a3b"; repo = "Qwen/Qwen3.6-35B-A3B"; }
    { name = "qwen3.5-4b"; repo = "Qwen/Qwen3.5-4B"; }
    # Larger "does this actually compete with Sonnet" tier, ~50GB GPTQ
    # 4-bit (not the ~160GB bf16 original, not the broken FP8 checkpoint —
    # see above). No gfx1151 report exists for this exact checkpoint, but
    # the identical Qwen3NextForCausalLM architecture (the non-coder
    # predecessor, dazipe/Qwen3-Next-80B-A3B-Instruct-GPTQ-Int4A16) has a
    # real ROCm tp1 benchmark in the toolbox's own repo: 177.9 tok/s
    # aggregate — never promoted to their official tested-models list, so
    # treat this as moderate-confidence, not proven. Only ~3B active params
    # per token like the 35B model above, so there's a real chance the
    # larger total-parameter capacity doesn't translate into a coding
    # quality win — worth benchmarking head-to-head once both are running,
    # not assumed.
    { name = "qwen3-coder-next-gptq4bit"; repo = "btbtyler09/Qwen3-Coder-Next-GPTQ-4bit"; }
    # 100B+ tier. NOT DeepSeek-V4-Flash (284B, native FP4/FP8 experts —
    # same no-FP8-hardware wall as before) or MiniMax-M2 (its AWQ-4bit
    # quant needs tensor-parallel-size 2 / RDMA 2-node clustering, not
    # usable single-node). The toolbox's own model table marks this one
    # "too big for single GPU" too, but that comment turned out to be a
    # stale copy-paste from a different (8-bit) entry — real evidence it
    # runs at TP=1 exists (toolbox issue #22, ~9.5-10 tok/s single-stream).
    # A real ROCm bug did block this hybrid mamba/attention architecture
    # (bad block_size), fixed upstream and merged into the toolbox image
    # March 2026. 80GB on disk (bigger than raw param math suggests —
    # includes a vision encoder). KV cache headroom will be tight at our
    # usual 0.70 utilization; plan to run this without the judge model
    # loaded concurrently, budget utilization accordingly at serve time.
    { name = "qwen3.5-122b-a10b-awq4bit"; repo = "cyankiwi/Qwen3.5-122B-A10B-AWQ-4bit"; }
  ];
in
{
  imports = [ ./hardware-configuration.nix ];

  # 1. Bootloader & Strix Halo (128GB RAM) Kernel Tuning
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # Reserve ~124GB of unified system RAM for the gfx1151 iGPU
  boot.kernelParams = [
    "amd_iommu=off"
    "amdgpu.gttsize=126976"
    "ttm.pages_limit=32505856"
  ];

  # MediaTek MT7925 WiFi (fallback link, see NetworkManager below): udev's
  # automatic module loading has been unreliable for this device on this
  # board, so force it explicitly rather than depend on autodetection.
  boot.kernelModules = [ "mt7925e" ];

  # This box defaulted to the "powersave" cpufreq governor on all 32 threads
  # (confirmed via /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor —
  # running at ~1.6-1.8GHz against a CPU that boosts past 5GHz). For a
  # dedicated inference server this directly hurts the CPU-bound parts of the
  # request path (tokenization, scheduling, Python overhead) — force
  # "performance" instead. Driver is amd-pstate-epp, which supports this.
  powerManagement.cpuFreqGovernor = "performance";

  # 2. System State & Headless Mode
  systemd.defaultUnit = "multi-user.target";
  networking.hostName = "local-ai-machine";
  services.openssh.enable = true;
  # Fully declarative user management: without this, NixOS only sets a
  # password hash the first time a user account is created and silently
  # leaves existing accounts alone on later activations (bit us directly —
  # chris's password never applied across repeated installs on the same disk).
  users.mutableUsers = false;

  # Passwordless sudo scoped to this exact command + flake target only, not
  # a general wheelNeedsPassword=false. Note this is still effectively
  # root-equivalent in practice — nixos-rebuild switch runs arbitrary
  # root-level activation scripts by design — the scoping just prevents it
  # from being usable for other sudo commands, not from being a real
  # escalation vector via this one.
  security.sudo.extraRules = [
    {
      users = [ "chris" ];
      commands = [
        {
          # '#' must be escaped in sudoers syntax or everything after it is
          # silently treated as a comment, dropping the rule entirely (this
          # bit us: sudo -l showed no trace of the rule despite it being
          # textually present and unescaped in /etc/sudoers).
          command = "/run/current-system/sw/bin/nixos-rebuild switch --flake /etc/nixos\\#local-ai-machine";
          options = [ "NOPASSWD" ];
        }
      ];
    }
  ];

  # The router's own DNS resolver (192.168.1.1, picked up via DHCP) has been
  # intermittently timing out — root cause of a whole cascade of "transient"
  # download failures blamed on hf-xet/network flakiness. Confirmed via
  # direct testing: raw connectivity and DNS against 1.1.1.1 both work fine,
  # only the router's resolver hangs. Router stays primary (keeps local/mDNS
  # resolution working); public resolvers are listed after it as fallback —
  # glibc's stub resolver tries each nameserver in order per query, so a
  # timeout on the first one still falls through to the next within the same
  # lookup, not just after some longer-term health check.
  #
  # `networking.networkmanager.dns = "none"` is required for the above to
  # actually take effect: NetworkManager manages /etc/resolv.conf itself by
  # default and silently ignores networking.nameservers otherwise (confirmed
  # — the first attempt at this fix had zero effect on the live resolv.conf).
  # "none" hands resolv.conf back to resolvconf, which does honor it.
  networking.nameservers = [ "192.168.1.1" "1.1.1.1" "8.8.8.8" ];
  networking.networkmanager.dns = "none";

  # NetworkManager: prefers wired automatically when a cable is present,
  # falls back to WiFi otherwise (useful during bring-up and for occasional
  # relocation before the final wired connection is in place).
  networking.networkmanager = {
    enable = true;
    ensureProfiles = {
      environmentFiles = [ /etc/nixos/secrets/wifi.env ];
      profiles = {
        fallback-wifi = {
          connection = {
            id = "fallback-wifi";
            type = "wifi";
          };
          wifi = {
            ssid = "$WIFI_SSID";
          };
          wifi-security = {
            key-mgmt = "wpa-psk";
            psk = "$WIFI_PSK";
          };
          ipv4.method = "auto";
          ipv6.method = "auto";
        };
      };
    };
  };

  # mDNS hostname discovery (local-ai-machine.local). Restricted to the
  # wired interface only, so it always resolves to the Ethernet IP rather
  # than racing with the WiFi fallback address.
  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
    };
    allowInterfaces = [ "eno1" ];
  };

  # 3. User & Hardware Access Groups
  users.users.chris = {
    isNormalUser = true;
    openssh.authorizedKeys.keys = [
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC7TiUpo8R96lRHqOBgZ+fnKrvG5kxZyfJBaGTzVzI1KM1jApEm63FxqUpkpEv+5QOHZ/psMZ2UwCwOPlIdp2+SXy6TvIfLGIYE+fgcDSeXHf8idlcMDgmo85aTQOr+RI2nH3Nhm5MPwRxH2HkDYpNEVmol7UQEwbRKXV/Do05z6V2+e2LBcbUri8ZfyumGsdGOiDs9l5WKHuZ7qJqAYxgwpxYDNlocNSdMKFHTI0S8kD5HsaxY0sHMM35hCJGt5A7YLnil0bFsgLkH+DyLnGVPCPhzj4UJh6mIHd/HW1Reh9pPLeVsTKLaCYGRpkMoTXA5FnBeoGHiZPDCuZwmv7De6t63Kd9QB4EQSjSsDKQeeTS/6uCX8T0qqK04rapL1rt18eRPqUisMup7pLJDC4WiCLy18dckBW7NXo1OzKFx46yrcs9V8TtI3gKJTWs6gaOpmlCnGXxN4xlJ2Y1TalsXlpxOfg9f1KQUCuSFTGjD7eZnhgo9rkO38FV4V3PKuUdRrvMxo6w7OKMh2R2/5b7J+2fnqrwsDYnMPZfW2546L35W3XbPOWqDVbZabpSa17Pe++lHgCkanPVLiCAoD+tzQ+pCmIIr8jO47LRKdJZ+1FAREL36kyAcJfLUbc1TOFWb4wZnUUC1uq4q0nWSmpFN5KpvVmwB5XATymSX8KpMEw== chrisjohnson@Mac.localdomain"
    ];
    extraGroups = [ "wheel" "docker" "render" "video" "networkmanager" ];
    # Local console fallback only — SSH is locked to key auth below, so this
    # password can't be used remotely, only at a physical/KVM login prompt.
    hashedPasswordFile = "/etc/nixos/secrets/chris-password-hash.txt";
  };

  services.openssh.settings.PasswordAuthentication = false;

  # Unprivileged friend/edge account. No SSH key wired up yet — public keys
  # aren't secrets, so when drew's key is available it goes straight into
  # authorizedKeys.keys as a string literal, same as chris's above, not
  # into secrets/. Until then this account exists but nothing can log into it.
  users.users.drew = {
    isNormalUser = true;
    extraGroups = [ "docker" ];
  };

  # 4. Containers & ROCm Graphics Passthrough
  virtualisation.docker = {
    enable = true;
    autoPrune.enable = true;
  };

  hardware.graphics.enable = true;

  # Model weights directory, declared rather than created imperatively so it
  # survives a reinstall with correct ownership — matches docker-compose's
  # /var/lib/ai-models:/models mount.
  systemd.tmpfiles.rules = [
    "d /var/lib/ai-models 0755 chris users - -"
  ];

  # huggingface_hub tuning: hf-xet (the newer accelerated transfer backend)
  # hangs repeatedly on this network path — disabling it and falling back to
  # plain HTTP fixed multi-hour stalls during model downloads. Not secrets,
  # so these live directly in tracked config.
  environment.variables = {
    HF_HUB_DISABLE_XET = "1";
    HF_HUB_DOWNLOAD_TIMEOUT = "120";
    HF_HUB_ETAG_TIMEOUT = "900";
  };

  # HF_TOKEN is a secret, so it's sourced from a gitignored file at shell
  # login rather than set directly here (environment.variables would land
  # in the world-readable Nix store).
  environment.etc."profile.d/hf-token.sh".text = ''
    if [ -f /etc/nixos/secrets/hf-token.env ]; then
      set -a
      . /etc/nixos/secrets/hf-token.env
      set +a
    fi
  '';

  # 5. Synology NAS Backup Transport
  # rocm-smi is a CLI monitoring tool, not a driver — belongs on PATH via
  # systemPackages, not hardware.graphics.extraPackages (that's for driver
  # libraries the graphics stack loads, not user-facing commands).
  #
  # amdgpu_top over rocm-smi for anything memory-related: rocm-smi's VRAM
  # metric only reports the tiny 1GB static BIOS carve-out on this APU, not
  # the ~124GB GTT/unified-memory pool actually in use (confirmed directly —
  # rocm-smi showed 208MB used while docker/vLLM's own logs showed tens of
  # GB actually allocated). amdgpu_top reads GTT correctly. nvtopPackages.amd
  # included too as a more familiar UI for the same underlying data.
  environment.systemPackages = with pkgs; [
    rsync docker-compose git rocmPackages.rocm-smi herdr htop amdgpu_top nvtopPackages.amd
    # Common shell tools. Note: "yq" here is nixpkgs' classic Python/jq-wrapper
    # variant, not the more commonly-used Go rewrite (that's yq-go) — swap if
    # that's actually what's wanted. "nc" comes from netcat-gnu; "dig" from
    # dnsutils; "netstat" from net-tools.
    jq ripgrep yq zsh vim asdf-vm fzf fd netcat-gnu dnsutils curl lsof net-tools
  ];

  # Herdr agent-multiplexer daemon (per-user, persists across SSH
  # disconnects). One instance per user — chris's for now, drew's own
  # instance would come from the same systemd.user mechanism once that
  # account has SSH access.
  systemd.user.services.herdr = {
    description = "Herdr Agent Multiplexer Daemon";
    wantedBy = [ "default.target" ];
    serviceConfig = {
      ExecStart = "${pkgs.herdr}/bin/herdr daemon";
      Restart = "always";
    };
  };

  # 6. Automated Daily Rsync Mirror to Synology (native rsync-over-SSH, not
  # CIFS — simpler and more standard for this workload; auth is an SSH key
  # for ai_backup_svc, not an SMB password).
  # Unencrypted by design (NAS is a trusted walled garden; use whole-disk
  # encryption on the NAS itself if that's ever needed). Versioning/point-in-time
  # recovery is handled by DSM's own Btrfs snapshot scheduler on the backups
  # share, not by this job — this just mirrors current state.
  # NAS-side path: /volume1/tank/backups/local-ai-machine
  #
  # Model Downloads — declared here (not run manually over SSH) so a freshly
  # flashed machine reaches a fully working state from `nixos-rebuild switch`
  # alone. Each service is idempotent via a completion marker file, not just
  # "does the directory exist" — a partial/interrupted download would
  # otherwise look done on the next boot and never retry. Reuses the exact
  # HF_HUB_DISABLE_XET / timeout env vars and `nix shell ... hf download`
  # invocation already proven to work reliably on this network path.
  systemd.services = let
    mkModelDownloadService = { name, repo }: {
      description = "Download ${repo} to /var/lib/ai-models/${name}";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      # Deliberately NOT wantedBy multi-user.target — that target is already
      # active on a running system, so nixos-rebuild switch would try to
      # START this directly as part of activation and block until a
      # multi-hour download finishes. Triggered by its own .timer instead
      # (below), which arms near-instantly regardless of how long the
      # actual download takes — decouples this from every future rebuild's
      # critical path, not just from restarts of an already-running one
      # (that's what restartIfChanged handles).
      unitConfig.ConditionPathExists = "!/var/lib/ai-models/${name}/.download-complete";
      # Multi-hour, multi-GB downloads over this network path have already
      # shown one transient mid-stream socket error (httpx.ReadError after
      # 39min/36GB) — `hf download --local-dir` resumes from its own cache on
      # retry, so auto-restarting is both safe and necessary: without it, a
      # blip anywhere in a multi-hour transfer needs a manual `sudo systemctl
      # restart`, and the sudo rule below is deliberately scoped to just
      # `nixos-rebuild switch`, not systemctl.
      startLimitIntervalSec = 0;
      # Without this, `nixos-rebuild switch` restarts ANY unit whose
      # definition changed — including this one, every time the shared
      # download-script logic changes, even for edits unrelated to whichever
      # download happens to be mid-transfer. For a oneshot this restart
      # blocks the whole switch-to-configuration run until the (re-started,
      # from-scratch-looking-but-actually-resuming) download finishes —
      # this is exactly what turned several unrelated pushes today into
      # 15-40 minute stalls. false means: update the unit file on disk, but
      # don't touch an already-running instance — the new definition takes
      # effect next time it starts (next boot, or its own next retry).
      restartIfChanged = false;
      serviceConfig = {
        Type = "oneshot";
        User = "chris";
        EnvironmentFile = "-/etc/nixos/secrets/hf-token.env";
        Restart = "on-failure";
        RestartSec = 30;
      };
      script = ''
        set -euo pipefail
        export HF_HUB_DISABLE_XET=1
        export HF_HUB_DOWNLOAD_TIMEOUT=120
        export HF_HUB_ETAG_TIMEOUT=900
        DEST=/var/lib/ai-models/${name}
        set +e
        ${pkgs.nix}/bin/nix --extra-experimental-features "nix-command flakes" shell nixpkgs#python3Packages.huggingface-hub \
          --command hf download ${repo} --local-dir "$DEST"
        HF_EXIT=$?
        set -e

        # hf download's own exit code is NOT reliable evidence of completeness.
        # Two real failure modes observed on this exact box in one afternoon:
        # (1) it can exit 0 with shards still missing after a resume-state race
        #     from an auto-restart killing a prior attempt mid-transfer;
        # (2) when the network is unreachable (this box's router DNS resolver
        #     has intermittently timed out — see networking.nameservers above),
        #     it prints "Returning existing local_dir ... as remote repo cannot
        #     be accessed" and exits 0 anyway, treating "couldn't check" as
        #     success. So: don't trust $HF_EXIT alone, and don't skip
        #     verification just because it was 0.
        #
        # Most robust, format-agnostic signal: hf's own per-file .incomplete
        # markers under the download cache. A file only loses its .incomplete
        # suffix once fully fetched and etag-verified, so this catches
        # truncated/partial files too, not just missing ones — and works for
        # single-file models that have no shard manifest to diff against.
        incomplete=$(find "$DEST/.cache/huggingface/download" -name '*.incomplete' 2>/dev/null || true)
        if [ -n "$incomplete" ]; then
          echo "Incomplete download, unfinished file(s):" >&2
          echo "$incomplete" >&2
          exit 1
        fi

        # Belt-and-suspenders for sharded models: cross-check the model's own
        # manifest, in case a shard is fully absent (no .incomplete residue at
        # all — e.g. hf never attempted it this run because it thought the
        # existing local_dir was already fine per failure mode (2) above).
        INDEX="$DEST/model.safetensors.index.json"
        if [ -f "$INDEX" ]; then
          missing=""
          for f in $(grep -o 'model-[0-9]*-of-[0-9]*\.safetensors' "$INDEX" | sort -u); do
            [ -f "$DEST/$f" ] || missing="$missing $f"
          done
          if [ -n "$missing" ]; then
            echo "Incomplete download, missing shards:$missing" >&2
            exit 1
          fi
        fi

        if [ "$HF_EXIT" -ne 0 ]; then
          echo "hf download exited $HF_EXIT but file-level checks found nothing missing; treating as success" >&2
        fi
        touch "$DEST/.download-complete"
      '';
    };
  in (lib.listToAttrs (map (m: {
    name = "download-model-${m.name}";
    value = mkModelDownloadService m;
  }) models)) // {
    # Closes the last "100% bootstrap from a wipe" gap: everything else
    # (NixOS itself, model downloads) is declarative and self-triggering,
    # but nothing previously ran `docker compose up -d` on a genuinely fresh
    # install — the containers had never been created, so there was nothing
    # for docker's own `restart: unless-stopped` policies to reattach to.
    # docker/.env is gitignored (real secrets, never auto-generated) — this
    # fails loudly with a clear message rather than silently no-op'ing if
    # it's missing, so the one remaining manual step is obvious, not hidden.
    #
    # Waits for every model's completion marker directly in-script, rather
    # than expressing that as systemd after=/wants= on the download units.
    # Those units retry indefinitely on failure (Restart=on-failure,
    # startLimitIntervalSec=0), and ordering against a unit like that only
    # guarantees "its most recent attempt exited" — not "eventually
    # succeeded". A failed attempt between retries would satisfy After=
    # ordering prematurely and let this start with weights still missing.
    # Polling the same marker files the downloads already produce for their
    # own idempotency sidesteps that entirely.
    docker-compose-app = {
      description = "Start local-ai-machine docker-compose application stack";
      after = [ "docker.service" "network-online.target" ];
      wants = [ "docker.service" "network-online.target" ];
      # Timer-triggered, not wantedBy multi-user.target — same reasoning as
      # the download services above: this can block for a long time waiting
      # on the marker-poll loop below, and multi-user.target is already
      # active on a running system, so a direct wantedBy would make
      # nixos-rebuild switch block starting it synchronously.
      restartIfChanged = false;
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "chris";
        WorkingDirectory = "/home/chris/local-ai-machine/docker";
        Restart = "on-failure";
        RestartSec = 60;
      };
      script = ''
        set -euo pipefail
        ${lib.concatMapStringsSep "\n" (m: ''
          until [ -f /var/lib/ai-models/${m.name}/.download-complete ]; do
            echo "Waiting on ${m.name} download to complete..."
            sleep 30
          done
        '') models}
        if [ ! -f .env ]; then
          echo "docker/.env is missing. Secrets are gitignored and never auto-generated — copy .env.example to .env, populate real values, then run: systemctl start docker-compose-app" >&2
          exit 1
        fi
        ${pkgs.docker}/bin/docker compose up -d
      '';
    };

    synology-backup = {
      description = "Mirror local AI state to Synology NAS";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig.Type = "oneshot";
      script = let
        rsh = "${pkgs.openssh}/bin/ssh -i /etc/nixos/secrets/synology_backup_key -o StrictHostKeyChecking=accept-new";
        remote = "ai_backup_svc@synology.local:/volume1/tank/backups/local-ai-machine";
      in ''
        set -euo pipefail
        ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /var/lib/docker/volumes/turnstone_postgres_data/ "${remote}/turnstone_postgres_data/"
        ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /home/chris/.hermes/ "${remote}/hermes/"
        ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /home/chris/.herdr/ "${remote}/herdr/"
        ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /etc/nixos/ "${remote}/etc-nixos/"
        ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /home/chris/local-ai-machine/ "${remote}/repo/"
      '';
    };
  };

  # Triggers for the model downloads and docker-compose-app (see
  # systemd.services above for why these are timer-triggered rather than
  # wantedBy multi-user.target: arming a timer is near-instant regardless of
  # how long the thing it triggers takes, so `nixos-rebuild switch` never
  # blocks on it — only the first START of a brand-new long-running unit
  # was ever a problem, and this sidesteps that class of problem entirely,
  # not just the "restarting an already-running one" class that
  # restartIfChanged handles.
  systemd.timers = (lib.listToAttrs (map (m: {
    name = "download-model-${m.name}";
    value = {
      description = "Trigger for download-model-${m.name}.service";
      wantedBy = [ "timers.target" ];
      timerConfig.OnBootSec = "30s";
    };
  }) models)) // {
    docker-compose-app = {
      description = "Trigger for docker-compose-app.service";
      wantedBy = [ "timers.target" ];
      timerConfig.OnBootSec = "45s";
    };
    synology-backup = {
      description = "Daily Synology backup mirror";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = "03:00";
        Persistent = true;
      };
    };
  };

  # Firewall Rules — 8080 (Turnstone, plain HTTP for now — no Caddy/TLS
  # sidecar deployed yet, see docker-compose.yml), 11434 (Ollama sandbox,
  # not yet running but staged), 3001 (Open WebUI chat interface) alongside
  # SSH/LiteLLM/Grafana/Prometheus.
  # 8443 dropped: that's Turnstone's upstream Caddy-fronted HTTPS dashboard
  # port, which we don't run — nothing listens there in this first pass.
  #
  # Deliberately NOT listing 8000/8001 (raw vLLM, zero auth) — LiteLLM on
  # 4000 is the intended authenticated gateway to those models; direct
  # access is host-local only (docker exec / vllm bench serve), never meant
  # to be reachable on the LAN.
  #
  # filterForward is required for allowedTCPPorts to mean anything for
  # docker-published ports at all: Docker manages its own FORWARD-chain
  # iptables rules, which by default bypass NixOS's firewall entirely for
  # NAT'd container traffic. Confirmed directly — port 8000 (never in this
  # list) was externally reachable regardless, meaning every container port
  # published via docker-compose has been open on the LAN all session,
  # irrespective of what's declared here. This makes allowedTCPPorts
  # actually apply to Docker's forwarded traffic too.
  # filterForward only exists on the nftables-based firewall backend (the
  # classic iptables one doesn't support it at all — confirmed by a hard
  # eval failure) — no custom iptables rules/extraCommands anywhere in this
  # config, so switching backends is low-risk.
  networking.nftables.enable = true;
  networking.firewall.filterForward = true;
  networking.firewall.allowedTCPPorts = [ 22 4000 8080 3000 3001 9090 11434 ];

  system.stateVersion = "24.11";
}
```

**New service: `docker-compose-app`.** Closes the last "100% bootstrap from a wipe" gap — previously nothing ran `docker compose up -d` on a fresh install; the model-download automation existed, but nothing then brought the application stack itself up. Now declarative and timer-triggered, it waits for every model's `.download-complete` marker (see reasoning above), and fails loudly with a clear message if `docker/.env` is missing rather than silently no-op'ing — secrets stay gitignored and are never auto-generated, so this remains the one genuinely irreducible manual step for a fresh bootstrap.

---

## 4. Containerized Runtime Stack (`docker/docker-compose.yml`)

Deployed model set: **Qwen3.6-35B-A3B** (bf16, primary) + **Qwen3.5-4B** (judge/quick tasks), served by the two vLLM containers below. **Qwen3-Coder-Next-GPTQ-4bit** (80B total/3B active) is downloaded and was benchmarked against the primary tier (`docs/benchmark-report-2026-07-22.html`) but is not wired into compose as a standing service — it was swapped in temporarily in place of the primary container for the benchmark run and is not currently running. **`cyankiwi/Qwen3.5-122B-A10B-AWQ-4bit`** (100B+ tier) is currently downloading and has no compose entry yet either. This is a deliberate narrowing from a broader model exploration — see Section 3 for the full list of downloaded, downloading, and confirmed-but-not-yet-queued candidates, and the reasoning for each. Vision (Qwen2.5-VL-7B) and the Ollama sandbox still aren't wired into compose since neither is staged on disk yet.

**The primary model changed mid-stream, same day, from Qwen3-Coder-Next-FP8 to Qwen3.6-35B-A3B — a real finding, not a whim.** gfx1151 (Strix Halo, RDNA3.5) has **no FP8 matrix-core hardware at all** — AMD's own GPUOpen docs show FP8 WMMA support starting at RDNA4, and gfx1151 predates that generation. Real-world reports confirm Qwen3-Next-family FP8 checkpoints fail to load or stall on this exact toolbox+hardware combination (not just run slow): `kyuz0/amd-strix-halo-vllm-toolboxes` GitHub issue #1 (maintainer: "I think FP8 won't work unfortunately, the other FP8 models didn't"), `vllm-project/vllm` issue #40934 (fp8 + qwen3_next hybrid architecture failing even on NVIDIA), and the independent `hec-ovi/vllm-awq4-qwen` project explicitly choosing AWQ-INT4 over FP8 for this exact hardware family. A plain BF16 release of Qwen3-Coder-Next is ~160GB — too large for the 124GB GPU memory allocation regardless of the FP8 issue.

**Qwen3.6-35B-A3B was chosen instead:** it's proven working (both bf16 and a community AWQ-4bit quant) on this exact toolbox/hardware per the toolbox's own `models.py` MODEL_TABLE, and independently benchmarks *ahead* of gpt-oss-120b on coding (leads by 11.5 points on artificialanalysis.ai's coding index) despite being a third the size — the best available "local Sonnet" fit for this hardware, not just the safe fallback. Note: Qwen3-Next's architecture (which both models share) has a native MTP (multi-token-prediction) speculative-decoding head, and vLLM has a `qwen3_next_mtp` method for it — but it is NOT confirmed working on ROCm yet (open, unresolved toolbox issue #53 as of this investigation), so it's not enabled. The old `qwen3-coder-next-fp8` download (~75GB) is still sitting on disk at `/var/lib/ai-models/qwen3-coder-next-fp8` on the target machine, orphaned (no longer referenced by any config) — worth a one-line cleanup item, not deleted yet.

**Other corrections made versus the original design draft, all load-bearing:**
1. **vLLM needs native format, not GGUF.** GGUF is llama.cpp's format; vLLM's GGUF support is limited/experimental and unlikely to handle a brand-new hybrid-MoE architecture well.
2. **LiteLLM virtual keys aren't declared in `config.yaml`.** They're persisted in Postgres and generated at runtime via the `/key/generate` API against the master key (Task 3.6) — a static `keys:` YAML block (present in the original draft) isn't valid LiteLLM schema and would have silently done nothing.
3. **Two Docker image references were hallucinated and got caught only by actually running `docker compose up -d`** (it failed with a real pull-access-denied error — not caught in review):
   - `kyuz0/amd-strix-halo-vllm:latest` doesn't exist on Docker Hub → real image is `docker.io/kyuz0/vllm-therock-gfx1151:latest` (from `kyuz0/amd-strix-halo-vllm-toolboxes`). It has no ENTRYPOINT and puts `vllm` on PATH via `/opt/venv`, so `docker run <image> vllm serve ...` works headless directly — no need for the project's interactive toolbox/distrobox wizard flow.
   - `turnstonelabs/turnstone:latest` doesn't exist on Docker Hub → real image is `ghcr.io/turnstonelabs/turnstone:latest` (GitHub Container Registry).
4. **vllm-primary/vllm-judge:** removed `ROCM_PATH`/`HSA_OVERRIDE_GFX_VERSION` env vars (not needed — baked into the image at build time for gfx1151); added `ipc: host`; added named cache volumes (`vllm_primary_cache`, `vllm_judge_cache` → `/root/.cache/vllm`); split `--gpu-memory-utilization` 0.70 (primary) / 0.20 (judge) since both vLLM processes share one physical GPU and vLLM's percentage is computed against *total* device memory, not what's already free (two processes at the old 0.90 each would OOM the second on startup); added `--tensor-parallel-size 1`, `--dtype auto`, `--trust-remote-code`, `--max-num-seqs 64` (mirroring the toolbox's own proven flag set for this exact model, not reinvented).
5. **turnstone/turnstone-db:** postgres image changed from generic `postgres:16-alpine` to `pgautoupgrade/pgautoupgrade:18-alpine` (Turnstone's own upstream compose choice — handles major-version PG upgrades without manual dump/restore). Env vars corrected to real names verified against Turnstone's actual docs (`docs/docker.md` at `github.com/turnstonelabs/turnstone`): `TURNSTONE_JWT_SECRET` (new secret, generated via `openssl rand -hex 32`, added to `docker/.env` and `docker/.env.example`), `TURNSTONE_DB_BACKEND=postgresql`, `TURNSTONE_DB_URL` (not `DATABASE_URL`), `LLM_BASE_URL=http://litellm:4000/v1`, `OPENAI_API_KEY=${LITELLM_MASTER_KEY}` (not the docs' example "dummy" value — LiteLLM requires real bearer auth). Removed the `./turnstone/config.yaml:/etc/turnstone/config.yaml` bind mount entirely — wrong format (Turnstone uses TOML at `~/.config/turnstone/config.toml`, chmod 0600, not YAML at `/etc/turnstone/`) and that file never actually existed on disk anyway (`docker/turnstone/` doesn't exist in the repo). There is no env-var way to wire in a separate judge/reranker model in Turnstone — that's TOML-config/console-UI only, genuinely deferred remaining work for Task 3.5, not just plumbing that got skipped. Dropped port 8443 entirely for now (Turnstone's Caddy-fronted HTTPS dashboard port upstream; no Caddy sidecar is deployed in this stack) — Turnstone runs plain HTTP on 8080 only, acceptable on the trusted home LAN for this first pass.

```yaml
version: '3.8'

services:
  # Primary: Qwen3.6-35B-A3B (bf16, MoE). NOT Qwen3-Coder-Next-FP8 — gfx1151
  # (RDNA3.5) has no FP8 matrix-core hardware at all, and every real-world
  # report of Qwen3-Next-family FP8 checkpoints on this exact toolbox/hardware
  # fails to load or stalls (see git history for the full investigation).
  # Qwen3.6-35B-A3B is proven working at bf16 here via this exact toolbox's
  # own model table, and benchmarks ahead of gpt-oss-120b on coding despite
  # being a third the size. Flags below mirror that proven table entry
  # (max_num_seqs 64, qwen3_coder tool parser, qwen3 reasoning parser),
  # not reinvented from scratch.
  #
  # Image: docker.io/kyuz0/vllm-therock-gfx1151 (NOT kyuz0/amd-strix-halo-vllm,
  # which doesn't exist — that was a bad reference caught when `docker compose
  # up` failed with a pull error). This image has no ENTRYPOINT and puts vllm
  # on PATH via /opt/venv, so `vllm serve ...` runs headless exactly like this
  # without needing the project's interactive toolbox/distrobox flow.
  # gpu-memory-utilization is split between primary/judge (0.70/0.20) since
  # both share one physical GPU and vLLM's percentage is computed against
  # total device memory, not what's already free — two processes at 0.90 each
  # would have the second OOM on startup.
  vllm-primary:
    image: docker.io/kyuz0/vllm-therock-gfx1151:latest
    container_name: vllm-primary
    restart: unless-stopped
    devices:
      - /dev/kfd:/dev/kfd
      - /dev/dri:/dev/dri
    group_add:
      - video
      - render
    security_opt:
      - seccomp:unconfined
    ipc: host
    volumes:
      - /var/lib/ai-models:/models
      - vllm_primary_cache:/root/.cache/vllm
    command: >
      vllm serve /models/qwen3.6-35b-a3b
      --served-model-name qwen3.6-35b-a3b
      --host 0.0.0.0
      --port 8000
      --tensor-parallel-size 1
      --gpu-memory-utilization 0.70
      --dtype auto
      --trust-remote-code
      --max-num-seqs 64
      --enable-prefix-caching
      --max-model-len 131072
      --enable-auto-tool-choice
      --tool-call-parser qwen3_coder
      --reasoning-parser qwen3
    ports:
      - "8000:8000"

  # Judge / quick-tasks: Qwen3.5-4B (BF16, tiny footprint). Same Qwen
  # tokenizer/tool-call format as the primary slot for consistent behavior
  # when Turnstone routes governed calls through it.
  vllm-judge:
    image: docker.io/kyuz0/vllm-therock-gfx1151:latest
    container_name: vllm-judge
    restart: unless-stopped
    devices:
      - /dev/kfd:/dev/kfd
      - /dev/dri:/dev/dri
    group_add:
      - video
      - render
    security_opt:
      - seccomp:unconfined
    ipc: host
    volumes:
      - /var/lib/ai-models:/models
      - vllm_judge_cache:/root/.cache/vllm
    command: >
      vllm serve /models/qwen3.5-4b
      --served-model-name qwen3.5-4b-judge
      --host 0.0.0.0
      --port 8001
      --tensor-parallel-size 1
      --gpu-memory-utilization 0.20
      --dtype auto
      --trust-remote-code
      --max-num-seqs 64
      --enable-prefix-caching
      --max-model-len 131072
      --enable-auto-tool-choice
      --tool-call-parser qwen3_coder
      --reasoning-parser qwen3
    ports:
      - "8001:8001"

  # Unified API Gateway
  # Virtual keys (sk-chris-master, sk-drew-edge, etc.) are NOT declared in
  # config.yaml — LiteLLM persists them in Postgres and they're generated
  # at runtime via the /key/generate API (Task 3.6), not static YAML.
  litellm-db:
    image: postgres:16-alpine
    container_name: litellm-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: litellm
      POSTGRES_USER: litellm_user
      POSTGRES_PASSWORD: ${LITELLM_DB_PASSWORD}
    volumes:
      - litellm_postgres_data:/var/lib/postgresql/data

  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: litellm-proxy
    restart: unless-stopped
    ports:
      - "4000:4000"
    volumes:
      - ./litellm/config.yaml:/app/config.yaml
    environment:
      - LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DATABASE_URL=postgresql://litellm_user:${LITELLM_DB_PASSWORD}@litellm-db:5432/litellm
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    depends_on:
      - litellm-db
      - vllm-primary
      - vllm-judge

  # Turnstone Database & Governance Server.
  # Image/env corrected against turnstonelabs/turnstone's actual docs —
  # turnstonelabs/turnstone:latest doesn't exist on Docker Hub; the real
  # image is ghcr.io/turnstonelabs/turnstone. Config is TOML at
  # ~/.config/turnstone/config.toml (0600), not a mounted config.yaml — no
  # such file existed on disk anyway, so the old bind mount would have
  # silently created an empty directory rather than erroring.
  # turnstone-db uses pgautoupgrade (Turnstone's own upstream compose choice,
  # not plain postgres) so future major-version Postgres upgrades don't
  # require a manual dump/restore.
  turnstone-db:
    image: pgautoupgrade/pgautoupgrade:18-alpine
    container_name: turnstone-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: turnstone
      POSTGRES_USER: turnstone
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - turnstone_postgres_data:/var/lib/postgresql/data

  # No TLS/Caddy sidecar yet — this is plain HTTP on 8080 for now (fine on
  # the trusted home LAN), not the HTTPS-only 8443 dashboard the upstream
  # prod stack normally fronts with Caddy. Judge/reranker role assignment
  # (wiring vllm-judge in as Turnstone's safety judge) has no env-var
  # equivalent — it's TOML/console-UI only, so that's real remaining work
  # for Task 3.5, not just plumbing.
  turnstone:
    image: ghcr.io/turnstonelabs/turnstone:latest
    container_name: turnstone-server
    restart: unless-stopped
    command: ["turnstone-server", "--host", "0.0.0.0", "--port", "8080"]
    ports:
      - "8080:8080"
    environment:
      TURNSTONE_JWT_SECRET: ${TURNSTONE_JWT_SECRET}
      TURNSTONE_DB_BACKEND: postgresql
      TURNSTONE_DB_URL: postgresql+psycopg://turnstone:${DB_PASSWORD}@turnstone-db:5432/turnstone
      LLM_BASE_URL: http://litellm:4000/v1
      OPENAI_API_KEY: ${LITELLM_MASTER_KEY}
    depends_on:
      - turnstone-db
      - litellm

  # Telemetry & Observability Stack
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./grafana/dashboards:/var/lib/grafana/dashboards
    depends_on:
      - prometheus

  # Browser chat UI — points at LiteLLM's unified OpenAI-compatible endpoint
  # rather than any vLLM server directly, so every model alias (coder/judge/
  # governed_coder) is reachable from one place without per-model wiring.
  # Port 3001 (not 8080, which Turnstone already owns) — kept in the 3xxx
  # range alongside Grafana as the other human-facing web UI, distinct from
  # the 8xxx/4000 API ports.
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    restart: unless-stopped
    ports:
      - "3001:8080"
    environment:
      - OPENAI_API_BASE_URL=http://litellm:4000/v1
      - OPENAI_API_KEY=${LITELLM_MASTER_KEY}
      - WEBUI_AUTH=true
    volumes:
      - open_webui_data:/app/backend/data
    depends_on:
      - litellm

volumes:
  turnstone_postgres_data:
  litellm_postgres_data:
  vllm_primary_cache:
  vllm_judge_cache:
  open_webui_data:
```

**New service: `open-webui`.** The first browser-based chat interface in the whole stack — previously only raw API endpoints existed. `ghcr.io/open-webui/open-webui:main`, port `3001` (not `8080`, which Turnstone already owns), pointed at LiteLLM's unified OpenAI-compatible endpoint (`http://litellm:4000/v1`) rather than any vLLM server directly, so every model alias (`coder`/`judge`/`governed_coder`) is reachable from one UI without per-model wiring. No bind-mounted config — it's entirely env-var driven, with its own state (auth, chat history) in the `open_webui_data` named volume.

---

## 5. Gateway Configuration (`docker/litellm/config.yaml`)

```yaml
model_list:
  # Primary coder
  - model_name: coder
    litellm_params:
      model: openai/qwen3.6-35b-a3b
      api_base: http://vllm-primary:8000/v1
      api_key: "none"

  # Judge / fast quick-task model
  - model_name: judge
    litellm_params:
      model: openai/qwen3.5-4b-judge
      api_base: http://vllm-judge:8001/v1
      api_key: "none"

  # Governed route (passes through Turnstone's safety judge)
  - model_name: governed_coder
    litellm_params:
      model: openai/coder
      api_base: http://turnstone:8080/v1
      api_key: "none"

  # Cloud fallback route if local GPU is saturated
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-3-5-sonnet-20241022
      api_key: os.environ/ANTHROPIC_API_KEY

router_settings:
  routing_strategy: usage-based-routing-v2

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL

# Virtual keys (sk-chris-master, sk-drew-edge) are generated at runtime via
# the /key/generate API against the master key, not declared here — see
# Task 3.6 for the actual generation + verification steps.
```

No `vision` route yet — that comes back once a vision/OCR model is actually downloaded (Qwen2.5-VL-7B-Instruct was the pick from the earlier model research, still pending).

---

## 6. Hermes Config & Sub-Agent Delegation Rules (`~/.hermes/USER.md`)

```markdown
# Hermes Delegation & Governance Policy

### Provider Routes
- Default Provider: `bosgame_direct` (http://litellm:4000/v1) for chat, session memory search, and read-only queries.
- Governed Provider: `bosgame_governed` (http://turnstone:8080/v1) for autonomous background sub-agents.

### Automatic Sub-Agent Rules
When prompted for multi-file software engineering, build executions, or shell modifications:
1. Do NOT execute destructive commands directly in the parent context.
2. Invoke `delegate_task` with `model="governed_coder"` and target directory set to active project workspace.
3. Spawn a dedicated Herdr pane via socket API (`/run/user/1000/herdr.sock`) if live human visibility is required.
4. Report back completion summary and git diff to the active Telegram Topic thread.
```

---

## 7. Comprehensive Component Matrix

| Tier | Component | Role / Function | Connectivity / Endpoint |
| :--- | :--- | :--- | :--- |
| **Compute** | **vLLM Primary** | Qwen3.6-35B-A3B (bf16) coder slot (`--tool-call-parser qwen3_coder`) | `http://localhost:8000/v1` (not LAN-exposed — see Section 3 firewall notes) |
| **Compute** | **vLLM Judge** | Qwen3.5-4B — quick tasks and Turnstone safety judge | `http://localhost:8001/v1` (not LAN-exposed) |
| **Compute** | **vLLM (benchmarked, not standing)** | Qwen3-Coder-Next-GPTQ-4bit (80B total/3B active) — downloaded, benchmarked against primary (`docs/benchmark-report-2026-07-22.html`), currently stopped, no compose entry | n/a |
| **Compute** | **100B+ candidate (downloading)** | `cyankiwi/Qwen3.5-122B-A10B-AWQ-4bit` — real single-GPU (TP=1) evidence found despite the toolbox's own stale "too big for single GPU" table comment; see Section 3 | n/a |
| **Compute** | **Ollama Sandbox** | Lazy-load testing for new model compositions — not yet wired into compose | `http://localhost:11434` |
| **Gateway** | **LiteLLM** | Virtual keys (`sk-chris`, `sk-drew`, generated via `/key/generate`, not static config), parallel tool passing | `http://localhost:4000/v1` |
| **Interface** | **Open WebUI** | Browser chat UI over LiteLLM's unified endpoint — first browser-based chat interface in the stack | `http://localhost:3001` |
| **Governance**| **Turnstone** | Empty model registry — judge/reranker role wiring still deferred (no env-var shortcut, needs TOML config or console UI work) | `http://localhost:8080` |
| **Control** | **Herdr Daemon** | PTY multiplexer, state tracking (`🔴 Blocked`, `🟡 Working`) | `/run/user/1000/herdr.sock` |
| **Control** | **Hermes Agent** | 24/7 Telegram topic router, profiles, memory, skills | Phone Telegram / Socket |
| **Execution** | **OpenCode** | LSP diagnostics, AST parsing, multi-file editing | Local Shell / Server Attach |
| **Execution** | **Claude Code** | Headless Auto Mode under Anthropic ML Classifier | Server Subshell / Herdr |
| **Execution** | **Pi Agent** | Ultra-minimal 4-tool primitive harness & TS extensions | Local Terminal / Herdr |
| **Telemetry** | **Prometheus** | Running, but no scrape target for either vLLM server; `litellm` target down; `node` target points at a nonexistent `node-exporter` container | `http://localhost:9090` |
| **Telemetry** | **Grafana** | Provisioned Prometheus datasource, real 10-panel dashboard, real admin password | `http://localhost:3000` |

---

## 8. Phased Implementation Roadmap

```mermaid
flowchart TD
    P1[Phase 1: Pre-Arrival GitOps Setup] --> P2[Phase 2: Day 0 Host Provisioning]
    P2 --> P3[Phase 3: Day 1 AI Stack Deployment]
    P3 --> P4[Phase 4: Observability]
    P4 --> P5[Phase 5: Model Research & Continuous Optimization]
    P5 --> P6[Phase 6: Multi-Tenant & Control Plane Verification]
    P6 --> P7[Phase 7: Review, Codify, Rebuild]
    P7 --> P8[Phase 8: Day-N Operations Documentation]
```

**Restructured 2026-07-23**: Phases 5, 6, and 7 are new. Turnstone, Herdr/Hermes, Drew's connectivity and remaining key generation, and the backup mirror test moved out of Phases 3/4 into Phase 6 — they're all "verify the multi-tenant/control-plane pieces" work, distinct from the ongoing model research/optimization effort. Phase 3 is now fully complete; Phase 4 is trimmed to just the Grafana/observability work. Phase 5 is where the in-progress benchmark→optimize→re-benchmark effort now lives, reframed as an open-ended loop rather than a one-time task list. **Phase 7 is now the true final phase**: a full audit cross-referencing everything done on the machine against this repo, then an actual wipe-and-rebuild to prove real reproducibility — this was the project's original stated end goal from early in the session, now formalized as its own phase.

### Phase 1: Pre-Arrival Preparation — COMPLETE

- [x] **Task 1.1: Git Repository Initialization**
- [x] **Task 1.2: Code Nix Flake Declarations**
- [x] **Task 1.3: Draft Docker Stack & Gateway Configs**
- [x] **Task 1.4: Prepare Synology NAS Target**
  Restricted service user `ai_backup_svc` created on Synology DSM with read/write access to the `tank` shared folder. Backups land under `tank/backups/local-ai-machine/` (nested by type). SSH enabled on the DSM, `secrets/synology_backup_key.pub` added as that user's authorized SSH key. Backup transport is rsync-over-SSH, not SMB.
- [x] **Task 1.5: Populate Local Secrets**
  `secrets/synology_backup_key`/`.pub` generated locally (gitignored). `secrets/wifi.env` populated with fallback SSID/password.

### Phase 2: Host Provisioning — COMPLETE

Real hardware bring-up surfaced several bugs not visible from the config alone — recorded here since they're exactly the kind of thing that bites again on a redeploy otherwise.

**Bootstrapping the install media — do it this way, not the naive way:**
0. **Kernel version matters before you even pick a channel.** The M5's MediaTek MT7925 WiFi chip (PCI `14c3:0717`) needs the `mt7925e` driver, which requires **Linux kernel ≥ 6.7**. NixOS 24.11's default kernel is 6.6.94 — just under the line, and the chip silently doesn't work (no `wlan0`-style interface at all, not an error you can debug from userspace). `nixos-unstable`'s default kernel (6.18 as of this bring-up) is comfortably newer. If this exact chip is involved again, start with the unstable channel's ISO rather than discovering the version mismatch the hard way.
1. **Download the full ISO and verify it before flashing.** A partial/interrupted download will still `dd` successfully and still boot far enough to look plausible, then fail confusingly mid-install. Always check the downloaded file's size against what the server reports (`curl -sIL <url> | grep content-length`) and compare a SHA-256 checksum against the official one before writing it anywhere.
2. **Use the BIOS's one-time Boot Override, not a permanent boot-order change.** Changing the persistent boot priority list works but leaves the machine in a state you have to remember to revert once the OS is actually installed on the internal disk — easy to forget and end up re-booting the installer by accident later. The one-time override (a separate menu from the boot-order editor, usually reached the same way — boot-select key at power-on) boots the USB exactly once without touching the saved order at all.
3. **Use `nmcli`, not raw `wpa_supplicant`, to get the live installer online.** `wpa_supplicant`/`wpa_cli` require manually wiring up a `ctrl_interface`, and on this board a NixOS-managed `wpa_supplicant` instance was often already running and fighting a manually-started one for the same radio — hours of avoidable pain. NetworkManager ships on **all** NixOS installer media, including the minimal ISO used here (it's pulled in by the shared `profiles/installation-device.nix`, not something exclusive to a graphical variant) — `nmcli device wifi connect "<SSID>" password "<password>"` just works in one shot instead.

- [x] **Task 2.0: Real SSH Key** — placeholder replaced with the real Mac Mini key.
- [x] **Task 2.1: Base NixOS Install**
  Flashed a NixOS **unstable** Minimal ISO (24.11's default kernel didn't support the M5's MediaTek MT7925 WiFi chip; unstable's newer kernel does). Booted via WiFi at a staging location without Ethernet using the bootstrapping steps above. Partitioned the 2TB NVMe (1GB FAT32 ESP + ext4 root, wiping the factory Windows install).
- [x] **Task 2.2: Go Remote Early**
  Authorized the Mac's key via `curl https://github.com/<user>.keys > ~/.ssh/authorized_keys` on the live session, then drove the rest of the install (partitioning, `nixos-install`) over SSH from the Mac.
- [x] **Task 2.3: Apply System Flake & Reboot**
  Took several iterations to get right. Real bugs found and fixed: `services.openssh.enable` was never set at all (nothing was reachable post-reboot until fixed); `users.mutableUsers` defaults to `true`, so a password set on an already-existing account silently never applies — needed `false` for `hashedPasswordFile` to actually take effect; the MT7925 WiFi driver needed forcing via `boot.kernelModules` since udev's automatic loading proved unreliable on this board. SSH (key auth) and local console (password, SSH-inaccessible) both confirmed working across reboots.
- [x] **Task 2.4: Verify iGPU Memory Allocation**
  BIOS defaulted `iGPU Configuration` to `Auto`, silently carving out a fixed 64GB as static VRAM. Fixed via `Advanced → GFX Configuration → iGPU Configuration → UMA_SPECIFIED` + smallest `UMA Frame Buffer Size` (1GB). Confirmed: `free -h` shows 124GiB system RAM, `rocm-smi` shows 1GiB static VRAM, GTT makes nearly the full pool available to the GPU.

### Phase 3: AI Stack Deployment (Day 1) — COMPLETE
*Objective: Deploy the dual-vLLM slots, gateway, governance, and control-plane services.*
*(Turnstone judge verification, remaining key generation, and Herdr/Hermes control-plane verification moved to Phase 6 — 2026-07-23 restructure.)*

- [x] **Task 3.1: Model Staging (first pass)**
  Explored 9 model candidates (Qwen3-Coder-Next, Qwen3.6-27B/35B-A3B, Gemma4-31B/26B-A4B, MiniMax-M2, DeepSeek-V4-Flash, Qwen2.5-VL-7B for OCR, Qwen3.5-4B for judge) before narrowing the first real pass to **Qwen3-Coder-Next-FP8** (primary) + **Qwen3.5-4B** (judge). Originally started downloading GGUF quants for vLLM, then caught the format mismatch — GGUF is llama.cpp's format, not vLLM's; switched to the native `Qwen/Qwen3-Coder-Next-FP8` safetensors checkpoint (~80GB, day-0 vLLM ≥0.15.0 support) and `Qwen/Qwen3.5-4B` BF16 (~9GB) via `hf download`, staged to `/var/lib/ai-models/{qwen3-coder-next-fp8,qwen3.5-4b}` and confirmed complete (40/40 and 2/2 safetensors shards, no `.incomplete` files left). Root cause of repeated multi-hour download stalls (persisted across both WiFi and Ethernet) turned out to be `hf-xet`, huggingface_hub's newer accelerated transfer backend, hanging on this network path — `HF_HUB_DISABLE_XET=1` plus longer `HF_HUB_DOWNLOAD_TIMEOUT`/`HF_HUB_ETAG_TIMEOUT` fixed it. Both now set permanently via `environment.variables`, with `HF_TOKEN` support added too (sourced from a gitignored secrets file at shell login) for better unauthenticated-rate-limit headroom on future downloads.
  **Same-day pivot:** the FP8 primary checkpoint was then dropped in favor of **Qwen3.6-35B-A3B (bf16)** — see the full reasoning in Section 4 (gfx1151 has no FP8 matrix-core hardware at all; real-world reports confirm Qwen3-Next-family FP8 fails to load on this exact toolbox/hardware, not just runs slow). The old `qwen3-coder-next-fp8` download (~75GB) is still sitting on disk at `/var/lib/ai-models/qwen3-coder-next-fp8`, orphaned and no longer referenced by any config — a future cleanup item. Model staging is now also declarative going forward (see Task 3.2/Section 3) — `download-model-qwen3.6-35b-a3b` and `download-model-qwen3.5-4b` systemd services replace manual `hf download` sessions for future rebuilds.
- [x] **Task 3.2: Apply configuration.nix Additions**
  Added the `drew` user (no SSH key yet — public keys aren't secrets, so it'll go inline as a string literal when available, not into `secrets/`), the `herdr` package + systemd user service, and expanded firewall ports (11434; 8443 later dropped — see below). Also fixed a stale reference caught along the way: the Synology backup script was still targeting `/var/lib/docker/volumes/hermes_data/`, a leftover from when Hermes ran as a docker container — corrected to `/home/chris/.hermes/` and `/home/chris/.herdr/` matching the actual host-level architecture.
  **Same-day follow-up:** dropped port 8443 from the firewall (nothing listens there — no Caddy/TLS sidecar deployed in front of Turnstone) and added the declarative `download-model-*` systemd services described in Section 3, so model weights are fetched automatically on boot instead of requiring a manual SSH session.
- [x] **Task 3.3: Container Spin-up — COMPLETE**
  `docker compose up -d` from `docker/` — vLLM primary + judge, LiteLLM (+ its own Postgres), Turnstone (+ its Postgres), Prometheus, Grafana, and now Open WebUI. Ollama sandbox still not included (no models staged for it).
  **History:** Discovered the target machine's `/home/chris/local-ai-machine/docker/` files were still the original Phase 1 scaffolding despite multiple config commits over the course of Phase 3 — only `configuration.nix` had actually been kept in sync via targeted rsync calls. Fixed with a full repo rsync from the Mac worktree, confirmed via `diff`. Generated real `docker/.env` credentials locally and pushed to the target; added `docker/.env.example` documenting the vars.
  First `docker compose up -d` attempt **failed** with a real pull-access-denied error: `kyuz0/amd-strix-halo-vllm:latest` and `turnstonelabs/turnstone:latest` are both hallucinated image references that don't exist on Docker Hub (corrected to `docker.io/kyuz0/vllm-therock-gfx1151:latest` and `ghcr.io/turnstonelabs/turnstone:latest` — see Section 4). While fixing that, the primary model was swapped from Qwen3-Coder-Next-FP8 to Qwen3.6-35B-A3B (bf16) for the hardware-support reasons detailed in Section 4, and Turnstone's env vars/config mount were corrected against its actual docs.
  **Resolved:** all containers (vllm-primary, vllm-judge, litellm-db, litellm, turnstone-db, turnstone, prometheus, grafana, open-webui) came up healthy end-to-end once the model download finished and the corrected images/config were applied.
- [x] **Task 3.4: Endpoint Validation — COMPLETE**
  Both vLLM slots confirmed responding directly (`qwen3.6-35b-a3b`, `qwen3.5-4b-judge`); LiteLLM routes `coder`/`judge`/`governed_coder` verified. Inference speed and latency under load were formally benchmarked (not just spot-checked) via `vllm bench serve` at concurrency 1 and 8 — full results in `docs/benchmark-report-2026-07-22.html` and summarized in the 2026-07-22 decision-log entries below. The Qwen3-Coder-Next-GPTQ-4bit and Qwen3.5-122B-AWQ-4bit comparison tiers were both benchmarked in the same report — the 122B tier came out slowest at both concurrency levels tested, likely due to `--enforce-eager` being required for its AWQ kernel path.
- [x] **Task 3.5 (moved to Phase 6, Task 6.1): Turnstone Judge & Governed Route Verification**
- [x] **Task 3.6: Multi-Tenant Key Verification — chris's portion done, Drew's portion moved to Phase 6 (Task 6.2)**
  **Chris's key done (2026-07-23)**: generated via LiteLLM's `/key/generate` API (alias `chris-master`, key stored in chris's own records, not committed anywhere — LiteLLM persists it in Postgres, confirmed via `LiteLLM_VerificationToken` table), no model/rate restrictions, verified working end-to-end (`/v1/models` returns all four configured routes: `coder`, `judge`, `governed_coder`, `claude-sonnet`).
- [x] **Task 3.7 (moved to Phase 6, Task 6.3): Herdr & Hermes Control Plane Verification**

### Phase 4: Observability

*(Backup mirror test and edge access verification moved to Phase 6 — 2026-07-23 restructure. This phase is now just the Grafana/Prometheus observability work.)*

- [x] **Task 4.2: Grafana Dashboard Baseline**
  Prometheus now scrapes all 5 targets successfully (`prometheus`, `node`, `litellm`, `vllm-primary`, `vllm-judge`) — added missing vLLM scrape configs, a real `node-exporter` container, and `litellm_settings.callbacks: ["prometheus"]` (the `/metrics` route didn't exist at all without it — confirmed 404, not 401, until added). Grafana now has a provisioned Prometheus datasource and a real 10-panel dashboard (request throughput, token throughput, KV cache usage, TTFT/ITL percentiles, prefix cache hit rate, host CPU/memory) replacing the old empty `"panels": []` placeholder. Admin password changed from the default (confirmed old `admin:admin` now returns 401). Verified end-to-end by querying real metric data through Grafana's own datasource proxy. Along the way found and fixed a real bug in the earlier `filterForward` firewall fix — it only exempted the `input` chain for `trustedInterfaces`, not `forward` (matches a known upstream nixpkgs issue, #437920), which was silently blocking legitimate container-to-container traffic including to already-allowlisted ports. Fixed with `extraForwardRules` plus a fixed docker bridge interface name (`br-localai`, not Docker's default auto-generated per-network-ID name, which would've broken this on a fresh install).
- [x] **Task 4.4: Grafana Dashboard — Memory/GPU Utilization Panels + Open-Ended Metric Suggestions — COMPLETE (2026-07-23)**
  **Research finding**: node-exporter's built-in hwmon collector already surfaces GPU **temperature**, **power draw**, and **clock frequency** with zero extra config — confirmed directly via its `/metrics` output (`node_hwmon_temp_celsius`, `node_hwmon_power_average_watt`, `node_hwmon_freq_freq_mhz`, all labeled with the amdgpu chip). What it does *not* cover are amdgpu-specific DRM sysfs attributes (not standard hwmon values): `gpu_busy_percent`, `mem_info_gtt_total`/`_used`, `mem_info_vram_total`/`_used` — these live under `/sys/class/drm/card0/device/` instead.
  **Fix**: rather than a dedicated exporter container, wrote a small script (`scripts/amdgpu-metrics.sh`) that reads these sysfs values and writes them as a node-exporter **textfile-collector** file (atomic write via temp-file-then-rename, so the collector never reads a partial file). Runs every 10s via a new systemd timer (`amdgpu-metrics.timer`, faster than Prometheus's 15s scrape interval so data is never stale), writing to `/var/lib/node-exporter-textfile/amdgpu.prom`. node-exporter's compose service now mounts that directory and adds `--collector.textfile.directory=/textfile`. Verified end-to-end: real values confirmed via direct Prometheus query (`node_amdgpu_busy_percent`, `node_amdgpu_gtt_used_bytes`, etc. all returning live data), and the updated dashboard JSON (17 panels, up from 10) loaded successfully via Grafana's own API.
  **New panels added**: GPU Activity (%), GPU Memory (GTT + VRAM used/total), GPU Temperature & Power, GPU Clock Frequency, Disk I/O, Disk Space Available, Network Throughput — the last three from the open-ended "other useful metrics for a local AI agent box" addition, implemented directly per the user's explicit go-ahead (disk I/O/space given how large and frequent model downloads are; network throughput given the earlier download-saturation incident this session). CPU thermal headroom is covered by the host's own `k10temp`/`acpitz` hwmon sensors, already available the same zero-config way as the GPU's — not added as a separate panel this pass, but trivially addable later if wanted. Per-service request queue depth/error rates beyond vLLM's own metrics (already covered) would need each service to expose its own Prometheus metrics — Turnstone/LiteLLM's own request-level metrics weren't investigated this pass, a reasonable follow-up if deeper observability into governance/gateway behavior is wanted later.

### Phase 5: Model Research & Continuous Optimization

*Objective: an open-ended loop, not a one-time task list — continuously find, test, and optimize the best available models for coding-assistant use on this hardware. "Done" for this phase means the model lineup and its serving configuration are genuinely dialed in for the best available experience and performance, not that a checklist is empty.*

This phase absorbs and continues the in-progress "benchmark → coding-capability eval → optimize → re-benchmark" effort documented in the Decision Log entries above (2026-07-22 through 2026-07-23) — that work isn't restarting, it's continuing under this roadmap phase instead of a separate ad-hoc plan.

**Scope expanded 2026-07-23**: this phase is explicitly not limited to tuning flags on the existing vLLM-only setup — it covers **alternate serving paths and architectures entirely**, if they lead to real, benchmarked performance gains. Anything plausible gets tried and measured; nothing gets adopted on the strength of a claim alone.

**Ordering rule (added 2026-07-23, given Chris will be unreachable for an extended period)**: Chris explicitly wants anything that depends on his input — a decision, an approval, an answer to a question — surfaced **as early as possible in this phase**, while he's still around to respond, rather than discovered near the end of a long unattended stretch. Tasks below are ordered with that in mind: human-dependent items first (5.1-5.2, plus the standing open decision), pure-autonomous work after (5.3-5.7). **Standing rule: check in before starting any new model download** — this applies to 5.2 directly, and to any download 5.5/5.6 turn out to need (e.g. Ollama pulling a model, Lemonade needing a specific hybrid-mode checkpoint). Don't treat "the go-ahead to start Phase 5" as blanket approval for downloads specifically — those get their own check-in each time.

- [x] **5.1: Research additional model candidates — DONE 2026-07-23.** Research agent surveyed kyuz0's own toolbox compatibility table plus current model releases. Ranked shortlist: **GPT-OSS-120B** (~65GB, MXFP4/BF16, proven-compatible on this exact image at TP=1, native `openai`/`openai_gptoss` tool-call/reasoning parsers, strong reasoning/coding benchmarks) — highest confidence; **GLM-4.7-Flash-AWQ** (~<20GB, ~30B total/~3B active MoE, beats GPT-OSS-20B/Qwen3-30B on SWE-bench/LiveCodeBench per Z.AI's own numbers, but untested on this exact hardware) — cheap trial; **GPT-OSS-20B** (~13GB, same proven-compatible family, judge-model candidate) — potential Qwen3.5-4B replacement. Disqualified: `amd/gpt-oss-120b-w-mxfp4-a-fp8` (FP8-activation variant, wrong one), MiniMax-M2.7 variants (need TP=2), GLM-4.7 flagship (355B/32B active, likely too large for safe KV headroom even at AWQ-4bit).
- [x] **5.2: Present candidates and get download approval — DONE 2026-07-23.** Chris approved all three (GPT-OSS-120B, GPT-OSS-20B, GLM-4.7-Flash-AWQ). All three confirmed as real HF repo IDs (API 200 check) before being added to the declarative `models` list in `configuration.nix`, deployed via `nixos-rebuild switch`, and their `download-model-*` timers are now running on the shared-flock download queue alongside the existing lineup. Not yet served/benchmarked — that's 5.3/5.4 once downloads complete. If Chris is unreachable when a future candidate is found, record it here with rationale and move on to autonomous work (5.3+) rather than blocking — but don't start the download itself without a reply.
- [x] **122B non-`enforce-eager` decision — RESOLVED 2026-07-23.** Chris decided: adopt it as the standing default. See the decision-log entry below for the exact invocation change (drop `--enforce-eager`, keep `VLLM_USE_TRITON_AWQ=1`).
- [ ] **5.3: Endless optimization loop** — squeeze the best real performance out of each model on this exact hardware/toolbox combination. Try anything findable via research (kernel flags, quantization choices, speculative decoding, scheduler tuning, etc.), verify each with real benchmarks rather than trusting claims, and keep only what's confirmed to actually help. **Status**: the original optimize plan's core items are complete — AITER confirmed broken across 3 architectures, left off; non-`enforce-eager` AWQ for the 122B tier tested as a marginal real win and now adopted as the standing default (resolved above); `--max-num-batched-tokens 16384` tuning confirmed a universal real regression across all 6 models tested, closed out for good — keep the default (8192) everywhere. Next candidates for this loop: MTP (5.5) and alternate serving paths (5.6). Fully autonomous — no human dependency once underway.
  - **GLM-4.7-Flash-AWQ tested 2026-07-23 — real, promising result.** First of the three Phase 5.2 candidates to finish downloading, so tested first (Chris gave standing permission to freely swap models for testing since he isn't actively relying on the served models right now). vLLM's dedicated `glm47` tool-call parser + `glm45` reasoning parser both worked directly, no AWQ workaround needed (unlike the 122B tier's `VLLM_USE_TRITON_AWQ=1`) — healthy in ~190s.
    - **Footprint: best of any model tested.** 16.94 GiB weights, 92.87 GiB KV cache, **28.10x max concurrency @65536** — beats the previous best (Gemma-4-26B-A4B-it's 20.27x) by a wide margin, on top of already being a small download (19GB on disk).
    - **Speed: solid mid-pack, not a new leader.** c1: 18.95 tok/s output (beats both non-primary comparison tiers' c1 numbers from the original report — 11.91/14.34 tok/s). c8: 30.19 tok/s output — behind the primary (33.19) and Gemma-4-26B-A4B (50.38), but ahead of Qwen3.6-27B (17.91), 122B AWQ (16.05), and Gemma-4-31B (11.73). TTFT/TPOT scale roughly as expected at higher concurrency (mean TTFT 1353ms→7994ms, mean TPOT 50ms→228ms c1→c8).
    - **Coding + role-fitness: 10/13 across the new six-tier harness** (`results/glm-4.7-flash-awq.json`) — Tier A 3/3, Tier B 2/2, Tier P 2/2, Tier Q 2/2, Tier J 1/2, Tier D 0/1. Both losses are genuine, not harness artifacts: **Tier J** (`judge_incorrect`) — missed the same subtly-buggy palindrome check the current primary also missed, real evidence neither model is a reliable judge yet without more scrutiny. **Tier D** (`debug_off_by_one`) — its "fix" used `range(len(orders) - 1)`, which silently drops the last element from the output entirely instead of following the explicit turn-3 instruction to keep it (as `False`) — a real carelessness finding about multi-turn instruction-following, not a task-design ambiguity (confirmed: this redesigned task already correctly graded the *primary* model's differently-shaped correct fix as PASS in the same session, so the grading mechanism itself is sound).
    - **Bottom line so far**: not a drop-in primary replacement (slower than the two current speed leaders), but the best memory-efficiency/concurrency-headroom result of any model tested, and a real MTP candidate worth prioritizing in 5.5 — its architecture file (`glm4_moe_lite_mtp.py`) ships a dedicated MTP variant in this vLLM build, unlike the Qwen3-Next family's unconfirmed ROCm MTP support.
- [ ] **5.4: Continuously expand the benchmark comparison report** with new data as models/optimizations are added — `docs/benchmark-report-2026-07-23.html` is the current baseline; each meaningful round of new data (new model, confirmed optimization) should produce a new dated report for direct before/after comparison, not overwrite history. Fully autonomous.
  - **Coverage expanded 2026-07-23 (Chris's direction), `scripts/coding_benchmark.py` now six tiers.** Originally two tiers (A: correctness, B: tool-calling) only tested coding-assistant capability — fine for primary/coding-role candidates, but said nothing about judge-model or personal-assistant fitness. Added: **Tier J** (judge-role — strict-JSON verdict on a correct and a deliberately-buggy code sample, catching a degenerate "always pass" judge); **Tier P** (personal-assistant — constrained-length summary, structured extraction); **Tier D** (long-running interactive debugging — a real 3-turn conversation where each user turn adds a clue about a planted off-by-one bug, graded by executing the FINAL turn's fix against known-correct test assertions, same objective mechanism as Tier A); **Tier Q** (planning/"grill me" fitness — a deliberately underspecified project brief with 5 known-missing critical details, graded by keyword-matching how many of those dimensions the model's response actually asks about, minimum 3/5 to pass). All six tiers run against every model by default now, not gated per-role, so judge/assistant fitness data is already on hand whenever a model is considered for those roles. Live-smoke-tested against the running primary (`qwen3.6-35b-a3b`) before being trusted: Tier J/P/D/Q all executed correctly end-to-end — and surfaced a real finding in the process, not just a harness validation: the primary **failed `judge_incorrect`** (said `passes: true` on a subtly-buggy palindrome check that should have failed) — genuine signal that this model isn't yet a reliable judge, not a bug in the new tier.
- [ ] **5.5: MTP (multi-token-prediction) speculative decoding — real research + testing effort.** vLLM has a `qwen3_next_mtp` method for the Qwen3-Next architecture family (35B-A3B, 80B GPTQ both qualify), but ROCm support is unconfirmed as of the last check (open upstream toolbox issue #53) — and this exact architecture family already broke outright on FP8 on this hardware, so "unconfirmed" here carries real skepticism, not just an unchecked box. Also tie in the NPU-side MTP angle surfaced in the OPTIMIZATIONS.md research below (the Lemonade Server OP's wishlist for MTP-supported hybrid models) — worth checking whether that's progressed since that research was done. Test directly rather than trusting either the upstream issue status or the Reddit wishlist at face value. Research/testing is autonomous; if it turns out to need a new model/checkpoint download, that download itself still needs check-in per the standing rule above.
- [ ] **5.6: Alternate serving paths and hybrid NPU+iGPU execution.** This machine's XDNA NPU sits completely idle right now — everything runs on the iGPU (RDNA3.5/gfx1151) via vLLM. Concretely:
  - **Lemonade Server** (lemonade-server.ai) — already researched in `OPTIMIZATIONS.md` (2026-07-23 entry): enables "Hybrid Mode" (NPU handles prompt processing in parallel with iGPU generation) on this exact chip family. The source OP explicitly cautioned it's a feasibility sanity-check tool, not production-ready for real agentic/chat use — verify that's still true, and if so, whether it's improved since, or whether a hybrid *prefill-only* offload to the NPU (keeping vLLM for decode) is achievable at all with the current tooling.
  - **Ollama sandbox** — staged in the architecture (Section 2/topology, `http://localhost:11434`) but never wired into the compose stack or given any models, called out twice now as a loose end. Worth actually standing up and benchmarking against the equivalent vLLM configuration for at least one model, since Ollama's llama.cpp backend showed materially different (sometimes better, sometimes worse) numbers than vLLM/ROCm in the kyuz0 toolbox data already gathered this session — real chance it wins for specific models/quantizations even if vLLM stays primary overall.
  - Any other serving stack/backend that turns up during research (5.1) and looks credible for this exact hardware — this list isn't exhaustive, it's a starting point.
  - Standing rule applies here too: pulling a new model for Ollama, or a specific hybrid-mode checkpoint for Lemonade, is a "new model download" and needs check-in first — installing/evaluating the serving stack itself (no model weights) does not.
- [ ] **5.7: Cleanup items surfaced along the way** — the orphaned ~75GB `qwen3-coder-next-fp8` download still sitting unused on disk (`/var/lib/ai-models/qwen3-coder-next-fp8`), and anything else found stale during this phase's work. Low priority, opportunistic — do when convenient, not a blocker.

**Operating mode for this phase (2026-07-23, refined later same day)**: the user is stepping away for an extended period and wants continuous, largely unattended progress — research, test, and optimize on an ongoing loop, checking in via README updates and git history rather than needing synchronous confirmation for routine judgment calls. **Exception, added explicitly**: new model downloads always need a check-in first, regardless of how routine the candidate looks — this is a standing rule, not a one-time gate. Genuinely risky/destructive/irreversible actions still get flagged rather than taken silently; everything else proceeds and gets recorded here.

**Standing permission (Chris, 2026-07-23)**: freely swap `vllm-primary`/`vllm-judge` for testing purposes during this phase — Chris isn't actively relying on the served models right now, so there's no need to protect production continuity the way a real multi-user deployment would. This does not relax the download check-in rule above (a new model swap-in is fine; a new model *download* still needs a reply) — it only removes the earlier "avoid disrupting in-flight benchmarking/serving" caution for the swap-in pattern itself.

### Phase 6: Multi-Tenant & Control Plane Verification

*Objective: verify the remaining pieces that support Drew's access, safety governance, and operational resilience — distinct from the model research/optimization work in Phase 5, and appropriately last since none of it blocks day-to-day use of the stack by Chris.*

- [ ] **Task 6.1 (was 3.5): Turnstone Judge & Governed Route Verification**
  Confirm Turnstone's safety judge (Qwen3.5-4B judge slot) actually intercepts and evaluates `governed_coder` requests as intended, and that `turnstone-eval`/`turnstone-doctor` run cleanly. Wiring `vllm-judge` in as Turnstone's judge/reranker model has no env-var equivalent — it's TOML-config (`~/.config/turnstone/config.toml`) or console-UI only, so writing that config is real remaining work here, not just plumbing that got skipped. Confirmed still empty as of the 2026-07-22 audit.
- [ ] **Task 6.2 (was part of 3.6): Drew's Rate-Limited Key Generation**
  Generate `sk-drew-edge` via LiteLLM's `/key/generate` API — needs actual rate-limit and route-blocking parameters (`rpm_limit`, `models` allowlist excluding cloud/governed-admin routes) decided before creating it, not just an unrestricted key with a different name. Confirm Drew is correctly rate-limited and blocked from cloud/governed-admin routes.
- [ ] **Task 6.3 (was 3.7): Herdr & Hermes Control Plane Verification**
  Verify the Herdr daemon socket is reachable, panes spawn correctly, and Hermes' Telegram topic routing + sub-agent delegation rules (Section 6) behave as documented.
- [ ] **Task 6.4 (was 4.3): Drew's Edge Access Verification**
  Confirm Drew's WireGuard VPN path to the LiteLLM/Hermes endpoints works end-to-end with `sk-drew-edge`, respecting rate limits.
- [ ] **Task 6.5 (was 4.1): Execute Backup Mirror Test**
  Run `scripts/sync-backup.sh` (or `systemctl start synology-backup.service`) and verify files land under `tank/backups/local-ai-machine/` on the Synology, including the new `hermes/` and `herdr/` paths. Confirm DSM's Btrfs snapshot schedule is enabled on the `tank` share for point-in-time recovery.

### Phase 7: Review, Codify, Rebuild (requested 2026-07-23)

*Objective: prove the whole machine is genuinely, fully reproducible from this repo alone — not just mostly declarative, but actually wipeable and rebuildable with zero manual steps left implicit anywhere. This was the stated end goal from early in the project ("wipe the machine, reinstall fresh, ensure it's able to 100% bootstrap") — this phase is where that gets verified for real, not assumed.*

- [ ] **Task 7.1: Full audit — everything adjusted, configured, executed, downloaded, or created on the machine, cross-referenced against this git repo.** Go through the session history systematically: every `configuration.nix`/`docker-compose.yml`/script change, every manual `docker exec`/`ssh` command that changed live state, every model download, every credential generated, every ad-hoc fix applied directly on the box. For each, confirm it's either (a) fully captured declaratively in a committed file, (b) captured as a documented manual step (e.g., Open WebUI's first-signup, which genuinely can't be automated per earlier research), or (c) flag it as a real gap — something that happened on the machine but isn't reproducible from the repo alone. Known candidates to check carefully given this session's history: the swap-in test containers (`vllm-bench-swap` and its many variants) never touched `docker-compose.yml` and shouldn't need to — confirm nothing from those experiments leaked into persistent state; the temporary NOPASSWD sudo rule added and reverted for the firewall investigation — confirm it's truly gone from both the repo and the live `/etc/sudoers`; LiteLLM virtual keys (chris's, and Drew's once created) — these live in Postgres, not in any file, so confirm the *mechanism* to regenerate them is documented (it is: `/key/generate` API) even though the specific key values aren't and shouldn't be committed; the orphaned FP8 model file and any other stray downloads.
- [ ] **Task 7.2: Fix every gap found in 7.1** — commit the missing pieces, document the genuinely-manual steps clearly (in this README, not tribal knowledge), until the audit comes back clean.
- [ ] **Task 7.3: Wipe and rebuild the machine from scratch**, using only this repo (fresh NixOS install per Section 8 Phase 2's own bootstrapping notes, `nixos-rebuild switch --flake`, `docker compose up -d`) — no manual fixes, no "oh right, I also need to..." steps. This is the actual test of Task 7.1/7.2's completeness, not a formality.
- [ ] **Task 7.4: Fix anything the rebuild surfaces**, then re-verify. Repeat until a from-scratch rebuild genuinely works end-to-end unattended.

**This is a hard-stop-style task** — actually wiping the production machine is exactly the kind of destructive, high-blast-radius action that needs explicit user confirmation before execution (per the "Executing actions with care" guidance), not something to do autonomously as part of Phase 5's unattended optimization loop. Task 7.3 specifically requires the user's direct go-ahead immediately before it happens, even though the audit/fix work in 7.1/7.2 can proceed without that gate.

### Phase 8: Day-N Operations Documentation (requested 2026-07-23)

*Objective: this project has grown from a one-shot deployment task into a long-lived, ongoingly-maintained system, and its documentation needs to reflect that. `README.md` has functioned as a running project journal/decision-log this entire time — genuinely useful for that purpose, but not what a human needs when they sit down to actually operate or rebuild this machine. Split it into purpose-built pieces.*

- [ ] **Task 8.1: Extract kanban-ready items.** Once this project migrates to the agentic-fleet kanban queue platform (mentioned earlier as a planned move), pull the genuinely trackable work — open tasks, in-progress experiments — into fleet-style cards instead of leaving it embedded in README prose.
- [ ] **Task 8.2: Write a project-scoped `AGENTS.md`.** Operational rules for any agent (human or AI) working on this repo specifically: the declarative-pipeline discipline (never ad-hoc changes directly on the live machine, always commit through the standard rsync/`nixos-rebuild`/`docker compose` flow), the benchmark/swap-script conventions and real gotchas found this session (the swap-in pattern, known crash modes like the AITER incompatibility, the `--tokenizer` flag requirement, timeout tuning for slow models), secrets-handling rules specific to this repo, and other operational guidance that isn't end-user documentation.
- [ ] **Task 8.3: Write a proper human-facing `README.md`.** What this project is and its architecture, at a level a new reader can actually use — not a chronological journal. Must include, concretely:
  - **How to destroy-and-recreate the machine from scratch**, including the real bootstrapping gotchas found this session: `nmcli` (not raw `wpa_supplicant`) for WiFi during install, the BIOS one-time boot-override trick (not a permanent boot-order change), the kernel-version requirement for the M5's MT7925 WiFi chip (needs ≥6.7, NixOS 24.11's default 6.6.94 silently doesn't work), and the iGPU UMA memory BIOS configuration (`UMA_SPECIFIED` + smallest frame buffer, not the `Auto` default which silently carves out 64GB as static VRAM).
  - **How to obtain/generate every secret this stack needs** — what each one is for and the mechanism to create it (LiteLLM master key, per-user virtual keys via `/key/generate`, Grafana admin password via `grafana-cli admin reset-admin-password`, HF token, Synology backup SSH key), not the live values themselves.
  - **Day-to-day operational instructions**: how to swap in and benchmark a model, how to check what's currently loaded (`docker ps`, `/v1/models`), how to reach services (SSH tunnel vs. LiteLLM gateway vs. on-box only), and anything else a human would actually need to maintain this machine going forward.
- [ ] **Task 8.4: Confirm nothing is lost in the split.** The current README's decision-log history is real project memory, not filler — it shouldn't just be deleted when the "live" README becomes lean. Preserve it somewhere sensible (e.g. `docs/history.md` or similar) even after the split.

### Decision Log — 2026-07-22: Benchmark pass, deployment pipeline redesign, hardware/system audit

**Benchmark pass.** First real `vllm bench serve` runs across the 35B primary, 4B judge, and GPTQ 80B comparison models at concurrency 1 and 8, written up in full in `docs/benchmark-report-2026-07-22.html`. No clean speed winner: the GPTQ 80B model wins single-stream (14.34 vs 11.91 tok/s) with far more consistent latency, while the 35B bf16 model wins at concurrency 8 (33.19 vs 26.13 tok/s) and degrades less under load. Also surfaced a genuinely counterintuitive footprint finding: the 80B GPTQ model is *smaller on disk and leaves more KV cache headroom* than the 35B bf16 model (46.49GiB weights/40.42GiB KV vs 66.97GiB weights/18.49GiB KV) — quantization beat raw parameter count for memory footprint, worth remembering next time a bigger model looks automatically more expensive to run. The GPTQ model was run as a temporary swap-in, not concurrently with the primary; it is not a standing compose service.

**Deployment pipeline redesign.** `nixos-rebuild switch` was found to block synchronously on starting/restarting any long-running systemd unit — a multi-GB model download turned unrelated config pushes into 15-40 minute stalls. Fixed with `restartIfChanged = false` on the download and `docker-compose-app` services, and by moving both from direct `wantedBy = multi-user.target` to timer-triggered units (`systemd.timers`, `OnBootSec`) — arming a timer is near-instant regardless of the triggered work's duration. `docker-compose-app` polls the downloads' own `.download-complete` marker files rather than using `after=`/`wants=` against them, since those retry indefinitely on failure and ordering against them would only prove "the most recent attempt exited," not "eventually succeeded." Verified end-to-end: killed an in-flight download mid-transfer, pushed a config change, confirmed the switch completed in ~3.4 seconds (not 15-40 minutes), and confirmed the download resumed rather than restarting from scratch. Also fixed a real data-integrity bug in the same effort: `hf download`'s exit code is not reliable evidence of completeness (observed directly — a "complete" 35B download was missing 6 of 26 shards); the download script now cross-checks `.incomplete` markers and sharded models' manifests instead of trusting the exit code alone.

**Hardware/system audit.** Found and fixed the CPU governor stuck on `powersave` on all 32 threads (→ `performance`), an intermittently-timing-out router DNS resolver (→ fallback resolvers plus `networking.networkmanager.dns = "none"`, since NetworkManager was silently ignoring `networking.nameservers` otherwise), and `rocm-smi`'s VRAM metric being effectively useless on this unified-memory APU (→ added `amdgpu_top`/`nvtopPackages.amd`, plus a batch of missing common shell tools). Also found a real security gap: Docker's own FORWARD-chain iptables rules bypass NixOS's firewall entirely for published container ports — confirmed directly, port 8000 (raw vLLM, zero auth) was externally reachable despite never being in `allowedTCPPorts`. Fixed with `networking.firewall.filterForward = true` (required switching to the nftables backend). Ports 8000/8001 are now deliberately excluded from the allowlist going forward; LiteLLM on 4000 remains the only intended authenticated gateway. Full detail on all of the above is in Section 3.

**New service: Open WebUI.** Added as the first browser-based chat interface in the stack, pointed at LiteLLM's unified endpoint rather than any vLLM server directly. Uses first-signup-becomes-admin (`WEBUI_AUTH=true`) — deliberately left for the human to do, not automated, since it's their own login. See Section 4.

### Decision Log — 2026-07-22 (later): Monitoring wiring, 122B model, deployment pipeline hardening

**122B model downloaded and benchmarked** (`cyankiwi/Qwen3.5-122B-A10B-AWQ-4bit`, 75GB, verified zero `.incomplete` files remaining). Run alone (no judge model, full GPU budget, `--enforce-eager` required for its AWQ kernel path, capped at 32K context vs the 131K used for the other three tiers). Came out slowest at both concurrency levels — 7.87 tok/s @ c1 vs 11.91/14.34 for the other two, only 16.05 tok/s @ c8 with mean TTFT past 20 seconds under load — most likely explained by `enforce-eager` disabling CUDA graph/torch.compile. Full results in `docs/benchmark-report-2026-07-22.html`. The benchmark client itself segfaulted on exit immediately after the c8 run finished (confirmed its own cleanup path, not the server — the server kept serving normally throughout and the result JSON had already saved).

**Deployment pipeline hardening, verified under real conditions.** The timer-based redesign from earlier today held up in production, not just the synthetic kill-test: the 122B download was killed mid-transfer to test resume behavior, a config push during the retry cycle completed in ~3.4s without disturbing it (`NOT restarting the following changed units: download-model-...` in the switch output), the download resumed from its prior progress, and `docker-compose-app` correctly waited on its marker-poll loop before running `docker compose up -d` once the download actually finished — asynchronously, off the critical path of any `nixos-rebuild switch` call.

**Monitoring fully wired** — see Task 4.2 above for the complete writeup (Prometheus targets, Grafana provisioning/dashboard, the `filterForward` forward-chain bug, `extraForwardRules`, fixed bridge name, LiteLLM's `prometheus` callback).

**Process note:** twice this session, live-deployed changes sat uncommitted for a while before being caught and fixed — once by the user directly asking, once by a manual audit. Also caught: a multi-file `scp <files...> host:dest/` call silently flattened `docker/prometheus/prometheus.yml` and `docker/litellm/config.yaml` into `docker/prometheus.yml` and `docker/config.yaml` on the target instead of preserving their subdirectories (scp doesn't preserve relative paths across multiple sources to one destination) — masked as a "config didn't take effect" bug for a while before being traced to the actual file location. Going forward: commit immediately after confirming a change works, and use per-file destination paths (or rsync) rather than batched multi-source scp calls.

### Decision Log — 2026-07-22 (later still): Download serialization, stall watchdog

**Downloads were saturating the connection.** Each model download had its own independent `systemd.timer`, uncoordinated with the others — four firing around the same boot-time window meant four simultaneous downloads competing for bandwidth (confirmed directly: two Gemma models running in parallel dragged everything to a crawl). Fixed with a shared `flock` around the actual download in the script — whichever acquires it first runs to completion (through its own retry cycle) while the others block without consuming bandwidth, then take their turn in whatever order they happen to acquire the lock. Verified live: killed both in-flight parallel downloads so their retries would pick up the new script (`restartIfChanged` protects already-running instances from picking up config changes automatically), confirmed via process inspection that only one had an actual download process running while the other's script sat blocked at the `flock` call.

**A new, different stall mode surfaced separately.** `gemma-4-26B-A4B-it`'s download hung with zero disk growth for 10+ minutes, but with an active TCP connection showing a nonzero receive queue (`ss -tnp`) — data physically arriving from the server, sitting unread, with `hf`'s own process never consuming it and never erroring. Distinct from the earlier DNS-timeout stalls (those exit cleanly, which `Restart=on-failure` already handles) — this one just hangs forever with nothing to restart from. Added a watchdog: the download script now backgrounds the `hf download` process and polls the destination directory's total size every 2 minutes, force-killing it after 3 consecutive zero-growth checks (6 minutes) and letting the existing retry loop take over. Verified manually first (killed the hung process, confirmed the retry resumed and made real progress) before automating the same detection.

### Plan: benchmark → coding-capability eval → optimize → re-benchmark

Four phases, in order, with a second HTML report at the end for direct before/after comparison against `docs/benchmark-report-2026-07-22.html`:

1. **Speed-benchmark the four new models** (`Qwen/Qwen3.6-27B`, `google/gemma-4-31B-it`, `google/gemma-4-26B-A4B-it`, `Qwen/Qwen2.5-VL-7B-Instruct`) — **all four finished downloading and are verified complete** (checked for leftover `.incomplete` files, not just the marker), so this can start immediately. Same `vllm bench serve` methodology as the existing report. Gemma models need `--tool-call-parser gemma4 --reasoning-parser gemma4` (not the Qwen parser) and `enforce_eager: False` per the toolbox's own proven table entries — confirmed from `scripts/models.py`, not guessed. Qwen3.6-27B has no toolbox table entry; using the same flags as Qwen3.6-35B-A3B (same model generation). Qwen2.5-VL-7B is a different, older generation aimed at vision/OCR — skipping the Qwen3-specific tool-call parser for it.
   - **Context-window requirement surfaced mid-planning**: user needs at least 64K context for real usage. Current served configs: 35B primary, 80B GPTQ, judge are all at `--max-model-len 131072` (fine, well above 64K). **122B AWQ is only 32768** (chosen conservatively earlier for KV cache headroom) — below the requirement, needs revisiting next time that model is touched. The two Gemma models haven't been served yet — the toolbox's own proven table tests them at 32768 too, but given the 64K requirement, test them at 65536+ instead of copying that number uncritically, and confirm it still fits memory-wise before locking it in.
2. **Coding-capability benchmark, all 7 models.** Two objective grading tiers, no LLM-judge scoring (a 4B judge model's scoring of nuanced code quality would be shaky, so shipping two tiers that are actually reliable rather than three where one isn't): **Tier A** — 3 correctness tasks (palindrome check, merge-sorted-lists, arithmetic expression parser) graded by extracting generated code and executing it against test assertions in a sandboxed subprocess. **Tier B** — 2 tool-calling tasks (single tool call; a multi-step write-then-test-then-run sequence) graded structurally by checking the response's `tool_calls` field against the expected schema/arguments. Harness runs from the Mac (has Python readily available, unlike the target's minimal host) against each model's vLLM endpoint directly, folded into the same per-model swap-in session as the speed benchmark so each model only loads once.

   **Harness built and debugged**: `scripts/coding_benchmark.py` (stdlib-only, `python3 scripts/coding_benchmark.py --base-url http://local-ai-machine.local:8000 --model <served-name> --output results/<name>.json`). Three real bugs found and fixed while validating against the already-running 35B model, all worth knowing if this needs touching again:
   - **Tier A `max_tokens` was way too small (1024 → 8192).** These are reasoning models (Qwen3.6 native thinking mode) — a too-small budget gets burned entirely on the reasoning trace, leaving `content` null/truncated before the model ever reaches the actual answer. Confirmed twice: at 1024, all 3 Tier A tasks failed outright; at 3072, the hardest task still failed with the model 11,941 characters into its reasoning trace (tracing through test cases by hand) and still not done writing code.
   - **Request timeout was too short (120s → 900s).** At the larger token budget, a single request can genuinely take several minutes — and the 122B tier's 7.87 tok/s single-stream speed means an 8192-token response could take 15+ minutes there specifically.
   - **Code extraction grabbed the wrong markdown fence.** Switched from "first fence found" to "last fence found" — models sometimes show a draft before a final version, and grabbing the first one pulled malformed/incomplete code.
   - Validated: settles at 4/5 tasks passing consistently (2 Tier A, 2 Tier B — `palindrome` and `merge_sorted` pass reliably; `expr_eval`, the hardest Tier A task, occasionally fails/times out even at the 8192-token budget on this hardware's speed). Treated as an acceptable harness outcome, not a bug to keep chasing — `expr_eval` genuinely is the hardest of the three Tier A tasks.
3. **Optimize**, in priority order: (a) AITER fused MoE kernels for the MoE models (35B, 80B GPTQ, 122B AWQ, Gemma-26B-A4B) — needs verification first, since the 122B config already explicitly overrides *away* from AITER (`VLLM_USE_TRITON_AWQ=1`), hinting at a known AITER/AWQ interaction issue on this hardware, not a blind toggle; (b) test whether a non-`enforce-eager` AWQ path is viable for the 122B model, since `enforce-eager` looked like the main driver of its bad concurrency scaling; (c) `--max-num-batched-tokens`/chunked-prefill tuning, low risk, standard vLLM lever; (d) MTP speculative decoding for the Qwen3-Next family (35B, 80B GPTQ) last and treated as a real experiment, not a sure win — unconfirmed on ROCm, open upstream issue, same architecture family that broke outright on FP8.
4. **Re-run both benchmark phases post-optimization**, save to a new HTML doc for direct comparison against the baseline.

### Decision Log — 2026-07-23: Phase 1 speed-benchmarking, swap-benchmark script, NPU/hybrid research

**New reusable tool: `scripts/speed_benchmark_swap.sh`.** Automates the swap-in benchmark pattern used manually for the GPTQ-80B and 122B-AWQ tiers: stops `vllm-primary`/`vllm-judge`, starts the model under test alone on port 8000 at `--gpu-memory-utilization 0.90`, waits for `/health`, runs `vllm bench serve` at concurrency 1 (2048in/512out, 20 prompts) and concurrency 8 (2048in/256out, 100 prompts) via `docker exec` (the toolbox image has `vllm` on `PATH` inside the container), copies both result JSONs to `~/bench-results/` on the target, tears the temp container down, and restores the standard compose stack. Usage: `./speed_benchmark_swap.sh <model-dir-name> <served-name> <max-model-len> [extra vllm serve args...]`.
- **Real bug found and fixed on the first run**: the script's `vllm bench serve` invocation was missing `--tokenizer /models/<dir>` — without it, the benchmark client tries to resolve the served name (e.g. `qwen3.6-27b`) as an HF Hub repo ID for tokenizer loading and fails outright with a 404-style `OSError`. This looked like "low GPU activity, model barely using memory" from the outside (the server loaded fine and sat idle since no requests ever arrived) — not an optimization opportunity, just a broken client invocation. Fixed by pointing `--tokenizer` at the local model path inside the container; confirmed working on the re-run.

**Phase 1 results so far** (same random-dataset/`--ignore-eos` methodology as the existing report; all four models being tested at the corrected 64K+ context per the requirement noted above):
- **Qwen3.6-27B** (dense, 131072 context, same tool/reasoning parser family as the 35B primary): **4.07 tok/s @c1**, TTFT mean/median/p99 4664/4524/6854ms, TPOT 236.86/236.82/237.30ms. **17.91 tok/s @c8**, TTFT 29202/35439/39890ms, TPOT 320.88/308.26/400.73ms. Notably slower than the 35B-A3B primary (11.91/33.19) despite being nominally smaller — 27B is dense (all params active per token) vs. 35B-A3B's MoE (~3B active), so it's fully compute/bandwidth-bound in a way the MoE isn't. Real architectural finding, not a bug.
- **Gemma-4-31B-it** (dense, 65536 context — bumped up from the toolbox's proven-but-conservative 32768 per the 64K requirement, `gemma4` tool/reasoning parser): **3.23 tok/s @c1**, TTFT 7601/7535/8712ms, TPOT 294.97/294.96/295.10ms. **11.73 tok/s @c8**, TTFT mean/median/**p99 31649/29955/59202ms(!)**, TPOT 543.18/519.59/689.89ms. Slowest model tested this entire session — another dense model paying the full bandwidth-bound cost, and it degrades hard under concurrency (nearly a full minute p99 TTFT at c8).
- **Gemma-4-26B-A4B-it** (MoE, ~4B active, 65536 context, `gemma4` parsers): **20.85 tok/s @c1**, TTFT 1531/1411/3412ms, TPOT 45.06/45.06/45.08ms. **50.38 tok/s @c8**, TTFT 5334/5502/10524ms, TPOT 134.30/133.24/157.64ms. **Fastest model tested this entire session** — beats even the 35B-A3B primary (11.91/33.19). Confirms the MoE-vs-dense pattern: similar active-parameter budget to the primary but a smaller total footprint means less overhead. Strong candidate to reconsider as primary once the coding-capability results come in.
- **Qwen2.5-VL-7B-Instruct** (older-gen vision/OCR model, no Qwen3 tool-call parser, 32768 context — lower than the 64K requirement deliberately, since this model's role is quick OCR/vision tasks, not long-context coding): **15.41 tok/s @c1**, TTFT 1218/1071/3458ms, TPOT 62.65/62.65/62.66ms. **79.25 tok/s @c8**, TTFT 4234/3868/7820ms, TPOT 81.53/81.96/93.72ms. Fastest c8 throughput of any model tested, as expected for the smallest model (7B).

**Phase 1 complete — all four new models benchmarked.** Speed ranking at c8 among the coding-relevant models (tok/s): **Gemma-4-26B-A4B 50.38 > 35B-A3B primary 33.19 > Qwen3.6-27B 17.91 > 122B AWQ 16.05 > Gemma-4-31B 11.73** (Qwen2.5-VL-7B's 79.25 excluded — different role, not a fair head-to-head). Dense models (27B, 31B) consistently underperform MoE models at similar or larger total size on this bandwidth-bound hardware — the clearest single takeaway from this phase.

**Real bug found and fixed mid-run**: `speed_benchmark_swap.sh`'s `vllm bench serve` invocation had no tolerance for a known benchmark-client segfault-on-exit (same crash-on-cleanup behavior already seen with the 122B model in the original report) — under `set -e`, that non-zero exit killed the script immediately after the Qwen2.5-VL c8 run's results printed, skipping `docker cp`, container teardown, and stack restoration. Production (`vllm-primary`/`vllm-judge`) was down for a few minutes before this was caught and fixed manually (recovered the c8 result from inside the still-running container, then restored the stack). Script now tolerates the exit-code crash with `|| true` and instead verifies success by checking the result JSON exists inside the container before treating it as failed.

**New research: NPU+iGPU hybrid inference (OPTIMIZATIONS.md).** Investigated a user-supplied r/LocalLLaMA thread (`.../1uegdu0/big_news_for_amd_strix_halo_owners/`) about using this chip's idle XDNA NPU alongside the iGPU. Real findings appended to `OPTIMIZATIONS.md`: the concrete tool is **Lemonade Server** (lemonade-server.ai), which the OP describes as good for a quick feasibility sanity-check of "Hybrid Mode" (NPU handles prompt processing in parallel with iGPU generation) but explicitly *not* suited to real agentic/chat serving — a separate stack from vLLM entirely, not a modification to the current Compose service. No vLLM-specific NPU support exists. The OP's wishlist of MTP + hybrid-mode for Qwen3.6-class models is **not a working recipe** — nobody has done it yet, per the OP. Separately, verified (by independently fetching the raw `results.json`, not trusting a page-scrape) real llama.cpp benchmark data for Qwen3.6-35B-A3B on the same chip family: BF16 tops out at only ~26 tok/s generation despite ROCm hitting 525-573 tok/s on *prompt processing* (a different, much cheaper metric — easy to conflate the two); quantized variants (Q4_K_XL, Q8_K_XL) roughly double-to-triple BF16's generation speed on this hardware. Worth remembering when the "optimize" phase gets to quantization choices for the primary model.
- **Process note**: the pre-existing content already in `OPTIMIZATIONS.md` before this session (the "Qwen3.6-27b tok/sec" and "Qwen3.6-35B-A3B" sections at the top of the file) reads like unverified AI-chatbot output — specific-sounding but likely-fabricated flags and figures (e.g. "Chadrockv2 Profiles", `--vllm-attention-backend triton` as a CLI flag, "101-134+ tok/s" custom-kernel claims). Not cleaned up this session, but do not treat it as verified fact — cross-check against real sources (like the kyuz0 `results.json` approach used above) before acting on anything from that older content.

### Decision Log — 2026-07-23 (later): Phase 2 coding-capability results, three more harness bugs, firewall gap workaround

**Phase 2 in progress — 4 of 7 models done.** Results so far (Tier A = 3 correctness tasks, Tier B = 2 tool-calling tasks):
- **Qwen3.6-35B-A3B (primary)**: settles around 4/5, flaky between runs — palindrome/expr_eval have both independently failed on different runs due to reasoning-budget exhaustion on an easy task (see bug below), not a consistent capability gap.
- **Qwen3.5-4B (judge)**: 4/5 (2/3 Tier A, 2/2 Tier B) — `expr_eval` failed.
- **Qwen3-Coder-Next-GPTQ-4bit (80B)**: **5/5, perfect score.**
- **Qwen3.5-122B-A10B-AWQ-4bit**: **5/5, perfect score** — despite being by far the slowest model tested all session (~7.5-8 tok/s), it's fully capable on this harness. Also successfully re-served at **65536 context** (bumped up from the earlier session's under-provisioned 32768, confirmed it fits memory-wise).
- Remaining: Qwen3.6-27B, Gemma-4-31B-it, Gemma-4-26B-A4B-it.

**Three more real harness bugs found and fixed** (on top of the three from initial validation):
1. **Tier B `max_tokens` was also too small (512 → 2048)** — same root cause as the original Tier A bug: a reasoning model can burn its whole budget on the thinking trace before ever emitting a `tool_calls` entry. Confirmed directly against the 35B primary: a fully-correct reasoning trace planning out `multi_step_tool_call`, but the 512-token cap hit before the actual tool call was emitted.
2. **`content` can come back empty even at Tier A's 8192-token budget** if a model spins excessively on an easy task and never exits its thinking block. Confirmed directly: a 27,438-character reasoning trace on the trivial `palindrome` task, correct code visible inside it multiple times, `content` empty because the budget ran out mid-thought. Fixed by falling back to extracting code from the reasoning trace when `content` is empty, instead of failing the task outright.
3. **The harness's own 900s per-request timeout undershot what the slowest model needs for an honest full-length response** (8192 tokens ÷ ~7.5-8 tok/s ≈ 18 min, already past the 900s/15min cap) — and when a request did time out, the raw `TimeoutError` wasn't caught (only `urllib.error.URLError` was), **crashing the entire harness and losing every other task's result**, not just failing the one slow task. Fixed by bumping the timeout to 1500s and adding `TimeoutError` to both Tier A and Tier B's except clauses.

**Firewall gap: root-caused and FIXED (2026-07-23).** Raw vLLM on port 8000 (zero auth) was reachable from off-box over the LAN despite being deliberately excluded from `allowedTCPPorts` — confirmed directly. Root cause, confirmed by reading the live nftables ruleset (`sudo nft list ruleset`, via a temporary scoped NOPASSWD sudo rule added and removed for this investigation): NixOS's firewall module has a **built-in, unconditional `ct status dnat accept` rule** in the `forward-allow` chain — not something introduced by our own `extraForwardRules`. It's evaluated *before* `extraForwardRules` and is a terminal accept, so it unconditionally accepts any DNAT'd (i.e., any Docker `-p`-published) connection regardless of destination port, completely bypassing `allowedTCPPorts`. This means the earlier `filterForward`/`extraForwardRules` fix (Task 4.2, 2026-07-22) never actually protected published ports at all — it was solving a real but *different* problem (plain container-to-container bridge forwarding that isn't DNAT'd), and our own extraForwardRules lines were dead code for any published-port traffic, since `ct status dnat accept` always matched first.
**Real fix**: bind `vllm-primary`/`vllm-judge` (and the swap scripts, `speed_benchmark_swap.sh`/`swap_model_start.sh`) to `127.0.0.1` instead of `0.0.0.0` in their port mappings — `"127.0.0.1:8000:8000"` instead of `"8000:8000"`. This sidesteps the whole forward-chain/DNAT question entirely: a loopback-bound port isn't reachable from the LAN by basic IP routing, no matter what the firewall's forward chain does. Verified directly: external curl to both ports now returns nothing (blocked), while the SSH tunnel (`ssh -f -N -L 18000:localhost:8000 -L 18001:localhost:8001 chris@local-ai-machine.local`) and on-box access both still work fine. Going forward, these two raw model ports are reachable only via SSH tunnel or `docker exec` from the host — LiteLLM on port 4000 remains the only intended externally-reachable gateway, now for real.

**New reusable scripts**: `scripts/swap_model_start.sh`/`swap_model_stop.sh` factor the swap-in/teardown logic out of `speed_benchmark_swap.sh` so the coding-capability harness (which runs from the Mac) can drive a model swap without duplicating that logic. `swap_model_start.sh` supports an optional `SWAP_ENV_VARS="KEY=VALUE ..."` env var for cases like the 122B tier's `VLLM_USE_TRITON_AWQ=1`.

**Process note**: Mac-side backgrounded harness runs got killed by the harness/session infrastructure itself partway through (not a crash in the script) at least once this session — recovered by re-running with `nohup ... & disown` and redirecting to a log file instead of relying on the tool's own backgrounding, which held up reliably afterward.

**Phase 2 COMPLETE — all 7 models coding-benchmarked.** Final results (Tier A = 3 correctness tasks, Tier B = 2 tool-calling tasks):

| Model | Tier A | Tier B | Total |
|---|---|---|---|
| Qwen3-Coder-Next-GPTQ-4bit (80B) | 3/3 | 2/2 | **5/5** |
| Qwen3.5-122B-A10B-AWQ-4bit | 3/3 | 2/2 | **5/5** |
| Gemma-4-31B-it | 3/3 | 2/2 | **5/5** |
| Gemma-4-26B-A4B-it | 3/3 | 2/2 | **5/5** |
| Qwen3.6-35B-A3B (current primary) | 2/3 | 2/2 | 4/5 |
| Qwen3.6-27B | 2/3 | 2/2 | 4/5 |
| Qwen3.5-4B (judge) | 2/3 | 2/2 | 4/5 |

**Notable finding**: the current production **primary** (35B-A3B) is one of only three models that *didn't* score a perfect 5/5 — four other models did, including two size tiers already in the comparison rotation (80B GPTQ, 122B AWQ) and both Gemma models. All three 4/5 scores failed on Tier A only (`palindrome` for the primary, `expr_eval` for the other two) — Tier B tool-calling was 2/2 across the board for every model tested. Worth weighing against the speed data before any primary-swap decision: Gemma-4-26B-A4B-it is now both the fastest model tested this session (50.38 tok/s @c8) *and* a perfect coding score — the strongest combined result of any model.

**Caveat on the primary's score**: `results/qwen3.6-35b-a3b.json` was captured *before* the reasoning-trace-fallback fix (the third harness bug fixed this session) — its `palindrome` failure is exactly the failure mode that fix targets. Time constraints meant it wasn't re-run under the final harness version like the other six models were, so 4/5 for the primary is likely a conservative floor, not a fully apples-to-apples number. Worth a one-off re-run before treating this table as final.

### Decision Log — 2026-07-23 (later still): Phase 3 optimization — AITER tested, doesn't work

**Item (a) of the optimization plan is DONE — real, negative result.** Before touching anything, confirmed via vLLM's own `envs.py` source (read directly inside the running `vllm-primary` container) that `VLLM_ROCM_USE_AITER` is a master switch defaulting to **False** ("Disable aiter ops unless specifically enabled"), and it isn't set anywhere in this stack's configuration — meaning AITER has been fully off, by default, for every model benchmarked so far this session. This directly resolves the open question from the 2026-07-22 report ("AITER fused MoE kernels untested").

Tested enabling it: swapped in the 35B-A3B primary model with `SWAP_ENV_VARS='VLLM_ROCM_USE_AITER=1'` via `swap_model_start.sh`, same serve flags as the standing primary. **Result: immediate engine crash**, not a slow start or a benchmark artifact — `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xc9 in position 215: invalid continuation byte` while registering an AITER torch op via `torch._C._jit_get_operation`, during initial engine core startup before any model-specific work runs at all. This isn't an AWQ-specific interaction (the 122B tier's known issue, worked around via `VLLM_USE_TRITON_AWQ=1`) — it's a fundamental incompatibility between this AITER build and this exact toolbox image/hardware combination, for a plain bf16 MoE model with no quantization involved. Recovery was fully automatic — `swap_model_start.sh`'s own health-check-failure path restored the standard stack without manual intervention.

**Conclusion**: AITER being off (the current default) is the *correct* configuration for this hardware, not an untested opportunity being left on the table. Not worth revisiting without a different toolbox/AITER build.

**Confirmed universal across architectures (2026-07-23, follow-up)**: re-tested `VLLM_ROCM_USE_AITER=1` on Qwen3-Coder-Next-GPTQ-4bit (80B) and Gemma-4-26B-A4B-it — **both crash identically** to the original 35B-A3B test (same `UnicodeDecodeError` in `torch._C._jit_get_operation`, just a different byte offset each time, same underlying failure). Three distinct architectures now confirmed broken (Qwen dense-MoE, Qwen GPTQ, Gemma) — conclusive that this is a toolbox/hardware-level incompatibility affecting every model tested, not something specific to one architecture. Closing this investigation out for good; no further AITER testing planned without a different toolbox image.

**Item (b) is DONE — real, but marginal, result.** Tested the 122B AWQ tier without `--enforce-eager` (still keeping `VLLM_USE_TRITON_AWQ=1`, same everything else). **It starts and runs successfully without `enforce-eager`** — contrary to the earlier session's note that it was "required for this model's AWQ kernel path," it's actually optional; the model just wasn't tested without it before. Benchmarked head-to-head against the original enforce-eager baseline:

| | c1 (enforce-eager baseline) | c1 (no-eager) | c8 (enforce-eager baseline) | c8 (no-eager) |
|---|---|---|---|---|
| Output tok/s | 7.87 | 8.14 | 16.05 | 16.28 |
| TTFT mean/median/p99 (ms) | 3808/3799/4012 | 3743/3582/6114 | 20383/24833/28927 | 18583/20130/27444 |
| TPOT mean/median/p99 (ms) | 119.88/119.88/120.02 | 115.77/115.78/115.84 | 420.08/405.88/488.59 | 408.13/408.87/458.59 |

**The improvement is real but marginal (~1-9% across metrics), not the dramatic fix the original hypothesis suggested.** `enforce-eager` is *not* actually the main driver of this model's poor concurrency scaling — removing it helps a little on every metric with no regression anywhere, so it's worth adopting, but the model's fundamental slowness at this size on this hardware is the bigger factor, not the eager-mode flag. Tradeoff: slightly slower cold start (410s vs 350s) from CUDA graph capture at startup — worth it for a model that stays loaded, less clear-cut for one that gets swapped in/out frequently like during this session's benchmarking.

**Decided (Chris, 2026-07-23): adopt non-`enforce-eager` as the standing default for this tier.** This model has no compose entry or standing serve script of its own — it's only ever swapped in ad hoc via `swap_model_start.sh qwen3.5-122b-a10b-awq4bit qwen3.5-122b-a10b-awq4bit 65536` with `SWAP_ENV_VARS='VLLM_USE_TRITON_AWQ=1'` — so "adopting the default" means: **going forward, do not pass `--enforce-eager` when swapping this model in.** `VLLM_USE_TRITON_AWQ=1` is still required (that one's a real AWQ-kernel dependency, unrelated to eager mode). The slower ~410s cold start is an accepted tradeoff.

**Bonus: real KV-cache data captured for all four Phase 1/2 comparison models**, closing a gap flagged by the user after reviewing `benchmark-report-2026-07-23.html` — the report's "Concurrency" column for the four newly-benchmarked models had shown disk-size estimates or "n/a" instead of real figures. Captured directly from each model's startup log:
- **122B AWQ (no-eager)**: 73.58 GiB weights, 35.21 GiB KV cache, 1,264,154 tokens, 19.29× max concurrency @65536.
- **Qwen3.6-27B**: 51.1 GiB weights, 57.65 GiB KV cache, 906,957 tokens, 6.92× max concurrency @131072.
- **Gemma-4-31B-it**: 58.9 GiB weights, 50.45 GiB KV cache, 274,525 tokens, 4.19× max concurrency @65536 — notably the *lowest* concurrency headroom of any model tested, consistent with it also being the slowest model under load.
- **Gemma-4-26B-A4B-it**: 48.5 GiB weights, 61.02 GiB KV cache, 1,328,176 tokens, 20.27× max concurrency @65536 — the best combination of small footprint and high concurrency headroom of any model tested, on top of already being the fastest and a perfect coding score.

`docs/benchmark-report-2026-07-23.html` updated with these real figures in place of the earlier placeholders.

**Item (c) is DONE — real negative result, don't adopt.** Tested the 35B-A3B primary at `--max-num-batched-tokens 16384` (double the confirmed default of 8192) against the c8 baseline:

| | Baseline (8192, default) | 16384 |
|---|---|---|
| Output tok/s | 33.19 | 30.09 (**-9%**) |
| TTFT mean/median/p99 (ms) | 6213/5705/11069 | 10250/11243/14521 (**mean +65%, worse across the board**) |
| TPOT mean/median/p99 (ms) | 217.53/212.01/238.60 | 220.70/220.25/257.32 (slightly worse) |

A larger chunked-prefill budget is a real regression here, not a win — live throughput samples mid-run looked promising (35-37 tok/s generation-only), but the full-run aggregate (which correctly accounts for the whole request lifecycle) came out worse on every metric. Likely explanation: a bigger max-batched-tokens value lets larger prefill chunks get scheduled per step, which delays other in-flight requests' first tokens — exactly the TTFT regression observed. Good reminder that live per-second throughput samples during a benchmark run are not a substitute for the final aggregate result.

**Confirmed universal across all 6 models (2026-07-23, follow-up sweep)** — same regression pattern on every single model tested, matching the AITER finding's shape (a toolbox/hardware-level characteristic, not something specific to one architecture):

| Model | Baseline tok/s | 16384 tok/s | Δ throughput | Baseline TTFT mean (ms) | 16384 TTFT mean (ms) | Δ TTFT |
|---|---|---|---|---|---|---|
| Qwen3.6-35B-A3B (primary) | 33.19 | 30.09 | -9.3% | 6213 | 10250 | +65.0% |
| Qwen3-Coder-Next-GPTQ-4bit (80B) | 26.13 | 23.97 | -8.3% | 7291 | 14402 | +97.6% |
| Qwen3.5-122B-A10B-AWQ-4bit | 16.05 | 16.05 | 0% (flat) | 20383 | 23019 | +12.9% |
| Qwen3.6-27B | 17.91 | 16.93 | -5.5% | 29202 | 37539 | +28.6% |
| Gemma-4-31B-it | 11.73 | 11.00 | -6.2% | 31649 | 52476 | +65.8% |
| Gemma-4-26B-A4B-it | 50.38 | 48.47 | -3.8% | 5334 | 9302 | +74.4% |

Every model: throughput flat-to-worse, TTFT consistently and substantially worse (+13% to +98%), TPOT roughly flat or marginally better across the board (never the driver of the regression). **Recommendation, now confirmed with high confidence: keep the default (8192) everywhere, do not adopt 16384 for any model in this lineup.** This closes out item (c) for good — no further per-model testing needed at this value; if chunked-prefill tuning is revisited later, try a *smaller* value than the default instead, since larger clearly hurts across the board.

Phase 3 optimization work complete: (a) AITER — tested, crashes across 3 architectures, correctly left off. (b) non-enforce-eager AWQ for 122B — tested, marginal real improvement, worth adopting. (c) chunked-prefill tuning at 16384 — tested across all 6 models, universal real regression, don't adopt. (d) MTP speculative decoding not attempted this session (unconfirmed ROCm support, same architecture family that broke outright on FP8 — a real experiment for a dedicated session, not a quick test; now tracked as Phase 5 item 5.5).

### Decision Log — 2026-07-23 (later still): Grafana access incident, LiteLLM key, roadmap restructure, Task 4.4

**Grafana access incident — root-caused and fixed.** Chris couldn't log into Grafana and remembered creating an account for `chrisjohnson0@gmail.com` at some point. Investigation (via subagent, read-only first): Grafana's actual SQLite user table has exactly **one** user, `admin` — no `chrisjohnson0@gmail.com` account, no OAuth, no self-signup configured anywhere in this stack. The account Chris remembered is **Open WebUI's** separate first-signup-becomes-admin flow (`WEBUI_AUTH=true`, a different service, port 3001 not Grafana's 3000) — already documented in an earlier decision log entry. Fixed by resetting Grafana's admin password via its own supported `grafana cli admin reset-admin-password` tool and updating `GRAFANA_ADMIN_PASSWORD` in the gitignored `docker/.env` to match; verified working via a live API call. New password was handed to Chris directly in conversation (not written to any tracked file, consistent with secrets hygiene) — if it's needed again and lost, the fix is the same reset command, not recovery of the old value.

**Chris's LiteLLM virtual key generated** (Task 3.6, partial) — `/key/generate` API, alias `chris-master`, unrestricted, verified against `/v1/models`. Drew's rate-limited edge key still needs real rate-limit/route-blocking parameters decided before creation (Task 6.2).

**Roadmap restructured into 8 phases** (was 4) — Phases 5-8 added per Chris's direction: Phase 5 (Model Research & Continuous Optimization, open-ended, scope explicitly includes alternate serving paths like Lemonade/Ollama and MTP research, not just flag-tuning), Phase 6 (Multi-Tenant & Control Plane Verification — Turnstone, Drew's key/edge access, Herdr/Hermes, backups, moved out of Phases 3/4), Phase 7 (Review, Codify, Rebuild — full audit against this repo then an actual wipe-and-rebuild to prove reproducibility; Task 7.3, the actual wipe, is a hard-stop needing explicit go-ahead), Phase 8 (Day-N Operations Documentation — split this README into kanban items + a project AGENTS.md + a proper human-facing README, preserving the decision-log history rather than discarding it). Phase 3 is now fully complete; Phase 4 trimmed to just Grafana/observability.

**Task 4.4 complete** — see Section 8 for the full writeup. Real finding: node-exporter's hwmon collector already surfaces GPU temp/power/clock for free; a new textfile-collector script (`scripts/amdgpu-metrics.sh`) + 10s systemd timer covers the amdgpu-specific values (busy %, GTT/VRAM) hwmon doesn't. Dashboard grew from 10 to 17 panels.

**Explicit standing instruction from Chris**: do not start Phase 5 (or anything beyond it) without checking in first. The batching sweep and Task 4.4 were both completed and reported; work is currently paused here awaiting his go-ahead.

### Open Next Steps — resume here after context compaction

Precise state as of this update, written for picking back up with zero prior context:

- **Phases 1-4 are COMPLETE.** Speed benchmarking (all 7+1 models), coding-capability eval (7/7 models), Phase 3 optimization work (AITER tested/rejected across 3 architectures, non-eager AWQ for 122B tested as a marginal real win and adopted as the new default, chunked-prefill tuning tested as a universal regression across all 6 models and rejected), and Phase 4 observability (Grafana dashboard now 17 panels, real GPU/disk/network metrics wired up).
- **Phase 5 has started (Chris gave the go-ahead 2026-07-23)**, ordered to front-load anything that depends on him before he's away for an extended period: 5.1 (research candidates) and 5.2 (present candidates, get download approval) come first, ahead of the fully-autonomous 5.3-5.7 work. The 122B non-eager-AWQ decision was raised and resolved immediately per that ordering (see below). **Standing rule, not a one-time gate: check in before starting any new model download**, every time, regardless of how routine the candidate looks — this applies within 5.2 and to any download 5.5 (MTP)/5.6 (Lemonade/Ollama) turn out to need.
- **122B non-`enforce-eager` decision: RESOLVED.** Chris chose to adopt it as the standing default (2026-07-23) — going forward, swap this model in *without* `--enforce-eager` (keep `VLLM_USE_TRITON_AWQ=1`). See the Phase 3 optimization decision-log entry for the full before/after numbers and the accepted ~410s vs 350s cold-start tradeoff.
- **Optional cleanup, not yet done**: re-run `scripts/coding_benchmark.py` against the primary (35B-A3B) under the exact final harness version — its saved 4/5 score predates the harness's last bug fix and is likely a conservative floor, not fully apples-to-apples with the other six models' scores.
- **Both benchmark phases' results are folded into `docs/benchmark-report-2026-07-23.html`** (supersedes the 2026-07-22 report, which is preserved not deleted, as the pre-optimization baseline). Phase 4 of the *original* benchmark plan — re-running everything into a new post-optimization comparison report — hasn't happened yet; folded into Phase 5's item 5.4 (continuously expand the report) going forward rather than being its own separate step.
- **Firewall gap: FIXED** (not just worked around) — root cause was NixOS's built-in `ct status dnat accept` forward-chain rule (not `extraForwardRules`, which was solving a different, real problem). `vllm-primary`/`vllm-judge` and the swap scripts now bind to `127.0.0.1:8000`/`127.0.0.1:8001`, not `0.0.0.0` — direct LAN access to those ports no longer works at all. Reach them via SSH tunnel (`ssh -f -N -L 18000:localhost:8000 -L 18001:localhost:8001 chris@local-ai-machine.local`) or from the target itself. LiteLLM on port 4000 is the only externally-reachable gateway now, for real.
- **Grafana admin password was reset this session** (see decision log above) — new value was given to Chris directly, not written to any tracked file. If needed again, the reset mechanism (`grafana cli admin reset-admin-password`) is documented; the value itself isn't recoverable, only resettable.
- **Chris's LiteLLM key exists** (`chris-master` alias, unrestricted) — use LiteLLM (port 4000) for regular API access going forward, not the raw master key. Drew's scoped key is still open (Task 6.2).
- Production stack (`vllm-primary`, `vllm-judge`) should be up and serving normally — confirmed healthy as of this update, but always worth a `docker ps` sanity check given how many swap cycles this session has done.
- **Feedback logged this session**: don't run other GPU workloads concurrently with an in-flight speed benchmark — keep phases strictly sequential per model.

---

## 9. Implementation Directives for Coding Agent

1. **Strict Declarative State:** Do NOT issue manual `apt`, `pip`, or `systemctl` commands directly on the host that are not defined in `configuration.nix` or `docker-compose.yml`.
2. **Secrets Hygiene:** Store all passwords, tokens, and credentials in the `secrets/` directory or `.env` files. Ensure `.gitignore` excludes sensitive files.
