# Credits, Upstream Attributions & Open-Source Notice

**Etherloom** is free and open-source software distributed under the **GNU General Public License v3.0 or later (`GPL-3.0-or-later`)** — see [LICENSE](LICENSE).

Etherloom stands on the shoulders of extraordinary open-source systems, packet-analysis tools, hypervisors, operating systems, and libraries. Every upstream work integrated with, orchestrated by, or bundled alongside Etherloom is credited below with its license and role in the architecture.

---

## 1. Packet Analysis & Flow Dissection

| Project | Author / Maintainer | License | Role in Etherloom |
| :--- | :--- | :--- | :--- |
| **[`tcpflowy`](https://github.com/diorgulescu/tcpflowy)** | Dragos Iorgulescu | Open Source (PyPI / GitHub) | Powers the in-app **Visual Flow Dissector** via an isolated Python virtual environment (`tcpflowy_bridge.rs`): TCP/UDP flow reconstruction, SPLT burst-timing histograms, Shannon payload entropy, passive DNS correlation, JA3 fingerprinting, and Suricata / Wireshark / BPF rule synthesis. |
| **[Wireshark](https://www.wireshark.org/)** | Gerald Combs & The Wireshark Foundation | `GPL-2.0-or-later` | Invoked as an external unprivileged macOS application (`Wireshark.app`) reading real-time `LINKTYPE_ETHERNET` frames streamed over `/tmp/etherloom/tap_*.pcap` POSIX named FIFO pipes. |

---

## 2. Virtualization, Firmware & Host Platform

| Project | Author / Maintainer | License | Role in Etherloom |
| :--- | :--- | :--- | :--- |
| **[QEMU](https://www.qemu.org/)** | Fabrice Bellard & QEMU Contributors | `GPL-2.0-only` / `LGPL-2.1` | External hypervisor (`qemu-system-aarch64` / `qemu-system-x86_64`) and disk utility (`qemu-img`) providing VirtIO UDP socket networking, PL011 Unix serial ports, `ramfb` VNC displays, and Copy-on-Write `qcow2` overlays. |
| **Apple `Hypervisor.framework`** | Apple Inc. | macOS System SDK | Provides unprivileged userspace hardware-accelerated ARM64/x86_64 execution (`-accel hvf`) on Apple Silicon and Intel Macs without kernel extensions or `root`. |
| **[TianoCore EDK II](https://github.com/tianocore/edk2)** | TianoCore Contributors | `BSD-2-Clause-Patent` | UEFI boot firmware (`edk2-aarch64-code.fd`, distributed with Homebrew QEMU) enabling graphical and serial UEFI boot on ARM64 `-M virt` machines. |

> **GPL Compliance Note on External Binaries**: Etherloom does not statically link or redistribute QEMU or Wireshark binaries; instead, `env_doctor.rs` discovers user-installed copies on macOS and interacts with them strictly across standard OS process, UDP socket, Unix domain socket, and named-pipe boundaries.

---

## 3. Guest Operating Systems Orchestrated & Featured in Labs

Etherloom's 15-OS Catalog Manager, Guided Academy Labs (Labs 01–08), and [`scripts/prepare_library.sh`](scripts/prepare_library.sh) helper download and orchestrate official upstream releases of:

- **[Alpine Linux](https://alpinelinux.org/)** & **[Debian](https://www.debian.org/)** (*Linux Kernel & Userland Contributors*, `GPL-2.0` / `MIT` / DFSG open-source licenses) — Featured across Guided Labs 01–08 for lightweight hosts, static routing, and TCP traffic generation.
- **[OpenBSD](https://www.openbsd.org/)** (*The OpenBSD Project*, `ISC` / BSD-style licenses) — Featured in Guided Labs 03, 04 & 08 for stateful packet filtering (`pf`), `nat-to` / `rdr-to`, `CARP` + `pfsync` HA clusters, `OpenBGPD` (`RFC 8212`), and `vio(4)` VirtIO interfaces.
- **[FreeBSD](https://www.freebsd.org/)**, **[NetBSD](https://www.netbsd.org/)**, **[DragonFly BSD](https://www.dragonflybsd.org/)**, **[OPNsense](https://opnsense.org/)**, & **[pfSense CE](https://www.pfsense.org/)** (*BSD & Firewall Communities*, `BSD-2-Clause` / `Apache-2.0`) — Official ARM64 and `x86_64` VM/appliance distributions.
- **[OpenWrt](https://openwrt.org/)** (*The OpenWrt Project*, `GPL-2.0`) — Featured in Guided Lab 07 for modern UCI `bridge-vlan` / DSA `802.1Q` trunking, Router-on-a-Stick, and `fw4` (`nftables`) zone isolation.
- **[MikroTik RouterOS CHR](https://mikrotik.com/download)** (*MikroTikls SIA*, free-tier Cloud Hosted Router evaluation image fetched on demand by the user) & **[VyOS](https://vyos.io/)** (`GPL-2.0+`) — Featured in Guided Lab 08 for multi-vendor `eBGP` peering (`TCP/179`).
- **[FreeDOS](https://www.freedos.org/)** (`GPL-2.0+`) + **[mTCP](https://www.brutman.com/mTCP/)** (*Michael B. Brutman*, `GPL-3.0`) + **Crynwr Packet Drivers** (`GPL`) — Featured in Guided Lab 06 (`i386` TCG, `32 MB` RAM) for zero-noise ARP & TCP sequence/ack dissection.
- **[9front](https://9front.org/)** (`MIT`), **[OmniOS](https://omnios.org/)** (`CDDL` / open-source licenses), & **[Haiku](https://www.haiku-os.org/)** (`MIT`) — Supported research, UNIX, and desktop systems in the 15-OS catalog.

---

## 4. Rust Backend Libraries (`src-tauri/Cargo.toml`)

All Rust crate dependencies are GPLv3-compatible:

- **[Tauri v2](https://tauri.app/)** (`tauri`, `tauri-build`, `tauri-plugin-dialog`) — *The Tauri Programme within the Commons Conservancy* (`Apache-2.0 OR MIT`)
- **[Tokio](https://tokio.rs/)** (`tokio`, `bytes`) — *Tokio Contributors* (`MIT`)
- **[Serde](https://serde.rs/)** (`serde`, `serde_json`) — *Erick Tryzelaar & David Tolnay* (`Apache-2.0 OR MIT`)
- **[toml](https://github.com/toml-rs/toml)** — *toml-rs Contributors* (`Apache-2.0 OR MIT`)
- **[uuid](https://github.com/uuid-rs/uuid)** — *uuid-rs Contributors* (`Apache-2.0 OR MIT`)
- **[fastrand](https://github.com/smol-rs/fastrand)** — *smol-rs Contributors* (`Apache-2.0 OR MIT`)
- **[libc](https://github.com/rust-lang/libc)** — *The Rust Project Developers* (`Apache-2.0 OR MIT`)

---

## 5. Frontend Libraries & Tooling (`package.json`)

All JavaScript/TypeScript dependencies are GPLv3-compatible (`MIT`, `ISC`, `Apache-2.0`, and `MPL-2.0`):

- **[React 19](https://react.dev/)** (`react`, `react-dom`) — *Meta Platforms, Inc. & Affiliates* (`MIT`)
- **[React Flow (`@xyflow/react`)](https://reactflow.dev/)** — *webkid GmbH / xyflow* (`MIT`) — Powers the interactive topology canvas, custom node cards, and SVG wire edges.
- **[xterm.js (`@xterm/xterm`, `@xterm/addon-fit`)](https://xtermjs.org/)** — *xterm.js Contributors* (`MIT`) — Powers the embedded zero-buffered serial terminal tabs.
- **[noVNC (`@novnc/novnc`)](https://novnc.com/)** — *Joel Martin, Pierre Ossman & noVNC Contributors* (`MPL-2.0`, explicitly compatible with GNU GPLv3 under MPL 2.0 Section 3.3) — Powers the embedded UEFI / graphical framebuffer console.
- **[Lucide (`lucide-react`)](https://lucide.dev/)** — *Lucide Contributors* (`ISC`)
- **[Tailwind CSS](https://tailwindcss.com/)**, **[Vite](https://vite.dev/)**, **[TypeScript](https://www.typescriptlang.org/)**, **[PostCSS](https://postcss.org/)**, **[Autoprefixer](https://github.com/postcss/autoprefixer)** (`MIT` / `Apache-2.0`)

---

## 6. Project Authors & Contributors

- **[Dragoş Iorgulescu (`@diorgulescu`)](https://github.com/diorgulescu)** — Creator, System Architecture, `tcpflowy` Author & Maintainer
- **[Antigravity](https://antigravity.google/)** *(Google DeepMind Agentic AI)* — Co-Author & Engineering Contributor

---

## 7. Conceptual Acknowledgments

Etherloom draws pedagogical inspiration from pioneering open-source network emulation and education platforms — including **GNS3** (`GPL-3.0`), **Kathara / Netkit** (`GPL-3.0`), **IMUNES** (`BSD`), and **Containerlab** (`BSD-3-Clause`) — reimagined natively for unprivileged macOS Apple Silicon (`Hypervisor.framework`) with first-class BSD + Linux parity and built-in visual TCP flow dissection.
