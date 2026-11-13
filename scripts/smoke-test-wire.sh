#!/usr/bin/env bash
# ==============================================================================
# scripts/smoke-test-wire.sh
# Boots two ARM64 VMs (Apple HVF accelerated) from Copy-on-Write overlays over
# templates stored on local/external storage, connects them via a point-to-point
# QEMU UDP socket wire, records traffic to .pcap, and streams live to Wireshark.
# License: GNU GPLv3 (GPL-3.0-or-later)
# ==============================================================================

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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
  $(basename "$0") /Volumes/Samsung_T7/Etherloom --node1 alpine --node2 freebsd
  $(basename "$0") /Volumes/Samsung_T7/Etherloom --node1 openbsd --node2 netbsd

Options:
  --node1 <os>       OS for Node 1: alpine | freebsd | netbsd | openbsd (default: alpine)
  --node2 <os>       OS for Node 2: alpine | freebsd | netbsd | openbsd (default: freebsd)
  --port-base <port> Base local UDP port for the virtual wire (default: 21000)
  --no-wireshark     Record .pcap to disk only without launching Wireshark GUI
  --no-tmux          Open macOS Terminal.app windows instead of a split tmux session
  --keep-disks       Preserve ephemeral .qcow2 overlay disks after exiting
  -h, --help         Show this help message
EOF
  exit 0
}

[[ $# -lt 1 ]] && usage

STORAGE_ROOT=""
NODE1_OS="alpine"
NODE2_OS="freebsd"
PORT_BASE=21000
USE_WIRESHARK=1
USE_TMUX=1
KEEP_DISKS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --node1) NODE1_OS="$2"; shift 2 ;;
    --node2) NODE2_OS="$2"; shift 2 ;;
    --port-base) PORT_BASE="$2"; shift 2 ;;
    --no-wireshark) USE_WIRESHARK=0; shift ;;
    --no-tmux) USE_TMUX=0; shift ;;
    --keep-disks) KEEP_DISKS=1; shift ;;
    -*) die "Unknown option: $1" ;;
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
[[ "$(uname -s)" == "Darwin" ]] || die "This script runs exclusively on macOS."

for cmd in qemu-system-aarch64 qemu-img stat tail; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing '$cmd'. Install QEMU via: brew install qemu"
done

# ------------------------------------------------------------------------------
# 1. Verify mounted external volume and locate edk2 UEFI firmware
# ------------------------------------------------------------------------------
if [[ "$STORAGE_ROOT" == /Volumes/* ]]; then
  VOL_MOUNT="/Volumes/$(echo "$STORAGE_ROOT" | cut -d'/' -f3)"
  [[ -d "$VOL_MOUNT" ]] || die "Volume '$VOL_MOUNT' is not mounted!"
  [[ "$(stat -f '%d' /Volumes)" != "$(stat -f '%d' "$VOL_MOUNT")" ]] || die "'$VOL_MOUNT' is not an active mounted drive!"
fi

find_edk2() {
  local candidates=(
    "/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
    "/usr/local/share/qemu/edk2-aarch64-code.fd"
  )
  if command -v brew >/dev/null 2>&1; then
    local bp
    bp="$(brew --prefix qemu 2>/dev/null || true)"
    [[ -n "$bp" ]] && candidates=("$bp/share/qemu/edk2-aarch64-code.fd" "${candidates[@]}")
  fi
  for f in "${candidates[@]}"; do
    [[ -f "$f" ]] && { echo "$f"; return 0; }
  done
  return 1
}

EDK2_FD="$(find_edk2)" || die "Could not find edk2-aarch64-code.fd in QEMU installation."

find_wireshark() {
  if [[ -x "/Applications/Wireshark.app/Contents/MacOS/Wireshark" ]]; then
    echo "/Applications/Wireshark.app/Contents/MacOS/Wireshark"
    return 0
  elif command -v wireshark >/dev/null 2>&1; then
    command -v wireshark
    return 0
  fi
  return 1
}

# ------------------------------------------------------------------------------
# 2. Validate templates and create Copy-on-Write qcow2 overlays
# ------------------------------------------------------------------------------
TEMPLATES_DIR="$STORAGE_ROOT/templates"
TPL1="$TEMPLATES_DIR/${NODE1_OS}-aarch64-base.qcow2"
TPL2="$TEMPLATES_DIR/${NODE2_OS}-aarch64-base.qcow2"

# Fall back to Node 1's OS if default FreeBSD template has not been downloaded yet
if [[ ! -f "$TPL2" && "$NODE2_OS" == "freebsd" && -f "$TPL1" ]]; then
  log_warn "FreeBSD template not found yet; falling back to '${NODE1_OS}' for both nodes."
  NODE2_OS="$NODE1_OS"
  TPL2="$TPL1"
fi

[[ -f "$TPL1" ]] || die "Missing base template: $TPL1 (run ./scripts/prepare_library.sh $STORAGE_ROOT first)"
[[ -f "$TPL2" ]] || die "Missing base template: $TPL2 (run ./scripts/prepare_library.sh $STORAGE_ROOT first)"

STAMP="$(date +%Y%m%d_%H%M%S)"
SMOKE_DIR="$STORAGE_ROOT/projects/_smoke_test"
CAPTURES_DIR="$SMOKE_DIR/captures"
RUNTIME_DIR="/tmp/etherloom-smoke-${STAMP}"

mkdir -p "$SMOKE_DIR" "$CAPTURES_DIR" "$RUNTIME_DIR"

OVL1="$SMOKE_DIR/node1_${NODE1_OS}_${STAMP}.qcow2"
OVL2="$SMOKE_DIR/node2_${NODE2_OS}_${STAMP}.qcow2"
PCAP_FILE="$CAPTURES_DIR/wire_${NODE1_OS}_${NODE2_OS}_${STAMP}.pcap"

qemu-img create -f qcow2 -b "$TPL1" -F qcow2 "$OVL1" >/dev/null
qemu-img create -f qcow2 -b "$TPL2" -F qcow2 "$OVL2" >/dev/null

PORT1=$(( PORT_BASE + 1 ))
PORT2=$(( PORT_BASE + 2 ))
MAC1="52:54:00:e1:00:01"
MAC2="52:54:00:e1:00:02"

nic_setup_hint() {
  local os="$1" ip="$2"
  case "$os" in
    alpine)  echo "ip addr add ${ip}/24 dev eth0 && ip link set eth0 up" ;;
    freebsd) echo "ifconfig vtnet0 inet ${ip}/24 up" ;;
    openbsd) echo "ifconfig vio0 inet ${ip}/24 up" ;;
    netbsd)  echo "ifconfig vioif0 ${ip}/24 up" ;;
    *)       echo "# assign ${ip}/24 to the primary virtio interface" ;;
  esac
}

HINT1="$(nic_setup_hint "$NODE1_OS" "10.42.0.1")"
HINT2="$(nic_setup_hint "$NODE2_OS" "10.42.0.2")"

# ------------------------------------------------------------------------------
# 3. Automatic process & overlay cleanup on exit
# ------------------------------------------------------------------------------
cleanup() {
  echo ""
  log_info "Stopping test processes and cleaning up..."
  for pidfile in "$RUNTIME_DIR"/*.pid; do
    if [[ -f "$pidfile" ]]; then
      local pid
      pid="$(cat "$pidfile" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    fi
  done

  if [[ "$KEEP_DISKS" -eq 0 ]]; then
    rm -f "$OVL1" "$OVL2" 2>/dev/null || true
  else
    log_info "Overlay disks preserved in: $SMOKE_DIR"
  fi
  rm -rf "$RUNTIME_DIR" 2>/dev/null || true

  if [[ -f "$PCAP_FILE" ]]; then
    echo ""
    log_ok "Wire packet capture saved to:"
    printf "       ${BOLD}%s${NC}\n" "$PCAP_FILE"
    if command -v tcpflowy >/dev/null 2>&1; then
      printf "       Dissect TCP flows directly via: ${GREEN}tcpflowy \"%s\"${NC}\n" "$PCAP_FILE"
    else
      printf "       (If tcpflowy is installed: ${GREEN}tcpflowy \"%s\"${NC})\n" "$PCAP_FILE"
    fi
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------------------
# 4. Generate per-node boot wrappers (with inline IP cheat-sheets)
# ------------------------------------------------------------------------------
cat > "$RUNTIME_DIR/boot_node1.sh" <<EOF
#!/usr/bin/env bash
printf "\033[1;36m=== NODE 1 (${NODE1_OS}) | MAC: ${MAC1} | UDP ${PORT1} -> ${PORT2} ===\033[0m\n"
printf "\033[1;33m1) Login:\033[0m     root (passwordless on standard base templates)\n"
printf "\033[1;33m2) Setup IP:\033[0m  ${HINT1}\n"
printf "\033[1;33m3) Ping test:\033[0m ping -c 3 10.42.0.2\n"
printf "\033[0;90m(Exit QEMU anytime: press Ctrl+A followed by X)\033[0m\n\n"
echo \$\$ > "$RUNTIME_DIR/node1.pid"
exec qemu-system-aarch64 \\
  -M virt,highmem=on -accel hvf -cpu host -smp 2 -m 512 \\
  -bios "$EDK2_FD" \\
  -nographic \\
  -drive "if=none,id=hd0,file=$OVL1,format=qcow2" \\
  -device virtio-blk-pci,drive=hd0 \\
  -netdev "socket,id=net0,udp=127.0.0.1:${PORT2},localaddr=127.0.0.1:${PORT1}" \\
  -device "virtio-net-pci,netdev=net0,mac=${MAC1}" \\
  -object "filter-dump,id=tap0,netdev=net0,file=${PCAP_FILE}"
EOF

cat > "$RUNTIME_DIR/boot_node2.sh" <<EOF
#!/usr/bin/env bash
printf "\033[1;32m=== NODE 2 (${NODE2_OS}) | MAC: ${MAC2} | UDP ${PORT2} -> ${PORT1} ===\033[0m\n"
printf "\033[1;33m1) Login:\033[0m     root (passwordless on standard base templates)\n"
printf "\033[1;33m2) Setup IP:\033[0m  ${HINT2}\n"
printf "\033[1;33m3) TCP test:\033[0m  nc -l 8080   (then on Node 1: echo hello | nc 10.42.0.2 8080)\n"
printf "\033[0;90m(Exit QEMU anytime: press Ctrl+A followed by X)\033[0m\n\n"
echo \$\$ > "$RUNTIME_DIR/node2.pid"
exec qemu-system-aarch64 \\
  -M virt,highmem=on -accel hvf -cpu host -smp 2 -m 512 \\
  -bios "$EDK2_FD" \\
  -nographic \\
  -drive "if=none,id=hd0,file=$OVL2,format=qcow2" \\
  -device virtio-blk-pci,drive=hd0 \\
  -netdev "socket,id=net0,udp=127.0.0.1:${PORT1},localaddr=127.0.0.1:${PORT2}" \\
  -device "virtio-net-pci,netdev=net0,mac=${MAC2}"
EOF

chmod +x "$RUNTIME_DIR/boot_node1.sh" "$RUNTIME_DIR/boot_node2.sh"

# ------------------------------------------------------------------------------
# 5. Stream live capture into Wireshark (if installed)
# ------------------------------------------------------------------------------
if [[ "$USE_WIRESHARK" -eq 1 ]]; then
  if WS_BIN="$(find_wireshark)"; then
    log_info "Attaching live Wireshark stream to the virtual wire..."
    (
      # Wait until QEMU writes the 24-byte global libpcap header before piping
      for _ in $(seq 1 50); do
        if [[ -f "$PCAP_FILE" ]] && [[ "$(stat -f '%z' "$PCAP_FILE" 2>/dev/null || echo 0)" -ge 24 ]]; then
          tail -c +1 -f "$PCAP_FILE" | "$WS_BIN" -k -i - >/dev/null 2>&1 &
          echo $! > "$RUNTIME_DIR/wireshark_pipe.pid"
          break
        fi
        sleep 0.2
      done
    ) &
    echo $! > "$RUNTIME_DIR/ws_watcher.pid"
  else
    log_warn "Wireshark not found in /Applications; capture is still being recorded to $PCAP_FILE."
  fi
fi

# ------------------------------------------------------------------------------
# 6. Launch interactive consoles (split-screen tmux or macOS Terminal.app)
# ------------------------------------------------------------------------------
if [[ "$USE_TMUX" -eq 1 ]] && command -v tmux >/dev/null 2>&1; then
  SESSION="etherloom_smoke_$$"
  log_ok "Launching split-screen tmux session '${SESSION}' (mouse pane switching enabled)..."

  if [[ -z "${TMUX:-}" ]]; then
    tmux new-session -d -s "$SESSION" "$RUNTIME_DIR/boot_node1.sh"
    tmux set-option -t "$SESSION" mouse on >/dev/null
    tmux split-window -h -t "$SESSION" "$RUNTIME_DIR/boot_node2.sh"
    tmux select-pane -t "${SESSION}:0.0"
    tmux attach-session -t "$SESSION"
  else
    # Already inside tmux: open a dedicated window without nesting sessions
    WIN_ID="$(tmux new-window -P -F '#{window_id}' -n 'wire-smoke' "$RUNTIME_DIR/boot_node1.sh; tmux wait-for -S done1_$$")"
    tmux split-window -h -t "$WIN_ID" "$RUNTIME_DIR/boot_node2.sh; tmux wait-for -S done2_$$"
    tmux wait-for "done1_$$"
    tmux wait-for "done2_$$"
  fi
else
  log_info "Opening both VM consoles in macOS Terminal.app windows..."
  osascript <<APPLESCRIPT >/dev/null
tell application "Terminal"
  activate
  do script "$RUNTIME_DIR/boot_node1.sh"
  do script "$RUNTIME_DIR/boot_node2.sh"
end tell
APPLESCRIPT
  echo ""
  read -r -p "Press ENTER here when finished to stop both VMs and finalize the PCAP capture..." _
fi
