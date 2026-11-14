use crate::env_doctor::resolve_qemu_img;
use crate::storage::StorageManager;
use crate::vm_manager::{DiskBus, FinalizeTemplateOnExit, FirmwareType, GuestArch, NicModel};
use serde::{Deserialize, Serialize};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

const QEMU_IMG_TIMEOUT: Duration = Duration::from_secs(20);

/// Built-in Guest OS Profile preset defining NIC naming conventions, architecture, and default compute sizing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OsProfile {
    pub id: String,
    pub name: String,
    pub guest_family: String,
    #[serde(default)]
    pub arch: GuestArch,
    #[serde(default)]
    pub default_nic_model: NicModel,
    #[serde(default)]
    pub default_firmware: FirmwareType,
    #[serde(default)]
    pub default_disk_bus: DiskBus,
    pub nic_prefix: String,
    pub nic_naming_pattern: String,
    pub alt_nic_naming_pattern: Option<String>,
    pub default_ram_mb: u32,
    pub default_cpus: u8,
    pub recommended_disk_gb: u32,
    pub notes: String,
}

impl OsProfile {
    /// Formats the canonical guest interface name for NIC index `n` (0-based) using the profile's default NIC model.
    pub fn format_nic(&self, index: usize) -> String {
        format_guest_interface(
            Some(&self.id),
            Some(&self.guest_family),
            self.default_nic_model,
            index,
        )
    }

    /// Formats the guest interface name for NIC index `n` under a specific `nic_model` override.
    pub fn format_nic_for_model(&self, nic_model: NicModel, index: usize) -> String {
        format_guest_interface(
            Some(&self.id),
            Some(&self.guest_family),
            nic_model,
            index,
        )
    }
}

/// Computes the exact in-guest network interface label given the OS profile, guest family, emulated NIC model, and 0-based slot index.
pub fn format_guest_interface(
    os_profile_id: Option<&str>,
    guest_family: Option<&str>,
    nic_model: NicModel,
    index: usize,
) -> String {
    match os_profile_id.unwrap_or("") {
        "mikrotik-chr" => return format!("ether{}", index + 1),
        "9front" => return format!("/net/ether{index}"),
        "omnios" => {
            return match nic_model {
                NicModel::VirtioNetPci => format!("vioif{index}"),
                NicModel::Rtl8139 => format!("rtls{index}"),
                _ => format!("e1000g{index}"),
            };
        }
        "haiku" => {
            return match nic_model {
                NicModel::VirtioNetPci => format!("/dev/net/virtio/{index}"),
                NicModel::Rtl8139 => format!("/dev/net/rtl8139/{index}"),
                NicModel::Pcnet => format!("/dev/net/pcnet/{index}"),
                _ => format!("/dev/net/ipro1000/{index}"),
            };
        }
        "freedos" => {
            let vec_int = 0x60 + index;
            return match nic_model {
                NicModel::Ne2kPci => format!("NE2000 0x{vec_int:02x}"),
                NicModel::E1000 => format!("E1000PKT 0x{vec_int:02x}"),
                NicModel::Rtl8139 => format!("RTSPKT 0x{vec_int:02x}"),
                _ => format!("PCNTPK 0x{vec_int:02x}"),
            };
        }
        "freebsd" | "opnsense" | "pfsense" | "dragonflybsd" => {
            return format_freebsd_family_nic(nic_model, index);
        }
        "openbsd" => {
            return format_openbsd_nic(nic_model, index);
        }
        "netbsd" => {
            return format_netbsd_nic(nic_model, index);
        }
        _ => {}
    }

    match guest_family.unwrap_or("linux") {
        "freebsd" => format_freebsd_family_nic(nic_model, index),
        "openbsd" => format_openbsd_nic(nic_model, index),
        "netbsd" => format_netbsd_nic(nic_model, index),
        _ => format!("eth{index}"),
    }
}

fn format_freebsd_family_nic(nic_model: NicModel, index: usize) -> String {
    match nic_model {
        NicModel::VirtioNetPci => format!("vtnet{index}"),
        NicModel::E1000 => format!("em{index}"),
        NicModel::Rtl8139 => format!("re{index}"),
        NicModel::Pcnet => format!("le{index}"),
        NicModel::Ne2kPci => format!("ed{index}"),
    }
}

fn format_openbsd_nic(nic_model: NicModel, index: usize) -> String {
    match nic_model {
        NicModel::VirtioNetPci => format!("vio{index}"),
        NicModel::E1000 => format!("em{index}"),
        NicModel::Rtl8139 => format!("rl{index}"),
        NicModel::Pcnet => format!("pcn{index}"),
        NicModel::Ne2kPci => format!("ne{index}"),
    }
}

fn format_netbsd_nic(nic_model: NicModel, index: usize) -> String {
    match nic_model {
        NicModel::VirtioNetPci => format!("vioif{index}"),
        NicModel::E1000 => format!("wm{index}"),
        NicModel::Rtl8139 => format!("rtk{index}"),
        NicModel::Pcnet => format!("pcn{index}"),
        NicModel::Ne2kPci => format!("ne{index}"),
    }
}

/// Returns all 15 built-in OS Profile presets spanning ARM64 HVF, x86_64, and i386 guests.
pub fn builtin_os_profiles() -> Vec<OsProfile> {
    vec![
        // --- Core 5 Foundational Profiles (100% ID-compatible with Phases 1-5 & Academy Labs) ---
        OsProfile {
            id: "alpine-linux".to_string(),
            name: "Alpine Linux".to_string(),
            guest_family: "linux".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "eth".to_string(),
            nic_naming_pattern: "eth{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 256,
            default_cpus: 1,
            recommended_disk_gb: 4,
            notes: "Lightweight musl/BusyBox ARM64 Linux host & router (virtio-net eth0..n)".to_string(),
        },
        OsProfile {
            id: "debian-linux".to_string(),
            name: "Debian / Generic Linux".to_string(),
            guest_family: "linux".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "eth".to_string(),
            nic_naming_pattern: "enp0s{n} / eth{n}".to_string(),
            alt_nic_naming_pattern: Some("enp0s{n}".to_string()),
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 10,
            notes: "Debian Cloud ARM64 / FRRouting / nftables / namespaces (enp0s* or eth*)"
                .to_string(),
        },
        OsProfile {
            id: "freebsd".to_string(),
            name: "FreeBSD".to_string(),
            guest_family: "freebsd".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "vtnet".to_string(),
            nic_naming_pattern: "vtnet{n}".to_string(),
            alt_nic_naming_pattern: Some("em{n} (e1000)".to_string()),
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 12,
            notes: "FreeBSD ARM64 UEFI guest with virtio vtnet0..n (or em0..n on e1000) & VNET jails".to_string(),
        },
        OsProfile {
            id: "openbsd".to_string(),
            name: "OpenBSD".to_string(),
            guest_family: "openbsd".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "vio".to_string(),
            nic_naming_pattern: "vio{n}".to_string(),
            alt_nic_naming_pattern: Some("em{n} (e1000)".to_string()),
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 8,
            notes: "OpenBSD ARM64 UEFI guest with pf, CARP, pfsync, OpenBGPD & vio0..n".to_string(),
        },
        OsProfile {
            id: "netbsd".to_string(),
            name: "NetBSD".to_string(),
            guest_family: "netbsd".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "vioif".to_string(),
            nic_naming_pattern: "vioif{n}".to_string(),
            alt_nic_naming_pattern: Some("wm{n} (e1000)".to_string()),
            default_ram_mb: 256,
            default_cpus: 1,
            recommended_disk_gb: 6,
            notes: "NetBSD evbarm-aarch64 UEFI guest with NPF, rumpkernels & vioif0..n".to_string(),
        },
        // --- Routers & Firewalls ---
        OsProfile {
            id: "openwrt".to_string(),
            name: "OpenWrt".to_string(),
            guest_family: "linux".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "eth".to_string(),
            nic_naming_pattern: "eth{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 128,
            default_cpus: 1,
            recommended_disk_gb: 2,
            notes: "Embedded ARM64 home/SOHO router OS (armsr/armv8 EFI, LuCI web UI & nftables fw4)".to_string(),
        },
        OsProfile {
            id: "mikrotik-chr".to_string(),
            name: "MikroTik RouterOS CHR".to_string(),
            guest_family: "linux".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "ether".to_string(),
            nic_naming_pattern: "ether{n+1}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 256,
            default_cpus: 2,
            recommended_disk_gb: 2,
            notes: "Cloud Hosted Router v7 ARM64 (1-indexed ether1..n, OSPF, BGP, MPLS, VXLAN)".to_string(),
        },
        OsProfile {
            id: "vyos".to_string(),
            name: "VyOS (Stream / Rolling)".to_string(),
            guest_family: "linux".to_string(),
            arch: GuestArch::X86_64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "eth".to_string(),
            nic_naming_pattern: "eth{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 1024,
            default_cpus: 2,
            recommended_disk_gb: 10,
            notes: "Enterprise Junos-style commit/rollback CLI router powered by FRRouting (eth0..n)".to_string(),
        },
        OsProfile {
            id: "opnsense".to_string(),
            name: "OPNsense (nano Serial)".to_string(),
            guest_family: "freebsd".to_string(),
            arch: GuestArch::X86_64,
            default_nic_model: NicModel::E1000,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::Ahci,
            nic_prefix: "em".to_string(),
            nic_naming_pattern: "em{n}".to_string(),
            alt_nic_naming_pattern: Some("vtnet{n} (virtio-net-pci)".to_string()),
            default_ram_mb: 1536,
            default_cpus: 2,
            recommended_disk_gb: 16,
            notes: "Hardened FreeBSD x86_64 firewall appliance (nano pre-installed serial image, em0 WAN / em1 LAN)".to_string(),
        },
        OsProfile {
            id: "pfsense".to_string(),
            name: "pfSense CE".to_string(),
            guest_family: "freebsd".to_string(),
            arch: GuestArch::X86_64,
            default_nic_model: NicModel::E1000,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::Ahci,
            nic_prefix: "em".to_string(),
            nic_naming_pattern: "em{n}".to_string(),
            alt_nic_naming_pattern: Some("vtnet{n} (virtio-net-pci)".to_string()),
            default_ram_mb: 1024,
            default_cpus: 2,
            recommended_disk_gb: 16,
            notes: "Classic FreeBSD x86_64 enterprise firewall & VPN gateway (em0..n or vtnet0..n)".to_string(),
        },
        // --- Research, UNIX & Retro ---
        OsProfile {
            id: "9front".to_string(),
            name: "9front (Plan 9)".to_string(),
            guest_family: "other".to_string(),
            arch: GuestArch::Aarch64,
            default_nic_model: NicModel::VirtioNetPci,
            default_firmware: FirmwareType::Uefi,
            default_disk_bus: DiskBus::VirtioBlk,
            nic_prefix: "/net/ether".to_string(),
            nic_naming_pattern: "/net/ether{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 6,
            notes: "Plan 9 from Bell Labs (ARM64 HVF) — everything-is-a-file /net stack & 9P".to_string(),
        },
        OsProfile {
            id: "omnios".to_string(),
            name: "OmniOS (Illumos)".to_string(),
            guest_family: "other".to_string(),
            arch: GuestArch::X86_64,
            default_nic_model: NicModel::E1000,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::Ahci,
            nic_prefix: "e1000g".to_string(),
            nic_naming_pattern: "e1000g{n}".to_string(),
            alt_nic_naming_pattern: Some("vioif{n} (virtio-net-pci)".to_string()),
            default_ram_mb: 1024,
            default_cpus: 2,
            recommended_disk_gb: 16,
            notes: "OpenSolaris / Illumos x86_64 server with Crossbow VNICs (dladm/ipadm), Zones & DTrace".to_string(),
        },
        OsProfile {
            id: "dragonflybsd".to_string(),
            name: "DragonFly BSD".to_string(),
            guest_family: "freebsd".to_string(),
            arch: GuestArch::X86_64,
            default_nic_model: NicModel::E1000,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::Ahci,
            nic_prefix: "em".to_string(),
            nic_naming_pattern: "em{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 12,
            notes: "DragonFly BSD x86_64 with lockless per-CPU LWKT packet routing & HAMMER2".to_string(),
        },
        OsProfile {
            id: "haiku".to_string(),
            name: "Haiku OS".to_string(),
            guest_family: "other".to_string(),
            arch: GuestArch::X86_64,
            default_nic_model: NicModel::E1000,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::Ahci,
            nic_prefix: "/dev/net/ipro1000/".to_string(),
            nic_naming_pattern: "/dev/net/ipro1000/{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 8,
            notes: "Modern BeOS desktop UNIX-like OS (x86_64 Intel PRO/1000 /dev/net/ipro1000/0)".to_string(),
        },
        OsProfile {
            id: "freedos".to_string(),
            name: "FreeDOS + mTCP".to_string(),
            guest_family: "other".to_string(),
            arch: GuestArch::I386,
            default_nic_model: NicModel::Pcnet,
            default_firmware: FirmwareType::Bios,
            default_disk_bus: DiskBus::Ide,
            nic_prefix: "PCNTPK 0x6".to_string(),
            nic_naming_pattern: "PCNTPK 0x6{n}".to_string(),
            alt_nic_naming_pattern: Some("NE2000 0x6{n} (ne2k_pci)".to_string()),
            default_ram_mb: 32,
            default_cpus: 1,
            recommended_disk_gb: 1,
            notes: "Single-tasking 32-bit DOS with Crynwr packet driver & mTCP — zero background packet noise!".to_string(),
        },
    ]
}

/// Looks up a built-in `OsProfile` by `id`.
pub fn find_os_profile(profile_id: &str) -> Option<OsProfile> {
    builtin_os_profiles()
        .into_iter()
        .find(|p| p.id == profile_id)
}

/// Infers `(os_profile_id, human_name)` from a `.qcow2` filename stem when `.template.json` is absent
/// (such as templates created by `scripts/prepare-library.sh`).
pub fn infer_profile_from_stem(stem: &str) -> (&'static str, String) {
    let lower = stem.to_ascii_lowercase();
    let profile_id = if lower.starts_with("alpine") {
        "alpine-linux"
    } else if lower.starts_with("freebsd") {
        "freebsd"
    } else if lower.starts_with("openbsd") {
        "openbsd"
    } else if lower.starts_with("netbsd") {
        "netbsd"
    } else if lower.starts_with("openwrt") {
        "openwrt"
    } else if lower.starts_with("mikrotik") || lower.starts_with("chr") || lower.contains("routeros") {
        "mikrotik-chr"
    } else if lower.starts_with("vyos") {
        "vyos"
    } else if lower.starts_with("9front") || lower.starts_with("plan9") {
        "9front"
    } else if lower.starts_with("opnsense") {
        "opnsense"
    } else if lower.starts_with("pfsense") {
        "pfsense"
    } else if lower.starts_with("omnios") || lower.starts_with("illumos") {
        "omnios"
    } else if lower.starts_with("dragonfly") {
        "dragonflybsd"
    } else if lower.starts_with("haiku") {
        "haiku"
    } else if lower.starts_with("freedos") || lower.starts_with("mtcp") {
        "freedos"
    } else {
        "debian-linux"
    };

    let display_name = find_os_profile(profile_id)
        .map(|p| format!("{} ({})", p.name, stem))
        .unwrap_or_else(|| stem.to_string());
    (profile_id, display_name)
}

/// Metadata stored alongside a Golden Image inside active `templates_dir`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseTemplateInfo {
    pub id: String,
    pub name: String,
    pub os_profile_id: String,
    #[serde(default)]
    pub arch: GuestArch,
    #[serde(default)]
    pub default_nic_model: NicModel,
    #[serde(default)]
    pub default_firmware: FirmwareType,
    #[serde(default)]
    pub default_disk_bus: DiskBus,
    pub path: String,
    pub filename: String,
    pub virtual_size_bytes: u64,
    pub actual_size_bytes: u64,
    pub read_only: bool,
    pub created_at_ms: u64,
    pub description: Option<String>,
}

/// Installer `.iso` or `.img` media entry discovered inside active `isos_dir`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerMediaInfo {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub media_kind: String,
    pub modified_at_ms: u64,
}

/// Structured information about a created, inspected, or reset `.qcow2` disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub path: String,
    pub format: String,
    pub virtual_size_bytes: u64,
    pub actual_size_bytes: u64,
    pub backing_file: Option<String>,
    pub read_only: bool,
}

#[derive(Debug, Deserialize)]
struct QemuImgInfoJson {
    #[serde(default)]
    format: String,
    #[serde(rename = "virtual-size", default)]
    virtual_size: u64,
    #[serde(rename = "actual-size", default)]
    actual_size: u64,
    #[serde(rename = "backing-filename")]
    backing_filename: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBlankDiskRequest {
    pub disk_path: String,
    pub size_gb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteTemplateRequest {
    pub source_disk_path: String,
    pub template_name: String,
    pub os_profile_id: String,
    #[serde(default)]
    pub arch: Option<GuestArch>,
    #[serde(default)]
    pub default_nic_model: Option<NicModel>,
    #[serde(default)]
    pub default_firmware: Option<FirmwareType>,
    #[serde(default)]
    pub default_disk_bus: Option<DiskBus>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOverlayRequest {
    /// Logical `template_id` / filename in `templates_dir` or an explicit `.qcow2` path.
    pub template_id_or_path: String,
    /// Target `overlays/` directory (e.g. `<project>.etherloom/overlays`).
    pub overlays_dir: String,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetOverlayRequest {
    pub overlay_path: String,
    pub backing_template_override: Option<String>,
}

/// Node overlay -> logical template binding used on project load or pre-boot auto-rebase.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayTemplateBinding {
    pub node_id: Option<String>,
    pub overlay_path: String,
    /// Logical `template_id` or filename (e.g. `"openbsd-76"` or `"openbsd-76.qcow2"`).
    /// If omitted, `ensure_overlay_rebased` derives the filename from the overlay's recorded `backing-filename`.
    pub template_id: Option<String>,
}

/// Result of inspecting and (if needed) running `qemu-img rebase -u` on a node CoW overlay.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRebaseReport {
    pub overlay_path: String,
    pub rebased: bool,
    pub previous_backing: Option<String>,
    pub active_backing: Option<String>,
    pub resolved_template_filename: Option<String>,
}

/// Manages OS templates, installer ISOs, CoW node overlays, and portable `qcow2` backing auto-rebase.
#[derive(Clone)]
pub struct ImageStore {
    storage: StorageManager,
    qemu_img_override: Option<PathBuf>,
}

impl Default for ImageStore {
    fn default() -> Self {
        Self::new(StorageManager::default())
    }
}

impl ImageStore {
    pub fn new(storage: StorageManager) -> Self {
        Self {
            storage,
            qemu_img_override: None,
        }
    }

    pub fn with_qemu_img_binary(storage: StorageManager, binary: PathBuf) -> Self {
        Self {
            storage,
            qemu_img_override: Some(binary),
        }
    }

    pub fn storage(&self) -> &StorageManager {
        &self.storage
    }

    pub(crate) fn resolve_qemu_img_bin(&self) -> Option<PathBuf> {
        self.qemu_img_override.clone().or_else(resolve_qemu_img)
    }

    pub(crate) fn require_qemu_img(&self) -> Result<PathBuf, String> {
        self.resolve_qemu_img_bin().ok_or_else(|| {
            "qemu-img was not found in /opt/homebrew/bin, /usr/local/bin, or PATH. Install QEMU via `brew install qemu`.".to_string()
        })
    }

    pub(crate) async fn run_qemu_img(&self, args: &[String]) -> Result<String, String> {
        let bin = self.require_qemu_img()?;
        let mut cmd = Command::new(&bin);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let output = timeout(QEMU_IMG_TIMEOUT, cmd.output())
            .await
            .map_err(|_| {
                format!(
                    "Timed out after {}s running {} {}",
                    QEMU_IMG_TIMEOUT.as_secs(),
                    bin.display(),
                    args.first().map(String::as_str).unwrap_or("")
                )
            })?
            .map_err(|e| format!("Failed to execute {}: {e}", bin.display()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "qemu-img failed ({}): {}{}",
                output.status,
                stderr.trim(),
                if stderr.trim().is_empty() {
                    stdout.trim()
                } else {
                    ""
                }
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Inspects a disk file using `qemu-img info -U --output=json` (`--force-share`) when available,
    /// avoiding advisory lock contention against starting/shutting-down QEMU instances.
    pub async fn inspect_disk(&self, disk_path: &Path) -> Result<DiskInfo, String> {
        let meta = fs::metadata(disk_path)
            .map_err(|e| format!("Disk {} does not exist: {e}", disk_path.display()))?;
        let read_only = meta.permissions().readonly();

        if self.resolve_qemu_img_bin().is_some() {
            let args = vec![
                "info".to_string(),
                "-U".to_string(),
                "--output=json".to_string(),
                disk_path.display().to_string(),
            ];
            if let Ok(json_text) = self.run_qemu_img(&args).await {
                if let Ok(parsed) = serde_json::from_str::<QemuImgInfoJson>(&json_text) {
                    return Ok(DiskInfo {
                        path: disk_path.display().to_string(),
                        format: if parsed.format.is_empty() {
                            "qcow2".to_string()
                        } else {
                            parsed.format
                        },
                        virtual_size_bytes: parsed.virtual_size,
                        actual_size_bytes: if parsed.actual_size > 0 {
                            parsed.actual_size
                        } else {
                            meta.len()
                        },
                        backing_file: parsed.backing_filename,
                        read_only,
                    });
                }
            }
        }

        Ok(DiskInfo {
            path: disk_path.display().to_string(),
            format: "qcow2".to_string(),
            virtual_size_bytes: meta.len(),
            actual_size_bytes: meta.len(),
            backing_file: None,
            read_only,
        })
    }

    /// Creates a blank `.qcow2` disk for fresh OS installations from `.iso` or `.img` media.
    pub async fn create_blank_disk(&self, req: CreateBlankDiskRequest) -> Result<DiskInfo, String> {
        if req.size_gb == 0 {
            return Err("Disk size must be at least 1 GB".to_string());
        }
        let paths = self.storage.resolved_paths().await;
        let target = PathBuf::from(&req.disk_path);
        self.assert_not_template_path(&paths.templates_dir, &target)?;

        if let Err(unmounted) =
            crate::storage::verify_volume_mounted_under(Path::new("/Volumes"), &target)
        {
            return Err(format!(
                "Destination volume '{}' is not mounted ({})",
                unmounted.volume_name, unmounted.expected_path
            ));
        }

        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create parent directory {}: {e}", parent.display())
                })?;
            }
        }

        let args = vec![
            "create".to_string(),
            "-f".to_string(),
            "qcow2".to_string(),
            target.display().to_string(),
            format!("{}G", req.size_gb),
        ];
        self.run_qemu_img(&args).await?;
        self.inspect_disk(&target).await
    }

    /// Promotes an installed VM disk into a standalone, read-only Base Template ("Golden Image")
    /// inside the active `templates_dir`.
    pub async fn promote_to_base_template(
        &self,
        req: PromoteTemplateRequest,
    ) -> Result<BaseTemplateInfo, String> {
        let ready_paths = self.storage.require_ready_paths().await?;
        let templates_dir = ready_paths.templates_dir;

        let source = PathBuf::from(&req.source_disk_path);
        if !source.is_file() {
            return Err(format!(
                "Source VM disk does not exist: {}",
                source.display()
            ));
        }

        let base_slug = slugify_name(&req.template_name);
        if base_slug.is_empty() {
            return Err("Template name must contain alphanumeric characters".to_string());
        }

        let mut template_id = base_slug.clone();
        let mut target_qcow2 = templates_dir.join(format!("{template_id}.qcow2"));
        if target_qcow2.exists() {
            let suffix = &Uuid::new_v4().simple().to_string()[..8];
            template_id = format!("{base_slug}-{suffix}");
            target_qcow2 = templates_dir.join(format!("{template_id}.qcow2"));
        }

        let args = vec![
            "convert".to_string(),
            "-O".to_string(),
            "qcow2".to_string(),
            source.display().to_string(),
            target_qcow2.display().to_string(),
        ];
        self.run_qemu_img(&args).await?;

        if let Ok(meta) = fs::metadata(&target_qcow2) {
            let mut perms = meta.permissions();
            perms.set_mode(0o444);
            let _ = fs::set_permissions(&target_qcow2, perms);
        }

        let info = self.inspect_disk(&target_qcow2).await?;
        let created_at_ms = now_epoch_ms();
        let filename = target_qcow2
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("template.qcow2")
            .to_string();

        let prof = find_os_profile(&req.os_profile_id);
        let arch = req
            .arch
            .or_else(|| prof.as_ref().map(|p| p.arch))
            .unwrap_or_default();
        let default_nic_model = req
            .default_nic_model
            .or_else(|| prof.as_ref().map(|p| p.default_nic_model))
            .unwrap_or_default();
        let default_firmware = req
            .default_firmware
            .or_else(|| prof.as_ref().map(|p| p.default_firmware))
            .unwrap_or_default();
        let default_disk_bus = req
            .default_disk_bus
            .or_else(|| prof.as_ref().map(|p| p.default_disk_bus))
            .unwrap_or_default();

        let template = BaseTemplateInfo {
            id: template_id.clone(),
            name: req.template_name.trim().to_string(),
            os_profile_id: req.os_profile_id,
            arch,
            default_nic_model,
            default_firmware,
            default_disk_bus,
            path: target_qcow2.display().to_string(),
            filename,
            virtual_size_bytes: info.virtual_size_bytes,
            actual_size_bytes: info.actual_size_bytes,
            read_only: true,
            created_at_ms,
            description: req.description,
        };

        let manifest_path = templates_dir.join(format!("{template_id}.template.json"));
        let manifest_json = serde_json::to_string_pretty(&template)
            .map_err(|e| format!("Failed to serialize template manifest: {e}"))?;
        fs::write(&manifest_path, manifest_json).map_err(|e| {
            format!(
                "Failed to write template manifest {}: {e}",
                manifest_path.display()
            )
        })?;

        Ok(template)
    }

    /// Marks an already-placed `.qcow2` file inside `templates_dir` read-only (`0444`) and writes its
    /// `.template.json` sidecar manifest (used by Catalog downloads & Guided Template Setup).
    pub async fn finalize_in_place_template(
        &self,
        target_qcow2: &Path,
        fin: &FinalizeTemplateOnExit,
    ) -> Result<BaseTemplateInfo, String> {
        if !target_qcow2.is_file() {
            return Err(format!(
                "Template qcow2 file does not exist: {}",
                target_qcow2.display()
            ));
        }

        if let Ok(meta) = fs::metadata(target_qcow2) {
            let mut perms = meta.permissions();
            perms.set_mode(0o444);
            let _ = fs::set_permissions(target_qcow2, perms);
        }

        let info = self.inspect_disk(target_qcow2).await?;
        let filename = target_qcow2
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("template.qcow2")
            .to_string();

        let template = BaseTemplateInfo {
            id: fin.template_id.clone(),
            name: fin.template_name.clone(),
            os_profile_id: fin.os_profile_id.clone(),
            arch: fin.arch,
            default_nic_model: fin.default_nic_model,
            default_firmware: fin.default_firmware,
            default_disk_bus: fin.default_disk_bus,
            path: target_qcow2.display().to_string(),
            filename,
            virtual_size_bytes: info.virtual_size_bytes,
            actual_size_bytes: info.actual_size_bytes,
            read_only: true,
            created_at_ms: now_epoch_ms(),
            description: fin.description.clone(),
        };

        if let Some(parent) = target_qcow2.parent() {
            let manifest_path = parent.join(format!("{}.template.json", fin.template_id));
            if let Ok(json_text) = serde_json::to_string_pretty(&template) {
                let _ = fs::write(&manifest_path, json_text);
            }
        }

        Ok(template)
    }

    /// Resolves a logical `template_id` / filename (or explicit `.qcow2` path) against the active `templates_dir`.
    pub async fn resolve_template_backing_path(&self, id_or_path: &str) -> Result<PathBuf, String> {
        let ready_paths = self.storage.require_ready_paths().await?;
        resolve_template_in_dir(&ready_paths.templates_dir, id_or_path)
    }

    /// Instantiates an instant Copy-on-Write (`qcow2 -b <backing_file> -F qcow2`) per-node overlay disk
    /// inside a project's `overlays/` folder.
    pub async fn create_node_overlay(&self, req: CreateOverlayRequest) -> Result<DiskInfo, String> {
        let ready_paths = self.storage.require_ready_paths().await?;
        let backing_path =
            resolve_template_in_dir(&ready_paths.templates_dir, &req.template_id_or_path)?;

        let overlays_dir = PathBuf::from(&req.overlays_dir);
        if let Err(unmounted) =
            crate::storage::verify_volume_mounted_under(Path::new("/Volumes"), &overlays_dir)
        {
            return Err(format!(
                "Project volume '{}' is not mounted ({})",
                unmounted.volume_name, unmounted.expected_path
            ));
        }

        fs::create_dir_all(&overlays_dir).map_err(|e| {
            format!(
                "Failed to create project overlays directory {}: {e}",
                overlays_dir.display()
            )
        })?;

        let safe_node = sanitize_node_filename(&req.node_id);
        let overlay_path = overlays_dir.join(format!("{safe_node}.qcow2"));
        self.assert_not_template_path(&ready_paths.templates_dir, &overlay_path)?;

        let args = vec![
            "create".to_string(),
            "-f".to_string(),
            "qcow2".to_string(),
            "-b".to_string(),
            backing_path.display().to_string(),
            "-F".to_string(),
            "qcow2".to_string(),
            overlay_path.display().to_string(),
        ];
        self.run_qemu_img(&args).await?;
        self.inspect_disk(&overlay_path).await
    }

    /// Portable `qcow2` Backing-File Auto-Rebase:
    /// Inspects `<overlay.qcow2>` with `qemu-img info --output=json`. If its recorded `backing-filename`
    /// differs from `<active_templates_dir>/<template_filename>`, automatically runs:
    /// `qemu-img rebase -u -b <resolved_template_path> -F qcow2 <overlay_path>`.
    pub async fn ensure_overlay_rebased(
        &self,
        overlay_path: &Path,
        logical_template_id: Option<&str>,
    ) -> Result<OverlayRebaseReport, String> {
        if !overlay_path.is_file() {
            return Err(format!(
                "Overlay disk does not exist: {}",
                overlay_path.display()
            ));
        }

        let ready_paths = self.storage.require_ready_paths().await?;
        let templates_dir = &ready_paths.templates_dir;
        let disk_info = self.inspect_disk(overlay_path).await?;

        let candidate_template_ref: Option<String> = logical_template_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                disk_info
                    .backing_file
                    .as_deref()
                    .and_then(|bf| Path::new(bf).file_name())
                    .and_then(|os| os.to_str())
                    .map(ToOwned::to_owned)
            });

        let Some(template_ref) = candidate_template_ref else {
            return Ok(OverlayRebaseReport {
                overlay_path: overlay_path.display().to_string(),
                rebased: false,
                previous_backing: None,
                active_backing: None,
                resolved_template_filename: None,
            });
        };

        let resolved_template = resolve_template_in_dir(templates_dir, &template_ref)?;
        let resolved_filename = resolved_template
            .file_name()
            .and_then(|s| s.to_str())
            .map(ToOwned::to_owned);

        let needs_rebase = match disk_info.backing_file.as_deref() {
            None => true,
            Some(recorded) => !backing_paths_match(Path::new(recorded), &resolved_template),
        };

        if !needs_rebase {
            return Ok(OverlayRebaseReport {
                overlay_path: overlay_path.display().to_string(),
                rebased: false,
                previous_backing: disk_info.backing_file.clone(),
                active_backing: Some(resolved_template.display().to_string()),
                resolved_template_filename: resolved_filename,
            });
        }

        let args = vec![
            "rebase".to_string(),
            "-u".to_string(),
            "-b".to_string(),
            resolved_template.display().to_string(),
            "-F".to_string(),
            "qcow2".to_string(),
            overlay_path.display().to_string(),
        ];
        self.run_qemu_img(&args).await?;

        Ok(OverlayRebaseReport {
            overlay_path: overlay_path.display().to_string(),
            rebased: true,
            previous_backing: disk_info.backing_file,
            active_backing: Some(resolved_template.display().to_string()),
            resolved_template_filename: resolved_filename,
        })
    }

    /// Batch-rebases all node overlays in a `.etherloom` project on project load.
    pub async fn rebase_project_overlays(
        &self,
        bindings: Vec<OverlayTemplateBinding>,
    ) -> Result<Vec<OverlayRebaseReport>, String> {
        let mut reports = Vec::with_capacity(bindings.len());
        for item in bindings {
            let path = PathBuf::from(&item.overlay_path);
            if !path.exists() {
                continue;
            }
            let report = self
                .ensure_overlay_rebased(&path, item.template_id.as_deref())
                .await?;
            reports.push(report);
        }
        Ok(reports)
    }

    /// Wipes / resets a node disk:
    /// - If backed by a base template, deletes and recreates a fresh CoW overlay pointing to the active template.
    /// - If standalone, recreates a clean blank `.qcow2` of identical virtual size.
    pub async fn reset_node_overlay(&self, req: ResetOverlayRequest) -> Result<DiskInfo, String> {
        let ready_paths = self.storage.require_ready_paths().await?;
        let overlay_path = PathBuf::from(&req.overlay_path);
        self.assert_not_template_path(&ready_paths.templates_dir, &overlay_path)?;

        if !overlay_path.exists() {
            if let Some(ref override_tpl) = req.backing_template_override {
                let backing = resolve_template_in_dir(&ready_paths.templates_dir, override_tpl)?;
                if let Some(parent) = overlay_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let args = vec![
                    "create".to_string(),
                    "-f".to_string(),
                    "qcow2".to_string(),
                    "-b".to_string(),
                    backing.display().to_string(),
                    "-F".to_string(),
                    "qcow2".to_string(),
                    overlay_path.display().to_string(),
                ];
                self.run_qemu_img(&args).await?;
                return self.inspect_disk(&overlay_path).await;
            }
            return Err(format!(
                "Node overlay disk does not exist: {}",
                overlay_path.display()
            ));
        }

        let current_info = self.inspect_disk(&overlay_path).await?;
        if current_info.read_only {
            return Err(format!(
                "Refusing to wipe read-only disk image: {}",
                overlay_path.display()
            ));
        }

        let backing_target = match req.backing_template_override {
            Some(ref tpl) => Some(resolve_template_in_dir(&ready_paths.templates_dir, tpl)?),
            None => match current_info.backing_file.as_deref() {
                Some(recorded) => {
                    let recorded_path = PathBuf::from(recorded);
                    if recorded_path.is_file() {
                        Some(recorded_path)
                    } else if let Some(fname) = recorded_path.file_name().and_then(|s| s.to_str()) {
                        Some(resolve_template_in_dir(&ready_paths.templates_dir, fname)?)
                    } else {
                        None
                    }
                }
                None => None,
            },
        };

        fs::remove_file(&overlay_path).map_err(|e| {
            format!(
                "Failed to remove old node disk {}: {e}",
                overlay_path.display()
            )
        })?;

        if let Some(backing) = backing_target {
            let args = vec![
                "create".to_string(),
                "-f".to_string(),
                "qcow2".to_string(),
                "-b".to_string(),
                backing.display().to_string(),
                "-F".to_string(),
                "qcow2".to_string(),
                overlay_path.display().to_string(),
            ];
            self.run_qemu_img(&args).await?;
        } else {
            let bytes = current_info.virtual_size_bytes.max(1024 * 1024 * 1024);
            let args = vec![
                "create".to_string(),
                "-f".to_string(),
                "qcow2".to_string(),
                overlay_path.display().to_string(),
                bytes.to_string(),
            ];
            self.run_qemu_img(&args).await?;
        }

        self.inspect_disk(&overlay_path).await
    }

    /// Lists all Golden Image base templates in the active `templates_dir`.
    /// Returns an empty list gracefully if the external volume is currently disconnected.
    pub async fn list_templates(&self) -> Result<Vec<BaseTemplateInfo>, String> {
        let ready_paths = match self.storage.require_ready_paths().await {
            Ok(p) => p,
            Err(_) => return Ok(Vec::new()),
        };
        let templates_dir = ready_paths.templates_dir;
        let entries = fs::read_dir(&templates_dir)
            .map_err(|e| format!("Failed to read {}: {e}", templates_dir.display()))?;

        let mut templates = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("qcow2") {
                continue;
            }
            let stem = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let manifest_path = templates_dir.join(format!("{stem}.template.json"));
            if manifest_path.is_file() {
                if let Ok(raw) = fs::read_to_string(&manifest_path) {
                    if let Ok(mut parsed) = serde_json::from_str::<BaseTemplateInfo>(&raw) {
                        parsed.path = path.display().to_string();
                        templates.push(parsed);
                        continue;
                    }
                }
            }

            let disk = self.inspect_disk(&path).await?;
            let meta = fs::metadata(&path).ok();
            let created_at_ms = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let (inferred_profile_id, inferred_name) = infer_profile_from_stem(&stem);
            let prof = find_os_profile(inferred_profile_id);
            let inferred_arch = if stem.contains("x86_64") || stem.contains("amd64") {
                GuestArch::X86_64
            } else if stem.contains("i386") || stem.contains("i686") {
                GuestArch::I386
            } else if stem.contains("riscv64") {
                GuestArch::Riscv64
            } else {
                prof.as_ref().map(|p| p.arch).unwrap_or(GuestArch::Aarch64)
            };

            templates.push(BaseTemplateInfo {
                id: stem.clone(),
                name: inferred_name,
                os_profile_id: inferred_profile_id.to_string(),
                arch: inferred_arch,
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
                path: path.display().to_string(),
                filename: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string(),
                virtual_size_bytes: disk.virtual_size_bytes,
                actual_size_bytes: disk.actual_size_bytes,
                read_only: disk.read_only,
                created_at_ms,
                description: Some("Discovered qcow2 base template".to_string()),
            });
        }

        templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(templates)
    }

    /// Lists `.iso` and `.img` installer media inside the active `isos_dir`.
    pub async fn list_isos(&self) -> Result<Vec<InstallerMediaInfo>, String> {
        let ready_paths = match self.storage.require_ready_paths().await {
            Ok(p) => p,
            Err(_) => return Ok(Vec::new()),
        };
        let isos_dir = ready_paths.isos_dir;
        let entries = fs::read_dir(&isos_dir)
            .map_err(|e| format!("Failed to read {}: {e}", isos_dir.display()))?;

        let mut media = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            let media_kind = match ext.as_deref() {
                Some("iso") => "iso",
                Some("img") | Some("raw") => "img",
                _ => continue,
            };

            if let Ok(meta) = fs::metadata(&path) {
                if !meta.is_file() {
                    continue;
                }
                let modified_at_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                media.push(InstallerMediaInfo {
                    filename: path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    path: path.display().to_string(),
                    size_bytes: meta.len(),
                    media_kind: media_kind.to_string(),
                    modified_at_ms,
                });
            }
        }

        media.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
        Ok(media)
    }

    /// Scans saved `*.etherloom` project bundles inside active `workspaces_dir` and returns the names
    /// of any projects whose `topology.toml` references `template_stem` (or `template_stem.qcow2`).
    pub async fn find_referencing_projects(&self, template_stem: &str) -> Vec<String> {
        let ready_paths = match self.storage.require_ready_paths().await {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        let ws_dir = ready_paths.workspaces_dir;
        let Ok(entries) = fs::read_dir(&ws_dir) else {
            return Vec::new();
        };

        let stem = template_stem.trim_end_matches(".qcow2");
        let with_ext = format!("{stem}.qcow2");
        let mut refs = Vec::new();

        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let topo_file = p.join("topology.toml");
            if !topo_file.is_file() {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&topo_file) {
                if let Ok(doc) = toml::from_str::<crate::workspace::TopologyDocument>(&raw) {
                    let matched = doc.nodes.iter().any(|n| {
                        n.template_id
                            .as_deref()
                            .map(|tid| tid == stem || tid == with_ext)
                            .unwrap_or(false)
                    });
                    if matched {
                        refs.push(doc.name);
                    }
                }
            }
        }
        refs.sort();
        refs.dedup();
        refs
    }

    fn assert_not_template_path(&self, tpl_dir: &Path, candidate: &Path) -> Result<(), String> {
        if let (Ok(canon_tpl), Ok(canon_cand)) =
            (fs::canonicalize(tpl_dir), fs::canonicalize(candidate))
        {
            if canon_cand.starts_with(&canon_tpl) {
                return Err(format!(
                    "Refusing destructive operation inside read-only templates directory: {}",
                    canon_cand.display()
                ));
            }
        } else if candidate.starts_with(tpl_dir) {
            return Err(format!(
                "Refusing destructive operation inside templates directory: {}",
                candidate.display()
            ));
        }
        Ok(())
    }
}

fn resolve_template_in_dir(templates_dir: &Path, id_or_path: &str) -> Result<PathBuf, String> {
    let direct = PathBuf::from(id_or_path);
    if direct.is_absolute() && direct.is_file() {
        return fs::canonicalize(&direct)
            .map_err(|e| format!("Failed to canonicalize {}: {e}", direct.display()));
    }

    let file_part = if direct.is_absolute() {
        direct
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(id_or_path)
    } else {
        id_or_path
    };

    let filename = if file_part.ends_with(".qcow2") {
        file_part.to_string()
    } else {
        format!("{file_part}.qcow2")
    };

    let candidate = templates_dir.join(&filename);
    if candidate.is_file() {
        return fs::canonicalize(&candidate)
            .map_err(|e| format!("Failed to canonicalize {}: {e}", candidate.display()));
    }

    Err(format!(
        "Base template '{id_or_path}' not found in active templates directory {}",
        templates_dir.display()
    ))
}

fn backing_paths_match(recorded: &Path, resolved_active: &Path) -> bool {
    if recorded == resolved_active {
        return true;
    }
    match (fs::canonicalize(recorded), fs::canonicalize(resolved_active)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

pub(crate) fn slugify_name(input: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in input.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if (ch == '-' || ch == '_' || ch.is_whitespace() || ch == '.')
            && !prev_dash
            && !slug.is_empty()
        {
            slug.push('-');
            prev_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

fn sanitize_node_filename(node_id: &str) -> String {
    let cleaned: String = node_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "node".to_string()
    } else {
        cleaned
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{StorageMigrationMode, UpdateStorageRequest};

    #[test]
    fn os_profiles_match_multi_arch_and_nic_conventions() {
        let profiles = builtin_os_profiles();
        assert_eq!(profiles.len(), 15);

        let alpine = profiles.iter().find(|p| p.id == "alpine-linux").unwrap();
        assert_eq!(alpine.default_ram_mb, 256);
        assert_eq!(alpine.format_nic(0), "eth0");

        let debian = profiles.iter().find(|p| p.id == "debian-linux").unwrap();
        assert_eq!(debian.default_ram_mb, 512);
        assert_eq!(debian.nic_naming_pattern, "enp0s{n} / eth{n}");

        let freebsd = profiles.iter().find(|p| p.id == "freebsd").unwrap();
        assert_eq!(freebsd.default_ram_mb, 512);
        assert_eq!(freebsd.format_nic(1), "vtnet1");
        assert_eq!(freebsd.format_nic_for_model(NicModel::E1000, 0), "em0");

        let openbsd = profiles.iter().find(|p| p.id == "openbsd").unwrap();
        assert_eq!(openbsd.default_ram_mb, 512);
        assert_eq!(openbsd.format_nic(2), "vio2");
        assert_eq!(openbsd.format_nic_for_model(NicModel::E1000, 1), "em1");

        let netbsd = profiles.iter().find(|p| p.id == "netbsd").unwrap();
        assert_eq!(netbsd.default_ram_mb, 256);
        assert_eq!(netbsd.format_nic(0), "vioif0");
        assert_eq!(netbsd.format_nic_for_model(NicModel::E1000, 0), "wm0");

        let chr = profiles.iter().find(|p| p.id == "mikrotik-chr").unwrap();
        assert_eq!(chr.format_nic(0), "ether1");
        assert_eq!(chr.format_nic(1), "ether2");

        let plan9 = profiles.iter().find(|p| p.id == "9front").unwrap();
        assert_eq!(plan9.format_nic(0), "/net/ether0");

        let opnsense = profiles.iter().find(|p| p.id == "opnsense").unwrap();
        assert_eq!(opnsense.arch, GuestArch::X86_64);
        assert_eq!(opnsense.format_nic(0), "em0");
        assert_eq!(
            opnsense.format_nic_for_model(NicModel::VirtioNetPci, 0),
            "vtnet0"
        );

        let omnios = profiles.iter().find(|p| p.id == "omnios").unwrap();
        assert_eq!(omnios.format_nic(0), "e1000g0");

        let haiku = profiles.iter().find(|p| p.id == "haiku").unwrap();
        assert_eq!(haiku.format_nic(0), "/dev/net/ipro1000/0");

        let freedos = profiles.iter().find(|p| p.id == "freedos").unwrap();
        assert_eq!(freedos.arch, GuestArch::I386);
        assert_eq!(freedos.default_ram_mb, 32);
        assert_eq!(freedos.format_nic(0), "PCNTPK 0x60");
    }

    #[test]
    fn prepare_library_sh_template_stems_infer_accurate_os_profiles() {
        assert_eq!(infer_profile_from_stem("alpine-aarch64-base").0, "alpine-linux");
        assert_eq!(infer_profile_from_stem("freebsd-aarch64-base").0, "freebsd");
        assert_eq!(infer_profile_from_stem("netbsd-aarch64-base").0, "netbsd");
        assert_eq!(infer_profile_from_stem("openbsd-aarch64-base").0, "openbsd");
        assert_eq!(infer_profile_from_stem("opnsense-x86_64-base").0, "opnsense");
        assert_eq!(infer_profile_from_stem("freedos-i386-base").0, "freedos");
    }

    #[tokio::test]
    async fn image_store_initializes_directories_and_protects_templates() {
        let tmp = std::env::temp_dir().join(format!("etherloom-img-test-{}", Uuid::new_v4()));
        let storage = StorageManager::new(tmp.join("AppSupport"), tmp.join("FakeVolumes"));
        let snap = storage.refresh_and_snapshot().await;
        let store = ImageStore::new(storage);

        let tpl_dir = PathBuf::from(&snap.resolved_templates_dir);
        assert!(tpl_dir.is_dir());
        assert!(Path::new(&snap.resolved_isos_dir).is_dir());

        let protected_target = tpl_dir.join("golden.qcow2");
        assert!(store
            .assert_not_template_path(&tpl_dir, &protected_target)
            .is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn portable_qcow2_auto_rebases_when_templates_move_to_external_drive() {
        let tmp = std::env::temp_dir().join(format!("etherloom-rebase-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        let mock_qemu_img = tmp.join("mock-qemu-img");
        let script = r#"#!/usr/bin/env python3
import json, os, sys

args = sys.argv[1:]
cmd = args[0]

if cmd == "info":
    target = args[-1]
    with open(target, "r", encoding="utf-8") as f:
        meta = json.load(f)
    out = {
        "format": "qcow2",
        "virtual-size": meta.get("virtual_size", 8589934592),
        "actual-size": os.path.getsize(target),
    }
    if meta.get("backing"):
        out["backing-filename"] = meta["backing"]
    print(json.dumps(out))
elif cmd == "create":
    backing = None
    if "-b" in args:
        b_idx = args.index("-b")
        backing = args[b_idx + 1]
    target = args[-1] if "-b" in args else args[-2]
    with open(target, "w", encoding="utf-8") as f:
        json.dump({"backing": backing, "virtual_size": 8589934592}, f)
elif cmd == "rebase":
    unsafe_mode = "-u" in args
    b_idx = args.index("-b")
    new_backing = args[b_idx + 1]
    target = args[-1]
    with open(target, "r", encoding="utf-8") as f:
        meta = json.load(f)
    old_backing = meta.get("backing")
    if not unsafe_mode and old_backing and not os.path.exists(old_backing):
        sys.stderr.write(f"Could not open old backing file '{old_backing}' without -u\n")
        sys.exit(1)
    meta["backing"] = new_backing
    with open(target, "w", encoding="utf-8") as f:
        json.dump(meta, f)
else:
    sys.exit(2)
"#;
        fs::write(&mock_qemu_img, script).unwrap();
        let mut perms = fs::metadata(&mock_qemu_img).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&mock_qemu_img, perms).unwrap();

        let storage = StorageManager::new(tmp.join("AppSupport"), tmp.join("FakeVolumes"));
        let initial_snap = storage.refresh_and_snapshot().await;
        let store = ImageStore::with_qemu_img_binary(storage.clone(), mock_qemu_img);

        let old_tpl_path =
            PathBuf::from(&initial_snap.resolved_templates_dir).join("openbsd-76.qcow2");
        fs::write(&old_tpl_path, r#"{"virtual_size": 8589934592}"#).unwrap();
        let canon_old_tpl = fs::canonicalize(&old_tpl_path).unwrap();

        let project_overlays = tmp.join("campus-lab.etherloom/overlays");
        let overlay = store
            .create_node_overlay(CreateOverlayRequest {
                template_id_or_path: "openbsd-76".to_string(),
                overlays_dir: project_overlays.display().to_string(),
                node_id: "fw1".to_string(),
            })
            .await
            .unwrap();
        let overlay_path = PathBuf::from(&overlay.path);
        assert!(overlay
            .backing_file
            .as_ref()
            .unwrap()
            .ends_with("openbsd-76.qcow2"));

        let external_ssd_root = tmp.join("MountedExternalSSD/EtherloomLibrary");
        storage
            .update_storage_location(UpdateStorageRequest {
                storage_root: external_ssd_root.display().to_string(),
                templates_dir_override: None,
                isos_dir_override: None,
                workspaces_dir_override: None,
                mode: StorageMigrationMode::MoveExistingData,
                delete_source_after_verify: true,
            })
            .await
            .unwrap();
        assert!(!old_tpl_path.exists(), "old internal template was removed");

        let stale_info = store.inspect_disk(&overlay_path).await.unwrap();
        assert_eq!(
            PathBuf::from(stale_info.backing_file.unwrap()),
            canon_old_tpl
        );

        let report = store
            .ensure_overlay_rebased(&overlay_path, Some("openbsd-76"))
            .await
            .unwrap();
        assert!(
            report.rebased,
            "overlay should be auto-rebased via qemu-img rebase -u"
        );

        let expected_new_tpl =
            fs::canonicalize(external_ssd_root.join("templates/openbsd-76.qcow2")).unwrap();
        assert_eq!(
            PathBuf::from(report.active_backing.unwrap()),
            expected_new_tpl
        );

        let second = store
            .ensure_overlay_rebased(&overlay_path, Some("openbsd-76"))
            .await
            .unwrap();
        assert!(!second.rebased);

        let _ = fs::remove_dir_all(&tmp);
    }
}
