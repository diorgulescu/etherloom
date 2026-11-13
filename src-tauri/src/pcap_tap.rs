use crate::env_doctor::{is_executable_file, resolve_macos_binary};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::CString;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::FromRawFd;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Once};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, mpsc, watch, Mutex};

/// Standard libpcap microsecond-resolution magic number (`0xa1b2c3d4`).
pub const PCAP_MAGIC_USEC_LE: u32 = 0xa1b2_c3d4;
/// Standard libpcap nanosecond-resolution magic number (`0xa1b23c4d`).
pub const PCAP_MAGIC_NSEC_LE: u32 = 0xa1b2_3c4d;
/// Big-endian libpcap magic number (`0xd4c3b2a1`).
pub const PCAP_MAGIC_USEC_BE: u32 = 0xd4c3_b2a1;
/// IEEE 802.3 Ethernet link-layer header type (`LINKTYPE_ETHERNET = 1`).
pub const LINKTYPE_ETHERNET: u32 = 1;
/// Maximum snapshot length per captured Ethernet frame.
pub const PCAP_SNAPLEN: u32 = 65_535;
/// Ephemeral runtime directory for named FIFO pipes (`/tmp/etherloom`).
pub const TAP_RUNTIME_DIR: &str = "/tmp/etherloom";

static IGNORE_SIGPIPE: Once = Once::new();

/// Ensures `SIGPIPE` is ignored process-wide so closing Wireshark returns `EPIPE` (`BrokenPipe`)
/// instead of terminating the Etherloom process.
pub fn ensure_sigpipe_ignored() {
    IGNORE_SIGPIPE.call_once(|| unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    });
}

/// Zero-copy Ethernet II frame event emitted by a `PacketFabric` wire tap.
#[derive(Debug, Clone)]
pub struct TappedFrame {
    pub ts_sec: u32,
    pub ts_usec: u32,
    pub frame: Bytes,
}

impl TappedFrame {
    #[inline]
    pub fn now(frame: Bytes) -> Self {
        let dur = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        Self {
            ts_sec: dur.as_secs() as u32,
            ts_usec: dur.subsec_micros(),
            frame,
        }
    }
}

/// Encodes the 24-byte standard libpcap Global Header (little-endian, version 2.4, `LINKTYPE_ETHERNET`).
pub fn encode_pcap_global_header() -> [u8; 24] {
    let mut hdr = [0u8; 24];
    hdr[0..4].copy_from_slice(&PCAP_MAGIC_USEC_LE.to_le_bytes());
    hdr[4..6].copy_from_slice(&2u16.to_le_bytes()); // version_major = 2
    hdr[6..8].copy_from_slice(&4u16.to_le_bytes()); // version_minor = 4
    hdr[8..12].copy_from_slice(&0i32.to_le_bytes()); // thiszone = 0 (UTC)
    hdr[12..16].copy_from_slice(&0u32.to_le_bytes()); // sigfigs = 0
    hdr[16..20].copy_from_slice(&PCAP_SNAPLEN.to_le_bytes());
    hdr[20..24].copy_from_slice(&LINKTYPE_ETHERNET.to_le_bytes());
    hdr
}

/// Encodes the 16-byte per-packet libpcap Record Header (little-endian).
#[inline]
pub fn encode_pcap_packet_header(
    ts_sec: u32,
    ts_usec: u32,
    incl_len: u32,
    orig_len: u32,
) -> [u8; 16] {
    let mut rec = [0u8; 16];
    rec[0..4].copy_from_slice(&ts_sec.to_le_bytes());
    rec[4..8].copy_from_slice(&ts_usec.to_le_bytes());
    rec[8..12].copy_from_slice(&incl_len.to_le_bytes());
    rec[12..16].copy_from_slice(&orig_len.to_le_bytes());
    rec
}

/// Sanitizes a link name or ID for safe `.pcap` / FIFO filenames while preserving `__` endpoint separators.
pub fn sanitize_capture_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(96)
        .collect();
    let trimmed = cleaned.trim_matches(['_', '-']);
    if trimmed.is_empty() {
        "link".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Sanitizes a single endpoint token (`<node>-<nic>`) for descriptive `<nodeA>-<nicA>__<nodeB>-<nicB>` filenames.
pub fn sanitize_endpoint_token(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_hyphen = false;
    for c in raw.chars() {
        let mapped = if c.is_ascii_alphanumeric() {
            prev_hyphen = false;
            c
        } else if c == '-' || c == '_' || c == ':' || c == '/' || c.is_whitespace() {
            if prev_hyphen {
                continue;
            }
            prev_hyphen = true;
            '-'
        } else {
            continue;
        };
        out.push(mapped);
        if out.len() >= 42 {
            break;
        }
    }
    let trimmed = out.trim_matches(['-', '_']);
    if trimmed.is_empty() {
        "endpoint".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Builds a descriptive `.pcap` filename encoding both endpoints when available:
/// `<nodeA>-<nicA>__<nodeB>-<nicB>__<YYYYMMDD-HHMMSS>.pcap`.
pub fn build_capture_filename(
    endpoint_a: Option<&str>,
    endpoint_b: Option<&str>,
    link_label: Option<&str>,
    link_id: &str,
    epoch_secs: u64,
) -> String {
    let ts_str = format_utc_hyphen_timestamp(epoch_secs);
    let stem = match (
        endpoint_a.map(str::trim).filter(|s| !s.is_empty()),
        endpoint_b.map(str::trim).filter(|s| !s.is_empty()),
    ) {
        (Some(a), Some(b)) => format!(
            "{}__{}",
            sanitize_endpoint_token(a),
            sanitize_endpoint_token(b)
        ),
        _ => sanitize_capture_stem(link_label.unwrap_or(link_id)),
    };
    format!("{stem}__{ts_str}.pcap")
}

fn utc_calendar_parts(epoch_secs: u64) -> (i64, u64, u64, u64, u64, u64) {
    // Civil-from-days algorithm (Howard Hinnant, public domain)
    let days = (epoch_secs / 86_400) as i64;
    let secs_of_day = epoch_secs % 86_400;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };

    (year, m, d, hour, minute, second)
}

/// Formats UTC epoch seconds as `YYYYMMDD-HHMMSS` for `<nodeA>-<nicA>__<nodeB>-<nicB>__<YYYYMMDD-HHMMSS>.pcap`.
pub fn format_utc_hyphen_timestamp(epoch_secs: u64) -> String {
    let (year, m, d, hour, minute, second) = utc_calendar_parts(epoch_secs);
    format!("{year:04}{m:02}{d:02}-{hour:02}{minute:02}{second:02}")
}

/// Formats UTC epoch seconds as compact `YYYYMMDD_HHMMSS` (legacy helper).
pub fn format_utc_compact_timestamp(epoch_secs: u64) -> String {
    let (year, m, d, hour, minute, second) = utc_calendar_parts(epoch_secs);
    format!("{year:04}{m:02}{d:02}_{hour:02}{minute:02}{second:02}")
}

/// Resolves the macOS Wireshark GUI binary for `-k -i <fifo>` live streaming or `-r <file>` inspection.
pub fn resolve_wireshark_gui_binary() -> Option<PathBuf> {
    let app_bundle = PathBuf::from("/Applications/Wireshark.app/Contents/MacOS/Wireshark");
    if is_executable_file(&app_bundle) {
        return Some(app_bundle);
    }
    if let Some(home) = std::env::var_os("HOME") {
        let user_app = PathBuf::from(home).join("Applications/Wireshark.app/Contents/MacOS/Wireshark");
        if is_executable_file(&user_app) {
            return Some(user_app);
        }
    }
    resolve_macos_binary("wireshark").or_else(|| resolve_macos_binary("Wireshark"))
}

/// Metadata describing a saved `.pcap` / `.pcapng` file in a project's `captures/` folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFileInfo {
    pub filename: String,
    pub path: String,
    pub link_id: Option<String>,
    pub size_bytes: u64,
    pub packet_count: Option<u64>,
    pub modified_at_ms: u64,
    pub is_recording: bool,
}

/// Result returned when starting `.pcap` recording on a link.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPcapRecordingResult {
    pub link_id: String,
    pub path: String,
    pub filename: String,
    pub started_at_ms: u64,
}

/// Atomic finalized capture metadata returned by `stop_wire_capture` / `pcap_stop_recording`
/// AFTER flushing `BufWriter`, running `File::sync_all()`, and closing the `.pcap` file handle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSummary {
    pub capture_id: String,
    pub link_id: String,
    pub file_path: String,
    pub path: String,
    pub filename: String,
    pub packet_count: u64,
    pub packets_written: u64,
    pub byte_size: u64,
    pub bytes_written: u64,
    pub duration_ms: u64,
}

pub type StopPcapRecordingResult = CaptureSummary;

/// Result returned when launching a Live Wireshark FIFO stream on a link.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveWiresharkSessionInfo {
    pub link_id: String,
    pub fifo_path: String,
    pub wireshark_bin: String,
    pub pid: Option<u32>,
}

/// Quickly counts packets in a standard libpcap file by walking 16-byte record headers without loading payloads.
pub fn count_pcap_packets_fast(path: &Path) -> Option<u64> {
    let mut file = fs::File::open(path).ok()?;
    let total_len = file.metadata().ok()?.len();
    if total_len < 24 {
        return None;
    }

    let mut global = [0u8; 24];
    file.read_exact(&mut global).ok()?;
    let magic_le = u32::from_le_bytes([global[0], global[1], global[2], global[3]]);
    let little_endian = match magic_le {
        PCAP_MAGIC_USEC_LE | PCAP_MAGIC_NSEC_LE => true,
        PCAP_MAGIC_USEC_BE | 0x4d3c_b2a1 => false,
        _ => return None, // e.g. pcapng (`0x0a0d0d0a`) — leave packet_count as `None`
    };

    let mut count = 0u64;
    let mut pos = 24u64;
    let mut rec = [0u8; 16];
    while pos + 16 <= total_len {
        if file.read_exact(&mut rec).is_err() {
            break;
        }
        let incl_len = if little_endian {
            u32::from_le_bytes([rec[8], rec[9], rec[10], rec[11]]) as u64
        } else {
            u32::from_be_bytes([rec[8], rec[9], rec[10], rec[11]]) as u64
        };
        pos += 16;
        if pos + incl_len > total_len {
            break;
        }
        count += 1;
        pos += incl_len;
        if file.seek(SeekFrom::Start(pos)).is_err() {
            break;
        }
    }
    Some(count)
}

/// Lists `.pcap` and `.pcapng` files inside `captures_dir`, sorted newest-first.
pub fn list_captures_in_dir(
    captures_dir: &Path,
    active_paths: &HashMap<PathBuf, String>,
) -> Vec<CaptureFileInfo> {
    let Ok(entries) = fs::read_dir(captures_dir) else {
        return Vec::new();
    };

    let mut items = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if ext != "pcap" && ext != "pcapng" {
            continue;
        }

        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let modified_at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("capture.pcap")
            .to_string();

        let active_link = active_paths.get(&path).cloned();
        let is_recording = active_link.is_some();
        let inferred_link = active_link.or_else(|| infer_link_id_from_filename(&filename));
        let packet_count = count_pcap_packets_fast(&path);

        items.push(CaptureFileInfo {
            filename,
            path: path.display().to_string(),
            link_id: inferred_link,
            size_bytes: meta.len(),
            packet_count,
            modified_at_ms,
            is_recording,
        });
    }

    items.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    items
}

fn infer_link_id_from_filename(filename: &str) -> Option<String> {
    let stem = filename
        .strip_suffix(".pcap")
        .or_else(|| filename.strip_suffix(".pcapng"))?;

    // Phase 9 pattern: `<nodeA>-<nicA>__<nodeB>-<nicB>__<YYYYMMDD-HHMMSS>[_<ms>]`
    if let Some((prefix, ts_tail)) = stem.rsplit_once("__") {
        let core_ts = ts_tail.split('_').next().unwrap_or(ts_tail);
        if let Some((ymd, hms)) = core_ts.split_once('-') {
            if ymd.len() == 8
                && ymd.chars().all(|c| c.is_ascii_digit())
                && hms.len() == 6
                && hms.chars().all(|c| c.is_ascii_digit())
                && !prefix.is_empty()
            {
                return Some(prefix.to_string());
            }
        }
    }

    // Legacy pattern: `{link_stem}_{YYYYMMDD}_{HHMMSS}`
    let parts: Vec<&str> = stem.rsplitn(3, '_').collect();
    if parts.len() == 3
        && parts[0].len() == 6
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].len() == 8
        && parts[1].chars().all(|c| c.is_ascii_digit())
    {
        return Some(parts[2].to_string());
    }
    None
}

/// Creates a POSIX named pipe (`mkfifo`) with mode `0600` at `fifo_path`.
pub fn create_named_fifo(fifo_path: &Path) -> Result<(), String> {
    if let Some(parent) = fifo_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create tap directory '{}': {e}", parent.display()))?;
        let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
    }
    if fifo_path.exists() || fs::symlink_metadata(fifo_path).is_ok() {
        let _ = fs::remove_file(fifo_path);
    }

    let c_path = CString::new(fifo_path.as_os_str().as_bytes())
        .map_err(|_| format!("Invalid FIFO path '{}'", fifo_path.display()))?;
    let rc = unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        return Err(format!(
            "mkfifo '{}' failed: {err}",
            fifo_path.display()
        ));
    }
    Ok(())
}

struct ActiveFileRecording {
    link_id: String,
    path: PathBuf,
    filename: String,
    started_at_ms: u64,
    stop_tx: watch::Sender<bool>,
    join_handle: tokio::task::JoinHandle<(u64, u64)>,
}

struct ActiveWiresharkTap {
    fifo_path: PathBuf,
    stop_tx: watch::Sender<bool>,
    child: Arc<Mutex<Option<Child>>>,
}

/// Manages active `.pcap` file recorders and Live Wireshark FIFO pipe streams across all links.
#[derive(Clone, Default)]
pub struct PcapTapManager {
    recordings: Arc<Mutex<HashMap<String, ActiveFileRecording>>>,
    wireshark_taps: Arc<Mutex<HashMap<String, ActiveWiresharkTap>>>,
}

impl PcapTapManager {
    pub fn new() -> Self {
        ensure_sigpipe_ignored();
        Self::default()
    }

    /// Returns a map of `pcap_path -> link_id` for all currently recording `.pcap` files.
    pub async fn active_recording_paths(&self) -> HashMap<PathBuf, String> {
        let guard = self.recordings.lock().await;
        guard
            .values()
            .map(|r| (r.path.clone(), r.link_id.clone()))
            .collect()
    }

    /// Starts writing standard libpcap frames from `rx` into
    /// `{captures_dir}/<nodeA>-<nicA>__<nodeB>-<nicB>__<YYYYMMDD-HHMMSS>.pcap`.
    /// Calls `on_frame_written(packets, bytes)` after each frame and `on_stopped()` when finished.
    pub async fn start_file_recording<F, S>(
        &self,
        link_id: &str,
        link_label: Option<&str>,
        captures_dir: &Path,
        rx: broadcast::Receiver<TappedFrame>,
        on_frame_written: F,
        on_stopped: S,
    ) -> Result<StartPcapRecordingResult, String>
    where
        F: Fn(u64, u64) + Send + Sync + 'static,
        S: FnOnce() + Send + 'static,
    {
        self.start_file_recording_with_endpoints(
            link_id,
            None,
            None,
            link_label,
            captures_dir,
            rx,
            on_frame_written,
            on_stopped,
        )
        .await
    }

    /// Endpoint-aware `.pcap` recorder producing `<nodeA>-<nicA>__<nodeB>-<nicB>__<YYYYMMDD-HHMMSS>.pcap`.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_file_recording_with_endpoints<F, S>(
        &self,
        link_id: &str,
        endpoint_a: Option<&str>,
        endpoint_b: Option<&str>,
        link_label: Option<&str>,
        captures_dir: &Path,
        mut rx: broadcast::Receiver<TappedFrame>,
        on_frame_written: F,
        on_stopped: S,
    ) -> Result<StartPcapRecordingResult, String>
    where
        F: Fn(u64, u64) + Send + Sync + 'static,
        S: FnOnce() + Send + 'static,
    {
        {
            let guard = self.recordings.lock().await;
            if let Some(existing) = guard.get(link_id) {
                return Ok(StartPcapRecordingResult {
                    link_id: link_id.to_string(),
                    path: existing.path.display().to_string(),
                    filename: existing.filename.clone(),
                    started_at_ms: existing.started_at_ms,
                });
            }
        }

        fs::create_dir_all(captures_dir).map_err(|e| {
            format!(
                "Failed to create captures directory '{}': {e}",
                captures_dir.display()
            )
        })?;

        let now_dur = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let started_at_ms = now_dur.as_millis() as u64;
        let mut filename = build_capture_filename(
            endpoint_a,
            endpoint_b,
            link_label,
            link_id,
            now_dur.as_secs(),
        );
        let mut target_path = captures_dir.join(&filename);
        if target_path.exists() {
            let base = filename.strip_suffix(".pcap").unwrap_or(&filename);
            filename = format!("{base}_{}.pcap", started_at_ms % 1000);
            target_path = captures_dir.join(&filename);
        }

        let file = tokio::fs::File::create(&target_path)
            .await
            .map_err(|e| format!("Failed to create '{}': {e}", target_path.display()))?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);

        // Write 24-byte Global Header (`0xa1b2c3d4`, `LINKTYPE_ETHERNET = 1`) immediately
        let global_hdr = encode_pcap_global_header();
        writer
            .write_all(&global_hdr)
            .await
            .map_err(|e| format!("Failed writing libpcap header: {e}"))?;
        writer
            .flush()
            .await
            .map_err(|e| format!("Failed flushing libpcap header: {e}"))?;

        let (stop_tx, mut stop_rx) = watch::channel(false);

        let join_handle = tokio::spawn(async move {
            let mut packets_written = 0u64;
            let mut bytes_written = 24u64;
            let mut flush_tick = tokio::time::interval(Duration::from_millis(250));

            loop {
                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() {
                            // 1. Drain any already-queued Ethernet frames before detaching
                            while let Ok(pkt) = rx.try_recv() {
                                let orig_len = pkt.frame.len() as u32;
                                let incl_len = orig_len.min(PCAP_SNAPLEN);
                                let rec = encode_pcap_packet_header(pkt.ts_sec, pkt.ts_usec, incl_len, orig_len);
                                if writer.write_all(&rec).await.is_err() {
                                    break;
                                }
                                if writer.write_all(&pkt.frame[..incl_len as usize]).await.is_err() {
                                    break;
                                }
                                packets_written += 1;
                                bytes_written += 16 + (incl_len as u64);
                                on_frame_written(packets_written, bytes_written);
                            }
                            break;
                        }
                    }
                    recv_res = rx.recv() => {
                        match recv_res {
                            Ok(pkt) => {
                                let orig_len = pkt.frame.len() as u32;
                                let incl_len = orig_len.min(PCAP_SNAPLEN);
                                let rec = encode_pcap_packet_header(pkt.ts_sec, pkt.ts_usec, incl_len, orig_len);
                                if writer.write_all(&rec).await.is_err() {
                                    break;
                                }
                                if writer.write_all(&pkt.frame[..incl_len as usize]).await.is_err() {
                                    break;
                                }
                                packets_written += 1;
                                bytes_written += 16 + (incl_len as u64);
                                on_frame_written(packets_written, bytes_written);
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }
                    _ = flush_tick.tick() => {
                        let _ = writer.flush().await;
                    }
                }
            }

            // 2. Atomically detach tap receiver from PacketFabric broadcast channel
            drop(rx);

            // 3. Flush userspace BufWriter, sync kernel buffers to storage (`fsync`), and close file handle
            //    BEFORE resolving `join_handle` so Wireshark / tcpflowy never observe a truncated packet.
            let _ = writer.flush().await;
            let file = writer.into_inner();
            let _ = file.sync_all().await;
            drop(file);

            on_stopped();
            (packets_written, bytes_written)
        });

        let result = StartPcapRecordingResult {
            link_id: link_id.to_string(),
            path: target_path.display().to_string(),
            filename: filename.clone(),
            started_at_ms,
        };

        {
            let mut guard = self.recordings.lock().await;
            guard.insert(
                link_id.to_string(),
                ActiveFileRecording {
                    link_id: link_id.to_string(),
                    path: target_path,
                    filename,
                    started_at_ms,
                    stop_tx,
                    join_handle,
                },
            );
        }

        Ok(result)
    }

    /// Atomically stops an active `.pcap` recording for `link_id`, detaches the tap receiver,
    /// flushes `BufWriter`, runs `File::sync_all()`, closes the file descriptor completely,
    /// and returns finalized `CaptureSummary` metadata.
    pub async fn stop_file_recording(&self, link_id: &str) -> Result<CaptureSummary, String> {
        let active = {
            let mut guard = self.recordings.lock().await;
            guard
                .remove(link_id)
                .ok_or_else(|| format!("No active .pcap recording on link '{link_id}'"))?
        };

        let _ = active.stop_tx.send(true);
        let (packets_written, bytes_written) = active
            .join_handle
            .await
            .map_err(|e| format!("Capture writer task join error: {e}"))?;

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(active.started_at_ms);

        let disk_size = fs::metadata(&active.path)
            .map(|m| m.len())
            .unwrap_or(bytes_written);
        let full_path_str = active.path.display().to_string();

        Ok(CaptureSummary {
            capture_id: format!("{}__{}", active.link_id, active.started_at_ms),
            link_id: active.link_id,
            file_path: full_path_str.clone(),
            path: full_path_str,
            filename: active.filename,
            packet_count: packets_written,
            packets_written,
            byte_size: disk_size,
            bytes_written: disk_size,
            duration_ms: now_ms.saturating_sub(active.started_at_ms),
        })
    }

    /// Creates `/tmp/etherloom/tap_{link_id}.pcap` via `mkfifo`, launches Wireshark (`-k -i <fifo>`),
    /// and streams the libpcap Global Header + live Ethernet frames non-blockingly.
    ///
    /// Also supports an internal `spawn_wireshark = false` mode (used by unit tests where a custom FIFO
    /// reader attaches directly to `fifo_path`).
    pub async fn start_live_wireshark_stream<S>(
        &self,
        link_id: &str,
        rx: broadcast::Receiver<TappedFrame>,
        spawn_wireshark: bool,
        on_detached: S,
    ) -> Result<LiveWiresharkSessionInfo, String>
    where
        S: FnOnce() + Send + 'static,
    {
        ensure_sigpipe_ignored();

        // Stop any previous stale FIFO session on this link first
        let _ = self.stop_live_wireshark_stream(link_id).await;

        let safe_id = sanitize_capture_stem(link_id);
        let fifo_path = PathBuf::from(TAP_RUNTIME_DIR).join(format!("tap_{safe_id}.pcap"));
        create_named_fifo(&fifo_path)?;

        let (wireshark_bin_str, pid, child_arc) = if spawn_wireshark {
            let ws_bin = resolve_wireshark_gui_binary().ok_or_else(|| {
                let _ = fs::remove_file(&fifo_path);
                "Wireshark.app was not found at /Applications/Wireshark.app/Contents/MacOS/Wireshark (or in PATH). Install Wireshark (`brew install --cask wireshark`) to use Live Stream.".to_string()
            })?;

            let child = Command::new(&ws_bin)
                .arg("-k")
                .arg("-i")
                .arg(&fifo_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| {
                    let _ = fs::remove_file(&fifo_path);
                    format!("Failed to launch Wireshark '{}': {e}", ws_bin.display())
                })?;
            let child_pid = child.id();
            (
                ws_bin.display().to_string(),
                child_pid,
                Arc::new(Mutex::new(Some(child))),
            )
        } else {
            ("external-fifo-reader".to_string(), None, Arc::new(Mutex::new(None)))
        };

        let (stop_tx, stop_rx) = watch::channel(false);
        let taps_map = self.wireshark_taps.clone();
        let link_id_owned = link_id.to_string();
        let fifo_for_task = fifo_path.clone();
        let child_for_task = child_arc.clone();

        tokio::spawn(async move {
            run_fifo_stream_task(
                fifo_for_task.clone(),
                rx,
                stop_rx,
                child_for_task,
            )
            .await;

            let _ = fs::remove_file(&fifo_for_task);
            {
                let mut guard = taps_map.lock().await;
                guard.remove(&link_id_owned);
            }
            on_detached();
        });

        {
            let mut guard = self.wireshark_taps.lock().await;
            guard.insert(
                link_id.to_string(),
                ActiveWiresharkTap {
                    fifo_path: fifo_path.clone(),
                    stop_tx,
                    child: child_arc,
                },
            );
        }

        Ok(LiveWiresharkSessionInfo {
            link_id: link_id.to_string(),
            fifo_path: fifo_path.display().to_string(),
            wireshark_bin: wireshark_bin_str,
            pid,
        })
    }

    /// Stops an active Live Wireshark FIFO stream on `link_id` cleanly.
    pub async fn stop_live_wireshark_stream(&self, link_id: &str) -> Result<(), String> {
        let removed = {
            let mut guard = self.wireshark_taps.lock().await;
            guard.remove(link_id)
        };
        if let Some(tap) = removed {
            let _ = tap.stop_tx.send(true);
            if let Some(mut child) = tap.child.lock().await.take() {
                let _ = child.kill().await;
            }
            let _ = fs::remove_file(&tap.fifo_path);
        }
        Ok(())
    }

    /// Stops all recordings and FIFO taps associated with `link_id` (e.g. when a wire is deleted).
    pub async fn stop_all_for_link(&self, link_id: &str) {
        let _ = self.stop_file_recording(link_id).await;
        let _ = self.stop_live_wireshark_stream(link_id).await;
    }

    /// Stops all active `.pcap` recordings and live Wireshark FIFO streams across all wires.
    pub async fn stop_all(&self) {
        let rec_ids: Vec<String> = {
            let guard = self.recordings.lock().await;
            guard.keys().cloned().collect()
        };
        for id in rec_ids {
            let _ = self.stop_file_recording(&id).await;
        }

        let ws_ids: Vec<String> = {
            let guard = self.wireshark_taps.lock().await;
            guard.keys().cloned().collect()
        };
        for id in ws_ids {
            let _ = self.stop_live_wireshark_stream(&id).await;
        }
    }
}

/// Opens `fifo_path` without blocking the tokio executor (polling `O_WRONLY | O_NONBLOCK` until
/// the FIFO reader attaches), then streams the 24-byte libpcap header and live frames on a dedicated
/// blocking writer thread so `BrokenPipe` (`EPIPE`) detaches cleanly when Wireshark closes.
async fn run_fifo_stream_task(
    fifo_path: PathBuf,
    mut rx: broadcast::Receiver<TappedFrame>,
    mut stop_rx: watch::Receiver<bool>,
    child_arc: Arc<Mutex<Option<Child>>>,
) {
    let Ok(c_path) = CString::new(fifo_path.as_os_str().as_bytes()) else {
        return;
    };

    // Poll `open(..., O_WRONLY | O_NONBLOCK)` up to 25 seconds while Wireshark initializes
    let mut raw_fd: libc::c_int = -1;
    for _ in 0..312 {
        if *stop_rx.borrow() {
            return;
        }
        // Check if Wireshark exited before opening the pipe
        {
            let mut cg = child_arc.lock().await;
            if let Some(ch) = cg.as_mut() {
                if let Ok(Some(_exit_status)) = ch.try_wait() {
                    return;
                }
            }
        }

        let fd = unsafe { libc::open(c_path.as_ptr(), libc::O_WRONLY | libc::O_NONBLOCK) };
        if fd >= 0 {
            // Switch fd back to blocking mode for atomic record writes on the dedicated writer thread
            unsafe {
                let flags = libc::fcntl(fd, libc::F_GETFL);
                if flags >= 0 {
                    libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK);
                }
            }
            raw_fd = fd;
            break;
        }

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(80)) => {}
            changed = stop_rx.changed() => {
                if changed.is_err() || *stop_rx.borrow() {
                    return;
                }
            }
        }
    }

    if raw_fd < 0 {
        return;
    }

    let mut pipe_file = unsafe { fs::File::from_raw_fd(raw_fd) };
    let (chunk_tx, mut chunk_rx) = mpsc::channel::<Vec<u8>>(1024);

    // Spawn dedicated OS writer thread so FIFO backpressure or EPIPE never blocks tokio workers
    let writer_handle = tokio::task::spawn_blocking(move || {
        let global_hdr = encode_pcap_global_header();
        if pipe_file.write_all(&global_hdr).is_err() || pipe_file.flush().is_err() {
            return;
        }
        while let Some(buf) = chunk_rx.blocking_recv() {
            if pipe_file.write_all(&buf).is_err() {
                break;
            }
            let _ = pipe_file.flush();
        }
    });

    loop {
        tokio::select! {
            changed = stop_rx.changed() => {
                if changed.is_err() || *stop_rx.borrow() {
                    break;
                }
            }
            recv_res = rx.recv() => {
                match recv_res {
                    Ok(pkt) => {
                        if writer_handle.is_finished() {
                            break;
                        }
                        let orig_len = pkt.frame.len() as u32;
                        let incl_len = orig_len.min(PCAP_SNAPLEN);
                        let rec = encode_pcap_packet_header(pkt.ts_sec, pkt.ts_usec, incl_len, orig_len);
                        let mut encoded = Vec::with_capacity(16 + (incl_len as usize));
                        encoded.extend_from_slice(&rec);
                        encoded.extend_from_slice(&pkt.frame[..incl_len as usize]);

                        // Non-blocking `try_send`: if Wireshark pauses reading, drop excess tap copies
                        // rather than stalling `PacketFabric`, unless channel is closed (EPIPE).
                        match chunk_tx.try_send(encoded) {
                            Ok(()) => {}
                            Err(mpsc::error::TrySendError::Full(_)) => continue,
                            Err(mpsc::error::TrySendError::Closed(_)) => break,
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(250)) => {
                if writer_handle.is_finished() {
                    break;
                }
                let mut cg = child_arc.lock().await;
                if let Some(ch) = cg.as_mut() {
                    if let Ok(Some(_)) = ch.try_wait() {
                        break;
                    }
                }
            }
        }
    }

    drop(chunk_tx);
    let _ = writer_handle.await;
}

/// Opens a finalized `.pcap` / `.pcapng` file in Wireshark on macOS in static file-read mode (`-r <pcap>`).
///
/// Resolution order:
/// 1. `/Applications/Wireshark.app/Contents/MacOS/Wireshark -r <pcap_path>` (detached `Stdio::null()`)
/// 2. `resolve_wireshark_gui_binary()` or an explicit GUI binary hint from `env_doctor`
/// 3. `open -a Wireshark <pcap_path>` via macOS LaunchServices
pub fn open_pcap_in_wireshark_with_hint(
    pcap_path: &Path,
    env_wireshark_hint: Option<&str>,
) -> Result<String, String> {
    if !pcap_path.is_file() {
        return Err(format!(
            "Capture file '{}' does not exist",
            pcap_path.display()
        ));
    }

    let primary_app = PathBuf::from("/Applications/Wireshark.app/Contents/MacOS/Wireshark");
    let candidate_gui_bin = if is_executable_file(&primary_app) {
        Some(primary_app)
    } else {
        resolve_wireshark_gui_binary().or_else(|| {
            let hint = PathBuf::from(env_wireshark_hint?.trim());
            let name = hint.file_name()?.to_str()?;
            // Ensure we don't accidentally spawn CLI `tshark` when opening the Wireshark GUI
            if name.eq_ignore_ascii_case("wireshark") && is_executable_file(&hint) {
                Some(hint)
            } else {
                None
            }
        })
    };

    if let Some(ws_bin) = candidate_gui_bin {
        std::process::Command::new(&ws_bin)
            .arg("-r")
            .arg(pcap_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to launch Wireshark '{}': {e}", ws_bin.display()))?;
        return Ok(ws_bin.display().to_string());
    }

    // Fallback to macOS `open -a Wireshark <file>` if installed in a custom location registered with LaunchServices
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-a")
        .arg("Wireshark")
        .arg(pcap_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to invoke macOS `open -a Wireshark`: {e}"))?;

    if status.success() {
        Ok("Wireshark.app".to_string())
    } else {
        Err("Wireshark.app is not installed. Install via `brew install --cask wireshark`.".to_string())
    }
}

/// Opens an existing `.pcap` / `.pcapng` file in Wireshark on macOS.
pub fn open_pcap_file_in_wireshark(pcap_path: &Path) -> Result<String, String> {
    open_pcap_in_wireshark_with_hint(pcap_path, None)
}

/// Copies a finalized `.pcap` capture from `<project>.etherloom/captures/` to any user-chosen
/// macOS destination path (Desktop, Downloads, external SSD, etc.) and fsyncs the destination file.
pub fn export_pcap_copy_to_path(source_pcap_path: &Path, destination_path: &Path) -> Result<u64, String> {
    if !source_pcap_path.is_file() {
        return Err(format!(
            "Source capture '{}' does not exist",
            source_pcap_path.display()
        ));
    }

    if let (Ok(canon_src), Ok(canon_dst)) = (
        fs::canonicalize(source_pcap_path),
        fs::canonicalize(destination_path),
    ) {
        if canon_src == canon_dst {
            return fs::metadata(&canon_src)
                .map(|m| m.len())
                .map_err(|e| format!("Failed reading metadata for '{}': {e}", canon_src.display()));
        }
    }

    if let Some(parent) = destination_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create destination folder '{}': {e}",
                    parent.display()
                )
            })?;
        }
    }

    let copied = fs::copy(source_pcap_path, destination_path).map_err(|e| {
        format!(
            "Failed exporting capture to '{}': {e}",
            destination_path.display()
        )
    })?;

    if let Ok(dest_file) = fs::File::open(destination_path) {
        let _ = dest_file.sync_all();
    }

    Ok(copied)
}

/// Highlights a `.pcap` file inside macOS Finder (`open -R <pcap_path>`).
pub fn reveal_pcap_file_in_finder(pcap_path: &Path) -> Result<(), String> {
    if !pcap_path.exists() {
        return Err(format!(
            "Capture file '{}' does not exist",
            pcap_path.display()
        ));
    }

    let status = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(pcap_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed invoking macOS Finder (`open -R`): {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "macOS Finder could not reveal '{}'",
            pcap_path.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn global_header_matches_libpcap_ethernet_spec() {
        let hdr = encode_pcap_global_header();
        assert_eq!(hdr.len(), 24);
        assert_eq!(u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]), 0xa1b2_c3d4);
        assert_eq!(u16::from_le_bytes([hdr[4], hdr[5]]), 2);
        assert_eq!(u16::from_le_bytes([hdr[6], hdr[7]]), 4);
        assert_eq!(u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]), 65_535);
        assert_eq!(u32::from_le_bytes([hdr[20], hdr[21], hdr[22], hdr[23]]), 1);
    }

    #[test]
    fn endpoint_filename_encodes_both_nodes_nics_and_timestamp() {
        let fname = build_capture_filename(
            Some("fw1:vio0"),
            Some("sw1:p1"),
            None,
            "link-1",
            1_700_000_000,
        );
        assert!(fname.starts_with("fw1-vio0__sw1-p1__20231114-"));
        assert!(fname.ends_with(".pcap"));
        assert_eq!(
            infer_link_id_from_filename(&fname),
            Some("fw1-vio0__sw1-p1".to_string())
        );
    }

    #[tokio::test]
    async fn file_recording_writes_valid_libpcap_flushes_atomically_and_exports_copy() {
        let dir = std::env::temp_dir().join(format!("etherloom-pcap-test-{}", Uuid::new_v4()));
        let export_dir = dir.join("exported");
        let mgr = PcapTapManager::new();
        let (tx, rx) = broadcast::channel::<TappedFrame>(64);

        let started = mgr
            .start_file_recording_with_endpoints(
                "link-fw1-sw",
                Some("fw1-vio0"),
                Some("sw-p1"),
                Some("fw1-vio0__sw-p1"),
                &dir,
                rx,
                |_, _| {},
                || {},
            )
            .await
            .expect("start recording");

        assert!(started.filename.starts_with("fw1-vio0__sw-p1__"));
        assert!(started.filename.ends_with(".pcap"));

        let sample_eth = Bytes::from_static(&[
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // dst
            0x52, 0x54, 0x00, 0x10, 0x01, 0x00, // src
            0x08, 0x06, // ARP
            0x00, 0x01, 0x08, 0x00, 0x06, 0x04,
        ]);

        // Send burst immediately before stop to verify queued-frame drain + zero truncation
        for idx in 0..5u32 {
            tx.send(TappedFrame {
                ts_sec: 1_700_000_000 + idx,
                ts_usec: 123_456,
                frame: sample_eth.clone(),
            })
            .unwrap();
        }

        let stopped = mgr
            .stop_file_recording("link-fw1-sw")
            .await
            .expect("stop recording");

        let expected_bytes = 24 + 5 * (16 + sample_eth.len() as u64);
        assert_eq!(stopped.packet_count, 5);
        assert_eq!(stopped.packets_written, 5);
        assert_eq!(stopped.byte_size, expected_bytes);
        assert_eq!(stopped.bytes_written, expected_bytes);
        assert_eq!(stopped.file_path, started.path);

        // Verify receiver was detached from broadcast channel once stopped
        assert_eq!(tx.receiver_count(), 0);

        let pcap_path = PathBuf::from(&stopped.file_path);
        assert_eq!(count_pcap_packets_fast(&pcap_path), Some(5));

        let listed = list_captures_in_dir(&dir, &HashMap::new());
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].packet_count, Some(5));

        // Verify export_pcap_copy_to_path produces an exact, intact copy
        let dest_pcap = export_dir.join(&stopped.filename);
        let copied_bytes =
            export_pcap_copy_to_path(&pcap_path, &dest_pcap).expect("export pcap copy");
        assert_eq!(copied_bytes, expected_bytes);
        assert_eq!(count_pcap_packets_fast(&dest_pcap), Some(5));

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn live_fifo_stream_delivers_header_and_handles_reader_close_without_crashing() {
        let mgr = PcapTapManager::new();
        let link_id = format!("fifo-test-{}", Uuid::new_v4().simple());
        let (tx, rx) = broadcast::channel::<TappedFrame>(64);

        let detached = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let detached_clone = detached.clone();

        let session = mgr
            .start_live_wireshark_stream(&link_id, rx, false, move || {
                detached_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            })
            .await
            .expect("start FIFO stream");

        let fifo_path = PathBuf::from(&session.fifo_path);
        assert!(fs::symlink_metadata(&fifo_path).is_ok());

        // Spawn simulated Wireshark FIFO reader that reads Global Header + 1 packet and then closes pipe!
        let fifo_reader_path = fifo_path.clone();
        let reader = tokio::task::spawn_blocking(move || {
            let mut f = fs::File::open(&fifo_reader_path).expect("open FIFO for read");
            let mut global = [0u8; 24];
            f.read_exact(&mut global).expect("read global header");
            assert_eq!(
                u32::from_le_bytes([global[0], global[1], global[2], global[3]]),
                PCAP_MAGIC_USEC_LE
            );
            let mut rec = [0u8; 16];
            f.read_exact(&mut rec).expect("read packet header");
            let incl_len = u32::from_le_bytes([rec[8], rec[9], rec[10], rec[11]]) as usize;
            let mut frame = vec![0u8; incl_len];
            f.read_exact(&mut frame).expect("read frame payload");
            frame
            // `f` drops here -> simulates user closing Wireshark (`EPIPE` on next write!)
        });

        // Give writer task a moment to detect reader open and write global header
        tokio::time::sleep(Duration::from_millis(120)).await;

        let eth = Bytes::from_static(&[
            0x52, 0x54, 0x00, 0x00, 0x00, 0x02,
            0x52, 0x54, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x00, 0x45, 0x00, 0x00, 0x14,
        ]);
        tx.send(TappedFrame::now(eth.clone())).unwrap();

        let received_frame = reader.await.expect("reader join");
        assert_eq!(received_frame.as_slice(), eth.as_ref());

        // Send additional frames AFTER reader closed the FIFO -> must trigger clean EPIPE detach, no panic!
        for _ in 0..4 {
            let _ = tx.send(TappedFrame::now(eth.clone()));
            tokio::time::sleep(Duration::from_millis(30)).await;
        }

        // Wait up to 600ms for detach callback & FIFO cleanup
        for _ in 0..20 {
            if detached.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        assert!(detached.load(std::sync::atomic::Ordering::SeqCst));
    }
}
