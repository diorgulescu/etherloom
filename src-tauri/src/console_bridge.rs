use crate::vm_manager::{
    sanitize_socket_id, VmDisplayMode, VmManager, VmStatus, RUNTIME_SOCKET_DIR,
};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::OwnedWriteHalf as UnixOwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream, UnixStream};
use tokio::process::Command;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::time::{sleep, timeout};

/// Maximum per-node raw serial scrollback replay ring buffer (64 KiB).
const SERIAL_SCROLLBACK_BYTES: usize = 65_536;
/// Maximum HTTP WebSocket upgrade header size (8 KiB).
const MAX_HTTP_HEADER_BYTES: usize = 8_192;
/// Maximum single WebSocket frame payload accepted from local WebView client (4 MiB).
const MAX_WS_CLIENT_PAYLOAD: usize = 4 * 1024 * 1024;
/// RFC 6455 WebSocket GUID for `Sec-WebSocket-Accept` computation.
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// Origins allowed to open the loopback console WebSocket bridge.
///
/// Browsers always attach an `Origin` header to WebSocket handshakes, so any web page open in the
/// user's browser (e.g. `https://evil.example`) can be rejected here, while the Etherloom WebView
/// itself (`tauri://localhost` in production, `http://localhost:1420` under `vite dev`) is allowed.
/// Requests without an `Origin` header (non-browser local tools, unit tests) are permitted.
const ALLOWED_WS_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1420",
    "https://localhost:1420",
    "http://127.0.0.1:1420",
    "https://127.0.0.1:1420",
];

/// Validates the `Host` and `Origin` headers of a WebSocket upgrade request against the
/// loopback-only trust boundary of the console bridge.
fn validate_ws_handshake(req: &WsUpgradeRequest) -> Result<(), String> {
    // DNS-rebinding guard: the Host must be a loopback literal, never an external name.
    if let Some(host) = req.host.as_deref() {
        let host_lower = host.trim().to_ascii_lowercase();
        let host_name = host_lower.split(':').next().unwrap_or("");
        let is_loopback_host = host_name == "127.0.0.1"
            || host_name == "localhost"
            || host_name == "[::1]"
            || host_name == "::1";
        if !is_loopback_host {
            return Err(format!(
                "WebSocket bridge rejects non-loopback Host header '{host}'"
            ));
        }
    }

    if let Some(origin) = req.origin.as_deref() {
        let origin_lower = origin.trim().to_ascii_lowercase();
        if origin_lower == "null" {
            return Err("WebSocket bridge rejects opaque 'null' Origin".to_string());
        }
        if !ALLOWED_WS_ORIGINS.contains(&origin_lower.as_str()) {
            return Err(format!(
                "WebSocket bridge rejects cross-origin handshake from '{origin}'"
            ));
        }
    }

    Ok(())
}

/// Descriptor returned to the React Console Dock to attach `xterm.js` and `@novnc/novnc`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSessionEndpoints {
    pub node_id: String,
    pub ws_port: u16,
    pub serial_ws_url: String,
    pub vnc_ws_url: Option<String>,
    pub vnc_tcp_port: Option<u16>,
    pub display_mode: VmDisplayMode,
    pub vm_running: bool,
    pub serial_socket_path: String,
}

/// Shared state for a single VM's persistent Unix-domain serial socket bridge.
struct SerialNodeHub {
    socket_path: PathBuf,
    writer: Mutex<Option<UnixOwnedWriteHalf>>,
    scrollback: Mutex<VecDeque<u8>>,
    broadcaster: broadcast::Sender<Bytes>,
    reader_running: Mutex<bool>,
}

impl SerialNodeHub {
    fn new(socket_path: PathBuf) -> Arc<Self> {
        let (broadcaster, _) = broadcast::channel(512);
        Arc::new(Self {
            socket_path,
            writer: Mutex::new(None),
            scrollback: Mutex::new(VecDeque::with_capacity(8192)),
            broadcaster,
            reader_running: Mutex::new(false),
        })
    }

    /// Ensures the background Unix socket reader task is connected to QEMU's `_serial.sock`.
    async fn ensure_connected(self: &Arc<Self>) -> Result<(), String> {
        self.ensure_connected_for_vm("", None).await
    }

    async fn ensure_connected_for_vm(
        self: &Arc<Self>,
        node_id: &str,
        vm_manager: Option<&VmManager>,
    ) -> Result<(), String> {
        {
            let guard = self.reader_running.lock().await;
            if *guard {
                return Ok(());
            }
        }

        // Retry up to ~12s while disk overlays are created or macOS Gatekeeper / syspolicyd
        // verifies Homebrew QEMU's shared libraries on first launch, bailing early if the VM stops/crashes.
        let mut last_err = String::new();
        let mut connected_stream: Option<UnixStream> = None;
        for _ in 0..120 {
            match UnixStream::connect(&self.socket_path).await {
                Ok(stream) => {
                    connected_stream = Some(stream);
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    if let Some(mgr) = vm_manager {
                        if let Some(info) = mgr.get_vm_info(node_id).await {
                            match info.status {
                                VmStatus::Crashed => {
                                    return Err(info.last_error.unwrap_or_else(|| {
                                        "QEMU VM exited unexpectedly before opening its serial console."
                                            .to_string()
                                    }));
                                }
                                VmStatus::Stopped => {
                                    return Err(
                                        "VM is stopped. Click Boot VM to start.".to_string()
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                    sleep(Duration::from_millis(100)).await;
                }
            }
        }

        let Some(stream) = connected_stream else {
            return Err(format!(
                "Unable to connect to serial socket {}: {last_err}",
                self.socket_path.display()
            ));
        };

        let mut running_guard = self.reader_running.lock().await;
        if *running_guard {
            // Another concurrent caller just established the connection
            return Ok(());
        }

        let (mut read_half, write_half) = stream.into_split();
        {
            let mut w = self.writer.lock().await;
            *w = Some(write_half);
        }
        *running_guard = true;
        drop(running_guard);

        let hub = Arc::clone(self);
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match read_half.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = Bytes::copy_from_slice(&buf[..n]);
                        {
                            let mut ring = hub.scrollback.lock().await;
                            let overflow =
                                (ring.len() + chunk.len()).saturating_sub(SERIAL_SCROLLBACK_BYTES);
                            if overflow > 0 {
                                let drain_count = overflow.min(ring.len());
                                ring.drain(..drain_count);
                            }
                            ring.extend(chunk.iter().copied());
                        }
                        let _ = hub.broadcaster.send(chunk);
                    }
                }
            }

            {
                let mut w = hub.writer.lock().await;
                *w = None;
            }
            let mut running = hub.reader_running.lock().await;
            *running = false;
        });

        Ok(())
    }

    /// Writes raw unbuffered bytes directly into QEMU's serial chardev socket.
    async fn write_raw(self: &Arc<Self>, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty() {
            return Ok(());
        }
        self.ensure_connected().await?;
        let mut guard = self.writer.lock().await;
        let writer = guard
            .as_mut()
            .ok_or_else(|| "Serial console stream is disconnected".to_string())?;
        writer
            .write_all(bytes)
            .await
            .map_err(|e| format!("Serial write failed: {e}"))?;
        writer
            .flush()
            .await
            .map_err(|e| format!("Serial flush failed: {e}"))?;
        Ok(())
    }

    async fn snapshot_scrollback(&self) -> Vec<u8> {
        let ring = self.scrollback.lock().await;
        ring.iter().copied().collect()
    }
}

struct ConsoleBridgeInner {
    ws_port: Mutex<Option<u16>>,
    serial_hubs: RwLock<HashMap<String, Arc<SerialNodeHub>>>,
    custom_serial_paths: RwLock<HashMap<String, PathBuf>>,
}

/// Manages local loopback WebSocket + Tauri Channel bridges for:
/// 1. Raw unbuffered guest Serial Consoles (`/tmp/etherloom/{node_id}_serial.sock` <-> `xterm.js`)
/// 2. Embedded UEFI/ramfb VNC screens (`127.0.0.1:{5900+offset}` <-> `@novnc/novnc`)
#[derive(Clone)]
pub struct ConsoleBridge {
    inner: Arc<ConsoleBridgeInner>,
}

impl Default for ConsoleBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl ConsoleBridge {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ConsoleBridgeInner {
                ws_port: Mutex::new(None),
                serial_hubs: RwLock::new(HashMap::new()),
                custom_serial_paths: RwLock::new(HashMap::new()),
            }),
        }
    }

    /// Registers a custom Unix socket path override for `node_id` (used in unit tests).
    pub async fn register_custom_serial_socket(&self, node_id: &str, path: PathBuf) {
        let mut guard = self.inner.custom_serial_paths.write().await;
        guard.insert(node_id.to_string(), path);
    }

    async fn resolve_serial_socket_path(&self, node_id: &str) -> PathBuf {
        if let Some(custom) = self.inner.custom_serial_paths.read().await.get(node_id) {
            return custom.clone();
        }
        let safe_id = sanitize_socket_id(node_id);
        Path::new(RUNTIME_SOCKET_DIR).join(format!("{safe_id}_serial.sock"))
    }

    fn resolve_qmp_socket_path(node_id: &str) -> PathBuf {
        let safe_id = sanitize_socket_id(node_id);
        Path::new(RUNTIME_SOCKET_DIR).join(format!("{safe_id}_qmp.sock"))
    }

    async fn get_or_create_serial_hub(&self, node_id: &str) -> Arc<SerialNodeHub> {
        let sock_path = self.resolve_serial_socket_path(node_id).await;
        {
            let guard = self.inner.serial_hubs.read().await;
            if let Some(existing) = guard.get(node_id) {
                if existing.socket_path == sock_path {
                    return Arc::clone(existing);
                }
            }
        }

        let mut guard = self.inner.serial_hubs.write().await;
        if let Some(existing) = guard.get(node_id) {
            if existing.socket_path == sock_path {
                return Arc::clone(existing);
            }
        }
        let created = SerialNodeHub::new(sock_path);
        guard.insert(node_id.to_string(), Arc::clone(&created));
        created
    }

    /// Ensures the local `127.0.0.1` WebSocket bridge server is listening and returns its TCP port.
    pub async fn ensure_started(&self, vm_manager: VmManager) -> Result<u16, String> {
        let mut port_guard = self.inner.ws_port.lock().await;
        if let Some(port) = *port_guard {
            return Ok(port);
        }

        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|e| format!("Failed to bind local console WebSocket bridge: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read console WebSocket port: {e}"))?
            .port();

        *port_guard = Some(port);
        drop(port_guard);

        let bridge = self.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _peer)) = listener.accept().await else {
                    break;
                };
                let _ = stream.set_nodelay(true);
                let b = bridge.clone();
                let vm_mgr = vm_manager.clone();
                tokio::spawn(async move {
                    let _ = b.handle_ws_connection(stream, vm_mgr).await;
                });
            }
        });

        Ok(port)
    }

    /// Returns ready-to-connect WebSocket endpoints (`serialWsUrl` & `vncWsUrl`) for a VM node.
    pub async fn session_endpoints(
        &self,
        node_id: &str,
        vm_manager: &VmManager,
    ) -> Result<ConsoleSessionEndpoints, String> {
        let ws_port = self.ensure_started(vm_manager.clone()).await?;
        let serial_sock = self.resolve_serial_socket_path(node_id).await;
        let encoded_id = percent_encode_segment(node_id);

        let vm_info = vm_manager.get_vm_info(node_id).await;
        let vm_running = vm_info
            .as_ref()
            .map(|i| matches!(i.status, VmStatus::Starting | VmStatus::Running))
            .unwrap_or(false);
        let display_mode = vm_info
            .as_ref()
            .map(|i| i.display_mode)
            .unwrap_or(VmDisplayMode::Vnc);
        let vnc_tcp_port = vm_info.as_ref().and_then(|i| i.vnc_tcp_port);

        let vnc_ws_url = if display_mode == VmDisplayMode::Vnc {
            Some(format!("ws://127.0.0.1:{ws_port}/vnc/{encoded_id}"))
        } else {
            None
        };

        Ok(ConsoleSessionEndpoints {
            node_id: node_id.to_string(),
            ws_port,
            serial_ws_url: format!("ws://127.0.0.1:{ws_port}/serial/{encoded_id}"),
            vnc_ws_url,
            vnc_tcp_port,
            display_mode,
            vm_running,
            serial_socket_path: serial_sock.display().to_string(),
        })
    }

    /// Streams serial output to a Tauri v2 `Channel<Vec<u8>>` (alternative/companion to WebSocket).
    pub async fn attach_serial_channel(
        &self,
        node_id: &str,
        channel: tauri::ipc::Channel<Vec<u8>>,
    ) -> Result<(), String> {
        let hub = self.get_or_create_serial_hub(node_id).await;
        let mut rx = hub.broadcaster.subscribe();
        hub.ensure_connected().await?;

        let initial = hub.snapshot_scrollback().await;
        if !initial.is_empty() {
            let _ = channel.send(initial);
        }

        tokio::spawn(async move {
            while let Ok(chunk) = rx.recv().await {
                if channel.send(chunk.to_vec()).is_err() {
                    break;
                }
            }
        });
        Ok(())
    }

    /// Writes raw bytes directly to a VM's serial socket over IPC.
    pub async fn write_serial_bytes(&self, node_id: &str, data: &[u8]) -> Result<(), String> {
        let hub = self.get_or_create_serial_hub(node_id).await;
        hub.write_raw(data).await
    }

    /// Sends a serial BREAK / NUL attention sequence on the guest serial line.
    pub async fn send_serial_break(&self, node_id: &str) -> Result<(), String> {
        // Send NUL + Ctrl-C/break sequence; on raw UART chardev sockets NUL + break wakes BSD/Linux getty/ddb
        let hub = self.get_or_create_serial_hub(node_id).await;
        hub.write_raw(&[0x00]).await
    }

    /// Sends hardware `Ctrl+Alt+Del` to the guest VM via QEMU's QMP control socket.
    pub async fn send_ctrl_alt_del(&self, node_id: &str) -> Result<(), String> {
        let qmp_path = Self::resolve_qmp_socket_path(node_id);
        send_qmp_command(
            &qmp_path,
            "{\"execute\":\"send-key\",\"arguments\":{\"keys\":[{\"type\":\"qcode\",\"data\":\"ctrl\"},{\"type\":\"qcode\",\"data\":\"alt\"},{\"type\":\"qcode\",\"data\":\"delete\"}],\"hold-time\":100}}",
        )
        .await
    }

    /// Brings QEMU's native macOS `-display cocoa` window to the foreground for `node_id`.
    pub async fn focus_cocoa_window(
        &self,
        node_id: &str,
        vm_manager: &VmManager,
    ) -> Result<(), String> {
        let info = vm_manager
            .get_vm_info(node_id)
            .await
            .ok_or_else(|| format!("VM '{node_id}' is not running"))?;
        let pid = info
            .pid
            .ok_or_else(|| format!("VM '{node_id}' has no active macOS process ID"))?;

        let script = format!(
            "tell application \"System Events\" to set frontmost of first process whose unix id is {pid} to true"
        );
        let status = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(&script)
            .status()
            .await
            .map_err(|e| format!("Failed to invoke osascript: {e}"))?;

        if !status.success() {
            return Err(
                "Unable to focus QEMU Cocoa window (check macOS Accessibility/Window state)"
                    .to_string(),
            );
        }
        Ok(())
    }

    async fn handle_ws_connection(
        &self,
        mut stream: TcpStream,
        vm_manager: VmManager,
    ) -> Result<(), String> {
        let req = read_ws_upgrade_request(&mut stream).await?;
        if let Err(reason) = validate_ws_handshake(&req) {
            let body = format!("403 Forbidden: {reason}\n");
            let _ = stream
                .write_all(
                    format!(
                        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .await;
            let _ = stream.flush().await;
            return Err(reason);
        }
        let accept_val = compute_ws_accept_key(&req.sec_ws_key);

        let mut response = format!(
            "HTTP/1.1 101 Switching Protocols\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Accept: {accept_val}\r\n"
        );
        if let Some(proto) = req.negotiated_protocol {
            response.push_str(&format!("Sec-WebSocket-Protocol: {proto}\r\n"));
        }
        response.push_str("\r\n");

        stream
            .write_all(response.as_bytes())
            .await
            .map_err(|e| format!("Failed to send WebSocket 101 handshake: {e}"))?;
        stream.flush().await.map_err(|e| e.to_string())?;

        // Route based on request path: `/serial/<node_id>`, `/vnc/<node_id>`, or `/vncport/<port>`
        let clean_path = req.path.split('?').next().unwrap_or(&req.path);
        if let Some(encoded_node) = clean_path.strip_prefix("/serial/") {
            let node_id = percent_decode_segment(encoded_node);
            self.bridge_serial_ws(stream, &node_id, &vm_manager).await
        } else if let Some(encoded_node) = clean_path.strip_prefix("/vnc/") {
            let node_id = percent_decode_segment(encoded_node);
            self.bridge_vnc_node_ws(stream, &node_id, &vm_manager).await
        } else if let Some(port_str) = clean_path.strip_prefix("/vncport/") {
            let tcp_port: u16 = port_str
                .parse()
                .map_err(|_| format!("Invalid VNC TCP port '{port_str}'"))?;
            self.bridge_vnc_tcp_ws(stream, tcp_port).await
        } else {
            let _ = write_ws_frame(&mut stream, 0x8, b"").await;
            Err(format!("Unsupported console WebSocket path: {clean_path}"))
        }
    }

    async fn bridge_serial_ws(
        &self,
        ws_stream: TcpStream,
        node_id: &str,
        vm_manager: &VmManager,
    ) -> Result<(), String> {
        let hub = self.get_or_create_serial_hub(node_id).await;
        // Subscribe BEFORE reading scrollback so zero bytes are missed in between
        let mut rx = hub.broadcaster.subscribe();
        if let Err(err) = hub.ensure_connected_for_vm(node_id, Some(vm_manager)).await {
            let mut s = ws_stream;
            let msg = format!("\r\n\x1b[33m[Etherloom Serial Bridge] {err}\x1b[0m\r\n");
            let _ = write_ws_frame(&mut s, 0x2, msg.as_bytes()).await;
            let _ = write_ws_frame(&mut s, 0x8, b"").await;
            return Err(err);
        }

        let (mut ws_read, mut ws_write) = ws_stream.into_split();

        // Replay recent guest boot / login output from the 64 KiB scrollback ring buffer
        let replay = hub.snapshot_scrollback().await;
        if !replay.is_empty() {
            write_ws_frame(&mut ws_write, 0x2, &replay).await?;
        }

        let mut fragment_buf: Vec<u8> = Vec::new();

        loop {
            tokio::select! {
                bcast = rx.recv() => {
                    match bcast {
                        Ok(chunk) => {
                            if write_ws_frame(&mut ws_write, 0x2, &chunk).await.is_err() {
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            // Continue streaming latest frames immediately
                            continue;
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
                client_msg = read_ws_message(&mut ws_read, &mut fragment_buf) => {
                    match client_msg {
                        Ok(WsClientEvent::Payload(bytes)) => {
                            if !bytes.is_empty() && hub.write_raw(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Ok(WsClientEvent::Ping(payload)) => {
                            if write_ws_frame(&mut ws_write, 0xA, &payload).await.is_err() {
                                break;
                            }
                        }
                        Ok(WsClientEvent::Pong) => {}
                        Ok(WsClientEvent::Close) | Err(_) => {
                            let _ = write_ws_frame(&mut ws_write, 0x8, b"").await;
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn bridge_vnc_node_ws(
        &self,
        mut ws_stream: TcpStream,
        node_id: &str,
        vm_manager: &VmManager,
    ) -> Result<(), String> {
        // Wait up to ~10s if VM is still starting and registering its VNC TCP port
        let mut target_port: Option<u16> = None;
        for _ in 0..80 {
            if let Some(info) = vm_manager.get_vm_info(node_id).await {
                if matches!(info.status, VmStatus::Stopped | VmStatus::Crashed) {
                    break;
                }
                if let Some(port) = info.vnc_tcp_port {
                    target_port = Some(port);
                    break;
                }
            }
            sleep(Duration::from_millis(125)).await;
        }

        let Some(tcp_port) = target_port else {
            let _ = write_ws_frame(&mut ws_stream, 0x8, b"").await;
            return Err(format!("No active Embedded VNC port for VM '{node_id}'"));
        };

        self.bridge_vnc_tcp_ws(ws_stream, tcp_port).await
    }

    async fn bridge_vnc_tcp_ws(
        &self,
        mut ws_stream: TcpStream,
        vnc_tcp_port: u16,
    ) -> Result<(), String> {
        // Retry while QEMU initializes its local RFB TCP socket
        let mut vnc_conn: Option<TcpStream> = None;
        for _ in 0..80 {
            if let Ok(conn) =
                TcpStream::connect(SocketAddrV4::new(Ipv4Addr::LOCALHOST, vnc_tcp_port)).await
            {
                let _ = conn.set_nodelay(true);
                vnc_conn = Some(conn);
                break;
            }
            sleep(Duration::from_millis(100)).await;
        }

        let Some(vnc_stream) = vnc_conn else {
            let _ = write_ws_frame(&mut ws_stream, 0x8, b"").await;
            return Err(format!(
                "Unable to connect to QEMU VNC TCP socket 127.0.0.1:{vnc_tcp_port}"
            ));
        };

        let (mut ws_read, mut ws_write) = ws_stream.into_split();
        let (mut vnc_read, mut vnc_write) = vnc_stream.into_split();
        let mut vnc_buf = vec![0u8; 32_768];
        let mut fragment_buf: Vec<u8> = Vec::new();

        loop {
            tokio::select! {
                n_res = vnc_read.read(&mut vnc_buf) => {
                    match n_res {
                        Ok(0) | Err(_) => {
                            let _ = write_ws_frame(&mut ws_write, 0x8, b"").await;
                            break;
                        }
                        Ok(n) => {
                            if write_ws_frame(&mut ws_write, 0x2, &vnc_buf[..n]).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                ws_res = read_ws_message(&mut ws_read, &mut fragment_buf) => {
                    match ws_res {
                        Ok(WsClientEvent::Payload(bytes)) => {
                            if !bytes.is_empty() {
                                if vnc_write.write_all(&bytes).await.is_err() {
                                    break;
                                }
                                let _ = vnc_write.flush().await;
                            }
                        }
                        Ok(WsClientEvent::Ping(payload)) => {
                            if write_ws_frame(&mut ws_write, 0xA, &payload).await.is_err() {
                                break;
                            }
                        }
                        Ok(WsClientEvent::Pong) => {}
                        Ok(WsClientEvent::Close) | Err(_) => {
                            let _ = write_ws_frame(&mut ws_write, 0x8, b"").await;
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// QMP Command Helper (`send-key` for Ctrl+Alt+Del)
// -----------------------------------------------------------------------------

async fn send_qmp_command(qmp_socket_path: &Path, command_json: &str) -> Result<(), String> {
    let connect_timeout = Duration::from_millis(1500);
    let stream = timeout(connect_timeout, UnixStream::connect(qmp_socket_path))
        .await
        .map_err(|_| "Timed out connecting to QEMU QMP socket".to_string())?
        .map_err(|e| format!("QMP socket connect failed: {e}"))?;

    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    // 1. Greeting
    let _ = timeout(connect_timeout, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting QMP greeting".to_string())?
        .map_err(|e| e.to_string())?;

    // 2. Negotiate capabilities
    writer
        .write_all(b"{\"execute\":\"qmp_capabilities\"}\r\n")
        .await
        .map_err(|e| e.to_string())?;
    let _ = timeout(connect_timeout, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting qmp_capabilities ack".to_string())?
        .map_err(|e| e.to_string())?;

    // 3. Execute command
    writer
        .write_all(format!("{command_json}\r\n").as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let _ = timeout(connect_timeout, lines.next_line())
        .await
        .map_err(|_| "Timed out awaiting QMP command ack".to_string())?
        .map_err(|e| e.to_string())?;

    Ok(())
}

// -----------------------------------------------------------------------------
// RFC 6455 Minimal Zero-Dependency WebSocket Protocol Engine
// -----------------------------------------------------------------------------

struct WsUpgradeRequest {
    path: String,
    sec_ws_key: String,
    negotiated_protocol: Option<String>,
    host: Option<String>,
    origin: Option<String>,
}

enum WsClientEvent {
    Payload(Vec<u8>),
    Ping(Vec<u8>),
    Pong,
    Close,
}

async fn read_ws_upgrade_request(stream: &mut TcpStream) -> Result<WsUpgradeRequest, String> {
    let mut buf = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];

    while buf.len() < MAX_HTTP_HEADER_BYTES {
        let n = timeout(Duration::from_secs(5), stream.read(&mut byte))
            .await
            .map_err(|_| "WebSocket handshake timed out".to_string())?
            .map_err(|e| format!("WebSocket handshake read error: {e}"))?;
        if n == 0 {
            return Err("EOF before HTTP WebSocket upgrade header completed".to_string());
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }

    if !buf.ends_with(b"\r\n\r\n") {
        return Err("WebSocket upgrade header exceeded maximum length".to_string());
    }

    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Empty HTTP request".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/").to_string();
    if !method.eq_ignore_ascii_case("GET") {
        return Err(format!("Unsupported HTTP method '{method}' on WebSocket bridge"));
    }

    let mut sec_ws_key: Option<String> = None;
    let mut negotiated_protocol: Option<String> = None;
    let mut host: Option<String> = None;
    let mut origin: Option<String> = None;

    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, val)) = line.split_once(':') {
            let name_trim = name.trim();
            let val_trim = val.trim();
            if name_trim.eq_ignore_ascii_case("Sec-WebSocket-Key") {
                sec_ws_key = Some(val_trim.to_string());
            } else if name_trim.eq_ignore_ascii_case("Host") {
                host = Some(val_trim.to_string());
            } else if name_trim.eq_ignore_ascii_case("Origin") {
                origin = Some(val_trim.to_string());
            } else if name_trim.eq_ignore_ascii_case("Sec-WebSocket-Protocol") {
                // Prefer `binary` if requested by @novnc/novnc, else echo first offered subprotocol
                let offered: Vec<&str> = val_trim.split(',').map(str::trim).collect();
                if offered.iter().any(|p| p.eq_ignore_ascii_case("binary")) {
                    negotiated_protocol = Some("binary".to_string());
                } else if let Some(first) = offered.first().filter(|s| !s.is_empty()) {
                    negotiated_protocol = Some((*first).to_string());
                }
            }
        }
    }

    let sec_ws_key =
        sec_ws_key.ok_or_else(|| "Missing Sec-WebSocket-Key header".to_string())?;

    Ok(WsUpgradeRequest {
        path,
        sec_ws_key,
        negotiated_protocol,
        host,
        origin,
    })
}

async fn read_ws_message<R: AsyncReadExt + Unpin>(
    reader: &mut R,
    fragment_buf: &mut Vec<u8>,
) -> Result<WsClientEvent, String> {
    loop {
        let mut hdr = [0u8; 2];
        reader
            .read_exact(&mut hdr)
            .await
            .map_err(|e| format!("WS read header: {e}"))?;

        let fin = (hdr[0] & 0x80) != 0;
        let opcode = hdr[0] & 0x0F;
        let masked = (hdr[1] & 0x80) != 0;
        // RFC 6455 §5.1: servers MUST close the connection on unmasked client frames.
        if !masked {
            return Err("WebSocket client frame was not masked (RFC 6455 violation)".to_string());
        }
        let len_code = (hdr[1] & 0x7F) as usize;

        let payload_len: usize = match len_code {
            0..=125 => len_code,
            126 => {
                let mut ext = [0u8; 2];
                reader
                    .read_exact(&mut ext)
                    .await
                    .map_err(|e| e.to_string())?;
                u16::from_be_bytes(ext) as usize
            }
            127 => {
                let mut ext = [0u8; 8];
                reader
                    .read_exact(&mut ext)
                    .await
                    .map_err(|e| e.to_string())?;
                u64::from_be_bytes(ext) as usize
            }
            _ => unreachable!(),
        };

        if payload_len > MAX_WS_CLIENT_PAYLOAD {
            return Err("WebSocket client frame exceeded 4 MiB safety cap".to_string());
        }

        let mut mask_key = [0u8; 4];
        if masked {
            reader
                .read_exact(&mut mask_key)
                .await
                .map_err(|e| e.to_string())?;
        }

        let mut payload = vec![0u8; payload_len];
        if payload_len > 0 {
            reader
                .read_exact(&mut payload)
                .await
                .map_err(|e| e.to_string())?;
            if masked {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= mask_key[i & 3];
                }
            }
        }

        match opcode {
            0x8 => return Ok(WsClientEvent::Close),
            0x9 => return Ok(WsClientEvent::Ping(payload)),
            0xA => return Ok(WsClientEvent::Pong),
            0x1 | 0x2 => {
                if fin && fragment_buf.is_empty() {
                    return Ok(WsClientEvent::Payload(payload));
                }
                fragment_buf.clear();
                fragment_buf.extend_from_slice(&payload);
                if fin {
                    return Ok(WsClientEvent::Payload(std::mem::take(fragment_buf)));
                }
            }
            0x0 => {
                if fragment_buf.len() + payload.len() > MAX_WS_CLIENT_PAYLOAD {
                    fragment_buf.clear();
                    return Err("WebSocket fragmented message exceeded 4 MiB".to_string());
                }
                fragment_buf.extend_from_slice(&payload);
                if fin {
                    return Ok(WsClientEvent::Payload(std::mem::take(fragment_buf)));
                }
            }
            _ => {}
        }
    }
}

async fn write_ws_frame<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    opcode: u8,
    payload: &[u8],
) -> Result<(), String> {
    let mut header = [0u8; 10];
    header[0] = 0x80 | (opcode & 0x0F);
    let len = payload.len();
    let hdr_len = if len <= 125 {
        header[1] = len as u8;
        2
    } else if len <= 65_535 {
        header[1] = 126;
        let ext = (len as u16).to_be_bytes();
        header[2] = ext[0];
        header[3] = ext[1];
        4
    } else {
        header[1] = 127;
        let ext = (len as u64).to_be_bytes();
        header[2..10].copy_from_slice(&ext);
        10
    };

    writer
        .write_all(&header[..hdr_len])
        .await
        .map_err(|e| e.to_string())?;
    if !payload.is_empty() {
        writer
            .write_all(payload)
            .await
            .map_err(|e| e.to_string())?;
    }
    writer.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Computes RFC 6455 `Sec-WebSocket-Accept = Base64(SHA-1(key + WS_GUID))`.
pub fn compute_ws_accept_key(sec_ws_key: &str) -> String {
    let mut input = Vec::with_capacity(sec_ws_key.len() + WS_GUID.len());
    input.extend_from_slice(sec_ws_key.trim().as_bytes());
    input.extend_from_slice(WS_GUID.as_bytes());
    let digest = sha1_digest(&input);
    base64_encode(&digest)
}

/// Standard RFC 3174 SHA-1 digest used exclusively for RFC 6455 WebSocket handshake.
fn sha1_digest(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x6745_2301;
    let mut h1: u32 = 0xEFCD_AB89;
    let mut h2: u32 = 0x98BA_DCFE;
    let mut h3: u32 = 0x1032_5476;
    let mut h4: u32 = 0xC3D2_E1F0;

    let bit_len = (data.len() as u64) * 8;
    let mut padded = Vec::with_capacity(data.len() + 72);
    padded.extend_from_slice(data);
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            let off = i * 4;
            w[i] = u32::from_be_bytes([
                chunk[off],
                chunk[off + 1],
                chunk[off + 2],
                chunk[off + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn percent_encode_segment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn percent_decode_segment(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::UnixListener;
    use uuid::Uuid;

    /// Helper to send a masked client WebSocket binary frame in unit tests.
    async fn write_masked_client_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) {
        let mask = [0x12u8, 0x34, 0x56, 0x78];
        let mut frame = vec![0x80 | opcode, 0x80 | (payload.len() as u8)];
        frame.extend_from_slice(&mask);
        for (i, &b) in payload.iter().enumerate() {
            frame.push(b ^ mask[i & 3]);
        }
        stream.write_all(&frame).await.unwrap();
        stream.flush().await.unwrap();
    }

    /// Helper to read an unmasked server WebSocket frame in unit tests.
    async fn read_server_frame(stream: &mut TcpStream) -> (u8, Vec<u8>) {
        let mut hdr = [0u8; 2];
        stream.read_exact(&mut hdr).await.unwrap();
        let opcode = hdr[0] & 0x0F;
        let len = (hdr[1] & 0x7F) as usize;
        let mut payload = vec![0u8; len];
        stream.read_exact(&mut payload).await.unwrap();
        (opcode, payload)
    }

    #[test]
    fn rfc6455_websocket_accept_key_matches_official_spec_vector() {
        // RFC 6455 Section 1.3 test vector
        let accept = compute_ws_accept_key("dGhlIHNhbXBsZSBub25jZQ==");
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[tokio::test]
    async fn serial_unix_socket_streams_unbuffered_ansi_bytes_and_replays_scrollback() {
        let sock_path = PathBuf::from(format!(
            "/tmp/el-serial-{}.sock",
            &Uuid::new_v4().to_string()[..8]
        ));
        let _ = std::fs::remove_file(&sock_path);
        let unix_listener = UnixListener::bind(&sock_path).unwrap();

        // Simulate QEMU PL011 serial socket: immediately emit ANSI OpenBSD banner, then echo raw keystrokes
        tokio::spawn(async move {
            let (mut sock, _) = unix_listener.accept().await.unwrap();
            sock.write_all(b"\x1b[32mOpenBSD/arm64 (fw1) (tty00)\x1b[0m\r\nlogin: ")
                .await
                .unwrap();
            let mut single = [0u8; 1];
            if sock.read_exact(&mut single).await.is_ok() {
                // Echo single keystroke immediately with zero newline required!
                sock.write_all(&[single[0]]).await.unwrap();
            }
        });

        let bridge = ConsoleBridge::new();
        bridge
            .register_custom_serial_socket("node-fw1", sock_path.clone())
            .await;
        let vm_mgr = VmManager::new();
        let ws_port = bridge.ensure_started(vm_mgr).await.unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", ws_port)).await.unwrap();
        let handshake = "GET /serial/node-fw1 HTTP/1.1\r\n\
                         Host: 127.0.0.1\r\n\
                         Upgrade: websocket\r\n\
                         Connection: Upgrade\r\n\
                         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
                         Sec-WebSocket-Version: 13\r\n\r\n";
        client.write_all(handshake.as_bytes()).await.unwrap();

        // Read HTTP 101 response
        let mut resp = Vec::new();
        let mut b = [0u8; 1];
        while !resp.ends_with(b"\r\n\r\n") {
            client.read_exact(&mut b).await.unwrap();
            resp.push(b[0]);
        }
        let resp_str = String::from_utf8_lossy(&resp);
        assert!(resp_str.starts_with("HTTP/1.1 101"));

        // Receive ANSI banner frame
        let (op1, data1) = read_server_frame(&mut client).await;
        assert_eq!(op1, 0x2);
        assert!(String::from_utf8_lossy(&data1).contains("OpenBSD/arm64"));

        // Send a single unbuffered character 'r' (no newline!) and verify instant 1-byte echo
        write_masked_client_frame(&mut client, 0x2, b"r").await;
        let (op2, data2) = read_server_frame(&mut client).await;
        assert_eq!(op2, 0x2);
        assert_eq!(data2, b"r");

        let _ = std::fs::remove_file(&sock_path);
    }

    #[tokio::test]
    async fn vnc_websocket_bridge_proxies_rfb_binary_handshake_bidirectionally() {
        // Mock QEMU VNC RFB server on 127.0.0.1:0
        let mock_vnc = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let vnc_port = mock_vnc.local_addr().unwrap().port();

        tokio::spawn(async move {
            let (mut rfb_sock, _) = mock_vnc.accept().await.unwrap();
            rfb_sock.write_all(b"RFB 003.008\n").await.unwrap();
            let mut client_ver = [0u8; 12];
            rfb_sock.read_exact(&mut client_ver).await.unwrap();
            assert_eq!(&client_ver, b"RFB 003.008\n");
            // Security types: 1 type -> None (1)
            rfb_sock.write_all(&[0x01, 0x01]).await.unwrap();
        });

        let bridge = ConsoleBridge::new();
        let ws_port = bridge.ensure_started(VmManager::new()).await.unwrap();

        let mut ws_client = TcpStream::connect(("127.0.0.1", ws_port)).await.unwrap();
        let handshake = format!(
            "GET /vncport/{vnc_port} HTTP/1.1\r\n\
             Host: 127.0.0.1\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Protocol: binary\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
        );
        ws_client.write_all(handshake.as_bytes()).await.unwrap();

        let mut resp = Vec::new();
        let mut b = [0u8; 1];
        while !resp.ends_with(b"\r\n\r\n") {
            ws_client.read_exact(&mut b).await.unwrap();
            resp.push(b[0]);
        }
        let resp_str = String::from_utf8_lossy(&resp);
        assert!(resp_str.contains("Sec-WebSocket-Protocol: binary"));

        // Receive RFB 003.008 greeting
        let (op, rfb_greeting) = read_server_frame(&mut ws_client).await;
        assert_eq!(op, 0x2);
        assert_eq!(rfb_greeting, b"RFB 003.008\n");

        // Reply client RFB version & receive security type frame
        write_masked_client_frame(&mut ws_client, 0x2, b"RFB 003.008\n").await;
        let (op2, sec_types) = read_server_frame(&mut ws_client).await;
        assert_eq!(op2, 0x2);
        assert_eq!(sec_types, vec![0x01, 0x01]);
    }

    /// Reads an HTTP response head (until `\r\n\r\n`) from a raw TCP client.
    async fn read_http_response_head(client: &mut TcpStream) -> String {
        let mut resp = Vec::new();
        let mut b = [0u8; 1];
        while !resp.ends_with(b"\r\n\r\n") {
            let n = client.read(&mut b).await.unwrap();
            if n == 0 {
                break;
            }
            resp.push(b[0]);
        }
        String::from_utf8_lossy(&resp).into_owned()
    }

    #[tokio::test]
    async fn ws_handshake_rejects_cross_origin_and_non_loopback_host() {
        let bridge = ConsoleBridge::new();
        let ws_port = bridge.ensure_started(VmManager::new()).await.unwrap();

        // 1. Cross-origin browser page must be rejected with HTTP 403
        let mut evil = TcpStream::connect(("127.0.0.1", ws_port)).await.unwrap();
        evil.write_all(
            "GET /serial/node-fw1 HTTP/1.1\r\n\
             Host: 127.0.0.1\r\n\
             Origin: https://evil.example\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
                .as_bytes(),
        )
        .await
        .unwrap();
        let resp = read_http_response_head(&mut evil).await;
        assert!(resp.starts_with("HTTP/1.1 403"), "got: {resp}");

        // 2. DNS-rebinding style non-loopback Host must be rejected even with a trusted Origin
        let mut rebind = TcpStream::connect(("127.0.0.1", ws_port)).await.unwrap();
        rebind
            .write_all(
                "GET /serial/node-fw1 HTTP/1.1\r\n\
                 Host: evil.example\r\n\
                 Origin: tauri://localhost\r\n\
                 Upgrade: websocket\r\n\
                 Connection: Upgrade\r\n\
                 Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
                 Sec-WebSocket-Version: 13\r\n\r\n"
                    .as_bytes(),
            )
            .await
            .unwrap();
        let resp = read_http_response_head(&mut rebind).await;
        assert!(resp.starts_with("HTTP/1.1 403"), "got: {resp}");
    }

    #[tokio::test]
    async fn ws_handshake_accepts_tauri_webview_origin_and_rejects_unmasked_frames() {
        // Register a mock serial socket so the relay loop starts reading WS frames immediately
        let sock_path = PathBuf::from(format!(
            "/tmp/el-serial-{}.sock",
            &Uuid::new_v4().to_string()[..8]
        ));
        let _ = std::fs::remove_file(&sock_path);
        let unix_listener = UnixListener::bind(&sock_path).unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = unix_listener.accept().await.unwrap();
            let mut buf = [0u8; 64];
            let _ = sock.read(&mut buf).await;
        });

        let bridge = ConsoleBridge::new();
        bridge
            .register_custom_serial_socket("node-orig", sock_path.clone())
            .await;
        let ws_port = bridge.ensure_started(VmManager::new()).await.unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", ws_port)).await.unwrap();
        client
            .write_all(
                "GET /serial/node-orig HTTP/1.1\r\n\
                 Host: 127.0.0.1\r\n\
                 Origin: tauri://localhost\r\n\
                 Upgrade: websocket\r\n\
                 Connection: Upgrade\r\n\
                 Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
                 Sec-WebSocket-Version: 13\r\n\r\n"
                    .as_bytes(),
            )
            .await
            .unwrap();
        let resp = read_http_response_head(&mut client).await;
        assert!(resp.starts_with("HTTP/1.1 101"), "got: {resp}");

        // Give the relay loop a moment to start reading frames
        sleep(Duration::from_millis(100)).await;

        // Unmasked client frame (RFC 6455 violation) must terminate the connection
        // (server replies with a Close frame, then drops the socket).
        client.write_all(&[0x82, 0x01, b'x']).await.unwrap();
        let mut saw_close = false;
        loop {
            let mut hdr = [0u8; 2];
            let r = tokio::time::timeout(Duration::from_secs(2), client.read_exact(&mut hdr)).await;
            match r {
                Ok(Ok(_)) => {
                    if hdr[0] & 0x0F == 0x8 {
                        saw_close = true;
                    }
                    let len = (hdr[1] & 0x7F) as usize;
                    let mut payload = vec![0u8; len];
                    let _ = client.read_exact(&mut payload).await;
                }
                _ => break, // timeout or EOF
            }
        }
        assert!(saw_close, "server should send a WS Close frame after an unmasked client frame");

        let _ = std::fs::remove_file(&sock_path);
    }
}
