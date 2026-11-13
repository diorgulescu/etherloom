use crate::env_doctor::resolve_qemu_img;
use crate::storage::StorageManager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use uuid::Uuid;

/// Built-in Guest OS Profile preset defining NIC naming conventions and default compute sizing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OsProfile {
    pub id: String,
    pub name: String,
    pub guest_family: String,
    pub nic_prefix: String,
    pub nic_naming_pattern: String,
    pub alt_nic_naming_pattern: Option<String>,
    pub default_ram_mb: u32,
    pub default_cpus: u8,
    pub recommended_disk_gb: u32,
    pub notes: String,
}

impl OsProfile {
    /// Formats the canonical guest interface name for NIC index `n` (0-based).
    pub fn format_nic(&self, index: usize) -> String {
        format!("{}{}", self.nic_prefix, index)
    }
}

/// Returns the 5 built-in OS Profile presets defined in Phase 1.
pub fn builtin_os_profiles() -> Vec<OsProfile> {
    vec![
        OsProfile {
            id: "alpine-linux".to_string(),
            name: "Alpine Linux".to_string(),
            guest_family: "linux".to_string(),
            nic_prefix: "eth".to_string(),
            nic_naming_pattern: "eth{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 256,
            default_cpus: 1,
            recommended_disk_gb: 4,
            notes: "Lightweight musl/BusyBox Linux router & host (virtio-net eth0..n)".to_string(),
        },
        OsProfile {
            id: "debian-linux".to_string(),
            name: "Debian / Generic Linux".to_string(),
            guest_family: "linux".to_string(),
            nic_prefix: "eth".to_string(),
            nic_naming_pattern: "enp0s{n} / eth{n}".to_string(),
            alt_nic_naming_pattern: Some("enp0s{n}".to_string()),
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 10,
            notes: "Systemd / FRRouting / Linux network stack (predictable enp0s* or eth*)"
                .to_string(),
        },
        OsProfile {
            id: "freebsd".to_string(),
            name: "FreeBSD".to_string(),
            guest_family: "freebsd".to_string(),
            nic_prefix: "vtnet".to_string(),
            nic_naming_pattern: "vtnet{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 12,
            notes: "FreeBSD ARM64 UEFI guest with virtio vtnet0..n & VNET jails".to_string(),
        },
        OsProfile {
            id: "openbsd".to_string(),
            name: "OpenBSD".to_string(),
            guest_family: "openbsd".to_string(),
            nic_prefix: "vio".to_string(),
            nic_naming_pattern: "vio{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 512,
            default_cpus: 2,
            recommended_disk_gb: 8,
            notes: "OpenBSD ARM64 UEFI guest with pf, bgpd, ospfd & vio0..n".to_string(),
        },
        OsProfile {
            id: "netbsd".to_string(),
            name: "NetBSD".to_string(),
            guest_family: "netbsd".to_string(),
            nic_prefix: "vioif".to_string(),
            nic_naming_pattern: "vioif{n}".to_string(),
            alt_nic_naming_pattern: None,
            default_ram_mb: 256,
            default_cpus: 1,
            recommended_disk_gb: 6,
            notes: "NetBSD evbarm-aarch64 UEFI guest with npf & vioif0..n".to_string(),
        },
    ]
}

/// Metadata stored alongside a Golden Image inside active `templates_dir`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseTemplateInfo {
    pub id: String,
    pub name: String,
    pub os_profile_id: String,
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

    fn resolve_qemu_img_bin(&self) -> Option<PathBuf> {
        self.qemu_img_override.clone().or_else(resolve_qemu_img)
    }

    fn require_qemu_img(&self) -> Result<PathBuf, String> {
        self.resolve_qemu_img_bin().ok_or_else(|| {
            "qemu-img was not found in /opt/homebrew/bin, /usr/local/bin, or PATH. Install QEMU via `brew install qemu`.".to_string()
        })
    }

    async fn run_qemu_img(&self, args: &[String]) -> Result<String, String> {
        let bin = self.require_qemu_img()?;
        let output = Command::new(&bin)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
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

    /// Inspects a disk file using `qemu-img info --output=json` when available, falling back to filesystem metadata.
    pub async fn inspect_disk(&self, disk_path: &Path) -> Result<DiskInfo, String> {
        let meta = fs::metadata(disk_path)
            .map_err(|e| format!("Disk {} does not exist: {e}", disk_path.display()))?;
        let read_only = meta.permissions().readonly();

        if self.resolve_qemu_img_bin().is_some() {
            let args = vec![
                "info".to_string(),
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

        // Also guard against unmounted `/Volumes/...` destination paths
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

        let template = BaseTemplateInfo {
            id: template_id.clone(),
            name: req.template_name.trim().to_string(),
            os_profile_id: req.os_profile_id,
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

    /// Resolves a logical `template_id` / filename (or explicit `.qcow2` path) against the active `templates_dir`.
    pub async fn resolve_template_backing_path(&self, id_or_path: &str) -> Result<PathBuf, String> {
        let ready_paths = self.storage.require_ready_paths().await?;
        resolve_template_in_dir(&ready_paths.templates_dir, id_or_path)
    }

    /// Instantiates an instant Copy-on-Write (`qcow2 -b <backing_file> -F qcow2`) per-node overlay disk
    /// inside a project's `overlays/` folder.
    pub async fn create_node_overlay(&self, req: CreateOverlayRequest) -> Result<DiskInfo, String> {
        let ready_paths = self.storage.require_ready_paths().await?;
        let backing_path = resolve_template_in_dir(&ready_paths.templates_dir, &req.template_id_or_path)?;

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
    /// `qemu-img rebase -u -b <resolved_template_path> -F qcow2 <overlay_path>`
    /// so moved libraries, external SSD mount changes, or cross-Mac lab sharing work seamlessly.
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

        // Determine logical template filename from explicit node metadata or existing qcow2 header
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
            // Standalone non-CoW VM disk (e.g. direct ISO install disk without a backing template)
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

        // Execute unsafe header-only rebase (`-u`) so `qemu-img` does not attempt to open the stale/missing path
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

            templates.push(BaseTemplateInfo {
                id: stem.clone(),
                name: stem,
                os_profile_id: "debian-linux".to_string(),
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

    // If an old relocated absolute path was passed, fall back to its filename inside `templates_dir`
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

fn slugify_name(input: &str) -> String {
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
    fn os_profiles_match_architecture_conventions() {
        let profiles = builtin_os_profiles();
        assert_eq!(profiles.len(), 5);

        let alpine = profiles.iter().find(|p| p.id == "alpine-linux").unwrap();
        assert_eq!(alpine.default_ram_mb, 256);
        assert_eq!(alpine.format_nic(0), "eth0");

        let debian = profiles.iter().find(|p| p.id == "debian-linux").unwrap();
        assert_eq!(debian.default_ram_mb, 512);
        assert_eq!(debian.nic_naming_pattern, "enp0s{n} / eth{n}");

        let freebsd = profiles.iter().find(|p| p.id == "freebsd").unwrap();
        assert_eq!(freebsd.default_ram_mb, 512);
        assert_eq!(freebsd.format_nic(1), "vtnet1");

        let openbsd = profiles.iter().find(|p| p.id == "openbsd").unwrap();
        assert_eq!(openbsd.default_ram_mb, 512);
        assert_eq!(openbsd.format_nic(2), "vio2");

        let netbsd = profiles.iter().find(|p| p.id == "netbsd").unwrap();
        assert_eq!(netbsd.default_ram_mb, 256);
        assert_eq!(netbsd.format_nic(0), "vioif0");
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

    /// End-to-end portable `qcow2` relocation & `qemu-img rebase -u` verification test.
    /// Uses a deterministic mock `qemu-img` script that strictly enforces `-u` unsafe mode
    /// when the previous backing file path has been deleted/unmounted!
    #[tokio::test]
    async fn portable_qcow2_auto_rebases_when_templates_move_to_external_drive() {
        let tmp = std::env::temp_dir().join(format!("etherloom-rebase-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        // Create a self-contained mock `qemu-img` python3 script supporting `create`, `info --output=json`, and `rebase -u`
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
    # Real `qemu-img rebase` WITHOUT `-u` tries to open `old_backing` and fails if it moved!
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

        // 1. Create a base template in the initial internal `templates_dir`
        let old_tpl_path = PathBuf::from(&initial_snap.resolved_templates_dir).join("openbsd-76.qcow2");
        fs::write(&old_tpl_path, r#"{"virtual_size": 8589934592}"#).unwrap();
        let canon_old_tpl = fs::canonicalize(&old_tpl_path).unwrap();

        // 2. Create a per-node CoW overlay inside a project folder
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
        assert!(overlay.backing_file.as_ref().unwrap().ends_with("openbsd-76.qcow2"));

        // 3. Relocate the entire template library to a simulated external SSD AND delete the old internal path!
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

        // 4. Before rebase, the overlay still points to the deleted internal path
        let stale_info = store.inspect_disk(&overlay_path).await.unwrap();
        assert_eq!(
            PathBuf::from(stale_info.backing_file.unwrap()),
            canon_old_tpl
        );

        // 5. Run `ensure_overlay_rebased` (called automatically before VM start & on project load)
        let report = store
            .ensure_overlay_rebased(&overlay_path, Some("openbsd-76"))
            .await
            .unwrap();
        assert!(report.rebased, "overlay should be auto-rebased via qemu-img rebase -u");

        let expected_new_tpl =
            fs::canonicalize(external_ssd_root.join("templates/openbsd-76.qcow2")).unwrap();
        assert_eq!(
            PathBuf::from(report.active_backing.unwrap()),
            expected_new_tpl
        );

        // 6. Calling `ensure_overlay_rebased` a second time is an idempotent no-op (`rebased == false`)
        let second = store
            .ensure_overlay_rebased(&overlay_path, Some("openbsd-76"))
            .await
            .unwrap();
        assert!(!second.rebased);

        let _ = fs::remove_dir_all(&tmp);
    }
}
