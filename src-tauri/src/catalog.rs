use crate::env_doctor::resolve_macos_binary;
use crate::images::{find_os_profile, BaseTemplateInfo, ImageStore, InstallerMediaInfo};
use crate::storage::StorageManager;
use crate::vm_manager::{
    BootMediaBus, DiskBus, FinalizeTemplateOnExit, FirmwareType, GuestArch, NicModel,
    SpawnVmRequest, VmDisplayMode, VmInstanceInfo, VmManager, VmNicConfig,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::{watch, RwLock};
use uuid::Uuid;

/// High-level OS family tab in the Unified Storage & OS Library Manager.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CatalogCategory {
    #[serde(rename = "Linux")]
    Linux,
    #[serde(rename = "BSD Family")]
    BsdFamily,
    #[serde(rename = "Routers & Firewalls")]
    RoutersAndFirewalls,
    #[serde(rename = "Research, UNIX & Retro")]
    ResearchUnixAndRetro,
}

/// How an OS image is provisioned onto the user's active storage library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogDeliveryKind {
    /// Upstream cloud/VM disk image downloads, extracts, and converts directly into a ready `.qcow2` Golden Template.
    ReadyToBoot,
    /// Upstream provides an official installer `.img`/`.iso` (e.g. OpenBSD KARL installer, VyOS rolling ISO)
    /// paired with Etherloom's 1-click **Launch Guided Template Setup** workflow.
    GuidedInstaller,
    /// Upstream requires portal sign-in/EULA (e.g. Netgate pfSense CE) — supports 1-click Local File or Custom URL import.
    ManualImport,
}

/// Live local readiness state of a catalog OS inside the active storage root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogAvailability {
    NotDownloaded,
    Downloading,
    InstallerReady,
    Ready,
}

/// Rich DTO describing one of the 15 curated operating systems in the OS Library Manager.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsCatalogEntryDto {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub category: CatalogCategory,
    pub os_profile_id: String,
    pub guest_family: String,
    pub arch: GuestArch,
    pub accel_hint: String,
    pub default_nic_model: NicModel,
    pub supported_nic_models: Vec<NicModel>,
    pub interface_naming: String,
    pub default_firmware: FirmwareType,
    pub default_disk_bus: DiskBus,
    pub default_vcpus: u8,
    pub default_ram_mb: u32,
    pub recommended_disk_gb: u32,
    pub estimated_download_mb: u32,
    pub delivery_kind: CatalogDeliveryKind,
    pub template_stem: String,
    pub default_credentials: String,
    pub official_url: String,
    pub upstream_source_label: String,
    pub quirks_and_tips: Vec<String>,
    pub availability: CatalogAvailability,
    pub installed_template_id: Option<String>,
    pub installed_template_path: Option<String>,
    pub installed_size_bytes: Option<u64>,
    pub installer_media_path: Option<String>,
    pub installer_media_size_bytes: Option<u64>,
}

/// Structured progress event emitted on `"catalog://download-progress"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadProgressEvent {
    pub catalog_id: String,
    /// `"Resolving"` | `"Downloading"` | `"Verifying"` | `"Extracting"` | `"Converting qcow2"` | `"Ready"` | `"InstallerReady"` | `"Cancelled"` | `"Error"`
    pub stage: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub message: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDownloadRequest {
    pub catalog_id: String,
    /// Optional custom mirror URL (`https://...`) overriding automatic upstream mirror discovery.
    #[serde(default)]
    pub custom_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogImportLocalRequest {
    pub catalog_id: String,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCatalogImageResult {
    pub catalog_id: String,
    pub deleted: bool,
    pub referencing_projects: Vec<String>,
    pub removed_paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct StaticCatalogSpec {
    id: &'static str,
    name: &'static str,
    tagline: &'static str,
    category: CatalogCategory,
    os_profile_id: &'static str,
    supported_nic_models: &'static [NicModel],
    interface_naming: &'static str,
    estimated_download_mb: u32,
    delivery_kind: CatalogDeliveryKind,
    template_stem: &'static str,
    installer_match_prefixes: &'static [&'static str],
    default_credentials: &'static str,
    official_url: &'static str,
    upstream_source_label: &'static str,
    quirks_and_tips: &'static [&'static str],
}

const STATIC_CATALOG: &[StaticCatalogSpec] = &[
    // 1. Alpine Linux
    StaticCatalogSpec {
        id: "alpine-linux",
        name: "Alpine Linux",
        tagline: "Ultra-fast musl/BusyBox ARM64 cloud router & packet generator",
        category: CatalogCategory::Linux,
        os_profile_id: "alpine-linux",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000, NicModel::Rtl8139],
        interface_naming: "eth0, eth1, …",
        estimated_download_mb: 58,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "alpine-aarch64-base",
        installer_match_prefixes: &["alpine-"],
        default_credentials: "root (no password on serial console)",
        official_url: "https://alpinelinux.org/cloud/",
        upstream_source_label: "dl-cdn.alpinelinux.org (aarch64 UEFI nocloud qcow2)",
        quirks_and_tips: &[
            "Boots to root login in ~2 seconds under Apple Hypervisor.framework (-accel hvf).",
            "Uses `ip addr`, `ip route`, `tcpdump`, `iperf3`, and `apk` for lightweight routing & host labs.",
            "Interfaces enumerate deterministically as `eth0`, `eth1`, … matching canvas port handles.",
        ],
    },
    // 2. Debian Cloud (Generic Linux)
    StaticCatalogSpec {
        id: "debian-linux",
        name: "Debian 12 Cloud (Generic Linux)",
        tagline: "Full systemd/glibc ARM64 Linux stack for FRRouting, nftables & namespaces",
        category: CatalogCategory::Linux,
        os_profile_id: "debian-linux",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000, NicModel::Rtl8139],
        interface_naming: "enp0s* / eth0..n",
        estimated_download_mb: 340,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "debian-aarch64-base",
        installer_match_prefixes: &["debian-"],
        default_credentials: "root (no password — official nocloud console image)",
        official_url: "https://cloud.debian.org/images/cloud/",
        upstream_source_label: "cloud.debian.org (Bookworm ARM64 nocloud qcow2)",
        quirks_and_tips: &[
            "Uses Debian's official `nocloud` image: logs in immediately as `root` on serial console with zero cloud-init delay.",
            "Systemd udev may name PCIe VirtIO NICs `enp0s*` (pass `net.ifnames=0` in `/etc/default/grub` if you prefer `eth0..n`).",
            "Ideal for FRRouting (`frr`), WireGuard, `nftables`, Linux network namespaces, and `scapy`.",
        ],
    },
    // 3. FreeBSD
    StaticCatalogSpec {
        id: "freebsd",
        name: "FreeBSD 14 RELEASE",
        tagline: "Production ARM64 BSD UNIX with PF/IPFW, VNET jails, CARP & dummynet",
        category: CatalogCategory::BsdFamily,
        os_profile_id: "freebsd",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000, NicModel::Rtl8139],
        interface_naming: "vtnet0..n (virtio) • em0..n (e1000)",
        estimated_download_mb: 580,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "freebsd-aarch64-base",
        installer_match_prefixes: &["freebsd-"],
        default_credentials: "root (no password)",
        official_url: "https://www.freebsd.org/",
        upstream_source_label: "download.freebsd.org (ARM64 UFS VM-IMAGE qcow2.xz)",
        quirks_and_tips: &[
            "Switching NIC Model from `virtio-net-pci` to `e1000` changes FreeBSD interface names from `vtnet0` to `em0`.",
            "First boot automatically grows the root UFS filesystem (`growfs`) to fill the 12 GB virtual disk.",
            "For headless serial console boot speed, add `console=\"comconsole,efi\"` to `/boot/loader.conf`.",
        ],
    },
    // 4. OpenBSD
    StaticCatalogSpec {
        id: "openbsd",
        name: "OpenBSD",
        tagline: "Gold-standard security & routing OS: PF, CARP, pfsync, OpenBGPD & ospfd",
        category: CatalogCategory::BsdFamily,
        os_profile_id: "openbsd",
        supported_nic_models: &[
            NicModel::VirtioNetPci,
            NicModel::E1000,
            NicModel::Rtl8139,
            NicModel::Pcnet,
            NicModel::Ne2kPci,
        ],
        interface_naming: "vio0..n (virtio) • em0..n (e1000)",
        estimated_download_mb: 480,
        delivery_kind: CatalogDeliveryKind::GuidedInstaller,
        template_stem: "openbsd-aarch64-base",
        installer_match_prefixes: &["openbsd-", "install7"],
        default_credentials: "Set during 2-minute Guided Setup (`root`)",
        official_url: "https://www.openbsd.org/",
        upstream_source_label: "cdn.openbsd.org (official arm64 installXX.img + SHA256)",
        quirks_and_tips: &[
            "OpenBSD intentionally ships no pre-baked cloud qcow2 so every system generates unique cryptographic keys & KARL (Kernel Address Randomized Link) binaries.",
            "Click 'Download Installer' followed by 'Launch Guided Template Setup': answer `com0` -> `115200` for serial console, install onto `sd0` (disk sets are already inside `installXX.img` — zero network needed!), then `halt -p` to auto-lock your Golden Template!",
            "Configure interfaces persistently via `/etc/hostname.vio0` and enable forwarding via `sysctl net.inet.ip.forwarding=1`.",
        ],
    },
    // 5. NetBSD
    StaticCatalogSpec {
        id: "netbsd",
        name: "NetBSD 10",
        tagline: "Clean, ultra-portable BSD UNIX with NPF firewall & rumpkernel heritage",
        category: CatalogCategory::BsdFamily,
        os_profile_id: "netbsd",
        supported_nic_models: &[
            NicModel::VirtioNetPci,
            NicModel::E1000,
            NicModel::Rtl8139,
            NicModel::Ne2kPci,
        ],
        interface_naming: "vioif0..n (virtio) • wm0..n (e1000)",
        estimated_download_mb: 360,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "netbsd-aarch64-base",
        installer_match_prefixes: &["netbsd-", "arm64.img"],
        default_credentials: "root (no password)",
        official_url: "https://www.netbsd.org/",
        upstream_source_label: "cdn.netbsd.org (NetBSD 10.1 evbarm-aarch64 arm64.img.gz)",
        quirks_and_tips: &[
            "Official `arm64.img.gz` boots directly via UEFI and automatically resizes its root partition on first boot.",
            "VirtIO NICs appear as `vioif0`, `vioif1`; Intel PRO/1000 (`e1000`) NICs appear as `wm0`, `wm1`.",
            "Features NetBSD's modern stateful NPF packet filter (`/etc/npf.conf` & `npfctl`).",
        ],
    },
    // 6. OpenWrt
    StaticCatalogSpec {
        id: "openwrt",
        name: "OpenWrt (ARM64 EFI)",
        tagline: "Embedded wireless/SOHO Linux router with UCI config, nftables fw4 & LuCI",
        category: CatalogCategory::RoutersAndFirewalls,
        os_profile_id: "openwrt",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000],
        interface_naming: "eth0 (br-lan), eth1 (wan), …",
        estimated_download_mb: 35,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "openwrt-aarch64-base",
        installer_match_prefixes: &["openwrt-"],
        default_credentials: "root (press Enter on serial console for instant ash shell)",
        official_url: "https://openwrt.org/",
        upstream_source_label: "downloads.openwrt.org (armsr/armv8 generic-ext4-combined-efi)",
        quirks_and_tips: &[
            "Tiny 128 MB RAM footprint — you can run 10+ OpenWrt routers simultaneously on an 8 GB MacBook Air.",
            "By default, `eth0` is bridged into `br-lan` (`192.168.1.1/24` with DHCP server) and `eth1` acts as `wan`.",
            "Inspect and edit network topology declaratively via `/etc/config/network` and `uci show network`.",
        ],
    },
    // 7. MikroTik RouterOS CHR
    StaticCatalogSpec {
        id: "mikrotik-chr",
        name: "MikroTik RouterOS CHR (v7 ARM64)",
        tagline: "ISP-grade ARM64 Cloud Hosted Router: OSPF, BGP, MPLS, VRF & VXLAN",
        category: CatalogCategory::RoutersAndFirewalls,
        os_profile_id: "mikrotik-chr",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000],
        interface_naming: "ether1, ether2, … (1-indexed!)",
        estimated_download_mb: 62,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "mikrotik-chr-aarch64-base",
        installer_match_prefixes: &["chr-", "mikrotik-"],
        default_credentials: "admin (empty password; prompts to set password on first login)",
        official_url: "https://mikrotik.com/download",
        upstream_source_label: "download.mikrotik.com (RouterOS v7 chr-*.arm64.img.zip)",
        quirks_and_tips: &[
            "Interfaces are 1-indexed (`ether1`, `ether2`, …) — Etherloom automatically labels RouterOS handles starting at `ether1`!",
            "Runs in perpetual free CHR mode (1 Mbps per-interface rate cap — plenty for BGP/OSPF/MPLS control-plane & TCP labs).",
            "By default, `ether1` runs a DHCP client; configure IPs via `/ip address add address=10.0.1.1/24 interface=ether1`.",
        ],
    },
    // 8. VyOS
    StaticCatalogSpec {
        id: "vyos",
        name: "VyOS (Rolling / Stream)",
        tagline: "Enterprise Junos-style commit/rollback CLI router built on Debian + FRR",
        category: CatalogCategory::RoutersAndFirewalls,
        os_profile_id: "vyos",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000],
        interface_naming: "eth0, eth1, …",
        estimated_download_mb: 520,
        delivery_kind: CatalogDeliveryKind::GuidedInstaller,
        template_stem: "vyos-x86_64-base",
        installer_match_prefixes: &["vyos-"],
        default_credentials: "vyos / vyos",
        official_url: "https://vyos.io/",
        upstream_source_label: "github.com/vyos/vyos-nightly-build (latest rolling live/install ISO)",
        quirks_and_tips: &[
            "Download the official VyOS Live/Install ISO, click 'Launch Guided Template Setup', log in as `vyos` / `vyos`, and run `install image` followed by `poweroff` to persist your Golden Image.",
            "Features transactional configuration (`configure`, `set interfaces ethernet eth0 address 10.0.0.1/24`, `commit`, `save`, `compare`).",
            "Includes full BGP, OSPFv2/v3, IS-IS, BFD, VRRP, DMVPN, and WireGuard out of the box.",
        ],
    },
    // 9. 9front (Plan 9)
    StaticCatalogSpec {
        id: "9front",
        name: "9front (Plan 9 from Bell Labs)",
        tagline: "Native ARM64 HVF research OS where the network stack is a synthetic `/net` filesystem!",
        category: CatalogCategory::ResearchUnixAndRetro,
        os_profile_id: "9front",
        supported_nic_models: &[NicModel::VirtioNetPci, NicModel::E1000],
        interface_naming: "/net/ether0, /net/ether1",
        estimated_download_mb: 390,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "9front-aarch64-base",
        installer_match_prefixes: &["9front-"],
        default_credentials: "glenda (auto-boots into Plan 9 `rio` graphical / `rc` shell)",
        official_url: "https://9front.org/",
        upstream_source_label: "9front.org (ARM64 UEFI qcow2.gz)",
        quirks_and_tips: &[
            "Runs at native Apple Silicon speed (`-accel hvf`) with `ramfb` UEFI graphics in Etherloom's Embedded VNC tab!",
            "No `socket()` syscalls needed: open TCP connections by interacting with `/net/tcp/clone` or `aux/listen1`, and configure IPs via `ip/ipconfig ether /net/ether0 10.0.0.2 255.255.255.0`.",
            "Bind a second interface stack onto `/net.alt` to build multi-homed Plan 9 routers and 9P file servers.",
        ],
    },
    // 10. OPNsense
    StaticCatalogSpec {
        id: "opnsense",
        name: "OPNsense (`nano` Serial Appliance)",
        tagline: "Pre-installed x86_64 FreeBSD firewall appliance with serial console & WebGUI",
        category: CatalogCategory::RoutersAndFirewalls,
        os_profile_id: "opnsense",
        supported_nic_models: &[NicModel::E1000, NicModel::VirtioNetPci],
        interface_naming: "em0 (LAN/WAN), em1, …",
        estimated_download_mb: 560,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "opnsense-x86_64-base",
        installer_match_prefixes: &["opnsense-", "OPNsense-"],
        default_credentials: "root / opnsense",
        official_url: "https://opnsense.org/",
        upstream_source_label: "pkg.opnsense.org (OPNsense nano-amd64 pre-installed serial image)",
        quirks_and_tips: &[
            "Uses OPNsense's official `nano` embedded appliance image — pre-installed and pre-configured for serial console (`xterm.js`) with zero installer required!",
            "Defaults to `x86_64` (`-M q35`), `SeaBIOS`, `AHCI SATA`, and Intel `e1000` (`em0`, `em1`) for rock-solid driver compatibility.",
            "On Apple Silicon Macs, runs via multi-threaded TCG JIT (`-accel tcg,thread=multi`); allow ~60–90s for initial PHP/pfctl appliance boot.",
        ],
    },
    // 11. pfSense CE
    StaticCatalogSpec {
        id: "pfsense",
        name: "pfSense Community Edition",
        tagline: "Classic enterprise FreeBSD x86_64 stateful firewall, HAProxy & VPN gateway",
        category: CatalogCategory::RoutersAndFirewalls,
        os_profile_id: "pfsense",
        supported_nic_models: &[NicModel::E1000, NicModel::VirtioNetPci],
        interface_naming: "em0 (WAN), em1 (LAN), …",
        estimated_download_mb: 780,
        delivery_kind: CatalogDeliveryKind::ManualImport,
        template_stem: "pfsense-x86_64-base",
        installer_match_prefixes: &["pfsense-", "pfSense-", "netgate-"],
        default_credentials: "admin / pfsense",
        official_url: "https://www.pfsense.org/download/",
        upstream_source_label: "Netgate Portal (free account checkout) -> Import Local File",
        quirks_and_tips: &[
            "Netgate transitioned pfSense CE downloads behind the free Netgate Store portal (`shop.netgate.com`) rather than unauthenticated public HTTP mirrors.",
            "Download the `amd64 ISO` or `memstick serial .img.gz` from Netgate, click 'Import Local File', and launch 1-click Guided Template Setup!",
            "Defaults to Intel `e1000` (`em0` WAN, `em1` LAN) and `AHCI` disk bus.",
        ],
    },
    // 12. OmniOS (Illumos / OpenSolaris)
    StaticCatalogSpec {
        id: "omnios",
        name: "OmniOS LTS (Illumos / OpenSolaris)",
        tagline: "Solaris-heritage x86_64 UNIX with Crossbow VNICs (`dladm`/`ipadm`), ZFS & DTrace",
        category: CatalogCategory::ResearchUnixAndRetro,
        os_profile_id: "omnios",
        supported_nic_models: &[NicModel::E1000, NicModel::VirtioNetPci],
        interface_naming: "e1000g0, e1000g1, …",
        estimated_download_mb: 420,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "omnios-x86_64-base",
        installer_match_prefixes: &["omnios-"],
        default_credentials: "root (empty password on console)",
        official_url: "https://omnios.org/",
        upstream_source_label: "mirror.omnios.org (OmniOS LTS cloud qcow2.xz)",
        quirks_and_tips: &[
            "Brings Solaris Crossbow network virtualization to your Mac: create virtual switches (`etherstub`) and bandwidth-capped VNICs via `dladm create-vnic` and `ipadm create-addr`!",
            "Trace kernel TCP state transitions live in real time using `dtrace -n 'tcp:::state-change { ... }'`.",
            "Uses Intel PRO/1000 (`e1000` -> `e1000g0`, `e1000g1`) and AHCI SATA on `-M q35`.",
        ],
    },
    // 13. DragonFly BSD
    StaticCatalogSpec {
        id: "dragonflybsd",
        name: "DragonFly BSD",
        tagline: "x86_64 BSD pioneer featuring lockless per-CPU LWKT network routing & HAMMER2",
        category: CatalogCategory::BsdFamily,
        os_profile_id: "dragonflybsd",
        supported_nic_models: &[NicModel::E1000, NicModel::Rtl8139],
        interface_naming: "em0, em1, …",
        estimated_download_mb: 390,
        delivery_kind: CatalogDeliveryKind::GuidedInstaller,
        template_stem: "dragonflybsd-x86_64-base",
        installer_match_prefixes: &["dfly-", "dragonfly"],
        default_credentials: "installer (or `root` with empty password on live console)",
        official_url: "https://www.dragonflybsd.org/",
        upstream_source_label: "mirror-master.dragonflybsd.org (dfly-x86_64 REL iso.bz2)",
        quirks_and_tips: &[
            "DragonFly BSD pins network protocol threads (TCP/UDP) per CPU core using Light Weight Kernel Threads (LWKT) for lockless packet forwarding.",
            "Defaults to `e1000` (`em0`, `em1`) and `AHCI` (`da0`) because DragonFly targets `x86_64` PC hardware.",
            "Log in as `installer` during Guided Template Setup to write DragonFly onto the blank template disk, or `root` to experiment live.",
        ],
    },
    // 14. Haiku OS
    StaticCatalogSpec {
        id: "haiku",
        name: "Haiku OS (R1/beta5)",
        tagline: "Lightning-responsive BeOS-inspired desktop OS with clean POSIX networking",
        category: CatalogCategory::ResearchUnixAndRetro,
        os_profile_id: "haiku",
        supported_nic_models: &[NicModel::E1000, NicModel::Rtl8139, NicModel::Pcnet],
        interface_naming: "/dev/net/ipro1000/0, …",
        estimated_download_mb: 830,
        delivery_kind: CatalogDeliveryKind::ReadyToBoot,
        template_stem: "haiku-x86_64-base",
        installer_match_prefixes: &["haiku-"],
        default_credentials: "Auto-logs into Haiku graphical desktop (`user`)",
        official_url: "https://www.haiku-os.org/",
        upstream_source_label: "cdn.haiku-os.org (Haiku R1/beta5 x86_64 anyboot image)",
        quirks_and_tips: &[
            "Haiku's `anyboot` image converts directly into a bootable `qcow2` Golden Template — open the Embedded VNC tab to use the full yellow-tabbed BeOS desktop!",
            "Intel `e1000` NICs enumerate under `/dev/net/ipro1000/0`; configure via `ifconfig /dev/net/ipro1000/0 10.0.1.50 netmask 255.255.255.0 up` or the GUI Network Preferences.",
            "Great visual desktop client endpoint (`WebPositive` browser, `Terminal`, `ping`, `nc`) inside multi-router topologies.",
        ],
    },
    // 15. FreeDOS + mTCP
    StaticCatalogSpec {
        id: "freedos",
        name: "FreeDOS 1.3 + mTCP",
        tagline: "32 MB RAM i386 retro DOS lab host — zero background ARP/IPv6/mDNS noise on Wireshark!",
        category: CatalogCategory::ResearchUnixAndRetro,
        os_profile_id: "freedos",
        supported_nic_models: &[NicModel::Pcnet, NicModel::Ne2kPci, NicModel::Rtl8139],
        interface_naming: "PCNTPK 0x60 (pcnet) • NE2000 0x60",
        estimated_download_mb: 405,
        delivery_kind: CatalogDeliveryKind::GuidedInstaller,
        template_stem: "freedos-i386-base",
        installer_match_prefixes: &["freedos-", "FD13"],
        default_credentials: "Direct `C:\\>` DOS prompt (no login)",
        official_url: "https://www.freedos.org/",
        upstream_source_label: "ibiblio.org (Official FreeDOS 1.3 LiveCD + Crynwr/mTCP packages)",
        quirks_and_tips: &[
            "Because DOS is single-tasking, **zero packets** traverse the wire until you run a command — making Wireshark & `tcpflowy` captures 100% pure!",
            "Runs on `qemu-system-i386 -M pc -cpu pentium3` with just `32 MB` RAM, Legacy `IDE` disk, and AMD `pcnet` (`PCNTPK INT=0x60`).",
            "Boot the LiveCD (`Live Environment` or install to `C:` + `fdnpkg install mtcp pcntpk`), set `SET MTCPCFG=C:\\MTCP.CFG`, and watch every individual ARP & TCP segment.",
        ],
    },
];

struct CatalogManagerInner {
    active_cancellers: RwLock<HashMap<String, watch::Sender<bool>>>,
    app_handle: RwLock<Option<AppHandle>>,
}

/// Manages the 15-OS Curated Catalog, streaming downloads, `.staging/` extraction, `qemu-img` conversion,
/// local file imports, safe image deletion, and 1-click Guided Template Setup.
#[derive(Clone)]
pub struct CatalogManager {
    inner: Arc<CatalogManagerInner>,
}

impl Default for CatalogManager {
    fn default() -> Self {
        Self::new()
    }
}

impl CatalogManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(CatalogManagerInner {
                active_cancellers: RwLock::new(HashMap::new()),
                app_handle: RwLock::new(None),
            }),
        }
    }

    pub async fn bind_app_handle(&self, handle: AppHandle) {
        let mut guard = self.inner.app_handle.write().await;
        *guard = Some(handle);
    }

    /// Lists all 15 curated OS entries enriched with live availability & on-disk byte sizes from active storage.
    pub async fn list_catalog(
        &self,
        image_store: &ImageStore,
        host_arch: &str,
        hvf_supported: bool,
    ) -> Result<Vec<OsCatalogEntryDto>, String> {
        let templates = image_store.list_templates().await.unwrap_or_default();
        let isos = image_store.list_isos().await.unwrap_or_default();
        let active_downloads: HashMap<String, bool> = {
            let guard = self.inner.active_cancellers.read().await;
            guard.keys().map(|k| (k.clone(), true)).collect()
        };

        let mut out = Vec::with_capacity(STATIC_CATALOG.len());
        for spec in STATIC_CATALOG {
            out.push(build_entry_dto(
                spec,
                &templates,
                &isos,
                active_downloads.contains_key(spec.id),
                host_arch,
                hvf_supported,
            ));
        }
        Ok(out)
    }

    /// Cancels an active download/extraction job for `catalog_id` and cleans up its `.staging/` workspace.
    pub async fn cancel_download(&self, catalog_id: &str) -> Result<bool, String> {
        let tx_opt = {
            let mut guard = self.inner.active_cancellers.write().await;
            guard.remove(catalog_id)
        };
        if let Some(tx) = tx_opt {
            let _ = tx.send(true);
            self.emit_progress(CatalogDownloadProgressEvent {
                catalog_id: catalog_id.to_string(),
                stage: "Cancelled".to_string(),
                bytes_downloaded: 0,
                total_bytes: None,
                percent: None,
                message: "Download cancelled by user.".to_string(),
                error: None,
            })
            .await;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Starts an asynchronous background download, verification, extraction, and `qcow2` conversion
    /// strictly inside `{active_storage_root}/.staging/`.
    pub async fn start_download(
        &self,
        req: CatalogDownloadRequest,
        storage: StorageManager,
        image_store: ImageStore,
    ) -> Result<(), String> {
        let spec = find_static_spec(&req.catalog_id)
            .ok_or_else(|| format!("Unknown OS catalog id '{}'", req.catalog_id))?;

        // Enforce Phase 1b unmounted external SSD safety guard BEFORE creating staging folders!
        let ready_paths = storage.require_ready_paths().await?;

        {
            let guard = self.inner.active_cancellers.read().await;
            if guard.contains_key(spec.id) {
                return Err(format!("'{}' is already downloading.", spec.name));
            }
        }

        if req.custom_url.as_deref().map(str::trim).unwrap_or("").is_empty()
            && spec.delivery_kind == CatalogDeliveryKind::ManualImport
        {
            return Err(format!(
                "{} requires downloading the image from {} (or supplying a Custom Mirror URL), then clicking 'Import Local File'.",
                spec.name, spec.official_url
            ));
        }

        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut guard = self.inner.active_cancellers.write().await;
            guard.insert(spec.id.to_string(), cancel_tx);
        }

        let mgr = self.clone();
        let custom_url = req
            .custom_url
            .map(|u| u.trim().to_string())
            .filter(|u| !u.is_empty());

        tokio::spawn(async move {
            let staging_dir = ready_paths
                .storage_root
                .join(".staging")
                .join(format!("{}-{}", spec.id, &Uuid::new_v4().simple().to_string()[..8]));

            let result = mgr
                .execute_download_pipeline(
                    spec,
                    custom_url,
                    &staging_dir,
                    &ready_paths.templates_dir,
                    &ready_paths.isos_dir,
                    &image_store,
                    cancel_rx,
                )
                .await;

            // Always remove temporary staging directory on completion, error, or cancellation
            let _ = fs::remove_dir_all(&staging_dir);

            {
                let mut guard = mgr.inner.active_cancellers.write().await;
                guard.remove(spec.id);
            }

            if let Err(err_msg) = result {
                if err_msg != "__CANCELLED__" {
                    mgr.emit_progress(CatalogDownloadProgressEvent {
                        catalog_id: spec.id.to_string(),
                        stage: "Error".to_string(),
                        bytes_downloaded: 0,
                        total_bytes: None,
                        percent: None,
                        message: err_msg.clone(),
                        error: Some(err_msg),
                    })
                    .await;
                }
            }
        });

        Ok(())
    }

    /// Imports a local disk/archive/ISO file selected by the user into `templates/` or `isos/`,
    /// performing archive decompression and `qemu-img convert -O qcow2` inside `{storage_root}/.staging/`.
    pub async fn import_local_file(
        &self,
        req: CatalogImportLocalRequest,
        storage: &StorageManager,
        image_store: &ImageStore,
    ) -> Result<OsCatalogEntryDto, String> {
        let spec = find_static_spec(&req.catalog_id)
            .ok_or_else(|| format!("Unknown OS catalog id '{}'", req.catalog_id))?;

        let source = PathBuf::from(req.source_path.trim());
        if !source.is_file() {
            return Err(format!("Selected file does not exist: {}", source.display()));
        }

        let ready_paths = storage.require_ready_paths().await?;
        let staging_dir = ready_paths
            .storage_root
            .join(".staging")
            .join(format!("import-{}-{}", spec.id, &Uuid::new_v4().simple().to_string()[..8]));
        fs::create_dir_all(&staging_dir)
            .map_err(|e| format!("Failed creating staging directory {}: {e}", staging_dir.display()))?;

        let (_tx, cancel_rx) = watch::channel(false);

        let res = self
            .ingest_downloaded_or_local_artifact(
                spec,
                &source,
                true,
                &staging_dir,
                &ready_paths.templates_dir,
                &ready_paths.isos_dir,
                image_store,
                cancel_rx,
            )
            .await;

        let _ = fs::remove_dir_all(&staging_dir);
        res?;

        let list = self
            .list_catalog(
                image_store,
                std::env::consts::ARCH,
                std::env::consts::OS == "macos",
            )
            .await?;
        list.into_iter()
            .find(|e| e.id == spec.id)
            .ok_or_else(|| "Catalog entry disappeared after import".to_string())
    }

    /// Safely deletes a downloaded OS template (and/or its catalog installer ISO/IMG) to reclaim SSD space.
    /// If `force` is false and saved projects in `workspaces_dir` reference this template, returns
    /// `deleted: false` with `referencing_projects` populated so the UI can ask for confirmation.
    pub async fn delete_image(
        &self,
        catalog_id: &str,
        force: bool,
        image_store: &ImageStore,
        vm_manager: &VmManager,
    ) -> Result<DeleteCatalogImageResult, String> {
        let spec = find_static_spec(catalog_id)
            .ok_or_else(|| format!("Unknown OS catalog id '{catalog_id}'"))?;

        // Refuse deletion if an active VM is currently booted from this template
        let active_vms = vm_manager.list_vms().await;
        for vm in active_vms {
            if matches!(
                vm.status,
                crate::vm_manager::VmStatus::Starting
                    | crate::vm_manager::VmStatus::Running
                    | crate::vm_manager::VmStatus::Stopping
            ) && (vm.disk_path.contains(spec.template_stem)
                || vm.node_id == format!("setup-{}", spec.id))
            {
                return Err(format!(
                    "Stop running VM '{}' before deleting {}.",
                    vm.name, spec.name
                ));
            }
        }

        let referencing_projects = image_store
            .find_referencing_projects(spec.template_stem)
            .await;
        if !referencing_projects.is_empty() && !force {
            return Ok(DeleteCatalogImageResult {
                catalog_id: spec.id.to_string(),
                deleted: false,
                referencing_projects,
                removed_paths: Vec::new(),
            });
        }

        let templates = image_store.list_templates().await.unwrap_or_default();
        let isos = image_store.list_isos().await.unwrap_or_default();
        let mut removed_paths = Vec::new();

        for tpl in templates {
            if tpl.id == spec.template_stem || tpl.os_profile_id == spec.os_profile_id {
                let p = PathBuf::from(&tpl.path);
                if p.is_file() {
                    // Unlock 0444 read-only permissions before unlinking on macOS APFS
                    if let Ok(meta) = fs::metadata(&p) {
                        let mut perms = meta.permissions();
                        perms.set_mode(0o644);
                        let _ = fs::set_permissions(&p, perms);
                    }
                    fs::remove_file(&p)
                        .map_err(|e| format!("Failed removing {}: {e}", p.display()))?;
                    removed_paths.push(p.display().to_string());
                }
                if let Some(parent) = p.parent() {
                    let sidecar = parent.join(format!("{}.template.json", tpl.id));
                    if sidecar.is_file() {
                        let _ = fs::remove_file(&sidecar);
                    }
                }
            }
        }

        for iso in isos {
            if matches_installer_prefix(&iso.filename, spec.installer_match_prefixes) {
                let p = PathBuf::from(&iso.path);
                if p.is_file() {
                    let _ = fs::remove_file(&p);
                    removed_paths.push(p.display().to_string());
                }
            }
        }

        Ok(DeleteCatalogImageResult {
            catalog_id: spec.id.to_string(),
            deleted: true,
            referencing_projects,
            removed_paths,
        })
    }

    /// Launches a 1-click Guided Template Setup VM for installer-based OSes (OpenBSD, VyOS, pfSense,
    /// DragonFly BSD, FreeDOS): creates `{templates_dir}/{template_stem}.qcow2`, attaches the downloaded
    /// `.img`/`.iso` at `bootindex=1`, boots QEMU with Serial + Embedded VNC ready, and registers
    /// `FinalizeTemplateOnExit` so clean `halt -p` / `poweroff` promotes it to a Read-Only Golden Image!
    pub async fn launch_guided_setup(
        &self,
        catalog_id: &str,
        storage: &StorageManager,
        image_store: &ImageStore,
        fabric: &crate::fabric::PacketFabric,
        vm_manager: &VmManager,
    ) -> Result<VmInstanceInfo, String> {
        let spec = find_static_spec(catalog_id)
            .ok_or_else(|| format!("Unknown OS catalog id '{catalog_id}'"))?;
        let prof = find_os_profile(spec.os_profile_id)
            .ok_or_else(|| format!("Missing OS profile '{}'", spec.os_profile_id))?;

        let ready_paths = storage.require_ready_paths().await?;
        let isos = image_store.list_isos().await.unwrap_or_default();
        let installer = isos
            .iter()
            .find(|i| matches_installer_prefix(&i.filename, spec.installer_match_prefixes))
            .ok_or_else(|| {
                format!(
                    "No installer media found in {} for {}. Click 'Download Installer' or 'Import Local File' first.",
                    ready_paths.isos_dir.display(),
                    spec.name
                )
            })?;

        let target_qcow2 = ready_paths
            .templates_dir
            .join(format!("{}.qcow2", spec.template_stem));

        // If an older read-only template exists and the user re-launched Guided Setup, unlock & recreate fresh
        if target_qcow2.exists() {
            if let Ok(meta) = fs::metadata(&target_qcow2) {
                let mut perms = meta.permissions();
                perms.set_mode(0o644);
                let _ = fs::set_permissions(&target_qcow2, perms);
            }
            let _ = fs::remove_file(&target_qcow2);
        }

        let create_args = vec![
            "create".to_string(),
            "-f".to_string(),
            "qcow2".to_string(),
            target_qcow2.display().to_string(),
            format!("{}G", prof.recommended_disk_gb.max(1)),
        ];
        image_store.run_qemu_img(&create_args).await?;

        let setup_node_id = format!("setup-{}", spec.id);
        let req = SpawnVmRequest {
            node_id: setup_node_id,
            name: format!("{} Setup", spec.name),
            cpus: prof.default_cpus.max(1),
            ram_mb: prof.default_ram_mb.max(32),
            disk_path: target_qcow2.display().to_string(),
            template_id: None,
            boot_media_path: Some(installer.path.clone()),
            boot_media_bus: BootMediaBus::Auto,
            display_mode: VmDisplayMode::Vnc,
            vnc_port_offset: None,
            arch: prof.arch,
            nic_model: prof.default_nic_model,
            firmware: prof.default_firmware,
            disk_bus: prof.default_disk_bus,
            nics: vec![VmNicConfig {
                port_id: None,
                mac: "52:54:00:99:00:01".to_string(),
                nic_model: Some(prof.default_nic_model),
                fabric_port: None,
                vm_port: None,
            }],
            bios_path_override: None,
            finalize_template_on_exit: Some(FinalizeTemplateOnExit {
                catalog_id: spec.id.to_string(),
                template_id: spec.template_stem.to_string(),
                template_name: spec.name.to_string(),
                os_profile_id: spec.os_profile_id.to_string(),
                arch: prof.arch,
                default_nic_model: prof.default_nic_model,
                default_firmware: prof.default_firmware,
                default_disk_bus: prof.default_disk_bus,
                description: Some(format!(
                    "{} Golden Base Template installed via Etherloom Guided Setup",
                    spec.name
                )),
            }),
        };

        vm_manager.spawn_vm(req, fabric, image_store).await
    }

    async fn execute_download_pipeline(
        &self,
        spec: &'static StaticCatalogSpec,
        custom_url: Option<String>,
        staging_dir: &Path,
        templates_dir: &Path,
        isos_dir: &Path,
        image_store: &ImageStore,
        mut cancel_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        fs::create_dir_all(staging_dir)
            .map_err(|e| format!("Failed creating staging dir {}: {e}", staging_dir.display()))?;

        self.emit_progress(CatalogDownloadProgressEvent {
            catalog_id: spec.id.to_string(),
            stage: "Resolving".to_string(),
            bytes_downloaded: 0,
            total_bytes: None,
            percent: Some(2.0),
            message: format!("Resolving upstream mirror for {}…", spec.name),
            error: None,
        })
        .await;

        let resolved = match custom_url {
            Some(url) => ResolvedUpstreamAsset {
                url: url.clone(),
                filename: filename_from_url(&url, spec.id),
                sha256_manifest_url: None,
            },
            None => resolve_upstream_asset(spec.id).await?,
        };

        if *cancel_rx.borrow() {
            return Err("__CANCELLED__".to_string());
        }

        let total_bytes = probe_content_length(&resolved.url).await;
        let dest_archive = staging_dir.join(&resolved.filename);

        self.stream_curl_with_progress(
            spec.id,
            &resolved.url,
            &dest_archive,
            total_bytes,
            &mut cancel_rx,
        )
        .await?;

        // Optional SHA-256 verification when upstream provides a `SHA256` manifest (e.g. OpenBSD!)
        if let Some(ref sha_url) = resolved.sha256_manifest_url {
            self.emit_progress(CatalogDownloadProgressEvent {
                catalog_id: spec.id.to_string(),
                stage: "Verifying".to_string(),
                bytes_downloaded: fs::metadata(&dest_archive).map(|m| m.len()).unwrap_or(0),
                total_bytes,
                percent: Some(82.0),
                message: format!("Verifying official SHA-256 checksum for {}…", resolved.filename),
                error: None,
            })
            .await;

            let sha_file = staging_dir.join("SHA256");
            if fetch_small_file(sha_url, &sha_file).await.is_ok() {
                verify_sha256_from_manifest(&dest_archive, &resolved.filename, &sha_file).await?;
            }
        }

        self.ingest_downloaded_or_local_artifact(
            spec,
            &dest_archive,
            false,
            staging_dir,
            templates_dir,
            isos_dir,
            image_store,
            cancel_rx,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn ingest_downloaded_or_local_artifact(
        &self,
        spec: &'static StaticCatalogSpec,
        input_path: &Path,
        preserve_input: bool,
        staging_dir: &Path,
        templates_dir: &Path,
        isos_dir: &Path,
        image_store: &ImageStore,
        mut cancel_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        if *cancel_rx.borrow() {
            return Err("__CANCELLED__".to_string());
        }

        // Copy into staging if preserving user's local file so gunzip/bunzip2/xz never mutate user's source!
        let working_file = if preserve_input {
            let fname = input_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("imported.img");
            let staged = staging_dir.join(fname);
            self.emit_progress(CatalogDownloadProgressEvent {
                catalog_id: spec.id.to_string(),
                stage: "Downloading".to_string(),
                bytes_downloaded: 0,
                total_bytes: None,
                percent: Some(25.0),
                message: format!("Staging {} into library workspace…", fname),
                error: None,
            })
            .await;
            fs::copy(input_path, &staged)
                .map_err(|e| format!("Failed copying {} into staging: {e}", input_path.display()))?;
            staged
        } else {
            input_path.to_path_buf()
        };

        // 1. Decompress `.xz`, `.gz`, `.bz2`, or `.zip` if compressed
        let extracted = self
            .extract_if_compressed(spec.id, &working_file, staging_dir, &mut cancel_rx)
            .await?;

        if *cancel_rx.borrow() {
            return Err("__CANCELLED__".to_string());
        }

        let ext = extracted
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        // Determine whether this artifact is an installer media (`.iso` or OpenBSD `installXX.img`)
        // vs. a bootable disk image to convert into `{templates_dir}/{template_stem}.qcow2`.
        // Note: Haiku's `anyboot.iso` is a hybrid disk image that converts directly into a bootable qcow2!
        let is_haiku_anyboot = spec.id == "haiku"
            && extracted
                .file_name()
                .and_then(|s| s.to_str())
                .map(|n| n.contains("anyboot"))
                .unwrap_or(false);

        let treat_as_installer = !is_haiku_anyboot
            && (ext == "iso"
                || (spec.delivery_kind == CatalogDeliveryKind::GuidedInstaller
                    && (ext == "img" || ext == "iso")));

        if treat_as_installer {
            fs::create_dir_all(isos_dir)
                .map_err(|e| format!("Failed creating {}: {e}", isos_dir.display()))?;
            let orig_name = extracted
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("installer.iso");
            // Prefix installer filename with catalog id if needed so prefix matching is 100% deterministic
            let dest_name = if matches_installer_prefix(orig_name, spec.installer_match_prefixes) {
                orig_name.to_string()
            } else {
                format!("{}-{orig_name}", spec.id)
            };
            let dest_iso = isos_dir.join(&dest_name);
            move_or_copy_file(&extracted, &dest_iso)?;
            let sz = fs::metadata(&dest_iso).map(|m| m.len()).unwrap_or(0);

            self.emit_progress(CatalogDownloadProgressEvent {
                catalog_id: spec.id.to_string(),
                stage: "InstallerReady".to_string(),
                bytes_downloaded: sz,
                total_bytes: Some(sz),
                percent: Some(100.0),
                message: format!(
                    "Installer {} saved to isos/. Click 'Launch Guided Template Setup' to install!",
                    dest_name
                ),
                error: None,
            })
            .await;
            return Ok(());
        }

        // 2. Convert disk image (`.qcow2`, `.img`, `.raw`, `.vmdk`, `.vdi`, or Haiku `anyboot`) into `qcow2`
        self.emit_progress(CatalogDownloadProgressEvent {
            catalog_id: spec.id.to_string(),
            stage: "Converting qcow2".to_string(),
            bytes_downloaded: 0,
            total_bytes: None,
            percent: Some(90.0),
            message: format!("Preparing {} Golden Base Template qcow2…", spec.name),
            error: None,
        })
        .await;

        fs::create_dir_all(templates_dir)
            .map_err(|e| format!("Failed creating {}: {e}", templates_dir.display()))?;
        let staged_qcow2 = staging_dir.join(format!("{}.qcow2", spec.template_stem));

        let prof = find_os_profile(spec.os_profile_id);
        if image_store.resolve_qemu_img_bin().is_some() {
            let convert_args = vec![
                "convert".to_string(),
                "-O".to_string(),
                "qcow2".to_string(),
                extracted.display().to_string(),
                staged_qcow2.display().to_string(),
            ];
            image_store.run_qemu_img(&convert_args).await?;

            // Expand virtual size to recommended_disk_gb if the upstream image is smaller
            if let Some(ref p) = prof {
                if let Ok(info) = image_store.inspect_disk(&staged_qcow2).await {
                    let target_bytes = (p.recommended_disk_gb as u64) * 1024 * 1024 * 1024;
                    if info.virtual_size_bytes > 0 && info.virtual_size_bytes < target_bytes {
                        let resize_args = vec![
                            "resize".to_string(),
                            staged_qcow2.display().to_string(),
                            format!("{}G", p.recommended_disk_gb),
                        ];
                        let _ = image_store.run_qemu_img(&resize_args).await;
                    }
                }
            }
        } else if ext == "qcow2" {
            // Upstream artifact is already a valid qcow2 image (e.g. Alpine, Debian, FreeBSD, 9front, OmniOS):
            // finalize it directly so users can prepare qcow2 OS templates even before running `brew install qemu`.
            move_or_copy_file(&extracted, &staged_qcow2)?;
        } else {
            return Err(format!(
                "QEMU ('qemu-img') is required to convert .{ext} disk images into qcow2 templates, but QEMU is not installed on this Mac yet. Run 'brew install qemu' in Terminal and click Retry."
            ));
        }

        let final_qcow2 = templates_dir.join(format!("{}.qcow2", spec.template_stem));
        if final_qcow2.exists() {
            if let Ok(meta) = fs::metadata(&final_qcow2) {
                let mut perms = meta.permissions();
                perms.set_mode(0o644);
                let _ = fs::set_permissions(&final_qcow2, perms);
            }
            let _ = fs::remove_file(&final_qcow2);
        }
        move_or_copy_file(&staged_qcow2, &final_qcow2)?;

        let fin = FinalizeTemplateOnExit {
            catalog_id: spec.id.to_string(),
            template_id: spec.template_stem.to_string(),
            template_name: spec.name.to_string(),
            os_profile_id: spec.os_profile_id.to_string(),
            arch: prof.as_ref().map(|p| p.arch).unwrap_or_default(),
            default_nic_model: prof
                .as_ref()
                .map(|p| p.default_nic_model)
                .unwrap_or_default(),
            default_firmware: prof
                .as_ref()
                .map(|p| p.default_firmware)
                .unwrap_or_default(),
            default_disk_bus: prof
                .as_ref()
                .map(|p| p.default_disk_bus)
                .unwrap_or_default(),
            description: Some(format!("{} — {}", spec.name, spec.tagline)),
        };

        let tpl = image_store
            .finalize_in_place_template(&final_qcow2, &fin)
            .await?;

        self.emit_progress(CatalogDownloadProgressEvent {
            catalog_id: spec.id.to_string(),
            stage: "Ready".to_string(),
            bytes_downloaded: tpl.actual_size_bytes,
            total_bytes: Some(tpl.actual_size_bytes),
            percent: Some(100.0),
            message: format!("{} is Ready ({})", spec.name, tpl.filename),
            error: None,
        })
        .await;

        Ok(())
    }

    async fn stream_curl_with_progress(
        &self,
        catalog_id: &str,
        url: &str,
        dest: &Path,
        total_bytes: Option<u64>,
        cancel_rx: &mut watch::Receiver<bool>,
    ) -> Result<(), String> {
        let fname = dest
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("image");
        self.emit_progress(CatalogDownloadProgressEvent {
            catalog_id: catalog_id.to_string(),
            stage: "Downloading".to_string(),
            bytes_downloaded: 0,
            total_bytes,
            percent: Some(3.0),
            message: format!("Connected — downloading {fname}…"),
            error: None,
        })
        .await;

        let curl_bin = resolve_macos_binary("curl").unwrap_or_else(|| PathBuf::from("/usr/bin/curl"));
        let mut child = Command::new(&curl_bin)
            .args([
                "-fL",
                "--retry",
                "3",
                "--connect-timeout",
                "15",
                "-sS",
                "-o",
                &dest.display().to_string(),
                url,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed starting curl: {e}"))?;

        let stderr_pipe = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            if let Some(mut pipe) = stderr_pipe {
                use tokio::io::AsyncReadExt;
                let mut buf = String::new();
                let _ = pipe.read_to_string(&mut buf).await;
                buf
            } else {
                String::new()
            }
        });

        let mut ticker = tokio::time::interval(Duration::from_millis(220));
        loop {
            tokio::select! {
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        let _ = child.kill().await;
                        return Err("__CANCELLED__".to_string());
                    }
                }
                status_res = child.wait() => {
                    let status = status_res.map_err(|e| format!("curl wait failed: {e}"))?;
                    let stderr_text = stderr_task.await.unwrap_or_default();
                    if !status.success() {
                        let detail = stderr_text.trim();
                        return Err(if detail.is_empty() {
                            format!("Download failed from {url} ({status}). You can supply a Custom Mirror URL or Import a Local File.")
                        } else {
                            format!("Download failed from {url}: {detail}")
                        });
                    }
                    let final_len = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
                    self.emit_progress(CatalogDownloadProgressEvent {
                        catalog_id: catalog_id.to_string(),
                        stage: "Downloading".to_string(),
                        bytes_downloaded: final_len,
                        total_bytes: total_bytes.or(Some(final_len)),
                        percent: Some(80.0),
                        message: "Download complete.".to_string(),
                        error: None,
                    }).await;
                    return Ok(());
                }
                _ = ticker.tick() => {
                    let cur_len = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
                    let pct = total_bytes
                        .filter(|&t| t > 0)
                        .map(|t| ((cur_len as f64 / t as f64) * 77.0 + 3.0).clamp(3.0, 80.0));
                    self.emit_progress(CatalogDownloadProgressEvent {
                        catalog_id: catalog_id.to_string(),
                        stage: "Downloading".to_string(),
                        bytes_downloaded: cur_len,
                        total_bytes,
                        percent: pct,
                        message: format!("Streaming {fname} onto active storage…"),
                        error: None,
                    }).await;
                }
            }
        }
    }

    async fn extract_if_compressed(
        &self,
        catalog_id: &str,
        file_path: &Path,
        staging_dir: &Path,
        cancel_rx: &mut watch::Receiver<bool>,
    ) -> Result<PathBuf, String> {
        let ext = file_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if !matches!(ext.as_str(), "xz" | "gz" | "bz2" | "zip") {
            return Ok(file_path.to_path_buf());
        }

        self.emit_progress(CatalogDownloadProgressEvent {
            catalog_id: catalog_id.to_string(),
            stage: "Extracting".to_string(),
            bytes_downloaded: 0,
            total_bytes: None,
            percent: Some(85.0),
            message: format!("Extracting .{ext} archive inside staging directory…"),
            error: None,
        })
        .await;

        match ext.as_str() {
            "xz" => {
                let xz_bin = resolve_macos_binary("xz").ok_or_else(|| {
                    "The `xz` utility was not found. Install it via `brew install xz` (included automatically with `brew install qemu`).".to_string()
                })?;
                run_cancellable_command(&xz_bin, &["-d", "-f", &file_path.display().to_string()], cancel_rx).await?;
                Ok(strip_last_extension(file_path))
            }
            "gz" => {
                let gunzip = resolve_macos_binary("gunzip")
                    .unwrap_or_else(|| PathBuf::from("/usr/bin/gunzip"));
                run_cancellable_command(
                    &gunzip,
                    &["-f", &file_path.display().to_string()],
                    cancel_rx,
                )
                .await?;
                Ok(strip_last_extension(file_path))
            }
            "bz2" => {
                let bunzip2 = resolve_macos_binary("bunzip2")
                    .unwrap_or_else(|| PathBuf::from("/usr/bin/bunzip2"));
                run_cancellable_command(
                    &bunzip2,
                    &["-f", &file_path.display().to_string()],
                    cancel_rx,
                )
                .await?;
                Ok(strip_last_extension(file_path))
            }
            "zip" => {
                let unzip_dir = staging_dir.join("unzipped");
                fs::create_dir_all(&unzip_dir).map_err(|e| e.to_string())?;
                let unzip_bin = resolve_macos_binary("unzip")
                    .unwrap_or_else(|| PathBuf::from("/usr/bin/unzip"));
                run_cancellable_command(
                    &unzip_bin,
                    &[
                        "-o",
                        "-q",
                        &file_path.display().to_string(),
                        "-d",
                        &unzip_dir.display().to_string(),
                    ],
                    cancel_rx,
                )
                .await?;
                find_largest_disk_in_dir(&unzip_dir).ok_or_else(|| {
                    "No bootable disk or ISO image (.qcow2, .img, .raw, .iso) found inside .zip archive".to_string()
                })
            }
            _ => Ok(file_path.to_path_buf()),
        }
    }

    async fn emit_progress(&self, payload: CatalogDownloadProgressEvent) {
        let handle_opt = self.inner.app_handle.read().await.clone();
        if let Some(app) = handle_opt {
            let _ = app.emit("catalog://download-progress", payload);
        }
    }
}

/// Opens a file or folder in macOS Finder (`open <dir>` or `open -R <file>`).
pub fn reveal_path_in_finder(raw_path: &str) -> Result<(), String> {
    let p = PathBuf::from(raw_path.trim());
    if !p.exists() {
        return Err(format!("Path does not exist: {}", p.display()));
    }
    let mut cmd = std::process::Command::new("/usr/bin/open");
    if p.is_file() {
        cmd.arg("-R").arg(&p);
    } else {
        cmd.arg(&p);
    }
    cmd.status()
        .map_err(|e| format!("Failed opening Finder for {}: {e}", p.display()))?;
    Ok(())
}

fn find_static_spec(id: &str) -> Option<&'static StaticCatalogSpec> {
    STATIC_CATALOG.iter().find(|s| s.id == id)
}

fn matches_installer_prefix(filename: &str, prefixes: &[&str]) -> bool {
    let lower = filename.to_ascii_lowercase();
    prefixes
        .iter()
        .any(|pref| lower.starts_with(&pref.to_ascii_lowercase()))
}

fn build_entry_dto(
    spec: &StaticCatalogSpec,
    templates: &[BaseTemplateInfo],
    isos: &[InstallerMediaInfo],
    is_downloading: bool,
    host_arch: &str,
    hvf_supported: bool,
) -> OsCatalogEntryDto {
    let prof = find_os_profile(spec.os_profile_id);
    let arch = prof.as_ref().map(|p| p.arch).unwrap_or(GuestArch::Aarch64);
    let accel = arch.effective_accel(host_arch, hvf_supported);
    let accel_hint = match (arch, accel) {
        (GuestArch::Aarch64, "hvf") => "ARM64 • HVF Native".to_string(),
        (GuestArch::X86_64, "hvf") => "x86_64 • HVF Native".to_string(),
        (GuestArch::Aarch64, _) => "ARM64 • TCG JIT".to_string(),
        (GuestArch::X86_64, _) => "x86_64 • TCG Multi-Thread".to_string(),
        (GuestArch::I386, _) => "i386 • TCG Fast Retro".to_string(),
        (GuestArch::Riscv64, _) => "RISC-V 64 • TCG".to_string(),
    };

    let matched_template = templates
        .iter()
        .find(|t| t.id == spec.template_stem)
        .or_else(|| {
            templates
                .iter()
                .find(|t| t.os_profile_id == spec.os_profile_id)
        });

    let matched_installer = isos
        .iter()
        .find(|i| matches_installer_prefix(&i.filename, spec.installer_match_prefixes));

    let availability = if is_downloading {
        CatalogAvailability::Downloading
    } else if matched_template.is_some() {
        CatalogAvailability::Ready
    } else if matched_installer.is_some() {
        CatalogAvailability::InstallerReady
    } else {
        CatalogAvailability::NotDownloaded
    };

    OsCatalogEntryDto {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        tagline: spec.tagline.to_string(),
        category: spec.category,
        os_profile_id: spec.os_profile_id.to_string(),
        guest_family: prof
            .as_ref()
            .map(|p| p.guest_family.clone())
            .unwrap_or_else(|| "linux".to_string()),
        arch,
        accel_hint,
        default_nic_model: prof
            .as_ref()
            .map(|p| p.default_nic_model)
            .unwrap_or_default(),
        supported_nic_models: spec.supported_nic_models.to_vec(),
        interface_naming: spec.interface_naming.to_string(),
        default_firmware: prof
            .as_ref()
            .map(|p| p.default_firmware)
            .unwrap_or_default(),
        default_disk_bus: prof
            .as_ref()
            .map(|p| p.default_disk_bus)
            .unwrap_or_default(),
        default_vcpus: prof.as_ref().map(|p| p.default_cpus).unwrap_or(2),
        default_ram_mb: prof.as_ref().map(|p| p.default_ram_mb).unwrap_or(512),
        recommended_disk_gb: prof.as_ref().map(|p| p.recommended_disk_gb).unwrap_or(8),
        estimated_download_mb: spec.estimated_download_mb,
        delivery_kind: spec.delivery_kind,
        template_stem: spec.template_stem.to_string(),
        default_credentials: spec.default_credentials.to_string(),
        official_url: spec.official_url.to_string(),
        upstream_source_label: spec.upstream_source_label.to_string(),
        quirks_and_tips: spec.quirks_and_tips.iter().map(|s| s.to_string()).collect(),
        availability,
        installed_template_id: matched_template.map(|t| t.id.clone()),
        installed_template_path: matched_template.map(|t| t.path.clone()),
        installed_size_bytes: matched_template.map(|t| t.actual_size_bytes),
        installer_media_path: matched_installer.map(|i| i.path.clone()),
        installer_media_size_bytes: matched_installer.map(|i| i.size_bytes),
    }
}

struct ResolvedUpstreamAsset {
    url: String,
    filename: String,
    sha256_manifest_url: Option<String>,
}

async fn resolve_upstream_asset(catalog_id: &str) -> Result<ResolvedUpstreamAsset, String> {
    match catalog_id {
        "alpine-linux" => {
            let mut last_http_err: Option<String> = None;
            for branch in ["latest-stable", "v3.23", "v3.22", "v3.21", "v3.20"] {
                let dir_url =
                    format!("https://dl-cdn.alpinelinux.org/alpine/{branch}/releases/cloud/");
                match curl_text(&dir_url).await {
                    Ok(html) => {
                        if let Some(fname) = select_alpine_cloud_filename(&html) {
                            return Ok(ResolvedUpstreamAsset {
                                url: format!("{dir_url}{fname}"),
                                filename: fname,
                                sha256_manifest_url: None,
                            });
                        }
                    }
                    Err(e) => {
                        last_http_err = Some(e);
                    }
                }
            }
            let suffix = last_http_err
                .map(|e| format!(" ({e})"))
                .unwrap_or_default();
            Err(format!(
                "Unable to resolve Alpine ARM64 UEFI cloud image (.qcow2.xz / .qcow2) from dl-cdn.alpinelinux.org{suffix}. Check your internet connection or provide a Custom Mirror URL."
            ))
        }
        "debian-linux" => Ok(ResolvedUpstreamAsset {
            url: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-nocloud-arm64.qcow2"
                .to_string(),
            filename: "debian-12-nocloud-arm64.qcow2".to_string(),
            sha256_manifest_url: None,
        }),
        "freebsd" => {
            let vm_root = "https://download.freebsd.org/releases/VM-IMAGES";
            let mut candidates: Vec<String> = Vec::new();
            if let Ok(root_html) = curl_text(&format!("{vm_root}/")).await {
                for tok in root_html.split(|c: char| {
                    c == '"' || c == '\'' || c == '>' || c == '<' || c == '/' || c.is_whitespace()
                }) {
                    if tok.ends_with("-RELEASE")
                        && tok.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                        && !candidates.iter().any(|existing| existing == tok)
                    {
                        candidates.push(tok.to_string());
                    }
                }
                candidates.sort_by(|a, b| compare_version_desc(a, b));
            }
            for fallback in ["15.0-RELEASE", "14.3-RELEASE", "14.2-RELEASE", "14.1-RELEASE"] {
                if !candidates.iter().any(|c| c == fallback) {
                    candidates.push(fallback.to_string());
                }
            }

            for ver in candidates {
                let latest_dir = format!("{vm_root}/{ver}/aarch64/Latest/");
                if let Ok(dir_html) = curl_text(&latest_dir).await {
                    if let Some(fname) = find_last_matching_token(
                        &dir_html,
                        "FreeBSD-",
                        "-arm64-aarch64-ufs.qcow2.xz",
                        None,
                    )
                    .or_else(|| {
                        find_last_matching_token(
                            &dir_html,
                            "FreeBSD-",
                            "-arm64-aarch64.qcow2.xz",
                            None,
                        )
                    }) {
                        return Ok(ResolvedUpstreamAsset {
                            url: format!("{latest_dir}{fname}"),
                            filename: fname,
                            sha256_manifest_url: None,
                        });
                    }
                }
            }
            Err("Unable to reach FreeBSD VM-IMAGES mirror at download.freebsd.org. Check your internet connection or provide a Custom Mirror URL.".to_string())
        }
        "openbsd" => {
            let ob_root = "https://cdn.openbsd.org/pub/OpenBSD";
            let mut versions: Vec<String> = Vec::new();
            if let Ok(root_html) = curl_text(&format!("{ob_root}/")).await {
                for tok in root_html.split(|c: char| {
                    c == '"' || c == '\'' || c == '>' || c == '<' || c == '/' || c.is_whitespace()
                }) {
                    if tok.len() >= 3
                        && tok.len() <= 5
                        && tok.contains('.')
                        && tok.chars().all(|c| c.is_ascii_digit() || c == '.')
                        && !versions.iter().any(|v| v == tok)
                    {
                        versions.push(tok.to_string());
                    }
                }
                versions.sort_by(|a, b| compare_version_desc(a, b));
            }
            for fallback in ["7.8", "7.7", "7.6"] {
                if !versions.iter().any(|v| v == fallback) {
                    versions.push(fallback.to_string());
                }
            }

            for ver in versions.into_iter().take(5) {
                let short: String = ver.chars().filter(|c| *c != '.').collect();
                let fname = format!("install{short}.img");
                let base = format!("{ob_root}/{ver}/arm64");
                let url = format!("{base}/{fname}");
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: format!("openbsd-{fname}"),
                        sha256_manifest_url: Some(format!("{base}/SHA256")),
                    });
                }
            }
            Err("Unable to reach OpenBSD arm64 mirror at cdn.openbsd.org. Check your internet connection or provide a Custom Mirror URL.".to_string())
        }
        "netbsd" => {
            let nb_root = "https://cdn.netbsd.org/pub/NetBSD";
            let mut versions: Vec<String> = Vec::new();
            if let Ok(root_html) = curl_text(&format!("{nb_root}/")).await {
                for tok in root_html.split(|c: char| {
                    c == '"' || c == '\'' || c == '>' || c == '<' || c == '/' || c.is_whitespace()
                }) {
                    if let Some(ver) = tok.strip_prefix("NetBSD-") {
                        if !ver.is_empty()
                            && ver.chars().all(|c| c.is_ascii_digit() || c == '.')
                            && !versions.iter().any(|v| v == ver)
                        {
                            versions.push(ver.to_string());
                        }
                    }
                }
                versions.sort_by(|a, b| compare_version_desc(a, b));
            }
            for fallback in ["10.1", "10.0"] {
                if !versions.iter().any(|v| v == fallback) {
                    versions.push(fallback.to_string());
                }
            }

            for ver in versions.into_iter().take(4) {
                let url = format!(
                    "{nb_root}/NetBSD-{ver}/evbarm-aarch64/binary/gzimg/arm64.img.gz"
                );
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: format!("netbsd-{ver}-arm64.img.gz"),
                        sha256_manifest_url: None,
                    });
                }
            }
            Ok(ResolvedUpstreamAsset {
                url: "https://cdn.netbsd.org/pub/NetBSD/NetBSD-10.1/evbarm-aarch64/binary/gzimg/arm64.img.gz"
                    .to_string(),
                filename: "netbsd-10.1-arm64.img.gz".to_string(),
                sha256_manifest_url: None,
            })
        }
        "openwrt" => {
            for ver in ["24.10.0", "23.05.5"] {
                let fname = format!(
                    "openwrt-{ver}-armsr-armv8-generic-ext4-combined-efi.img.gz"
                );
                let url = format!(
                    "https://downloads.openwrt.org/releases/{ver}/targets/armsr/armv8/{fname}"
                );
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: fname,
                        sha256_manifest_url: None,
                    });
                }
            }
            Err("Unable to reach OpenWrt armsr/armv8 release mirror".to_string())
        }
        "mikrotik-chr" => {
            for ver in ["7.17.2", "7.16.2", "7.15.3"] {
                let fname = format!("chr-{ver}.arm64.img.zip");
                let url = format!("https://download.mikrotik.com/routeros/{ver}/{fname}");
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: fname,
                        sha256_manifest_url: None,
                    });
                }
            }
            Err("Unable to resolve MikroTik RouterOS CHR ARM64 image".to_string())
        }
        "vyos" => {
            let api = "https://api.github.com/repos/vyos/vyos-nightly-build/releases/latest";
            if let Ok(json_str) = curl_text(api).await {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    if let Some(assets) = val.get("assets").and_then(|a| a.as_array()) {
                        for asset in assets {
                            let name = asset
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or_default();
                            let dl = asset
                                .get("browser_download_url")
                                .and_then(|u| u.as_str())
                                .unwrap_or_default();
                            if name.ends_with(".iso") && name.contains("amd64") && !dl.is_empty() {
                                return Ok(ResolvedUpstreamAsset {
                                    url: dl.to_string(),
                                    filename: name.to_string(),
                                    sha256_manifest_url: None,
                                });
                            }
                        }
                    }
                }
            }
            Err("Unable to resolve latest VyOS rolling ISO from GitHub releases. Supply a Custom Mirror URL or Import Local File.".to_string())
        }
        "9front" => {
            let dir_url = "https://9front.org/iso/";
            if let Ok(html) = curl_text(dir_url).await {
                if let Some(fname) =
                    find_last_matching_token(&html, "9front-", ".arm64.qcow2.gz", None)
                {
                    let full_url = if fname.starts_with("http") {
                        fname.clone()
                    } else {
                        // Many 9front iso links point to `http://iso.only9fans.com/release/...`
                        if let Some(full) =
                            find_last_matching_token(&html, "https://", ".arm64.qcow2.gz", None)
                                .or_else(|| {
                                    find_last_matching_token(
                                        &html,
                                        "http://",
                                        ".arm64.qcow2.gz",
                                        None,
                                    )
                                })
                        {
                            full
                        } else {
                            format!("{dir_url}{fname}")
                        }
                    };
                    let clean_name = filename_from_url(&full_url, "9front");
                    return Ok(ResolvedUpstreamAsset {
                        url: full_url,
                        filename: clean_name,
                        sha256_manifest_url: None,
                    });
                }
            }
            Err("Unable to resolve 9front ARM64 qcow2.gz mirror from 9front.org/iso/.".to_string())
        }
        "opnsense" => {
            for ver in ["25.1", "24.7"] {
                let fname = format!("OPNsense-{ver}-nano-amd64.img.bz2");
                let url = format!("https://pkg.opnsense.org/releases/{ver}/{fname}");
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: fname,
                        sha256_manifest_url: None,
                    });
                }
            }
            Err("Unable to resolve OPNsense nano-amd64 image from pkg.opnsense.org.".to_string())
        }
        "omnios" => {
            for ver in ["r151052", "r151050", "r151046"] {
                let fname = format!("omnios-{ver}.cloud.qcow2.xz");
                let url = format!("https://us-west.mirror.omnios.org/media/stable/{fname}");
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: fname,
                        sha256_manifest_url: None,
                    });
                }
            }
            Err("Unable to resolve OmniOS cloud qcow2.xz from mirror.omnios.org.".to_string())
        }
        "dragonflybsd" => {
            for ver in ["6.4.2", "6.4.0"] {
                let fname = format!("dfly-x86_64-{ver}_REL.iso.bz2");
                let url = format!("https://mirror-master.dragonflybsd.org/iso-images/{fname}");
                if probe_url_reachable(&url).await {
                    return Ok(ResolvedUpstreamAsset {
                        url,
                        filename: fname,
                        sha256_manifest_url: None,
                    });
                }
            }
            Err("Unable to resolve DragonFly BSD release ISO from mirror-master.dragonflybsd.org.".to_string())
        }
        "haiku" => Ok(ResolvedUpstreamAsset {
            url: "https://cdn.haiku-os.org/haiku-release/r1beta5/haiku-r1beta5-x86_64-anyboot.iso.zip"
                .to_string(),
            filename: "haiku-r1beta5-x86_64-anyboot.iso.zip".to_string(),
            sha256_manifest_url: None,
        }),
        "freedos" => Ok(ResolvedUpstreamAsset {
            url: "https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.3/official/FD13-LiveCD.zip"
                .to_string(),
            filename: "freedos-FD13-LiveCD.zip".to_string(),
            sha256_manifest_url: None,
        }),
        other => Err(format!(
            "No automatic mirror configured for '{other}'. Supply a Custom Mirror URL or Import a Local File."
        )),
    }
}

async fn curl_text(url: &str) -> Result<String, String> {
    let curl_bin = resolve_macos_binary("curl").unwrap_or_else(|| PathBuf::from("/usr/bin/curl"));
    let out = Command::new(&curl_bin)
        .args(["-fsSL", "--connect-timeout", "10", "--max-time", "20", url])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed invoking curl: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            format!("HTTP request failed for {url} ({})", out.status)
        } else {
            format!("HTTP request failed for {url}: {detail}")
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn probe_url_reachable(url: &str) -> bool {
    let curl_bin = resolve_macos_binary("curl").unwrap_or_else(|| PathBuf::from("/usr/bin/curl"));
    Command::new(&curl_bin)
        .args(["-fsSLI", "--connect-timeout", "8", "--max-time", "12", url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn probe_content_length(url: &str) -> Option<u64> {
    let curl_bin = resolve_macos_binary("curl").unwrap_or_else(|| PathBuf::from("/usr/bin/curl"));
    let out = Command::new(&curl_bin)
        .args(["-fsSLI", "--connect-timeout", "8", "--max-time", "12", url])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let headers = String::from_utf8_lossy(&out.stdout);
    headers
        .lines()
        .filter_map(|line| {
            let lower = line.to_ascii_lowercase();
            lower
                .strip_prefix("content-length:")
                .and_then(|v| v.trim().parse::<u64>().ok())
        })
        .last()
}

async fn fetch_small_file(url: &str, dest: &Path) -> Result<(), String> {
    let text = curl_text(url).await?;
    fs::write(dest, text.as_bytes()).map_err(|e| e.to_string())
}

async fn verify_sha256_from_manifest(
    downloaded_file: &Path,
    logical_filename: &str,
    sha256_manifest: &Path,
) -> Result<(), String> {
    let manifest_text = fs::read_to_string(sha256_manifest).map_err(|e| e.to_string())?;
    let clean_target = logical_filename.trim_start_matches("openbsd-");
    let expected = manifest_text.lines().find_map(|line| {
        // OpenBSD format: `SHA256 (install76.img) = <64-hex>`
        if line.contains(&format!("({clean_target})")) || line.contains(clean_target) {
            line.split_whitespace()
                .find(|tok| tok.len() == 64 && tok.chars().all(|c| c.is_ascii_hexdigit()))
                .map(|s| s.to_ascii_lowercase())
        } else {
            None
        }
    });

    let Some(expected_hex) = expected else {
        return Ok(());
    };

    let shasum_bin =
        resolve_macos_binary("shasum").unwrap_or_else(|| PathBuf::from("/usr/bin/shasum"));
    let out = Command::new(&shasum_bin)
        .args(["-a", "256", &downloaded_file.display().to_string()])
        .output()
        .await
        .map_err(|e| format!("Failed running shasum: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let actual_hex = stdout
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    if actual_hex != expected_hex {
        return Err(format!(
            "SHA-256 checksum mismatch for {clean_target}: expected {expected_hex}, got {actual_hex}"
        ));
    }
    Ok(())
}

async fn run_cancellable_command(
    bin: &Path,
    args: &[&str],
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed spawning {}: {e}", bin.display()))?;

    let stderr_pipe = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        if let Some(mut pipe) = stderr_pipe {
            use tokio::io::AsyncReadExt;
            let mut buf = String::new();
            let _ = pipe.read_to_string(&mut buf).await;
            buf
        } else {
            String::new()
        }
    });

    tokio::select! {
        _ = cancel_rx.changed() => {
            if *cancel_rx.borrow() {
                let _ = child.kill().await;
                return Err("__CANCELLED__".to_string());
            }
            let status = child.wait().await.map_err(|e| e.to_string())?;
            let stderr_text = stderr_task.await.unwrap_or_default();
            if !status.success() {
                let detail = stderr_text.trim();
                return Err(if detail.is_empty() {
                    format!("{} exited with {status}", bin.display())
                } else {
                    format!("{} failed ({status}): {detail}", bin.display())
                });
            }
            Ok(())
        }
        res = child.wait() => {
            let status = res.map_err(|e| e.to_string())?;
            let stderr_text = stderr_task.await.unwrap_or_default();
            if !status.success() {
                let detail = stderr_text.trim();
                return Err(if detail.is_empty() {
                    format!("{} failed ({status})", bin.display())
                } else {
                    format!("{} failed ({status}): {detail}", bin.display())
                });
            }
            Ok(())
        }
    }
}

/// Selects the best Alpine Linux ARM64 UEFI cloud image filename from an HTML directory listing.
/// Upstream Alpine `releases/cloud/` publishes `.qcow2.xz` (and historically `.qcow2`) images;
/// we prefer `nocloud_alpine-*-aarch64-uefi-tiny-*.qcow2(.xz)` (instant passwordless `root` serial console)
/// before falling back to `cloudinit` or `generic_alpine-*` variants.
fn select_alpine_cloud_filename(html: &str) -> Option<String> {
    for (prefix, must_contain) in [
        ("nocloud_alpine-", "aarch64-uefi-tiny"),
        ("nocloud_alpine-", "aarch64-uefi"),
        ("generic_alpine-", "aarch64-uefi"),
    ] {
        for suffix in [".qcow2.xz", ".qcow2"] {
            if let Some(found) = find_last_matching_token(html, prefix, suffix, Some(must_contain))
            {
                return Some(found);
            }
        }
    }
    None
}

fn compare_version_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let parse_nums = |s: &str| -> Vec<u32> {
        s.split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .filter_map(|p| p.parse::<u32>().ok())
            .collect()
    };
    parse_nums(b).cmp(&parse_nums(a)).then_with(|| b.cmp(a))
}

fn find_last_matching_token(
    html: &str,
    prefix: &str,
    suffix: &str,
    must_contain: Option<&str>,
) -> Option<String> {
    let mut matches = Vec::new();
    for part in html.split(|c: char| c == '"' || c == '\'' || c == '>' || c == '<' || c.is_whitespace())
    {
        if part.starts_with(prefix)
            && part.ends_with(suffix)
            && must_contain.map(|sub| part.contains(sub)).unwrap_or(true)
        {
            matches.push(part.to_string());
        }
    }
    matches.sort();
    matches.pop()
}

fn filename_from_url(url: &str, fallback_prefix: &str) -> String {
    url.split('?')
        .next()
        .and_then(|clean| clean.rsplit('/').next())
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{fallback_prefix}.img"))
}

fn strip_last_extension(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("extracted.img");
    path.parent()
        .map(|p| p.join(stem))
        .unwrap_or_else(|| PathBuf::from(stem))
}

fn find_largest_disk_in_dir(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let Ok(entries) = fs::read_dir(&cur) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "qcow2" | "img" | "raw" | "iso" | "vmdk" | "vdi") {
                if let Ok(meta) = fs::metadata(&p) {
                    let len = meta.len();
                    if best.as_ref().map(|(b, _)| len > *b).unwrap_or(true) {
                        best = Some((len, p));
                    }
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

fn move_or_copy_file(src: &Path, dst: &Path) -> Result<(), String> {
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    fs::copy(src, dst)
        .map_err(|e| format!("Failed copying {} to {}: {e}", src.display(), dst.display()))?;
    let _ = fs::remove_file(src);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn catalog_exposes_all_fifteen_curated_multi_arch_operating_systems() {
        let tmp = std::env::temp_dir().join(format!("etherloom-cat-test-{}", Uuid::new_v4()));
        let storage = StorageManager::new(tmp.join("AppSupport"), tmp.join("FakeVolumes"));
        let _ = storage.refresh_and_snapshot().await;
        let image_store = ImageStore::new(storage);
        let mgr = CatalogManager::new();

        let entries = mgr
            .list_catalog(&image_store, "aarch64", true)
            .await
            .unwrap();
        assert_eq!(entries.len(), 15, "must expose all 15 curated OSes");

        let arm_count = entries
            .iter()
            .filter(|e| e.arch == GuestArch::Aarch64)
            .count();
        let x86_count = entries
            .iter()
            .filter(|e| e.arch == GuestArch::X86_64)
            .count();
        let i386_count = entries.iter().filter(|e| e.arch == GuestArch::I386).count();
        assert_eq!(arm_count, 8);
        assert_eq!(x86_count, 6);
        assert_eq!(i386_count, 1);

        // Verify local file import + safe delete + project reference check using a mock qemu-img
        let mock_qemu_img = tmp.join("mock-qemu-img");
        let script = r#"#!/usr/bin/env python3
import json, os, shutil, sys
args = sys.argv[1:]
cmd = args[0]
if cmd == "convert":
    src, dst = args[-2], args[-1]
    shutil.copyfile(src, dst)
elif cmd == "resize":
    pass
elif cmd == "info":
    target = args[-1]
    print(json.dumps({"format": "qcow2", "virtual-size": 4294967296, "actual-size": os.path.getsize(target)}))
"#;
        fs::write(&mock_qemu_img, script).unwrap();
        let mut perms = fs::metadata(&mock_qemu_img).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&mock_qemu_img, perms).unwrap();

        let store_with_mock =
            ImageStore::with_qemu_img_binary(image_store.storage().clone(), mock_qemu_img);
        let dummy_raw = tmp.join("chr-test.img");
        fs::write(&dummy_raw, vec![0u8; 4096]).unwrap();

        let imported = mgr
            .import_local_file(
                CatalogImportLocalRequest {
                    catalog_id: "mikrotik-chr".to_string(),
                    source_path: dummy_raw.display().to_string(),
                },
                store_with_mock.storage(),
                &store_with_mock,
            )
            .await
            .unwrap();
        assert_eq!(imported.availability, CatalogAvailability::Ready);
        assert_eq!(
            imported.installed_template_id.as_deref(),
            Some("mikrotik-chr-aarch64-base")
        );

        let vm_mgr = VmManager::new();
        let del = mgr
            .delete_image("mikrotik-chr", false, &store_with_mock, &vm_mgr)
            .await
            .unwrap();
        assert!(del.deleted);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn alpine_cloud_resolver_matches_xz_compressed_and_tiny_images() {
        let html_xz = r#"
            <a href="nocloud_alpine-3.21.2-x86_64-uefi-tiny-r0.qcow2.xz">x86</a>
            <a href="nocloud_alpine-3.21.2-aarch64-uefi-cloudinit-r0.qcow2.xz">cloudinit</a>
            <a href="nocloud_alpine-3.21.2-aarch64-uefi-tiny-r0.qcow2.xz">tiny</a>
            <a href="nocloud_alpine-3.21.2-aarch64-uefi-tiny-r0.qcow2.xz.sha512">sha</a>
        "#;
        assert_eq!(
            select_alpine_cloud_filename(html_xz).as_deref(),
            Some("nocloud_alpine-3.21.2-aarch64-uefi-tiny-r0.qcow2.xz")
        );

        let html_cloudinit_only = r#"
            <a href="nocloud_alpine-3.22.0-aarch64-uefi-cloudinit-r0.qcow2.xz">cloudinit</a>
        "#;
        assert_eq!(
            select_alpine_cloud_filename(html_cloudinit_only).as_deref(),
            Some("nocloud_alpine-3.22.0-aarch64-uefi-cloudinit-r0.qcow2.xz")
        );
    }
}
