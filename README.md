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
├── configuration.nix          # Declarative OS, kernel params, systemd, SMB mounts
├── hardware-configuration.nix # Auto-generated host hardware specs
├── secrets/
│   └── smb-credentials.env    # Synology SMB user credentials
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
    nixosConfigurations.bosgame-ai = nixpkgs.lib.nixosSystem {
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

  # 2. System State & Headless Mode
  systemd.defaultUnit = "multi-user.target";
  networking.hostName = "bosgame-ai";

  # 3. User & Hardware Access Groups
  users.users.chris = {
    isNormalUser = true;
    extraGroups = [ "wheel" "docker" "render" "video" ];
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... chris@macmini"
    ];
  };

  # 4. Containers & ROCm Graphics Passthrough
  virtualisation.docker = {
    enable = true;
    autoPrune.enable = true;
  };

  hardware.graphics = {
    enable = true;
    extraPackages = with pkgs; [ rocmPackages.rocm-smi ];
  };

  # 5. Synology NAS SMB/CIFS Mount
  environment.systemPackages = with pkgs; [ cifs-utils rsync docker-compose git ];

  fileSystems."/mnt/synology" = {
    device = "//synology.local/ai_backups";
    fsType = "cifs";
    options = [
      "x-systemd.automount"
      "noauto"
      "x-systemd.idle-timeout=60"
      "credentials=/etc/nixos/secrets/smb-credentials.env"
      "uid=1000"
      "gid=100"
    ];
  };

  # 6. Automated Daily Rsync Mirror to Synology
  # Unencrypted by design (NAS is a trusted walled garden; use whole-disk
  # encryption on the NAS itself if that's ever needed). Versioning/point-in-time
  # recovery is handled by DSM's own Btrfs snapshot scheduler on the ai_backups
  # share, not by this job — this just mirrors current state.
  systemd.services.synology-backup = {
    description = "Mirror local AI state to Synology NAS";
    after = [ "mnt-synology.automount" ];
    serviceConfig.Type = "oneshot";
    script = ''
      set -euo pipefail
      DEST=/mnt/synology/bosgame-ai
      mkdir -p "$DEST"
      ${pkgs.rsync}/bin/rsync -a --delete /var/lib/docker/volumes/turnstone_postgres_data/ "$DEST/turnstone_postgres_data/"
      ${pkgs.rsync}/bin/rsync -a --delete /var/lib/docker/volumes/hermes_data/ "$DEST/hermes_data/"
      ${pkgs.rsync}/bin/rsync -a --delete /etc/nixos/ "$DEST/etc-nixos/"
      ${pkgs.rsync}/bin/rsync -a --delete /home/chris/local-ai-machine/ "$DEST/local-ai-machine/"
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
- [ ] **Task 1.4: Prepare Synology NAS Target**
  Create shared folder `ai_backups` on Synology DSM and generate a restricted service user `ai_backup_svc` with read/write access. *(Manual DSM step — not scriptable from this repo.)*
- [ ] **Task 1.5: Populate Local Secrets**
  Copy `secrets/smb-credentials.env.example` → `secrets/smb-credentials.env`, then fill in the real `ai_backup_svc` password from Task 1.4. That's the only secret this repo needs — backups to the NAS are an unencrypted rsync mirror by design (see Section 3), so there's no backup passphrase to manage.

### Phase 2: Host Provisioning (Day 0 - Hardware Arrival)
*Objective: Prepare physical hardware and apply the declarative OS configuration.*

**Peripheral setup note:** the M5's video output is HDMI/DP only; the available monitor is DVI-only. Bring-up needs a passive HDMI→DVI adapter cable (HDMI and DVI-D carry the same digital signal, no active converter required). For durable local console access afterward (not just this one install), route both this machine and the currently-DVI-connected server through a small 2-port DVI KVM switch — monitor into the KVM's output, each host into an input (the M5 via the same HDMI→DVI adapter), one shared keyboard via the KVM's USB switching. No mouse needed; the M5 never runs a display manager, so console access is TTY-only.

- [ ] **Task 2.0: Real SSH Key**
  Replace the placeholder key in `configuration.nix:26` (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... chris@macmini`) with your actual Mac Mini public key (`cat ~/.ssh/id_ed25519.pub`, generating one first if it doesn't exist). This is the *only* configured way into `chris`'s account post-install — no password is set, so a wrong/placeholder key here means physical-console-only until corrected.
- [ ] **Task 2.1: Base NixOS Install**
  Flash a NixOS Minimal ISO to USB. Connect the M5 to the monitor (HDMI→DVI adapter) and keyboard, plug Ethernet in at its final physical location so the DHCP lease you land on is the one you keep, and boot the installer.
- [ ] **Task 2.2: Go Remote Early**
  On the live installer console, note the DHCP IP address (shown in the login banner), then authorize your Mac Mini's key for the live session: `mkdir -p ~/.ssh && curl https://github.com/<your-github-username>.keys > ~/.ssh/authorized_keys` (or paste the pubkey manually). From the Mac Mini, `ssh root@<ip>`. Everything from here — partitioning the 2TB NVMe, `nixos-generate-config`, copying over the repo files — can be done over SSH; the physical keyboard/monitor can be disconnected and returned to the other server once this session is confirmed working.
- [ ] **Task 2.3: Apply System Flake**
  Execute `nixos-rebuild switch --flake .#bosgame-ai` and reboot. Reconnect over SSH as `chris` using the real key from Task 2.0 to confirm remote access survives the reboot before walking away.
- [ ] **Task 2.4: Verify iGPU Memory Allocation**
  Run `rocm-smi` and verify that system RAM allocation to the GPU reflects ~124GB available VRAM. Confirm `multi-user.target` is active.

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
  Run `scripts/sync-backup.sh` (or `systemctl start synology-backup.service`) manually and verify the files land under `ai_backups/bosgame-ai/` on the Synology. Confirm DSM's Btrfs snapshot schedule is enabled on the `ai_backups` share — that's what provides point-in-time recovery, since the mirror itself only holds current state.
- [ ] **Task 4.2: Grafana Dashboard Baseline**
  Open Grafana (`http://<BOSGAME_IP>:3000`) and establish baseline metrics for VRAM utilization, power draw, and thermals under full model load.

---

## 7. Implementation Directives for Coding Agent

1. **Strict Declarative State:** Do NOT issue manual `apt`, `pip`, or `systemctl` commands directly on the host that are not defined in `configuration.nix` or `docker-compose.yml`.
2. **Secrets Hygiene:** Store all passwords, tokens, and credentials in the `secrets/` directory or `.env` files. Ensure `.gitignore` excludes sensitive files.
