use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::sync::{watch, RwLock};
use uuid::Uuid;

pub type PortId = String;
pub type LinkId = String;
pub type DeviceId = String;

/// Minimum valid IEEE 802.3 / Ethernet II header size (6B dst + 6B src + 2B ethertype).
pub const MIN_ETHERNET_FRAME_LEN: usize = 14;
/// IEEE 802.1Q Customer VLAN Tagging EtherType (`0x8100` — adds 4B TCI header for 1518B MTU frames).
pub const ETHERTYPE_8021Q: u16 = 0x8100;
/// IEEE 802.1ad Provider Bridge / QinQ EtherType (`0x88a8` — adds outer 4B S-Tag).
pub const ETHERTYPE_8021AD: u16 = 0x88a8;
/// Guaranteed jumbo Ethernet II / VLAN frame capacity (`9216` bytes matches macOS `net.inet.udp.maxdgram`).
pub const JUMBO_ETHERNET_FRAME_LEN: usize = 9_216;
/// Maximum UDP datagram payload buffer (`65_535` bytes >= `9_216` bytes for 802.1Q VLANs, QinQ & jumbo frames).
pub const MAX_UDP_FRAME_BUF: usize = 65_535;
/// Target kernel UDP socket buffer size (`256 KiB`) to absorb back-to-back 802.1Q trunk / jumbo bursts.
const TARGET_UDP_SOCKET_BUF_BYTES: libc::c_int = 262_144;
/// Default IEEE 802.1D MAC address table aging timeout (300 seconds).
pub const DEFAULT_MAC_AGING_TTL: Duration = Duration::from_secs(300);
/// Maximum internal virtual-switch hops per frame to prevent infinite broadcast storms on user loops.
const MAX_INTERNAL_HOPS: u8 = 16;

/// Formats a 6-byte MAC address as lowercase colon-delimited hex (`52:54:00:10:01:00`).
pub fn format_mac(mac: &[u8; 6]) -> String {
    format!(
        "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    )
}

/// Parses a colon- or hyphen-delimited MAC string into `[u8; 6]`.
pub fn parse_mac(text: &str) -> Result<[u8; 6], String> {
    let parts: Vec<&str> = text.trim().split([':', '-']).collect();
    if parts.len() != 6 {
        return Err(format!("Invalid MAC address '{text}': expected 6 octets"));
    }
    let mut out = [0u8; 6];
    for (i, part) in parts.iter().enumerate() {
        out[i] = u8::from_str_radix(part, 16)
            .map_err(|_| format!("Invalid hex octet '{part}' in MAC '{text}'"))?;
    }
    Ok(out)
}

/// Parsed Ethernet II header (Destination MAC, Source MAC, EtherType).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EthernetHeader {
    pub dst_mac: [u8; 6],
    pub src_mac: [u8; 6],
    pub ethertype: u16,
}

impl EthernetHeader {
    #[inline]
    pub fn parse(frame: &[u8]) -> Option<Self> {
        if frame.len() < MIN_ETHERNET_FRAME_LEN {
            return None;
        }
        let mut dst_mac = [0u8; 6];
        let mut src_mac = [0u8; 6];
        dst_mac.copy_from_slice(&frame[0..6]);
        src_mac.copy_from_slice(&frame[6..12]);
        let ethertype = u16::from_be_bytes([frame[12], frame[13]]);
        Some(Self {
            dst_mac,
            src_mac,
            ethertype,
        })
    }

    /// True if `dst_mac` is broadcast (`ff:ff:ff:ff:ff:ff`) or group/multicast (I/G bit set).
    #[inline]
    pub fn is_broadcast_or_multicast_dst(&self) -> bool {
        (self.dst_mac[0] & 0x01) != 0
    }

    /// True if `src_mac` is a valid learnable unicast MAC (I/G bit == 0 and non-zero).
    #[inline]
    pub fn is_learnable_unicast_src(&self) -> bool {
        (self.src_mac[0] & 0x01) == 0 && self.src_mac != [0u8; 6]
    }

    /// True if outer EtherType indicates IEEE 802.1Q (`0x8100`) or 802.1ad QinQ (`0x88a8`) tagging.
    #[inline]
    pub fn is_vlan_tagged(&self) -> bool {
        self.ethertype == ETHERTYPE_8021Q || self.ethertype == ETHERTYPE_8021AD
    }
}

/// Best-effort enlargement of OS UDP socket send/receive buffers (`256 KiB`) so back-to-back
/// 1518-byte `802.1Q` trunk bursts and up to `9216`-byte jumbo frames never drop in kernel queues.
#[cfg(unix)]
fn tune_udp_socket_buffers(socket: &UdpSocket) {
    use std::os::unix::io::AsRawFd;
    let fd = socket.as_raw_fd();
    let val: libc::c_int = TARGET_UDP_SOCKET_BUF_BYTES;
    let len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    unsafe {
        let _ = libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_RCVBUF,
            (&val as *const libc::c_int).cast(),
            len,
        );
        let _ = libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_SNDBUF,
            (&val as *const libc::c_int).cast(),
            len,
        );
    }
}

#[cfg(not(unix))]
fn tune_udp_socket_buffers(_socket: &UdpSocket) {}

/// Live entry inside a Virtual L2 Switch's MAC learning table.
#[derive(Debug, Clone)]
pub struct MacEntry {
    pub port_id: PortId,
    pub learned_at: Instant,
    pub frames_seen: u64,
}

/// IPC-serializable MAC table row exposed to the frontend UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MacTableEntryDto {
    pub mac: String,
    pub mac_bytes: [u8; 6],
    pub port_id: PortId,
    pub age_ms: u64,
    pub ttl_remaining_ms: u64,
    pub frames_seen: u64,
}

/// Pure-Rust IEEE 802.1D learning L2 Switch state.
#[derive(Debug)]
pub struct L2SwitchCore {
    pub id: DeviceId,
    pub name: String,
    pub ports: Vec<PortId>,
    pub mac_table: HashMap<[u8; 6], MacEntry>,
    pub aging_ttl: Duration,
}

impl L2SwitchCore {
    pub fn new(id: DeviceId, name: String, ports: Vec<PortId>, aging_ttl: Duration) -> Self {
        Self {
            id,
            name,
            ports,
            mac_table: HashMap::new(),
            aging_ttl,
        }
    }

    /// Evicts stale MAC entries older than `self.aging_ttl`.
    pub fn purge_expired(&mut self, now: Instant) {
        let ttl = self.aging_ttl;
        self.mac_table
            .retain(|_, entry| now.saturating_duration_since(entry.learned_at) <= ttl);
    }

    /// Processes an incoming Ethernet II frame on `ingress_port` and returns the list of egress `PortId`s.
    pub fn process_frame(
        &mut self,
        ingress_port: &str,
        frame: &[u8],
        now: Instant,
    ) -> Vec<PortId> {
        let Some(hdr) = EthernetHeader::parse(frame) else {
            return Vec::new();
        };

        self.purge_expired(now);

        // 1. Source MAC learning
        if hdr.is_learnable_unicast_src() {
            let entry = self
                .mac_table
                .entry(hdr.src_mac)
                .or_insert_with(|| MacEntry {
                    port_id: ingress_port.to_string(),
                    learned_at: now,
                    frames_seen: 0,
                });
            entry.port_id = ingress_port.to_string();
            entry.learned_at = now;
            entry.frames_seen = entry.frames_seen.saturating_add(1);
        }

        // 2. Broadcast / multicast always floods to all other switch ports
        if hdr.is_broadcast_or_multicast_dst() {
            return self.flood_ports(ingress_port);
        }

        // 3. Unicast destination lookup
        if let Some(target) = self.mac_table.get(&hdr.dst_mac) {
            if target.port_id == ingress_port {
                // Hairpin filter: destination lives on the same segment as ingress
                return Vec::new();
            }
            return vec![target.port_id.clone()];
        }

        // 4. Unknown unicast floods
        self.flood_ports(ingress_port)
    }

    fn flood_ports(&self, ingress_port: &str) -> Vec<PortId> {
        self.ports
            .iter()
            .filter(|p| p.as_str() != ingress_port)
            .cloned()
            .collect()
    }

    /// Exports a sorted snapshot of active MAC table entries.
    pub fn snapshot_mac_table(&mut self, now: Instant) -> Vec<MacTableEntryDto> {
        self.purge_expired(now);
        let ttl_ms = self.aging_ttl.as_millis() as u64;
        let mut rows: Vec<MacTableEntryDto> = self
            .mac_table
            .iter()
            .map(|(mac, entry)| {
                let age_ms = now.saturating_duration_since(entry.learned_at).as_millis() as u64;
                MacTableEntryDto {
                    mac: format_mac(mac),
                    mac_bytes: *mac,
                    port_id: entry.port_id.clone(),
                    age_ms,
                    ttl_remaining_ms: ttl_ms.saturating_sub(age_ms),
                    frames_seen: entry.frames_seen,
                }
            })
            .collect();
        rows.sort_by(|a, b| a.mac.cmp(&b.mac));
        rows
    }
}

/// Pure-Rust L1 Hub (multi-port Ethernet repeater).
#[derive(Debug)]
pub struct L1HubCore {
    pub id: DeviceId,
    pub name: String,
    pub ports: Vec<PortId>,
}

impl L1HubCore {
    pub fn new(id: DeviceId, name: String, ports: Vec<PortId>) -> Self {
        Self { id, name, ports }
    }

    /// Floods every valid Ethernet frame out all ports except `ingress_port`.
    pub fn process_frame(&self, ingress_port: &str, frame: &[u8]) -> Vec<PortId> {
        if frame.len() < MIN_ETHERNET_FRAME_LEN {
            return Vec::new();
        }
        self.ports
            .iter()
            .filter(|p| p.as_str() != ingress_port)
            .cloned()
            .collect()
    }
}

#[derive(Debug)]
enum VirtualDevice {
    Switch(L2SwitchCore),
    Hub(L1HubCore),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDeviceInfo {
    pub id: DeviceId,
    pub name: String,
    pub kind: String, // "l2_switch" | "l1_hub"
    pub ports: Vec<PortId>,
}

/// Binding metadata for a QEMU `-netdev socket,udp=127.0.0.1:{fabric_port},localaddr=127.0.0.1:{vm_port}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdpPortBinding {
    pub port_id: PortId,
    pub fabric_port: u16,
    pub vm_port: u16,
}

#[derive(Debug)]
enum PortKind {
    Udp {
        socket: Arc<UdpSocket>,
        fabric_port: u16,
        vm_port: u16,
        peer_addr: SocketAddr,
        stop_tx: watch::Sender<bool>,
    },
    Virtual {
        device_id: DeviceId,
    },
}

/// Mutable link impairment configuration.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkImpairmentConfig {
    pub admin_up: bool,
    pub latency_ms: u32,
    pub jitter_ms: u32,
    pub loss_percent: f64,
}

impl Default for LinkImpairmentConfig {
    fn default() -> Self {
        Self {
            admin_up: true,
            latency_ms: 0,
            jitter_ms: 0,
            loss_percent: 0.0,
        }
    }
}

/// Lock-free atomic counters updated per packet on a Point-to-Point wire.
#[derive(Debug)]
struct LinkCounters {
    /// Packets forwarded `port_a -> port_b`
    tx_packets: AtomicU64,
    /// Packets forwarded `port_b -> port_a`
    rx_packets: AtomicU64,
    /// Bytes forwarded `port_a -> port_b`
    tx_bytes: AtomicU64,
    /// Bytes forwarded `port_b -> port_a`
    rx_bytes: AtomicU64,
    /// Packets dropped due to cable cut (`admin_up == false`) or simulated loss
    dropped_packets: AtomicU64,
    /// Previous byte total sampled by the telemetry ticker
    last_sampled_bytes: AtomicU64,
    /// Latest computed throughput (`bytes/sec` * 100 stored as integer hundredths for lock-free reads)
    bytes_per_sec_x100: AtomicU64,
}

impl Default for LinkCounters {
    fn default() -> Self {
        Self {
            tx_packets: AtomicU64::new(0),
            rx_packets: AtomicU64::new(0),
            tx_bytes: AtomicU64::new(0),
            rx_bytes: AtomicU64::new(0),
            dropped_packets: AtomicU64::new(0),
            last_sampled_bytes: AtomicU64::new(0),
            bytes_per_sec_x100: AtomicU64::new(0),
        }
    }
}

#[derive(Debug)]
struct WireLink {
    id: LinkId,
    port_a: PortId,
    port_b: PortId,
    config: RwLock<LinkImpairmentConfig>,
    admin_up_fast: AtomicBool,
    counters: LinkCounters,
    tap_tx: tokio::sync::broadcast::Sender<crate::pcap_tap::TappedFrame>,
    capturing_pcap: AtomicBool,
    captured_packets: AtomicU64,
    captured_bytes: AtomicU64,
    active_pcap_path: RwLock<Option<String>>,
    live_wireshark: AtomicBool,
}

impl WireLink {
    fn peer_of(&self, port_id: &str) -> Option<(PortId, bool)> {
        if self.port_a == port_id {
            Some((self.port_b.clone(), true)) // A -> B (`tx`)
        } else if self.port_b == port_id {
            Some((self.port_a.clone(), false)) // B -> A (`rx`)
        } else {
            None
        }
    }

    async fn snapshot(&self) -> LinkSnapshot {
        let cfg = *self.config.read().await;
        let tx_packets = self.counters.tx_packets.load(Ordering::Relaxed);
        let rx_packets = self.counters.rx_packets.load(Ordering::Relaxed);
        let tx_bytes = self.counters.tx_bytes.load(Ordering::Relaxed);
        let rx_bytes = self.counters.rx_bytes.load(Ordering::Relaxed);
        let dropped_packets = self.counters.dropped_packets.load(Ordering::Relaxed);
        let bps = (self.counters.bytes_per_sec_x100.load(Ordering::Relaxed) as f64) / 100.0;
        let capturing_pcap = self.capturing_pcap.load(Ordering::Relaxed);
        let captured_packets = self.captured_packets.load(Ordering::Relaxed);
        let captured_bytes = self.captured_bytes.load(Ordering::Relaxed);
        let active_pcap_path = self.active_pcap_path.read().await.clone();
        let live_wireshark = self.live_wireshark.load(Ordering::Relaxed);

        LinkSnapshot {
            id: self.id.clone(),
            port_a: self.port_a.clone(),
            port_b: self.port_b.clone(),
            admin_up: cfg.admin_up,
            latency_ms: cfg.latency_ms,
            jitter_ms: cfg.jitter_ms,
            loss_percent: cfg.loss_percent,
            tx_packets,
            rx_packets,
            tx_bytes,
            rx_bytes,
            dropped_packets,
            bytes_per_sec: bps,
            capturing_pcap,
            captured_packets,
            captured_bytes,
            active_pcap_path,
            live_wireshark,
        }
    }
}

/// Real-time point-to-point link state & counters returned over IPC and periodic telemetry events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSnapshot {
    pub id: LinkId,
    pub port_a: PortId,
    pub port_b: PortId,
    pub admin_up: bool,
    pub latency_ms: u32,
    pub jitter_ms: u32,
    pub loss_percent: f64,
    pub tx_packets: u64,
    pub rx_packets: u64,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub dropped_packets: u64,
    pub bytes_per_sec: f64,
    pub capturing_pcap: bool,
    pub captured_packets: u64,
    pub captured_bytes: u64,
    pub active_pcap_path: Option<String>,
    pub live_wireshark: bool,
}

/// Periodic Tauri event payload emitted on `"etherloom://fabric-metrics"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricTelemetryEvent {
    pub timestamp_ms: u64,
    pub links: Vec<LinkSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLinkRequest {
    pub link_id: Option<String>,
    pub port_a: PortId,
    pub port_b: PortId,
    pub admin_up: Option<bool>,
    pub latency_ms: Option<u32>,
    pub jitter_ms: Option<u32>,
    pub loss_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLinkRequest {
    pub link_id: LinkId,
    pub admin_up: Option<bool>,
    pub latency_ms: Option<u32>,
    pub jitter_ms: Option<u32>,
    pub loss_percent: Option<f64>,
}

struct FabricInner {
    ports: RwLock<HashMap<PortId, PortKind>>,
    devices: RwLock<HashMap<DeviceId, tokio::sync::Mutex<VirtualDevice>>>,
    links: RwLock<HashMap<LinkId, Arc<WireLink>>>,
    port_to_link: RwLock<HashMap<PortId, LinkId>>,
    reserved_vm_ports: std::sync::Mutex<std::collections::HashSet<u16>>,
}

/// Central zero-root userspace Ethernet II packet router, L2 switch & L1 hub fabric.
#[derive(Clone)]
pub struct PacketFabric {
    inner: Arc<FabricInner>,
}

impl Default for PacketFabric {
    fn default() -> Self {
        Self::new()
    }
}

impl PacketFabric {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(FabricInner {
                ports: RwLock::new(HashMap::new()),
                devices: RwLock::new(HashMap::new()),
                links: RwLock::new(HashMap::new()),
                port_to_link: RwLock::new(HashMap::new()),
                reserved_vm_ports: std::sync::Mutex::new(std::collections::HashSet::new()),
            }),
        }
    }

    /// Starts the 1 Hz real-time link throughput sampler & Tauri event emitter (`etherloom://fabric-metrics`).
    pub fn spawn_telemetry_loop(&self, app_handle: AppHandle) {
        let fabric = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            let mut last_tick = Instant::now();
            loop {
                interval.tick().await;
                let now = Instant::now();
                let dt = now.saturating_duration_since(last_tick).as_secs_f64().max(0.001);
                last_tick = now;

                let snapshots = fabric.sample_and_collect_metrics(dt).await;
                if !snapshots.is_empty() {
                    let event = FabricTelemetryEvent {
                        timestamp_ms: now_epoch_ms(),
                        links: snapshots,
                    };
                    let _ = app_handle.emit("etherloom://fabric-metrics", event);
                }
            }
        });
    }

    /// Updates `bytes_per_sec` across all links over elapsed seconds `dt` and returns snapshots.
    pub async fn sample_and_collect_metrics(&self, dt_secs: f64) -> Vec<LinkSnapshot> {
        let links: Vec<Arc<WireLink>> = {
            let guard = self.inner.links.read().await;
            guard.values().cloned().collect()
        };

        let mut snapshots = Vec::with_capacity(links.len());
        for link in links {
            let total_bytes = link.counters.tx_bytes.load(Ordering::Relaxed)
                + link.counters.rx_bytes.load(Ordering::Relaxed);
            let prev = link
                .counters
                .last_sampled_bytes
                .swap(total_bytes, Ordering::Relaxed);
            let delta = total_bytes.saturating_sub(prev);
            let bps_x100 = (((delta as f64) / dt_secs.max(0.001)) * 100.0) as u64;
            link.counters
                .bytes_per_sec_x100
                .store(bps_x100, Ordering::Relaxed);
            snapshots.push(link.snapshot().await);
        }
        snapshots.sort_by(|a, b| a.id.cmp(&b.id));
        snapshots
    }

    /// Reserves an unused loopback UDP port for a QEMU guest NIC's `localaddr=127.0.0.1:{vm_port}`.
    fn allocate_free_vm_udp_port(&self, requested: Option<u16>) -> Result<u16, String> {
        if let Some(explicit) = requested {
            if explicit > 0 {
                if let Ok(mut set) = self.inner.reserved_vm_ports.lock() {
                    set.insert(explicit);
                }
                return Ok(explicit);
            }
        }

        for _ in 0..32 {
            let probe = std::net::UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
                .map_err(|e| format!("Failed to allocate ephemeral UDP port: {e}"))?;
            let port = probe
                .local_addr()
                .map_err(|e| format!("Failed to inspect ephemeral UDP port: {e}"))?
                .port();
            drop(probe);

            let mut guard = self
                .inner
                .reserved_vm_ports
                .lock()
                .map_err(|_| "UDP port registry poisoned".to_string())?;
            if guard.insert(port) {
                return Ok(port);
            }
        }

        Err("Unable to allocate unique loopback UDP port after 32 attempts".to_string())
    }

    /// Looks up an existing UDP port binding by `port_id`, if registered.
    pub async fn get_udp_port(&self, port_id: &str) -> Option<UdpPortBinding> {
        let guard = self.inner.ports.read().await;
        match guard.get(port_id) {
            Some(PortKind::Udp {
                fabric_port,
                vm_port,
                ..
            }) => Some(UdpPortBinding {
                port_id: port_id.to_string(),
                fabric_port: *fabric_port,
                vm_port: *vm_port,
            }),
            _ => None,
        }
    }

    /// Idempotently returns an existing UDP port binding for `port_id` or binds a new pair.
    pub async fn ensure_udp_port(&self, port_id: &str) -> Result<UdpPortBinding, String> {
        if let Some(existing) = self.get_udp_port(port_id).await {
            return Ok(existing);
        }
        self.create_udp_port(Some(port_id.to_string()), None).await
    }

    /// Idempotently ensures a virtual L2 Switch or L1 Hub exists with `port_count` ports.
    pub async fn ensure_virtual_device(
        &self,
        device_id: &str,
        name: &str,
        kind: &str,
        port_count: usize,
    ) -> Result<VirtualDeviceInfo, String> {
        let existing_check = {
            let guard = self.inner.devices.read().await;
            if let Some(dev_mutex) = guard.get(device_id) {
                let mut dev = dev_mutex.lock().await;
                match &mut *dev {
                    VirtualDevice::Switch(sw) if kind == "l2_switch" && sw.ports.len() == port_count => {
                        sw.name = name.to_string();
                        Some(VirtualDeviceInfo {
                            id: sw.id.clone(),
                            name: sw.name.clone(),
                            kind: "l2_switch".to_string(),
                            ports: sw.ports.clone(),
                        })
                    }
                    VirtualDevice::Hub(hub) if kind == "l1_hub" && hub.ports.len() == port_count => {
                        hub.name = name.to_string();
                        Some(VirtualDeviceInfo {
                            id: hub.id.clone(),
                            name: hub.name.clone(),
                            kind: "l1_hub".to_string(),
                            ports: hub.ports.clone(),
                        })
                    }
                    _ => None,
                }
            } else {
                None
            }
        };

        if let Some(info) = existing_check {
            return Ok(info);
        }

        // If device exists with mismatched kind or port count, remove first
        let exists = { self.inner.devices.read().await.contains_key(device_id) };
        if exists {
            let _ = self.remove_device(device_id).await;
        }

        if kind == "l1_hub" {
            self.create_hub(Some(device_id.to_string()), name.to_string(), port_count)
                .await
        } else {
            self.create_switch(Some(device_id.to_string()), name.to_string(), port_count)
                .await
        }
    }

    /// Resets the entire `PacketFabric` (tearing down all wires, switches/hubs, and UDP ports).
    pub async fn reset(&self) {
        let link_ids: Vec<String> = {
            let guard = self.inner.links.read().await;
            guard.keys().cloned().collect()
        };
        for lid in link_ids {
            let _ = self.remove_link(&lid).await;
        }

        let dev_ids: Vec<String> = {
            let guard = self.inner.devices.read().await;
            guard.keys().cloned().collect()
        };
        for did in dev_ids {
            let _ = self.remove_device(&did).await;
        }

        let port_ids: Vec<String> = {
            let guard = self.inner.ports.read().await;
            guard.keys().cloned().collect()
        };
        for pid in port_ids {
            let _ = self.remove_port(&pid).await;
        }
    }

    /// Binds a live `PacketFabric` UDP endpoint port on `127.0.0.1:{fabric_port}` paired with
    /// `127.0.0.1:{vm_port}` and starts its async receive loop.
    pub async fn create_udp_port(
        &self,
        port_id: Option<String>,
        requested_vm_port: Option<u16>,
    ) -> Result<UdpPortBinding, String> {
        let id = port_id.unwrap_or_else(|| format!("udp-{}", Uuid::new_v4()));
        {
            let guard = self.inner.ports.read().await;
            if guard.contains_key(&id) {
                return Err(format!("Fabric port '{id}' already exists"));
            }
        }

        let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|e| format!("Failed to bind fabric UDP socket: {e}"))?;
        tune_udp_socket_buffers(&socket);
        let fabric_port = socket
            .local_addr()
            .map_err(|e| format!("Failed to query fabric socket addr: {e}"))?
            .port();

        // Reserve `fabric_port` first so `vm_port` can never collide with it
        if let Ok(mut set) = self.inner.reserved_vm_ports.lock() {
            set.insert(fabric_port);
        }
        let vm_port = self.allocate_free_vm_udp_port(requested_vm_port)?;
        let peer_addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, vm_port));

        let socket = Arc::new(socket);
        let (stop_tx, mut stop_rx) = watch::channel(false);

        {
            let mut guard = self.inner.ports.write().await;
            guard.insert(
                id.clone(),
                PortKind::Udp {
                    socket: socket.clone(),
                    fabric_port,
                    vm_port,
                    peer_addr,
                    stop_tx,
                },
            );
        }

        // Spawn high-throughput non-blocking UDP ingress task for this VM NIC port
        let fabric = self.clone();
        let ingress_id = id.clone();
        let recv_sock = socket.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; MAX_UDP_FRAME_BUF];
            loop {
                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() {
                            break;
                        }
                    }
                    recv_res = recv_sock.recv_from(&mut buf) => {
                        match recv_res {
                            Ok((len, _src_addr)) => {
                                if len >= MIN_ETHERNET_FRAME_LEN {
                                    let frame = Bytes::copy_from_slice(&buf[..len]);
                                    fabric.handle_port_ingress(&ingress_id, frame, 0).await;
                                }
                            }
                            Err(_) => {
                                // Transient ECONNREFUSED on loopback UDP when guest is still booting is normal; continue
                                tokio::task::yield_now().await;
                            }
                        }
                    }
                }
            }
        });

        Ok(UdpPortBinding {
            port_id: id,
            fabric_port,
            vm_port,
        })
    }

    /// Removes a port (and detaches any wire connected to it), stopping its UDP listener if applicable.
    pub async fn remove_port(&self, port_id: &str) -> Result<(), String> {
        let linked = {
            let guard = self.inner.port_to_link.read().await;
            guard.get(port_id).cloned()
        };
        if let Some(link_id) = linked {
            let _ = self.remove_link(&link_id).await;
        }

        let removed = {
            let mut guard = self.inner.ports.write().await;
            guard.remove(port_id)
        };

        if let Some(PortKind::Udp {
            fabric_port,
            vm_port,
            stop_tx,
            ..
        }) = removed
        {
            let _ = stop_tx.send(true);
            if let Ok(mut set) = self.inner.reserved_vm_ports.lock() {
                set.remove(&fabric_port);
                set.remove(&vm_port);
            }
        }
        Ok(())
    }

    /// Instantiates a Pure-Rust Virtual L2 Switch with `port_count` virtual ports (`{id}-p0`..).
    pub async fn create_switch(
        &self,
        switch_id: Option<String>,
        name: String,
        port_count: usize,
    ) -> Result<VirtualDeviceInfo, String> {
        self.create_switch_with_ttl(switch_id, name, port_count, DEFAULT_MAC_AGING_TTL)
            .await
    }

    /// Instantiates a Virtual L2 Switch with a custom MAC aging TTL (useful for labs & unit tests).
    pub async fn create_switch_with_ttl(
        &self,
        switch_id: Option<String>,
        name: String,
        port_count: usize,
        aging_ttl: Duration,
    ) -> Result<VirtualDeviceInfo, String> {
        if port_count == 0 || port_count > 128 {
            return Err("Switch port_count must be between 1 and 128".to_string());
        }
        let id = switch_id.unwrap_or_else(|| format!("sw-{}", Uuid::new_v4()));

        {
            let guard = self.inner.devices.read().await;
            if guard.contains_key(&id) {
                return Err(format!("Virtual device '{id}' already exists"));
            }
        }

        let ports: Vec<PortId> = (0..port_count).map(|i| format!("{id}-p{i}")).collect();
        let sw = L2SwitchCore::new(id.clone(), name.clone(), ports.clone(), aging_ttl);

        {
            let mut ports_guard = self.inner.ports.write().await;
            for pid in &ports {
                ports_guard.insert(
                    pid.clone(),
                    PortKind::Virtual {
                        device_id: id.clone(),
                    },
                );
            }
        }
        {
            let mut dev_guard = self.inner.devices.write().await;
            dev_guard.insert(id.clone(), tokio::sync::Mutex::new(VirtualDevice::Switch(sw)));
        }

        Ok(VirtualDeviceInfo {
            id,
            name,
            kind: "l2_switch".to_string(),
            ports,
        })
    }

    /// Instantiates a Pure-Rust Virtual L1 Hub with `port_count` virtual ports (`{id}-p0`..).
    pub async fn create_hub(
        &self,
        hub_id: Option<String>,
        name: String,
        port_count: usize,
    ) -> Result<VirtualDeviceInfo, String> {
        if port_count == 0 || port_count > 128 {
            return Err("Hub port_count must be between 1 and 128".to_string());
        }
        let id = hub_id.unwrap_or_else(|| format!("hub-{}", Uuid::new_v4()));

        {
            let guard = self.inner.devices.read().await;
            if guard.contains_key(&id) {
                return Err(format!("Virtual device '{id}' already exists"));
            }
        }

        let ports: Vec<PortId> = (0..port_count).map(|i| format!("{id}-p{i}")).collect();
        let hub = L1HubCore::new(id.clone(), name.clone(), ports.clone());

        {
            let mut ports_guard = self.inner.ports.write().await;
            for pid in &ports {
                ports_guard.insert(
                    pid.clone(),
                    PortKind::Virtual {
                        device_id: id.clone(),
                    },
                );
            }
        }
        {
            let mut dev_guard = self.inner.devices.write().await;
            dev_guard.insert(id.clone(), tokio::sync::Mutex::new(VirtualDevice::Hub(hub)));
        }

        Ok(VirtualDeviceInfo {
            id,
            name,
            kind: "l1_hub".to_string(),
            ports,
        })
    }

    /// Removes a virtual L2 Switch or L1 Hub and detaches all its ports & links.
    pub async fn remove_device(&self, device_id: &str) -> Result<(), String> {
        let removed = {
            let mut guard = self.inner.devices.write().await;
            guard.remove(device_id)
        };
        let Some(dev_mutex) = removed else {
            return Err(format!("Virtual device '{device_id}' not found"));
        };

        let ports = match dev_mutex.into_inner() {
            VirtualDevice::Switch(sw) => sw.ports,
            VirtualDevice::Hub(hub) => hub.ports,
        };
        for pid in ports {
            let _ = self.remove_port(&pid).await;
        }
        Ok(())
    }

    /// Connects two existing ports (`port_a` <-> `port_b`) with a Point-to-Point Wire.
    pub async fn create_link(&self, req: CreateLinkRequest) -> Result<LinkSnapshot, String> {
        if req.port_a == req.port_b {
            return Err("Cannot connect a port to itself".to_string());
        }

        {
            let ports_guard = self.inner.ports.read().await;
            if !ports_guard.contains_key(&req.port_a) {
                return Err(format!("Port '{}' does not exist", req.port_a));
            }
            if !ports_guard.contains_key(&req.port_b) {
                return Err(format!("Port '{}' does not exist", req.port_b));
            }
        }

        {
            let p2l = self.inner.port_to_link.read().await;
            if let Some(existing) = p2l.get(&req.port_a) {
                return Err(format!(
                    "Port '{}' is already attached to link '{existing}'",
                    req.port_a
                ));
            }
            if let Some(existing) = p2l.get(&req.port_b) {
                return Err(format!(
                    "Port '{}' is already attached to link '{existing}'",
                    req.port_b
                ));
            }
        }

        let id = req
            .link_id
            .unwrap_or_else(|| format!("link-{}", Uuid::new_v4()));
        let admin_up = req.admin_up.unwrap_or(true);
        let config = LinkImpairmentConfig {
            admin_up,
            latency_ms: req.latency_ms.unwrap_or(0),
            jitter_ms: req.jitter_ms.unwrap_or(0),
            loss_percent: req.loss_percent.unwrap_or(0.0).clamp(0.0, 100.0),
        };

        let (tap_tx, _) = tokio::sync::broadcast::channel(2048);
        let wire = Arc::new(WireLink {
            id: id.clone(),
            port_a: req.port_a.clone(),
            port_b: req.port_b.clone(),
            config: RwLock::new(config),
            admin_up_fast: AtomicBool::new(admin_up),
            counters: LinkCounters::default(),
            tap_tx,
            capturing_pcap: AtomicBool::new(false),
            captured_packets: AtomicU64::new(0),
            captured_bytes: AtomicU64::new(0),
            active_pcap_path: RwLock::new(None),
            live_wireshark: AtomicBool::new(false),
        });

        {
            let mut links_guard = self.inner.links.write().await;
            let mut p2l_guard = self.inner.port_to_link.write().await;
            links_guard.insert(id.clone(), wire.clone());
            p2l_guard.insert(req.port_a, id.clone());
            p2l_guard.insert(req.port_b, id);
        }

        Ok(wire.snapshot().await)
    }

    /// Dynamically updates link state (`admin_up` cable cut/restore, `latency_ms`, `jitter_ms`, `loss_percent`).
    pub async fn update_link(&self, req: UpdateLinkRequest) -> Result<LinkSnapshot, String> {
        let wire = {
            let guard = self.inner.links.read().await;
            guard
                .get(&req.link_id)
                .cloned()
                .ok_or_else(|| format!("Link '{}' not found", req.link_id))?
        };

        {
            let mut cfg = wire.config.write().await;
            if let Some(up) = req.admin_up {
                cfg.admin_up = up;
                wire.admin_up_fast.store(up, Ordering::Release);
            }
            if let Some(lat) = req.latency_ms {
                cfg.latency_ms = lat;
            }
            if let Some(jit) = req.jitter_ms {
                cfg.jitter_ms = jit;
            }
            if let Some(loss) = req.loss_percent {
                cfg.loss_percent = loss.clamp(0.0, 100.0);
            }
        }

        Ok(wire.snapshot().await)
    }

    /// Deletes a Point-to-Point Wire.
    pub async fn remove_link(&self, link_id: &str) -> Result<(), String> {
        let removed = {
            let mut guard = self.inner.links.write().await;
            guard.remove(link_id)
        };
        let Some(wire) = removed else {
            return Err(format!("Link '{link_id}' not found"));
        };

        let mut p2l = self.inner.port_to_link.write().await;
        p2l.remove(&wire.port_a);
        p2l.remove(&wire.port_b);
        Ok(())
    }

    /// Subscribes a zero-copy wire tap receiver (`broadcast::Receiver<TappedFrame>`) to `link_id`.
    pub async fn subscribe_link_tap(
        &self,
        link_id: &str,
    ) -> Result<tokio::sync::broadcast::Receiver<crate::pcap_tap::TappedFrame>, String> {
        let guard = self.inner.links.read().await;
        let wire = guard
            .get(link_id)
            .ok_or_else(|| format!("Link '{link_id}' not found in PacketFabric"))?;
        Ok(wire.tap_tx.subscribe())
    }

    /// Updates `.pcap` recording status and path on `link_id` so 1 Hz telemetry reflects it on the canvas.
    pub async fn set_link_pcap_state(
        &self,
        link_id: &str,
        capturing: bool,
        pcap_path: Option<String>,
        packets: u64,
        bytes: u64,
    ) {
        let wire = {
            let guard = self.inner.links.read().await;
            guard.get(link_id).cloned()
        };
        if let Some(w) = wire {
            w.capturing_pcap.store(capturing, Ordering::Release);
            w.captured_packets.store(packets, Ordering::Relaxed);
            w.captured_bytes.store(bytes, Ordering::Relaxed);
            *w.active_pcap_path.write().await = pcap_path;
        }
    }

    /// Lock-free update of recorded packet/byte counters on `link_id`.
    pub async fn update_link_pcap_counters(&self, link_id: &str, packets: u64, bytes: u64) {
        let wire = {
            let guard = self.inner.links.read().await;
            guard.get(link_id).cloned()
        };
        if let Some(w) = wire {
            w.captured_packets.store(packets, Ordering::Relaxed);
            w.captured_bytes.store(bytes, Ordering::Relaxed);
        }
    }

    /// Updates Live Wireshark FIFO streaming status on `link_id`.
    pub async fn set_link_live_wireshark_state(&self, link_id: &str, active: bool) {
        let wire = {
            let guard = self.inner.links.read().await;
            guard.get(link_id).cloned()
        };
        if let Some(w) = wire {
            w.live_wireshark.store(active, Ordering::Release);
        }
    }

    /// Returns a snapshot for a single `link_id`, if present.
    pub async fn get_link_snapshot(&self, link_id: &str) -> Option<LinkSnapshot> {
        let wire = {
            let guard = self.inner.links.read().await;
            guard.get(link_id).cloned()
        }?;
        Some(wire.snapshot().await)
    }

    /// Lists current snapshots for all links in the fabric.
    pub async fn list_links(&self) -> Vec<LinkSnapshot> {
        let wires: Vec<Arc<WireLink>> = {
            let guard = self.inner.links.read().await;
            guard.values().cloned().collect()
        };
        let mut out = Vec::with_capacity(wires.len());
        for w in wires {
            out.push(w.snapshot().await);
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Returns the live MAC-to-Port forwarding table for a Virtual L2 Switch.
    pub async fn get_switch_mac_table(
        &self,
        switch_id: &str,
    ) -> Result<Vec<MacTableEntryDto>, String> {
        let dev_guard = self.inner.devices.read().await;
        let dev_mutex = dev_guard
            .get(switch_id)
            .ok_or_else(|| format!("Switch '{switch_id}' not found"))?;
        let mut dev = dev_mutex.lock().await;
        match &mut *dev {
            VirtualDevice::Switch(sw) => Ok(sw.snapshot_mac_table(Instant::now())),
            VirtualDevice::Hub(_) => Err(format!(
                "Device '{switch_id}' is an L1 Hub and does not maintain a MAC table"
            )),
        }
    }

    /// Flushes all learned MAC entries on a Virtual L2 Switch.
    pub async fn clear_switch_mac_table(&self, switch_id: &str) -> Result<(), String> {
        let dev_guard = self.inner.devices.read().await;
        let dev_mutex = dev_guard
            .get(switch_id)
            .ok_or_else(|| format!("Switch '{switch_id}' not found"))?;
        let mut dev = dev_mutex.lock().await;
        match &mut *dev {
            VirtualDevice::Switch(sw) => {
                sw.mac_table.clear();
                Ok(())
            }
            VirtualDevice::Hub(_) => Err(format!(
                "Device '{switch_id}' is an L1 Hub and does not maintain a MAC table"
            )),
        }
    }

    /// Entry point when an Ethernet II frame enters `source_port` (e.g., received from a VM's UDP socket
    /// or transmitted out of a virtual switch/hub port onto its attached wire).
    fn handle_port_ingress<'a>(
        &'a self,
        source_port: &'a str,
        frame: Bytes,
        hop: u8,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            if hop > MAX_INTERNAL_HOPS {
                return;
            }

            // Look up the wire attached to `source_port`
            let wire = {
                let p2l = self.inner.port_to_link.read().await;
                let Some(link_id) = p2l.get(source_port) else {
                    return;
                };
                let links = self.inner.links.read().await;
                let Some(w) = links.get(link_id).cloned() else {
                    return;
                };
                w
            };

            let Some((dest_port, is_a_to_b)) = wire.peer_of(source_port) else {
                return;
            };

            // Fast-path cable cut check
            if !wire.admin_up_fast.load(Ordering::Acquire) {
                wire.counters
                    .dropped_packets
                    .fetch_add(1, Ordering::Relaxed);
                return;
            }

            let cfg = *wire.config.read().await;
            if !cfg.admin_up {
                wire.counters
                    .dropped_packets
                    .fetch_add(1, Ordering::Relaxed);
                return;
            }

            // Simulated Bernoulli packet loss
            if cfg.loss_percent > 0.0
                && (cfg.loss_percent >= 100.0 || fastrand::f64() * 100.0 < cfg.loss_percent)
            {
                wire.counters
                    .dropped_packets
                    .fetch_add(1, Ordering::Relaxed);
                return;
            }

            // Record wire counters
            let byte_len = frame.len() as u64;
            if is_a_to_b {
                wire.counters.tx_packets.fetch_add(1, Ordering::Relaxed);
                wire.counters
                    .tx_bytes
                    .fetch_add(byte_len, Ordering::Relaxed);
            } else {
                wire.counters.rx_packets.fetch_add(1, Ordering::Relaxed);
                wire.counters
                    .rx_bytes
                    .fetch_add(byte_len, Ordering::Relaxed);
            }

            // Zero-copy wire tap fanout (.pcap file writer & Live Wireshark FIFO pipe)
            if wire.tap_tx.receiver_count() > 0 {
                let _ = wire
                    .tap_tx
                    .send(crate::pcap_tap::TappedFrame::now(frame.clone()));
            }

            // Compute latency + jitter impairment
            let delay_ms = if cfg.latency_ms == 0 && cfg.jitter_ms == 0 {
                0u64
            } else {
                let jitter = if cfg.jitter_ms > 0 {
                    let span = cfg.jitter_ms as i64;
                    fastrand::i64(-span..=span)
                } else {
                    0
                };
                ((cfg.latency_ms as i64) + jitter).max(0) as u64
            };

            if delay_ms > 0 {
                let fabric = self.clone();
                let wire_ref = wire.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    // Re-verify link wasn't cut while packet was in flight
                    if !wire_ref.admin_up_fast.load(Ordering::Acquire) {
                        wire_ref
                            .counters
                            .dropped_packets
                            .fetch_add(1, Ordering::Relaxed);
                        return;
                    }
                    fabric.deliver_to_port(&dest_port, frame, hop + 1).await;
                });
            } else {
                self.deliver_to_port(&dest_port, frame, hop + 1).await;
            }
        })
    }

    /// Delivers a frame arriving at `dest_port` from its wire:
    /// - If `dest_port` is a `Udp` VM port: transmits the raw Ethernet II datagram to the VM's UDP socket.
    /// - If `dest_port` is a `Virtual` port on an L2 Switch / L1 Hub: runs the switching engine and
    ///   forwards out each selected egress port's wire.
    fn deliver_to_port<'a>(
        &'a self,
        dest_port: &'a str,
        frame: Bytes,
        hop: u8,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let target = {
                let guard = self.inner.ports.read().await;
                match guard.get(dest_port) {
                    Some(PortKind::Udp {
                        socket, peer_addr, ..
                    }) => Some(PortDeliveryTarget::Udp(socket.clone(), *peer_addr)),
                    Some(PortKind::Virtual { device_id }) => {
                        Some(PortDeliveryTarget::Virtual(device_id.clone()))
                    }
                    None => None,
                }
            };

            match target {
                Some(PortDeliveryTarget::Udp(sock, peer_addr)) => {
                    let _ = sock.send_to(&frame, peer_addr).await;
                }
                Some(PortDeliveryTarget::Virtual(device_id)) => {
                    let egress_ports = {
                        let dev_guard = self.inner.devices.read().await;
                        let Some(dev_mutex) = dev_guard.get(&device_id) else {
                            return;
                        };
                        let mut dev = dev_mutex.lock().await;
                        match &mut *dev {
                            VirtualDevice::Switch(sw) => {
                                sw.process_frame(dest_port, &frame, Instant::now())
                            }
                            VirtualDevice::Hub(hub) => hub.process_frame(dest_port, &frame),
                        }
                    };

                    for egress_port in egress_ports {
                        self.handle_port_ingress(&egress_port, frame.clone(), hop + 1)
                            .await;
                    }
                }
                None => {}
            }
        })
    }
}

enum PortDeliveryTarget {
    Udp(Arc<UdpSocket>, SocketAddr),
    Virtual(DeviceId),
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

    /// Helper constructing a raw Ethernet II frame (no length prefix) with payload.
    fn build_eth_frame(dst: [u8; 6], src: [u8; 6], ethertype: u16, payload: &[u8]) -> Vec<u8> {
        let mut frame = Vec::with_capacity(14 + payload.len());
        frame.extend_from_slice(&dst);
        frame.extend_from_slice(&src);
        frame.extend_from_slice(&ethertype.to_be_bytes());
        frame.extend_from_slice(payload);
        frame
    }

    #[test]
    fn l2_switch_mac_learning_unicast_forwarding_hairpin_and_aging() {
        let ports = vec![
            "sw-p0".to_string(),
            "sw-p1".to_string(),
            "sw-p2".to_string(),
        ];
        let ttl = Duration::from_secs(60);
        let mut sw = L2SwitchCore::new("sw1".into(), "core".into(), ports, ttl);

        let mac_a = [0x52, 0x54, 0x00, 0x00, 0x00, 0x0a];
        let mac_b = [0x52, 0x54, 0x00, 0x00, 0x00, 0x0b];
        let bcast = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
        let t0 = Instant::now();

        // 1. Unknown unicast A -> B enters sw-p0: learns A on sw-p0, floods to sw-p1 & sw-p2
        let f1 = build_eth_frame(mac_b, mac_a, 0x0800, b"hello-b");
        let out1 = sw.process_frame("sw-p0", &f1, t0);
        assert_eq!(out1, vec!["sw-p1".to_string(), "sw-p2".to_string()]);

        // 2. Reply B -> A enters sw-p1: learns B on sw-p1, forwards strictly unicast to sw-p0 (NOT sw-p2!)
        let f2 = build_eth_frame(mac_a, mac_b, 0x0800, b"hello-a");
        let out2 = sw.process_frame("sw-p1", &f2, t0 + Duration::from_millis(5));
        assert_eq!(out2, vec!["sw-p0".to_string()]);

        // 3. Subsequent A -> B enters sw-p0: now B is known on sw-p1, strictly unicast to sw-p1
        let out3 = sw.process_frame("sw-p0", &f1, t0 + Duration::from_millis(10));
        assert_eq!(out3, vec!["sw-p1".to_string()]);

        // 4. Hairpin check: a second host `mac_a2` on the same segment (`sw-p0`) talking to `mac_a`
        //    is filtered so the switch does not bounce the frame back out `sw-p0` or leak it.
        let mac_a2 = [0x52, 0x54, 0x00, 0x00, 0x00, 0xaa];
        let hairpin = build_eth_frame(mac_a, mac_a2, 0x0800, b"hairpin");
        let out_hairpin = sw.process_frame("sw-p0", &hairpin, t0 + Duration::from_millis(12));
        assert!(out_hairpin.is_empty());

        // 5. ARP Broadcast from A on sw-p0 still floods to sw-p1 & sw-p2
        let arp = build_eth_frame(bcast, mac_a, 0x0806, b"who-has");
        let out_bcast = sw.process_frame("sw-p0", &arp, t0 + Duration::from_millis(15));
        assert_eq!(out_bcast, vec!["sw-p1".to_string(), "sw-p2".to_string()]);

        // 6. Verify MAC table snapshot has A, A2 on sw-p0 and B on sw-p1
        let snap = sw.snapshot_mac_table(t0 + Duration::from_millis(20));
        assert_eq!(snap.len(), 3);
        assert_eq!(snap[0].mac, "52:54:00:00:00:0a");
        assert_eq!(snap[0].port_id, "sw-p0");
        assert_eq!(snap[1].mac, "52:54:00:00:00:0b");
        assert_eq!(snap[1].port_id, "sw-p1");

        // 7. Host roaming: B moves to `sw-p2`, updating its learned port immediately
        let roam = build_eth_frame(mac_a, mac_b, 0x0800, b"roamed");
        let out_roam = sw.process_frame("sw-p2", &roam, t0 + Duration::from_millis(25));
        assert_eq!(out_roam, vec!["sw-p0".to_string()]);
        assert_eq!(
            sw.process_frame("sw-p0", &f1, t0 + Duration::from_millis(30)),
            vec!["sw-p2".to_string()]
        );

        // 8. Advance past 60s TTL: B expires and A -> B floods again
        let out_expired = sw.process_frame("sw-p0", &f1, t0 + Duration::from_secs(65));
        assert_eq!(
            out_expired,
            vec!["sw-p1".to_string(), "sw-p2".to_string()]
        );
    }

    #[test]
    fn l1_hub_always_floods_all_other_ports() {
        let hub = L1HubCore::new(
            "hub1".into(),
            "tap-hub".into(),
            vec!["p0".into(), "p1".into(), "p2".into()],
        );
        let mac_a = [0x52, 0x54, 0x00, 0x01, 0x02, 0x03];
        let mac_b = [0x52, 0x54, 0x00, 0x04, 0x05, 0x06];
        let frame = build_eth_frame(mac_b, mac_a, 0x0800, b"shared-wire");

        assert_eq!(
            hub.process_frame("p0", &frame),
            vec!["p1".to_string(), "p2".to_string()]
        );
        assert_eq!(
            hub.process_frame("p1", &frame),
            vec!["p0".to_string(), "p2".to_string()]
        );
    }

    #[tokio::test]
    async fn udp_point_to_point_forwarding_cable_cut_and_counters() {
        // Bind two guest-side sockets simulating two QEMU `-netdev socket,udp=...` NICs
        let vm1_sock = match UdpSocket::bind("127.0.0.1:0").await {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(e) => panic!("bind vm1_sock failed: {e}"),
        };
        let vm2_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let vm1_port = vm1_sock.local_addr().unwrap().port();
        let vm2_port = vm2_sock.local_addr().unwrap().port();

        let fabric = PacketFabric::new();
        let p1 = fabric
            .create_udp_port(Some("vm1-eth0".into()), Some(vm1_port))
            .await
            .unwrap();
        let p2 = fabric
            .create_udp_port(Some("vm2-eth0".into()), Some(vm2_port))
            .await
            .unwrap();

        let link = fabric
            .create_link(CreateLinkRequest {
                link_id: Some("wire-1".into()),
                port_a: p1.port_id.clone(),
                port_b: p2.port_id.clone(),
                admin_up: Some(true),
                latency_ms: Some(0),
                jitter_ms: Some(0),
                loss_percent: Some(0.0),
            })
            .await
            .unwrap();
        assert!(link.admin_up);

        let mac1 = [0x52, 0x54, 0x00, 0x11, 0x11, 0x01];
        let mac2 = [0x52, 0x54, 0x00, 0x22, 0x22, 0x02];
        let ping_frame = build_eth_frame(mac2, mac1, 0x0800, b"icmp-echo-request");

        // VM1 -> Fabric -> VM2
        vm1_sock
            .send_to(
                &ping_frame,
                SocketAddrV4::new(Ipv4Addr::LOCALHOST, p1.fabric_port),
            )
            .await
            .unwrap();

        let mut recv_buf = [0u8; 2048];
        let (n, _) = tokio::time::timeout(Duration::from_secs(2), vm2_sock.recv_from(&mut recv_buf))
            .await
            .expect("timed out waiting for frame on vm2")
            .unwrap();
        assert_eq!(&recv_buf[..n], ping_frame.as_slice());

        // VM2 -> Fabric -> VM1
        let pong_frame = build_eth_frame(mac1, mac2, 0x0800, b"icmp-echo-reply");
        vm2_sock
            .send_to(
                &pong_frame,
                SocketAddrV4::new(Ipv4Addr::LOCALHOST, p2.fabric_port),
            )
            .await
            .unwrap();

        let (n2, _) =
            tokio::time::timeout(Duration::from_secs(2), vm1_sock.recv_from(&mut recv_buf))
                .await
                .expect("timed out waiting for reply on vm1")
                .unwrap();
        assert_eq!(&recv_buf[..n2], pong_frame.as_slice());

        // Cut the cable (`admin_up = false`) and verify frames are dropped
        fabric
            .update_link(UpdateLinkRequest {
                link_id: "wire-1".into(),
                admin_up: Some(false),
                latency_ms: None,
                jitter_ms: None,
                loss_percent: None,
            })
            .await
            .unwrap();

        vm1_sock
            .send_to(
                &ping_frame,
                SocketAddrV4::new(Ipv4Addr::LOCALHOST, p1.fabric_port),
            )
            .await
            .unwrap();

        let cut_res =
            tokio::time::timeout(Duration::from_millis(80), vm2_sock.recv_from(&mut recv_buf))
                .await;
        assert!(cut_res.is_err(), "frame should not traverse a cut cable");

        let snapshots = fabric.sample_and_collect_metrics(1.0).await;
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].tx_packets, 1);
        assert_eq!(snapshots[0].rx_packets, 1);
        assert_eq!(snapshots[0].dropped_packets, 1);
        assert!(snapshots[0].bytes_per_sec > 0.0);
    }

    #[tokio::test]
    async fn udp_virtual_l2_switch_isolates_unicast_across_three_vms() {
        let vm1 = match UdpSocket::bind("127.0.0.1:0").await {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(e) => panic!("bind vm1 failed: {e}"),
        };
        let vm2 = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let vm3 = UdpSocket::bind("127.0.0.1:0").await.unwrap();

        let fabric = PacketFabric::new();
        let sw = fabric
            .create_switch(Some("sw-lab".into()), "Lab Switch".into(), 4)
            .await
            .unwrap();

        let p1 = fabric
            .create_udp_port(Some("vm1-nic".into()), Some(vm1.local_addr().unwrap().port()))
            .await
            .unwrap();
        let p2 = fabric
            .create_udp_port(Some("vm2-nic".into()), Some(vm2.local_addr().unwrap().port()))
            .await
            .unwrap();
        let p3 = fabric
            .create_udp_port(Some("vm3-nic".into()), Some(vm3.local_addr().unwrap().port()))
            .await
            .unwrap();

        for (vm_pid, sw_pid) in [
            (&p1.port_id, &sw.ports[0]),
            (&p2.port_id, &sw.ports[1]),
            (&p3.port_id, &sw.ports[2]),
        ] {
            fabric
                .create_link(CreateLinkRequest {
                    link_id: None,
                    port_a: vm_pid.clone(),
                    port_b: sw_pid.clone(),
                    admin_up: Some(true),
                    latency_ms: None,
                    jitter_ms: None,
                    loss_percent: None,
                })
                .await
                .unwrap();
        }

        let mac1 = [0x52, 0x54, 0x00, 0xaa, 0x00, 0x01];
        let mac2 = [0x52, 0x54, 0x00, 0xaa, 0x00, 0x02];
        let bcast = [0xff; 6];

        // 1. VM1 sends ARP broadcast -> both VM2 and VM3 receive it, and sw-lab learns mac1 on sw-lab-p0
        let arp_req = build_eth_frame(bcast, mac1, 0x0806, b"arp-who-has-vm2");
        vm1.send_to(
            &arp_req,
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, p1.fabric_port),
        )
        .await
        .unwrap();

        let mut buf2 = [0u8; 1024];
        let mut buf3 = [0u8; 1024];
        let (len2, _) = tokio::time::timeout(Duration::from_secs(2), vm2.recv_from(&mut buf2))
            .await
            .unwrap()
            .unwrap();
        let (len3, _) = tokio::time::timeout(Duration::from_secs(2), vm3.recv_from(&mut buf3))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&buf2[..len2], arp_req.as_slice());
        assert_eq!(&buf3[..len3], arp_req.as_slice());

        // 2. VM2 sends unicast ARP reply to mac1 -> ONLY VM1 receives it; VM3 does NOT see it!
        let arp_rep = build_eth_frame(mac1, mac2, 0x0806, b"arp-is-at-mac2");
        vm2.send_to(
            &arp_rep,
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, p2.fabric_port),
        )
        .await
        .unwrap();

        let mut buf1 = [0u8; 1024];
        let (len1, _) = tokio::time::timeout(Duration::from_secs(2), vm1.recv_from(&mut buf1))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&buf1[..len1], arp_rep.as_slice());

        let eavesdrop =
            tokio::time::timeout(Duration::from_millis(80), vm3.recv_from(&mut buf3)).await;
        assert!(
            eavesdrop.is_err(),
            "L2 switch must isolate learned unicast traffic from unrelated ports"
        );

        // 3. Inspect switch MAC table via IPC method
        let mac_table = fabric.get_switch_mac_table("sw-lab").await.unwrap();
        assert_eq!(mac_table.len(), 2);
        assert_eq!(mac_table[0].mac, "52:54:00:aa:00:01");
        assert_eq!(mac_table[0].port_id, "sw-lab-p0");
        assert_eq!(mac_table[1].mac, "52:54:00:aa:00:02");
        assert_eq!(mac_table[1].port_id, "sw-lab-p1");
    }

    #[tokio::test]
    async fn udp_link_latency_impairment_delays_frame_delivery() {
        let vm1 = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let vm2 = UdpSocket::bind("127.0.0.1:0").await.unwrap();

        let fabric = PacketFabric::new();
        let p1 = fabric
            .create_udp_port(Some("lat-p1".into()), Some(vm1.local_addr().unwrap().port()))
            .await
            .unwrap();
        let p2 = fabric
            .create_udp_port(Some("lat-p2".into()), Some(vm2.local_addr().unwrap().port()))
            .await
            .unwrap();

        fabric
            .create_link(CreateLinkRequest {
                link_id: Some("wan-link".into()),
                port_a: p1.port_id,
                port_b: p2.port_id,
                admin_up: Some(true),
                latency_ms: Some(45),
                jitter_ms: Some(0),
                loss_percent: Some(0.0),
            })
            .await
            .unwrap();

        let frame = build_eth_frame(
            [0x52, 0x54, 0x00, 0x00, 0x01, 0x02],
            [0x52, 0x54, 0x00, 0x00, 0x01, 0x01],
            0x0800,
            b"wan-packet",
        );

        let sent_at = Instant::now();
        vm1.send_to(&frame, SocketAddrV4::new(Ipv4Addr::LOCALHOST, p1.fabric_port))
            .await
            .unwrap();

        let mut buf = [0u8; 512];
        let (n, _) = tokio::time::timeout(Duration::from_secs(2), vm2.recv_from(&mut buf))
            .await
            .unwrap()
            .unwrap();
        let elapsed = sent_at.elapsed();
        assert_eq!(&buf[..n], frame.as_slice());
        assert!(
            elapsed >= Duration::from_millis(38),
            "expected >= 38ms delay for 45ms link latency, got {elapsed:?}"
        );
    }

    /// Helper constructing an IEEE 802.1Q VLAN-tagged Ethernet II frame (`EtherType = 0x8100`, 4B TCI + inner EtherType).
    fn build_dot1q_frame(
        dst: [u8; 6],
        src: [u8; 6],
        vlan_id: u16,
        inner_ethertype: u16,
        payload: &[u8],
    ) -> Vec<u8> {
        let mut frame = Vec::with_capacity(18 + payload.len());
        frame.extend_from_slice(&dst);
        frame.extend_from_slice(&src);
        frame.extend_from_slice(&ETHERTYPE_8021Q.to_be_bytes());
        let tci = vlan_id & 0x0fff;
        frame.extend_from_slice(&tci.to_be_bytes());
        frame.extend_from_slice(&inner_ethertype.to_be_bytes());
        frame.extend_from_slice(payload);
        frame
    }

    #[test]
    fn l2_switch_forwards_8021q_vlan_tagged_and_9216_jumbo_frames_intact() {
        assert!(MAX_UDP_FRAME_BUF >= JUMBO_ETHERNET_FRAME_LEN);
        assert!(JUMBO_ETHERNET_FRAME_LEN >= 9_216);

        let ports = vec![
            "trunk-sw1".to_string(),
            "trunk-rtr".to_string(),
            "uplink-mon".to_string(),
        ];
        let mut sw = L2SwitchCore::new(
            "sw-dot1q".into(),
            "core-trunk".into(),
            ports,
            Duration::from_secs(300),
        );

        let mac_eng = [0x52, 0x54, 0x00, 0x70, 0x10, 0x10];
        let mac_rtr = [0x52, 0x54, 0x00, 0x70, 0x00, 0x01];
        let bcast = [0xff; 6];
        let now = Instant::now();

        // 1. 1518-byte full-MTU 802.1Q VLAN 10 frame (14B Eth + 4B 802.1Q + 1500B IP payload = 1518B)
        let mtu_payload = vec![0x45u8; 1_500];
        let vlan10_bcast = build_dot1q_frame(bcast, mac_eng, 10, 0x0806, &mtu_payload);
        assert_eq!(vlan10_bcast.len(), 1_518);
        let parsed = EthernetHeader::parse(&vlan10_bcast).expect("802.1Q header must parse");
        assert!(parsed.is_vlan_tagged());
        assert_eq!(parsed.ethertype, ETHERTYPE_8021Q);

        let flood_out = sw.process_frame("trunk-sw1", &vlan10_bcast, now);
        assert_eq!(
            flood_out,
            vec!["trunk-rtr".to_string(), "uplink-mon".to_string()]
        );

        // 2. Router replies with 802.1Q VLAN 20 unicast frame -> strictly unicast to learned outer MAC `mac_eng`
        let vlan20_reply = build_dot1q_frame(mac_eng, mac_rtr, 20, 0x0800, &mtu_payload);
        let unicast_out =
            sw.process_frame("trunk-rtr", &vlan20_reply, now + Duration::from_millis(5));
        assert_eq!(unicast_out, vec!["trunk-sw1".to_string()]);

        // 3. 9216-byte Jumbo 802.1Q frame (18B tagged header + 9198B payload = 9216B)
        let jumbo_payload = vec![0xa5u8; JUMBO_ETHERNET_FRAME_LEN - 18];
        let jumbo_vlan_frame = build_dot1q_frame(mac_rtr, mac_eng, 10, 0x0800, &jumbo_payload);
        assert_eq!(jumbo_vlan_frame.len(), JUMBO_ETHERNET_FRAME_LEN);
        let jumbo_out = sw.process_frame(
            "trunk-sw1",
            &jumbo_vlan_frame,
            now + Duration::from_millis(10),
        );
        assert_eq!(jumbo_out, vec!["trunk-rtr".to_string()]);
    }

    #[tokio::test]
    async fn udp_fabric_preserves_8021q_tags_and_9000_byte_jumbo_frames_end_to_end() {
        let vm_sw = match UdpSocket::bind("127.0.0.1:0").await {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(e) => panic!("bind vm_sw failed: {e}"),
        };
        let vm_rtr = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        tune_udp_socket_buffers(&vm_sw);
        tune_udp_socket_buffers(&vm_rtr);

        let fabric = PacketFabric::new();
        let sw = fabric
            .create_switch(Some("sw-vlan".into()), "VLAN Pass Switch".into(), 2)
            .await
            .unwrap();
        let p_sw = fabric
            .create_udp_port(
                Some("openwrt-sw1-eth2".into()),
                Some(vm_sw.local_addr().unwrap().port()),
            )
            .await
            .unwrap();
        let p_rtr = fabric
            .create_udp_port(
                Some("openwrt-rtr-eth0".into()),
                Some(vm_rtr.local_addr().unwrap().port()),
            )
            .await
            .unwrap();

        fabric
            .create_link(CreateLinkRequest {
                link_id: Some("trunk-leg-a".into()),
                port_a: p_sw.port_id.clone(),
                port_b: sw.ports[0].clone(),
                admin_up: Some(true),
                latency_ms: None,
                jitter_ms: None,
                loss_percent: None,
            })
            .await
            .unwrap();
        fabric
            .create_link(CreateLinkRequest {
                link_id: Some("trunk-leg-b".into()),
                port_a: sw.ports[1].clone(),
                port_b: p_rtr.port_id.clone(),
                admin_up: Some(true),
                latency_ms: None,
                jitter_ms: None,
                loss_percent: None,
            })
            .await
            .unwrap();

        let mut tap_rx = fabric.subscribe_link_tap("trunk-leg-a").await.unwrap();

        let mac_host = [0x52, 0x54, 0x00, 0x70, 0x10, 0x10];
        let mac_rtr = [0x52, 0x54, 0x00, 0x70, 0x00, 0x01];

        // 1. Send 1518-byte IEEE 802.1Q VLAN 10 frame across UDP + L2 Switch + .pcap tap
        let dot1q_1518 = build_dot1q_frame(mac_rtr, mac_host, 10, 0x0800, &[0x11u8; 1_500]);
        assert_eq!(dot1q_1518.len(), 1_518);
        vm_sw
            .send_to(
                &dot1q_1518,
                SocketAddrV4::new(Ipv4Addr::LOCALHOST, p_sw.fabric_port),
            )
            .await
            .unwrap();

        let mut recv_buf = vec![0u8; MAX_UDP_FRAME_BUF];
        let (n1, _) =
            tokio::time::timeout(Duration::from_secs(2), vm_rtr.recv_from(&mut recv_buf))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(&recv_buf[..n1], dot1q_1518.as_slice());

        let tapped1 = tokio::time::timeout(Duration::from_secs(2), tap_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(tapped1.frame.as_ref(), dot1q_1518.as_slice());

        // 2. Send 9000-byte Jumbo 802.1Q VLAN 20 frame (<= 9216 macOS maxdgram) and verify zero truncation
        let jumbo_9000 = build_dot1q_frame(mac_rtr, mac_host, 20, 0x0800, &[0x22u8; 9_000 - 18]);
        assert_eq!(jumbo_9000.len(), 9_000);
        vm_sw
            .send_to(
                &jumbo_9000,
                SocketAddrV4::new(Ipv4Addr::LOCALHOST, p_sw.fabric_port),
            )
            .await
            .unwrap();

        let (n2, _) =
            tokio::time::timeout(Duration::from_secs(2), vm_rtr.recv_from(&mut recv_buf))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(n2, 9_000);
        assert_eq!(&recv_buf[..n2], jumbo_9000.as_slice());

        let tapped2 = tokio::time::timeout(Duration::from_secs(2), tap_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(tapped2.frame.len(), 9_000);
        assert_eq!(tapped2.frame.as_ref(), jumbo_9000.as_slice());
    }
}
