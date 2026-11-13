use crate::env_doctor::{resolve_edk2_for_arch, resolve_qemu_for_arch};
use crate::fabric::{PacketFabric, UdpPortBinding};
use crate::images::ImageStore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::Command;
use tokio::sync::{oneshot, RwLock};
use tokio::time::timeout;

pub(crate) const RUNTIME_SOCKET_DIR: &str = "/tmp/etherloom";
const QMP_CONNECT_TIMEOUT: Duration = Duration::from_millis(1200);
const DEFAULT_POWERDOWN_TIMEOUT: Duration = Duration::from_millis(4500);
const SIGTERM_GRACE_TIMEOUT: Duration = Duration::from_millis(1800);

/// Guest CPU / machine architecture supported by Etherloom's QEMU engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GuestArch {
    #[serde(rename = "aarch64")]
    Aarch64,
    #[serde(rename = "x86_64")]
    X86_64,
    #[serde(rename = "i386")]
    I386,
    #[serde(rename = "riscv64")]
    Riscv64,
}

impl Default for GuestArch {
    fn default() -> Self {
        Self::Aarch64
    }
}

impl GuestArch {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Aarch64 => "aarch64",
            Self::X86_64 => "x86_64",
            Self::I386 => "i386",
            Self::Riscv64 => "riscv64",
        }
    }

    pub fn qemu_binary_name(&self) -> &'static str {
        match self {
            Self::Aarch64 => "qemu-system-aarch64",
            Self::X86_64 => "qemu-system-x86_64",
            Self::I386 => "qemu-system-i386",
            Self::Riscv64 => "qemu-system-riscv64",
        }
    }

    pub fn from_str_lossy(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "x86_64" | "amd64" => Self::X86_64,
            "i386" | "i686" | "x86" => Self::I386,
            "riscv64" | "riscv" => Self::Riscv64,
            _ => Self::Aarch64,
        }
    }

    /// Returns `"hvf"` when guest arch matches host Mac CPU architecture and HVF is supported, else `"tcg"`.
    pub fn effective_accel(&self, host_arch: &str, hvf_available: bool) -> &'static str {
        if !hvf_available {
            return "tcg";
        }
        match (self, host_arch) {
            (Self::Aarch64, "aarch64") => "hvf",
            (Self::X86_64, "x86_64") => "hvf",
            _ => "tcg",
        }
    }
}

/// Emulated PCI/PCIe Ethernet controller model attached to QEMU `-netdev socket`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum NicModel {
    /// Paravirtualized VirtIO 1.0 NIC (`eth*` / `enp*` / `vtnet*` / `vio*` / `vioif*` / `ether*`)
    #[serde(rename = "virtio-net-pci")]
    VirtioNetPci,
    /// Intel PRO/1000 Gigabit Ethernet (`em*` / `wm*` / `e1000g*` / `ipro1000`)
    #[serde(rename = "e1000")]
    E1000,
    /// Realtek RTL8139 Fast Ethernet (`re*` / `rl*` / `rtk*`)
    #[serde(rename = "rtl8139")]
    Rtl8139,
    /// AMD PCnet-PCI II Am79C970A (`pcn*` / `le*` / FreeDOS `PCNTPK`)
    #[serde(rename = "pcnet")]
    Pcnet,
    /// Classic NE2000 PCI (`ne*` / `ed*` — classic UNIX, Minix, retro BSDs)
    #[serde(rename = "ne2k_pci")]
    Ne2kPci,
}

impl Default for NicModel {
    fn default() -> Self {
        Self::VirtioNetPci
    }
}

impl NicModel {
    pub fn as_qemu_device(&self) -> &'static str {
        match self {
            Self::VirtioNetPci => "virtio-net-pci",
            Self::E1000 => "e1000",
            Self::Rtl8139 => "rtl8139",
            Self::Pcnet => "pcnet",
            Self::Ne2kPci => "ne2k_pci",
        }
    }

    pub fn from_str_lossy(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "e1000" => Self::E1000,
            "rtl8139" => Self::Rtl8139,
            "pcnet" => Self::Pcnet,
            "ne2k_pci" | "ne2k-pci" | "ne2000" => Self::Ne2kPci,
            _ => Self::VirtioNetPci,
        }
    }
}

/// System boot firmware mode (`uefi` EDK2 vs legacy `bios` SeaBIOS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FirmwareType {
    /// EDK2 UEFI firmware (`edk2-aarch64-code.fd` or `edk2-x86_64-code.fd`)
    Uefi,
    /// Legacy x86/i386 SeaBIOS (built into QEMU; omits `-bios`)
    Bios,
}

impl Default for FirmwareType {
    fn default() -> Self {
        Self::Uefi
    }
}

impl FirmwareType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Uefi => "uefi",
            Self::Bios => "bios",
        }
    }

    pub fn from_str_lossy(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "bios" | "seabios" | "legacy" => Self::Bios,
            _ => Self::Uefi,
        }
    }
}

/// Primary block controller bus for the VM's `.qcow2` disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DiskBus {
    #[serde(rename = "virtio-blk")]
    VirtioBlk,
    #[serde(rename = "ahci")]
    Ahci,
    #[serde(rename = "ide")]
    Ide,
}

impl Default for DiskBus {
    fn default() -> Self {
        Self::VirtioBlk
    }
}

impl DiskBus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::VirtioBlk => "virtio-blk",
            Self::Ahci => "ahci",
            Self::Ide => "ide",
        }
    }

    pub fn from_str_lossy(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "ahci" | "sata" => Self::Ahci,
            "ide" | "ata" => Self::Ide,
            _ => Self::VirtioBlk,
        }
    }
}

/// Graphical UEFI/VGA framebuffer output mode per VM node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VmDisplayMode {
    /// `-vnc 127.0.0.1:{vnc_port_offset}` (TCP port `5900 + offset`)
    Vnc,
    /// Native macOS Cocoa window (`-display cocoa`)
    Cocoa,
}

impl Default for VmDisplayMode {
    fn default() -> Self {
        Self::Vnc
    }
}

/// Optional installer boot media attachment mode (`.iso` CD-ROM or `.img` USB stick).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootMediaBus {
    /// Automatically chooses `Cdrom` for `.iso` and `Usb` for `.img`/`.raw`
    Auto,
    /// `virtio-scsi-pci` + `scsi-cd` (or AHCI/IDE ATAPI CD-ROM when `disk_bus` is `ahci`/`ide`)
    Cdrom,
    /// `usb-storage` attached to `qemu-xhci` (ideal for OpenBSD `installXX.img` & memstick `.img`)
    Usb,
}

impl Default for BootMediaBus {
    fn default() -> Self {
        Self::Auto
    }
}

/// Lifecycle state of a supervised QEMU VM instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VmStatus {
    Starting,
    Running,
    Stopping,
    Stopped,
    Crashed,
}

/// Optional hook for 1-click Guided Template Setup VMs (e.g. OpenBSD, pfSense, VyOS):
/// when the installer VM shuts down cleanly, Etherloom marks the newly installed disk read-only (`0444`)
/// and writes its `.template.json` manifest inside `templates_dir`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeTemplateOnExit {
    pub catalog_id: String,
    pub template_id: String,
    pub template_name: String,
    pub os_profile_id: String,
    #[serde(default)]
    pub arch: GuestArch,
    #[serde(default)]
    pub default_nic_model: NicModel,
    #[serde(default)]
    pub default_firmware: FirmwareType,
    #[serde(default)]
    pub default_disk_bus: DiskBus,
    #[serde(default)]
    pub description: Option<String>,
}

/// NIC specification passed when launching a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNicConfig {
    /// Optional fabric port ID (if omitted, `PacketFabric` allocates `{node_id}-net{index}`).
    pub port_id: Option<String>,
    /// MAC address (e.g. `52:54:00:10:01:00`).
    pub mac: String,
    /// Optional per-NIC model override; defaults to the node's `nic_model` (`virtio-net-pci`).
    #[serde(default)]
    pub nic_model: Option<NicModel>,
    /// Optional pre-allocated `PacketFabric` UDP port; if `None`, allocated automatically.
    pub fabric_port: Option<u16>,
    /// Optional pre-allocated guest `localaddr` UDP port; if `None`, allocated automatically.
    pub vm_port: Option<u16>,
}

/// Resolved NIC binding on a running VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveVmNic {
    pub index: usize,
    pub port_id: String,
    pub mac: String,
    #[serde(default)]
    pub nic_model: NicModel,
    pub fabric_port: u16,
    pub vm_port: u16,
}

/// Request payload to spawn a QEMU VM (`aarch64`, `x86_64`, `i386`, or `riscv64`) for a topology node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnVmRequest {
    pub node_id: String,
    pub name: String,
    pub cpus: u8,
    pub ram_mb: u32,
    pub disk_path: String,
    /// Optional logical `template_id` / filename so `spawn_vm` auto-rebases relocated CoW overlays before boot.
    pub template_id: Option<String>,
    pub boot_media_path: Option<String>,
    #[serde(default)]
    pub boot_media_bus: BootMediaBus,
    #[serde(default)]
    pub display_mode: VmDisplayMode,
    pub vnc_port_offset: Option<u16>,
    #[serde(default)]
    pub arch: GuestArch,
    #[serde(default)]
    pub nic_model: NicModel,
    #[serde(default)]
    pub firmware: FirmwareType,
    #[serde(default)]
    pub disk_bus: DiskBus,
    pub nics: Vec<VmNicConfig>,
    pub bios_path_override: Option<String>,
    #[serde(default)]
    pub finalize_template_on_exit: Option<FinalizeTemplateOnExit>,
}

/// Public snapshot of a VM instance returned via IPC and lifecycle events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmInstanceInfo {
    pub node_id: String,
    pub name: String,
    pub status: VmStatus,
    pub pid: Option<u32>,
    pub cpus: u8,
    pub ram_mb: u32,
    #[serde(default)]
    pub arch: GuestArch,
    #[serde(default)]
    pub nic_model: NicModel,
    #[serde(default)]
    pub firmware: FirmwareType,
    #[serde(default)]
    pub disk_bus: DiskBus,
    #[serde(default)]
    pub accel: String,
    pub disk_path: String,
    pub boot_media_path: Option<String>,
    pub display_mode: VmDisplayMode,
    pub vnc_port_offset: Option<u16>,
    pub vnc_tcp_port: Option<u16>,
    pub serial_socket_path: String,
    pub qmp_socket_path: String,
    pub nics: Vec<ActiveVmNic>,
    pub qemu_args: Vec<String>,
    pub started_at_ms: u64,
    pub exit_code: Option<i32>,
}

/// Typed Tauri event emitted on `"etherloom://vm-state"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmStateEvent {
    pub node_id: String,
    pub status: VmStatus,
    pub pid: Option<u32>,
    pub vnc_tcp_port: Option<u16>,
    pub serial_socket_path: String,
    pub message: Option<String>,
    pub timestamp_ms: u64,
}

/// Complete resolved specification fed into pure function `build_qemu_args`.
#[derive(Debug, Clone)]
pub struct ResolvedVmLaunchSpec {
    pub node_id: String,
    pub name: String,
    pub cpus: u8,
    pub ram_mb: u32,
    pub arch: GuestArch,
    pub host_arch: String,
    pub hvf_available: bool,
    pub firmware: FirmwareType,
    pub disk_bus: DiskBus,
    pub bios_path: Option<PathBuf>,
    pub disk_path: PathBuf,
    pub boot_media: Option<(PathBuf, BootMediaBus)>,
    pub display_mode: VmDisplayMode,
    pub vnc_port_offset: Option<u16>,
    pub serial_socket_path: PathBuf,
    pub qmp_socket_path: PathBuf,
    pub nics: Vec<ActiveVmNic>,
}

/// Pure function constructing deterministic multi-architecture QEMU CLI arguments (`aarch64`, `x86_64`, `i386`, `riscv64`)
/// according to `ARCHITECTURE.md`.
pub fn build_qemu_args(spec: &ResolvedVmLaunchSpec) -> Vec<String> {
    let mut args = vec!["-name".to_string(), spec.name.clone()];

    // 1. Machine type, hardware acceleration (HVF vs multi-threaded TCG), CPU model, SMP & RAM
    match spec.arch {
        GuestArch::Aarch64 => {
            args.extend(["-M".to_string(), "virt,highmem=on".to_string()]);
            if spec.host_arch == "aarch64" && spec.hvf_available {
                args.extend([
                    "-accel".to_string(),
                    "hvf".to_string(),
                    "-cpu".to_string(),
                    "host".to_string(),
                ]);
            } else {
                args.extend([
                    "-accel".to_string(),
                    "tcg,thread=multi".to_string(),
                    "-cpu".to_string(),
                    "max".to_string(),
                ]);
            }
        }
        GuestArch::X86_64 => {
            args.extend(["-M".to_string(), "q35".to_string()]);
            if spec.host_arch == "x86_64" && spec.hvf_available {
                args.extend([
                    "-accel".to_string(),
                    "hvf".to_string(),
                    "-cpu".to_string(),
                    "host".to_string(),
                ]);
            } else {
                args.extend([
                    "-accel".to_string(),
                    "tcg,thread=multi".to_string(),
                    "-cpu".to_string(),
                    "max".to_string(),
                ]);
            }
        }
        GuestArch::I386 => {
            args.extend([
                "-M".to_string(),
                "pc".to_string(),
                "-accel".to_string(),
                "tcg,thread=multi".to_string(),
                "-cpu".to_string(),
                "pentium3".to_string(),
            ]);
        }
        GuestArch::Riscv64 => {
            args.extend([
                "-M".to_string(),
                "virt".to_string(),
                "-accel".to_string(),
                "tcg,thread=multi".to_string(),
                "-cpu".to_string(),
                "rv64".to_string(),
            ]);
        }
    }

    args.extend([
        "-smp".to_string(),
        spec.cpus.max(1).to_string(),
        "-m".to_string(),
        spec.ram_mb.max(16).to_string(),
    ]);

    // 2. Firmware: emit `-bios <edk2-...>` for UEFI guests (or when explicitly supplied);
    //    omit `-bios` for SeaBIOS (`x86_64` / `i386` with `FirmwareType::Bios`) or OpenSBI (`riscv64`).
    let should_emit_bios = match (spec.arch, spec.firmware) {
        (GuestArch::Aarch64, _) => true,
        (GuestArch::X86_64, FirmwareType::Uefi) => true,
        (GuestArch::I386, FirmwareType::Uefi) => true,
        _ => false,
    };
    if should_emit_bios {
        if let Some(ref bios) = spec.bios_path {
            args.extend(["-bios".to_string(), bios.display().to_string()]);
        }
    }

    // 3. Display & USB input peripherals per guest architecture
    let mut has_xhci = false;
    match spec.arch {
        GuestArch::Aarch64 | GuestArch::Riscv64 => {
            args.extend([
                "-device".to_string(),
                "ramfb".to_string(),
                "-device".to_string(),
                "qemu-xhci".to_string(),
                "-device".to_string(),
                "usb-kbd".to_string(),
                "-device".to_string(),
                "usb-tablet".to_string(),
            ]);
            has_xhci = true;
        }
        GuestArch::X86_64 => {
            args.extend([
                "-vga".to_string(),
                "std".to_string(),
                "-device".to_string(),
                "qemu-xhci".to_string(),
                "-device".to_string(),
                "usb-kbd".to_string(),
                "-device".to_string(),
                "usb-tablet".to_string(),
            ]);
            has_xhci = true;
        }
        GuestArch::I386 => {
            args.extend(["-vga".to_string(), "std".to_string()]);
        }
    }

    match spec.display_mode {
        VmDisplayMode::Vnc => {
            let offset = spec.vnc_port_offset.unwrap_or(1);
            args.push("-vnc".to_string());
            args.push(format!("127.0.0.1:{offset}"));
        }
        VmDisplayMode::Cocoa => {
            args.push("-display".to_string());
            args.push("cocoa".to_string());
        }
    }

    // 4. Storage: optional AHCI controller if requested (`DiskBus::Ahci`, or `Ide` on `virt` boards lacking ISA IDE)
    let effective_disk_bus = match (spec.arch, spec.disk_bus) {
        (GuestArch::Aarch64 | GuestArch::Riscv64, DiskBus::Ide) => DiskBus::Ahci,
        (_, bus) => bus,
    };

    if effective_disk_bus == DiskBus::Ahci {
        args.extend(["-device".to_string(), "ahci,id=ahci0".to_string()]);
    }

    // Boot installer media (if attached) gets bootindex=1; primary qcow2 disk gets next bootindex
    let hd_bootindex = if let Some((ref media_path, bus_mode)) = spec.boot_media {
        let effective_bus = match bus_mode {
            BootMediaBus::Auto => {
                let is_iso = media_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("iso"))
                    .unwrap_or(false);
                if is_iso {
                    BootMediaBus::Cdrom
                } else {
                    BootMediaBus::Usb
                }
            }
            explicit => explicit,
        };

        match effective_bus {
            BootMediaBus::Cdrom => match effective_disk_bus {
                DiskBus::VirtioBlk => {
                    args.extend([
                        "-device".to_string(),
                        "virtio-scsi-pci,id=scsi0".to_string(),
                        "-drive".to_string(),
                        format!(
                            "file={},if=none,id=install0,format=raw,readonly=on,media=cdrom",
                            media_path.display()
                        ),
                        "-device".to_string(),
                        "scsi-cd,bus=scsi0.0,drive=install0,bootindex=1".to_string(),
                    ]);
                }
                DiskBus::Ahci => {
                    args.extend([
                        "-drive".to_string(),
                        format!(
                            "file={},if=none,id=install0,format=raw,readonly=on,media=cdrom",
                            media_path.display()
                        ),
                        "-device".to_string(),
                        "ide-cd,bus=ahci0.1,drive=install0,bootindex=1".to_string(),
                    ]);
                }
                DiskBus::Ide => {
                    args.extend([
                        "-drive".to_string(),
                        format!(
                            "file={},if=none,id=install0,format=raw,readonly=on,media=cdrom",
                            media_path.display()
                        ),
                        "-device".to_string(),
                        "ide-cd,bus=ide.1,drive=install0,bootindex=1".to_string(),
                    ]);
                }
            },
            BootMediaBus::Usb | BootMediaBus::Auto => {
                if !has_xhci {
                    args.extend(["-device".to_string(), "qemu-xhci".to_string()]);
                }
                args.extend([
                    "-drive".to_string(),
                    format!(
                        "file={},if=none,id=install0,format=raw,readonly=on",
                        media_path.display()
                    ),
                    "-device".to_string(),
                    "usb-storage,drive=install0,bootindex=1".to_string(),
                ]);
            }
        }
        2
    } else {
        1
    };

    args.extend([
        "-drive".to_string(),
        format!(
            "file={},if=none,id=hd0,format=qcow2",
            spec.disk_path.display()
        ),
    ]);
    match effective_disk_bus {
        DiskBus::VirtioBlk => {
            args.extend([
                "-device".to_string(),
                format!("virtio-blk-pci,drive=hd0,bootindex={hd_bootindex}"),
            ]);
        }
        DiskBus::Ahci => {
            args.extend([
                "-device".to_string(),
                format!("ide-hd,bus=ahci0.0,drive=hd0,bootindex={hd_bootindex}"),
            ]);
        }
        DiskBus::Ide => {
            args.extend([
                "-device".to_string(),
                format!("ide-hd,bus=ide.0,drive=hd0,bootindex={hd_bootindex}"),
            ]);
        }
    }

    // 5. Zero-Root UDP Socket Netdevs (raw Ethernet II frames per datagram, no length prefix)
    for nic in &spec.nics {
        let net_id = format!("net{}", nic.index);
        args.extend([
            "-netdev".to_string(),
            format!(
                "socket,id={net_id},udp=127.0.0.1:{},localaddr=127.0.0.1:{}",
                nic.fabric_port, nic.vm_port
            ),
            "-device".to_string(),
            format!(
                "{},netdev={net_id},mac={}",
                nic.nic_model.as_qemu_device(),
                nic.mac
            ),
        ]);
    }

    // 6. Unix Domain Socket Serial Console (`xterm.js` target)
    args.extend([
        "-chardev".to_string(),
        format!(
            "socket,id=serial0,path={},server=on,wait=off",
            spec.serial_socket_path.display()
        ),
        "-serial".to_string(),
        "chardev:serial0".to_string(),
    ]);

    // 7. Unix Domain Socket QMP Control Monitor (for graceful `system_powerdown`)
    args.extend([
        "-chardev".to_string(),
        format!(
            "socket,id=qmp0,path={},server=on,wait=off",
            spec.qmp_socket_path.display()
        ),
        "-mon".to_string(),
        "chardev=qmp0,mode=control".to_string(),
    ]);

    args
}

struct ManagedVmEntry {
    info: VmInstanceInfo,
    /// Created fabric UDP ports owned by this VM lifecycle so stopping cleans them up if auto-allocated
    owned_fabric_ports: Vec<String>,
    /// Notifies when the reaper task confirms process termination
    exit_rx: tokio::sync::watch::Receiver<bool>,
}

struct VmManagerInner {
    vms: RwLock<HashMap<String, ManagedVmEntry>>,
    /// Synchronous PID registry so `Drop` can terminate orphaned QEMU children even outside async context
    live_pids: StdMutex<HashMap<String, u32>>,
    reserved_vnc_offsets: StdMutex<HashSet<u16>>,
    app_handle: RwLock<Option<AppHandle>>,
}

/// Async supervisor managing `qemu-system-{aarch64,x86_64,i386,riscv64}` child processes per node ID / UUID.
#[derive(Clone)]
pub struct VmManager {
    inner: Arc<VmManagerInner>,
}

impl Default for VmManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for VmManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            if let Ok(mut map) = self.inner.live_pids.lock() {
                for (node_id, pid) in map.drain() {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                        libc::kill(pid as i32, libc::SIGKILL);
                    }
                    cleanup_node_sockets(&node_id);
                }
            }
        }
    }
}

impl VmManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(VmManagerInner {
                vms: RwLock::new(HashMap::new()),
                live_pids: StdMutex::new(HashMap::new()),
                reserved_vnc_offsets: StdMutex::new(HashSet::new()),
                app_handle: RwLock::new(None),
            }),
        }
    }

    pub async fn bind_app_handle(&self, handle: AppHandle) {
        let mut guard = self.inner.app_handle.write().await;
        *guard = Some(handle);
    }

    /// Previews the exact `qemu-system-{arch}` command line that `spawn_vm` would execute.
    pub fn preview_command(&self, req: &SpawnVmRequest) -> Result<Vec<String>, String> {
        let arch_str = req.arch.as_str();
        let qemu_bin = resolve_qemu_for_arch(arch_str).unwrap_or_else(|| {
            PathBuf::from(format!("/opt/homebrew/bin/{}", req.arch.qemu_binary_name()))
        });

        let bios_path = match req.bios_path_override {
            Some(ref p) if !p.trim().is_empty() => Some(PathBuf::from(p)),
            _ => match (req.arch, req.firmware) {
                (GuestArch::Aarch64, _) => Some(
                    resolve_edk2_for_arch("aarch64", Some(&qemu_bin)).unwrap_or_else(|| {
                        PathBuf::from("/opt/homebrew/share/qemu/edk2-aarch64-code.fd")
                    }),
                ),
                (GuestArch::X86_64, FirmwareType::Uefi) => Some(
                    resolve_edk2_for_arch("x86_64", Some(&qemu_bin)).unwrap_or_else(|| {
                        PathBuf::from("/opt/homebrew/share/qemu/edk2-x86_64-code.fd")
                    }),
                ),
                (GuestArch::I386, FirmwareType::Uefi) => {
                    resolve_edk2_for_arch("i386", Some(&qemu_bin))
                }
                _ => None,
            },
        };

        let safe_id = sanitize_socket_id(&req.node_id);
        let spec = ResolvedVmLaunchSpec {
            node_id: req.node_id.clone(),
            name: req.name.clone(),
            cpus: req.cpus,
            ram_mb: req.ram_mb,
            arch: req.arch,
            host_arch: env::consts::ARCH.to_string(),
            hvf_available: env::consts::OS == "macos",
            firmware: req.firmware,
            disk_bus: req.disk_bus,
            bios_path,
            disk_path: PathBuf::from(&req.disk_path),
            boot_media: req
                .boot_media_path
                .as_ref()
                .filter(|p| !p.trim().is_empty())
                .map(|p| (PathBuf::from(p), req.boot_media_bus)),
            display_mode: req.display_mode,
            vnc_port_offset: match req.display_mode {
                VmDisplayMode::Vnc => Some(req.vnc_port_offset.unwrap_or(1)),
                VmDisplayMode::Cocoa => None,
            },
            serial_socket_path: PathBuf::from(RUNTIME_SOCKET_DIR)
                .join(format!("{safe_id}_serial.sock")),
            qmp_socket_path: PathBuf::from(RUNTIME_SOCKET_DIR).join(format!("{safe_id}_qmp.sock")),
            nics: req
                .nics
                .iter()
                .enumerate()
                .map(|(idx, n)| ActiveVmNic {
                    index: idx,
                    port_id: n
                        .port_id
                        .clone()
                        .unwrap_or_else(|| format!("{safe_id}-net{idx}")),
                    mac: n.mac.clone(),
                    nic_model: n.nic_model.unwrap_or(req.nic_model),
                    fabric_port: n.fabric_port.unwrap_or(20000 + (idx as u16) * 2),
                    vm_port: n.vm_port.unwrap_or(20001 + (idx as u16) * 2),
                })
                .collect(),
        };

        let mut full = vec![qemu_bin.display().to_string()];
        full.extend(build_qemu_args(&spec));
        Ok(full)
    }

    /// Spawns a supervised `qemu-system-{arch}` child process for `req.node_id`,
    /// automatically rebasing the node's CoW `.qcow2` overlay if `templates_dir` moved.
    pub async fn spawn_vm(
        &self,
        req: SpawnVmRequest,
        fabric: &PacketFabric,
        image_store: &ImageStore,
    ) -> Result<VmInstanceInfo, String> {
        {
            let guard = self.inner.vms.read().await;
            if let Some(existing) = guard.get(&req.node_id) {
                if matches!(
                    existing.info.status,
                    VmStatus::Starting | VmStatus::Running | VmStatus::Stopping
                ) {
                    return Err(format!(
                        "VM '{}' is already active ({:?})",
                        req.node_id, existing.info.status
                    ));
                }
            }
        }

        let bin_name = req.arch.qemu_binary_name();
        let qemu_bin = resolve_qemu_for_arch(req.arch.as_str()).ok_or_else(|| {
            format!(
                "{bin_name} not found in /opt/homebrew/bin, /usr/local/bin, or PATH. Install QEMU via `brew install qemu`."
            )
        })?;

        let bios_path = match req.bios_path_override {
            Some(ref custom) if !custom.trim().is_empty() => {
                let p = PathBuf::from(custom);
                if !p.is_file() {
                    return Err(format!("Custom UEFI firmware not found: {}", p.display()));
                }
                Some(p)
            }
            _ => match (req.arch, req.firmware) {
                (GuestArch::Aarch64, _) => {
                    let p = resolve_edk2_for_arch("aarch64", Some(&qemu_bin)).ok_or_else(|| {
                        "UEFI firmware edk2-aarch64-code.fd not found in /opt/homebrew/share/qemu or /usr/local/share/qemu. Install QEMU via `brew install qemu`.".to_string()
                    })?;
                    Some(p)
                }
                (GuestArch::X86_64, FirmwareType::Uefi) => {
                    let p = resolve_edk2_for_arch("x86_64", Some(&qemu_bin)).ok_or_else(|| {
                        "UEFI firmware edk2-x86_64-code.fd not found in /opt/homebrew/share/qemu or /usr/local/share/qemu. Switch Firmware to 'SeaBIOS' or run `brew install qemu`.".to_string()
                    })?;
                    Some(p)
                }
                (GuestArch::I386, FirmwareType::Uefi) => {
                    resolve_edk2_for_arch("i386", Some(&qemu_bin))
                }
                _ => None,
            },
        };

        let disk_path = PathBuf::from(&req.disk_path);
        if !disk_path.is_file() {
            return Err(format!("VM disk file does not exist: {}", disk_path.display()));
        }

        // Portable qcow2 Auto-Rebase: ensure backing-filename points to active `templates_dir`
        // (Skipped when installing directly onto a fresh standalone template disk in Guided Setup mode.)
        if req.finalize_template_on_exit.is_none() {
            image_store
                .ensure_overlay_rebased(&disk_path, req.template_id.as_deref())
                .await?;
        }

        let boot_media = match req.boot_media_path {
            Some(ref m) if !m.trim().is_empty() => {
                let mp = PathBuf::from(m);
                if !mp.is_file() {
                    return Err(format!(
                        "Boot installer media file does not exist: {}",
                        mp.display()
                    ));
                }
                Some((mp, req.boot_media_bus))
            }
            _ => None,
        };

        ensure_socket_dir()?;
        let safe_id = sanitize_socket_id(&req.node_id);
        cleanup_node_sockets(&req.node_id);

        let serial_socket_path =
            PathBuf::from(RUNTIME_SOCKET_DIR).join(format!("{safe_id}_serial.sock"));
        let qmp_socket_path = PathBuf::from(RUNTIME_SOCKET_DIR).join(format!("{safe_id}_qmp.sock"));

        // Allocate VNC offset (`5900 + offset`) if running in Embedded VNC display mode
        let vnc_port_offset = match req.display_mode {
            VmDisplayMode::Vnc => Some(self.allocate_vnc_offset(req.vnc_port_offset)?),
            VmDisplayMode::Cocoa => None,
        };

        // Resolve or dynamically allocate UDP port pairs in PacketFabric for each NIC
        let mut active_nics = Vec::with_capacity(req.nics.len());
        let mut owned_fabric_ports: Vec<String> = Vec::new();
        for (idx, nic) in req.nics.iter().enumerate() {
            let effective_nic_model = nic.nic_model.unwrap_or(req.nic_model);
            match (nic.fabric_port, nic.vm_port) {
                (Some(fp), Some(vp)) => {
                    active_nics.push(ActiveVmNic {
                        index: idx,
                        port_id: nic
                            .port_id
                            .clone()
                            .unwrap_or_else(|| format!("{safe_id}-net{idx}")),
                        mac: nic.mac.clone(),
                        nic_model: effective_nic_model,
                        fabric_port: fp,
                        vm_port: vp,
                    });
                }
                _ => {
                    let desired_id = nic
                        .port_id
                        .clone()
                        .unwrap_or_else(|| format!("{safe_id}-net{idx}"));
                    if let Some(existing) = fabric.get_udp_port(&desired_id).await {
                        active_nics.push(ActiveVmNic {
                            index: idx,
                            port_id: existing.port_id,
                            mac: nic.mac.clone(),
                            nic_model: effective_nic_model,
                            fabric_port: existing.fabric_port,
                            vm_port: existing.vm_port,
                        });
                    } else {
                        let UdpPortBinding {
                            port_id,
                            fabric_port,
                            vm_port,
                        } = match fabric.create_udp_port(Some(desired_id), nic.vm_port).await {
                            Ok(binding) => binding,
                            Err(e) => {
                                for created in &owned_fabric_ports {
                                    let _ = fabric.remove_port(created).await;
                                }
                                if let Some(off) = vnc_port_offset {
                                    self.release_vnc_offset(off);
                                }
                                return Err(e);
                            }
                        };
                        owned_fabric_ports.push(port_id.clone());
                        active_nics.push(ActiveVmNic {
                            index: idx,
                            port_id,
                            mac: nic.mac.clone(),
                            nic_model: effective_nic_model,
                            fabric_port,
                            vm_port,
                        });
                    }
                }
            }
        }

        let host_arch = env::consts::ARCH.to_string();
        let hvf_available = if (req.arch == GuestArch::Aarch64 && host_arch == "aarch64")
            || (req.arch == GuestArch::X86_64 && host_arch == "x86_64")
        {
            crate::env_doctor::check_hvf_support().await
        } else {
            false
        };
        let accel_label = req.arch.effective_accel(&host_arch, hvf_available).to_string();

        let spec = ResolvedVmLaunchSpec {
            node_id: req.node_id.clone(),
            name: req.name.clone(),
            cpus: req.cpus.max(1),
            ram_mb: req.ram_mb.max(16),
            arch: req.arch,
            host_arch,
            hvf_available,
            firmware: req.firmware,
            disk_bus: req.disk_bus,
            bios_path,
            disk_path: disk_path.clone(),
            boot_media: boot_media.clone(),
            display_mode: req.display_mode,
            vnc_port_offset,
            serial_socket_path: serial_socket_path.clone(),
            qmp_socket_path: qmp_socket_path.clone(),
            nics: active_nics.clone(),
        };

        let qemu_args = build_qemu_args(&spec);
        let mut cmd = Command::new(&qemu_bin);
        cmd.args(&qemu_args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                for created in &owned_fabric_ports {
                    let _ = fabric.remove_port(created).await;
                }
                if let Some(off) = vnc_port_offset {
                    self.release_vnc_offset(off);
                }
                return Err(format!("Failed to spawn {}: {e}", qemu_bin.display()));
            }
        };

        let pid = child.id();
        if let Some(p) = pid {
            if let Ok(mut map) = self.inner.live_pids.lock() {
                map.insert(req.node_id.clone(), p);
            }
        }

        let vnc_tcp_port = vnc_port_offset.map(|off| 5900 + off);
        let info = VmInstanceInfo {
            node_id: req.node_id.clone(),
            name: req.name.clone(),
            status: VmStatus::Running,
            pid,
            cpus: spec.cpus,
            ram_mb: spec.ram_mb,
            arch: req.arch,
            nic_model: req.nic_model,
            firmware: req.firmware,
            disk_bus: req.disk_bus,
            accel: accel_label.clone(),
            disk_path: disk_path.display().to_string(),
            boot_media_path: boot_media.map(|(p, _)| p.display().to_string()),
            display_mode: req.display_mode,
            vnc_port_offset,
            vnc_tcp_port,
            serial_socket_path: serial_socket_path.display().to_string(),
            qmp_socket_path: qmp_socket_path.display().to_string(),
            nics: active_nics,
            qemu_args,
            started_at_ms: now_epoch_ms(),
            exit_code: None,
        };

        let (exit_tx, exit_rx) = tokio::sync::watch::channel(false);

        {
            let mut guard = self.inner.vms.write().await;
            guard.insert(
                req.node_id.clone(),
                ManagedVmEntry {
                    info: info.clone(),
                    owned_fabric_ports: owned_fabric_ports.clone(),
                    exit_rx,
                },
            );
        }

        self.emit_vm_event(
            &info.node_id,
            VmStatus::Running,
            info.pid,
            info.vnc_tcp_port,
            &info.serial_socket_path,
            Some(format!(
                "QEMU {} ({}) instance running",
                req.arch.as_str(),
                accel_label.to_uppercase()
            )),
        )
        .await;

        // Spawn async reaper task owning `child` until termination
        let mgr = self.clone();
        let fabric_clone = fabric.clone();
        let image_store_clone = image_store.clone();
        let finalize_hook = req.finalize_template_on_exit.clone();
        let finalize_disk_path = disk_path.clone();
        let node_id = req.node_id.clone();
        let serial_str = info.serial_socket_path.clone();
        tokio::spawn(async move {
            let wait_res = child.wait().await;
            let exit_code = wait_res.as_ref().ok().and_then(|s| s.code());

            if let Ok(mut map) = mgr.inner.live_pids.lock() {
                map.remove(&node_id);
            }
            if let Some(off) = vnc_port_offset {
                mgr.release_vnc_offset(off);
            }
            cleanup_node_sockets(&node_id);

            let (final_status, ports_to_clean) = {
                let mut guard = mgr.inner.vms.write().await;
                if let Some(entry) = guard.get_mut(&node_id) {
                    let was_stopping = entry.info.status == VmStatus::Stopping;
                    let final_status = if was_stopping || exit_code == Some(0) {
                        VmStatus::Stopped
                    } else {
                        VmStatus::Crashed
                    };
                    entry.info.status = final_status;
                    entry.info.pid = None;
                    entry.info.exit_code = exit_code;
                    let ports = std::mem::take(&mut entry.owned_fabric_ports);
                    (final_status, ports)
                } else {
                    (VmStatus::Stopped, Vec::new())
                }
            };

            for p in ports_to_clean {
                let _ = fabric_clone.remove_port(&p).await;
            }

            // If this VM was launched by 1-click Guided Template Setup and exited cleanly,
            // auto-promote the installed `.qcow2` into a read-only (`0444`) Golden Base Template!
            if let Some(fin) = finalize_hook {
                if final_status == VmStatus::Stopped {
                    if let Ok(meta) = fs::metadata(&finalize_disk_path) {
                        // A freshly created empty qcow2 header is ~196 KB; an installed OS writes multiple MBs.
                        if meta.len() > 2 * 1024 * 1024 {
                            if let Ok(tpl) = image_store_clone
                                .finalize_in_place_template(&finalize_disk_path, &fin)
                                .await
                            {
                                let handle_opt = mgr.inner.app_handle.read().await.clone();
                                if let Some(app) = handle_opt {
                                    let _ = app.emit(
                                        "catalog://download-progress",
                                        serde_json::json!({
                                            "catalogId": fin.catalog_id,
                                            "stage": "Ready",
                                            "bytesDownloaded": tpl.actual_size_bytes,
                                            "totalBytes": tpl.actual_size_bytes,
                                            "percent": 100.0,
                                            "message": format!("{} promoted to Read-Only Base Template ({})", tpl.name, tpl.filename),
                                        }),
                                    );
                                }
                            }
                        }
                    }
                }
            }

            let _ = exit_tx.send(true);
            mgr.emit_vm_event(
                &node_id,
                final_status,
                None,
                None,
                &serial_str,
                exit_code.map(|c| format!("Exited with status {c}")),
            )
            .await;
        });

        Ok(info)
    }

    /// Cleanly shuts down a running VM:
    /// 1. Sends QMP `system_powerdown` over `/tmp/etherloom/{node_id}_qmp.sock` (unless `force == true`)
    /// 2. Waits for graceful ACPI exit; falls back to `SIGTERM`, then `SIGKILL`.
    pub async fn stop_vm(&self, node_id: &str, force: bool) -> Result<VmInstanceInfo, String> {
        let (pid_opt, qmp_sock, serial_sock, vnc_port, mut exit_rx) = {
            let mut guard = self.inner.vms.write().await;
            let entry = guard
                .get_mut(node_id)
                .ok_or_else(|| format!("VM '{node_id}' not found"))?;
            if matches!(entry.info.status, VmStatus::Stopped | VmStatus::Crashed) {
                return Ok(entry.info.clone());
            }
            entry.info.status = VmStatus::Stopping;
            (
                entry.info.pid,
                PathBuf::from(&entry.info.qmp_socket_path),
                entry.info.serial_socket_path.clone(),
                entry.info.vnc_tcp_port,
                entry.exit_rx.clone(),
            )
        };

        self.emit_vm_event(
            node_id,
            VmStatus::Stopping,
            pid_opt,
            vnc_port,
            &serial_sock,
            Some("Stopping VM…".to_string()),
        )
        .await;

        if !force {
            if send_qmp_system_powerdown(&qmp_sock).await.is_ok()
                && wait_for_exit_signal(&mut exit_rx, DEFAULT_POWERDOWN_TIMEOUT).await
            {
                return self.get_vm_info(node_id).await.ok_or_else(|| {
                    format!("VM '{node_id}' entry disappeared after clean powerdown")
                });
            }
        }

        if let Some(pid) = pid_opt {
            if !force {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                if wait_for_exit_signal(&mut exit_rx, SIGTERM_GRACE_TIMEOUT).await {
                    return self.get_vm_info(node_id).await.ok_or_else(|| {
                        format!("VM '{node_id}' entry disappeared after SIGTERM")
                    });
                }
            }

            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
            let _ = wait_for_exit_signal(&mut exit_rx, Duration::from_secs(2)).await;
        }

        cleanup_node_sockets(node_id);
        self.get_vm_info(node_id)
            .await
            .ok_or_else(|| format!("VM '{node_id}' not found after stop"))
    }

    /// Terminates all active child QEMU processes (invoked automatically when the Tauri app exits).
    pub async fn shutdown_all(&self) {
        let active_ids: Vec<String> = {
            let guard = self.inner.vms.read().await;
            guard
                .iter()
                .filter(|(_, e)| {
                    matches!(
                        e.info.status,
                        VmStatus::Starting | VmStatus::Running | VmStatus::Stopping
                    )
                })
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut join_handles = Vec::with_capacity(active_ids.len());
        for id in active_ids {
            let mgr = self.clone();
            let (tx, rx) = oneshot::channel();
            tokio::spawn(async move {
                let _ = timeout(Duration::from_millis(900), mgr.stop_vm(&id, false)).await;
                let _ = mgr.stop_vm(&id, true).await;
                let _ = tx.send(());
            });
            join_handles.push(rx);
        }

        for rx in join_handles {
            let _ = rx.await;
        }
    }

    pub async fn list_vms(&self) -> Vec<VmInstanceInfo> {
        let guard = self.inner.vms.read().await;
        let mut list: Vec<VmInstanceInfo> = guard.values().map(|e| e.info.clone()).collect();
        list.sort_by(|a, b| a.node_id.cmp(&b.node_id));
        list
    }

    pub async fn get_vm_info(&self, node_id: &str) -> Option<VmInstanceInfo> {
        let guard = self.inner.vms.read().await;
        guard.get(node_id).map(|e| e.info.clone())
    }

    fn allocate_vnc_offset(&self, preferred: Option<u16>) -> Result<u16, String> {
        let mut guard = self
            .inner
            .reserved_vnc_offsets
            .lock()
            .map_err(|_| "VNC offset registry poisoned".to_string())?;

        if let Some(pref) = preferred {
            let tcp_port = 5900u16.saturating_add(pref);
            if !guard.contains(&pref)
                && TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, tcp_port)).is_ok()
            {
                guard.insert(pref);
                return Ok(pref);
            }
        }

        for offset in 1..=500u16 {
            if guard.contains(&offset) {
                continue;
            }
            let tcp_port = 5900 + offset;
            if let Ok(listener) =
                TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, tcp_port))
            {
                drop(listener);
                guard.insert(offset);
                return Ok(offset);
            }
        }

        Err("Unable to find an available local VNC port in 5901..6400".to_string())
    }

    fn release_vnc_offset(&self, offset: u16) {
        if let Ok(mut guard) = self.inner.reserved_vnc_offsets.lock() {
            guard.remove(&offset);
        }
    }

    async fn emit_vm_event(
        &self,
        node_id: &str,
        status: VmStatus,
        pid: Option<u32>,
        vnc_tcp_port: Option<u16>,
        serial_socket_path: &str,
        message: Option<String>,
    ) {
        let handle_opt = self.inner.app_handle.read().await.clone();
        if let Some(app) = handle_opt {
            let payload = VmStateEvent {
                node_id: node_id.to_string(),
                status,
                pid,
                vnc_tcp_port,
                serial_socket_path: serial_socket_path.to_string(),
                message,
                timestamp_ms: now_epoch_ms(),
            };
            let _ = app.emit("etherloom://vm-state", payload);
        }
    }
}

/// Connects to QEMU's QMP Unix domain socket, negotiates `qmp_capabilities`, and issues `system_powerdown`.
async fn send_qmp_system_powerdown(qmp_socket_path: &Path) -> Result<(), String> {
    let stream = timeout(QMP_CONNECT_TIMEOUT, UnixStream::connect(qmp_socket_path))
        .await
        .map_err(|_| "Timed out connecting to QMP socket".to_string())?
        .map_err(|e| format!("QMP connect error: {e}"))?;

    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    let _greeting = timeout(QMP_CONNECT_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting QMP greeting".to_string())?
        .map_err(|e| e.to_string())?;

    writer
        .write_all(b"{\"execute\":\"qmp_capabilities\"}\r\n")
        .await
        .map_err(|e| e.to_string())?;
    let _caps_reply = timeout(QMP_CONNECT_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting qmp_capabilities ack".to_string())?
        .map_err(|e| e.to_string())?;

    writer
        .write_all(b"{\"execute\":\"system_powerdown\"}\r\n")
        .await
        .map_err(|e| e.to_string())?;
    let _powerdown_reply = timeout(QMP_CONNECT_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting system_powerdown ack".to_string())?
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn wait_for_exit_signal(
    rx: &mut tokio::sync::watch::Receiver<bool>,
    max_wait: Duration,
) -> bool {
    if *rx.borrow() {
        return true;
    }
    matches!(timeout(max_wait, rx.changed()).await, Ok(Ok(())) if *rx.borrow())
}

fn ensure_socket_dir() -> Result<(), String> {
    let dir = Path::new(RUNTIME_SOCKET_DIR);
    fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    if let Ok(meta) = fs::metadata(dir) {
        let mut perms = meta.permissions();
        perms.set_mode(0o700);
        let _ = fs::set_permissions(dir, perms);
    }
    Ok(())
}

pub(crate) fn sanitize_socket_id(node_id: &str) -> String {
    node_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn cleanup_node_sockets(node_id: &str) {
    let safe_id = sanitize_socket_id(node_id);
    let base = Path::new(RUNTIME_SOCKET_DIR);
    let _ = fs::remove_file(base.join(format!("{safe_id}_serial.sock")));
    let _ = fs::remove_file(base.join(format!("{safe_id}_qmp.sock")));
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

    fn sample_spec(
        display_mode: VmDisplayMode,
        boot_media: Option<(PathBuf, BootMediaBus)>,
    ) -> ResolvedVmLaunchSpec {
        ResolvedVmLaunchSpec {
            node_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "fw1-openbsd".to_string(),
            cpus: 2,
            ram_mb: 512,
            arch: GuestArch::Aarch64,
            host_arch: "aarch64".to_string(),
            hvf_available: true,
            firmware: FirmwareType::Uefi,
            disk_bus: DiskBus::VirtioBlk,
            bios_path: Some(PathBuf::from(
                "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
            )),
            disk_path: PathBuf::from("/tmp/lab.etherloom/overlays/fw1.qcow2"),
            boot_media,
            display_mode,
            vnc_port_offset: Some(3),
            serial_socket_path: PathBuf::from(
                "/tmp/etherloom/550e8400-e29b-41d4-a716-446655440000_serial.sock",
            ),
            qmp_socket_path: PathBuf::from(
                "/tmp/etherloom/550e8400-e29b-41d4-a716-446655440000_qmp.sock",
            ),
            nics: vec![
                ActiveVmNic {
                    index: 0,
                    port_id: "fw1-net0".to_string(),
                    mac: "52:54:00:10:01:00".to_string(),
                    nic_model: NicModel::VirtioNetPci,
                    fabric_port: 21000,
                    vm_port: 21001,
                },
                ActiveVmNic {
                    index: 1,
                    port_id: "fw1-net1".to_string(),
                    mac: "52:54:00:10:01:01".to_string(),
                    nic_model: NicModel::VirtioNetPci,
                    fabric_port: 21002,
                    vm_port: 21003,
                },
            ],
        }
    }

    #[test]
    fn builds_exact_hvf_vnc_serial_and_udp_netdev_args() {
        let spec = sample_spec(VmDisplayMode::Vnc, None);
        let args = build_qemu_args(&spec);
        let joined = args.join(" ");

        assert!(joined.contains("-M virt,highmem=on -accel hvf -cpu host -smp 2 -m 512"));
        assert!(joined.contains("-bios /opt/homebrew/share/qemu/edk2-aarch64-code.fd"));
        assert!(joined.contains("-device ramfb -device qemu-xhci -device usb-kbd -device usb-tablet -vnc 127.0.0.1:3"));
        assert!(joined.contains("virtio-blk-pci,drive=hd0,bootindex=1"));
        assert!(joined.contains("-netdev socket,id=net0,udp=127.0.0.1:21000,localaddr=127.0.0.1:21001 -device virtio-net-pci,netdev=net0,mac=52:54:00:10:01:00"));
        assert!(joined.contains("-netdev socket,id=net1,udp=127.0.0.1:21002,localaddr=127.0.0.1:21003 -device virtio-net-pci,netdev=net1,mac=52:54:00:10:01:01"));
        assert!(joined.contains("-chardev socket,id=serial0,path=/tmp/etherloom/550e8400-e29b-41d4-a716-446655440000_serial.sock,server=on,wait=off -serial chardev:serial0"));
    }

    #[test]
    fn supports_cocoa_display_and_openbsd_img_usb_installer_boot_priority() {
        let spec = sample_spec(
            VmDisplayMode::Cocoa,
            Some((
                PathBuf::from("/tmp/isos/install76.img"),
                BootMediaBus::Auto,
            )),
        );
        let args = build_qemu_args(&spec);
        let joined = args.join(" ");

        assert!(joined.contains("-display cocoa"));
        assert!(!joined.contains("-vnc"));
        assert!(joined.contains("usb-storage,drive=install0,bootindex=1"));
        assert!(joined.contains("virtio-blk-pci,drive=hd0,bootindex=2"));
    }

    #[test]
    fn supports_iso_cdrom_installer_boot_priority() {
        let spec = sample_spec(
            VmDisplayMode::Vnc,
            Some((
                PathBuf::from("/tmp/isos/FreeBSD-14.2-RELEASE-arm64-aarch64-disc1.iso"),
                BootMediaBus::Auto,
            )),
        );
        let args = build_qemu_args(&spec);
        let joined = args.join(" ");

        assert!(joined.contains("scsi-cd,bus=scsi0.0,drive=install0,bootindex=1"));
        assert!(joined.contains("virtio-blk-pci,drive=hd0,bootindex=2"));
    }

    #[test]
    fn builds_x86_64_q35_tcg_on_apple_silicon_and_hvf_on_intel_with_e1000_and_ahci() {
        let mut spec = sample_spec(VmDisplayMode::Vnc, None);
        spec.name = "opnsense-fw".to_string();
        spec.arch = GuestArch::X86_64;
        spec.host_arch = "aarch64".to_string();
        spec.firmware = FirmwareType::Bios;
        spec.disk_bus = DiskBus::Ahci;
        spec.ram_mb = 1536;
        spec.nics[0].nic_model = NicModel::E1000;
        spec.nics[1].nic_model = NicModel::Rtl8139;

        let args = build_qemu_args(&spec);
        let joined = args.join(" ");

        assert!(joined.contains("-M q35 -accel tcg,thread=multi -cpu max -smp 2 -m 1536"));
        assert!(!joined.contains("-bios"), "SeaBIOS x86_64 omits -bios");
        assert!(joined.contains("-vga std -device qemu-xhci -device usb-kbd -device usb-tablet"));
        assert!(joined.contains("-device ahci,id=ahci0"));
        assert!(joined.contains("ide-hd,bus=ahci0.0,drive=hd0,bootindex=1"));
        assert!(joined.contains("-device e1000,netdev=net0,mac=52:54:00:10:01:00"));
        assert!(joined.contains("-device rtl8139,netdev=net1,mac=52:54:00:10:01:01"));

        // Verify Intel Mac (`host_arch == "x86_64"`) switches to `-accel hvf -cpu host` and UEFI emits `-bios`
        spec.host_arch = "x86_64".to_string();
        spec.firmware = FirmwareType::Uefi;
        spec.bios_path = Some(PathBuf::from(
            "/usr/local/share/qemu/edk2-x86_64-code.fd",
        ));
        let intel_joined = build_qemu_args(&spec).join(" ");
        assert!(intel_joined.contains("-M q35 -accel hvf -cpu host"));
        assert!(intel_joined.contains("-bios /usr/local/share/qemu/edk2-x86_64-code.fd"));
    }

    #[test]
    fn builds_i386_freedos_pc_pentium3_ide_pcnet_with_32mb_ram_and_riscv64_virt() {
        let mut dos = sample_spec(VmDisplayMode::Vnc, None);
        dos.name = "freedos-mtcp".to_string();
        dos.arch = GuestArch::I386;
        dos.firmware = FirmwareType::Bios;
        dos.disk_bus = DiskBus::Ide;
        dos.cpus = 1;
        dos.ram_mb = 32;
        dos.nics.truncate(1);
        dos.nics[0].nic_model = NicModel::Pcnet;

        let dos_joined = build_qemu_args(&dos).join(" ");
        assert!(dos_joined.contains("-M pc -accel tcg,thread=multi -cpu pentium3 -smp 1 -m 32"));
        assert!(!dos_joined.contains("-bios"));
        assert!(dos_joined.contains("-vga std"));
        assert!(dos_joined.contains("ide-hd,bus=ide.0,drive=hd0,bootindex=1"));
        assert!(dos_joined.contains("-device pcnet,netdev=net0,mac=52:54:00:10:01:00"));

        let mut rv = sample_spec(VmDisplayMode::Vnc, None);
        rv.arch = GuestArch::Riscv64;
        rv.nics[0].nic_model = NicModel::Ne2kPci;
        let rv_joined = build_qemu_args(&rv).join(" ");
        assert!(rv_joined.contains("-M virt -accel tcg,thread=multi -cpu rv64"));
        assert!(rv_joined.contains("-device ne2k_pci,netdev=net0"));
    }
}
