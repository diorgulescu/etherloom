use crate::fabric::{CreateLinkRequest, LinkSnapshot, PacketFabric, UpdateLinkRequest};
use crate::images::{ImageStore, OverlayTemplateBinding};
use crate::storage::verify_volume_mounted_under;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const TOPOLOGY_SCHEMA_VERSION: u32 = 1;
pub const TOPOLOGY_FILENAME: &str = "topology.toml";

/// 2D canvas coordinate stored in `topology.toml`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// Per-NIC / switch-port definition serialized in `topology.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePort {
    pub id: String,
    pub index: usize,
    pub label: String,
    pub mac: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Node definition (VM, L2 Switch, or L1 Hub) serialized in `topology.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceNode {
    pub id: String,
    pub name: String,
    /// `"vm"` | `"l2_switch"` | `"l1_hub"`
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guest_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub os_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    /// Relative path inside bundle (e.g. `overlays/fw1.qcow2`) or absolute override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disk_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disk_size_gb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boot_media_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boot_media_bus: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vcpus: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_mb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub position: NodePosition,
    #[serde(default)]
    pub ports: Vec<WorkspacePort>,
}

/// Per-link impairment parameters serialized under `[links.impairments]`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceLinkImpairments {
    #[serde(default)]
    pub latency_ms: u32,
    #[serde(default)]
    pub jitter_ms: u32,
    #[serde(default)]
    pub loss_percent: f64,
}

impl Default for WorkspaceLinkImpairments {
    fn default() -> Self {
        Self {
            latency_ms: 0,
            jitter_ms: 0,
            loss_percent: 0.0,
        }
    }
}

/// Point-to-point cable connecting two ports in `topology.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceLink {
    pub id: String,
    pub source_node: String,
    pub source_port: String,
    pub target_node: String,
    pub target_port: String,
    #[serde(default = "default_true")]
    pub admin_up: bool,
    #[serde(default)]
    pub impairments: WorkspaceLinkImpairments,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_schema_ver() -> u32 {
    TOPOLOGY_SCHEMA_VERSION
}

/// Root document structure serialized to `<project>.etherloom/topology.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TopologyDocument {
    #[serde(default = "default_schema_ver")]
    pub schema_version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub created_at_ms: u64,
    #[serde(default)]
    pub updated_at_ms: u64,
    #[serde(default)]
    pub nodes: Vec<WorkspaceNode>,
    #[serde(default)]
    pub links: Vec<WorkspaceLink>,
}

/// Loaded / saved `.etherloom` project bundle returned over Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBundleDto {
    pub bundle_path: String,
    pub topology_file: String,
    pub overlays_dir: String,
    pub captures_dir: String,
    pub rebased_overlays: usize,
    pub topology: TopologyDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectRequest {
    /// Target `.etherloom` bundle path (if missing `.etherloom` suffix, normalized automatically).
    pub bundle_path: String,
    /// Optional previous `.etherloom` bundle path when executing `Save As...` so overlays/captures are copied.
    pub copy_from_bundle: Option<String>,
    pub topology: TopologyDocument,
}

/// Normalizes a user-chosen path so the bundle directory ends with `.etherloom`.
/// If the user selected `.../foo.etherloom/topology.toml`, strips `topology.toml` to get the bundle dir.
pub fn normalize_bundle_dir(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Project path cannot be empty".to_string());
    }

    let p = PathBuf::from(trimmed);
    if p.file_name().and_then(|s| s.to_str()) == Some(TOPOLOGY_FILENAME) {
        let parent = p
            .parent()
            .ok_or_else(|| "Invalid topology.toml parent path".to_string())?;
        return Ok(parent.to_path_buf());
    }

    let has_etherloom_ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("etherloom"))
        .unwrap_or(false);

    if has_etherloom_ext {
        Ok(p)
    } else {
        let mut with_ext = p.into_os_string();
        with_ext.push(".etherloom");
        Ok(PathBuf::from(with_ext))
    }
}

/// Resolves a node's `.qcow2` disk path inside `bundle_dir/overlays/{node_id}.qcow2` (or honors relative/abs path).
pub fn resolve_node_disk_in_bundle(bundle_dir: &Path, node: &WorkspaceNode) -> PathBuf {
    if let Some(ref raw) = node.disk_path {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_absolute() {
                return candidate;
            }
            return bundle_dir.join(candidate);
        }
    }
    let safe_id: String = node
        .id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    bundle_dir.join("overlays").join(format!("{safe_id}.qcow2"))
}

/// Converts any absolute path inside `bundle_dir` into a portable relative path (e.g. `overlays/fw1.qcow2`)
/// before writing `topology.toml`, keeping the project bundle Git-friendly and portable across Macs.
fn relativize_node_paths(bundle_dir: &Path, doc: &mut TopologyDocument) {
    let canon_bundle = fs::canonicalize(bundle_dir).unwrap_or_else(|_| bundle_dir.to_path_buf());
    for node in &mut doc.nodes {
        if let Some(ref raw_disk) = node.disk_path.clone() {
            let dp = PathBuf::from(raw_disk);
            if dp.is_absolute() {
                if let Ok(rel) = dp.strip_prefix(bundle_dir) {
                    node.disk_path = Some(rel.to_string_lossy().replace('\\', "/"));
                } else if let Ok(canon_dp) = fs::canonicalize(&dp) {
                    if let Ok(rel) = canon_dp.strip_prefix(&canon_bundle) {
                        node.disk_path = Some(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
    }
}

/// Saves (or `Save As` clones) a complete `.etherloom` project workspace atomically.
pub async fn save_project_bundle(
    req: SaveProjectRequest,
    image_store: &ImageStore,
    volumes_root: &Path,
) -> Result<ProjectBundleDto, String> {
    let bundle_dir = normalize_bundle_dir(&req.bundle_path)?;

    if let Err(unmounted) = verify_volume_mounted_under(volumes_root, &bundle_dir) {
        return Err(format!(
            "Target volume '{}' is not mounted ({})",
            unmounted.volume_name, unmounted.expected_path
        ));
    }

    let overlays_dir = bundle_dir.join("overlays");
    let captures_dir = bundle_dir.join("captures");
    fs::create_dir_all(&overlays_dir)
        .map_err(|e| format!("Failed to create {}: {e}", overlays_dir.display()))?;
    fs::create_dir_all(&captures_dir)
        .map_err(|e| format!("Failed to create {}: {e}", captures_dir.display()))?;

    // If `Save As...` specified a different source bundle, copy existing overlays & captures
    if let Some(ref src_raw) = req.copy_from_bundle {
        if let Ok(src_bundle) = normalize_bundle_dir(src_raw) {
            if src_bundle.is_dir() && !same_dir(&src_bundle, &bundle_dir) {
                copy_dir_shallow(&src_bundle.join("overlays"), &overlays_dir)?;
                copy_dir_shallow(&src_bundle.join("captures"), &captures_dir)?;
            }
        }
    }

    let now = now_epoch_ms();
    let mut doc = req.topology;
    doc.schema_version = TOPOLOGY_SCHEMA_VERSION;
    if doc.created_at_ms == 0 {
        doc.created_at_ms = now;
    }
    doc.updated_at_ms = now;
    relativize_node_paths(&bundle_dir, &mut doc);

    let toml_text = format!(
        "# Etherloom Network Topology (GPL-3.0)\n# Portable declarative lab specification\n\n{}",
        toml::to_string_pretty(&doc)
            .map_err(|e| format!("Failed to serialize topology.toml: {e}"))?
    );

    let topology_file = bundle_dir.join(TOPOLOGY_FILENAME);
    let tmp_file = bundle_dir.join(".topology.toml.tmp");
    fs::write(&tmp_file, toml_text.as_bytes())
        .map_err(|e| format!("Failed to write {}: {e}", tmp_file.display()))?;
    fs::rename(&tmp_file, &topology_file)
        .map_err(|e| format!("Failed to commit {}: {e}", topology_file.display()))?;

    let rebased_overlays = auto_rebase_bundle_overlays(&bundle_dir, &doc, image_store).await;

    Ok(ProjectBundleDto {
        bundle_path: bundle_dir.display().to_string(),
        topology_file: topology_file.display().to_string(),
        overlays_dir: overlays_dir.display().to_string(),
        captures_dir: captures_dir.display().to_string(),
        rebased_overlays,
        topology: doc,
    })
}

/// Opens an existing `*.etherloom` folder (or its `topology.toml`), parses the topology, ensures
/// `overlays/` and `captures/` exist, and auto-rebases any relocated CoW `.qcow2` overlays.
pub async fn open_project_bundle(
    path: &str,
    image_store: &ImageStore,
    volumes_root: &Path,
) -> Result<ProjectBundleDto, String> {
    let raw = PathBuf::from(path.trim());
    let bundle_dir = if raw.file_name().and_then(|s| s.to_str()) == Some(TOPOLOGY_FILENAME) {
        raw.parent()
            .ok_or_else(|| "Invalid topology.toml path".to_string())?
            .to_path_buf()
    } else {
        raw
    };

    if let Err(unmounted) = verify_volume_mounted_under(volumes_root, &bundle_dir) {
        return Err(format!(
            "Project volume '{}' is disconnected ({})",
            unmounted.volume_name, unmounted.expected_path
        ));
    }

    if !bundle_dir.is_dir() {
        return Err(format!(
            "Project bundle directory does not exist: {}",
            bundle_dir.display()
        ));
    }

    let topology_file = bundle_dir.join(TOPOLOGY_FILENAME);
    if !topology_file.is_file() {
        return Err(format!(
            "No {} found inside {}",
            TOPOLOGY_FILENAME,
            bundle_dir.display()
        ));
    }

    let raw_toml = fs::read_to_string(&topology_file)
        .map_err(|e| format!("Failed to read {}: {e}", topology_file.display()))?;
    let doc: TopologyDocument = toml::from_str(&raw_toml)
        .map_err(|e| format!("Invalid topology.toml syntax: {e}"))?;

    let overlays_dir = bundle_dir.join("overlays");
    let captures_dir = bundle_dir.join("captures");
    let _ = fs::create_dir_all(&overlays_dir);
    let _ = fs::create_dir_all(&captures_dir);

    let rebased_overlays = auto_rebase_bundle_overlays(&bundle_dir, &doc, image_store).await;

    Ok(ProjectBundleDto {
        bundle_path: bundle_dir.display().to_string(),
        topology_file: topology_file.display().to_string(),
        overlays_dir: overlays_dir.display().to_string(),
        captures_dir: captures_dir.display().to_string(),
        rebased_overlays,
        topology: doc,
    })
}

/// Resolves a VM node's effective `.qcow2` disk path whether the project is saved in a `.etherloom`
/// bundle or currently running in an unsaved scratch session (`/tmp/etherloom/scratch-overlays`).
pub fn resolve_effective_node_disk(bundle_path: Option<&str>, node: &WorkspaceNode) -> Result<PathBuf, String> {
    if let Some(bp) = bundle_path.map(str::trim).filter(|s| !s.is_empty()) {
        let bundle_dir = normalize_bundle_dir(bp)?;
        return Ok(resolve_node_disk_in_bundle(&bundle_dir, node));
    }

    if let Some(ref raw) = node.disk_path {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_absolute() {
                return Ok(p);
            }
        }
    }

    let safe_id: String = node
        .id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let scratch_dir = PathBuf::from("/tmp/etherloom/scratch-overlays");
    fs::create_dir_all(&scratch_dir)
        .map_err(|e| format!("Failed to create {}: {e}", scratch_dir.display()))?;
    Ok(scratch_dir.join(format!("{safe_id}.qcow2")))
}

/// Idempotently synchronizes the live `PacketFabric` (virtual switches, hubs, VM UDP endpoints,
/// and point-to-point wires + impairments) with the declarative `TopologyDocument`.
pub async fn sync_topology_to_fabric(
    doc: &TopologyDocument,
    fabric: &PacketFabric,
    reset_first: bool,
) -> Result<Vec<LinkSnapshot>, String> {
    if reset_first {
        fabric.reset().await;
    }

    // 1. Ensure virtual switches, virtual hubs, and VM UDP ports exist
    for node in &doc.nodes {
        match node.kind.as_str() {
            "l2_switch" | "l1_hub" => {
                let port_count = node.ports.len().max(1);
                fabric
                    .ensure_virtual_device(&node.id, &node.name, &node.kind, port_count)
                    .await?;
            }
            "vm" => {
                for port in &node.ports {
                    let _ = fabric.ensure_udp_port(&port.id).await?;
                }
            }
            _ => {}
        }
    }

    // 2. Prune removed or re-wired links
    let desired_ids: HashSet<String> = doc.links.iter().map(|l| l.id.clone()).collect();
    let current_links = fabric.list_links().await;
    let mut reusable_ids = HashSet::new();

    for cur in current_links {
        if !desired_ids.contains(&cur.id) {
            let _ = fabric.remove_link(&cur.id).await;
            continue;
        }
        if let Some(target) = doc.links.iter().find(|l| l.id == cur.id) {
            let same_endpoints = (cur.port_a == target.source_port
                && cur.port_b == target.target_port)
                || (cur.port_a == target.target_port && cur.port_b == target.source_port);
            if same_endpoints {
                reusable_ids.insert(cur.id);
            } else {
                let _ = fabric.remove_link(&cur.id).await;
            }
        }
    }

    // 3. Create or update all desired links & impairments
    for link in &doc.links {
        if reusable_ids.contains(&link.id) {
            let _ = fabric
                .update_link(UpdateLinkRequest {
                    link_id: link.id.clone(),
                    admin_up: Some(link.admin_up),
                    latency_ms: Some(link.impairments.latency_ms),
                    jitter_ms: Some(link.impairments.jitter_ms),
                    loss_percent: Some(link.impairments.loss_percent),
                })
                .await?;
        } else {
            let _ = fabric
                .create_link(CreateLinkRequest {
                    link_id: Some(link.id.clone()),
                    port_a: link.source_port.clone(),
                    port_b: link.target_port.clone(),
                    admin_up: Some(link.admin_up),
                    latency_ms: Some(link.impairments.latency_ms),
                    jitter_ms: Some(link.impairments.jitter_ms),
                    loss_percent: Some(link.impairments.loss_percent),
                })
                .await?;
        }
    }

    Ok(fabric.list_links().await)
}

async fn auto_rebase_bundle_overlays(
    bundle_dir: &Path,
    doc: &TopologyDocument,
    image_store: &ImageStore,
) -> usize {
    let bindings: Vec<OverlayTemplateBinding> = doc
        .nodes
        .iter()
        .filter(|n| n.kind == "vm")
        .map(|n| {
            let disk = resolve_node_disk_in_bundle(bundle_dir, n);
            OverlayTemplateBinding {
                node_id: Some(n.id.clone()),
                overlay_path: disk.display().to_string(),
                template_id: n.template_id.clone(),
            }
        })
        .collect();

    match image_store.rebase_project_overlays(bindings).await {
        Ok(reports) => reports.into_iter().filter(|r| r.rebased).count(),
        Err(_) => 0,
    }
}

fn copy_dir_shallow(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let entries = fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(fname) = p.file_name() {
                let target = dst.join(fname);
                fs::copy(&p, &target).map_err(|e| {
                    format!(
                        "Failed to copy {} to {}: {e}",
                        p.display(),
                        target.display()
                    )
                })?;
            }
        }
    }
    Ok(())
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
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
    use crate::storage::StorageManager;
    use uuid::Uuid;

    #[tokio::test]
    async fn saves_and_reloads_etherloom_workspace_bundle_with_ports_ip_labels_and_impairments() {
        let tmp = std::env::temp_dir().join(format!("etherloom-ws-test-{}", Uuid::new_v4()));
        let storage = StorageManager::new(tmp.join("AppSupport"), tmp.join("FakeVolumes"));
        let _ = storage.refresh_and_snapshot().await;
        let image_store = ImageStore::new(storage);
        let fake_volumes = tmp.join("FakeVolumes");
        fs::create_dir_all(&fake_volumes).unwrap();

        let bundle_target = tmp.join("projects/campus-bgp"); // lacks `.etherloom`, should normalize!
        let doc = TopologyDocument {
            schema_version: 1,
            name: "Campus Dual-Stack BGP".to_string(),
            notes: Some("OSPF + eBGP edge firewall lab".to_string()),
            created_at_ms: 0,
            updated_at_ms: 0,
            nodes: vec![
                WorkspaceNode {
                    id: "node-fw1".to_string(),
                    name: "fw1".to_string(),
                    kind: "vm".to_string(),
                    guest_family: Some("openbsd".to_string()),
                    os_profile_id: Some("openbsd".to_string()),
                    template_id: Some("openbsd-76".to_string()),
                    disk_path: Some("overlays/node-fw1.qcow2".to_string()),
                    disk_size_gb: Some(8),
                    boot_media_path: None,
                    boot_media_bus: Some("auto".to_string()),
                    vcpus: Some(2),
                    memory_mb: Some(512),
                    display_mode: Some("vnc".to_string()),
                    notes: Some("Primary pf + bgpd router".to_string()),
                    position: NodePosition { x: 140.0, y: 200.0 },
                    ports: vec![WorkspacePort {
                        id: "fw1-p0".to_string(),
                        index: 0,
                        label: "vio0".to_string(),
                        mac: "52:54:00:10:01:00".to_string(),
                        ip_label: Some("10.0.1.1/24".to_string()),
                        notes: Some("LAN trunk".to_string()),
                    }],
                },
                WorkspaceNode {
                    id: "node-sw1".to_string(),
                    name: "sw-core".to_string(),
                    kind: "l2_switch".to_string(),
                    guest_family: None,
                    os_profile_id: None,
                    template_id: None,
                    disk_path: None,
                    disk_size_gb: None,
                    boot_media_path: None,
                    boot_media_bus: None,
                    vcpus: None,
                    memory_mb: None,
                    display_mode: None,
                    notes: None,
                    position: NodePosition { x: 460.0, y: 200.0 },
                    ports: vec![WorkspacePort {
                        id: "sw1-p0".to_string(),
                        index: 0,
                        label: "p1".to_string(),
                        mac: "52:54:00:20:01:00".to_string(),
                        ip_label: None,
                        notes: None,
                    }],
                },
            ],
            links: vec![WorkspaceLink {
                id: "link-1".to_string(),
                source_node: "node-fw1".to_string(),
                source_port: "fw1-p0".to_string(),
                target_node: "node-sw1".to_string(),
                target_port: "sw1-p0".to_string(),
                admin_up: true,
                impairments: WorkspaceLinkImpairments {
                    latency_ms: 12,
                    jitter_ms: 3,
                    loss_percent: 1.5,
                },
                notes: Some("10G fiber".to_string()),
            }],
        };

        let saved = save_project_bundle(
            SaveProjectRequest {
                bundle_path: bundle_target.display().to_string(),
                copy_from_bundle: None,
                topology: doc,
            },
            &image_store,
            &fake_volumes,
        )
        .await
        .unwrap();

        assert!(saved.bundle_path.ends_with("campus-bgp.etherloom"));
        assert!(Path::new(&saved.overlays_dir).is_dir());
        assert!(Path::new(&saved.captures_dir).is_dir());
        assert!(Path::new(&saved.topology_file).is_file());

        // Reload via `topology.toml` file path directly
        let reopened = open_project_bundle(&saved.topology_file, &image_store, &fake_volumes)
            .await
            .unwrap();
        assert_eq!(reopened.topology.name, "Campus Dual-Stack BGP");
        assert_eq!(reopened.topology.nodes.len(), 2);
        assert_eq!(
            reopened.topology.nodes[0].ports[0].ip_label.as_deref(),
            Some("10.0.1.1/24")
        );
        assert_eq!(reopened.topology.links[0].impairments.latency_ms, 12);
        assert_eq!(reopened.topology.links[0].impairments.loss_percent, 1.5);

        let _ = fs::remove_dir_all(&tmp);
    }
}
