# Architecture, Planning, & Handoff Specification: Bosgame M5 AI Node

**Target Device:** Bosgame M5 AI (AMD Ryzen AI Max+ 395 "Strix Halo", 128GB LPDDR5X Unified RAM, 2TB NVMe)
**Host Architecture:** NixOS (Flakes) Declarative OS + Docker Compose Container Stack
**Primary Purpose:** Dedicated, repeatable ("cattle, not pets") local AI server executing high-throughput inference (70B/72B models), agent control planes (Turnstone & Hermes Agent), LiteLLM API proxy, and automated Synology NAS state backups.

---

## 1. Executive Summary & Design Principles

1. **Cattle, Not Pets:** The physical host OS is completely declared via a single Git-backed Nix Flake (`flake.nix` & `configuration.nix`). If the host drive fails or needs to be redeployed, a fresh install converts into an identical state in minutes via `nixos-rebuild switch`.
2. **Unified Memory Allocation:** The Ryzen AI Max+ 395 APU (`gfx1151`) shares 128GB of LPDDR5X RAM between CPU and iGPU. Kernel parameters (`amdgpu.gttsize=126976`, `ttm.pages_limit=32505856`, `amd_iommu=off`) allocate ~124GB as high-speed VRAM to support 70B/72B models (e.g., Qwen 2.5/3, Llama 3) loaded permanently in VRAM with zero cold-start delay.
3. **Headless Execution:** Desktop display managers are disabled (`multi-user.target`) to eliminate GUI VRAM overhead.
4. **Client-Server Boundary:** External clients (Mac Mini, OpenCode, remote VPN peers) interact *only* through API endpoints exposed by the LiteLLM Proxy (Port 4000) or web UI consoles (Turnstone Port 8080).
5. **Dual Agent Control Plane:**
   - **Turnstone:** Provides structured multi-node orchestration, MCP server integration, and LLM-based safety intent validation for risky tool executions.
   - **Hermes Agent:** Acts as an autonomous background daemon featuring a 3-tier memory system (`USER.md`, `MEMORY.md`), auto-skill generation (`SKILL.md`), and multi-platform messaging gateways (Telegram/CLI).

---

## 2. Target Repository Structure

The GitOps repository (`local-ai-machine`) contains all code, declarations, and configurations required to construct and run the system.

```text
local-ai-machine/
├── flake.nix                  # Flake entrypoint referencing host configuration
├── configuration.nix          # Declarative OS, kernel params, systemd, backups
├── hardware-configuration.nix # Auto-generated host hardware specs
├── secrets/
│   ├── synology_backup_key    # SSH private key for ai_backup_svc (rsync-over-SSH)
│   └── wifi.env               # Fallback WiFi SSID/PSK (NetworkManager)
├── docker/
│   ├── docker-compose.yml     # Container stack (vLLM, LiteLLM, Turnstone, Hermes, Prometheus, Grafana)
│   ├── litellm/
│   │   └── config.yaml        # Model routes, virtual keys, usage tracking, fallbacks
│   ├── prometheus/
│   │   └── prometheus.yml     # Metric scraping targets
│   └── grafana/
│       └── dashboards/
│           └── strix-halo.json# VRAM, power draw, and thermals dashboard
└── scripts/
    └── sync-backup.sh         # Manual trigger for the rsync backup mirror
```

---

## 3. NixOS System Configuration (`flake.nix` & `configuration.nix`)

### `flake.nix`
```nix
{
  description = "Bosgame M5 AI Node - Declarative System Flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }@inputs: {
    nixosConfigurations.local-ai-machine = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./hardware-configuration.nix
        ./configuration.nix
      ];
    };
  };
}
```

### `configuration.nix`
```nix
{ config, pkgs, ... }:

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

  # 4. Containers & ROCm Graphics Passthrough
  virtualisation.docker = {
    enable = true;
    autoPrune.enable = true;
  };

  hardware.graphics.enable = true;

  # 5. Synology NAS Backup Transport
  # rocm-smi is a CLI monitoring tool, not a driver — belongs on PATH via
  # systemPackages, not hardware.graphics.extraPackages (that's for driver
  # libraries the graphics stack loads, not user-facing commands).
  environment.systemPackages = with pkgs; [ rsync docker-compose git rocmPackages.rocm-smi ];

  # 6. Automated Daily Rsync Mirror to Synology (native rsync-over-SSH, not
  # CIFS — simpler and more standard for this workload; auth is an SSH key
  # for ai_backup_svc, not an SMB password).
  # Unencrypted by design (NAS is a trusted walled garden; use whole-disk
  # encryption on the NAS itself if that's ever needed). Versioning/point-in-time
  # recovery is handled by DSM's own Btrfs snapshot scheduler on the backups
  # share, not by this job — this just mirrors current state.
  # NAS-side path: /volume1/tank/backups/local-ai-machine
  systemd.services.synology-backup = {
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
      ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /var/lib/docker/volumes/hermes_data/ "${remote}/hermes_data/"
      ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /etc/nixos/ "${remote}/etc-nixos/"
      ${pkgs.rsync}/bin/rsync -a --delete -e "${rsh}" /home/chris/local-ai-machine/ "${remote}/repo/"
    '';
  };

  systemd.timers.synology-backup = {
    description = "Daily Synology backup mirror";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "03:00";
      Persistent = true;
    };
  };

  # Firewall Rules
  networking.firewall.allowedTCPPorts = [ 22 4000 8080 3000 9090 ];

  system.stateVersion = "24.11";
}
```

---

## 4. Docker Compose Runtime Stack (`docker/docker-compose.yml`)

```yaml
version: '3.8'

services:
  # 1. Inference Engine (Donato Capitella Strix Halo Toolboxes)
  vllm-engine:
    image: kyuz0/amd-strix-halo-vllm:latest
    container_name: vllm-engine
    restart: unless-stopped
    devices:
      - /dev/kfd:/dev/kfd
      - /dev/dri:/dev/dri
    group_add:
      - video
      - render
    security_opt:
      - seccomp:unconfined
    environment:
      - ROCM_PATH=/opt/rocm
      - HSA_OVERRIDE_GFX_VERSION=11.5.1
    volumes:
      - /var/lib/ai-models:/models
    command: >
      --model /models/Qwen2.5-72B-Instruct-GGUF
      --host 0.0.0.0
      --port 8000
      --enable-prefix-caching
      --max-model-len 32768
    ports:
      - "8000:8000"

  # 2. Unified API Gateway
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: litellm-proxy
    restart: unless-stopped
    ports:
      - "4000:4000"
    volumes:
      - ./litellm/config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    depends_on:
      - vllm-engine

  # 3. Turnstone Database & Server
  turnstone-db:
    image: postgres:16-alpine
    container_name: turnstone-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: turnstone
      POSTGRES_USER: turnstone_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - turnstone_postgres_data:/var/lib/postgresql/data

  turnstone-server:
    image: turnstonelabs/turnstone:latest
    container_name: turnstone-server
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://turnstone_user:${DB_PASSWORD}@turnstone-db:5432/turnstone
      OPENAI_API_BASE: http://litellm:4000/v1
      OPENAI_API_KEY: ${LITELLM_MASTER_KEY}
    depends_on:
      - turnstone-db
      - litellm

  # 4. Hermes Autonomous Background Agent
  hermes-agent:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-agent
    restart: unless-stopped
    environment:
      OPENAI_API_BASE: http://litellm:4000/v1
      OPENAI_API_KEY: ${LITELLM_MASTER_KEY}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
    volumes:
      - hermes_data:/root/.hermes
    depends_on:
      - litellm

  # 5. Telemetry & Observability Stack
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
  hermes_data:
```

---

## 5. LiteLLM Proxy Configuration (`docker/litellm/config.yaml`)

```yaml
model_list:
  - model_name: qwen-72b
    litellm_params:
      model: openai/Qwen2.5-72B-Instruct
      api_base: http://vllm-engine:8000/v1
      api_key: "none"

  - model_name: llama-70b
    litellm_params:
      model: openai/Llama-3-70B-Instruct
      api_base: http://vllm-engine:8000/v1
      api_key: "none"

  # Cloud fallback route if local GPU is saturated
  - model_name: claude-3-5-sonnet
    litellm_params:
      model: anthropic/claude-3-5-sonnet-20241022
      api_key: os.environ/ANTHROPIC_API_KEY

router_settings:
  routing_strategy: usage-based-routing-v2

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

---

## 6. Phased Implementation Roadmap

```mermaid
flowchart TD
    P1[Phase 1: Pre-Arrival GitOps Setup] --> P2[Phase 2: Day 0 Host Provisioning]
    P2 --> P3[Phase 3: Day 1 AI Stack Deployment]
    P3 --> P4[Phase 4: Day-N Resilience & Operations]
```

### Phase 1: Pre-Arrival Preparation (START TODAY)
*Objective: Build and validate the entire software stack repository before physical hardware arrives.*

- [x] **Task 1.1: Git Repository Initialization**
  Initialize `local-ai-machine` private repository with the folder structure detailed in Section 2.
- [x] **Task 1.2: Code Nix Flake Declarations**
  Write `flake.nix` and `configuration.nix` matching the parameters in Section 3.
- [x] **Task 1.3: Draft Docker Stack & Gateway Configs**
  Create `docker/docker-compose.yml`, `litellm/config.yaml`, and Prometheus configs.
- [x] **Task 1.4: Prepare Synology NAS Target**
  Restricted service user `ai_backup_svc` created on Synology DSM with read/write access to the `tank` shared folder. Backups land under `tank/backups/local-ai-machine/` (nested by type — Postgres volume, Hermes data, `/etc/nixos`, repo). SSH enabled on the DSM (Control Panel → Terminal & SNMP), and `secrets/synology_backup_key.pub` added as that user's authorized SSH key (DSM 7+: User & Group → select user → Edit → SSH Public Key). Backup transport is rsync-over-SSH, not SMB — no password to manage. *(Manual DSM steps — not scriptable from this repo.)*
- [x] **Task 1.5: Populate Local Secrets**
  `secrets/synology_backup_key`/`.pub` generated locally (gitignored; the `.pub` half was pasted into DSM per Task 1.4). Copy `secrets/wifi.env.example` → `secrets/wifi.env` and fill in a fallback WiFi SSID/password — NetworkManager uses this only when no wired connection is present.

### Phase 2: Host Provisioning (Day 0 - Hardware Arrival)
*Objective: Prepare physical hardware and apply the declarative OS configuration.*

**Peripheral setup note:** the M5's video output is HDMI/DP only; the available monitor is DVI-only. Bring-up needs a passive HDMI→DVI adapter cable (HDMI and DVI-D carry the same digital signal, no active converter required). For durable local console access afterward (not just this one install), route both this machine and the currently-DVI-connected server through a small 2-port DVI KVM switch — monitor into the KVM's output, each host into an input (the M5 via the same HDMI→DVI adapter), one shared keyboard via the KVM's USB switching. No mouse needed; the M5 never runs a display manager, so console access is TTY-only.

- [x] **Task 2.0: Real SSH Key**
  Replace the placeholder key in `configuration.nix:26` (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... chris@macmini`) with your actual Mac Mini public key (`cat ~/.ssh/id_ed25519.pub`, generating one first if it doesn't exist). This is the *only* configured way into `chris`'s account post-install — no password is set, so a wrong/placeholder key here means physical-console-only until corrected.
- [x] **Task 2.1: Base NixOS Install**
  Flashed a NixOS unstable Minimal ISO to USB (the 24.11 default kernel didn't support the M5's MediaTek MT7925 WiFi chip; unstable's newer kernel does). Booted via WiFi at a staging location without Ethernet access — NetworkManager (`nmcli`) handled the connection. Partitioned the 2TB NVMe (1GB FAT32 ESP + ext4 root, wiping the factory Windows install), ran `nixos-generate-config`, and copied the repo over.
- [x] **Task 2.2: Go Remote Early**
  Authorized the Mac's key via `curl https://github.com/chrisjohnson.keys > ~/.ssh/authorized_keys` on the live session, then SSH'd in as the `nixos` user (not `root` — live ISO default). From there the Mac drove partitioning, config copy, and `nixos-install` directly over SSH.
- [x] **Task 2.3: Apply System Flake & Reboot**
  Installed and rebooted successfully over several iterations while chasing real bugs found along the way: `services.openssh.enable` was never actually set (nothing was reachable post-reboot until fixed), `users.mutableUsers` defaults to `true` so a password set on an already-existing account silently never applies (had to set it `false` for `hashedPasswordFile` to actually take effect), and the MediaTek MT7925 WiFi driver needed to be forced via `boot.kernelModules` since udev's automatic loading proved unreliable on this board. SSH (key auth) and local console (password, SSH-inaccessible) both confirmed working across reboots.
- [x] **Task 2.4: Verify iGPU Memory Allocation**
  BIOS defaulted `iGPU Configuration` to `Auto`, which silently carved out a fixed 64GB as static VRAM — invisible in `free -h` and not what the Strix Halo unified-memory design intends. Fixed via `Advanced → GFX Configuration → iGPU Configuration → UMA_SPECIFIED`, then set `UMA Frame Buffer Size` to its smallest option (1GB). Confirmed: `free -h` now shows 124GiB system RAM, `rocm-smi` shows 1GiB static VRAM — the GPU can draw on nearly the full 124GB via GTT (`amdgpu.gttsize`/`ttm.pages_limit`), matching the original design intent.

### Phase 3: AI Stack Deployment (Day 1)
*Objective: Deploy models, runtime containers, API proxy, and agent gateways.*

- [ ] **Task 3.1: Model Staging**
  Download target GGUF/Safetensor model weights to `/var/lib/ai-models`.
- [ ] **Task 3.2: Container Spin-up**
  Navigate to `docker/` and execute `docker compose up -d`.
- [ ] **Task 3.3: Endpoint Validation**
  Query LiteLLM at `http://<BOSGAME_IP>:4000/v1/chat/completions` from Mac Mini / OpenCode to verify inference speed and context caching.
- [ ] **Task 3.4: Agent Control Plane Verification**
  Access Turnstone Console (`http://<BOSGAME_IP>:8080`) and verify Hermes Agent responsiveness over CLI/Telegram.

### Phase 4: Day-N Operations & Resilience
*Objective: Validate backups, telemetry, and automated maintenance.*

- [ ] **Task 4.1: Execute Backup Mirror Test**
  Run `scripts/sync-backup.sh` (or `systemctl start synology-backup.service`) manually and verify the files land under `tank/backups/local-ai-machine/` on the Synology. Confirm DSM's Btrfs snapshot schedule is enabled on the `tank` share — that's what provides point-in-time recovery, since the mirror itself only holds current state.
- [ ] **Task 4.2: Grafana Dashboard Baseline**
  Open Grafana (`http://<BOSGAME_IP>:3000`) and establish baseline metrics for VRAM utilization, power draw, and thermals under full model load.

---

## 7. Implementation Directives for Coding Agent

1. **Strict Declarative State:** Do NOT issue manual `apt`, `pip`, or `systemctl` commands directly on the host that are not defined in `configuration.nix` or `docker-compose.yml`.
2. **Secrets Hygiene:** Store all passwords, tokens, and credentials in the `secrets/` directory or `.env` files. Ensure `.gitignore` excludes sensitive files.
