#!/usr/bin/env bash
# Writes amdgpu-specific metrics (GPU busy %, GTT/VRAM usage) as a
# node-exporter textfile-collector file. These aren't standard hwmon
# values, so node-exporter's built-in hwmon collector (which already
# gives us GPU temp/power/frequency for free, no config needed) doesn't
# pick them up - they live under /sys/class/drm/card0/device/ instead,
# amdgpu-driver-specific DRM sysfs attributes.
set -euo pipefail

CARD=/sys/class/drm/card0/device
OUT=/var/lib/node-exporter-textfile/amdgpu.prom
TMP="${OUT}.tmp"

read_val() {
  cat "$CARD/$1" 2>/dev/null || echo 0
}

{
  echo "# HELP node_amdgpu_busy_percent Current GPU utilization percentage"
  echo "# TYPE node_amdgpu_busy_percent gauge"
  echo "node_amdgpu_busy_percent $(read_val gpu_busy_percent)"

  echo "# HELP node_amdgpu_gtt_total_bytes Total GTT (unified memory) allocation available to the GPU"
  echo "# TYPE node_amdgpu_gtt_total_bytes gauge"
  echo "node_amdgpu_gtt_total_bytes $(read_val mem_info_gtt_total)"

  echo "# HELP node_amdgpu_gtt_used_bytes Currently used GTT memory"
  echo "# TYPE node_amdgpu_gtt_used_bytes gauge"
  echo "node_amdgpu_gtt_used_bytes $(read_val mem_info_gtt_used)"

  echo "# HELP node_amdgpu_vram_total_bytes Total VRAM (static carve-out on this unified-memory APU)"
  echo "# TYPE node_amdgpu_vram_total_bytes gauge"
  echo "node_amdgpu_vram_total_bytes $(read_val mem_info_vram_total)"

  echo "# HELP node_amdgpu_vram_used_bytes Currently used VRAM"
  echo "# TYPE node_amdgpu_vram_used_bytes gauge"
  echo "node_amdgpu_vram_used_bytes $(read_val mem_info_vram_used)"

  echo "# HELP node_amdgpu_vis_vram_total_bytes Total CPU-visible VRAM"
  echo "# TYPE node_amdgpu_vis_vram_total_bytes gauge"
  echo "node_amdgpu_vis_vram_total_bytes $(read_val mem_info_vis_vram_total)"

  echo "# HELP node_amdgpu_vis_vram_used_bytes Currently used CPU-visible VRAM"
  echo "# TYPE node_amdgpu_vis_vram_used_bytes gauge"
  echo "node_amdgpu_vis_vram_used_bytes $(read_val mem_info_vis_vram_used)"
} > "$TMP"

# Atomic rename so node-exporter's textfile collector never reads a
# partially-written file mid-update.
mv "$TMP" "$OUT"
