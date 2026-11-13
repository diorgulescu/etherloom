use crate::env_doctor::{etherloom_app_support_dir, is_executable_file, resolve_macos_binary};
use crate::pcap_tap::count_pcap_packets_fast;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::RwLock;

const PYTHON_VENV_DIRNAME: &str = "python-env";
const TCPFLOWY_CONFIG_FILENAME: &str = "tcpflowy.toml";
const BRIDGE_SCRIPT_FILENAME: &str = "etherloom_tcpflowy_bridge.py";

/// Embedded Python bridge executing `tcpflowy` (`TCPDataHoarder`, `TCPFlowObject`, `TSharkExtraction`)
/// and augmenting each `TCPFlowObject.to_dict()` with TCP segment ladder timelines & reconstructed streams.
const ETHERLOOM_TCPFLOWY_BRIDGE_PY: &str = r#"#!/usr/bin/env python3
import argparse
import contextlib
import io
import json
import os
import sys

def parse_bool_flag(val):
    return str(val).strip().lower() in ("1", "true", "set")

def safe_int(val, default=0):
    if val is None or val == "":
        return default
    try:
        return int(val)
    except ValueError:
        try:
            return int(val, 16)
        except ValueError:
            return default

def decode_ascii(raw_bytes):
    return "".join(chr(b) if (32 <= b <= 126 or b in (9, 10, 13)) else "." for b in raw_bytes)

def extract_segment_timelines(TSharkExtraction, pcap_path, tshark_bin, flows_by_id, keylog_file=None):
    fields = [
        "tcp.stream",
        "frame.number",
        "frame.time_epoch",
        "ip.src",
        "ipv6.src",
        "tcp.srcport",
        "ip.dst",
        "ipv6.dst",
        "tcp.dstport",
        "frame.len",
        "tcp.len",
        "tcp.seq",
        "tcp.ack",
        "tcp.window_size_value",
        "tcp.flags.syn",
        "tcp.flags.ack",
        "tcp.flags.push",
        "tcp.flags.fin",
        "tcp.flags.reset",
        "tcp.flags.urg",
        "tcp.analysis.retransmission",
        "tcp.analysis.out_of_order",
        "tcp.analysis.zero_window",
        "tcp.payload",
    ]
    extractor = TSharkExtraction(
        pcap_path,
        attributes_to_extract=fields,
        tshark_bin=tshark_bin,
        tls_keylog_file=keylog_file,
    )
    records = extractor.extract_info()

    per_stream = {}
    for pkt in records:
        sid = str(pkt.get("tcp.stream") or "").strip()
        if not sid:
            continue
        per_stream.setdefault(sid, []).append(pkt)

    enriched = {}
    for sid, pkts in per_stream.items():
        flow = flows_by_id.get(sid)
        client_ip = flow.src_ip if flow else None
        client_port = int(flow.src_port) if (flow and flow.src_port is not None and str(flow.src_port).isdigit()) else (flow.src_port if flow else None)

        t0 = None
        segments = []
        retransmissions = 0
        out_of_order = 0
        zero_windows = 0
        rst_packets = 0

        saw_syn = False
        saw_syn_ack = False
        saw_fin = False
        saw_rst = False

        c2s_buf = bytearray()
        s2c_buf = bytearray()
        turns = []
        MAX_STREAM_BYTES = 16384
        MAX_SEGMENTS = 250
        MAX_TURNS = 32

        for pkt in pkts:
            src_ip = pkt.get("ip.src") or pkt.get("ipv6.src") or ""
            src_port_raw = pkt.get("tcp.srcport") or ""
            src_port = int(src_port_raw) if str(src_port_raw).isdigit() else src_port_raw

            is_c2s = True
            if client_ip is not None:
                is_c2s = (src_ip == client_ip and src_port == client_port)
            direction = "C->S" if is_c2s else "S->C"

            ts_raw = pkt.get("frame.time_epoch")
            rel_ms = 0.0
            if ts_raw:
                try:
                    ts = float(ts_raw)
                    if t0 is None:
                        t0 = ts
                    rel_ms = max(0.0, round((ts - t0) * 1000.0, 3))
                except ValueError:
                    pass

            f_syn = parse_bool_flag(pkt.get("tcp.flags.syn"))
            f_ack = parse_bool_flag(pkt.get("tcp.flags.ack"))
            f_psh = parse_bool_flag(pkt.get("tcp.flags.push"))
            f_fin = parse_bool_flag(pkt.get("tcp.flags.fin"))
            f_rst = parse_bool_flag(pkt.get("tcp.flags.reset"))
            f_urg = parse_bool_flag(pkt.get("tcp.flags.urg"))

            flags = []
            if f_syn:
                flags.append("SYN")
            if f_psh:
                flags.append("PSH")
            if f_fin:
                flags.append("FIN")
            if f_rst:
                flags.append("RST")
            if f_urg:
                flags.append("URG")
            if f_ack:
                flags.append("ACK")

            if f_syn and not f_ack:
                saw_syn = True
            if f_syn and f_ack:
                saw_syn_ack = True
            if f_fin:
                saw_fin = True
            if f_rst:
                saw_rst = True
                rst_packets += 1

            is_retrans = bool((pkt.get("tcp.analysis.retransmission") or "").strip())
            is_ooo = bool((pkt.get("tcp.analysis.out_of_order") or "").strip())
            is_zw = bool((pkt.get("tcp.analysis.zero_window") or "").strip())

            if is_retrans:
                retransmissions += 1
            if is_ooo:
                out_of_order += 1
            if is_zw:
                zero_windows += 1

            seq_num = safe_int(pkt.get("tcp.seq"), 0)
            ack_num = safe_int(pkt.get("tcp.ack"), 0)
            tcp_len = safe_int(pkt.get("tcp.len"), 0)
            frame_len = safe_int(pkt.get("frame.len"), 0)
            win_val = safe_int(pkt.get("tcp.window_size_value"), 0)
            frame_no = safe_int(pkt.get("frame.number"), 0)

            payload_preview = ""
            payload_hex = (pkt.get("tcp.payload") or "").replace(":", "").strip()
            if payload_hex:
                try:
                    raw = bytes.fromhex(payload_hex)
                    payload_preview = decode_ascii(raw[:48]).replace("\r", " ").replace("\n", " ")
                    if not is_retrans:
                        target_buf = c2s_buf if is_c2s else s2c_buf
                        if len(target_buf) < MAX_STREAM_BYTES:
                            rem = MAX_STREAM_BYTES - len(target_buf)
                            target_buf.extend(raw[:rem])

                        if turns and turns[-1]["direction"] == direction and turns[-1]["bytes"] < 4096:
                            chunk = raw[: max(0, 4096 - turns[-1]["bytes"])]
                            turns[-1]["bytes"] += len(raw)
                            turns[-1]["ascii"] += decode_ascii(chunk)
                            turns[-1]["hex"] = (turns[-1]["hex"] + " " + chunk.hex(" ")).strip()
                        elif len(turns) < MAX_TURNS:
                            chunk = raw[:2048]
                            turns.append({
                                "direction": direction,
                                "bytes": len(raw),
                                "ascii": decode_ascii(chunk),
                                "hex": chunk.hex(" "),
                            })
                except ValueError:
                    pass

            if len(segments) < MAX_SEGMENTS:
                segments.append({
                    "frameNumber": frame_no,
                    "relTimeMs": rel_ms,
                    "direction": direction,
                    "flags": flags,
                    "seq": seq_num,
                    "ack": ack_num,
                    "payloadLen": tcp_len,
                    "frameLen": frame_len,
                    "window": win_val,
                    "isRetransmission": is_retrans,
                    "isOutOfOrder": is_ooo,
                    "isZeroWindow": is_zw,
                    "preview": payload_preview,
                })

        if saw_rst:
            handshake_state = "RESET (RST)"
        elif saw_syn and saw_syn_ack and saw_fin:
            handshake_state = "COMPLETE (FIN)"
        elif saw_syn and saw_syn_ack:
            handshake_state = "ESTABLISHED"
        elif saw_syn and not saw_syn_ack:
            handshake_state = "SYN_UNANSWERED"
        elif saw_fin:
            handshake_state = "CLOSED (FIN)"
        else:
            handshake_state = "MID_STREAM"

        enriched[sid] = {
            "handshakeState": handshake_state,
            "retransmissions": retransmissions,
            "outOfOrder": out_of_order,
            "zeroWindows": zero_windows,
            "rstCount": rst_packets,
            "segments": segments,
            "streamReconstruction": {
                "c2sAscii": decode_ascii(c2s_buf),
                "c2sHex": c2s_buf.hex(" "),
                "s2cAscii": decode_ascii(s2c_buf),
                "s2cHex": s2c_buf.hex(" "),
                "turns": turns,
            },
        }
    return enriched

def main():
    parser = argparse.ArgumentParser(description="Etherloom JSON bridge for tcpflowy")
    parser.add_argument("--pcap", required=True, help="Target .pcap/.pcapng file")
    parser.add_argument("--tshark", default="tshark", help="Path to tshark binary")
    parser.add_argument("--local-repo", default=None, help="Optional local tcpflowy git checkout")
    parser.add_argument("--keylog", default=None, help="Optional TLS SSLKEYLOGFILE")
    parser.add_argument("--filter-noise", action="store_true", help="Filter known OS/telemetry background flows")
    parser.add_argument("--no-ip-lookup", action="store_true", help="Offline mode: skip external GeoIP/WHOIS")
    args = parser.parse_args()

    source_mode = "venv"
    if args.local_repo:
        repo = os.path.abspath(args.local_repo)
        if os.path.isfile(os.path.join(repo, "tcpflowy.py")):
            sys.path.insert(0, repo)
            source_mode = f"local:{repo}"

    import tcpflowy as tf_cli
    from include.ConsoleStyle import ConsoleStyle
    from include.TCPDataHoarder import TCPDataHoarder
    from include.TCPFlowObject import TCPFlowObject
    from include.TsharkExtraction import TSharkExtraction

    ConsoleStyle.set_enabled(False)
    TCPFlowObject.clear_registry()

    hoarder = TCPDataHoarder(
        pcap_list=[args.pcap],
        tshark_bin=args.tshark,
        resolve_ip_info=(not args.no_ip_lookup),
        ip_lookup_timeout=2,
        max_payload_samples=6,
        payload_preview_bytes=64,
        tls_keylog_file=args.keylog,
    )
    hoarder.extract_pcap_info()

    all_items = hoarder.get_all_flows()
    suppressed_noise = 0
    items = []
    for pcap_name, flow in all_items:
        if args.filter_noise and flow.is_background_noise:
            suppressed_noise += 1
        else:
            items.append((pcap_name, flow))

    stats = hoarder.get_statistics(items)
    rules = hoarder.generate_rules(output_path=None, flows_subset=items)
    ascii_chart = hoarder.render_ascii_chart(items)

    # Capture authentic tcpflowy CLI output report
    cli_buf = io.StringIO()
    with contextlib.redirect_stdout(cli_buf):
        tf_cli.print_flows_table(items, verbose=True)
        tf_cli.print_summary_and_patterns(hoarder, items, suppressed_noise=suppressed_noise, suppressed_baseline=0)
        if rules:
            tf_cli.print_generated_rules(rules, "flow_rules.rules")
    raw_cli_output = cli_buf.getvalue().strip()

    dns_combined = {}
    for catcher in hoarder.catchers.values():
        dns_combined.update(catcher.dns_map)

    flows_by_id = {str(f.flow_id): f for _, f in items}
    timelines = extract_segment_timelines(
        TSharkExtraction,
        args.pcap,
        args.tshark,
        flows_by_id,
        keylog_file=args.keylog,
    )

    serialized_flows = []
    for pcap_name, flow in items:
        base = flow.to_dict()
        extra = timelines.get(str(flow.flow_id), {
            "handshakeState": "UNKNOWN",
            "retransmissions": 0,
            "outOfOrder": 0,
            "zeroWindows": 0,
            "rstCount": 0,
            "segments": [],
            "streamReconstruction": {
                "c2sAscii": "",
                "c2sHex": "",
                "s2cAscii": "",
                "s2cHex": "",
                "turns": [],
            },
        })
        serialized_flows.append({
            "pcap": pcap_name,
            **base,
            **extra,
        })

    out = {
        "tcpflowyVersion": getattr(tf_cli, "__version__", "unknown"),
        "sourceMode": source_mode,
        "pcapPath": os.path.abspath(args.pcap),
        "pcapName": os.path.basename(args.pcap),
        "suppressedNoiseFlows": suppressed_noise,
        "statistics": stats,
        "passiveDnsMap": dns_combined,
        "generatedRules": rules,
        "asciiChart": ascii_chart,
        "rawCliReport": raw_cli_output,
        "flows": serialized_flows,
    }
    sys.stdout.write(json.dumps(out))

if __name__ == "__main__":
    main()
"#;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct TcpflowyTomlConfig {
    pub local_repo_path: Option<String>,
}

/// Current status of the managed `~/Library/Application Support/Etherloom/python-env/` & `tcpflowy`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpflowyEnvStatus {
    pub state: String, // "ready" | "not_installed" | "installing" | "missing_python" | "missing_tshark" | "error"
    pub venv_dir: String,
    pub venv_exists: bool,
    pub python_bin: Option<String>,
    pub tshark_bin: Option<String>,
    pub installed_version: Option<String>,
    pub local_repo_path: Option<String>,
    pub local_repo_valid: bool,
    pub active_source: String, // "pypi_venv" | "local_repo" | "none"
    pub message: String,
}

/// Progress event emitted on `"etherloom://tcpflowy-install-progress"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpflowyInstallProgress {
    pub phase: String,
    pub message: String,
    pub percent: u8,
}

/// Request parameters for dissecting a `.pcap` file with `tcpflowy`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DissectPcapRequest {
    pub pcap_path: String,
    #[serde(default)]
    pub filter_noise: bool,
    #[serde(default = "default_true")]
    pub no_ip_lookup: bool,
    pub keylog_path: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Structured output returned to the React Flow Dissector UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpflowyDissectionReport {
    pub tcpflowy_version: String,
    pub source_mode: String,
    pub pcap_path: String,
    pub pcap_name: String,
    pub total_pcap_packets: Option<u64>,
    pub suppressed_noise_flows: usize,
    pub statistics: serde_json::Value,
    pub passive_dns_map: BTreeMap<String, String>,
    pub generated_rules: Vec<serde_json::Value>,
    pub ascii_chart: String,
    pub raw_cli_report: String,
    pub flows: Vec<serde_json::Value>,
}

/// Resolves `tshark` on macOS across `Wireshark.app`, Homebrew Apple Silicon/Intel, and `PATH`.
pub fn resolve_tshark_binary() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("/Applications/Wireshark.app/Contents/MacOS/tshark"),
        PathBuf::from("/opt/homebrew/bin/tshark"),
        PathBuf::from("/usr/local/bin/tshark"),
    ];
    for c in candidates {
        if is_executable_file(&c) {
            return Some(c);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let user_app = PathBuf::from(home).join("Applications/Wireshark.app/Contents/MacOS/tshark");
        if is_executable_file(&user_app) {
            return Some(user_app);
        }
    }
    resolve_macos_binary("tshark")
}

/// Resolves host `python3` on macOS across Homebrew and system paths.
pub fn resolve_host_python3() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("/opt/homebrew/bin/python3"),
        PathBuf::from("/usr/local/bin/python3"),
        PathBuf::from("/usr/bin/python3"),
    ];
    for c in candidates {
        if is_executable_file(&c) {
            return Some(c);
        }
    }
    resolve_macos_binary("python3")
}

/// Checks whether `dir` is a valid local `tcpflowy` repository checkout containing `tcpflowy.py` and `include/TCPDataHoarder.py`.
pub fn is_valid_local_tcpflowy_repo(dir: &Path) -> bool {
    dir.join("tcpflowy.py").is_file() && dir.join("include/TCPDataHoarder.py").is_file()
}

struct TcpflowyInner {
    app_support_dir: PathBuf,
    config: RwLock<TcpflowyTomlConfig>,
    installing: AtomicBool,
    app_handle: RwLock<Option<AppHandle>>,
}

/// Manages `~/Library/Application Support/Etherloom/python-env/` and executes `tcpflowy` dissections.
#[derive(Clone)]
pub struct TcpflowyManager {
    inner: Arc<TcpflowyInner>,
}

impl Default for TcpflowyManager {
    fn default() -> Self {
        Self::new_with_app_dir(etherloom_app_support_dir())
    }
}

impl TcpflowyManager {
    pub fn new_with_app_dir(app_support_dir: PathBuf) -> Self {
        let cfg_path = app_support_dir.join(TCPFLOWY_CONFIG_FILENAME);
        let loaded = fs::read_to_string(&cfg_path)
            .ok()
            .and_then(|raw| toml::from_str::<TcpflowyTomlConfig>(&raw).ok())
            .unwrap_or_default();

        Self {
            inner: Arc::new(TcpflowyInner {
                app_support_dir,
                config: RwLock::new(loaded),
                installing: AtomicBool::new(false),
                app_handle: RwLock::new(None),
            }),
        }
    }

    pub async fn bind_app_handle(&self, handle: AppHandle) {
        *self.inner.app_handle.write().await = Some(handle);
    }

    pub fn venv_dir(&self) -> PathBuf {
        self.inner.app_support_dir.join(PYTHON_VENV_DIRNAME)
    }

    pub fn venv_python(&self) -> PathBuf {
        self.venv_dir().join("bin/python3")
    }

    fn bridge_script_path(&self) -> PathBuf {
        self.venv_dir().join(BRIDGE_SCRIPT_FILENAME)
    }

    fn config_file_path(&self) -> PathBuf {
        self.inner.app_support_dir.join(TCPFLOWY_CONFIG_FILENAME)
    }

    async fn emit_progress(&self, phase: &str, message: impl Into<String>, percent: u8) {
        let handle_opt = self.inner.app_handle.read().await.clone();
        if let Some(app) = handle_opt {
            let _ = app.emit(
                "etherloom://tcpflowy-install-progress",
                TcpflowyInstallProgress {
                    phase: phase.to_string(),
                    message: message.into(),
                    percent,
                },
            );
        }
    }

    /// Sets or clears the optional local `tcpflowy` development repository path in `tcpflowy.toml`.
    pub async fn set_local_repo_path(&self, repo_path: Option<String>) -> Result<TcpflowyEnvStatus, String> {
        let cleaned = repo_path
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if let Some(ref p) = cleaned {
            let path = PathBuf::from(p);
            if !is_valid_local_tcpflowy_repo(&path) {
                return Err(format!(
                    "Directory '{}' does not look like a tcpflowy checkout (expected tcpflowy.py and include/TCPDataHoarder.py).",
                    path.display()
                ));
            }
        }

        let new_cfg = TcpflowyTomlConfig {
            local_repo_path: cleaned,
        };

        fs::create_dir_all(&self.inner.app_support_dir)
            .map_err(|e| format!("Failed creating app support dir: {e}"))?;
        let serialized = toml::to_string_pretty(&new_cfg)
            .map_err(|e| format!("Failed serializing tcpflowy.toml: {e}"))?;
        fs::write(self.config_file_path(), serialized)
            .map_err(|e| format!("Failed saving tcpflowy.toml: {e}"))?;

        *self.inner.config.write().await = new_cfg;
        Ok(self.status().await)
    }

    /// Probes the current state of `python-env`, `tcpflowy` version, local repo override, and `tshark`.
    pub async fn status(&self) -> TcpflowyEnvStatus {
        let cfg = self.inner.config.read().await.clone();
        let venv_dir = self.venv_dir();
        let venv_py = self.venv_python();
        let venv_exists = is_executable_file(&venv_py);
        let host_py = resolve_host_python3();
        let tshark = resolve_tshark_binary();

        let local_repo_valid = cfg
            .local_repo_path
            .as_ref()
            .map(|p| is_valid_local_tcpflowy_repo(Path::new(p)))
            .unwrap_or(false);

        if self.inner.installing.load(Ordering::Acquire) {
            return TcpflowyEnvStatus {
                state: "installing".to_string(),
                venv_dir: venv_dir.display().to_string(),
                venv_exists,
                python_bin: venv_exists
                    .then(|| venv_py.display().to_string())
                    .or_else(|| host_py.map(|p| p.display().to_string())),
                tshark_bin: tshark.map(|p| p.display().to_string()),
                installed_version: None,
                local_repo_path: cfg.local_repo_path,
                local_repo_valid,
                active_source: "none".to_string(),
                message: "Installing / upgrading tcpflowy inside python-env…".to_string(),
            };
        }

        // Probe version from local repo override first if configured, else from venv
        let mut installed_version: Option<String> = None;
        let mut active_source = "none".to_string();

        if local_repo_valid {
            if let (Some(repo_str), Some(py)) = (
                cfg.local_repo_path.as_ref(),
                venv_exists.then(|| venv_py.clone()).or_else(|| host_py.clone()),
            ) {
                installed_version = probe_tcpflowy_version(&py, Some(Path::new(repo_str))).await;
                if installed_version.is_some() {
                    active_source = "local_repo".to_string();
                }
            }
        }

        if installed_version.is_none() && venv_exists {
            installed_version = probe_tcpflowy_version(&venv_py, None).await;
            if installed_version.is_some() {
                active_source = "pypi_venv".to_string();
            }
        }

        let (state, message) = if host_py.is_none() && !venv_exists {
            (
                "missing_python".to_string(),
                "Python 3.8+ was not found on this Mac. Install via `brew install python`.".to_string(),
            )
        } else if tshark.is_none() {
            (
                "missing_tshark".to_string(),
                "tshark was not found. Install Wireshark (`brew install --cask wireshark` or `brew install wireshark`) so tcpflowy can dissect captures.".to_string(),
            )
        } else if let Some(ref ver) = installed_version {
            let src_lbl = if active_source == "local_repo" {
                "local dev repo"
            } else {
                "managed python-env"
            };
            (
                "ready".to_string(),
                format!("tcpflowy v{ver} ready ({src_lbl})"),
            )
        } else {
            (
                "not_installed".to_string(),
                "tcpflowy is not yet installed in ~/Library/Application Support/Etherloom/python-env.".to_string(),
            )
        };

        TcpflowyEnvStatus {
            state,
            venv_dir: venv_dir.display().to_string(),
            venv_exists,
            python_bin: venv_exists
                .then(|| venv_py.display().to_string())
                .or_else(|| host_py.map(|p| p.display().to_string())),
            tshark_bin: tshark.map(|p| p.display().to_string()),
            installed_version,
            local_repo_path: cfg.local_repo_path,
            local_repo_valid,
            active_source,
            message,
        }
    }

    /// Creates `~/Library/Application Support/Etherloom/python-env/` if needed and runs
    /// `pip install --upgrade tcpflowy` from PyPI, emitting live progress events.
    pub async fn install_or_upgrade_tcpflowy(&self) -> Result<TcpflowyEnvStatus, String> {
        if self
            .inner
            .installing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("A tcpflowy installation is already in progress.".to_string());
        }

        let res = self.install_inner().await;
        self.inner.installing.store(false, Ordering::Release);
        res
    }

    async fn install_inner(&self) -> Result<TcpflowyEnvStatus, String> {
        let host_py = resolve_host_python3().ok_or_else(|| {
            "python3 was not found on this Mac. Install Python 3 (`brew install python`) first."
                .to_string()
        })?;

        let venv_dir = self.venv_dir();
        let venv_py = self.venv_python();
        fs::create_dir_all(&self.inner.app_support_dir)
            .map_err(|e| format!("Failed creating '{}': {e}", self.inner.app_support_dir.display()))?;

        if !is_executable_file(&venv_py) {
            self.emit_progress(
                "venv",
                format!("Creating Python virtual environment at {}…", venv_dir.display()),
                20,
            )
            .await;

            let out = Command::new(&host_py)
                .arg("-m")
                .arg("venv")
                .arg(&venv_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
                .map_err(|e| format!("Failed running `python3 -m venv`: {e}"))?;

            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                return Err(format!("`python3 -m venv` failed: {}", stderr.trim()));
            }
        }

        self.ensure_bridge_script_written()?;

        self.emit_progress(
            "pip",
            "Running `pip install --upgrade tcpflowy` from PyPI…",
            60,
        )
        .await;

        let pip_out = Command::new(&venv_py)
            .arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--upgrade")
            .arg("tcpflowy")
            .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed running `pip install --upgrade tcpflowy`: {e}"))?;

        if !pip_out.status.success() {
            let stderr = String::from_utf8_lossy(&pip_out.stderr);
            return Err(format!(
                "`pip install --upgrade tcpflowy` failed: {}",
                stderr.trim()
            ));
        }

        self.emit_progress("done", "tcpflowy environment ready!", 100)
            .await;

        Ok(self.status().await)
    }

    fn ensure_bridge_script_written(&self) -> Result<PathBuf, String> {
        let script_path = self.bridge_script_path();
        if let Some(parent) = script_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed creating '{}': {e}", parent.display()))?;
        }
        fs::write(&script_path, ETHERLOOM_TCPFLOWY_BRIDGE_PY)
            .map_err(|e| format!("Failed writing bridge script '{}': {e}", script_path.display()))?;
        Ok(script_path)
    }

    /// Executes `tcpflowy` against `req.pcap_path` via `etherloom_tcpflowy_bridge.py` and returns
    /// the full structured `TcpflowyDissectionReport` (flows, sequence ladder segments, reconstructed
    /// payloads, passive DNS, wildcard byte-mask signatures, IDS/Wireshark rules, and CLI output).
    pub async fn dissect_pcap(
        &self,
        req: DissectPcapRequest,
    ) -> Result<TcpflowyDissectionReport, String> {
        let pcap_path = PathBuf::from(req.pcap_path.trim());
        if !pcap_path.is_file() {
            return Err(format!(
                "Capture file '{}' does not exist.",
                pcap_path.display()
            ));
        }

        let tshark_bin = resolve_tshark_binary().ok_or_else(|| {
            "tshark was not found. Install Wireshark (`brew install --cask wireshark` or `brew install wireshark`) to dissect captures.".to_string()
        })?;

        let cfg = self.inner.config.read().await.clone();
        let local_repo = cfg
            .local_repo_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| is_valid_local_tcpflowy_repo(p));

        let venv_py = self.venv_python();
        let python_bin = if is_executable_file(&venv_py) {
            venv_py
        } else if local_repo.is_some() {
            // `tcpflowy` uses 100% Python stdlib, so a local repo checkout can run with host `python3` directly
            resolve_host_python3().ok_or_else(|| "python3 not found on host".to_string())?
        } else {
            // Automatically bootstrap `python-env` + `pip install --upgrade tcpflowy` on first use!
            let st = self.install_or_upgrade_tcpflowy().await?;
            if st.state != "ready" {
                return Err(st.message);
            }
            self.venv_python()
        };

        let script_path = self.ensure_bridge_script_written()?;

        let mut cmd = Command::new(&python_bin);
        cmd.arg(&script_path)
            .arg("--pcap")
            .arg(&pcap_path)
            .arg("--tshark")
            .arg(&tshark_bin)
            .env("NO_COLOR", "1")
            .env("PYTHONUTF8", "1");

        if let Some(ref repo) = local_repo {
            cmd.arg("--local-repo").arg(repo);
        }
        if req.filter_noise {
            cmd.arg("--filter-noise");
        }
        if req.no_ip_lookup {
            cmd.arg("--no-ip-lookup");
        }
        if let Some(ref kl) = req.keylog_path {
            if !kl.trim().is_empty() {
                cmd.arg("--keylog").arg(kl.trim());
            }
        }

        let out = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed invoking tcpflowy Python bridge: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            let detail = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                stdout.trim().to_string()
            };
            return Err(format!("tcpflowy dissection failed: {detail}"));
        }

        let mut parsed: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| {
            format!(
                "Failed parsing tcpflowy bridge JSON output: {e} (stdout len={})",
                out.stdout.len()
            )
        })?;

        let total_pcap_packets = count_pcap_packets_fast(&pcap_path);

        let tcpflowy_version = parsed
            .get("tcpflowyVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("1.1.0")
            .to_string();
        let source_mode = parsed
            .get("sourceMode")
            .and_then(|v| v.as_str())
            .unwrap_or("venv")
            .to_string();
        let pcap_name = parsed
            .get("pcapName")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                pcap_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("capture.pcap")
            })
            .to_string();
        let suppressed_noise_flows = parsed
            .get("suppressedNoiseFlows")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        let statistics = parsed
            .get_mut("statistics")
            .map(serde_json::Value::take)
            .unwrap_or(serde_json::Value::Null);
        let passive_dns_map: BTreeMap<String, String> = parsed
            .get_mut("passiveDnsMap")
            .map(serde_json::Value::take)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let generated_rules: Vec<serde_json::Value> = parsed
            .get_mut("generatedRules")
            .map(serde_json::Value::take)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let ascii_chart = parsed
            .get("asciiChart")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let raw_cli_report = parsed
            .get("rawCliReport")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let flows: Vec<serde_json::Value> = parsed
            .get_mut("flows")
            .map(serde_json::Value::take)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        Ok(TcpflowyDissectionReport {
            tcpflowy_version,
            source_mode,
            pcap_path: pcap_path.display().to_string(),
            pcap_name,
            total_pcap_packets,
            suppressed_noise_flows,
            statistics,
            passive_dns_map,
            generated_rules,
            ascii_chart,
            raw_cli_report,
            flows,
        })
    }
}

async fn probe_tcpflowy_version(python_bin: &Path, local_repo: Option<&Path>) -> Option<String> {
    let snippet = if let Some(repo) = local_repo {
        format!(
            "import sys; sys.path.insert(0, {:?}); import tcpflowy, include.TCPDataHoarder; print(getattr(tcpflowy, '__version__', 'dev'))",
            repo.display().to_string()
        )
    } else {
        "import tcpflowy, include.TCPDataHoarder; print(getattr(tcpflowy, '__version__', 'installed'))"
            .to_string()
    };

    let out = Command::new(python_bin)
        .arg("-c")
        .arg(snippet)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;

    if !out.status.success() {
        return None;
    }
    let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if ver.is_empty() {
        None
    } else {
        Some(ver)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcap_tap::{encode_pcap_global_header, encode_pcap_packet_header};
    use std::io::Write;
    use uuid::Uuid;

    /// Builds a valid Ethernet II + IPv4 + TCP segment for offline `.pcap` synthesis.
    fn build_ipv4_tcp_frame(
        src_ip: [u8; 4],
        dst_ip: [u8; 4],
        src_port: u16,
        dst_port: u16,
        seq: u32,
        ack: u32,
        flags: u8,
        payload: &[u8],
    ) -> Vec<u8> {
        let tcp_len = 20 + payload.len();
        let ip_total_len = (20 + tcp_len) as u16;
        let mut out = Vec::with_capacity(14 + ip_total_len as usize);

        // Ethernet II header (14B)
        out.extend_from_slice(&[0x52, 0x54, 0x00, 0x00, 0x00, 0x02]); // dst mac
        out.extend_from_slice(&[0x52, 0x54, 0x00, 0x00, 0x00, 0x01]); // src mac
        out.extend_from_slice(&0x0800u16.to_be_bytes()); // IPv4

        // IPv4 header (20B)
        let ip_start = out.len();
        out.push(0x45); // v4, IHL=5
        out.push(0x00);
        out.extend_from_slice(&ip_total_len.to_be_bytes());
        out.extend_from_slice(&0x1234u16.to_be_bytes()); // id
        out.extend_from_slice(&0x4000u16.to_be_bytes()); // DF
        out.push(64); // TTL
        out.push(6); // proto = TCP
        out.extend_from_slice(&0u16.to_be_bytes()); // checksum placeholder
        out.extend_from_slice(&src_ip);
        out.extend_from_slice(&dst_ip);

        // Compute IPv4 header checksum
        let mut sum = 0u32;
        for chunk in out[ip_start..ip_start + 20].chunks_exact(2) {
            sum += u16::from_be_bytes([chunk[0], chunk[1]]) as u32;
        }
        while (sum >> 16) != 0 {
            sum = (sum & 0xffff) + (sum >> 16);
        }
        let csum = !(sum as u16);
        out[ip_start + 10..ip_start + 12].copy_from_slice(&csum.to_be_bytes());

        // TCP header (20B)
        out.extend_from_slice(&src_port.to_be_bytes());
        out.extend_from_slice(&dst_port.to_be_bytes());
        out.extend_from_slice(&seq.to_be_bytes());
        out.extend_from_slice(&ack.to_be_bytes());
        out.push(0x50); // data offset = 5 (20B)
        out.push(flags);
        out.extend_from_slice(&64240u16.to_be_bytes()); // window
        out.extend_from_slice(&0u16.to_be_bytes()); // checksum (0 accepted by tshark)
        out.extend_from_slice(&0u16.to_be_bytes()); // urgent
        out.extend_from_slice(payload);
        out
    }

    #[tokio::test]
    async fn local_repo_validation_and_config_persistence_work() {
        let tmp = std::env::temp_dir().join(format!("etherloom-tf-cfg-{}", Uuid::new_v4()));
        let fake_repo = tmp.join("fake-tcpflowy");
        fs::create_dir_all(fake_repo.join("include")).unwrap();
        fs::write(fake_repo.join("tcpflowy.py"), "__version__ = '1.1.0'\n").unwrap();
        fs::write(fake_repo.join("include/TCPDataHoarder.py"), "class TCPDataHoarder: pass\n").unwrap();

        let mgr = TcpflowyManager::new_with_app_dir(tmp.join("app-support"));
        assert!(mgr.set_local_repo_path(Some("/nonexistent/repo".into())).await.is_err());

        let st = mgr
            .set_local_repo_path(Some(fake_repo.display().to_string()))
            .await
            .expect("valid local repo");
        assert!(st.local_repo_valid);
        assert_eq!(st.installed_version.as_deref(), Some("1.1.0"));

        // Verify persistence across reload
        let mgr2 = TcpflowyManager::new_with_app_dir(tmp.join("app-support"));
        let st2 = mgr2.status().await;
        assert!(st2.local_repo_valid);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn synthesized_http_pcap_has_expected_packet_count() {
        let tmp = std::env::temp_dir().join(format!("etherloom-http-pcap-{}.pcap", Uuid::new_v4()));
        let mut f = fs::File::create(&tmp).unwrap();
        f.write_all(&encode_pcap_global_header()).unwrap();

        let c_ip = [10, 0, 1, 10];
        let s_ip = [10, 0, 1, 1];
        let syn = build_ipv4_tcp_frame(c_ip, s_ip, 51234, 80, 1000, 0, 0x02, b"");
        let syn_ack = build_ipv4_tcp_frame(s_ip, c_ip, 80, 51234, 2000, 1001, 0x12, b"");
        let ack = build_ipv4_tcp_frame(c_ip, s_ip, 51234, 80, 1001, 2001, 0x10, b"");
        let req = build_ipv4_tcp_frame(
            c_ip,
            s_ip,
            51234,
            80,
            1001,
            2001,
            0x18,
            b"GET /health HTTP/1.1\r\nHost: fw1.lab\r\n\r\n",
        );

        for (i, frame) in [syn, syn_ack, ack, req].iter().enumerate() {
            let hdr = encode_pcap_packet_header(
                1_700_000_000,
                (i as u32) * 5_000,
                frame.len() as u32,
                frame.len() as u32,
            );
            f.write_all(&hdr).unwrap();
            f.write_all(frame).unwrap();
        }
        drop(f);

        assert_eq!(count_pcap_packets_fast(&tmp), Some(4));
        let _ = fs::remove_file(&tmp);
    }
}
