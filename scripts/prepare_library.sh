#!/usr/bin/env bash
# ==============================================================================
# scripts/prepare_library.sh (aliased as scripts/prepare-library.sh)
# Downloads and prepares ARM64 (aarch64) base images (Alpine, FreeBSD, NetBSD,
# and OpenBSD installer kit) directly onto local or external storage on macOS.
# License: GNU GPLv3 (GPL-3.0-or-later)
# ==============================================================================

set -euo pipefail

# Ensure standard Homebrew paths are available in non-login shells
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { printf "${BLUE}[INFO]${NC}  %s\n" "$*"; }
log_ok()    { printf "${GREEN}[OK]${NC}    %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
die()       { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <storage_path> [options]

Examples:
  $(basename "$0") /Volumes/Samsung_T7/Etherloom
  $(basename "$0") /Volumes/Samsung_T7/Etherloom --only freebsd,openbsd
  $(basename "$0") /Volumes/Samsung_T7/Etherloom --setup-openbsd

Options:
  --only <os1,os2>   Process only selected OSes (alpine,freebsd,netbsd,openbsd)
  --force            Re-download and overwrite existing templates/ISOs
  --setup-openbsd    Launch interactive OpenBSD HVF installation in the terminal
                     to build openbsd-aarch64-base.qcow2 from the downloaded kit
  -h, --help         Show this help message
EOF
  exit 0
}

# ------------------------------------------------------------------------------
# 1. Argument parsing
# ------------------------------------------------------------------------------
[[ $# -lt 1 ]] && usage

STORAGE_ROOT=""
ONLY_FILTER="alpine,freebsd,netbsd,openbsd"
FORCE=0
SETUP_OPENBSD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      ;;
    --only)
      [[ $# -lt 2 ]] && die "Option --only requires a comma-separated list (e.g., alpine,freebsd)."
      ONLY_FILTER="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --setup-openbsd)
      SETUP_OPENBSD=1
      shift
      ;;
    -*)
      die "Unknown option: $1"
      ;;
    *)
      if [[ -z "$STORAGE_ROOT" ]]; then
        STORAGE_ROOT="${1%/}"
        shift
      else
        die "Unexpected argument: $1"
      fi
      ;;
  esac
done

[[ -z "$STORAGE_ROOT" ]] && usage

should_run() {
  [[ ",${ONLY_FILTER}," == *",$1,"* ]]
}

# ------------------------------------------------------------------------------
# 2. macOS environment & dependency checks
# ------------------------------------------------------------------------------
[[ "$(uname -s)" == "Darwin" ]] || die "This script is designed exclusively for macOS."

for cmd in curl gunzip shasum qemu-img xz awk sed grep sort df stat diskutil; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command '$cmd'. Install QEMU via: brew install qemu xz"
done

find_edk2_firmware() {
  local candidates=(
    "/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
    "/usr/local/share/qemu/edk2-aarch64-code.fd"
  )
  if command -v brew >/dev/null 2>&1; then
    local brew_qemu
    brew_qemu="$(brew --prefix qemu 2>/dev/null || true)"
    [[ -n "$brew_qemu" ]] && candidates=("$brew_qemu/share/qemu/edk2-aarch64-code.fd" "${candidates[@]}")
  fi
  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]]; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

# ------------------------------------------------------------------------------
# 3. External drive validation (/Volumes mount guard) & disk telemetry
# ------------------------------------------------------------------------------
if [[ "$STORAGE_ROOT" == /Volumes/* ]]; then
  VOL_NAME="$(echo "$STORAGE_ROOT" | cut -d'/' -f3)"
  VOL_MOUNT="/Volumes/$VOL_NAME"

  if [[ -z "$VOL_NAME" ]] || [[ ! -d "$VOL_MOUNT" ]]; then
    die "External volume '$VOL_MOUNT' is not mounted! Connect the drive and retry."
  fi

  # Compare device IDs (st_dev) to ensure /Volumes/<Name> is a real mounted filesystem
  # and never create phantom local directories under /Volumes when a drive is unplugged.
  VOLUMES_DEV="$(stat -f '%d' /Volumes)"
  TARGET_DEV="$(stat -f '%d' "$VOL_MOUNT")"
  if [[ "$VOLUMES_DEV" == "$TARGET_DEV" ]]; then
    die "'$VOL_MOUNT' is not an active mount point (same st_dev as /Volumes). Aborting."
  fi
  CHECK_MOUNT="$VOL_MOUNT"
else
  mkdir -p "$STORAGE_ROOT"
  CHECK_MOUNT="$STORAGE_ROOT"
fi

FS_TYPE="$(diskutil info "$CHECK_MOUNT" 2>/dev/null | awk -F': *' '/File System Personality:|Type \(Bundle\):/ {print $2; exit}' || echo "Unknown")"
FREE_KB="$(df -Pk "$CHECK_MOUNT" | awk 'NR==2 {print $4}')"
FREE_GB="$(( FREE_KB / 1024 / 1024 ))"

log_info "Target storage root : ${BOLD}${STORAGE_ROOT}${NC}"
log_info "Filesystem          : ${BOLD}${FS_TYPE:-Local}${NC} | Free space: ${BOLD}${FREE_GB} GB${NC}"

if [[ "$FREE_GB" -lt 6 ]]; then
  die "Insufficient free disk space (${FREE_GB} GB available). At least 6 GB is recommended."
fi

if echo "$FS_TYPE" | grep -qi "exfat"; then
  log_warn "Drive is formatted as ExFAT. qcow2 images will work fine, though APFS offers better sparse file efficiency."
fi

TEMPLATES_DIR="$STORAGE_ROOT/templates"
ISOS_DIR="$STORAGE_ROOT/isos"
PROJECTS_DIR="$STORAGE_ROOT/projects"
STAGING_DIR="$STORAGE_ROOT/.staging"

mkdir -p "$TEMPLATES_DIR" "$ISOS_DIR" "$PROJECTS_DIR" "$STAGING_DIR"

cleanup() {
  # Remove temporary raw/decompressed artifacts while preserving .part files for curl resume
  rm -f "$STAGING_DIR"/*.raw "$STAGING_DIR"/*.tmp.qcow2 2>/dev/null || true
}
trap cleanup EXIT

# Resumable HTTP downloader
download_file() {
  local url="$1"
  local dest="$2"
  local part="${dest}.part"

  log_info "Downloading: $url"
  curl -fL --retry 3 --connect-timeout 15 -C - -o "$part" "$url"
  mv -f "$part" "$dest"
}

lock_template() {
  local file="$1"
  chmod a-w "$file" 2>/dev/null || true
}

unlock_if_forced() {
  local file="$1"
  if [[ -f "$file" ]]; then
    chmod u+w "$file" 2>/dev/null || true
  fi
}

# ------------------------------------------------------------------------------
# Special Mode: Interactive OpenBSD Golden Image Builder (--setup-openbsd)
# ------------------------------------------------------------------------------
run_openbsd_setup() {
  command -v qemu-system-aarch64 >/dev/null 2>&1 || die "Missing qemu-system-aarch64."
  local edk2_fd
  edk2_fd="$(find_edk2_firmware)" || die "Could not locate edk2-aarch64-code.fd in QEMU installation."

  local installer_img
  installer_img="$(ls -1 "$ISOS_DIR"/openbsd-*-arm64-install.img 2>/dev/null | sort -V | tail -n 1 || true)"
  [[ -n "$installer_img" && -f "$installer_img" ]] || die "No OpenBSD installer found in $ISOS_DIR. Run this script without --setup-openbsd first."

  local target_qcow2="$TEMPLATES_DIR/openbsd-aarch64-base.qcow2"
  unlock_if_forced "$target_qcow2"
  qemu-img create -f qcow2 "$target_qcow2" 16G >/dev/null

  cat <<EOF

${BOLD}==============================================================================${NC}
${GREEN}OpenBSD ARM64 Golden Template Builder (Apple HVF Hardware Acceleration)${NC}
${BOLD}==============================================================================${NC}
Installer media : $installer_img
Target disk     : $target_qcow2 (16 GB thin-provisioned)

${YELLOW}Quick walkthrough for the OpenBSD text installer about to start:${NC}
  1. Choose ${BOLD}I${NC} (Install), ${BOLD}default${NC} keyboard, and a hostname (e.g., ${BOLD}obsd${NC}).
  2. For network interface vio0: choose ${BOLD}autoconf${NC} (uses QEMU built-in DHCP).
  3. At "Change the default console to com0?": answer ${BOLD}yes${NC}, baud rate ${BOLD}115200${NC}.
  4. At "Which disk is the root disk?": select ${BOLD}sd0${NC} -> ${BOLD}whole${NC} -> ${BOLD}auto${NC} layout.
     (The USB installer stick appears as sd1, so at "Location of sets?" choose
     ${BOLD}disk${NC} -> ${BOLD}no${NC} (not mounted) -> ${BOLD}sd1${NC} -> partition ${BOLD}a${NC}).
  5. When installation completes, choose ${BOLD}H${NC} (Halt), then exit QEMU with ${BOLD}Ctrl+A then X${NC}.
${BOLD}==============================================================================${NC}
Press ENTER to boot the installer VM...
EOF
  read -r _

  qemu-system-aarch64 \
    -M virt,highmem=on \
    -accel hvf \
    -cpu host \
    -smp 2 \
    -m 1024 \
    -bios "$edk2_fd" \
    -nographic \
    -drive "if=none,id=hd0,file=$target_qcow2,format=qcow2" \
    -device virtio-blk-pci,drive=hd0,bootindex=1 \
    -device qemu-xhci \
    -drive "if=none,id=usb0,file=$installer_img,format=raw,readonly=on" \
    -device usb-storage,drive=usb0,bootindex=0 \
    -nic user,model=virtio-net-pci

  lock_template "$target_qcow2"
  log_ok "OpenBSD base template locked as Read-Only: $target_qcow2"
  exit 0
}

[[ "$SETUP_OPENBSD" -eq 1 ]] && run_openbsd_setup

# ------------------------------------------------------------------------------
# 4. ALPINE LINUX (nocloud UEFI qcow2 + alpine-virt ISO)
# ------------------------------------------------------------------------------
prepare_alpine() {
  local out_qcow2="$TEMPLATES_DIR/alpine-aarch64-base.qcow2"
  local cloud_base="https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/cloud"
  local iso_base="https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64"

  echo ""
  log_info "=== [1/4] Alpine Linux (aarch64) ==="

  if [[ -f "$out_qcow2" && "$FORCE" -eq 0 ]]; then
    log_ok "[SKIP] Template already exists: $(basename "$out_qcow2")"
  else
    local cloud_index cloud_file
    cloud_index="$(curl -fsSL "$cloud_base/")"
    cloud_file="$(echo "$cloud_index" \
      | grep -Eo 'nocloud_alpine-[0-9]+\.[0-9]+\.[0-9]+-aarch64-uefi-tiny-r[0-9]+\.qcow2(\.xz)?' \
      | sort -u | sort -V | tail -n 1 || true)"

    if [[ -z "$cloud_file" ]]; then
      cloud_file="$(echo "$cloud_index" \
        | grep -Eo 'nocloud_alpine-[0-9]+\.[0-9]+\.[0-9]+-aarch64-uefi-[^"<> ]+\.qcow2(\.xz)?' \
        | sort -u | sort -V | tail -n 1 || true)"
    fi

    [[ -n "$cloud_file" ]] || die "Could not locate an Alpine aarch64 nocloud UEFI image on mirror."

    local dl_path="$STAGING_DIR/$cloud_file"
    download_file "$cloud_base/$cloud_file" "$dl_path"

    unlock_if_forced "$out_qcow2"
    local tmp_qcow2="$STAGING_DIR/alpine.tmp.qcow2"
    if [[ "$cloud_file" == *.xz ]]; then
      log_info "Decompressing Alpine image..."
      xz -dc "$dl_path" > "$tmp_qcow2"
      rm -f "$dl_path"
    else
      mv -f "$dl_path" "$tmp_qcow2"
    fi

    qemu-img resize "$tmp_qcow2" 4G >/dev/null 2>&1 || true
    mv -f "$tmp_qcow2" "$out_qcow2"
    lock_template "$out_qcow2"
    log_ok "Alpine template ready (serial login: root, passwordless): $out_qcow2"
  fi

  # Also fetch the minimal alpine-virt ISO (~60 MB) into isos/
  local iso_index iso_file
  iso_index="$(curl -fsSL "$iso_base/")"
  iso_file="$(echo "$iso_index" \
    | grep -Eo 'alpine-virt-[0-9]+\.[0-9]+\.[0-9]+-aarch64\.iso' \
    | sort -u | sort -V | tail -n 1 || true)"

  if [[ -n "$iso_file" ]]; then
    local out_iso="$ISOS_DIR/$iso_file"
    if [[ -f "$out_iso" && "$FORCE" -eq 0 ]]; then
      log_ok "[SKIP] Alpine ISO already exists: $iso_file"
    else
      download_file "$iso_base/$iso_file" "$out_iso"
      log_ok "Alpine ISO saved: $out_iso"
    fi
  fi
}

# ------------------------------------------------------------------------------
# 5. FREEBSD (Official UFS aarch64 VM image)
# ------------------------------------------------------------------------------
prepare_freebsd() {
  local out_qcow2="$TEMPLATES_DIR/freebsd-aarch64-base.qcow2"
  local vm_root="https://download.freebsd.org/releases/VM-IMAGES"

  echo ""
  log_info "=== [2/4] FreeBSD (aarch64 UFS) ==="

  if [[ -f "$out_qcow2" && "$FORCE" -eq 0 ]]; then
    log_ok "[SKIP] Template already exists: $(basename "$out_qcow2")"
    return 0
  fi

  local releases rel chosen_url="" chosen_file=""
  if [[ -n "${FREEBSD_VER:-}" ]]; then
    releases="$FREEBSD_VER"
  else
    releases="$(curl -fsSL "$vm_root/" \
      | grep -Eo '[0-9]+\.[0-9]+-RELEASE' \
      | sort -u | sort -t. -k1,1nr -k2,2nr)"
  fi

  for rel in $releases; do
    local latest_dir="$vm_root/$rel/aarch64/Latest"
    local dir_html
    if dir_html="$(curl -fsSL "$latest_dir/" 2>/dev/null)"; then
      # Prefer UFS over ZFS to keep per-node RAM footprint low (~256-512 MB)
      chosen_file="$(echo "$dir_html" | grep -Eo 'FreeBSD-[^"<> ]+-arm64-aarch64-ufs\.qcow2\.xz' | head -n 1 || true)"
      if [[ -z "$chosen_file" ]]; then
        chosen_file="$(echo "$dir_html" | grep -Eo 'FreeBSD-[^"<> ]+-arm64-aarch64\.qcow2\.xz' | head -n 1 || true)"
      fi
      if [[ -n "$chosen_file" ]]; then
        chosen_url="$latest_dir/$chosen_file"
        log_info "Selected FreeBSD release: $rel ($chosen_file)"
        break
      fi
    fi
  done

  [[ -n "$chosen_url" ]] || die "Could not find a valid FreeBSD aarch64 VM image on mirror."

  local xz_path="$STAGING_DIR/$chosen_file"
  local tmp_qcow2="$STAGING_DIR/freebsd.tmp.qcow2"
  download_file "$chosen_url" "$xz_path"

  log_info "Decompressing and expanding virtual disk size to 16G (growfs runs on first boot)..."
  xz -dc "$xz_path" > "$tmp_qcow2"
  qemu-img resize "$tmp_qcow2" 16G >/dev/null

  unlock_if_forced "$out_qcow2"
  mv -f "$tmp_qcow2" "$out_qcow2"
  rm -f "$xz_path"
  lock_template "$out_qcow2"
  log_ok "FreeBSD template ready (login: root, passwordless): $out_qcow2"
}

# ------------------------------------------------------------------------------
# 6. NETBSD (evbarm-aarch64 arm64.img.gz -> sparse qcow2)
# ------------------------------------------------------------------------------
prepare_netbsd() {
  local out_qcow2="$TEMPLATES_DIR/netbsd-aarch64-base.qcow2"
  local nb_root="https://cdn.netbsd.org/pub/NetBSD"

  echo ""
  log_info "=== [3/4] NetBSD (evbarm-aarch64) ==="

  if [[ -f "$out_qcow2" && "$FORCE" -eq 0 ]]; then
    log_ok "[SKIP] Template already exists: $(basename "$out_qcow2")"
    return 0
  fi

  local versions ver chosen_url="" chosen_ver=""
  if [[ -n "${NETBSD_VER:-}" ]]; then
    versions="$NETBSD_VER"
  else
    versions="$(curl -fsSL "$nb_root/" \
      | grep -Eo 'NetBSD-[0-9]+\.[0-9]+(\.[0-9]+)?' \
      | sed 's/^NetBSD-//' \
      | sort -u | sort -t. -k1,1nr -k2,2nr -k3,3nr)"
  fi

  for ver in $versions; do
    local candidate="$nb_root/NetBSD-$ver/evbarm-aarch64/binary/gzimg/arm64.img.gz"
    if curl -fsSI "$candidate" >/dev/null 2>&1; then
      chosen_url="$candidate"
      chosen_ver="$ver"
      log_info "Selected NetBSD release: $chosen_ver"
      break
    fi
  done

  [[ -n "$chosen_url" ]] || die "Could not find arm64.img.gz on NetBSD mirror."

  local gz_path="$STAGING_DIR/netbsd-${chosen_ver}-arm64.img.gz"
  local raw_path="$STAGING_DIR/netbsd.raw"
  local tmp_qcow2="$STAGING_DIR/netbsd.tmp.qcow2"

  download_file "$chosen_url" "$gz_path"

  log_info "Decompressing and converting raw image -> sparse qcow2 (8G)..."
  gunzip -c "$gz_path" > "$raw_path"
  qemu-img convert -f raw -O qcow2 "$raw_path" "$tmp_qcow2"
  qemu-img resize "$tmp_qcow2" 8G >/dev/null

  unlock_if_forced "$out_qcow2"
  mv -f "$tmp_qcow2" "$out_qcow2"
  rm -f "$gz_path" "$raw_path"
  lock_template "$out_qcow2"
  log_ok "NetBSD template ready (FFS auto-resizes on first boot; login: root): $out_qcow2"
}

# ------------------------------------------------------------------------------
# 7. OPENBSD (Official arm64 installXX.img kit + SHA256 verification)
# ------------------------------------------------------------------------------
prepare_openbsd() {
  local ob_root="https://cdn.openbsd.org/pub/OpenBSD"

  echo ""
  log_info "=== [4/4] OpenBSD (arm64 installer kit) ==="

  local versions ver chosen_ver="" chosen_url="" img_name=""
  if [[ -n "${OPENBSD_VER:-}" ]]; then
    versions="$OPENBSD_VER"
  else
    versions="$(curl -fsSL "$ob_root/" \
      | grep -Eo 'href="[0-9]+\.[0-9]+/"' \
      | grep -Eo '[0-9]+\.[0-9]+' \
      | sort -u | sort -t. -k1,1nr -k2,2nr)"
  fi

  for ver in $versions; do
    local nodot="${ver//./}"
    local candidate_name="install${nodot}.img"
    local candidate_url="$ob_root/$ver/arm64/$candidate_name"
    if curl -fsSI "$candidate_url" >/dev/null 2>&1; then
      chosen_ver="$ver"
      img_name="$candidate_name"
      chosen_url="$candidate_url"
      log_info "Selected OpenBSD release: $chosen_ver ($img_name)"
      break
    fi
  done

  [[ -n "$chosen_url" ]] || die "Could not find an OpenBSD arm64 installer image on mirror."

  local out_img="$ISOS_DIR/openbsd-${chosen_ver}-arm64-install.img"
  if [[ -f "$out_img" && "$FORCE" -eq 0 ]]; then
    log_ok "[SKIP] OpenBSD installer already exists: $(basename "$out_img")"
  else
    download_file "$chosen_url" "$out_img"

    # Verify official SHA256 checksum
    local sha_list expected_sha actual_sha
    if sha_list="$(curl -fsSL "$ob_root/$chosen_ver/arm64/SHA256" 2>/dev/null)"; then
      expected_sha="$(echo "$sha_list" | awk -v f="($img_name)" '$2 == f {print $4; exit}')"
      if [[ -n "$expected_sha" ]]; then
        actual_sha="$(shasum -a 256 "$out_img" | awk '{print $1}')"
        [[ "$expected_sha" == "$actual_sha" ]] || die "SHA256 checksum mismatch for $img_name!"
        log_ok "Verified official SHA256 checksum for $img_name"
      fi
    fi
    log_ok "OpenBSD installer saved: $out_img"
  fi

  if [[ ! -f "$TEMPLATES_DIR/openbsd-aarch64-base.qcow2" ]]; then
    log_warn "To build the reusable OpenBSD base template (~2 min interactive console install), run:"
    printf "       ${BOLD}%s %s --setup-openbsd${NC}\n" "$0" "$STORAGE_ROOT"
  fi
}

# ------------------------------------------------------------------------------
# Main execution
# ------------------------------------------------------------------------------
should_run "alpine"  && prepare_alpine
should_run "freebsd" && prepare_freebsd
should_run "netbsd"  && prepare_netbsd
should_run "openbsd" && prepare_openbsd

echo ""
log_ok "Etherloom image library is ready at: $STORAGE_ROOT"
ls -lh "$TEMPLATES_DIR" "$ISOS_DIR"
