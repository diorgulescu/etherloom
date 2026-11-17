# Etherloom — Master Technical Architecture

**License:** GNU General Public License v3.0 (`GPL-3.0-or-later`)  
**Target Platform:** macOS (Apple Silicon `aarch64` primary, Intel `x86_64` supported)  
**Privilege Model:** 100% Userspace — Zero `root` / `sudo` / `vmnet` entitlements required

---

## 1. Vision & Core Principles

**Etherloom** is an open-source, macOS-native network orchestration, simulation, and packet-inspection studio powered by QEMU and Apple's `Hypervisor.framework` (`-accel hvf`). It enables students, network engineers, and systems researchers to design multi-OS topologies, inject realistic link impairments, capture live Ethernet traffic into Wireshark, and dissect TCP/UDP flows directly inside the GUI—all without root privileges or kernel extensions.

1. **Zero-Root Execution:** Every VM process, virtual switch, wiretap, and console runs strictly under the unprivileged user account over loopback UDP sockets (`127.0.0.1`), Unix domain sockets, and named FIFO pipes.
2. **First-Class BSD & Linux Citizens:** Native interface naming, virtio driver profiles, and graphical UEFI installation workflows for Linux, FreeBSD, OpenBSD, and NetBSD.
3. **Transparent Wire Visibility:** Every virtual cable is an observable, impairable medium inside a central Rust `PacketFabric`.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Desktop Shell & IPC** | **Tauri v2** (Rust 2021 edition) | Native macOS windowing, menus, filesystem access, typed IPC commands & events |
| **Async Backend Runtime** | **`tokio`** | Non-blocking UDP packet fabric, Unix socket serial bridges, VNC proxy, child process supervision |
| **Frontend UI** | **React 19 + TypeScript + Vite** | Reactive studio shell, state management, inspector views |
| **Styling & Icons** | **TailwindCSS + `lucide-react`** | macOS-native dark/light adaptive vibrancy aesthetic, crisp iconography |
| **Topology Canvas** | **`@xyflow/react`** | Interactive node/port graph, link status badges, wiretap & impairment controls |
| **Serial Console** | **`@xterm/xterm`** | Multiplexed terminal emulator bridged to QEMU `chardev` Unix sockets |
| **Graphical Console** | **`@novnc/novnc`** | Embedded HTML5 VNC client attached to QEMU UEFI `ramfb` framebuffer (plus optional `-display cocoa`) |
| **Packet & Flow Analysis** | **`tcpflowy` + Wireshark** | Integrated Python bridge (`https://github.com/diorgulescu/tcpflowy` via PyPI) for GUI flow inspection, plus live FIFO streaming to Wireshark |

---

## 3. Repository & Directory Structure

```text
etherloom/
├── .github/workflows/           # GitHub Actions CI, macOS deliverables & Pages pipelines
│   ├── ci.yml
│   ├── release-macos.yml
│   └── pages.yml
├── ARCHITECTURE.md              # Master technical specification (this document)
├── README.md                    # Open-source documentation, diagram & quickstart
├── CREDITS.md                   # Upstream open-source attributions & GPLv3 compliance notice
├── LICENSE                      # GNU General Public License v3.0 (GPL-3.0-or-later)
├── docs/                        # Static GitHub Pages project website
│   ├── index.html
│   ├── styles.css
│   └── .nojekyll
├── scripts/                     # macOS ARM64 template library & UDP wire smoke-test scripts
│   ├── prepare_library.sh
│   ├── prepare-library.sh
│   └── smoke-test-wire.sh
├── labs/                        # Built-in Guided Academy Lab bundles (lab.toml + guide.md)
│   ├── 01-ethernet-hubs-switches-arp/
│   ├── 02-ip-subnetting-static-routing/
│   ├── 03-openbsd-pf-stateful-nat/
│   ├── 04-openbsd-carp-pfsync-ha/
│   ├── 05-tcp-handshakes-window-loss/
│   ├── 06-freedos-mtcp-zero-noise/
│   ├── 07-openwrt-8021q-vlans/
│   └── 08-mikrotik-openbsd-ebgp/
├── package.json                 # Frontend dependencies & scripts
├── index.html                   # Vite entry point
├── vite.config.ts               # Vite bundler config for Tauri v2
├── tsconfig.json                # Strict TypeScript configuration
├── src/                         # React 19 + TypeScript frontend
│   ├── main.tsx
│   ├── App.tsx                  # macOS studio shell & layout orchestrator
│   ├── styles/                  # TailwindCSS & theme tokens
│   ├── types/                   # Shared TypeScript interfaces mirroring Rust serde models
│   ├── hooks/                   # Theme, Tauri IPC, workspace, and console hooks
│   └── components/
│       ├── academy/             # AcademyModal browser & collapsible right-side LabGuideDrawer
│       ├── layout/              # Toolbar, LeftSidebar, WorkspaceCanvas, BottomDock
│       ├── modals/              # StorageLibraryModal, WelcomeModal, DependencyCheckModal, Settings, VM Wizard
│       ├── canvas/              # @xyflow/react nodes, edges, port handles & lab wire highlights
│       ├── console/             # xterm.js serial tabs & noVNC graphical display views
│       └── inspector/           # Link impairments, live capture controls, tcpflowy Flow Inspector
└── src-tauri/                   # Rust 2021 backend crate
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json         # Tauri v2 capability permissions
    └── src/
        ├── main.rs              # Binary entry point
        ├── lib.rs               # Tauri builder, state registration, IPC command handlers
        ├── academy.rs           # Guided Lab engine, template readiness & clean sandbox instantiation
        ├── catalog.rs           # Curated 15-OS catalog, .staging/ download streamer & 1-click Guided Setup
        ├── env_doctor.rs        # Multi-arch QEMU, EDK2 UEFI firmware, Wireshark, Python/uv discovery
        ├── storage.rs           # Split storage config (settings.toml), /Volumes mount guard, statfs & migration
        ├── images.rs            # 15 OS profiles, golden templates, CoW overlays & portable qcow2 auto-rebase
        ├── vm_manager.rs        # Multi-arch QEMU HVF/TCG supervisor, QMP shutdown, Unix serial & VNC/Cocoa display
        ├── fabric.rs            # Central UDP PacketFabric, L2 MAC table, L1 hub, impairments & link telemetry
        ├── console_bridge.rs    # Async Unix serial & VNC TCP-to-WebSocket console multiplexer
        ├── pcap_tap.rs          # Zero-copy libpcap (.pcap) recorder & live Wireshark named FIFO streamer
        ├── tcpflowy_bridge.rs   # Managed python-env venv installer & tcpflowy JSON/ladder dissector bridge
        └── workspace.rs         # *.etherloom bundle reader/writer & topology.toml persistence
```

---

## 4. Multi-Architecture Guest Matrix & Built-in Nodes

Etherloom orchestrates **15 curated operating systems** across 4 CPU architectures (`aarch64`, `x86_64`, `i386`, `riscv64`), 5 PCI Ethernet controller models (`virtio-net-pci`, `e1000`, `rtl8139`, `pcnet`, `ne2k_pci`), 2 firmware modes (`uefi`, `bios`), and 3 primary disk buses (`virtio-blk`, `ahci`, `ide`), alongside built-in userspace switching devices:

| OS / Node | Arch | Default NIC | Guest Interface Naming | Default Firmware / Disk |
| :--- | :--- | :--- | :--- | :--- |
| **Alpine Linux** | `aarch64` | `virtio-net-pci` | `eth0`, `eth1`, … | UEFI / `virtio-blk` |
| **Debian Cloud** | `aarch64` | `virtio-net-pci` | `enp0s1` / `eth0`, … | UEFI / `virtio-blk` |
| **FreeBSD** | `aarch64` | `virtio-net-pci` | `vtnet0` (or `em0` w/ `e1000`) | UEFI / `virtio-blk` |
| **OpenBSD** | `aarch64` | `virtio-net-pci` | `vio0` (or `em0` w/ `e1000`) | UEFI / `virtio-blk` |
| **NetBSD** | `aarch64` | `virtio-net-pci` | `vioif0` (or `wm0` w/ `e1000`) | UEFI / `virtio-blk` |
| **OpenWrt** | `aarch64` | `virtio-net-pci` | `eth0` (`br-lan`), `eth1` (`wan`) | UEFI / `virtio-blk` |
| **MikroTik RouterOS CHR** | `aarch64` | `virtio-net-pci` | `ether1`, `ether2` (1-based) | UEFI / `virtio-blk` |
| **VyOS** | `x86_64` | `virtio-net-pci` | `eth0`, `eth1`, … | SeaBIOS / `virtio-blk` |
| **OPNsense (`nano`)** | `x86_64` | `e1000` | `em0` (LAN), `em1` (WAN) | SeaBIOS / `virtio-blk` |
| **pfSense CE** | `x86_64` | `e1000` | `em0` (WAN), `em1` (LAN) | UEFI / `virtio-blk` |
| **9front (Plan 9)** | `aarch64` | `virtio-net-pci` | `/net/ether0`, `/net/ether1` | UEFI / `virtio-blk` |
| **OmniOS (Illumos)** | `x86_64` | `e1000` | `e1000g0`, `e1000g1` (`dladm`) | SeaBIOS / `virtio-blk` |
| **DragonFly BSD** | `x86_64` | `e1000` | `em0`, `em1` | SeaBIOS / `ahci` |
| **Haiku OS** | `x86_64` | `e1000` | `/dev/net/ipro1000/0` | UEFI / `ahci` |
| **FreeDOS + mTCP** | `i386` | `pcnet` | `PCNTPK 0x60` (`32 MB` RAM) | SeaBIOS / `ide` |
| **L2 Switch** | `PacketFabric` | Virtual ports | `p1`..`p8` | IEEE 802.1D MAC learning bridge |
| **L1 Hub** | `PacketFabric` | Virtual ports | `p1`..`p6` | Shared-medium repeater |

Deterministic locally administered MAC addresses (`52:54:00:XX:YY:ZZ` or project-scoped `02:EL:XX:YY:ZZ:PP`) are assigned per `(node_id, port_index)` so guest interface ordering corresponds predictably to topology ports (`0 -> eth0 / vtnet0 / vio0 / vioif0`).

---

## 5. Zero-Root Data Plane (`PacketFabric`)

### 5.1 QEMU UDP Socket Netdev Framing
Each VM NIC port `X` is wired exclusively to loopback UDP sockets:

```text
-netdev socket,id=netX,udp=127.0.0.1:<fabric_port>,localaddr=127.0.0.1:<node_port>
-device virtio-net-pci,netdev=netX,mac=<mac_addr>
```

> **Critical Wire Protocol Rule:** QEMU `-netdev socket,udp=...` transmits **one raw IEEE 802.3 / Ethernet II frame per UDP datagram** (starting immediately with the 6-byte Destination MAC, 6-byte Source MAC, 2-byte EtherType/802.1Q tag, and payload, without FCS) with **NO 4-byte length prefix**. (Length prefixes exist only on QEMU TCP stream socket netdevs, never on UDP socket netdevs.) Maximum UDP buffer size is `65536` bytes to accommodate jumbo frames and virtio offloads cleanly.

### 5.2 Central `PacketFabric` Architecture
The `PacketFabric` runs inside Tauri's `tokio` runtime:
1. **Port Endpoints:** For every VM NIC port, `PacketFabric` binds `127.0.0.1:<fabric_port>` and pairs it with the guest's `127.0.0.1:<node_port>` (ephemeral ports reserved prior to VM launch).
2. **Link Routing:** When a frame arrives on port `A` linked to port `B`:
   - If the link `admin_state` is `Down` (cable cut), the frame is dropped after ingress stats accounting (or optional pre-cut tap policy).
   - **Wiretaps:** Active taps on link `A <-> B` receive a zero-copy `Bytes` clone of the Ethernet II frame along with microsecond UTC timestamps.
   - **Link Impairments:** Each link maintains directional or symmetric impairment parameters:
     - `loss_percent` (`0.0..=100.0`): Bernoulli or Gilbert-Elliott packet drop check.
     - `latency_ms` (`u32`) + `jitter_ms` (`u32`): Frames scheduled onto a `tokio::time` delay queue (preserving or jittering delivery according to config) before egress transmission.
     - `bandwidth_kbps` (optional token-bucket rate limiter).
3. **Built-in L2 Switch & L1 Hub Processing:**
   - **L1 Hub:** Floods incoming frames to every other connected port on the hub.
   - **L2 Switch:** Parses Ethernet II `src_mac` (`bytes[6..12]`) and `dst_mac` (`bytes[0..6]`). Learns `(vlan, src_mac) -> ingress_port` with a 300-second aging timer. Unicast hits forward strictly to the learned egress port; broadcast (`ff:ff:ff:ff:ff:ff`), multicast (`dst_mac[0] & 1 == 1`), and unknown unicast flood to all other active switch ports.

### 5.3 Non-Root Packet Capture & Live Wireshark Streaming
Every link supports two simultaneous tap sinks:
1. **Persistent `.pcap` File Writer:** Writes standard libpcap global header (`magic = 0xa1b2c3d4`, `version = 2.4`, `snaplen = 65535`, `network = 1` / `LINKTYPE_ETHERNET`) followed by per-packet records directly into `<workspace>.etherloom/captures/<link>-<timestamp>.pcap`.
2. **Live Wireshark Named Pipe (`mkfifo`):** Creates a Unix FIFO in `$TMPDIR/etherloom-taps/<link_id>.fifo`, spawns `/Applications/Wireshark.app/Contents/MacOS/Wireshark -k -i <fifo_path>`, and streams the libpcap header + live frames non-blockingly so closing Wireshark (`EPIPE`) cleanly detaches the live tap without stalling `PacketFabric`.

---

## 6. Multi-Architecture QEMU Engine & Dual Console Architecture

### 6.1 Per-Architecture Machine, Acceleration & Firmware Selection
`vm_manager::build_qemu_args` dynamically selects the QEMU binary, machine model, hardware vs. MTTCG acceleration, firmware, display adapter, and disk/NIC buses based on `(host_arch, guest_arch, firmware, disk_bus, nic_model)`:

- **`GuestArch::Aarch64` (`qemu-system-aarch64`)**:
  - Machine: `-M virt,highmem=on`
  - Acceleration: `-accel hvf -cpu host` on Apple Silicon (`aarch64` host), or `-accel tcg,thread=multi,tb-size=512 -cpu max` on Intel Macs.
  - Firmware & Display: Read-only `edk2-aarch64-code.fd` pflash + `-device ramfb` + `qemu-xhci` USB keyboard/tablet.
- **`GuestArch::X86_64` (`qemu-system-x86_64`)**:
  - Machine: `-M q35`
  - Acceleration: `-accel hvf -cpu host` on Intel Macs (`x86_64` host), or `-accel tcg,thread=multi,tb-size=1024 -cpu max` on Apple Silicon.
  - Firmware & Display: SeaBIOS (default when `firmware = "bios"`, ideal for OPNsense `nano`, VyOS, OmniOS, DragonFly BSD) or `edk2-x86_64-code.fd` pflash (`firmware = "uefi"`), paired with `-vga std` + `qemu-xhci` USB tablet.
- **`GuestArch::I386` (`qemu-system-i386`)**:
  - Machine: `-M pc -accel tcg -cpu pentium3` with `-vga std`, supporting RAM footprints down to `16–32 MB`, Legacy IDE (`-hda`/`-cdrom`), and classic Crynwr packet-driver NICs (`pcnet`, `ne2k_pci`, `rtl8139`) for FreeDOS + mTCP.
- **`GuestArch::Riscv64` (`qemu-system-riscv64`)**:
  - Machine: `-M virt -accel tcg,thread=multi -cpu rv64 -bios default` (OpenSBI) + `-device virtio-gpu-pci`.

All newly added fields (`arch`, `nic_model`, `firmware`, `disk_bus`) use `#[serde(default)]` across `WorkspaceNode`, `WorkspacePort`, `OsProfile`, `BaseTemplateInfo`, and `SpawnVmRequest` to guarantee **100% backward compatibility** with Phase 2 `topology.toml` projects, Phase 5 Academy labs, and `scripts/prepare_library.sh` templates.

### 6.2 Dual Console Channels (Always Provisioned)
Many BSD installers (`FreeBSD`, `OpenBSD`, `NetBSD`) boot into the EFI framebuffer console by default before `/boot/loader.conf` or `/etc/boot.conf` is configured for serial output. Therefore, **every VM** exposes two consoles simultaneously:

1. **Serial Console (`PL011` / `ttyAMA0` / `ttyu0` / `com0` -> `xterm.js`):**
   ```text
   -chardev socket,id=serial0,path=<run_dir>/<node_id>-serial.sock,server=on,wait=off
   -serial chardev:serial0
   ```
   A Rust `tokio::net::UnixStream` task connects to `<node_id>-serial.sock`, maintains a ring buffer of recent console output, and streams bidirectional bytes to `@xterm/xterm` tabs in the bottom console dock via Tauri IPC events/channels.

2. **Graphical UEFI Framebuffer (`ramfb` -> `noVNC` or Native Cocoa):**
   ```text
   -device ramfb
   -device qemu-xhci,id=xhci
   -device usb-kbd
   -device usb-tablet
   -display vnc=127.0.0.1:<vnc_display_offset>,websocket=127.0.0.1:<ws_port>
   ```
   *(Alternatively, if QEMU's built-in VNC WebSocket option is not compiled in a given build, Etherloom's Rust backend runs a lightweight `tokio-tungstenite` TCP-to-WebSocket RFB proxy on `127.0.0.1:<ws_port>` connected to QEMU's raw VNC TCP port, or launches QEMU with `-display cocoa` when the user selects "Native macOS Window".)*  
   Inside the UI, `@novnc/novnc` connects to `ws://127.0.0.1:<ws_port>` so users can perform full ISO/IMG installations of FreeBSD, OpenBSD, and NetBSD directly inside Etherloom.

   **WebSocket Bridge Hardening:** The Rust TCP-to-WebSocket bridge binds `127.0.0.1` only and validates every upgrade request: the `Host` header must be a loopback literal (DNS-rebinding guard) and, when present, the `Origin` header must be an allowlisted Etherloom origin (`tauri://localhost`, `http://tauri.localhost`, or the `http://localhost:1420` Vite dev server) — cross-origin browser pages receive `HTTP 403`. Client frames must be masked per RFC 6455 and are capped at 4 MiB. The app also ships a strict CSP (`script-src 'self'`, `object-src 'none'`, `connect-src` limited to self + the loopback WS bridge + dev server), with the pre-paint theme bootstrap externalized to `/brand/theme-init.js` so no inline script is needed.

---

## 7. `tcpflowy` Native GUI Integration

Saved `.pcap` files in `<workspace>.etherloom/captures/` can be analyzed in-app without leaving Etherloom:
1. **Isolated Python Environment:** Etherloom discovers `uv` or `python3` via `env_doctor` and manages an isolated virtual environment under `~/Library/Application Support/Etherloom/python-env/` with `tcpflowy` (`https://github.com/diorgulescu/tcpflowy`, installed from PyPI).
2. **Rust Execution Bridge (`src-tauri/src/tcpflowy/`):** Invokes `tcpflowy` asynchronously against a target `.pcap` capture file, parsing structured JSON / flow summary output (5-tuple endpoints, TCP state machine transitions, retransmissions, RTT metrics, byte/packet counts, reconstructed payload streams, TLS/HTTP metadata).
3. **Interactive Flow Inspector UI:** Renders filterable flow tables, TCP sequence/timeline waterfalls, anomaly badges (SYN timeouts, zero-window, out-of-order/retransmits), and ASCII/Hex stream reconstruction inside the bottom Inspector Dock.

---

## 8. Configurable Storage Architecture & External Drive Resilience

Many macOS users keep multi-gigabyte VM templates, installer media, and lab overlays on external USB-C/Thunderbolt SSDs (`/Volumes/...`). Etherloom strictly separates lightweight internal runtime state from user-relocatable heavy media storage (`src-tauri/src/storage.rs`).

### 8.1 Split Storage Layout: Fixed Internal vs. Relocatable Heavy Media

1. **Internal App Config & Runtime (Always Local SSD — Never Relocated):**
   ```text
   ~/Library/Application Support/Etherloom/
   ├── settings.toml                # Lightweight user preferences & StorageConfig (a few KB)
   └── python-env/                  # Isolated tcpflowy Python venv (requires POSIX symlinks; breaks on ExFAT)

   /tmp/etherloom/
   ├── <node_id>_serial.sock        # QEMU serial Unix socket (avoids macOS 104-byte sun_path limit)
   ├── <node_id>_qmp.sock           # QEMU QMP control Unix socket
   └── <link_id>.fifo               # Named FIFO pipes for live Wireshark (POSIX FIFOs unsupported on ExFAT)
   ```

2. **Configurable Heavy Media Storage (`StorageConfig` in `settings.toml`):**
   - Primary `storage_root` defaults to `~/Library/Application Support/Etherloom/Library`, with optional independent path overrides:
     - `templates_dir` — Read-only base `.qcow2` Golden Images + `.template.json` sidecars (default: `{storage_root}/templates`)
     - `isos_dir` — Installer `.iso` and `.img` media (default: `{storage_root}/isos`)
     - `workspaces_dir` — Default parent directory for new `*.etherloom` lab projects, overlays, and `.pcap` captures (default: `{storage_root}/projects`)

### 8.2 External Volume Guard, Disconnected Resilience & `statfs` Telemetry
- **Unmounted `/Volumes/<VolumeName>` Guard:** Before calling `create_dir_all` on any path beginning with `/Volumes/<VolumeName>`, Etherloom verifies that `/Volumes/<VolumeName>` exists AND is an active mounted filesystem (comparing POSIX `st_dev` device IDs against `/Volumes`, while permitting boot-volume symlinks to `/`). Etherloom **never** creates stub directories under `/Volumes` when an external SSD is unplugged.
- **Graceful Disconnected State:** If a configured external drive is unplugged at startup or mid-session, Etherloom enters `StorageStatus::VolumeDisconnected { expected_path, volume_name }` without panicking, presenting UI recovery actions: **Retry Detection**, **Select Different Folder…**, or **Fallback to Default Internal Storage**.
- **Disk Space & Filesystem Telemetry:** Queries macOS `statfs` on active storage paths to report **Free Disk Space**, **Total Capacity**, and **Filesystem Type** (`apfs`, `exfat`, `hfs`, etc.). When `exfat` is detected, the UI surfaces a non-blocking tip noting that while ExFAT works cleanly, `APFS` offers superior Copy-on-Write sparse `.qcow2` space efficiency.
- **Library Migration Modes:** Selecting a new `storage_root` via native macOS folder pickers (`tauri-plugin-dialog`) offers **Switch Path Only** (instant pointer switch + auto-discovery of existing `.qcow2`/`.iso`/`.img` media) or **Move Existing Library Data** (chunked async copy with live progress events, byte-size verification, `settings.toml` update, and optional source cleanup).

### 8.3 Portable `qcow2` Backing-File Auto-Rebase
QEMU stores an absolute backing-file path inside each Copy-on-Write overlay `.qcow2` header. Moving `templates_dir` to an external SSD or opening a `.etherloom` project on another Mac would break hardcoded paths unless rebased:
- Each VM node records its logical `template_id` / filename alongside its overlay disk.
- Prior to VM boot (and on project load), Etherloom inspects `<overlay.qcow2>` via `qemu-img info --output=json`.
- Whenever `backing-filename` differs from `<active_templates_dir>/<template_filename>`, Etherloom automatically runs:
  ```text
  qemu-img rebase -u -b <resolved_template_path> -F qcow2 <overlay_path>
  ```
  Using `-u` (unsafe header-only mode) updates the backing pointer instantaneously even when the previous mount point or host path no longer exists.

### 8.4 Self-Contained `*.etherloom` Project Bundle
Each user lab is a portable directory ending in `.etherloom`. Because bundles may be shared between machines, relative `disk_path` values in `topology.toml` are **confined to the bundle**: any `..` component is rejected at resolution time (`resolve_node_disk_in_bundle`), so an untrusted project can never point QEMU's read-write disk at files outside the `.etherloom` directory. Absolute paths remain an explicit, user-chosen override:

```text
campus-bgp-lab.etherloom/
├── topology.toml                # Declarative nodes, NICs, links, impairments, canvas coordinates
├── overlays/                    # Per-node CoW qcow2 disks (auto-rebased to active templates_dir)
│   └── rtr1-disk0.qcow2
└── captures/                    # Recorded link packet captures (.pcap)
    └── link-rtr1-sw1-20261113T163000Z.pcap
```

### 8.5 `topology.toml` Schema Specification

```toml
schema_version = 1
name = "Campus Dual-Stack Lab"
created_at = "2026-11-13T16:00:00Z"

[[nodes]]
id = "node-openbsd-fw1"
name = "fw1"
kind = "vm"                      # "vm" | "l2_switch" | "l1_hub"
guest_family = "openbsd"         # "linux" | "freebsd" | "openbsd" | "netbsd"
template_id = "openbsd-7.6-arm64"
vcpus = 2
memory_mb = 1024
display_mode = "vnc"             # "vnc" | "cocoa"
position = { x = 240.0, y = 180.0 }

  [[nodes.ports]]
  id = "fw1-p0"
  index = 0
  label = "vio0"
  mac = "52:54:00:10:01:00"

  [[nodes.ports]]
  id = "fw1-p1"
  index = 1
  label = "vio1"
  mac = "52:54:00:10:01:01"

[[nodes]]
id = "node-sw-core"
name = "sw-core"
kind = "l2_switch"
ports_count = 8
position = { x = 520.0, y = 180.0 }

[[links]]
id = "link-fw1-swcore"
source_node = "node-openbsd-fw1"
source_port = "fw1-p0"
target_node = "node-sw-core"
target_port = "sw-core-p0"
admin_up = true

  [links.impairments]
  latency_ms = 5
  jitter_ms = 1
  loss_percent = 0.0
```

---

## 9. Environment Doctor (`env_doctor`) Contract

Before starting VMs, wiretaps, or flow inspections, the Rust `env_doctor` module probes host readiness without requiring shell profile hacks (essential because macOS GUI `.app` bundles launch with a minimal `PATH` excluding `/opt/homebrew/bin` and `/usr/local/bin`):

| Dependency | Probe Locations | Required For | Severity if Missing |
| :--- | :--- | :--- | :--- |
| **`qemu-system-aarch64`** | `/opt/homebrew/bin`, `/usr/local/bin`, `PATH` | Booting ARM64 HVF virtual machines | Amber warning (blocks ARM64 VM start) |
| **`qemu-system-{x86_64,i386,riscv64}`** | `/opt/homebrew/bin`, `/usr/local/bin`, `PATH` | Multi-arch TCG/HVF VMs (OPNsense, pfSense, VyOS, OmniOS, DragonFly, Haiku, FreeDOS) | Amber warning (blocks non-ARM64 VM start) |
| **`qemu-img`** | `/opt/homebrew/bin`, `/usr/local/bin`, `PATH` | Creating CoW `qcow2` overlays & converting downloaded raw images | Amber warning (blocks VM creation) |
| **`edk2-{aarch64,x86_64}-code.fd`** | `/opt/homebrew/share/qemu/`, `/usr/local/share/qemu/` | UEFI boot firmware for `-M virt` and `-M q35` | Amber warning (blocks UEFI VM start) |
| **`Wireshark`** | `/Applications/Wireshark.app/Contents/MacOS/Wireshark`, `wireshark`/`tshark` in `/opt/homebrew/bin`, `/usr/local/bin`, `PATH` | Live FIFO wiretapping (`Wireshark.app`) / CLI capture inspection | Amber warning (optional; `.pcap` file capture still works natively) |
| **`python3` / `uv`** | `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, `PATH` | Isolated `tcpflowy` environment & Flow Inspector | Amber warning (optional; disables in-app `tcpflowy` inspector until installed) |

---

## 10. On-Demand OS Catalog & `.staging/` Download Pipeline (`catalog.rs`)

`src-tauri/src/catalog.rs` and `StorageLibraryModal.tsx` provide an integrated **Storage & 15-OS Library Manager**:
1. **External-SSD-Safe `.staging/` Streaming:** Downloads, checksum checks (e.g. OpenBSD `SHA256`), archive extractions (`.xz`, `.gz`, `.bz2`, `.zip`), and `qemu-img convert -O qcow2` operations execute strictly inside `{active_storage_root}/.staging/` rather than `/tmp`, preventing internal macOS disk exhaustion when users target an external `/Volumes/...` SSD.
2. **Real-Time Progress & Cancellation:** Emits `"catalog://download-progress"` events (`stage`, `bytesDownloaded`, `totalBytes`, `percent`, `message`) every 220 ms and supports instant task cancellation with deterministic `.staging/` cleanup.
3. **1-Click Guided Template Setup & Auto-Promotion:** For installer-delivered OSes (OpenBSD `install76.img`, VyOS, DragonFly BSD, Haiku, FreeDOS), `catalog_launch_guided_setup` creates a target `.qcow2` disk, boots the installer with Serial + VNC attached, and registers a `FinalizeTemplateOnExit` hook in `VmManager`. Upon clean guest shutdown (`halt -p` / `poweroff`) with a populated disk (`> 2 MB`), Etherloom automatically detaches the installer, writes `<slug>-<arch>-base.qcow2.etherloom-template.json`, and locks the Golden Template to POSIX `0444` read-only.
4. **Reference-Checked Deletion:** Before deleting any template, `find_referencing_projects` inspects `.qcow2` overlays across `projects/*.etherloom/overlays/` via `qemu-img info` and warns the user if any saved topologies depend on that backing file.
5. **Download Integrity & URL Hygiene (fail-closed):** Custom mirror URLs are restricted to `https://` (plain `http://` only for loopback hosts such as `127.0.0.1`/`localhost`/`[::1]`) — `file://`, `ftp://`, etc. are rejected before any network or disk activity. Upstream resolvers prefer HTTPS variants of mirror links (e.g. 9front/OmniOS) and emit a loud progress warning if a plaintext HTTP URL has to be used. Checksum verification **fails closed**: if the upstream `SHA256` manifest does not list the artifact, the download is rejected instead of silently accepted. Users may optionally supply a `customSha256` (64 hex chars) for a custom mirror, verified with `shasum -a 256` before extraction. URL-derived filenames are sanitized to a single safe path component, and `.zip` archives are pre-scanned with `zipinfo -1` (plus a post-extraction canonicalization containment check) so `..`/absolute entries (zip-slip) are refused.
