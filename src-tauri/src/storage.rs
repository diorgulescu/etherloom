use crate::env_doctor::etherloom_app_support_dir;
use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

const SETTINGS_FILENAME: &str = "settings.toml";
const PYTHON_VENV_DIRNAME: &str = "python-env";
const DEFAULT_LIBRARY_DIRNAME: &str = "Library";
const RUNTIME_TMP_DIR: &str = "/tmp/etherloom";
const COPY_CHUNK_BYTES: usize = 1024 * 1024; // 1 MiB streaming buffer

/// Top-level `settings.toml` schema stored strictly on internal SSD
/// (`~/Library/Application Support/Etherloom/settings.toml`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsFile {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub storage: StorageConfigToml,
}

fn default_schema_version() -> u32 {
    1
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            storage: StorageConfigToml::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageConfigToml {
    pub storage_root: Option<String>,
    pub templates_dir: Option<String>,
    pub isos_dir: Option<String>,
    pub workspaces_dir: Option<String>,
}

/// User-configurable heavy media paths exposed over IPC (`camelCase`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub storage_root: String,
    pub templates_dir_override: Option<String>,
    pub isos_dir_override: Option<String>,
    pub workspaces_dir_override: Option<String>,
}

/// Effective resolved paths for both fixed local state and relocatable heavy media.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStoragePaths {
    /// Fixed local config file (`~/Library/Application Support/Etherloom/settings.toml`)
    pub settings_file: String,
    /// Fixed local Python venv (`~/Library/Application Support/Etherloom/python-env`)
    pub python_env_dir: String,
    /// Fixed short `/tmp/etherloom` socket & FIFO directory
    pub runtime_sockets_dir: String,
    /// Active primary heavy-media root
    pub storage_root: PathBuf,
    /// Effective read-only base `.qcow2` templates directory
    pub templates_dir: PathBuf,
    /// Effective `.iso` / `.img` installer media directory
    pub isos_dir: PathBuf,
    /// Effective default parent folder for `*.etherloom` lab workspaces
    pub workspaces_dir: PathBuf,
}

/// Health status of the configured heavy storage volume.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum StorageStatus {
    #[serde(rename_all = "camelCase")]
    Ready,
    #[serde(rename_all = "camelCase")]
    VolumeDisconnected {
        expected_path: String,
        volume_name: String,
    },
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

/// Filesystem & capacity telemetry queried via macOS `statfs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskTelemetry {
    pub probed_path: String,
    pub filesystem_type: String,
    pub free_bytes: u64,
    pub total_bytes: u64,
    pub is_external_volume: bool,
    pub is_exfat: bool,
    pub advisory_tip: Option<String>,
}

/// Full storage snapshot returned to the frontend UI and emitted on `"etherloom://storage-status"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStateSnapshot {
    pub config: StorageConfig,
    pub default_storage_root: String,
    pub settings_file: String,
    pub python_env_dir: String,
    pub runtime_sockets_dir: String,
    pub resolved_templates_dir: String,
    pub resolved_isos_dir: String,
    pub resolved_workspaces_dir: String,
    pub status: StorageStatus,
    pub disk_telemetry: Option<DiskTelemetry>,
}

/// How to apply a storage location change in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMigrationMode {
    SwitchOnly,
    MoveExistingData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStorageRequest {
    pub storage_root: String,
    pub templates_dir_override: Option<String>,
    pub isos_dir_override: Option<String>,
    pub workspaces_dir_override: Option<String>,
    pub mode: StorageMigrationMode,
    #[serde(default)]
    pub delete_source_after_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationResult {
    pub snapshot: StorageStateSnapshot,
    pub files_copied: usize,
    pub bytes_copied: u64,
    pub source_cleaned: bool,
    pub templates_discovered: usize,
    pub isos_discovered: usize,
}

/// Live streaming event emitted on `"etherloom://storage-migration-progress"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationProgress {
    pub phase: String,
    pub current_file: String,
    pub files_completed: usize,
    pub total_files: usize,
    pub bytes_copied: u64,
    pub total_bytes: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnmountedVolumeError {
    pub expected_path: String,
    pub volume_name: String,
}

/// Verifies that if `target_path` resides under `volumes_root` (e.g. `/Volumes/<VolumeName>/...`),
/// `<VolumeName>` is an actively mounted filesystem and NOT a missing or unmounted stub directory.
///
/// Never creates any files or directories.
pub fn verify_volume_mounted_under(
    volumes_root: &Path,
    target_path: &Path,
) -> Result<(), UnmountedVolumeError> {
    let Ok(rel) = target_path.strip_prefix(volumes_root) else {
        // Path is not under `/Volumes`, e.g. internal `~/Library/...` or `/tmp/...`
        return Ok(());
    };

    let mut comps = rel.components();
    let volume_name = match comps.next() {
        Some(Component::Normal(os)) if !os.is_empty() => os.to_string_lossy().into_owned(),
        _ => {
            return Err(UnmountedVolumeError {
                expected_path: target_path.display().to_string(),
                volume_name: "Volumes".to_string(),
            });
        }
    };

    let volume_mount_point = volumes_root.join(&volume_name);

    // Inspect the mount point without creating anything
    let symlink_meta = match fs::symlink_metadata(&volume_mount_point) {
        Ok(m) => m,
        Err(_) => {
            return Err(UnmountedVolumeError {
                expected_path: target_path.display().to_string(),
                volume_name,
            });
        }
    };

    // macOS creates a symlink `/Volumes/Macintosh HD -> /` for the boot drive
    if symlink_meta.file_type().is_symlink() {
        if let Ok(canon) = fs::canonicalize(&volume_mount_point) {
            if canon == Path::new("/") || canon.exists() {
                return Ok(());
            }
        }
        return Err(UnmountedVolumeError {
            expected_path: target_path.display().to_string(),
            volume_name,
        });
    }

    let vol_meta = match fs::metadata(&volume_mount_point) {
        Ok(m) if m.is_dir() => m,
        _ => {
            return Err(UnmountedVolumeError {
                expected_path: target_path.display().to_string(),
                volume_name,
            });
        }
    };

    let volumes_root_meta = match fs::metadata(volumes_root) {
        Ok(m) => m,
        Err(_) => {
            return Err(UnmountedVolumeError {
                expected_path: target_path.display().to_string(),
                volume_name,
            });
        }
    };

    // Crucial POSIX mount check: a mounted volume at `/Volumes/<Name>` has a distinct `st_dev`
    // from `/Volumes` itself. An unmounted leftover directory shares `/Volumes`'s `st_dev`.
    if vol_meta.dev() == volumes_root_meta.dev() {
        return Err(UnmountedVolumeError {
            expected_path: target_path.display().to_string(),
            volume_name,
        });
    }

    Ok(())
}

/// Queries macOS `statfs` on `target_path` (or its nearest existing ancestor) to obtain
/// available disk bytes, total capacity, and kernel filesystem type (`apfs`, `exfat`, `hfs`, etc.).
pub fn query_disk_telemetry(target_path: &Path, volumes_root: &Path) -> Option<DiskTelemetry> {
    if verify_volume_mounted_under(volumes_root, target_path).is_err() {
        return None;
    }

    // Walk up ancestors until we hit an existing directory on the mounted volume
    let existing = target_path.ancestors().find(|p| p.exists())?;
    let c_path = CString::new(existing.as_os_str().as_bytes()).ok()?;

    let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        return None;
    }

    let block_size = stat.f_bsize as u64;
    let free_bytes = stat.f_bavail.saturating_mul(block_size);
    let total_bytes = stat.f_blocks.saturating_mul(block_size);

    let fs_type = unsafe {
        CStr::from_ptr(stat.f_fstypename.as_ptr())
            .to_string_lossy()
            .trim()
            .to_lowercase()
    };

    let is_external = existing.starts_with(volumes_root)
        && fs::symlink_metadata(existing)
            .map(|m| !m.file_type().is_symlink())
            .unwrap_or(true);
    let is_exfat = fs_type == "exfat" || fs_type == "msdos";
    let advisory_tip = is_exfat.then(|| {
        "External drive is formatted as ExFAT. While fully supported, APFS provides better Copy-on-Write sparse .qcow2 space efficiency.".to_string()
    });

    Some(DiskTelemetry {
        probed_path: existing.display().to_string(),
        filesystem_type: fs_type,
        free_bytes,
        total_bytes,
        is_external_volume: is_external,
        is_exfat,
        advisory_tip,
    })
}

struct StorageInner {
    app_support_dir: PathBuf,
    volumes_root: PathBuf,
    config: RwLock<StorageConfig>,
    last_status: RwLock<StorageStatus>,
    app_handle: RwLock<Option<AppHandle>>,
}

/// Manages split local runtime state (`settings.toml`, `python-env/`, `/tmp/etherloom/`) vs.
/// user-relocatable heavy media (`templates_dir`, `isos_dir`, `workspaces_dir`).
#[derive(Clone)]
pub struct StorageManager {
    inner: Arc<StorageInner>,
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::new(etherloom_app_support_dir(), PathBuf::from("/Volumes"))
    }
}

impl StorageManager {
    pub fn new(app_support_dir: PathBuf, volumes_root: PathBuf) -> Self {
        let default_root = app_support_dir.join(DEFAULT_LIBRARY_DIRNAME);
        let settings_path = app_support_dir.join(SETTINGS_FILENAME);

        let loaded_cfg = load_config_from_disk(&settings_path, &default_root);

        let mgr = Self {
            inner: Arc::new(StorageInner {
                app_support_dir,
                volumes_root,
                config: RwLock::new(loaded_cfg),
                last_status: RwLock::new(StorageStatus::Ready),
                app_handle: RwLock::new(None),
            }),
        };

        // Ensure fixed internal directories (`~/Library/Application Support/Etherloom/python-env` & `/tmp/etherloom`)
        let _ = mgr.ensure_internal_local_dirs();
        mgr
    }

    pub async fn bind_app_handle(&self, handle: AppHandle) {
        let mut guard = self.inner.app_handle.write().await;
        *guard = Some(handle);
    }

    pub fn default_storage_root(&self) -> PathBuf {
        self.inner.app_support_dir.join(DEFAULT_LIBRARY_DIRNAME)
    }

    pub fn settings_file_path(&self) -> PathBuf {
        self.inner.app_support_dir.join(SETTINGS_FILENAME)
    }

    pub fn python_env_dir(&self) -> PathBuf {
        self.inner.app_support_dir.join(PYTHON_VENV_DIRNAME)
    }

    pub fn runtime_sockets_dir(&self) -> PathBuf {
        PathBuf::from(RUNTIME_TMP_DIR)
    }

    /// Creates only the lightweight internal directories on the local SSD (`app_support_dir`,
    /// `python-env/`, and `/tmp/etherloom`). Never touches `/Volumes/...`.
    pub fn ensure_internal_local_dirs(&self) -> Result<(), String> {
        fs::create_dir_all(&self.inner.app_support_dir).map_err(|e| {
            format!(
                "Failed to create internal config dir {}: {e}",
                self.inner.app_support_dir.display()
            )
        })?;
        fs::create_dir_all(self.python_env_dir()).map_err(|e| {
            format!(
                "Failed to create internal python-env dir {}: {e}",
                self.python_env_dir().display()
            )
        })?;
        let sock_dir = self.runtime_sockets_dir();
        fs::create_dir_all(&sock_dir)
            .map_err(|e| format!("Failed to create {}: {e}", sock_dir.display()))?;
        if let Ok(meta) = fs::metadata(&sock_dir) {
            let mut perms = meta.permissions();
            perms.set_mode(0o700);
            let _ = fs::set_permissions(&sock_dir, perms);
        }
        Ok(())
    }

    /// Resolves current `StorageConfig` into concrete directory paths without touching the filesystem.
    pub async fn resolved_paths(&self) -> ResolvedStoragePaths {
        let cfg = self.inner.config.read().await.clone();
        self.resolve_for_config(&cfg)
    }

    pub fn resolve_for_config(&self, cfg: &StorageConfig) -> ResolvedStoragePaths {
        let root = normalize_trimmed_path(&cfg.storage_root)
            .unwrap_or_else(|| self.default_storage_root());
        let templates_dir = cfg
            .templates_dir_override
            .as_deref()
            .and_then(normalize_trimmed_path)
            .unwrap_or_else(|| root.join("templates"));
        let isos_dir = cfg
            .isos_dir_override
            .as_deref()
            .and_then(normalize_trimmed_path)
            .unwrap_or_else(|| root.join("isos"));
        let workspaces_dir = cfg
            .workspaces_dir_override
            .as_deref()
            .and_then(normalize_trimmed_path)
            .unwrap_or_else(|| root.join("projects"));

        ResolvedStoragePaths {
            settings_file: self.settings_file_path().display().to_string(),
            python_env_dir: self.python_env_dir().display().to_string(),
            runtime_sockets_dir: self.runtime_sockets_dir().display().to_string(),
            storage_root: root,
            templates_dir,
            isos_dir,
            workspaces_dir,
        }
    }

    /// Checks volume mount status and (if and only if mounted!) ensures `templates_dir`, `isos_dir`,
    /// and `workspaces_dir` exist. Never panics; gracefully reports `StorageStatus::VolumeDisconnected`.
    pub async fn refresh_and_snapshot(&self) -> StorageStateSnapshot {
        let cfg = self.inner.config.read().await.clone();
        let resolved = self.resolve_for_config(&cfg);

        // 1. Run Unmounted Volume Guard across all configured heavy directories BEFORE any mkdir!
        let check_targets = [
            &resolved.storage_root,
            &resolved.templates_dir,
            &resolved.isos_dir,
            &resolved.workspaces_dir,
        ];

        let mut status = StorageStatus::Ready;
        for target in check_targets {
            if let Err(unmounted) =
                verify_volume_mounted_under(&self.inner.volumes_root, target)
            {
                status = StorageStatus::VolumeDisconnected {
                    expected_path: unmounted.expected_path,
                    volume_name: unmounted.volume_name,
                };
                break;
            }
        }

        // 2. Only create heavy directories if volume guard passed
        if status == StorageStatus::Ready {
            for dir in [
                &resolved.storage_root,
                &resolved.templates_dir,
                &resolved.isos_dir,
                &resolved.workspaces_dir,
            ] {
                if let Err(e) = fs::create_dir_all(dir) {
                    status = StorageStatus::Error {
                        message: format!("Unable to create directory {}: {e}", dir.display()),
                    };
                    break;
                }
            }
        }

        let disk_telemetry = if status == StorageStatus::Ready {
            query_disk_telemetry(&resolved.storage_root, &self.inner.volumes_root)
        } else {
            None
        };

        {
            let mut guard = self.inner.last_status.write().await;
            *guard = status.clone();
        }

        let snapshot = StorageStateSnapshot {
            config: cfg,
            default_storage_root: self.default_storage_root().display().to_string(),
            settings_file: resolved.settings_file,
            python_env_dir: resolved.python_env_dir,
            runtime_sockets_dir: resolved.runtime_sockets_dir,
            resolved_templates_dir: resolved.templates_dir.display().to_string(),
            resolved_isos_dir: resolved.isos_dir.display().to_string(),
            resolved_workspaces_dir: resolved.workspaces_dir.display().to_string(),
            status,
            disk_telemetry,
        };

        self.emit_status_snapshot(&snapshot).await;
        snapshot
    }

    /// Guard helper called by `ImageStore` before reading/writing heavy directories.
    pub async fn require_ready_paths(&self) -> Result<ResolvedStoragePaths, String> {
        let snapshot = self.refresh_and_snapshot().await;
        match snapshot.status {
            StorageStatus::Ready => Ok(self.resolved_paths().await),
            StorageStatus::VolumeDisconnected {
                expected_path,
                volume_name,
            } => Err(format!(
                "External storage volume '{volume_name}' is disconnected ({expected_path}). Reconnect the drive, choose another folder, or fallback to internal storage."
            )),
            StorageStatus::Error { message } => Err(message),
        }
    }

    /// Resets `StorageConfig` back to the default internal SSD path
    /// (`~/Library/Application Support/Etherloom/Library`) and persists `settings.toml`.
    pub async fn fallback_to_default_internal(&self) -> Result<StorageStateSnapshot, String> {
        let default_cfg = StorageConfig {
            storage_root: self.default_storage_root().display().to_string(),
            templates_dir_override: None,
            isos_dir_override: None,
            workspaces_dir_override: None,
        };
        self.save_config_to_disk(&default_cfg)?;
        {
            let mut guard = self.inner.config.write().await;
            *guard = default_cfg;
        }
        Ok(self.refresh_and_snapshot().await)
    }

    /// Updates `StorageConfig` using either `SwitchOnly` or `MoveExistingData` (with live progress events,
    /// file size verification, `settings.toml` persistence, and optional source cleanup).
    pub async fn update_storage_location(
        &self,
        req: UpdateStorageRequest,
    ) -> Result<StorageMigrationResult, String> {
        let new_cfg = StorageConfig {
            storage_root: req.storage_root.trim().to_string(),
            templates_dir_override: clean_optional(&req.templates_dir_override),
            isos_dir_override: clean_optional(&req.isos_dir_override),
            workspaces_dir_override: clean_optional(&req.workspaces_dir_override),
        };

        if new_cfg.storage_root.is_empty() {
            return Err("storage_root cannot be empty".to_string());
        }

        let target_resolved = self.resolve_for_config(&new_cfg);

        // Verify target volume is actually mounted BEFORE creating any directories
        for target in [
            &target_resolved.storage_root,
            &target_resolved.templates_dir,
            &target_resolved.isos_dir,
            &target_resolved.workspaces_dir,
        ] {
            if let Err(unmounted) =
                verify_volume_mounted_under(&self.inner.volumes_root, target)
            {
                return Err(format!(
                    "Target volume '{}' is not mounted ({})",
                    unmounted.volume_name, unmounted.expected_path
                ));
            }
        }

        let old_resolved = self.resolved_paths().await;

        // Create target directories now that mount check passed
        for dir in [
            &target_resolved.storage_root,
            &target_resolved.templates_dir,
            &target_resolved.isos_dir,
            &target_resolved.workspaces_dir,
        ] {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create target directory {}: {e}", dir.display()))?;
        }

        let mut files_copied = 0usize;
        let mut bytes_copied = 0u64;
        let mut source_cleaned = false;

        if req.mode == StorageMigrationMode::MoveExistingData {
            let plan = build_migration_plan(&old_resolved, &target_resolved)?;
            let total_bytes: u64 = plan.iter().map(|item| item.size_bytes).sum();
            let total_files = plan.len();

            if total_bytes > 0 {
                if let Some(telemetry) = query_disk_telemetry(
                    &target_resolved.storage_root,
                    &self.inner.volumes_root,
                ) {
                    if telemetry.free_bytes < total_bytes {
                        return Err(format!(
                            "Insufficient free space on target volume ({:.2} GB required, {:.2} GB available)",
                            (total_bytes as f64) / 1_073_741_824.0,
                            (telemetry.free_bytes as f64) / 1_073_741_824.0,
                        ));
                    }
                }
            }

            let mut verified_sources: Vec<PathBuf> = Vec::with_capacity(total_files);

            for (idx, item) in plan.iter().enumerate() {
                self.emit_migration_progress(StorageMigrationProgress {
                    phase: "copying".to_string(),
                    current_file: item.file_name.clone(),
                    files_completed: idx,
                    total_files,
                    bytes_copied,
                    total_bytes,
                    percent: compute_percent(bytes_copied, total_bytes, idx, total_files),
                })
                .await;

                // If destination already exists and is read-only from an earlier attempt, make writable first
                if let Ok(existing_meta) = fs::metadata(&item.dest_path) {
                    if existing_meta.permissions().readonly() {
                        let mut perms = existing_meta.permissions();
                        perms.set_mode(0o644);
                        let _ = fs::set_permissions(&item.dest_path, perms);
                    }
                }

                let mut src_file = tokio::fs::File::open(&item.src_path)
                    .await
                    .map_err(|e| format!("Failed to open {}: {e}", item.src_path.display()))?;
                let mut dst_file = tokio::fs::File::create(&item.dest_path)
                    .await
                    .map_err(|e| format!("Failed to create {}: {e}", item.dest_path.display()))?;

                let mut buf = vec![0u8; COPY_CHUNK_BYTES];
                loop {
                    let n = src_file
                        .read(&mut buf)
                        .await
                        .map_err(|e| format!("Read error on {}: {e}", item.src_path.display()))?;
                    if n == 0 {
                        break;
                    }
                    dst_file
                        .write_all(&buf[..n])
                        .await
                        .map_err(|e| format!("Write error on {}: {e}", item.dest_path.display()))?;
                    bytes_copied = bytes_copied.saturating_add(n as u64);

                    self.emit_migration_progress(StorageMigrationProgress {
                        phase: "copying".to_string(),
                        current_file: item.file_name.clone(),
                        files_completed: idx,
                        total_files,
                        bytes_copied,
                        total_bytes,
                        percent: compute_percent(bytes_copied, total_bytes, idx, total_files),
                    })
                    .await;
                }

                dst_file
                    .flush()
                    .await
                    .map_err(|e| format!("Flush error on {}: {e}", item.dest_path.display()))?;
                drop(dst_file);

                // Strict byte-size verification before marking file complete
                let dst_meta = fs::metadata(&item.dest_path).map_err(|e| {
                    format!(
                        "Failed to verify migrated file {}: {e}",
                        item.dest_path.display()
                    )
                })?;
                if dst_meta.len() != item.size_bytes {
                    return Err(format!(
                        "Size verification mismatch for {}: expected {} bytes, found {} bytes",
                        item.file_name,
                        item.size_bytes,
                        dst_meta.len()
                    ));
                }

                // Preserve read-only Golden Image protection where supported (note: ExFAT ignores chmod gracefully)
                if item.read_only {
                    let mut perms = dst_meta.permissions();
                    perms.set_mode(0o444);
                    let _ = fs::set_permissions(&item.dest_path, perms);
                }

                files_copied += 1;
                verified_sources.push(item.src_path.clone());
            }

            self.emit_migration_progress(StorageMigrationProgress {
                phase: "verifying".to_string(),
                current_file: "All files verified".to_string(),
                files_completed: total_files,
                total_files,
                bytes_copied,
                total_bytes,
                percent: 100.0,
            })
            .await;

            // Update settings.toml BEFORE deleting old source files
            self.save_config_to_disk(&new_cfg)?;
            {
                let mut guard = self.inner.config.write().await;
                *guard = new_cfg.clone();
            }

            if req.delete_source_after_verify && !verified_sources.is_empty() {
                for src in &verified_sources {
                    if let Ok(meta) = fs::metadata(src) {
                        if meta.permissions().readonly() {
                            let mut perms = meta.permissions();
                            perms.set_mode(0o644);
                            let _ = fs::set_permissions(src, perms);
                        }
                    }
                    let _ = fs::remove_file(src);
                }
                source_cleaned = true;
            }
        } else {
            // SwitchOnly mode: immediately persist new paths
            self.save_config_to_disk(&new_cfg)?;
            {
                let mut guard = self.inner.config.write().await;
                *guard = new_cfg;
            }
        }

        let templates_discovered = count_files_with_exts(&target_resolved.templates_dir, &["qcow2"]);
        let isos_discovered = count_files_with_exts(&target_resolved.isos_dir, &["iso", "img", "raw"]);
        let snapshot = self.refresh_and_snapshot().await;

        Ok(StorageMigrationResult {
            snapshot,
            files_copied,
            bytes_copied,
            source_cleaned,
            templates_discovered,
            isos_discovered,
        })
    }

    fn save_config_to_disk(&self, cfg: &StorageConfig) -> Result<(), String> {
        self.ensure_internal_local_dirs()?;
        let doc = SettingsFile {
            schema_version: 1,
            storage: StorageConfigToml {
                storage_root: Some(cfg.storage_root.clone()),
                templates_dir: cfg.templates_dir_override.clone(),
                isos_dir: cfg.isos_dir_override.clone(),
                workspaces_dir: cfg.workspaces_dir_override.clone(),
            },
        };
        let serialized =
            toml::to_string_pretty(&doc).map_err(|e| format!("Failed to serialize settings.toml: {e}"))?;
        let settings_path = self.settings_file_path();
        fs::write(&settings_path, serialized).map_err(|e| {
            format!(
                "Failed to write settings file {}: {e}",
                settings_path.display()
            )
        })
    }

    async fn emit_status_snapshot(&self, snapshot: &StorageStateSnapshot) {
        if let Some(app) = self.inner.app_handle.read().await.clone() {
            let _ = app.emit("etherloom://storage-status", snapshot.clone());
        }
    }

    async fn emit_migration_progress(&self, progress: StorageMigrationProgress) {
        if let Some(app) = self.inner.app_handle.read().await.clone() {
            let _ = app.emit("etherloom://storage-migration-progress", progress);
        }
    }
}

struct MigrationItem {
    file_name: String,
    src_path: PathBuf,
    dest_path: PathBuf,
    size_bytes: u64,
    read_only: bool,
}

fn build_migration_plan(
    old_paths: &ResolvedStoragePaths,
    new_paths: &ResolvedStoragePaths,
) -> Result<Vec<MigrationItem>, String> {
    let mut plan = Vec::new();
    collect_dir_migration_items(
        &old_paths.templates_dir,
        &new_paths.templates_dir,
        &["qcow2", "json"],
        &mut plan,
    )?;
    collect_dir_migration_items(
        &old_paths.isos_dir,
        &new_paths.isos_dir,
        &["iso", "img", "raw"],
        &mut plan,
    )?;
    Ok(plan)
}

fn collect_dir_migration_items(
    src_dir: &Path,
    dst_dir: &Path,
    allowed_exts: &[&str],
    out: &mut Vec<MigrationItem>,
) -> Result<(), String> {
    if !src_dir.is_dir() {
        return Ok(());
    }
    if paths_refer_to_same_dir(src_dir, dst_dir) {
        return Ok(());
    }

    let entries = fs::read_dir(src_dir)
        .map_err(|e| format!("Failed to scan source library {}: {e}", src_dir.display()))?;
    for entry in entries.flatten() {
        let src_path = entry.path();
        let Ok(meta) = fs::metadata(&src_path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let ext_ok = src_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| allowed_exts.iter().any(|a| ext.eq_ignore_ascii_case(a)))
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }
        let Some(fname) = src_path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        out.push(MigrationItem {
            file_name: fname.to_string(),
            dest_path: dst_dir.join(fname),
            src_path,
            size_bytes: meta.len(),
            read_only: meta.permissions().readonly(),
        });
    }
    Ok(())
}

fn paths_refer_to_same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

fn count_files_with_exts(dir: &Path, exts: &[&str]) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| {
            let p = e.path();
            p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|ext| exts.iter().any(|wanted| ext.eq_ignore_ascii_case(wanted)))
                    .unwrap_or(false)
        })
        .count()
}

fn compute_percent(copied_bytes: u64, total_bytes: u64, done_files: usize, total_files: usize) -> f64 {
    if total_bytes > 0 {
        ((copied_bytes as f64) / (total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else if total_files > 0 {
        ((done_files as f64) / (total_files as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        100.0
    }
}

fn load_config_from_disk(settings_path: &Path, default_root: &Path) -> StorageConfig {
    if let Ok(raw) = fs::read_to_string(settings_path) {
        if let Ok(parsed) = toml::from_str::<SettingsFile>(&raw) {
            let storage_root = parsed
                .storage
                .storage_root
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| default_root.display().to_string());
            return StorageConfig {
                storage_root,
                templates_dir_override: clean_optional(&parsed.storage.templates_dir),
                isos_dir_override: clean_optional(&parsed.storage.isos_dir),
                workspaces_dir_override: clean_optional(&parsed.storage.workspaces_dir),
            };
        }
    }

    StorageConfig {
        storage_root: default_root.display().to_string(),
        templates_dir_override: None,
        isos_dir_override: None,
        workspaces_dir_override: None,
    }
}

fn clean_optional(opt: &Option<String>) -> Option<String> {
    opt.as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_trimmed_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            return Some(home.join(rest));
        }
    }
    Some(PathBuf::from(trimmed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn unmounted_volume_guard_blocks_directory_creation_and_reports_disconnected() {
        let sandbox = std::env::temp_dir().join(format!("etherloom-storage-test-{}", Uuid::new_v4()));
        let app_support = sandbox.join("AppSupport/Etherloom");
        let fake_volumes = sandbox.join("FakeVolumes");
        fs::create_dir_all(&fake_volumes).unwrap();

        // Case 1: `/Volumes/MissingSSD` does not exist at all
        let missing_target = fake_volumes.join("MissingSSD/EtherloomLib");
        let err = verify_volume_mounted_under(&fake_volumes, &missing_target).unwrap_err();
        assert_eq!(err.volume_name, "MissingSSD");

        // Case 2: `/Volumes/UnmountedStub` exists as an empty stub folder on the SAME st_dev as `/Volumes`
        let stub_mount = fake_volumes.join("UnmountedStub");
        fs::create_dir_all(&stub_mount).unwrap();
        let stub_target = stub_mount.join("EtherloomLib/templates");
        let err2 = verify_volume_mounted_under(&fake_volumes, &stub_target).unwrap_err();
        assert_eq!(err2.volume_name, "UnmountedStub");

        // Configure StorageManager pointing at the unplugged external SSD via `settings.toml`
        fs::create_dir_all(&app_support).unwrap();
        let settings_toml = format!(
            "schema_version = 1\n\n[storage]\nstorage_root = \"{}\"\n",
            missing_target.display()
        );
        fs::write(app_support.join("settings.toml"), settings_toml).unwrap();

        let mgr = StorageManager::new(app_support.clone(), fake_volumes.clone());
        let snap = mgr.refresh_and_snapshot().await;

        assert_eq!(
            snap.status,
            StorageStatus::VolumeDisconnected {
                expected_path: missing_target.display().to_string(),
                volume_name: "MissingSSD".to_string(),
            }
        );
        // Crucial check: directory MUST NOT have been created inside FakeVolumes!
        assert!(!missing_target.exists());
        // Meanwhile fixed internal python-env directory WAS created safely
        assert!(mgr.python_env_dir().is_dir());

        // Fallback to Default Internal Storage recovers immediately to `Ready`
        let recovered = mgr.fallback_to_default_internal().await.unwrap();
        assert_eq!(recovered.status, StorageStatus::Ready);
        assert!(Path::new(&recovered.resolved_templates_dir).is_dir());
        assert!(recovered.disk_telemetry.is_some());

        let _ = fs::remove_dir_all(&sandbox);
    }

    #[tokio::test]
    async fn move_existing_library_copies_verifies_updates_settings_and_cleans_source() {
        let sandbox = std::env::temp_dir().join(format!("etherloom-migrate-test-{}", Uuid::new_v4()));
        let app_support = sandbox.join("AppSupport/Etherloom");
        let fake_volumes = sandbox.join("FakeVolumes");
        fs::create_dir_all(&fake_volumes).unwrap();

        let mgr = StorageManager::new(app_support.clone(), fake_volumes);
        let initial = mgr.refresh_and_snapshot().await;
        assert_eq!(initial.status, StorageStatus::Ready);

        // Seed a mock read-only `.qcow2` template + `.template.json` + `.iso` in default storage
        let old_tpl_dir = PathBuf::from(&initial.resolved_templates_dir);
        let old_iso_dir = PathBuf::from(&initial.resolved_isos_dir);
        let sample_qcow2 = old_tpl_dir.join("openbsd-76.qcow2");
        fs::write(&sample_qcow2, vec![0x42u8; 4096]).unwrap();
        let mut perms = fs::metadata(&sample_qcow2).unwrap().permissions();
        perms.set_mode(0o444);
        fs::set_permissions(&sample_qcow2, perms).unwrap();

        let manifest_bytes = b"{\"id\":\"openbsd-76\"}";
        fs::write(old_tpl_dir.join("openbsd-76.template.json"), manifest_bytes).unwrap();
        fs::write(old_iso_dir.join("install76.img"), vec![0x99u8; 2048]).unwrap();

        // Migrate to a new custom library path with cleanup enabled
        let new_root = sandbox.join("ExternalDrive/EtherloomVault");
        let res = mgr
            .update_storage_location(UpdateStorageRequest {
                storage_root: new_root.display().to_string(),
                templates_dir_override: None,
                isos_dir_override: None,
                workspaces_dir_override: None,
                mode: StorageMigrationMode::MoveExistingData,
                delete_source_after_verify: true,
            })
            .await
            .unwrap();

        assert_eq!(res.files_copied, 3);
        assert_eq!(res.bytes_copied, 4096 + (manifest_bytes.len() as u64) + 2048);
        assert!(res.source_cleaned);
        assert_eq!(res.templates_discovered, 1);
        assert_eq!(res.isos_discovered, 1);

        // New files exist with exact sizes and read-only mode preserved; old source files cleaned
        let migrated_qcow2 = new_root.join("templates/openbsd-76.qcow2");
        assert_eq!(fs::metadata(&migrated_qcow2).unwrap().len(), 4096);
        assert!(fs::metadata(&migrated_qcow2).unwrap().permissions().readonly());
        assert!(!sample_qcow2.exists());

        let _ = fs::remove_dir_all(&sandbox);
    }
}
