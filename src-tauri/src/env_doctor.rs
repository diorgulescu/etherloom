use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::timeout;

const PROBE_TIMEOUT: Duration = Duration::from_millis(2500);

/// Severity / readiness state mapped directly to Green (`ok`) and Amber (`warning`) UI badges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckBadge {
    Ok,
    Warning,
}

/// Low-level result of probing a single binary or firmware file on macOS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeDetail {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub searched_paths: Vec<String>,
    pub notes: Option<String>,
}

/// High-level dependency card rendered in the System Status / Dependency Check modal.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyCheck {
    pub id: String,
    pub title: String,
    pub category: String,
    pub required_for: String,
    pub badge: CheckBadge,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub remediation: Option<String>,
    pub details: Option<String>,
    pub searched_paths: Vec<String>,
}

/// Complete macOS host environment report returned over Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvDoctorReport {
    pub checked_at_ms: u64,
    pub host_os: String,
    pub host_arch: String,
    pub hvf_supported: bool,
    pub app_support_dir: String,
    pub templates_dir: String,
    pub overall_badge: CheckBadge,
    pub ok_count: usize,
    pub warning_count: usize,
    pub qemu_system_aarch64: ProbeDetail,
    pub qemu_system_x86_64: ProbeDetail,
    pub qemu_system_i386: ProbeDetail,
    pub qemu_system_riscv64: ProbeDetail,
    pub qemu_img: ProbeDetail,
    pub edk2_aarch64_code: ProbeDetail,
    pub edk2_x86_64_code: ProbeDetail,
    pub wireshark: ProbeDetail,
    pub python3: ProbeDetail,
    pub uv: ProbeDetail,
    pub checks: Vec<DependencyCheck>,
}

/// Returns true if `path` exists, is a file, and has at least one execute bit set.
pub fn is_executable_file(path: &Path) -> bool {
    match fs::metadata(path) {
        Ok(meta) => meta.is_file() && (meta.permissions().mode() & 0o111 != 0),
        Err(_) => false,
    }
}

/// Returns `~/Library/Application Support/Etherloom` on macOS.
pub fn etherloom_app_support_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|h| h.join("Library/Application Support/Etherloom"))
        .unwrap_or_else(|| PathBuf::from("/tmp/Etherloom"))
}

/// Resolves the first executable binary matching `binary_name` across Homebrew prefixes + `PATH`.
pub fn resolve_macos_binary(binary_name: &str) -> Option<PathBuf> {
    let priority = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    candidate_binary_paths(binary_name, &priority)
        .into_iter()
        .find(|p| is_executable_file(p))
}

/// Resolves `qemu-system-aarch64` on macOS.
pub fn resolve_qemu_system_aarch64() -> Option<PathBuf> {
    resolve_macos_binary("qemu-system-aarch64")
}

/// Resolves `qemu-system-x86_64` on macOS.
pub fn resolve_qemu_system_x86_64() -> Option<PathBuf> {
    resolve_macos_binary("qemu-system-x86_64")
}

/// Resolves `qemu-system-{arch}` for `"aarch64"`, `"x86_64"`, `"i386"`, or `"riscv64"`.
pub fn resolve_qemu_for_arch(arch: &str) -> Option<PathBuf> {
    let bin = match arch {
        "x86_64" => "qemu-system-x86_64",
        "i386" => "qemu-system-i386",
        "riscv64" => "qemu-system-riscv64",
        _ => "qemu-system-aarch64",
    };
    resolve_macos_binary(bin)
}

/// Resolves `qemu-img` on macOS.
pub fn resolve_qemu_img() -> Option<PathBuf> {
    resolve_macos_binary("qemu-img")
}

/// Resolves `edk2-aarch64-code.fd` across Homebrew Apple Silicon, Intel, and QEMU-relative prefixes.
pub fn resolve_edk2_firmware(qemu_binary_path: Option<&Path>) -> Option<PathBuf> {
    resolve_edk2_for_arch("aarch64", qemu_binary_path)
}

/// Resolves UEFI EDK2 firmware (`edk2-aarch64-code.fd`, `edk2-x86_64-code.fd`, or `edk2-i386-code.fd`)
/// across Homebrew Apple Silicon (`/opt/homebrew/share/qemu`), Intel (`/usr/local/share/qemu`),
/// and QEMU-relative prefixes.
pub fn resolve_edk2_for_arch(arch: &str, qemu_binary_path: Option<&Path>) -> Option<PathBuf> {
    let filename = match arch {
        "x86_64" => "edk2-x86_64-code.fd",
        "i386" => "edk2-i386-code.fd",
        "riscv64" => return None,
        _ => "edk2-aarch64-code.fd",
    };

    let mut candidates = vec![
        PathBuf::from(format!("/opt/homebrew/share/qemu/{filename}")),
        PathBuf::from(format!("/usr/local/share/qemu/{filename}")),
    ];
    if let Some(qemu_path) = qemu_binary_path {
        if let Some(bin_dir) = qemu_path.parent() {
            if let Some(prefix) = bin_dir.parent() {
                let derived = prefix.join("share/qemu").join(filename);
                if !candidates.contains(&derived) {
                    candidates.push(derived);
                }
            }
        }
    }
    candidates.into_iter().find(|p| {
        fs::metadata(p)
            .map(|m| m.is_file() && m.len() > 0)
            .unwrap_or(false)
    })
}

/// Collects candidate full paths for `binary_name` across `priority_dirs` followed by `PATH`.
fn candidate_binary_paths(binary_name: &str, priority_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for dir in priority_dirs {
        let candidate = dir.join(binary_name);
        if seen.insert(candidate.clone()) {
            out.push(candidate);
        }
    }

    if let Some(path_os) = env::var_os("PATH") {
        for dir in env::split_paths(&path_os) {
            if dir.as_os_str().is_empty() {
                continue;
            }
            let candidate = dir.join(binary_name);
            if seen.insert(candidate.clone()) {
                out.push(candidate);
            }
        }
    }

    out
}

/// Executes `<binary> <args...>` asynchronously with a strict timeout and returns the first
/// non-empty output line if and only if the process exits with status 0.
async fn query_version_line(binary: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(binary);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = timeout(PROBE_TIMEOUT, cmd.output()).await.ok()?.ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Some(line) = stdout.lines().map(str::trim).find(|l| !l.is_empty()) {
        return Some(line.to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(ToOwned::to_owned)
}

/// Probes a CLI executable across priority directories + `PATH`, verifying both execute
/// permission and a clean `--version` invocation.
async fn probe_cli_binary(
    display_name: &str,
    binary_name: &str,
    priority_dirs: &[PathBuf],
    version_args: &[&str],
) -> ProbeDetail {
    let candidates = candidate_binary_paths(binary_name, priority_dirs);
    let searched_paths: Vec<String> = priority_dirs
        .iter()
        .map(|d| d.join(binary_name).display().to_string())
        .chain(std::iter::once(format!("$PATH/{binary_name}")))
        .collect();

    for candidate in candidates {
        if !is_executable_file(&candidate) {
            continue;
        }
        if let Some(version) = query_version_line(&candidate, version_args).await {
            return ProbeDetail {
                name: display_name.to_string(),
                found: true,
                path: Some(candidate.display().to_string()),
                version: Some(version),
                searched_paths,
                notes: None,
            };
        }
    }

    ProbeDetail {
        name: display_name.to_string(),
        found: false,
        path: None,
        version: None,
        searched_paths,
        notes: None,
    }
}

/// Probes an EDK2 UEFI firmware file (`edk2-aarch64-code.fd` or `edk2-x86_64-code.fd`) in Homebrew prefixes.
fn probe_edk2_firmware_file(
    filename: &str,
    arch_label: &str,
    qemu_binary_path: Option<&str>,
) -> ProbeDetail {
    let mut candidates = vec![
        PathBuf::from(format!("/opt/homebrew/share/qemu/{filename}")),
        PathBuf::from(format!("/usr/local/share/qemu/{filename}")),
    ];

    if let Some(qemu_path) = qemu_binary_path {
        if let Some(bin_dir) = Path::new(qemu_path).parent() {
            if let Some(prefix) = bin_dir.parent() {
                let derived = prefix.join("share/qemu").join(filename);
                if !candidates.contains(&derived) {
                    candidates.push(derived);
                }
            }
        }
    }

    let searched_paths: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();

    for candidate in &candidates {
        if let Ok(meta) = fs::metadata(candidate) {
            if meta.is_file() && meta.len() > 0 {
                let size_mb = (meta.len() as f64) / (1024.0 * 1024.0);
                return ProbeDetail {
                    name: filename.to_string(),
                    found: true,
                    path: Some(candidate.display().to_string()),
                    version: Some(format!("EDK2 {arch_label} UEFI ({size_mb:.1} MB)")),
                    searched_paths,
                    notes: Some("Read-only UEFI firmware image".to_string()),
                };
            }
        }
    }

    ProbeDetail {
        name: filename.to_string(),
        found: false,
        path: None,
        version: None,
        searched_paths,
        notes: None,
    }
}

/// Probes Wireshark on macOS:
/// 1. `/Applications/Wireshark.app/Contents/MacOS/Wireshark` (or `~/Applications/...`)
/// 2. `wireshark` in `/opt/homebrew/bin`, `/usr/local/bin`, or `PATH`
/// 3. `tshark` in `/opt/homebrew/bin`, `/usr/local/bin`, or `PATH`
async fn probe_wireshark(homebrew_dirs: &[PathBuf], home_dir: Option<&Path>) -> ProbeDetail {
    let mut app_candidates = vec![PathBuf::from(
        "/Applications/Wireshark.app/Contents/MacOS/Wireshark",
    )];
    if let Some(home) = home_dir {
        app_candidates.push(home.join("Applications/Wireshark.app/Contents/MacOS/Wireshark"));
    }

    let searched_paths = vec![
        "/Applications/Wireshark.app/Contents/MacOS/Wireshark".to_string(),
        "/opt/homebrew/bin/wireshark".to_string(),
        "/usr/local/bin/wireshark".to_string(),
        "$PATH/wireshark".to_string(),
        "$PATH/tshark".to_string(),
    ];

    for app_bin in &app_candidates {
        if is_executable_file(app_bin) {
            let version = query_version_line(app_bin, &["--version"])
                .await
                .unwrap_or_else(|| "Wireshark.app (macOS bundle)".to_string());
            return ProbeDetail {
                name: "Wireshark".to_string(),
                found: true,
                path: Some(app_bin.display().to_string()),
                version: Some(version),
                searched_paths,
                notes: Some("Full GUI live FIFO wiretap ready".to_string()),
            };
        }
    }

    let wireshark_cli =
        probe_cli_binary("wireshark", "wireshark", homebrew_dirs, &["--version"]).await;
    if wireshark_cli.found {
        return ProbeDetail {
            name: "Wireshark".to_string(),
            found: true,
            path: wireshark_cli.path,
            version: wireshark_cli.version,
            searched_paths,
            notes: Some("Wireshark GUI binary detected in PATH".to_string()),
        };
    }

    let tshark_cli = probe_cli_binary("tshark", "tshark", homebrew_dirs, &["--version"]).await;
    if tshark_cli.found {
        return ProbeDetail {
            name: "Wireshark (tshark CLI)".to_string(),
            found: true,
            path: tshark_cli.path,
            version: tshark_cli.version,
            searched_paths,
            notes: Some(
                "tshark CLI detected; install Wireshark.app cask for interactive GUI windows"
                    .to_string(),
            ),
        };
    }

    ProbeDetail {
        name: "Wireshark".to_string(),
        found: false,
        path: None,
        version: None,
        searched_paths,
        notes: None,
    }
}

/// Checks Apple `Hypervisor.framework` availability via `sysctl -n kern.hv_support` (non-root).
pub async fn check_hvf_support() -> bool {
    if env::consts::OS != "macos" {
        return false;
    }
    let sysctl = Path::new("/usr/sbin/sysctl");
    let bin = if is_executable_file(sysctl) {
        sysctl
    } else {
        Path::new("sysctl")
    };

    match query_version_line(bin, &["-n", "kern.hv_support"]).await {
        Some(val) => val.trim() == "1",
        None => false,
    }
}

/// Runs all environment checks concurrently and builds the complete `EnvDoctorReport`.
pub async fn run_diagnostics() -> EnvDoctorReport {
    let home_dir = env::var_os("HOME").map(PathBuf::from);
    let homebrew_dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];

    let mut uv_dirs = homebrew_dirs.clone();
    if let Some(ref home) = home_dir {
        uv_dirs.push(home.join(".local/bin"));
        uv_dirs.push(home.join(".cargo/bin"));
    }

    let (
        qemu_system_aarch64,
        qemu_system_x86_64,
        qemu_system_i386,
        qemu_system_riscv64,
        qemu_img,
        wireshark,
        python3,
        uv,
        hvf_supported,
    ) = tokio::join!(
        probe_cli_binary(
            "qemu-system-aarch64",
            "qemu-system-aarch64",
            &homebrew_dirs,
            &["--version"]
        ),
        probe_cli_binary(
            "qemu-system-x86_64",
            "qemu-system-x86_64",
            &homebrew_dirs,
            &["--version"]
        ),
        probe_cli_binary(
            "qemu-system-i386",
            "qemu-system-i386",
            &homebrew_dirs,
            &["--version"]
        ),
        probe_cli_binary(
            "qemu-system-riscv64",
            "qemu-system-riscv64",
            &homebrew_dirs,
            &["--version"]
        ),
        probe_cli_binary("qemu-img", "qemu-img", &homebrew_dirs, &["--version"]),
        probe_wireshark(&homebrew_dirs, home_dir.as_deref()),
        probe_cli_binary("python3", "python3", &homebrew_dirs, &["--version"]),
        probe_cli_binary("uv", "uv", &uv_dirs, &["--version"]),
        check_hvf_support(),
    );

    let edk2_aarch64_code = probe_edk2_firmware_file(
        "edk2-aarch64-code.fd",
        "ARM64",
        qemu_system_aarch64.path.as_deref(),
    );
    let edk2_x86_64_code = probe_edk2_firmware_file(
        "edk2-x86_64-code.fd",
        "x86_64",
        qemu_system_x86_64.path.as_deref(),
    );

    let app_support_base = home_dir
        .as_ref()
        .map(|h| h.join("Library/Application Support/Etherloom"))
        .unwrap_or_else(|| PathBuf::from("~/Library/Application Support/Etherloom"));
    let templates_dir = app_support_base.join("templates");

    // Compose python3 / uv check summary for isolated tcpflowy environment
    let python_toolchain_found = uv.found || python3.found;
    let python_toolchain_path = match (&uv.path, &python3.path) {
        (Some(uv_p), Some(py_p)) => Some(format!("uv: {uv_p} • python3: {py_p}")),
        (Some(uv_p), None) => Some(uv_p.clone()),
        (None, Some(py_p)) => Some(py_p.clone()),
        (None, None) => None,
    };
    let python_toolchain_version = match (&uv.version, &python3.version) {
        (Some(uv_v), Some(py_v)) => Some(format!("{uv_v} • {py_v}")),
        (Some(uv_v), None) => Some(uv_v.clone()),
        (None, Some(py_v)) => Some(py_v.clone()),
        (None, None) => None,
    };
    let python_toolchain_details = match (uv.found, python3.found) {
        (true, true) => {
            Some("Both uv and python3 available for isolated tcpflowy venv".to_string())
        }
        (false, true) => Some(
            "python3 venv ready for tcpflowy (optional: `brew install uv` for faster provisioning)"
                .to_string(),
        ),
        (true, false) => Some("uv available to provision isolated Python + tcpflowy".to_string()),
        (false, false) => None,
    };

    let mut combined_py_searched = uv.searched_paths.clone();
    for p in &python3.searched_paths {
        if !combined_py_searched.contains(p) {
            combined_py_searched.push(p.clone());
        }
    }

    // Compose Multi-Architecture QEMU summary (x86_64, i386, riscv64 + edk2-x86_64)
    let mut multi_arch_available = Vec::new();
    if qemu_system_x86_64.found {
        multi_arch_available.push(if edk2_x86_64_code.found {
            "x86_64 (UEFI + SeaBIOS)"
        } else {
            "x86_64 (SeaBIOS)"
        });
    }
    if qemu_system_i386.found {
        multi_arch_available.push("i386");
    }
    if qemu_system_riscv64.found {
        multi_arch_available.push("riscv64");
    }
    let multi_arch_found = qemu_system_x86_64.found;
    let multi_arch_details = if multi_arch_available.is_empty() {
        Some("Install Homebrew QEMU (`brew install qemu`) for OPNsense, pfSense, OmniOS, DragonFly BSD, Haiku & FreeDOS".to_string())
    } else {
        Some(format!(
            "Detected targets: {} ({})",
            multi_arch_available.join(", "),
            if env::consts::ARCH == "x86_64" && hvf_supported {
                "x86_64 HVF + TCG"
            } else {
                "multi-threaded TCG JIT"
            }
        ))
    };

    let checks = vec![
        DependencyCheck {
            id: "qemu-system-aarch64".to_string(),
            title: "QEMU ARM64 Hypervisor Engine (qemu-system-aarch64)".to_string(),
            category: "Hypervisor & Compute".to_string(),
            required_for: "Native Apple Silicon HVF guests (Linux, FreeBSD, OpenBSD, NetBSD, OpenWrt, RouterOS, 9front)"
                .to_string(),
            badge: if qemu_system_aarch64.found {
                CheckBadge::Ok
            } else {
                CheckBadge::Warning
            },
            found: qemu_system_aarch64.found,
            path: qemu_system_aarch64.path.clone(),
            version: qemu_system_aarch64.version.clone(),
            remediation: (!qemu_system_aarch64.found).then(|| "brew install qemu".to_string()),
            details: if hvf_supported {
                Some("Apple Hypervisor.framework (kern.hv_support = 1) verified".to_string())
            } else {
                qemu_system_aarch64.notes.clone()
            },
            searched_paths: qemu_system_aarch64.searched_paths.clone(),
        },
        DependencyCheck {
            id: "qemu-multi-arch".to_string(),
            title: "Multi-Arch QEMU Engines (x86_64 / i386 / riscv64)".to_string(),
            category: "Hypervisor & Compute".to_string(),
            required_for: "OPNsense, pfSense, OmniOS, DragonFly BSD, Haiku (x86_64) & FreeDOS + mTCP (i386)"
                .to_string(),
            badge: if multi_arch_found {
                CheckBadge::Ok
            } else {
                CheckBadge::Warning
            },
            found: multi_arch_found,
            path: qemu_system_x86_64.path.clone(),
            version: qemu_system_x86_64.version.clone(),
            remediation: (!multi_arch_found).then(|| "brew install qemu".to_string()),
            details: multi_arch_details,
            searched_paths: qemu_system_x86_64.searched_paths.clone(),
        },
        DependencyCheck {
            id: "qemu-img".to_string(),
            title: "QEMU Disk Image Utility (qemu-img)".to_string(),
            category: "Storage & Overlays".to_string(),
            required_for: "Creating Copy-on-Write qcow2 lab overlays & converting OS catalog images"
                .to_string(),
            badge: if qemu_img.found {
                CheckBadge::Ok
            } else {
                CheckBadge::Warning
            },
            found: qemu_img.found,
            path: qemu_img.path.clone(),
            version: qemu_img.version.clone(),
            remediation: (!qemu_img.found).then(|| "brew install qemu".to_string()),
            details: qemu_img.notes.clone(),
            searched_paths: qemu_img.searched_paths.clone(),
        },
        DependencyCheck {
            id: "edk2-aarch64-code".to_string(),
            title: "UEFI Firmware (edk2-aarch64 & edk2-x86_64)".to_string(),
            category: "Boot Firmware".to_string(),
            required_for: "UEFI boot & graphical ramfb / VGA console on ARM64 & x86_64 guests".to_string(),
            badge: if edk2_aarch64_code.found {
                CheckBadge::Ok
            } else {
                CheckBadge::Warning
            },
            found: edk2_aarch64_code.found,
            path: match (&edk2_aarch64_code.path, &edk2_x86_64_code.path) {
                (Some(a), Some(x)) => Some(format!("ARM64: {a} • x86_64: {x}")),
                (Some(a), None) => Some(a.clone()),
                (None, Some(x)) => Some(x.clone()),
                (None, None) => None,
            },
            version: edk2_aarch64_code.version.clone(),
            remediation: (!edk2_aarch64_code.found).then(|| "brew install qemu".to_string()),
            details: edk2_aarch64_code.notes.clone(),
            searched_paths: edk2_aarch64_code.searched_paths.clone(),
        },
        DependencyCheck {
            id: "wireshark".to_string(),
            title: "Wireshark / TShark Packet Analyzer".to_string(),
            category: "Wiretap & Capture".to_string(),
            required_for: "Live zero-root FIFO pipe packet inspection on virtual links".to_string(),
            badge: if wireshark.found {
                CheckBadge::Ok
            } else {
                CheckBadge::Warning
            },
            found: wireshark.found,
            path: wireshark.path.clone(),
            version: wireshark.version.clone(),
            remediation: (!wireshark.found)
                .then(|| "brew install --cask wireshark".to_string()),
            details: wireshark.notes.clone().or_else(|| {
                Some("Built-in .pcap capture writer works even without Wireshark installed".to_string())
            }),
            searched_paths: wireshark.searched_paths.clone(),
        },
        DependencyCheck {
            id: "python-tcpflowy".to_string(),
            title: "Python 3 / uv Runtime (tcpflowy Bridge)".to_string(),
            category: "Flow Analysis".to_string(),
            required_for: "Isolated PyPI tcpflowy environment for in-app GUI Flow Inspector"
                .to_string(),
            badge: if python_toolchain_found {
                CheckBadge::Ok
            } else {
                CheckBadge::Warning
            },
            found: python_toolchain_found,
            path: python_toolchain_path,
            version: python_toolchain_version,
            remediation: (!python_toolchain_found)
                .then(|| "brew install uv python".to_string()),
            details: python_toolchain_details,
            searched_paths: combined_py_searched,
        },
    ];

    let ok_count = checks.iter().filter(|c| c.badge == CheckBadge::Ok).count();
    let warning_count = checks
        .iter()
        .filter(|c| c.badge == CheckBadge::Warning)
        .count();
    let overall_badge = if warning_count == 0 {
        CheckBadge::Ok
    } else {
        CheckBadge::Warning
    };

    let checked_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    EnvDoctorReport {
        checked_at_ms,
        host_os: env::consts::OS.to_string(),
        host_arch: env::consts::ARCH.to_string(),
        hvf_supported,
        app_support_dir: app_support_base.display().to_string(),
        templates_dir: templates_dir.display().to_string(),
        overall_badge,
        ok_count,
        warning_count,
        qemu_system_aarch64,
        qemu_system_x86_64,
        qemu_system_i386,
        qemu_system_riscv64,
        qemu_img,
        edk2_aarch64_code,
        edk2_x86_64_code,
        wireshark,
        python3,
        uv,
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_paths_prioritize_homebrew_and_deduplicate() {
        let priority = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ];
        let paths = candidate_binary_paths("qemu-system-aarch64", &priority);
        assert!(paths.len() >= 2);
        assert_eq!(
            paths[0],
            PathBuf::from("/opt/homebrew/bin/qemu-system-aarch64")
        );
        assert_eq!(
            paths[1],
            PathBuf::from("/usr/local/bin/qemu-system-aarch64")
        );
    }

    #[tokio::test]
    async fn diagnostics_returns_all_six_checks_including_multi_arch() {
        let report = run_diagnostics().await;
        assert_eq!(report.checks.len(), 6);
        assert_eq!(report.ok_count + report.warning_count, 6);
        assert!(report.checks.iter().any(|c| c.id == "qemu-multi-arch"));
    }
}
