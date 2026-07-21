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
