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
│   ├── docker-compose.yml     # vLLM x2, Ollama sandbox, LiteLLM, Turnstone, Herdr-adjacent, Prometheus, Grafana
│   ├── .env.example           # Template for LITELLM_MASTER_KEY, LITELLM_DB_PASSWORD, DB_PASSWORD, TURNSTONE_JWT_SECRET, ANTHROPIC_API_KEY
│   ├── litellm/
│   │   └── config.yaml        # Model routes, virtual keys per tenant, rate limits
│   # No docker/turnstone/ directory — Turnstone's own config is TOML at
│   # ~/.config/turnstone/config.toml (0600) inside the container, not a
│   # bind-mounted YAML file; that judge/reranker wiring is still deferred
│   # (Task 3.5).
│   ├── prometheus/
│   │   └── prometheus.yml     # Metric scraping targets
│   └── grafana/
│       └── dashboards/
│           └── strix-halo.json # VRAM, power draw, and thermals dashboard
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

        E --> H
        F --> H
        G --> H
    end

    subgraph Governance & Tool Services [Turnstone Platform]
        I[Turnstone Server - Port 8080\n- Safety Judge on Port 8001\n- Deferred BM25 MCP Tool Gateway\n- turnstone-eval & turnstone-doctor]
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

    subgraph Telemetry [Observability]
        P[Prometheus - Port 9090]
        Q[Grafana - Port 3000\nVRAM, power draw, thermals]
        P --> Q
    end

    subgraph External Clients & Multi-Tenancy [Hybrid Access]
        L[Local Laptop: OpenCode / Pi\nDirect Local Shell Execution]
        M[Edge Friend: Drew's Laptop\nLocal Hermes/OpenCode -> WireGuard VPN]
        N[Phone: Telegram App\nMulti-Topic Supergroup]

        L -- sk-chris-master --> H
        M -- sk-drew-edge Rate Limited --> H
        N <--> J
    end
```

---

## 3. Declarative System Nix Configuration (`configuration.nix`)

This mirrors the actual deployed file exactly. `herdr`'s package/service and the `drew` account are applied; `drew` has no SSH key wired up yet (public keys aren't secrets — when available it goes straight into `authorizedKeys.keys` as a string literal, same as chris's).

```nix
{ config, pkgs, lib, ... }:

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
  environment.systemPackages = with pkgs; [ rsync docker-compose git rocmPackages.rocm-smi herdr ];

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
    ];
    mkModelDownloadService = { name, repo }: {
      description = "Download ${repo} to /var/lib/ai-models/${name}";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = "!/var/lib/ai-models/${name}/.download-complete";
      serviceConfig = {
        Type = "oneshot";
        User = "chris";
        EnvironmentFile = "-/etc/nixos/secrets/hf-token.env";
      };
      script = ''
        set -euo pipefail
        export HF_HUB_DISABLE_XET=1
        export HF_HUB_DOWNLOAD_TIMEOUT=120
        export HF_HUB_ETAG_TIMEOUT=900
        ${pkgs.nix}/bin/nix --extra-experimental-features "nix-command flakes" shell nixpkgs#python3Packages.huggingface-hub \
          --command hf download ${repo} --local-dir /var/lib/ai-models/${name}
        touch /var/lib/ai-models/${name}/.download-complete
      '';
    };
  in (lib.listToAttrs (map (m: {
    name = "download-model-${m.name}";
    value = mkModelDownloadService m;
  }) models)) // {
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

  systemd.timers.synology-backup = {
    description = "Daily Synology backup mirror";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "03:00";
      Persistent = true;
    };
  };

  # Firewall Rules — 8080 (Turnstone, plain HTTP for now — no Caddy/TLS
  # sidecar deployed yet, see docker-compose.yml), 11434 (Ollama sandbox,
  # not yet running but staged) alongside SSH/LiteLLM/Grafana/Prometheus.
  # 8443 dropped: that's Turnstone's upstream Caddy-fronted HTTPS dashboard
  # port, which we don't run — nothing listens there in this first pass.
  networking.firewall.allowedTCPPorts = [ 22 4000 8080 3000 9090 11434 ];

  system.stateVersion = "24.11";
}
```

**New in this update: declarative model downloads.** Previously, getting model weights onto the machine required a manual `hf download` session over SSH after every fresh install. Now `systemd.services` generates one `download-model-<name>` oneshot unit per entry in the `models` list above (currently `qwen3.6-35b-a3b` and `qwen3.5-4b`), each `wantedBy = [ "multi-user.target" ]` so it runs automatically on every boot, gated by a `.download-complete` marker file (not just directory existence, so a partial download retries rather than silently passing as done), and reusing the exact `HF_HUB_DISABLE_XET`/timeout env vars and `hf download` invocation already proven reliable on this network path (see Task 3.1). This means a freshly flashed machine reaches full model availability from `nixos-rebuild switch` alone — no manual download step required — directly fulfilling the goal of driving model downloads from the flake so the box can be reflashed and rebuilt easily.

---

## 4. Containerized Runtime Stack (`docker/docker-compose.yml`)

First-pass model set: **Qwen3.6-35B-A3B** (bf16, primary) + **Qwen3.5-4B** (judge/quick tasks). This is a deliberate narrowing from a broader 9-model exploration (Qwen3-Coder-Next, Qwen3.6-27B/35B-A3B, Gemma4-31B/26B-A4B, MiniMax-M2, DeepSeek-V4-Flash as other primary-candidate options; Qwen2.5-VL-7B for OCR/screenshots) — those alternatives, plus vision and the Ollama sandbox, aren't wired into compose yet since only the two first-pass models are actually staged/staging on disk.

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

volumes:
  turnstone_postgres_data:
  litellm_postgres_data:
  vllm_primary_cache:
  vllm_judge_cache:
```

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
| **Compute** | **vLLM Primary** | Qwen3.6-35B-A3B (bf16) coder slot (`--tool-call-parser qwen3_coder`) | `http://localhost:8000/v1` |
| **Compute** | **vLLM Judge** | Qwen3.5-4B — quick tasks and Turnstone safety judge | `http://localhost:8001/v1` |
| **Compute** | **Ollama Sandbox** | Lazy-load testing for new model compositions — not yet wired into compose | `http://localhost:11434` |
| **Gateway** | **LiteLLM** | Virtual keys (`sk-chris`, `sk-drew`, generated via `/key/generate`, not static config), parallel tool passing | `http://localhost:4000/v1` |
| **Governance**| **Turnstone** | Qwen3.5-4B safety judge, deferred BM25 MCP gateway, evals/doctor | `http://localhost:8080` |
| **Control** | **Herdr Daemon** | PTY multiplexer, state tracking (`🔴 Blocked`, `🟡 Working`) | `/run/user/1000/herdr.sock` |
| **Control** | **Hermes Agent** | 24/7 Telegram topic router, profiles, memory, skills | Phone Telegram / Socket |
| **Execution** | **OpenCode** | LSP diagnostics, AST parsing, multi-file editing | Local Shell / Server Attach |
| **Execution** | **Claude Code** | Headless Auto Mode under Anthropic ML Classifier | Server Subshell / Herdr |
| **Execution** | **Pi Agent** | Ultra-minimal 4-tool primitive harness & TS extensions | Local Terminal / Herdr |
| **Telemetry** | **Prometheus** | Metric scraping | `http://localhost:9090` |
| **Telemetry** | **Grafana** | VRAM, power draw, thermals dashboards | `http://localhost:3000` |

---

## 8. Phased Implementation Roadmap

```mermaid
flowchart TD
    P1[Phase 1: Pre-Arrival GitOps Setup] --> P2[Phase 2: Day 0 Host Provisioning]
    P2 --> P3[Phase 3: Day 1 AI Stack Deployment]
    P3 --> P4[Phase 4: Day-N Resilience & Operations]
```

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

### Phase 3: AI Stack Deployment (Day 1)
*Objective: Deploy the dual-vLLM slots, gateway, governance, and control-plane services.*

- [x] **Task 3.1: Model Staging (first pass)**
  Explored 9 model candidates (Qwen3-Coder-Next, Qwen3.6-27B/35B-A3B, Gemma4-31B/26B-A4B, MiniMax-M2, DeepSeek-V4-Flash, Qwen2.5-VL-7B for OCR, Qwen3.5-4B for judge) before narrowing the first real pass to **Qwen3-Coder-Next-FP8** (primary) + **Qwen3.5-4B** (judge). Originally started downloading GGUF quants for vLLM, then caught the format mismatch — GGUF is llama.cpp's format, not vLLM's; switched to the native `Qwen/Qwen3-Coder-Next-FP8` safetensors checkpoint (~80GB, day-0 vLLM ≥0.15.0 support) and `Qwen/Qwen3.5-4B` BF16 (~9GB) via `hf download`, staged to `/var/lib/ai-models/{qwen3-coder-next-fp8,qwen3.5-4b}` and confirmed complete (40/40 and 2/2 safetensors shards, no `.incomplete` files left). Root cause of repeated multi-hour download stalls (persisted across both WiFi and Ethernet) turned out to be `hf-xet`, huggingface_hub's newer accelerated transfer backend, hanging on this network path — `HF_HUB_DISABLE_XET=1` plus longer `HF_HUB_DOWNLOAD_TIMEOUT`/`HF_HUB_ETAG_TIMEOUT` fixed it. Both now set permanently via `environment.variables`, with `HF_TOKEN` support added too (sourced from a gitignored secrets file at shell login) for better unauthenticated-rate-limit headroom on future downloads.
  **Same-day pivot:** the FP8 primary checkpoint was then dropped in favor of **Qwen3.6-35B-A3B (bf16)** — see the full reasoning in Section 4 (gfx1151 has no FP8 matrix-core hardware at all; real-world reports confirm Qwen3-Next-family FP8 fails to load on this exact toolbox/hardware, not just runs slow). The old `qwen3-coder-next-fp8` download (~75GB) is still sitting on disk at `/var/lib/ai-models/qwen3-coder-next-fp8`, orphaned and no longer referenced by any config — a future cleanup item. Model staging is now also declarative going forward (see Task 3.2/Section 3) — `download-model-qwen3.6-35b-a3b` and `download-model-qwen3.5-4b` systemd services replace manual `hf download` sessions for future rebuilds.
- [x] **Task 3.2: Apply configuration.nix Additions**
  Added the `drew` user (no SSH key yet — public keys aren't secrets, so it'll go inline as a string literal when available, not into `secrets/`), the `herdr` package + systemd user service, and expanded firewall ports (11434; 8443 later dropped — see below). Also fixed a stale reference caught along the way: the Synology backup script was still targeting `/var/lib/docker/volumes/hermes_data/`, a leftover from when Hermes ran as a docker container — corrected to `/home/chris/.hermes/` and `/home/chris/.herdr/` matching the actual host-level architecture.
  **Same-day follow-up:** dropped port 8443 from the firewall (nothing listens there — no Caddy/TLS sidecar deployed in front of Turnstone) and added the declarative `download-model-*` systemd services described in Section 3, so model weights are fetched automatically on boot instead of requiring a manual SSH session.
- [ ] **Task 3.3: Container Spin-up — IN PROGRESS, model swap mid-flight**
  `docker compose up -d` from `docker/` — vLLM primary + judge, LiteLLM (+ its own Postgres), Turnstone (+ its Postgres), Prometheus, Grafana. Ollama sandbox not included yet (no models staged for it).
  **Status:** Discovered the target machine's `/home/chris/local-ai-machine/docker/` files (`docker-compose.yml`, `litellm/config.yaml`) were still the original Phase 1 scaffolding — old model names (Qwen2.5-72B) and old container names (`vllm-engine`/`hermes-agent`) — despite multiple config commits over the course of Phase 3. Only `configuration.nix` had actually been kept in sync via targeted rsync calls; the rest of the repo never was. Fixed with a full repo rsync (excluding `.git`, `.claude`, `hardware-configuration.nix`, `flake.lock`) from the Mac worktree to `/home/chris/local-ai-machine/` on the target; confirmed `docker-compose.yml` now matches exactly via `diff`. Generated `docker/.env` credentials locally (`LITELLM_MASTER_KEY`, `LITELLM_DB_PASSWORD`, `DB_PASSWORD` via `openssl rand`; `ANTHROPIC_API_KEY` left blank — optional, only needed for the `claude-sonnet` cloud-fallback route) — pushed to the target. Added `docker/.env.example` documenting these vars, consistent with the `secrets/*.env.example` pattern; `docker/.env` itself is already covered by the bare `.env` entry in `.gitignore`.
  First `docker compose up -d` attempt **failed** with a real pull-access-denied error: `kyuz0/amd-strix-halo-vllm:latest` and `turnstonelabs/turnstone:latest` are both hallucinated image references that don't exist on Docker Hub (corrected to `docker.io/kyuz0/vllm-therock-gfx1151:latest` and `ghcr.io/turnstonelabs/turnstone:latest` — see Section 4). While fixing that, the primary model itself was swapped from Qwen3-Coder-Next-FP8 to Qwen3.6-35B-A3B (bf16) for the hardware-support reasons detailed in Section 4, and Turnstone's env vars/config mount were corrected against its actual docs (also Section 4).
  **Current state:** the corrected `docker-compose.yml`, `configuration.nix`, and `litellm/config.yaml` have been pushed to the target and a `nixos-rebuild switch` was just triggered, which kicks off the Qwen3.6-35B-A3B download automatically via the new declarative systemd service (Section 3) — this is a large download, likely still in progress. `docker compose up -d` has **not** been run yet with the corrected model/images — the earlier attempt failed on the bad image reference and was never successfully retried, and now depends on the model download finishing first.
  **Next:** wait for the `download-model-qwen3.6-35b-a3b` systemd service to complete, then run `docker compose up -d` from `docker/`, verify all containers (vllm-primary, vllm-judge, litellm-db, litellm, turnstone-db, turnstone, prometheus, grafana) come up healthy end-to-end.
- [ ] **Task 3.4: Endpoint Validation**
  Confirm both vLLM slots respond directly (`qwen3.6-35b-a3b`, `qwen3.5-4b-judge`), LiteLLM routes `coder`/`judge`/`governed_coder` correctly, and verify inference speed / prefix caching behavior under load.
- [ ] **Task 3.5: Turnstone Judge & Governed Route Verification**
  Confirm Turnstone's safety judge (Qwen3.5-4B judge slot) actually intercepts and evaluates `governed_coder` requests as intended, and that `turnstone-eval`/`turnstone-doctor` run cleanly. Wiring `vllm-judge` in as Turnstone's judge/reranker model has no env-var equivalent — it's TOML-config (`~/.config/turnstone/config.toml`) or console-UI only, so writing that config is real remaining work here, not just plumbing that got skipped.
- [ ] **Task 3.6: Multi-Tenant Key Verification**
  Generate `sk-chris-master` and `sk-drew-edge` via LiteLLM's `/key/generate` API (not static config — see Section 5). Confirm chris has full access and drew is correctly rate-limited and blocked from cloud/governed-admin routes.
- [ ] **Task 3.7: Herdr & Hermes Control Plane Verification**
  Verify the Herdr daemon socket is reachable, panes spawn correctly, and Hermes' Telegram topic routing + sub-agent delegation rules (Section 6) behave as documented.

### Phase 4: Day-N Operations & Resilience

- [ ] **Task 4.1: Execute Backup Mirror Test**
  Run `scripts/sync-backup.sh` (or `systemctl start synology-backup.service`) and verify files land under `tank/backups/local-ai-machine/` on the Synology, including the new `hermes/` and `herdr/` paths. Confirm DSM's Btrfs snapshot schedule is enabled on the `tank` share for point-in-time recovery.
- [ ] **Task 4.2: Grafana Dashboard Baseline**
  Open Grafana (`http://<host>:3000`) and establish baseline metrics for VRAM utilization, power draw, and thermals under full dual-vLLM load.
- [ ] **Task 4.3: Edge Access Verification**
  Confirm Drew's WireGuard VPN path to the LiteLLM/Hermes endpoints works end-to-end with `sk-drew-edge`, respecting rate limits.

---

## 9. Implementation Directives for Coding Agent

1. **Strict Declarative State:** Do NOT issue manual `apt`, `pip`, or `systemctl` commands directly on the host that are not defined in `configuration.nix` or `docker-compose.yml`.
2. **Secrets Hygiene:** Store all passwords, tokens, and credentials in the `secrets/` directory or `.env` files. Ensure `.gitignore` excludes sensitive files.
