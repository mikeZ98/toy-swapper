# Project-scoped Colima storage on the external SSD.
#
# Goal: keep the Colima VM + all Docker image/container layers on the external
# drive (where this repo lives), never the MacBook's internal disk.
#
# Colima 0.10.0 IGNORES $COLIMA_HOME when ~/.colima exists. The lever that works
# is XDG_CONFIG_HOME (holds colima/_lima/ + the growable VM disks) plus
# XDG_CACHE_HOME (the downloaded base-image cache). Source this before running
# colima / docker / supabase for this project:
#
#   source scripts/colima-env.sh
#   colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8 --disk 60 \
#     --mount /Volumes/KINGSTONE_SSD:w
#
# Requirements:
#   * the external drive must be mounted (else the Docker socket vanishes), and
#   * ~/.colima must NOT exist — if it does, Colima uses it and silently sends
#     VM data back to the internal disk. Remove it before first start.
export XDG_CONFIG_HOME=/Volumes/KINGSTONE_SSD/.config
export XDG_CACHE_HOME=/Volumes/KINGSTONE_SSD/.cache
