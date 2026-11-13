use crate::env_doctor::{resolve_edk2_firmware, resolve_qemu_system_aarch64};
use crate::fabric::{PacketFabric, UdpPortBinding};
use crate::images::ImageStore;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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

/// Graphical UEFI framebuffer output mode per VM node.
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
    /// `virtio-scsi-pci` + `scsi-cd` (ideal for FreeBSD / NetBSD / Alpine / Debian `.iso`)
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

/// NIC specification passed when launching a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNicConfig {
    /// Optional fabric port ID (if omitted, `PacketFabric` allocates `{node_id}-net{index}`).
    pub port_id: Option<String>,
    /// MAC address (e.g. `52:54:00:10:01:00`).
    pub mac: String,
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
    pub fabric_port: u16,
    pub vm_port: u16,
}

/// Request payload to spawn a QEMU HVF VM for a topology node.
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
    pub nics: Vec<VmNicConfig>,
    pub bios_path_override: Option<String>,
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
    pub bios_path: PathBuf,
    pub disk_path: PathBuf,
    pub boot_media: Option<(PathBuf, BootMediaBus)>,
    pub display_mode: VmDisplayMode,
    pub vnc_port_offset: Option<u16>,
    pub serial_socket_path: PathBuf,
    pub qmp_socket_path: PathBuf,
    pub nics: Vec<ActiveVmNic>,
}

/// Pure function constructing deterministic `qemu-system-aarch64` CLI arguments according to `ARCHITECTURE.md`.
pub fn build_qemu_args(spec: &ResolvedVmLaunchSpec) -> Vec<String> {
    let mut args = vec![
        "-name".to_string(),
        spec.name.clone(),
        "-M".to_string(),
        "virt,highmem=on".to_string(),
        "-accel".to_string(),
        "hvf".to_string(),
        "-cpu".to_string(),
        "host".to_string(),
        "-smp".to_string(),
        spec.cpus.max(1).to_string(),
        "-m".to_string(),
        spec.ram_mb.max(128).to_string(),
        "-bios".to_string(),
        spec.bios_path.display().to_string(),
    ];

    // Graphical UEFI framebuffer + XHCI USB input controller (always present for both VNC and Cocoa modes)
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

    // Storage: boot installer media (if attached) gets bootindex=1; primary qcow2 disk gets next bootindex
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
            BootMediaBus::Cdrom => {
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
            BootMediaBus::Usb | BootMediaBus::Auto => {
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
        "-device".to_string(),
        format!("virtio-blk-pci,drive=hd0,bootindex={hd_bootindex}"),
    ]);

    // Zero-Root UDP Socket Netdevs (raw Ethernet II frames per datagram, no length prefix)
    for nic in &spec.nics {
        let net_id = format!("net{}", nic.index);
        args.extend([
            "-netdev".to_string(),
            format!(
                "socket,id={net_id},udp=127.0.0.1:{},localaddr=127.0.0.1:{}",
                nic.fabric_port, nic.vm_port
            ),
            "-device".to_string(),
            format!("virtio-net-pci,netdev={net_id},mac={}", nic.mac),
        ]);
    }

    // Unix Domain Socket Serial Console (`xterm.js` target)
    args.extend([
        "-chardev".to_string(),
        format!(
            "socket,id=serial0,path={},server=on,wait=off",
            spec.serial_socket_path.display()
        ),
        "-serial".to_string(),
        "chardev:serial0".to_string(),
    ]);

    // Unix Domain Socket QMP Control Monitor (for graceful `system_powerdown`)
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

/// Async supervisor managing `qemu-system-aarch64` HVF child processes per node ID / UUID.
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
        // Only act when the final Arc reference is dropped on process teardown
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

    /// Previews the exact `qemu-system-aarch64` command line that `spawn_vm` would execute.
    pub fn preview_command(&self, req: &SpawnVmRequest) -> Result<Vec<String>, String> {
        let qemu_bin = resolve_qemu_system_aarch64()
            .unwrap_or_else(|| PathBuf::from("/opt/homebrew/bin/qemu-system-aarch64"));
        let bios_path = match req.bios_path_override {
            Some(ref p) => PathBuf::from(p),
            None => resolve_edk2_firmware(Some(&qemu_bin))
                .unwrap_or_else(|| PathBuf::from("/opt/homebrew/share/qemu/edk2-aarch64-code.fd")),
        };

        let safe_id = sanitize_socket_id(&req.node_id);
        let spec = ResolvedVmLaunchSpec {
            node_id: req.node_id.clone(),
            name: req.name.clone(),
            cpus: req.cpus,
            ram_mb: req.ram_mb,
            bios_path,
            disk_path: PathBuf::from(&req.disk_path),
            boot_media: req
                .boot_media_path
                .as_ref()
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
                    fabric_port: n.fabric_port.unwrap_or(20000 + (idx as u16) * 2),
                    vm_port: n.vm_port.unwrap_or(20001 + (idx as u16) * 2),
                })
                .collect(),
        };

        let mut full = vec![qemu_bin.display().to_string()];
        full.extend(build_qemu_args(&spec));
        Ok(full)
    }

    /// Spawns a supervised `qemu-system-aarch64` HVF child process for `req.node_id`,
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

        let qemu_bin = resolve_qemu_system_aarch64().ok_or_else(|| {
            "qemu-system-aarch64 not found in /opt/homebrew/bin, /usr/local/bin, or PATH".to_string()
        })?;
        let bios_path = match req.bios_path_override {
            Some(ref custom) => {
                let p = PathBuf::from(custom);
                if !p.is_file() {
                    return Err(format!("Custom UEFI firmware not found: {}", p.display()));
                }
                p
            }
            None => resolve_edk2_firmware(Some(&qemu_bin)).ok_or_else(|| {
                "UEFI firmware edk2-aarch64-code.fd not found in /opt/homebrew/share/qemu or /usr/local/share/qemu".to_string()
            })?,
        };

        let disk_path = PathBuf::from(&req.disk_path);
        if !disk_path.is_file() {
            return Err(format!("VM disk file does not exist: {}", disk_path.display()));
        }

        // Portable qcow2 Auto-Rebase: ensure backing-filename points to the active `templates_dir`
        image_store
            .ensure_overlay_rebased(&disk_path, req.template_id.as_deref())
            .await?;

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
            match (nic.fabric_port, nic.vm_port) {
                (Some(fp), Some(vp)) => {
                    active_nics.push(ActiveVmNic {
                        index: idx,
                        port_id: nic
                            .port_id
                            .clone()
                            .unwrap_or_else(|| format!("{safe_id}-net{idx}")),
                        mac: nic.mac.clone(),
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
                        // Reuse persistent canvas UDP port without marking as ephemeral-owned
                        active_nics.push(ActiveVmNic {
                            index: idx,
                            port_id: existing.port_id,
                            mac: nic.mac.clone(),
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
                            fabric_port,
                            vm_port,
                        });
                    }
                }
            }
        }

        let spec = ResolvedVmLaunchSpec {
            node_id: req.node_id.clone(),
            name: req.name.clone(),
            cpus: req.cpus.max(1),
            ram_mb: req.ram_mb.max(128),
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
                return Err(format!(
                    "Failed to spawn {}: {e}",
                    qemu_bin.display()
                ));
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
            Some("QEMU HVF instance running".to_string()),
        )
        .await;

        // Spawn async reaper task owning `child` until termination
        let mgr = self.clone();
        let fabric_clone = fabric.clone();
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
            // Attempt ACPI powerdown via QMP Unix socket
            if send_qmp_system_powerdown(&qmp_sock).await.is_ok()
                && wait_for_exit_signal(&mut exit_rx, DEFAULT_POWERDOWN_TIMEOUT).await
            {
                return self.get_vm_info(node_id).await.ok_or_else(|| {
                    format!("VM '{node_id}' entry disappeared after clean powerdown")
                });
            }
        }

        // Fallback 1: SIGTERM
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

            // Fallback 2: SIGKILL
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
                // Fast graceful attempt (800ms) during app quit, then immediate SIGTERM/SIGKILL
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

        // Start at offset 1 (port 5901) to avoid macOS Screen Sharing daemon on 5900
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

    // 1. Read QMP greeting banner
    let _greeting = timeout(QMP_CONNECT_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting QMP greeting".to_string())?
        .map_err(|e| e.to_string())?;

    // 2. Negotiate capabilities
    writer
        .write_all(b"{\"execute\":\"qmp_capabilities\"}\r\n")
        .await
        .map_err(|e| e.to_string())?;
    let _caps_reply = timeout(QMP_CONNECT_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting qmp_capabilities ack".to_string())?
        .map_err(|e| e.to_string())?;

    // 3. Issue ACPI system_powerdown
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

    fn sample_spec(display_mode: VmDisplayMode, boot_media: Option<(PathBuf, BootMediaBus)>) -> ResolvedVmLaunchSpec {
        ResolvedVmLaunchSpec {
            node_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "fw1-openbsd".to_string(),
            cpus: 2,
            ram_mb: 512,
            bios_path: PathBuf::from("/opt/homebrew/share/qemu/edk2-aarch64-code.fd"),
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
                    fabric_port: 21000,
                    vm_port: 21001,
                },
                ActiveVmNic {
                    index: 1,
                    port_id: "fw1-net1".to_string(),
                    mac: "52:54:00:10:01:01".to_string(),
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
}
