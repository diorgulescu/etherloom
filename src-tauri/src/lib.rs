pub mod academy;
pub mod activity_monitor;
pub mod catalog;
pub mod console_bridge;
pub mod dhcp_appliance;
pub mod env_doctor;
pub mod fabric;
pub mod images;
pub mod nat_gateway;
pub mod pcap_tap;
pub mod storage;
pub mod tcpflowy_bridge;
pub mod vm_manager;
pub mod workspace;

use academy::{
    get_academy_lab_detail, instantiate_academy_lab, list_academy_labs, AcademyLabDetail,
    AcademyLabSummary, InstantiatedLabDto,
};
use activity_monitor::{ActivityMonitor, ActivityMonitorSnapshot};
use catalog::{
    reveal_path_in_finder, CatalogDownloadRequest, CatalogImportLocalRequest, CatalogManager,
    DeleteCatalogImageResult, OsCatalogEntryDto,
};
use console_bridge::{ConsoleBridge, ConsoleSessionEndpoints};
use dhcp_appliance::DhcpLeaseDto;
use env_doctor::EnvDoctorReport;
use fabric::{
    CreateLinkRequest, LinkSnapshot, MacTableEntryDto, PacketFabric, UdpPortBinding,
    UpdateLinkRequest, VirtualDeviceInfo,
};
use images::{
    builtin_os_profiles, find_os_profile, BaseTemplateInfo, CreateBlankDiskRequest,
    CreateOverlayRequest, DiskInfo, ImageStore, InstallerMediaInfo, OsProfile, OverlayRebaseReport,
    OverlayTemplateBinding, PromoteTemplateRequest, ResetOverlayRequest,
};
use nat_gateway::NatSessionDto;
use pcap_tap::{
    export_pcap_copy_to_path, list_captures_in_dir, open_pcap_file_in_wireshark,
    open_pcap_in_wireshark_with_hint, reveal_pcap_file_in_finder, CaptureFileInfo, CaptureSummary,
    LiveWiresharkSessionInfo, PcapTapManager, StartPcapRecordingResult, StopPcapRecordingResult,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use storage::{
    query_disk_telemetry, verify_volume_mounted_under, DiskTelemetry, StorageManager,
    StorageMigrationResult, StorageStateSnapshot, UpdateStorageRequest,
};
use tauri::Manager;
use tcpflowy_bridge::{
    DissectPcapRequest, TcpflowyDissectionReport, TcpflowyEnvStatus, TcpflowyManager,
};
use tokio::sync::RwLock;
use vm_manager::{
    BootMediaBus, DiskBus, FirmwareType, GuestArch, NicModel, SpawnVmRequest, VmDisplayMode,
    VmInstanceInfo, VmManager, VmNicConfig,
};
use workspace::{ProjectBundleDto, SaveProjectRequest, TopologyDocument, WorkspaceNode};

pub struct StudioState {
    pub last_env_report: RwLock<Option<EnvDoctorReport>>,
    pub storage: StorageManager,
    pub image_store: ImageStore,
    pub catalog: CatalogManager,
    pub fabric: PacketFabric,
    pub vm_manager: VmManager,
    pub console_bridge: ConsoleBridge,
    pub pcap_taps: PcapTapManager,
    pub tcpflowy: TcpflowyManager,
    pub activity_monitor: ActivityMonitor,
}

impl Default for StudioState {
    fn default() -> Self {
        let storage = StorageManager::default();
        let image_store = ImageStore::new(storage.clone());
        Self {
            last_env_report: RwLock::new(None),
            storage,
            image_store,
            catalog: CatalogManager::new(),
            fabric: PacketFabric::new(),
            vm_manager: VmManager::new(),
            console_bridge: ConsoleBridge::new(),
            pcap_taps: PcapTapManager::new(),
            tcpflowy: TcpflowyManager::default(),
            activity_monitor: ActivityMonitor::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogComponent {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub kind: String,
    pub guest_family: Option<String>,
    pub os_profile_id: Option<String>,
    #[serde(default)]
    pub arch: Option<GuestArch>,
    #[serde(default)]
    pub default_nic_model: Option<NicModel>,
    #[serde(default)]
    pub default_firmware: Option<FirmwareType>,
    #[serde(default)]
    pub default_disk_bus: Option<DiskBus>,
    pub nic_prefix: String,
    pub default_ports: u8,
    pub default_vcpus: Option<u8>,
    pub default_memory_mb: Option<u32>,
    pub console_modes: Vec<String>,
}

// -----------------------------------------------------------------------------
// Environment Doctor & Component Catalog IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
async fn run_env_doctor(state: tauri::State<'_, StudioState>) -> Result<EnvDoctorReport, String> {
    let mut report = env_doctor::run_diagnostics().await;
    let resolved = state.storage.resolved_paths().await;
    report.templates_dir = resolved.templates_dir.display().to_string();
    {
        let mut guard = state.last_env_report.write().await;
        *guard = Some(report.clone());
    }
    Ok(report)
}

#[tauri::command]
async fn get_env_status(state: tauri::State<'_, StudioState>) -> Result<EnvDoctorReport, String> {
    {
        let guard = state.last_env_report.read().await;
        if let Some(cached) = guard.as_ref() {
            let mut out = cached.clone();
            let resolved = state.storage.resolved_paths().await;
            out.templates_dir = resolved.templates_dir.display().to_string();
            return Ok(out);
        }
    }
    run_env_doctor(state).await
}

#[tauri::command]
fn get_component_catalog() -> Vec<CatalogComponent> {
    let mut items: Vec<CatalogComponent> = builtin_os_profiles()
        .into_iter()
        .map(|profile| CatalogComponent {
            id: format!("guest-{}", profile.id),
            name: profile.name,
            subtitle: format!(
                "{} • {} • {} MB",
                profile.arch.as_str(),
                profile.nic_naming_pattern,
                profile.default_ram_mb
            ),
            kind: "vm".to_string(),
            guest_family: Some(profile.guest_family),
            os_profile_id: Some(profile.id),
            arch: Some(profile.arch),
            default_nic_model: Some(profile.default_nic_model),
            default_firmware: Some(profile.default_firmware),
            default_disk_bus: Some(profile.default_disk_bus),
            nic_prefix: profile.nic_prefix,
            default_ports: if profile.arch == GuestArch::I386 { 1 } else { 2 },
            default_vcpus: Some(profile.default_cpus),
            default_memory_mb: Some(profile.default_ram_mb),
            console_modes: vec![
                "serial".to_string(),
                "vnc".to_string(),
                "cocoa".to_string(),
            ],
        })
        .collect();

    items.push(CatalogComponent {
        id: "fabric-l2-switch".to_string(),
        name: "L2 Ethernet Switch".to_string(),
        subtitle: "p1..p8 • 802.1D MAC learning bridge".to_string(),
        kind: "l2_switch".to_string(),
        guest_family: None,
        os_profile_id: None,
        arch: None,
        default_nic_model: None,
        default_firmware: None,
        default_disk_bus: None,
        nic_prefix: "p".to_string(),
        default_ports: 8,
        default_vcpus: None,
        default_memory_mb: None,
        console_modes: vec!["inspector".to_string()],
    });

    items.push(CatalogComponent {
        id: "fabric-l1-hub".to_string(),
        name: "L1 Ethernet Hub".to_string(),
        subtitle: "p1..p6 • Shared-wire repeater".to_string(),
        kind: "l1_hub".to_string(),
        guest_family: None,
        os_profile_id: None,
        arch: None,
        default_nic_model: None,
        default_firmware: None,
        default_disk_bus: None,
        nic_prefix: "p".to_string(),
        default_ports: 6,
        default_vcpus: None,
        default_memory_mb: None,
        console_modes: vec!["inspector".to_string()],
    });

    items.push(CatalogComponent {
        id: "fabric-dhcp-server".to_string(),
        name: "DHCPv4 / DHCPv6 Server".to_string(),
        subtitle: "10.0.10.0/24 + fd00:10::/64 • Instant dual-stack appliance".to_string(),
        kind: "dhcp_server".to_string(),
        guest_family: None,
        os_profile_id: None,
        arch: None,
        default_nic_model: None,
        default_firmware: None,
        default_disk_bus: None,
        nic_prefix: "p".to_string(),
        default_ports: 1,
        default_vcpus: None,
        default_memory_mb: None,
        console_modes: vec!["inspector".to_string()],
    });

    items.push(CatalogComponent {
        id: "fabric-nat-gateway".to_string(),
        name: "Internet Gateway (Host NAT)".to_string(),
        subtitle: "10.0.2.1/24 • Zero-root WAN uplink + DNS & DHCP".to_string(),
        kind: "nat_gateway".to_string(),
        guest_family: None,
        os_profile_id: None,
        arch: None,
        default_nic_model: None,
        default_firmware: None,
        default_disk_bus: None,
        nic_prefix: "p".to_string(),
        default_ports: 1,
        default_vcpus: None,
        default_memory_mb: None,
        console_modes: vec!["inspector".to_string()],
    });

    items
}

// -----------------------------------------------------------------------------
// Phase 1b: Storage Settings, Volume Health & Library Migration IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
async fn get_storage_state(
    state: tauri::State<'_, StudioState>,
) -> Result<StorageStateSnapshot, String> {
    Ok(state.storage.refresh_and_snapshot().await)
}

#[tauri::command]
async fn retry_storage_detection(
    state: tauri::State<'_, StudioState>,
) -> Result<StorageStateSnapshot, String> {
    Ok(state.storage.refresh_and_snapshot().await)
}

#[tauri::command]
async fn fallback_to_default_storage(
    state: tauri::State<'_, StudioState>,
) -> Result<StorageStateSnapshot, String> {
    state.storage.fallback_to_default_internal().await
}

#[tauri::command]
async fn update_storage_location(
    state: tauri::State<'_, StudioState>,
    request: UpdateStorageRequest,
) -> Result<StorageMigrationResult, String> {
    // Safety guard: prevent relocating storage while VMs are actively running
    let active_vms = state
        .vm_manager
        .list_vms()
        .await
        .into_iter()
        .filter(|vm| {
            matches!(
                vm.status,
                vm_manager::VmStatus::Starting
                    | vm_manager::VmStatus::Running
                    | vm_manager::VmStatus::Stopping
            )
        })
        .count();
    if active_vms > 0 {
        return Err(format!(
            "Stop all {active_vms} running VM(s) before changing or migrating storage locations."
        ));
    }

    state.storage.update_storage_location(request).await
}

#[tauri::command]
fn probe_storage_path_telemetry(path: String) -> Result<DiskTelemetry, String> {
    let target = PathBuf::from(path.trim());
    let volumes_root = Path::new("/Volumes");
    if let Err(unmounted) = verify_volume_mounted_under(volumes_root, &target) {
        return Err(format!(
            "Volume '{}' is not mounted ({})",
            unmounted.volume_name, unmounted.expected_path
        ));
    }
    query_disk_telemetry(&target, volumes_root)
        .ok_or_else(|| format!("Unable to query disk telemetry for {}", target.display()))
}

// -----------------------------------------------------------------------------
// Image Store, OS Profiles & Portable qcow2 Auto-Rebase IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
fn list_os_profiles() -> Vec<OsProfile> {
    builtin_os_profiles()
}

#[tauri::command]
async fn list_base_templates(
    state: tauri::State<'_, StudioState>,
) -> Result<Vec<BaseTemplateInfo>, String> {
    state.image_store.list_templates().await
}

#[tauri::command]
async fn list_installer_isos(
    state: tauri::State<'_, StudioState>,
) -> Result<Vec<InstallerMediaInfo>, String> {
    state.image_store.list_isos().await
}

#[tauri::command]
async fn create_blank_vm_disk(
    state: tauri::State<'_, StudioState>,
    request: CreateBlankDiskRequest,
) -> Result<DiskInfo, String> {
    state.image_store.create_blank_disk(request).await
}

#[tauri::command]
async fn promote_disk_to_template(
    state: tauri::State<'_, StudioState>,
    request: PromoteTemplateRequest,
) -> Result<BaseTemplateInfo, String> {
    state.image_store.promote_to_base_template(request).await
}

#[tauri::command]
async fn create_node_overlay_disk(
    state: tauri::State<'_, StudioState>,
    request: CreateOverlayRequest,
) -> Result<DiskInfo, String> {
    state.image_store.create_node_overlay(request).await
}

#[tauri::command]
async fn reset_node_overlay_disk(
    state: tauri::State<'_, StudioState>,
    request: ResetOverlayRequest,
) -> Result<DiskInfo, String> {
    state.image_store.reset_node_overlay(request).await
}

#[tauri::command]
async fn ensure_overlay_rebased(
    state: tauri::State<'_, StudioState>,
    overlay_path: String,
    template_id: Option<String>,
) -> Result<OverlayRebaseReport, String> {
    state
        .image_store
        .ensure_overlay_rebased(Path::new(&overlay_path), template_id.as_deref())
        .await
}

#[tauri::command]
async fn rebase_project_overlays(
    state: tauri::State<'_, StudioState>,
    bindings: Vec<OverlayTemplateBinding>,
) -> Result<Vec<OverlayRebaseReport>, String> {
    state.image_store.rebase_project_overlays(bindings).await
}

// -----------------------------------------------------------------------------
// QEMU HVF Process Supervisor IPC Commands (`vm_manager.rs`)
// -----------------------------------------------------------------------------

#[tauri::command]
async fn spawn_vm(
    state: tauri::State<'_, StudioState>,
    request: SpawnVmRequest,
) -> Result<VmInstanceInfo, String> {
    state
        .vm_manager
        .spawn_vm(request, &state.fabric, &state.image_store)
        .await
}

#[tauri::command]
async fn stop_vm(
    state: tauri::State<'_, StudioState>,
    node_id: String,
    force: Option<bool>,
) -> Result<VmInstanceInfo, String> {
    state
        .vm_manager
        .stop_vm(&node_id, force.unwrap_or(false))
        .await
}

#[tauri::command]
async fn list_vms(state: tauri::State<'_, StudioState>) -> Result<Vec<VmInstanceInfo>, String> {
    Ok(state.vm_manager.list_vms().await)
}

#[tauri::command]
async fn get_vm_info(
    state: tauri::State<'_, StudioState>,
    node_id: String,
) -> Result<Option<VmInstanceInfo>, String> {
    Ok(state.vm_manager.get_vm_info(&node_id).await)
}

#[tauri::command]
fn preview_qemu_command(
    state: tauri::State<'_, StudioState>,
    request: SpawnVmRequest,
) -> Result<Vec<String>, String> {
    state.vm_manager.preview_command(&request)
}

// -----------------------------------------------------------------------------
// Userspace Packet Fabric & Virtual Switches IPC Commands (`fabric.rs`)
// -----------------------------------------------------------------------------

#[tauri::command]
async fn fabric_create_udp_port(
    state: tauri::State<'_, StudioState>,
    port_id: Option<String>,
    vm_port: Option<u16>,
) -> Result<UdpPortBinding, String> {
    state.fabric.create_udp_port(port_id, vm_port).await
}

#[tauri::command]
async fn fabric_remove_port(
    state: tauri::State<'_, StudioState>,
    port_id: String,
) -> Result<(), String> {
    state.fabric.remove_port(&port_id).await
}

#[tauri::command]
async fn fabric_create_switch(
    state: tauri::State<'_, StudioState>,
    switch_id: Option<String>,
    name: String,
    port_count: usize,
) -> Result<VirtualDeviceInfo, String> {
    state.fabric.create_switch(switch_id, name, port_count).await
}

#[tauri::command]
async fn fabric_create_hub(
    state: tauri::State<'_, StudioState>,
    hub_id: Option<String>,
    name: String,
    port_count: usize,
) -> Result<VirtualDeviceInfo, String> {
    state.fabric.create_hub(hub_id, name, port_count).await
}

#[tauri::command]
async fn fabric_remove_device(
    state: tauri::State<'_, StudioState>,
    device_id: String,
) -> Result<(), String> {
    state.fabric.remove_device(&device_id).await
}

#[tauri::command]
async fn fabric_create_link(
    state: tauri::State<'_, StudioState>,
    request: CreateLinkRequest,
) -> Result<LinkSnapshot, String> {
    state.fabric.create_link(request).await
}

#[tauri::command]
async fn fabric_update_link(
    state: tauri::State<'_, StudioState>,
    request: UpdateLinkRequest,
) -> Result<LinkSnapshot, String> {
    state.fabric.update_link(request).await
}

#[tauri::command]
async fn fabric_remove_link(
    state: tauri::State<'_, StudioState>,
    link_id: String,
) -> Result<(), String> {
    state.pcap_taps.stop_all_for_link(&link_id).await;
    state.fabric.remove_link(&link_id).await
}

#[tauri::command]
async fn fabric_list_links(
    state: tauri::State<'_, StudioState>,
) -> Result<Vec<LinkSnapshot>, String> {
    Ok(state.fabric.list_links().await)
}

#[tauri::command]
async fn fabric_get_switch_mac_table(
    state: tauri::State<'_, StudioState>,
    switch_id: String,
) -> Result<Vec<MacTableEntryDto>, String> {
    state.fabric.get_switch_mac_table(&switch_id).await
}

#[tauri::command]
async fn fabric_clear_switch_mac_table(
    state: tauri::State<'_, StudioState>,
    switch_id: String,
) -> Result<(), String> {
    state.fabric.clear_switch_mac_table(&switch_id).await
}

#[tauri::command]
async fn fabric_get_dhcp_leases(
    state: tauri::State<'_, StudioState>,
    device_id: String,
) -> Result<Vec<DhcpLeaseDto>, String> {
    state.fabric.get_dhcp_leases(&device_id).await
}

#[tauri::command]
async fn fabric_clear_dhcp_leases(
    state: tauri::State<'_, StudioState>,
    device_id: String,
) -> Result<(), String> {
    state.fabric.clear_dhcp_leases(&device_id).await
}

#[tauri::command]
async fn fabric_get_nat_sessions(
    state: tauri::State<'_, StudioState>,
    device_id: String,
) -> Result<Vec<NatSessionDto>, String> {
    state.fabric.get_nat_sessions(&device_id).await
}

#[tauri::command]
async fn fabric_clear_nat_sessions(
    state: tauri::State<'_, StudioState>,
    device_id: String,
) -> Result<(), String> {
    state.fabric.clear_nat_sessions(&device_id).await
}

// -----------------------------------------------------------------------------
// Phase 2: Project Persistence (`*.etherloom` / `topology.toml`) & Node Boot
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDiskStatusDto {
    pub disk_path: String,
    pub exists: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTopologyVmRequest {
    pub bundle_path: Option<String>,
    pub node: WorkspaceNode,
}

#[tauri::command]
async fn create_new_project(
    state: tauri::State<'_, StudioState>,
    bundle_path: String,
    name: String,
    notes: Option<String>,
) -> Result<ProjectBundleDto, String> {
    state.vm_manager.shutdown_all().await;
    state.fabric.reset().await;

    let doc = TopologyDocument {
        schema_version: workspace::TOPOLOGY_SCHEMA_VERSION,
        name: if name.trim().is_empty() {
            "Untitled Lab".to_string()
        } else {
            name.trim().to_string()
        },
        notes,
        created_at_ms: 0,
        updated_at_ms: 0,
        nodes: Vec::new(),
        links: Vec::new(),
    };

    workspace::save_project_bundle(
        SaveProjectRequest {
            bundle_path,
            copy_from_bundle: None,
            topology: doc,
        },
        &state.image_store,
        Path::new("/Volumes"),
    )
    .await
}

#[tauri::command]
async fn save_project(
    state: tauri::State<'_, StudioState>,
    mut request: SaveProjectRequest,
) -> Result<ProjectBundleDto, String> {
    // If saving an initially-unsaved scratch session into a bundle for the first time,
    // migrate any `/tmp/etherloom/scratch-overlays/<node>.qcow2` disks into `<bundle>/overlays/`.
    if request.copy_from_bundle.is_none() {
        if let Ok(target_bundle) = workspace::normalize_bundle_dir(&request.bundle_path) {
            let target_overlays = target_bundle.join("overlays");
            let _ = fs::create_dir_all(&target_overlays);
            for node in &mut request.topology.nodes {
                if node.kind == "vm" {
                    if let Ok(scratch_disk) = workspace::resolve_effective_node_disk(None, node) {
                        if let Ok(dest_disk) =
                            workspace::resolve_node_disk_in_bundle(&target_bundle, node)
                        {
                            if scratch_disk.is_file() && !dest_disk.is_file() && scratch_disk != dest_disk {
                                let _ = fs::copy(&scratch_disk, &dest_disk);
                            }
                            if dest_disk.is_file() || node.disk_path.is_none() {
                                if let Ok(rel) = dest_disk.strip_prefix(&target_bundle) {
                                    node.disk_path = Some(rel.to_string_lossy().replace('\\', "/"));
                                }
                            }
                        }
                    }
                }
            }

            let scratch_caps = PathBuf::from("/tmp/etherloom/scratch-captures");
            let target_caps = target_bundle.join("captures");
            if scratch_caps.is_dir() {
                let _ = fs::create_dir_all(&target_caps);
                if let Ok(entries) = fs::read_dir(&scratch_caps) {
                    for ent in entries.flatten() {
                        let p = ent.path();
                        if p.is_file() {
                            if let Some(name) = p.file_name() {
                                let dst = target_caps.join(name);
                                if !dst.exists() {
                                    let _ = fs::copy(&p, &dst);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    workspace::save_project_bundle(request, &state.image_store, Path::new("/Volumes")).await
}

#[tauri::command]
async fn open_project(
    state: tauri::State<'_, StudioState>,
    path: String,
) -> Result<ProjectBundleDto, String> {
    state.vm_manager.shutdown_all().await;
    let bundle =
        workspace::open_project_bundle(&path, &state.image_store, Path::new("/Volumes")).await?;
    let _ = workspace::sync_topology_to_fabric(&bundle.topology, &state.fabric, true).await;
    Ok(bundle)
}

#[tauri::command]
async fn reset_scratch_workspace(state: tauri::State<'_, StudioState>) -> Result<(), String> {
    state.vm_manager.shutdown_all().await;
    state.fabric.reset().await;
    Ok(())
}

#[tauri::command]
async fn sync_topology_fabric(
    state: tauri::State<'_, StudioState>,
    topology: TopologyDocument,
    reset_first: Option<bool>,
) -> Result<Vec<LinkSnapshot>, String> {
    workspace::sync_topology_to_fabric(&topology, &state.fabric, reset_first.unwrap_or(false)).await
}

#[tauri::command]
fn resolve_node_disk_path(
    bundle_path: Option<String>,
    node: WorkspaceNode,
) -> Result<NodeDiskStatusDto, String> {
    let p = workspace::resolve_effective_node_disk(bundle_path.as_deref(), &node)?;
    let (exists, size_bytes) = match fs::metadata(&p) {
        Ok(m) if m.is_file() => (true, m.len()),
        _ => (false, 0),
    };
    Ok(NodeDiskStatusDto {
        disk_path: p.display().to_string(),
        exists,
        size_bytes,
    })
}

#[tauri::command]
async fn start_topology_vm_node(
    state: tauri::State<'_, StudioState>,
    request: StartTopologyVmRequest,
) -> Result<VmInstanceInfo, String> {
    let node = request.node;
    if node.kind != "vm" {
        return Err(format!(
            "Node '{}' is '{}' and runs natively inside PacketFabric without QEMU.",
            node.name, node.kind
        ));
    }

    // Register Starting state & cancellation token immediately so clicking Stop while
    // qemu-img prepares overlays cancels cleanly instead of failing with "VM not found".
    let cancel_rx = state
        .vm_manager
        .begin_pre_spawn(&node.id, &node.name)
        .await?;

    let node_id_for_cleanup = node.id.clone();
    let prep_result: Result<(PathBuf, Option<String>, Option<String>), String> = async {
        let disk_path =
            workspace::resolve_effective_node_disk(request.bundle_path.as_deref(), &node)?;
        if let Some(parent) = disk_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to prepare overlay directory {}: {e}", parent.display())
            })?;
        }

        let mut template_id = node
            .template_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);
        let boot_media_path = node
            .boot_media_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);

        let templates = state.image_store.list_templates().await.unwrap_or_default();

        // Guard against nodes previously saved with a cross-profile template mismatch
        // (e.g. `os_profile_id == "debian-linux"` accidentally stamped with `alpine-aarch64-base`).
        if boot_media_path.is_none() {
            if let (Some(ref prof_id), Some(ref tid)) = (&node.os_profile_id, &template_id) {
                if let Some(tpl_prof) = catalog::template_ref_profile(tid, &templates) {
                    if tpl_prof != prof_id.as_str() {
                        template_id = None;
                    }
                }
            }
        }

        // If a node was dragged from Guest OS Profiles before downloading its OS image (or healed above),
        // auto-bind to a matching Base Template in `templates/` once downloaded so the user can boot immediately!
        if template_id.is_none() && boot_media_path.is_none() {
            if let Some(ref prof_id) = node.os_profile_id {
                if let Some(matched) = templates.iter().find(|t| t.os_profile_id == *prof_id) {
                    template_id = Some(matched.id.clone());
                }
            }
        }

        if *cancel_rx.borrow() {
            return Ok((disk_path, template_id, boot_media_path));
        }

        // If an overlay disk already exists on disk from a previous mismatched boot (e.g. `debian7.qcow2`
        // backed by `alpine-aarch64-base.qcow2` while `os_profile_id` is `"debian-linux"`), heal it!
        if disk_path.is_file() && boot_media_path.is_none() {
            if let Some(ref prof_id) = node.os_profile_id {
                if let Ok(disk_info) = state.image_store.inspect_disk(&disk_path).await {
                    if let Some(ref backing) = disk_info.backing_file {
                        if let Some(backing_prof) =
                            catalog::template_ref_profile(backing, &templates)
                        {
                            if backing_prof != prof_id.as_str() {
                                if let Some(ref valid_tpl_id) = template_id {
                                    state
                                        .image_store
                                        .reset_node_overlay(ResetOverlayRequest {
                                            overlay_path: disk_path.display().to_string(),
                                            backing_template_override: Some(valid_tpl_id.clone()),
                                        })
                                        .await?;
                                } else if !disk_info.read_only {
                                    let _ = fs::remove_file(&disk_path);
                                }
                            }
                        }
                    }
                }
            }
        }

        if !disk_path.is_file() {
            if let Some(ref tpl_id) = template_id {
                let overlays_dir = disk_path
                    .parent()
                    .ok_or_else(|| "Invalid node disk parent directory".to_string())?
                    .display()
                    .to_string();
                let stem = disk_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&node.id)
                    .to_string();
                state
                    .image_store
                    .create_node_overlay(CreateOverlayRequest {
                        template_id_or_path: tpl_id.clone(),
                        overlays_dir,
                        node_id: stem,
                    })
                    .await?;
            } else if boot_media_path.is_some() {
                state
                    .image_store
                    .create_blank_disk(CreateBlankDiskRequest {
                        disk_path: disk_path.display().to_string(),
                        size_gb: node.disk_size_gb.unwrap_or(8).max(1),
                    })
                    .await?;
            } else {
                let profile_label = node
                    .os_profile_id
                    .as_deref()
                    .and_then(find_os_profile)
                    .map(|p| p.name)
                    .unwrap_or_else(|| "an OS image".to_string());
                return Err(format!(
                    "Node '{}' has no OS disk image yet ({} is not downloaded in templates/). Open OS Library to download {}, or open Node Settings -> Storage to select a Base Template or attach an .iso / .img installer.",
                    node.name, profile_label, profile_label
                ));
            }
        }

        Ok((disk_path, template_id, boot_media_path))
    }
    .await;

    let (disk_path, template_id, boot_media_path) = match prep_result {
        Ok(vals) => vals,
        Err(err) => {
            state
                .vm_manager
                .abort_pre_spawn(&node_id_for_cleanup, Some(err.clone()))
                .await;
            return Err(err);
        }
    };

    if *cancel_rx.borrow() {
        return Ok(state
            .vm_manager
            .abort_pre_spawn(&node_id_for_cleanup, None)
            .await);
    }

    let display_mode = match node.display_mode.as_deref() {
        Some("cocoa") => VmDisplayMode::Cocoa,
        _ => VmDisplayMode::Vnc,
    };
    let boot_media_bus = match node.boot_media_bus.as_deref() {
        Some("cdrom") => BootMediaBus::Cdrom,
        Some("usb") => BootMediaBus::Usb,
        _ => BootMediaBus::Auto,
    };

    // Resolve multi-architecture hardware defaults from explicit node config -> OS profile -> sensible defaults
    let prof_meta = node.os_profile_id.as_deref().and_then(find_os_profile);
    let arch = node
        .arch
        .as_deref()
        .map(GuestArch::from_str_lossy)
        .or_else(|| prof_meta.as_ref().map(|p| p.arch))
        .unwrap_or(GuestArch::Aarch64);
    let nic_model = node
        .nic_model
        .as_deref()
        .map(NicModel::from_str_lossy)
        .or_else(|| prof_meta.as_ref().map(|p| p.default_nic_model))
        .unwrap_or(NicModel::VirtioNetPci);
    let firmware = node
        .firmware
        .as_deref()
        .map(FirmwareType::from_str_lossy)
        .or_else(|| prof_meta.as_ref().map(|p| p.default_firmware))
        .unwrap_or_else(|| match arch {
            GuestArch::Aarch64 => FirmwareType::Uefi,
            _ => FirmwareType::Bios,
        });
    let disk_bus = node
        .disk_bus
        .as_deref()
        .map(DiskBus::from_str_lossy)
        .or_else(|| prof_meta.as_ref().map(|p| p.default_disk_bus))
        .unwrap_or(DiskBus::VirtioBlk);

    let default_ram = prof_meta
        .as_ref()
        .map(|p| p.default_ram_mb)
        .unwrap_or(512);
    let default_cpus = prof_meta.as_ref().map(|p| p.default_cpus).unwrap_or(2);

    let nics: Vec<VmNicConfig> = node
        .ports
        .iter()
        .map(|p| VmNicConfig {
            port_id: Some(p.id.clone()),
            mac: p.mac.clone(),
            nic_model: p
                .nic_model
                .as_deref()
                .map(NicModel::from_str_lossy)
                .or(Some(nic_model)),
            fabric_port: None,
            vm_port: None,
        })
        .collect();

    state
        .vm_manager
        .spawn_vm_with_cancel(
            SpawnVmRequest {
                node_id: node.id,
                name: node.name,
                cpus: node.vcpus.unwrap_or(default_cpus).max(1),
                ram_mb: node.memory_mb.unwrap_or(default_ram).max(16),
                disk_path: disk_path.display().to_string(),
                os_profile_id: node.os_profile_id.clone(),
                template_id,
                boot_media_path,
                boot_media_bus,
                display_mode,
                vnc_port_offset: None,
                arch,
                nic_model,
                firmware,
                disk_bus,
                nics,
                bios_path_override: None,
                finalize_template_on_exit: None,
            },
            &state.fabric,
            &state.image_store,
            Some(cancel_rx),
        )
        .await
}

// -----------------------------------------------------------------------------
// Phase 3: Unified Serial (`xterm.js`) & UEFI/VNC (`@novnc/novnc`) Console Bridge
// -----------------------------------------------------------------------------

#[tauri::command]
async fn console_get_session_endpoints(
    state: tauri::State<'_, StudioState>,
    node_id: String,
) -> Result<ConsoleSessionEndpoints, String> {
    state
        .console_bridge
        .session_endpoints(&node_id, &state.vm_manager)
        .await
}

#[tauri::command]
async fn console_attach_serial_channel(
    state: tauri::State<'_, StudioState>,
    node_id: String,
    channel: tauri::ipc::Channel<Vec<u8>>,
) -> Result<(), String> {
    state
        .console_bridge
        .attach_serial_channel(&node_id, channel)
        .await
}

#[tauri::command]
async fn console_write_serial(
    state: tauri::State<'_, StudioState>,
    node_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.console_bridge.write_serial_bytes(&node_id, &data).await
}

#[tauri::command]
async fn console_send_serial_break(
    state: tauri::State<'_, StudioState>,
    node_id: String,
) -> Result<(), String> {
    state.console_bridge.send_serial_break(&node_id).await
}

#[tauri::command]
async fn console_send_ctrl_alt_del(
    state: tauri::State<'_, StudioState>,
    node_id: String,
) -> Result<(), String> {
    state.console_bridge.send_ctrl_alt_del(&node_id).await
}

#[tauri::command]
async fn console_focus_cocoa_window(
    state: tauri::State<'_, StudioState>,
    node_id: String,
) -> Result<(), String> {
    state
        .console_bridge
        .focus_cocoa_window(&node_id, &state.vm_manager)
        .await
}

// -----------------------------------------------------------------------------
// Phase 4: Zero-Root Wiretaps (`.pcap` + Live Wireshark FIFO) & `tcpflowy` Bridge
// -----------------------------------------------------------------------------

fn resolve_effective_captures_dir(bundle_path: Option<&str>) -> Result<PathBuf, String> {
    match bundle_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(bp) => {
            let bundle_dir = workspace::normalize_bundle_dir(bp)?;
            verify_volume_mounted_under(Path::new("/Volumes"), &bundle_dir).map_err(|u| {
                format!(
                    "External volume '{}' is disconnected ({})",
                    u.volume_name, u.expected_path
                )
            })?;
            Ok(bundle_dir.join("captures"))
        }
        None => Ok(PathBuf::from("/tmp/etherloom/scratch-captures")),
    }
}

#[tauri::command]
async fn pcap_start_recording(
    state: tauri::State<'_, StudioState>,
    bundle_path: Option<String>,
    link_id: String,
    link_label: Option<String>,
    endpoint_a: Option<String>,
    endpoint_b: Option<String>,
) -> Result<StartPcapRecordingResult, String> {
    let captures_dir = resolve_effective_captures_dir(bundle_path.as_deref())?;
    let rx = state.fabric.subscribe_link_tap(&link_id).await?;

    let fabric_for_pkt = state.fabric.clone();
    let link_for_pkt = link_id.clone();
    let fabric_for_stop = state.fabric.clone();
    let link_for_stop = link_id.clone();

    let started = state
        .pcap_taps
        .start_file_recording_with_endpoints(
            &link_id,
            endpoint_a.as_deref(),
            endpoint_b.as_deref(),
            link_label.as_deref(),
            &captures_dir,
            rx,
            move |pkts, bytes| {
                let fb = fabric_for_pkt.clone();
                let lid = link_for_pkt.clone();
                tokio::spawn(async move {
                    fb.update_link_pcap_counters(&lid, pkts, bytes).await;
                });
            },
            move || {
                let fb = fabric_for_stop.clone();
                let lid = link_for_stop.clone();
                tokio::spawn(async move {
                    fb.set_link_pcap_state(&lid, false, None, 0, 0).await;
                });
            },
        )
        .await?;

    state
        .fabric
        .set_link_pcap_state(&link_id, true, Some(started.path.clone()), 0, 24)
        .await;

    Ok(started)
}

#[tauri::command]
async fn stop_wire_capture(
    state: tauri::State<'_, StudioState>,
    link_id: String,
) -> Result<CaptureSummary, String> {
    let stopped = state.pcap_taps.stop_file_recording(&link_id).await?;
    state
        .fabric
        .set_link_pcap_state(&link_id, false, None, 0, 0)
        .await;
    Ok(stopped)
}

#[tauri::command]
async fn pcap_stop_recording(
    state: tauri::State<'_, StudioState>,
    link_id: String,
) -> Result<StopPcapRecordingResult, String> {
    stop_wire_capture(state, link_id).await
}

#[tauri::command]
async fn pcap_start_live_wireshark(
    state: tauri::State<'_, StudioState>,
    link_id: String,
) -> Result<LiveWiresharkSessionInfo, String> {
    let rx = state.fabric.subscribe_link_tap(&link_id).await?;
    let fb_detach = state.fabric.clone();
    let lid_detach = link_id.clone();

    let session = state
        .pcap_taps
        .start_live_wireshark_stream(&link_id, rx, true, move || {
            let fb = fb_detach.clone();
            let lid = lid_detach.clone();
            tokio::spawn(async move {
                fb.set_link_live_wireshark_state(&lid, false).await;
            });
        })
        .await?;

    state
        .fabric
        .set_link_live_wireshark_state(&link_id, true)
        .await;
    Ok(session)
}

#[tauri::command]
async fn pcap_stop_live_wireshark(
    state: tauri::State<'_, StudioState>,
    link_id: String,
) -> Result<(), String> {
    state.pcap_taps.stop_live_wireshark_stream(&link_id).await?;
    state
        .fabric
        .set_link_live_wireshark_state(&link_id, false)
        .await;
    Ok(())
}

#[tauri::command]
async fn pcap_list_captures(
    state: tauri::State<'_, StudioState>,
    bundle_path: Option<String>,
) -> Result<Vec<CaptureFileInfo>, String> {
    let captures_dir = resolve_effective_captures_dir(bundle_path.as_deref())?;
    let active_map = state.pcap_taps.active_recording_paths().await;
    Ok(list_captures_in_dir(&captures_dir, &active_map))
}

#[tauri::command]
async fn pcap_delete_capture(pcap_path: String) -> Result<(), String> {
    let path = PathBuf::from(pcap_path.trim());
    // Only packet-capture files may be deleted through this command.
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "pcap" && ext != "pcapng" {
        return Err(format!(
            "Refusing to delete '{}': not a .pcap/.pcapng capture file",
            path.display()
        ));
    }
    if path.is_file() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed deleting '{}': {e}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
fn pcap_open_in_wireshark(pcap_path: String) -> Result<String, String> {
    open_pcap_file_in_wireshark(Path::new(pcap_path.trim()))
}

#[tauri::command]
async fn open_pcap_in_wireshark(
    state: tauri::State<'_, StudioState>,
    pcap_path: String,
) -> Result<(), String> {
    let env_hint = {
        let guard = state.last_env_report.read().await;
        guard.as_ref().and_then(|r| r.wireshark.path.clone())
    };
    open_pcap_in_wireshark_with_hint(Path::new(pcap_path.trim()), env_hint.as_deref()).map(|_| ())
}

#[tauri::command]
async fn export_pcap_copy(
    source_pcap_path: String,
    destination_path: String,
) -> Result<(), String> {
    let src = PathBuf::from(source_pcap_path.trim());
    let dst = PathBuf::from(destination_path.trim());
    tokio::task::spawn_blocking(move || export_pcap_copy_to_path(&src, &dst))
        .await
        .map_err(|e| format!("PCAP export task join error: {e}"))?
        .map(|_| ())
}

#[tauri::command]
fn reveal_pcap_in_finder(pcap_path: String) -> Result<(), String> {
    reveal_pcap_file_in_finder(Path::new(pcap_path.trim()))
}

#[tauri::command]
async fn tcpflowy_get_status(
    state: tauri::State<'_, StudioState>,
) -> Result<TcpflowyEnvStatus, String> {
    Ok(state.tcpflowy.status().await)
}

#[tauri::command]
async fn tcpflowy_install_or_upgrade(
    state: tauri::State<'_, StudioState>,
) -> Result<TcpflowyEnvStatus, String> {
    state.tcpflowy.install_or_upgrade_tcpflowy().await
}

#[tauri::command]
async fn tcpflowy_set_local_repo_path(
    state: tauri::State<'_, StudioState>,
    repo_path: Option<String>,
) -> Result<TcpflowyEnvStatus, String> {
    state.tcpflowy.set_local_repo_path(repo_path).await
}

#[tauri::command]
async fn tcpflowy_dissect_pcap(
    state: tauri::State<'_, StudioState>,
    request: DissectPcapRequest,
) -> Result<TcpflowyDissectionReport, String> {
    state.tcpflowy.dissect_pcap(request).await
}

// -----------------------------------------------------------------------------
// Phase 5: Interactive Networking Academy & Guided Labs IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
async fn academy_list_labs(
    state: tauri::State<'_, StudioState>,
) -> Result<Vec<AcademyLabSummary>, String> {
    let templates = state.image_store.list_templates().await.unwrap_or_default();
    let resolved = state.storage.resolved_paths().await;
    let custom_labs = resolved.storage_root.join("labs");
    list_academy_labs(&templates, Some(&custom_labs))
}

#[tauri::command]
async fn academy_get_lab(
    state: tauri::State<'_, StudioState>,
    lab_id: String,
) -> Result<AcademyLabDetail, String> {
    let templates = state.image_store.list_templates().await.unwrap_or_default();
    let resolved = state.storage.resolved_paths().await;
    let custom_labs = resolved.storage_root.join("labs");
    get_academy_lab_detail(&lab_id, &templates, Some(&custom_labs))
}

#[tauri::command]
async fn academy_instantiate_lab(
    state: tauri::State<'_, StudioState>,
    lab_id: String,
    reset_clean: Option<bool>,
) -> Result<InstantiatedLabDto, String> {
    // Gracefully stop all active VMs & wiretaps before instantiating/resetting a clean lab sandbox
    state.vm_manager.shutdown_all().await;
    state.pcap_taps.stop_all().await;

    let resolved = state.storage.resolved_paths().await;
    let custom_labs = resolved.storage_root.join("labs");
    let instantiated = instantiate_academy_lab(
        &lab_id,
        &resolved.workspaces_dir,
        Some(&custom_labs),
        &state.image_store,
        Path::new("/Volumes"),
        reset_clean.unwrap_or(true),
    )
    .await?;

    // Sync PacketFabric switches, hubs, UDP endpoints, and impaired wires immediately
    let _ = workspace::sync_topology_to_fabric(&instantiated.bundle.topology, &state.fabric, true)
        .await;

    Ok(instantiated)
}

// -----------------------------------------------------------------------------
// Phase 6: Supported OS Catalog, On-Demand Download Engine & Finder Helpers
// -----------------------------------------------------------------------------

#[tauri::command]
async fn catalog_list_entries(
    state: tauri::State<'_, StudioState>,
) -> Result<Vec<OsCatalogEntryDto>, String> {
    let (host_arch, hvf_supported) = {
        let guard = state.last_env_report.read().await;
        match guard.as_ref() {
            Some(rep) => (rep.host_arch.clone(), rep.hvf_supported),
            None => (
                std::env::consts::ARCH.to_string(),
                std::env::consts::OS == "macos",
            ),
        }
    };
    state
        .catalog
        .list_catalog(&state.image_store, &host_arch, hvf_supported)
        .await
}

#[tauri::command]
async fn catalog_start_download(
    state: tauri::State<'_, StudioState>,
    request: CatalogDownloadRequest,
) -> Result<(), String> {
    state
        .catalog
        .start_download(request, state.storage.clone(), state.image_store.clone())
        .await
}

#[tauri::command]
async fn catalog_cancel_download(
    state: tauri::State<'_, StudioState>,
    catalog_id: String,
) -> Result<bool, String> {
    state.catalog.cancel_download(&catalog_id).await
}

#[tauri::command]
async fn catalog_import_local_file(
    state: tauri::State<'_, StudioState>,
    request: CatalogImportLocalRequest,
) -> Result<OsCatalogEntryDto, String> {
    state
        .catalog
        .import_local_file(request, &state.storage, &state.image_store)
        .await
}

#[tauri::command]
async fn catalog_delete_image(
    state: tauri::State<'_, StudioState>,
    catalog_id: String,
    force: Option<bool>,
) -> Result<DeleteCatalogImageResult, String> {
    state
        .catalog
        .delete_image(
            &catalog_id,
            force.unwrap_or(false),
            &state.image_store,
            &state.vm_manager,
        )
        .await
}

#[tauri::command]
async fn catalog_launch_guided_setup(
    state: tauri::State<'_, StudioState>,
    catalog_id: String,
) -> Result<VmInstanceInfo, String> {
    state
        .catalog
        .launch_guided_setup(
            &catalog_id,
            &state.storage,
            &state.image_store,
            &state.fabric,
            &state.vm_manager,
        )
        .await
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    reveal_path_in_finder(&path)
}

#[tauri::command]
async fn sample_activity_monitor(
    state: tauri::State<'_, StudioState>,
) -> Result<ActivityMonitorSnapshot, String> {
    Ok(state
        .activity_monitor
        .sample(&state.vm_manager, &state.fabric)
        .await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StudioState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<StudioState>();
            state.fabric.spawn_telemetry_loop(handle.clone());

            let vm_mgr = state.vm_manager.clone();
            let storage_mgr = state.storage.clone();
            let catalog_mgr = state.catalog.clone();
            let console_br = state.console_bridge.clone();
            let tcpflowy_mgr = state.tcpflowy.clone();
            tauri::async_runtime::spawn(async move {
                vm_mgr.bind_app_handle(handle.clone()).await;
                storage_mgr.bind_app_handle(handle.clone()).await;
                catalog_mgr.bind_app_handle(handle.clone()).await;
                tcpflowy_mgr.bind_app_handle(handle).await;
                let _ = console_br.ensure_started(vm_mgr).await;
                // Gracefully evaluate storage mount state on startup (never panics if external SSD is unplugged!)
                let _ = storage_mgr.refresh_and_snapshot().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_env_doctor,
            get_env_status,
            get_component_catalog,
            get_storage_state,
            retry_storage_detection,
            fallback_to_default_storage,
            update_storage_location,
            probe_storage_path_telemetry,
            list_os_profiles,
            list_base_templates,
            list_installer_isos,
            create_blank_vm_disk,
            promote_disk_to_template,
            create_node_overlay_disk,
            reset_node_overlay_disk,
            ensure_overlay_rebased,
            rebase_project_overlays,
            spawn_vm,
            stop_vm,
            list_vms,
            get_vm_info,
            preview_qemu_command,
            fabric_create_udp_port,
            fabric_remove_port,
            fabric_create_switch,
            fabric_create_hub,
            fabric_remove_device,
            fabric_create_link,
            fabric_update_link,
            fabric_remove_link,
            fabric_list_links,
            fabric_get_switch_mac_table,
            fabric_clear_switch_mac_table,
            fabric_get_dhcp_leases,
            fabric_clear_dhcp_leases,
            fabric_get_nat_sessions,
            fabric_clear_nat_sessions,
            create_new_project,
            save_project,
            open_project,
            reset_scratch_workspace,
            sync_topology_fabric,
            resolve_node_disk_path,
            start_topology_vm_node,
            console_get_session_endpoints,
            console_attach_serial_channel,
            console_write_serial,
            console_send_serial_break,
            console_send_ctrl_alt_del,
            console_focus_cocoa_window,
            pcap_start_recording,
            stop_wire_capture,
            pcap_stop_recording,
            pcap_start_live_wireshark,
            pcap_stop_live_wireshark,
            pcap_list_captures,
            pcap_delete_capture,
            pcap_open_in_wireshark,
            open_pcap_in_wireshark,
            export_pcap_copy,
            reveal_pcap_in_finder,
            tcpflowy_get_status,
            tcpflowy_install_or_upgrade,
            tcpflowy_set_local_repo_path,
            tcpflowy_dissect_pcap,
            academy_list_labs,
            academy_get_lab,
            academy_instantiate_lab,
            catalog_list_entries,
            catalog_start_download,
            catalog_cancel_download,
            catalog_import_local_file,
            catalog_delete_image,
            catalog_launch_guided_setup,
            reveal_in_finder,
            sample_activity_monitor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Etherloom Tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<StudioState>();
            tauri::async_runtime::block_on(state.vm_manager.shutdown_all());
        }
    });
}
