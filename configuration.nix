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
    # Remaining candidates from the original model exploration, confirmed
    # real repo IDs — not yet benchmarked. Qwen3.6-27B: dense mid-level
    # alternative, bf16 (avoid Qwen/Qwen3.6-27B-FP8 — same no-native-FP8
    # wall as everything else on this hardware). Gemma4-31B: dense, listed
    # directly in the toolbox's own README as 1-GPU-viable. Gemma4-26B-A4B:
    # MoE variant, also toolbox-README-listed as 1-GPU-viable.
    { name = "qwen3.6-27b"; repo = "Qwen/Qwen3.6-27B"; }
    { name = "gemma-4-31b-it"; repo = "google/gemma-4-31B-it"; }
    { name = "gemma-4-26b-a4b-it"; repo = "google/gemma-4-26B-A4B-it"; }
    # Vision/OCR model — different use case (screenshot/document parsing,
    # not chat coding). Will need --limit-mm-per-prompt flags not used
    # anywhere else in this stack once actually served.
    { name = "qwen2.5-vl-7b-instruct"; repo = "Qwen/Qwen2.5-VL-7B-Instruct"; }
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

        # Each model download has its own independent timer, so with no
        # coordination between them, all of them firing around the same
        # boot-time window means all of them download simultaneously and
        # saturate the connection (confirmed directly: four downloads at
        # once brought everything else to a crawl). A shared exclusive lock
        # serializes them regardless of trigger order or timing — whichever
        # acquires the lock first runs to completion (or its own retry
        # cycle) while the others block here, not consuming bandwidth, then
        # take their turn. Held for the whole script; released automatically
        # when it exits.
        exec 200>/var/lib/ai-models/.download.lock
        ${pkgs.util-linux}/bin/flock -x 200

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

  # filterForward turned out to be too broad on its own — it filtered ALL
  # forwarded traffic uniformly, including legitimate container-to-container
  # traffic on Docker's own bridge network, not just genuinely external LAN
  # traffic being forwarded in. Confirmed directly: even litellm:4000
  # (already in allowedTCPPorts) started timing out for Prometheus's
  # internal scrapes after filterForward landed. allowedTCPPorts is meant to
  # gate what's reachable from the outside, not what containers can say to
  # each other on a bridge network the host itself controls — so the
  # bridge interface is fully exempted here instead. Uses the fixed name
  # set via docker-compose.yml's driver_opts (not Docker's default
  # auto-generated br-<network-ID-hash>, which differs every time the
  # network is created and would silently break this on a fresh install).
  networking.firewall.trustedInterfaces = [ "br-localai" ];

  # trustedInterfaces alone does NOT actually exempt the forward chain when
  # filterForward is on — confirmed by inspecting the generated ruleset
  # directly (the accept rule it adds only lands in `chain input`, not
  # `chain forward`) and by a matching known upstream issue (nixpkgs #437920,
  # same trustedInterfaces+filterForward combination, same symptom). The
  # forward chain's only unconditional accept is `ct status dnat accept`,
  # which doesn't match plain bridge-to-bridge traffic between two
  # container IPs (no DNAT involved for that, only for genuinely external
  # traffic hitting a published port) — so it fell through to the default
  # drop policy. This is the documented workaround: an explicit forward-chain
  # rule for the trusted bridge, covering both directions (new connections
  # originating from it, and established/related return traffic to it).
  networking.firewall.extraForwardRules = ''
    iifname "br-localai" accept
    oifname "br-localai" ct state established,related accept
  '';

  system.stateVersion = "24.11";
}
