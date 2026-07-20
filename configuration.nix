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
  environment.systemPackages = with pkgs; [ cifs-utils restic docker-compose git ];

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

  # 6. Automated Daily Restic Backup Service
  services.restic.backups.synology = {
    repository = "/mnt/synology/restic";
    passwordFile = "/etc/nixos/secrets/restic-password.txt";
    paths = [
      "/var/lib/docker/volumes/turnstone_postgres_data"
      "/var/lib/docker/volumes/hermes_data"
      "/etc/nixos"
      "/home/chris/local-ai-machine"
    ];
    timerConfig = {
      OnCalendar = "03:00";
      Persistent = true;
    };
    pruneOpts = [
      "--keep-daily 7"
      "--keep-weekly 4"
      "--keep-monthly 6"
    ];
  };

  # Firewall Rules
  networking.firewall.allowedTCPPorts = [ 22 4000 8080 3000 9090 ];

  system.stateVersion = "24.11";
}
