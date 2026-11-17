use crate::dhcp_appliance::{
    build_ipv4_packet, build_ipv6_packet, build_udp_ipv4, build_udp_ipv6,
    deterministic_appliance_mac, format_mac, handle_arp_request, internet_checksum,
    ipv4_upper_checksum, ipv6_upper_checksum, mac_to_link_local_ipv6, mask_ipv6,
    parse_ethertype_and_vlan, parse_ipv4_list, DhcpLeaseDto, DhcpServerConfig, DhcpServerCore,
    ParsedIpv4, ParsedIpv6, wrap_ethernet, ETHERTYPE_ARP, ETHERTYPE_IPV4, ETHERTYPE_IPV6,
    IPPROTO_ICMP, IPPROTO_ICMPV6, IPPROTO_TCP, IPPROTO_UDP,
};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, Notify};

const TCP_FIN: u8 = 0x01;
const TCP_SYN: u8 = 0x02;
const TCP_RST: u8 = 0x04;
const TCP_PSH: u8 = 0x08;
const TCP_ACK: u8 = 0x10;

const MAX_NAT_SESSIONS: usize = 1024;
const TCP_SEGMENT_MSS: usize = 1420;
const TCP_MAX_INFLIGHT: usize = 32_768;
const UDP_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const TCP_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

pub type FrameInjector = Arc<dyn Fn(String, Bytes) + Send + Sync>;

fn default_true() -> bool {
    true
}
fn default_lan_ip_v4() -> String {
    "10.0.2.1".to_string()
}
fn default_prefix_len_v4() -> u8 {
    24
}
fn default_dhcp_start_v4() -> String {
    "10.0.2.15".to_string()
}
fn default_dhcp_end_v4() -> String {
    "10.0.2.200".to_string()
}
fn default_domain_name() -> String {
    "wan.lab".to_string()
}
fn default_lan_ip_v6() -> String {
    "fd00:2::1".to_string()
}
fn default_prefix_len_v6() -> u8 {
    64
}
fn default_dhcp_start_v6() -> String {
    "fd00:2::15".to_string()
}
fn default_dhcp_end_v6() -> String {
    "fd00:2::200".to_string()
}

/// User-configurable Zero-Root Host Internet Gateway (NAT) settings persisted in `topology.toml`
/// and exchanged over Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NatGatewayConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_lan_ip_v4", alias = "lanIpV4")]
    pub lan_ip_v4: String,
    #[serde(default = "default_prefix_len_v4", alias = "prefixLenV4")]
    pub prefix_len_v4: u8,
    #[serde(default = "default_true", alias = "dhcpEnabled")]
    pub dhcp_enabled: bool,
    #[serde(default = "default_dhcp_start_v4", alias = "dhcpPoolStartV4")]
    pub dhcp_pool_start_v4: String,
    #[serde(default = "default_dhcp_end_v4", alias = "dhcpPoolEndV4")]
    pub dhcp_pool_end_v4: String,
    #[serde(default = "default_true", alias = "dnsProxyEnabled")]
    pub dns_proxy_enabled: bool,
    #[serde(default, alias = "upstreamDns")]
    pub upstream_dns: String,
    #[serde(default = "default_domain_name", alias = "domainName")]
    pub domain_name: String,

    #[serde(default = "default_true", alias = "v6Enabled")]
    pub v6_enabled: bool,
    #[serde(default = "default_lan_ip_v6", alias = "lanIpV6")]
    pub lan_ip_v6: String,
    #[serde(default = "default_prefix_len_v6", alias = "prefixLenV6")]
    pub prefix_len_v6: u8,
    #[serde(default = "default_dhcp_start_v6", alias = "dhcpPoolStartV6")]
    pub dhcp_pool_start_v6: String,
    #[serde(default = "default_dhcp_end_v6", alias = "dhcpPoolEndV6")]
    pub dhcp_pool_end_v6: String,
}

impl Default for NatGatewayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            lan_ip_v4: default_lan_ip_v4(),
            prefix_len_v4: default_prefix_len_v4(),
            dhcp_enabled: true,
            dhcp_pool_start_v4: default_dhcp_start_v4(),
            dhcp_pool_end_v4: default_dhcp_end_v4(),
            dns_proxy_enabled: true,
            upstream_dns: String::new(),
            domain_name: default_domain_name(),
            v6_enabled: true,
            lan_ip_v6: default_lan_ip_v6(),
            prefix_len_v6: default_prefix_len_v6(),
            dhcp_pool_start_v6: default_dhcp_start_v6(),
            dhcp_pool_end_v6: default_dhcp_end_v6(),
        }
    }
}

/// Active NAT translation session exposed to the React UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NatSessionDto {
    pub protocol: String, // "TCP" | "UDP" | "DNS"
    pub client_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub idle_secs: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FlowKey {
    client_ip: IpAddr,
    client_port: u16,
    remote_ip: IpAddr,
    remote_port: u16,
}

#[derive(Debug, Clone)]
struct NeighborRoute {
    mac: [u8; 6],
    port_id: String,
    vlan_tci: Option<u16>,
}

struct UdpSessionMeta {
    socket: Arc<UdpSocket>,
    tx_bytes: Arc<AtomicU64>,
    rx_bytes: Arc<AtomicU64>,
    last_active: Arc<Mutex<Instant>>,
}

#[derive(Debug, Clone)]
pub(crate) struct GuestTcpSegment {
    seq: u32,
    ack: u32,
    flags: u8,
    window: u16,
    payload: Vec<u8>,
}

struct TcpSessionMeta {
    tx: mpsc::Sender<GuestTcpSegment>,
    state_label: Arc<Mutex<String>>,
    tx_bytes: Arc<AtomicU64>,
    rx_bytes: Arc<AtomicU64>,
    last_active: Arc<Mutex<Instant>>,
}

/// Pure-Rust Zero-Root Host Internet Access Gateway (`NatGatewayCore`).
/// Translates guest Ethernet/IPv4/IPv6 TCP, UDP, DNS, and ICMP Echo flows out through unprivileged
/// macOS host sockets while keeping 100% visibility on `PacketFabric` virtual wires!
pub struct NatGatewayCore {
    pub id: String,
    pub name: String,
    pub ports: Vec<String>,
    pub gateway_mac: [u8; 6],
    pub config: NatGatewayConfig,
    dhcp: DhcpServerCore,
    neighbors: Arc<Mutex<HashMap<IpAddr, NeighborRoute>>>,
    mac_port_table: HashMap<[u8; 6], String>,
    udp_sessions: Arc<Mutex<HashMap<FlowKey, UdpSessionMeta>>>,
    tcp_sessions: Arc<Mutex<HashMap<FlowKey, TcpSessionMeta>>>,
    shutdown: Arc<Notify>,
    injector: FrameInjector,
}

impl Drop for NatGatewayCore {
    fn drop(&mut self) {
        self.shutdown.notify_waiters();
    }
}

impl NatGatewayCore {
    pub fn new(
        id: String,
        name: String,
        ports: Vec<String>,
        config: NatGatewayConfig,
        injector: FrameInjector,
    ) -> Self {
        let gateway_mac = deterministic_appliance_mac(0xe7, &id);
        let dhcp_cfg = build_embedded_dhcp_config(&config);
        let mut dhcp = DhcpServerCore::new(id.clone(), name.clone(), ports.clone(), dhcp_cfg);
        dhcp.server_mac = gateway_mac;

        Self {
            id,
            name,
            ports,
            gateway_mac,
            config,
            dhcp,
            neighbors: Arc::new(Mutex::new(HashMap::new())),
            mac_port_table: HashMap::new(),
            udp_sessions: Arc::new(Mutex::new(HashMap::new())),
            tcp_sessions: Arc::new(Mutex::new(HashMap::new())),
            shutdown: Arc::new(Notify::new()),
            injector,
        }
    }

    pub fn update_config(&mut self, next: NatGatewayConfig) {
        self.dhcp.update_config(build_embedded_dhcp_config(&next));
        self.config = next;
    }

    pub fn snapshot_leases(&mut self, now: Instant) -> Vec<DhcpLeaseDto> {
        self.dhcp.snapshot_leases(now)
    }

    pub fn clear_leases(&mut self) {
        self.dhcp.clear_leases();
    }

    pub fn clear_sessions(&mut self) {
        self.shutdown.notify_waiters();
        self.shutdown = Arc::new(Notify::new());
        if let Ok(mut u) = self.udp_sessions.lock() {
            u.clear();
        }
        if let Ok(mut t) = self.tcp_sessions.lock() {
            t.clear();
        }
    }

    pub fn snapshot_sessions(&self, now: Instant) -> Vec<NatSessionDto> {
        let mut out = Vec::new();
        if let Ok(mut u_guard) = self.udp_sessions.lock() {
            u_guard.retain(|_, s| {
                s.last_active
                    .lock()
                    .map(|ts| now.saturating_duration_since(*ts) < UDP_IDLE_TIMEOUT)
                    .unwrap_or(false)
            });
            for (k, s) in u_guard.iter() {
                let idle = s
                    .last_active
                    .lock()
                    .map(|ts| now.saturating_duration_since(*ts).as_secs())
                    .unwrap_or(0);
                out.push(NatSessionDto {
                    protocol: if k.remote_port == 53 {
                        "DNS".to_string()
                    } else {
                        "UDP".to_string()
                    },
                    client_addr: format_sock(k.client_ip, k.client_port),
                    remote_addr: format_sock(k.remote_ip, k.remote_port),
                    state: "ACTIVE".to_string(),
                    tx_bytes: s.tx_bytes.load(Ordering::Relaxed),
                    rx_bytes: s.rx_bytes.load(Ordering::Relaxed),
                    idle_secs: idle,
                });
            }
        }
        if let Ok(mut t_guard) = self.tcp_sessions.lock() {
            t_guard.retain(|_, s| {
                !s.tx.is_closed()
                    && s.last_active
                        .lock()
                        .map(|ts| now.saturating_duration_since(*ts) < TCP_IDLE_TIMEOUT)
                        .unwrap_or(false)
            });
            for (k, s) in t_guard.iter() {
                let idle = s
                    .last_active
                    .lock()
                    .map(|ts| now.saturating_duration_since(*ts).as_secs())
                    .unwrap_or(0);
                let st = s
                    .state_label
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_else(|_| "ESTABLISHED".to_string());
                out.push(NatSessionDto {
                    protocol: "TCP".to_string(),
                    client_addr: format_sock(k.client_ip, k.client_port),
                    remote_addr: format_sock(k.remote_ip, k.remote_port),
                    state: st,
                    tx_bytes: s.tx_bytes.load(Ordering::Relaxed),
                    rx_bytes: s.rx_bytes.load(Ordering::Relaxed),
                    idle_secs: idle,
                });
            }
        }
        out.sort_by(|a, b| {
            a.protocol
                .cmp(&b.protocol)
                .then_with(|| a.idle_secs.cmp(&b.idle_secs))
        });
        out
    }

    pub fn link_local_ipv6(&self) -> Ipv6Addr {
        mac_to_link_local_ipv6(self.gateway_mac)
    }

    pub fn process_frame(
        &mut self,
        ingress_port: &str,
        frame: &[u8],
        now: Instant,
    ) -> Vec<(String, Vec<u8>)> {
        if !self.config.enabled || frame.len() < 14 {
            return Vec::new();
        }

        let dst_mac: [u8; 6] = frame[0..6].try_into().unwrap();
        let src_mac: [u8; 6] = frame[6..12].try_into().unwrap();
        if src_mac == self.gateway_mac {
            return Vec::new();
        }

        if (src_mac[0] & 0x01) == 0 {
            self.mac_port_table
                .insert(src_mac, ingress_port.to_string());
        }

        let (ethertype, l3_offset, vlan_tci) = parse_ethertype_and_vlan(frame);
        if frame.len() < l3_offset {
            return Vec::new();
        }
        let payload = &frame[l3_offset..];
        let mut replies = Vec::new();

        // Bridge multi-port LAN frames if user configured multiple ports on the gateway
        if self.ports.len() > 1 && dst_mac != self.gateway_mac {
            let is_group = (dst_mac[0] & 0x01) != 0;
            if is_group {
                for p in &self.ports {
                    if p != ingress_port {
                        replies.push((p.clone(), frame.to_vec()));
                    }
                }
            } else if let Some(tp) = self.mac_port_table.get(&dst_mac) {
                if tp != ingress_port {
                    replies.push((tp.clone(), frame.to_vec()));
                }
            } else {
                for p in &self.ports {
                    if p != ingress_port {
                        replies.push((p.clone(), frame.to_vec()));
                    }
                }
            }
        }

        match ethertype {
            ETHERTYPE_ARP => {
                if let Some(gw_ip) = self.parsed_lan_ipv4() {
                    if let Some(arp_rep) = handle_arp_request(payload, gw_ip, self.gateway_mac) {
                        replies.push((
                            ingress_port.to_string(),
                            wrap_ethernet(
                                src_mac,
                                self.gateway_mac,
                                ETHERTYPE_ARP,
                                vlan_tci,
                                &arp_rep,
                            ),
                        ));
                    }
                }
            }
            ETHERTYPE_IPV4 => {
                if let Some(local_reply) =
                    self.handle_ipv4(ingress_port, src_mac, dst_mac, vlan_tci, payload, now)
                {
                    replies.push((ingress_port.to_string(), local_reply));
                }
            }
            ETHERTYPE_IPV6 if self.config.v6_enabled => {
                if let Some(local_reply) =
                    self.handle_ipv6(ingress_port, src_mac, dst_mac, vlan_tci, payload, now)
                {
                    replies.push((ingress_port.to_string(), local_reply));
                }
            }
            _ => {}
        }

        replies
    }

    fn handle_ipv4(
        &mut self,
        ingress_port: &str,
        src_mac: [u8; 6],
        dst_mac: [u8; 6],
        vlan_tci: Option<u16>,
        pkt: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        let ip = ParsedIpv4::parse(pkt)?;
        let gw_ip = self.parsed_lan_ipv4()?;

        // Record return L2 path for client IP (including routed subnets behind a lab router!)
        if !ip.src.is_unspecified() && !ip.src.is_broadcast() && !ip.src.is_multicast() {
            if let Ok(mut nb) = self.neighbors.lock() {
                nb.insert(
                    IpAddr::V4(ip.src),
                    NeighborRoute {
                        mac: src_mac,
                        port_id: ingress_port.to_string(),
                        vlan_tci,
                    },
                );
            }
        }

        // 1. Built-in DHCPv4 Server (UDP 67)
        if self.config.dhcp_enabled && ip.proto == IPPROTO_UDP && ip.payload.len() >= 8 {
            let dst_port = u16::from_be_bytes([ip.payload[2], ip.payload[3]]);
            if dst_port == 67 {
                return self.dhcp.handle_service_packet(
                    src_mac,
                    dst_mac,
                    ETHERTYPE_IPV4,
                    vlan_tci,
                    pkt,
                    now,
                );
            }
        }

        // 2. Gateway Self-Ping (`ping 10.0.2.1`)
        if ip.dst == gw_ip && ip.proto == IPPROTO_ICMP {
            if ip.payload.len() >= 8 && ip.payload[0] == 8 && ip.payload[1] == 0 {
                let mut rep = ip.payload.to_vec();
                rep[0] = 0;
                rep[2] = 0;
                rep[3] = 0;
                let csum = internet_checksum(&rep);
                rep[2..4].copy_from_slice(&csum.to_be_bytes());
                let out_ip = build_ipv4_packet(gw_ip, ip.src, IPPROTO_ICMP, 64, &rep);
                return Some(wrap_ethernet(
                    src_mac,
                    self.gateway_mac,
                    ETHERTYPE_IPV4,
                    vlan_tci,
                    &out_ip,
                ));
            }
            return None;
        }

        // 3. Built-in DNS Proxy (`10.0.2.1:53` UDP or TCP)
        if ip.dst == gw_ip && self.config.dns_proxy_enabled {
            match ip.proto {
                IPPROTO_UDP if ip.payload.len() >= 8 => {
                    let src_port = u16::from_be_bytes([ip.payload[0], ip.payload[1]]);
                    let dst_port = u16::from_be_bytes([ip.payload[2], ip.payload[3]]);
                    let udp_len = u16::from_be_bytes([ip.payload[4], ip.payload[5]]) as usize;
                    if dst_port == 53 && ip.payload.len() >= udp_len && udp_len > 8 {
                        let query = ip.payload[8..udp_len].to_vec();
                        self.spawn_dns_proxy_query(
                            IpAddr::V4(ip.src),
                            src_port,
                            IpAddr::V4(gw_ip),
                            query,
                        );
                    }
                    return None;
                }
                IPPROTO_TCP if ip.payload.len() >= 20 => {
                    let dst_port = u16::from_be_bytes([ip.payload[2], ip.payload[3]]);
                    if dst_port == 53 {
                        if let Some(upstream_v4) = self
                            .effective_dns_resolvers()
                            .into_iter()
                            .find(|a| a.is_ipv4())
                        {
                            self.dispatch_tcp_segment(
                                IpAddr::V4(ip.src),
                                IpAddr::V4(gw_ip),
                                upstream_v4,
                                ip.payload,
                                now,
                            );
                        }
                    }
                    return None;
                }
                _ => return None,
            }
        }

        // Only NAT unicast packets addressed to our gateway MAC (L3 routed through us)
        if dst_mac != self.gateway_mac {
            return None;
        }
        if !is_routable_external_ipv4(ip.dst, gw_ip, self.config.prefix_len_v4) {
            return None;
        }

        match ip.proto {
            IPPROTO_ICMP if ip.payload.len() >= 8 && ip.payload[0] == 8 && ip.payload[1] == 0 => {
                self.spawn_icmpv4_echo_nat(ip.src, ip.dst, ip.payload.to_vec());
            }
            IPPROTO_UDP if ip.payload.len() >= 8 => {
                let src_port = u16::from_be_bytes([ip.payload[0], ip.payload[1]]);
                let dst_port = u16::from_be_bytes([ip.payload[2], ip.payload[3]]);
                let udp_len = u16::from_be_bytes([ip.payload[4], ip.payload[5]]) as usize;
                if ip.payload.len() >= udp_len && udp_len >= 8 && dst_port != 0 {
                    let data = ip.payload[8..udp_len].to_vec();
                    self.dispatch_udp_datagram(
                        IpAddr::V4(ip.src),
                        src_port,
                        IpAddr::V4(ip.dst),
                        dst_port,
                        data,
                        now,
                    );
                }
            }
            IPPROTO_TCP if ip.payload.len() >= 20 => {
                self.dispatch_tcp_segment(
                    IpAddr::V4(ip.src),
                    IpAddr::V4(ip.dst),
                    IpAddr::V4(ip.dst),
                    ip.payload,
                    now,
                );
            }
            _ => {}
        }

        None
    }

    fn handle_ipv6(
        &mut self,
        ingress_port: &str,
        src_mac: [u8; 6],
        dst_mac: [u8; 6],
        vlan_tci: Option<u16>,
        pkt: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        let ip6 = ParsedIpv6::parse(pkt)?;
        let gw_v6 = self.parsed_lan_ipv6()?;
        let ll_v6 = self.link_local_ipv6();

        if !ip6.src.is_unspecified() && !ip6.src.is_multicast() {
            if let Ok(mut nb) = self.neighbors.lock() {
                nb.insert(
                    IpAddr::V6(ip6.src),
                    NeighborRoute {
                        mac: src_mac,
                        port_id: ingress_port.to_string(),
                        vlan_tci,
                    },
                );
            }
        }

        // 1. ICMPv6 NDP / RA / Echo-to-Gateway & DHCPv6 (UDP 547)
        if ip6.next_header == IPPROTO_ICMPV6 {
            if let Some(local_ndp_or_ping) = self.dhcp.handle_service_packet(
                src_mac,
                dst_mac,
                ETHERTYPE_IPV6,
                vlan_tci,
                pkt,
                now,
            ) {
                return Some(local_ndp_or_ping);
            }
        }
        if ip6.next_header == IPPROTO_UDP && ip6.payload.len() >= 8 {
            let dst_port = u16::from_be_bytes([ip6.payload[2], ip6.payload[3]]);
            if dst_port == 547 {
                return self.dhcp.handle_service_packet(
                    src_mac,
                    dst_mac,
                    ETHERTYPE_IPV6,
                    vlan_tci,
                    pkt,
                    now,
                );
            }
        }

        // 2. Built-in IPv6 DNS Proxy (`[fd00:2::1]:53` or `[fe80::...]:53`)
        if (ip6.dst == gw_v6 || ip6.dst == ll_v6) && self.config.dns_proxy_enabled {
            if ip6.next_header == IPPROTO_UDP && ip6.payload.len() >= 8 {
                let src_port = u16::from_be_bytes([ip6.payload[0], ip6.payload[1]]);
                let dst_port = u16::from_be_bytes([ip6.payload[2], ip6.payload[3]]);
                let udp_len = u16::from_be_bytes([ip6.payload[4], ip6.payload[5]]) as usize;
                if dst_port == 53 && ip6.payload.len() >= udp_len && udp_len > 8 {
                    let query = ip6.payload[8..udp_len].to_vec();
                    self.spawn_dns_proxy_query(
                        IpAddr::V6(ip6.src),
                        src_port,
                        IpAddr::V6(ip6.dst),
                        query,
                    );
                    return None;
                }
            }
        }

        if dst_mac != self.gateway_mac {
            return None;
        }
        if !is_routable_external_ipv6(ip6.dst, gw_v6, self.config.prefix_len_v6) {
            return None;
        }

        match ip6.next_header {
            IPPROTO_ICMPV6
                if ip6.payload.len() >= 8 && ip6.payload[0] == 128 && ip6.payload[1] == 0 =>
            {
                self.spawn_icmpv6_echo_nat(ip6.src, ip6.dst, ip6.payload.to_vec());
            }
            IPPROTO_UDP if ip6.payload.len() >= 8 => {
                let src_port = u16::from_be_bytes([ip6.payload[0], ip6.payload[1]]);
                let dst_port = u16::from_be_bytes([ip6.payload[2], ip6.payload[3]]);
                let udp_len = u16::from_be_bytes([ip6.payload[4], ip6.payload[5]]) as usize;
                if ip6.payload.len() >= udp_len && udp_len >= 8 && dst_port != 0 {
                    let data = ip6.payload[8..udp_len].to_vec();
                    self.dispatch_udp_datagram(
                        IpAddr::V6(ip6.src),
                        src_port,
                        IpAddr::V6(ip6.dst),
                        dst_port,
                        data,
                        now,
                    );
                }
            }
            IPPROTO_TCP if ip6.payload.len() >= 20 => {
                self.dispatch_tcp_segment(
                    IpAddr::V6(ip6.src),
                    IpAddr::V6(ip6.dst),
                    IpAddr::V6(ip6.dst),
                    ip6.payload,
                    now,
                );
            }
            _ => {}
        }

        None
    }

    // -------------------------------------------------------------------------
    // Built-in Zero-Root DNS Forwarder (works across Wi-Fi, Ethernet, VPN, Split-DNS)
    // -------------------------------------------------------------------------

    fn effective_dns_resolvers(&self) -> Vec<IpAddr> {
        let mut out: Vec<IpAddr> = self
            .config
            .upstream_dns
            .split(|c: char| c == ',' || c.is_whitespace() || c == ';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<IpAddr>().ok())
            .collect();

        if out.is_empty() {
            out.extend(discover_macos_resolv_conf_servers());
        }
        // Always include reliable public DNS fallbacks if local resolvers time out
        for fb in [
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        ] {
            if !out.contains(&fb) {
                out.push(fb);
            }
        }
        out
    }

    fn spawn_dns_proxy_query(
        &self,
        client_ip: IpAddr,
        client_port: u16,
        gateway_dns_ip: IpAddr,
        query: Vec<u8>,
    ) {
        let resolvers = self.effective_dns_resolvers();
        let neighbors = self.neighbors.clone();
        let injector = self.injector.clone();
        let gw_mac = self.gateway_mac;
        let shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            let mut answer: Option<Vec<u8>> = None;
            for resolver in resolvers {
                let bind_addr: SocketAddr = match resolver {
                    IpAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
                    IpAddr::V6(_) => SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0),
                };
                let Ok(sock) = UdpSocket::bind(bind_addr).await else {
                    continue;
                };
                let target = SocketAddr::new(resolver, 53);
                if sock.send_to(&query, target).await.is_err() {
                    continue;
                }
                let mut buf = vec![0u8; 4096];
                let recv_fut = tokio::time::timeout(Duration::from_millis(1800), sock.recv(&mut buf));
                tokio::select! {
                    _ = shutdown.notified() => return,
                    res = recv_fut => {
                        if let Ok(Ok(n)) = res {
                            if n >= 12 {
                                buf.truncate(n);
                                answer = Some(buf);
                                break;
                            }
                        }
                    }
                }
            }

            if let Some(resp_payload) = answer {
                send_udp_to_guest(
                    &neighbors,
                    &injector,
                    gw_mac,
                    gateway_dns_ip,
                    53,
                    client_ip,
                    client_port,
                    &resp_payload,
                );
            }
        });
    }

    // -------------------------------------------------------------------------
    // UDP NAT Engine
    // -------------------------------------------------------------------------

    fn dispatch_udp_datagram(
        &self,
        client_ip: IpAddr,
        client_port: u16,
        remote_ip: IpAddr,
        remote_port: u16,
        payload: Vec<u8>,
        now: Instant,
    ) {
        let key = FlowKey {
            client_ip,
            client_port,
            remote_ip,
            remote_port,
        };

        // Fast path: existing UDP NAT binding
        if let Ok(guard) = self.udp_sessions.lock() {
            if let Some(existing) = guard.get(&key) {
                let sock = existing.socket.clone();
                existing
                    .tx_bytes
                    .fetch_add(payload.len() as u64, Ordering::Relaxed);
                if let Ok(mut ts) = existing.last_active.lock() {
                    *ts = now;
                }
                let dst = SocketAddr::new(remote_ip, remote_port);
                tokio::spawn(async move {
                    let _ = sock.send_to(&payload, dst).await;
                });
                return;
            }
            if guard.len() >= MAX_NAT_SESSIONS {
                return;
            }
        }

        let sessions = self.udp_sessions.clone();
        let neighbors = self.neighbors.clone();
        let injector = self.injector.clone();
        let gw_mac = self.gateway_mac;
        let shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            let bind_addr = match remote_ip {
                IpAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
                IpAddr::V6(_) => SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0),
            };
            let Ok(sock) = UdpSocket::bind(bind_addr).await else {
                return;
            };
            let sock = Arc::new(sock);
            let tx_bytes = Arc::new(AtomicU64::new(payload.len() as u64));
            let rx_bytes = Arc::new(AtomicU64::new(0));
            let last_active = Arc::new(Mutex::new(Instant::now()));

            if let Ok(mut guard) = sessions.lock() {
                if guard.len() >= MAX_NAT_SESSIONS {
                    return;
                }
                guard.insert(
                    key,
                    UdpSessionMeta {
                        socket: sock.clone(),
                        tx_bytes: tx_bytes.clone(),
                        rx_bytes: rx_bytes.clone(),
                        last_active: last_active.clone(),
                    },
                );
            }

            let _ = sock
                .send_to(&payload, SocketAddr::new(remote_ip, remote_port))
                .await;

            let mut buf = vec![0u8; 9216];
            loop {
                let wait = tokio::time::timeout(UDP_IDLE_TIMEOUT, sock.recv_from(&mut buf));
                tokio::select! {
                    _ = shutdown.notified() => break,
                    res = wait => {
                        match res {
                            Ok(Ok((n, peer))) if n > 0 => {
                                rx_bytes.fetch_add(n as u64, Ordering::Relaxed);
                                if let Ok(mut ts) = last_active.lock() {
                                    *ts = Instant::now();
                                }
                                send_udp_to_guest(
                                    &neighbors,
                                    &injector,
                                    gw_mac,
                                    peer.ip(),
                                    peer.port(),
                                    client_ip,
                                    client_port,
                                    &buf[..n],
                                );
                            }
                            _ => break,
                        }
                    }
                }
            }

            if let Ok(mut guard) = sessions.lock() {
                guard.remove(&key);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Unprivileged macOS ICMPv4 & ICMPv6 Echo NAT (`SOCK_DGRAM` + `IPPROTO_ICMP`)
    // -------------------------------------------------------------------------

    fn spawn_icmpv4_echo_nat(&self, client_ip: Ipv4Addr, remote_ip: Ipv4Addr, icmp_req: Vec<u8>) {
        if icmp_req.len() < 8 {
            return;
        }
        let orig_id = [icmp_req[4], icmp_req[5]];
        let neighbors = self.neighbors.clone();
        let injector = self.injector.clone();
        let gw_mac = self.gateway_mac;

        tokio::task::spawn_blocking(move || {
            if let Some((mut reply_icmp, ttl)) = send_unprivileged_icmpv4_echo(remote_ip, &icmp_req)
            {
                if reply_icmp.len() >= 8 {
                    // Restore guest's original ICMP Echo Identifier (macOS SOCK_DGRAM rewrites ID)
                    reply_icmp[4] = orig_id[0];
                    reply_icmp[5] = orig_id[1];
                    reply_icmp[2] = 0;
                    reply_icmp[3] = 0;
                    let csum = internet_checksum(&reply_icmp);
                    reply_icmp[2..4].copy_from_slice(&csum.to_be_bytes());

                    let route = neighbors
                        .lock()
                        .ok()
                        .and_then(|g| g.get(&IpAddr::V4(client_ip)).cloned());
                    if let Some(r) = route {
                        let ip_pkt =
                            build_ipv4_packet(remote_ip, client_ip, IPPROTO_ICMP, ttl, &reply_icmp);
                        let eth = wrap_ethernet(r.mac, gw_mac, ETHERTYPE_IPV4, r.vlan_tci, &ip_pkt);
                        injector(r.port_id, Bytes::from(eth));
                    }
                }
            }
        });
    }

    fn spawn_icmpv6_echo_nat(&self, client_ip: Ipv6Addr, remote_ip: Ipv6Addr, icmp6_req: Vec<u8>) {
        if icmp6_req.len() < 8 {
            return;
        }
        let orig_id = [icmp6_req[4], icmp6_req[5]];
        let neighbors = self.neighbors.clone();
        let injector = self.injector.clone();
        let gw_mac = self.gateway_mac;

        tokio::task::spawn_blocking(move || {
            if let Some(mut reply_icmp6) = send_unprivileged_icmpv6_echo(remote_ip, &icmp6_req) {
                if reply_icmp6.len() >= 8 {
                    reply_icmp6[4] = orig_id[0];
                    reply_icmp6[5] = orig_id[1];
                    reply_icmp6[2] = 0;
                    reply_icmp6[3] = 0;
                    let csum =
                        ipv6_upper_checksum(remote_ip, client_ip, IPPROTO_ICMPV6, &reply_icmp6);
                    reply_icmp6[2..4].copy_from_slice(&csum.to_be_bytes());

                    let route = neighbors
                        .lock()
                        .ok()
                        .and_then(|g| g.get(&IpAddr::V6(client_ip)).cloned());
                    if let Some(r) = route {
                        let ip6_pkt = build_ipv6_packet(
                            remote_ip,
                            client_ip,
                            IPPROTO_ICMPV6,
                            64,
                            &reply_icmp6,
                        );
                        let eth =
                            wrap_ethernet(r.mac, gw_mac, ETHERTYPE_IPV6, r.vlan_tci, &ip6_pkt);
                        injector(r.port_id, Bytes::from(eth));
                    }
                }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Userspace TCP NAT Stream Proxy (IPv4 & IPv6)
    // -------------------------------------------------------------------------

    fn dispatch_tcp_segment(
        &self,
        client_ip: IpAddr,
        apparent_remote_ip: IpAddr,
        connect_target_ip: IpAddr,
        tcp_bytes: &[u8],
        now: Instant,
    ) {
        let Some(seg_parsed) = parse_tcp_segment(tcp_bytes) else {
            return;
        };
        let (src_port, dst_port, seg) = seg_parsed;
        if dst_port == 0 {
            return;
        }

        let key = FlowKey {
            client_ip,
            client_port: src_port,
            remote_ip: apparent_remote_ip,
            remote_port: dst_port,
        };

        if let Ok(guard) = self.tcp_sessions.lock() {
            if let Some(existing) = guard.get(&key) {
                if !existing.tx.is_closed() {
                    if let Ok(mut ts) = existing.last_active.lock() {
                        *ts = now;
                    }
                    let _ = existing.tx.try_send(seg);
                    return;
                }
            }
            if guard.len() >= MAX_NAT_SESSIONS {
                return;
            }
        }

        // Only initiate a new TCP NAT session on a clean SYN (not ACK/FIN/RST orphan packets)
        if (seg.flags & TCP_SYN) == 0 || (seg.flags & (TCP_ACK | TCP_RST)) != 0 {
            if (seg.flags & TCP_RST) == 0 {
                let rst_seq = if (seg.flags & TCP_ACK) != 0 {
                    seg.ack
                } else {
                    0
                };
                let rst_ack = seg.seq.wrapping_add(seg.payload.len() as u32).wrapping_add(
                    if (seg.flags & TCP_FIN) != 0 { 1 } else { 0 },
                );
                let rst_flags = if (seg.flags & TCP_ACK) != 0 {
                    TCP_RST
                } else {
                    TCP_RST | TCP_ACK
                };
                send_tcp_to_guest(
                    &self.neighbors,
                    &self.injector,
                    self.gateway_mac,
                    apparent_remote_ip,
                    dst_port,
                    client_ip,
                    src_port,
                    rst_seq,
                    rst_ack,
                    rst_flags,
                    0,
                    &[],
                    &[],
                );
            }
            return;
        }

        let (tx, rx) = mpsc::channel::<GuestTcpSegment>(256);
        let state_label = Arc::new(Mutex::new("SYN_SENT".to_string()));
        let tx_bytes = Arc::new(AtomicU64::new(0));
        let rx_bytes = Arc::new(AtomicU64::new(0));
        let last_active = Arc::new(Mutex::new(now));

        if let Ok(mut guard) = self.tcp_sessions.lock() {
            if guard.len() >= MAX_NAT_SESSIONS {
                return;
            }
            guard.insert(
                key,
                TcpSessionMeta {
                    tx: tx.clone(),
                    state_label: state_label.clone(),
                    tx_bytes: tx_bytes.clone(),
                    rx_bytes: rx_bytes.clone(),
                    last_active: last_active.clone(),
                },
            );
        }

        let initial_isn = seg.seq;
        let initial_win = seg.window.max(4096);
        let sessions = self.tcp_sessions.clone();
        let neighbors = self.neighbors.clone();
        let injector = self.injector.clone();
        let gw_mac = self.gateway_mac;
        let shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            run_tcp_nat_session(TcpSessionActorParams {
                key,
                connect_addr: SocketAddr::new(connect_target_ip, dst_port),
                client_isn: initial_isn,
                initial_peer_win: initial_win,
                rx,
                state_label,
                tx_bytes,
                rx_bytes,
                last_active,
                neighbors,
                injector,
                gw_mac,
                shutdown,
            })
            .await;

            if let Ok(mut guard) = sessions.lock() {
                guard.remove(&key);
            }
        });
    }

    fn parsed_lan_ipv4(&self) -> Option<Ipv4Addr> {
        self.config.lan_ip_v4.trim().parse().ok()
    }

    fn parsed_lan_ipv6(&self) -> Option<Ipv6Addr> {
        self.config.lan_ip_v6.trim().parse().ok()
    }
}

struct TcpSessionActorParams {
    key: FlowKey,
    connect_addr: SocketAddr,
    client_isn: u32,
    initial_peer_win: u16,
    rx: mpsc::Receiver<GuestTcpSegment>,
    state_label: Arc<Mutex<String>>,
    tx_bytes: Arc<AtomicU64>,
    rx_bytes: Arc<AtomicU64>,
    last_active: Arc<Mutex<Instant>>,
    neighbors: Arc<Mutex<HashMap<IpAddr, NeighborRoute>>>,
    injector: FrameInjector,
    gw_mac: [u8; 6],
    shutdown: Arc<Notify>,
}

async fn run_tcp_nat_session(mut p: TcpSessionActorParams) {
    let connect_res = tokio::select! {
        _ = p.shutdown.notified() => return,
        res = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(p.connect_addr)) => res,
    };

    let stream = match connect_res {
        Ok(Ok(s)) => {
            let _ = s.set_nodelay(true);
            s
        }
        _ => {
            send_tcp_to_guest(
                &p.neighbors,
                &p.injector,
                p.gw_mac,
                p.key.remote_ip,
                p.key.remote_port,
                p.key.client_ip,
                p.key.client_port,
                0,
                p.client_isn.wrapping_add(1),
                TCP_RST | TCP_ACK,
                0,
                &[],
                &[],
            );
            return;
        }
    };

    let (mut remote_reader, mut remote_writer) = stream.into_split();

    let server_isn: u32 = fastrand::u32(..);
    let mut snd_una = server_isn;
    let mut snd_nxt = server_isn.wrapping_add(1);
    let mut rcv_nxt = p.client_isn.wrapping_add(1);
    let mut peer_window = p.initial_peer_win as usize;
    let mut handshake_acked = false;

    // Advertise MSS = 1420 (Option 2, Len 4) and NO Window Scale option so RFC 7323 keeps scale=0
    let syn_ack_opts = [2u8, 4, (TCP_SEGMENT_MSS >> 8) as u8, (TCP_SEGMENT_MSS & 0xff) as u8];
    send_tcp_to_guest(
        &p.neighbors,
        &p.injector,
        p.gw_mac,
        p.key.remote_ip,
        p.key.remote_port,
        p.key.client_ip,
        p.key.client_port,
        server_isn,
        rcv_nxt,
        TCP_SYN | TCP_ACK,
        65535,
        &syn_ack_opts,
        &[],
    );
    set_state(&p.state_label, "SYN_RECEIVED");

    let mut unacked_buf: VecDeque<u8> = VecDeque::new();
    let mut ooo_segments: BTreeMap<u32, Vec<u8>> = BTreeMap::new();
    let mut remote_eof = false;
    let mut fin_sent = false;
    let mut fin_seq: u32 = 0;
    let mut client_fin_rcvd = false;

    let mut rto = Duration::from_millis(220);
    let mut retries = 0u8;
    let mut last_tx_time = Instant::now();
    let mut read_buf = vec![0u8; TCP_SEGMENT_MSS];
    let mut tick = tokio::time::interval(Duration::from_millis(120));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        let can_read_remote = handshake_acked
            && !remote_eof
            && unacked_buf.len() < peer_window.max(TCP_SEGMENT_MSS).min(TCP_MAX_INFLIGHT);

        tokio::select! {
            _ = p.shutdown.notified() => break,

            maybe_seg = p.rx.recv() => {
                let Some(seg) = maybe_seg else { break };
                if let Ok(mut ts) = p.last_active.lock() {
                    *ts = Instant::now();
                }

                if (seg.flags & TCP_RST) != 0 {
                    break;
                }

                // Retransmitted SYN before handshake completes
                if !handshake_acked && (seg.flags & TCP_SYN) != 0 && (seg.flags & TCP_ACK) == 0 {
                    send_tcp_to_guest(
                        &p.neighbors,
                        &p.injector,
                        p.gw_mac,
                        p.key.remote_ip,
                        p.key.remote_port,
                        p.key.client_ip,
                        p.key.client_port,
                        server_isn,
                        rcv_nxt,
                        TCP_SYN | TCP_ACK,
                        65535,
                        &syn_ack_opts,
                        &[],
                    );
                    continue;
                }

                peer_window = (seg.window as usize).max(1460);

                // Process ACK advancement
                if (seg.flags & TCP_ACK) != 0 {
                    if !handshake_acked && seq_gt(seg.ack, server_isn) {
                        handshake_acked = true;
                        snd_una = server_isn.wrapping_add(1);
                        retries = 0;
                        rto = Duration::from_millis(220);
                        set_state(&p.state_label, "ESTABLISHED");
                    }

                    if handshake_acked && seq_gt(seg.ack, snd_una) && !seq_gt(seg.ack, snd_nxt) {
                        let newly_acked = seg.ack.wrapping_sub(snd_una) as usize;
                        let drain_bytes = newly_acked.min(unacked_buf.len());
                        unacked_buf.drain(..drain_bytes);
                        snd_una = seg.ack;
                        retries = 0;
                        rto = Duration::from_millis(220);
                        last_tx_time = Instant::now();
                    }
                }

                // Process incoming guest TCP payload
                let seg_payload_len = seg.payload.len() as u32;
                let mut send_ack_now = false;
                if !seg.payload.is_empty() && !client_fin_rcvd {
                    let seg_end = seg.seq.wrapping_add(seg_payload_len);
                    if !seq_gt(seg_end, rcv_nxt) {
                        // Pure duplicate / already-received segment -> re-ACK immediately
                        send_ack_now = true;
                    } else if seq_lt(seg.seq, rcv_nxt) || seg.seq == rcv_nxt {
                        // In-order (possibly overlapping prefix)
                        let skip = rcv_nxt.wrapping_sub(seg.seq) as usize;
                        let fresh = &seg.payload[skip..];
                        if remote_writer.write_all(fresh).await.is_err() {
                            send_tcp_to_guest(
                                &p.neighbors,
                                &p.injector,
                                p.gw_mac,
                                p.key.remote_ip,
                                p.key.remote_port,
                                p.key.client_ip,
                                p.key.client_port,
                                snd_nxt,
                                rcv_nxt,
                                TCP_RST | TCP_ACK,
                                0,
                                &[],
                                &[],
                            );
                            break;
                        }
                        p.tx_bytes.fetch_add(fresh.len() as u64, Ordering::Relaxed);
                        rcv_nxt = rcv_nxt.wrapping_add(fresh.len() as u32);
                        send_ack_now = true;

                        // Drain contiguous out-of-order buffered segments
                        while let Some((&first_seq, _)) = ooo_segments.iter().next() {
                            if seq_gt(first_seq, rcv_nxt) {
                                break;
                            }
                            let chunk = ooo_segments.remove(&first_seq).unwrap();
                            let chunk_end = first_seq.wrapping_add(chunk.len() as u32);
                            if seq_gt(chunk_end, rcv_nxt) {
                                let off = rcv_nxt.wrapping_sub(first_seq) as usize;
                                let tail = &chunk[off..];
                                if remote_writer.write_all(tail).await.is_err() {
                                    break;
                                }
                                p.tx_bytes.fetch_add(tail.len() as u64, Ordering::Relaxed);
                                rcv_nxt = rcv_nxt.wrapping_add(tail.len() as u32);
                            }
                        }
                    } else if ooo_segments.len() < 16 {
                        ooo_segments.insert(seg.seq, seg.payload);
                        send_ack_now = true;
                    }
                }

                // Process guest FIN (only once all preceding bytes up to FIN seq have arrived)
                if (seg.flags & TCP_FIN) != 0 && !client_fin_rcvd {
                    let fin_pos = seg.seq.wrapping_add(seg_payload_len);
                    if fin_pos == rcv_nxt {
                        client_fin_rcvd = true;
                        rcv_nxt = rcv_nxt.wrapping_add(1);
                        let _ = remote_writer.shutdown().await;
                        send_ack_now = true;
                        set_state(&p.state_label, if fin_sent { "CLOSING" } else { "CLOSE_WAIT" });
                    }
                }

                if send_ack_now {
                    send_tcp_to_guest(
                        &p.neighbors,
                        &p.injector,
                        p.gw_mac,
                        p.key.remote_ip,
                        p.key.remote_port,
                        p.key.client_ip,
                        p.key.client_port,
                        snd_nxt,
                        rcv_nxt,
                        TCP_ACK,
                        65535,
                        &[],
                        &[],
                    );
                }

                if fin_sent && client_fin_rcvd && snd_una == snd_nxt {
                    break;
                }
            }

            read_res = remote_reader.read(&mut read_buf), if can_read_remote => {
                if let Ok(mut ts) = p.last_active.lock() {
                    *ts = Instant::now();
                }
                match read_res {
                    Ok(0) => {
                        remote_eof = true;
                        if !fin_sent {
                            fin_sent = true;
                            fin_seq = snd_nxt;
                            snd_nxt = snd_nxt.wrapping_add(1);
                            last_tx_time = Instant::now();
                            send_tcp_to_guest(
                                &p.neighbors,
                                &p.injector,
                                p.gw_mac,
                                p.key.remote_ip,
                                p.key.remote_port,
                                p.key.client_ip,
                                p.key.client_port,
                                fin_seq,
                                rcv_nxt,
                                TCP_FIN | TCP_ACK,
                                65535,
                                &[],
                                &[],
                            );
                            set_state(&p.state_label, if client_fin_rcvd { "LAST_ACK" } else { "FIN_WAIT" });
                        }
                    }
                    Ok(n) => {
                        let chunk = &read_buf[..n];
                        let seq_now = snd_nxt;
                        unacked_buf.extend(chunk);
                        snd_nxt = snd_nxt.wrapping_add(n as u32);
                        p.rx_bytes.fetch_add(n as u64, Ordering::Relaxed);
                        last_tx_time = Instant::now();
                        send_tcp_to_guest(
                            &p.neighbors,
                            &p.injector,
                            p.gw_mac,
                            p.key.remote_ip,
                            p.key.remote_port,
                            p.key.client_ip,
                            p.key.client_port,
                            seq_now,
                            rcv_nxt,
                            TCP_PSH | TCP_ACK,
                            65535,
                            &[],
                            chunk,
                        );
                    }
                    Err(_) => {
                        send_tcp_to_guest(
                            &p.neighbors,
                            &p.injector,
                            p.gw_mac,
                            p.key.remote_ip,
                            p.key.remote_port,
                            p.key.client_ip,
                            p.key.client_port,
                            snd_nxt,
                            rcv_nxt,
                            TCP_RST | TCP_ACK,
                            0,
                            &[],
                            &[],
                        );
                        break;
                    }
                }
            }

            _ = tick.tick() => {
                let idle = p
                    .last_active
                    .lock()
                    .map(|ts| ts.elapsed())
                    .unwrap_or(Duration::ZERO);
                if idle >= TCP_IDLE_TIMEOUT {
                    break;
                }

                // Retransmission timer for SYN+ACK, unacked data, or FIN
                if !handshake_acked {
                    if last_tx_time.elapsed() >= rto {
                        if retries >= 6 {
                            break;
                        }
                        retries += 1;
                        rto = (rto * 2).min(Duration::from_secs(3));
                        last_tx_time = Instant::now();
                        send_tcp_to_guest(
                            &p.neighbors,
                            &p.injector,
                            p.gw_mac,
                            p.key.remote_ip,
                            p.key.remote_port,
                            p.key.client_ip,
                            p.key.client_port,
                            server_isn,
                            rcv_nxt,
                            TCP_SYN | TCP_ACK,
                            65535,
                            &syn_ack_opts,
                            &[],
                        );
                    }
                } else if snd_una != snd_nxt && last_tx_time.elapsed() >= rto {
                    if retries >= 8 {
                        break;
                    }
                    retries += 1;
                    rto = (rto * 2).min(Duration::from_secs(3));
                    last_tx_time = Instant::now();

                    if !unacked_buf.is_empty() {
                        let take_len = unacked_buf.len().min(TCP_SEGMENT_MSS);
                        let retrans: Vec<u8> = unacked_buf.iter().take(take_len).copied().collect();
                        send_tcp_to_guest(
                            &p.neighbors,
                            &p.injector,
                            p.gw_mac,
                            p.key.remote_ip,
                            p.key.remote_port,
                            p.key.client_ip,
                            p.key.client_port,
                            snd_una,
                            rcv_nxt,
                            TCP_PSH | TCP_ACK,
                            65535,
                            &[],
                            &retrans,
                        );
                    } else if fin_sent {
                        send_tcp_to_guest(
                            &p.neighbors,
                            &p.injector,
                            p.gw_mac,
                            p.key.remote_ip,
                            p.key.remote_port,
                            p.key.client_ip,
                            p.key.client_port,
                            fin_seq,
                            rcv_nxt,
                            TCP_FIN | TCP_ACK,
                            65535,
                            &[],
                            &[],
                        );
                    }
                }
            }
        }
    }
}

// =============================================================================
// Internal Helpers
// =============================================================================

fn build_embedded_dhcp_config(cfg: &NatGatewayConfig) -> DhcpServerConfig {
    let mask_u32 = if cfg.prefix_len_v4 == 0 {
        0
    } else if cfg.prefix_len_v4 >= 32 {
        !0u32
    } else {
        !0u32 << (32 - cfg.prefix_len_v4)
    };
    let mask_str = Ipv4Addr::from(mask_u32).to_string();
    let dns_v4 = if cfg.dns_proxy_enabled {
        cfg.lan_ip_v4.clone()
    } else if !parse_ipv4_list(&cfg.upstream_dns).is_empty() {
        cfg.upstream_dns.clone()
    } else {
        "1.1.1.1, 8.8.8.8".to_string()
    };
    let dns_v6 = if cfg.dns_proxy_enabled {
        cfg.lan_ip_v6.clone()
    } else {
        "2606:4700:4700::1111".to_string()
    };

    DhcpServerConfig {
        v4_enabled: cfg.dhcp_enabled,
        server_ip_v4: cfg.lan_ip_v4.clone(),
        subnet_mask_v4: mask_str,
        pool_start_v4: cfg.dhcp_pool_start_v4.clone(),
        pool_end_v4: cfg.dhcp_pool_end_v4.clone(),
        gateway_v4: Some(cfg.lan_ip_v4.clone()),
        dns_v4,
        domain_name: cfg.domain_name.clone(),
        lease_time_secs: 3600,
        v6_enabled: cfg.v6_enabled,
        server_ip_v6: cfg.lan_ip_v6.clone(),
        prefix_len_v6: cfg.prefix_len_v6,
        pool_start_v6: cfg.dhcp_pool_start_v6.clone(),
        pool_end_v6: cfg.dhcp_pool_end_v6.clone(),
        gateway_v6: None,
        dns_v6,
        slaac_enabled: true,
        advertise_default_route_v6: cfg.v6_enabled,
    }
}

fn is_routable_external_ipv4(dst: Ipv4Addr, lan_gw: Ipv4Addr, prefix_len: u8) -> bool {
    if dst.is_unspecified() || dst.is_broadcast() || dst.is_multicast() || dst.is_loopback() {
        return false;
    }
    if dst == lan_gw {
        return false;
    }
    let plen = prefix_len.min(32);
    if plen > 0 {
        let mask = if plen == 32 { !0u32 } else { !0u32 << (32 - plen) };
        if (u32::from(dst) & mask) == (u32::from(lan_gw) & mask) {
            return false;
        }
    }
    true
}

fn is_routable_external_ipv6(dst: Ipv6Addr, lan_gw: Ipv6Addr, prefix_len: u8) -> bool {
    if dst.is_unspecified()
        || dst.is_loopback()
        || dst.is_multicast()
        || (dst.segments()[0] & 0xffc0) == 0xfe80
    {
        return false;
    }
    let plen = prefix_len.clamp(8, 128);
    if mask_ipv6(dst, plen) == mask_ipv6(lan_gw, plen) {
        return false;
    }
    true
}

fn discover_macos_resolv_conf_servers() -> Vec<IpAddr> {
    let mut out = Vec::new();
    if let Ok(text) = fs::read_to_string("/etc/resolv.conf") {
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("nameserver") {
                let addr_tok = rest.split_whitespace().next().unwrap_or("");
                // Strip `%scope` zone suffixes like `fe80::1%en0`
                let clean = addr_tok.split('%').next().unwrap_or("");
                if let Ok(ip) = clean.parse::<IpAddr>() {
                    if !ip.is_unspecified() && !out.contains(&ip) {
                        out.push(ip);
                    }
                }
            }
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn send_udp_to_guest(
    neighbors: &Arc<Mutex<HashMap<IpAddr, NeighborRoute>>>,
    injector: &FrameInjector,
    gw_mac: [u8; 6],
    src_ip: IpAddr,
    src_port: u16,
    dst_ip: IpAddr,
    dst_port: u16,
    payload: &[u8],
) {
    let route = neighbors.lock().ok().and_then(|g| g.get(&dst_ip).cloned());
    let Some(r) = route else {
        return;
    };

    match (src_ip, dst_ip) {
        (IpAddr::V4(s4), IpAddr::V4(d4)) => {
            let udp = build_udp_ipv4(s4, d4, src_port, dst_port, payload);
            let ip = build_ipv4_packet(s4, d4, IPPROTO_UDP, 64, &udp);
            let eth = wrap_ethernet(r.mac, gw_mac, ETHERTYPE_IPV4, r.vlan_tci, &ip);
            injector(r.port_id, Bytes::from(eth));
        }
        (IpAddr::V6(s6), IpAddr::V6(d6)) => {
            let udp6 = build_udp_ipv6(s6, d6, src_port, dst_port, payload);
            let ip6 = build_ipv6_packet(s6, d6, IPPROTO_UDP, 64, &udp6);
            let eth = wrap_ethernet(r.mac, gw_mac, ETHERTYPE_IPV6, r.vlan_tci, &ip6);
            injector(r.port_id, Bytes::from(eth));
        }
        _ => {}
    }
}

pub(crate) fn parse_tcp_segment(bytes: &[u8]) -> Option<(u16, u16, GuestTcpSegment)> {
    if bytes.len() < 20 {
        return None;
    }
    let src_port = u16::from_be_bytes([bytes[0], bytes[1]]);
    let dst_port = u16::from_be_bytes([bytes[2], bytes[3]]);
    let seq = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let ack = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    let data_offset = ((bytes[12] >> 4) as usize) * 4;
    if data_offset < 20 || bytes.len() < data_offset {
        return None;
    }
    let flags = bytes[13] & 0x3f;
    let window = u16::from_be_bytes([bytes[14], bytes[15]]);
    let payload = bytes[data_offset..].to_vec();
    Some((
        src_port,
        dst_port,
        GuestTcpSegment {
            seq,
            ack,
            flags,
            window,
            payload,
        },
    ))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_tcp_segment_bytes(
    src_ip: IpAddr,
    dst_ip: IpAddr,
    src_port: u16,
    dst_port: u16,
    seq: u32,
    ack: u32,
    flags: u8,
    window: u16,
    options: &[u8],
    payload: &[u8],
) -> Vec<u8> {
    let padded_opts_len = (options.len() + 3) & !3;
    let hdr_len = 20 + padded_opts_len;
    let data_offset_byte = ((hdr_len / 4) as u8) << 4;

    let mut seg = Vec::with_capacity(hdr_len + payload.len());
    seg.extend_from_slice(&src_port.to_be_bytes());
    seg.extend_from_slice(&dst_port.to_be_bytes());
    seg.extend_from_slice(&seq.to_be_bytes());
    seg.extend_from_slice(&ack.to_be_bytes());
    seg.push(data_offset_byte);
    seg.push(flags);
    seg.extend_from_slice(&window.to_be_bytes());
    seg.extend_from_slice(&[0, 0]); // checksum placeholder
    seg.extend_from_slice(&[0, 0]); // urgent pointer
    seg.extend_from_slice(options);
    seg.resize(hdr_len, 0); // NOP/END option padding
    seg.extend_from_slice(payload);

    let csum = match (src_ip, dst_ip) {
        (IpAddr::V4(s4), IpAddr::V4(d4)) => ipv4_upper_checksum(s4, d4, IPPROTO_TCP, &seg),
        (IpAddr::V6(s6), IpAddr::V6(d6)) => ipv6_upper_checksum(s6, d6, IPPROTO_TCP, &seg),
        _ => 0,
    };
    seg[16..18].copy_from_slice(&csum.to_be_bytes());
    seg
}

#[allow(clippy::too_many_arguments)]
fn send_tcp_to_guest(
    neighbors: &Arc<Mutex<HashMap<IpAddr, NeighborRoute>>>,
    injector: &FrameInjector,
    gw_mac: [u8; 6],
    src_ip: IpAddr,
    src_port: u16,
    dst_ip: IpAddr,
    dst_port: u16,
    seq: u32,
    ack: u32,
    flags: u8,
    window: u16,
    options: &[u8],
    payload: &[u8],
) {
    let route = neighbors.lock().ok().and_then(|g| g.get(&dst_ip).cloned());
    let Some(r) = route else {
        return;
    };

    let tcp = build_tcp_segment_bytes(
        src_ip, dst_ip, src_port, dst_port, seq, ack, flags, window, options, payload,
    );
    match (src_ip, dst_ip) {
        (IpAddr::V4(s4), IpAddr::V4(d4)) => {
            let ip = build_ipv4_packet(s4, d4, IPPROTO_TCP, 64, &tcp);
            let eth = wrap_ethernet(r.mac, gw_mac, ETHERTYPE_IPV4, r.vlan_tci, &ip);
            injector(r.port_id, Bytes::from(eth));
        }
        (IpAddr::V6(s6), IpAddr::V6(d6)) => {
            let ip6 = build_ipv6_packet(s6, d6, IPPROTO_TCP, 64, &tcp);
            let eth = wrap_ethernet(r.mac, gw_mac, ETHERTYPE_IPV6, r.vlan_tci, &ip6);
            injector(r.port_id, Bytes::from(eth));
        }
        _ => {}
    }
}

fn seq_lt(a: u32, b: u32) -> bool {
    (a.wrapping_sub(b) as i32) < 0
}

fn seq_gt(a: u32, b: u32) -> bool {
    (a.wrapping_sub(b) as i32) > 0
}

fn set_state(slot: &Arc<Mutex<String>>, st: &str) {
    if let Ok(mut g) = slot.lock() {
        *g = st.to_string();
    }
}

fn format_sock(ip: IpAddr, port: u16) -> String {
    match ip {
        IpAddr::V4(v4) => format!("{v4}:{port}"),
        IpAddr::V6(v6) => format!("[{v6}]:{port}"),
    }
}

#[cfg(unix)]
fn send_unprivileged_icmpv4_echo(dst: Ipv4Addr, icmp_req: &[u8]) -> Option<(Vec<u8>, u8)> {
    unsafe {
        let fd = libc::socket(libc::AF_INET, libc::SOCK_DGRAM, libc::IPPROTO_ICMP);
        if fd < 0 {
            return None;
        }
        struct FdGuard(libc::c_int);
        impl Drop for FdGuard {
            fn drop(&mut self) {
                unsafe {
                    libc::close(self.0);
                }
            }
        }
        let _guard = FdGuard(fd);

        let tv = libc::timeval {
            tv_sec: 2,
            tv_usec: 0,
        };
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_RCVTIMEO,
            (&tv as *const libc::timeval).cast(),
            std::mem::size_of::<libc::timeval>() as libc::socklen_t,
        );

        let mut addr: libc::sockaddr_in = std::mem::zeroed();
        #[cfg(target_os = "macos")]
        {
            addr.sin_len = std::mem::size_of::<libc::sockaddr_in>() as u8;
        }
        addr.sin_family = libc::AF_INET as libc::sa_family_t;
        addr.sin_port = 0;
        addr.sin_addr = libc::in_addr {
            s_addr: u32::from_ne_bytes(dst.octets()),
        };

        let sent = libc::sendto(
            fd,
            icmp_req.as_ptr().cast(),
            icmp_req.len(),
            0,
            (&addr as *const libc::sockaddr_in).cast(),
            std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
        );
        if sent < 0 {
            return None;
        }

        let mut buf = vec![0u8; 2048];
        let n = libc::recv(fd, buf.as_mut_ptr().cast(), buf.len(), 0);
        if n <= 0 {
            return None;
        }
        let n = n as usize;
        // On macOS, `SOCK_DGRAM` + `IPPROTO_ICMP` prepends the outer IPv4 header on `recv`
        if n >= 28 && (buf[0] >> 4) == 4 {
            let ihl = ((buf[0] & 0x0f) as usize) * 4;
            let ttl = buf[8];
            if n >= ihl + 8 && buf[ihl] == 0 {
                return Some((buf[ihl..n].to_vec(), ttl));
            }
        } else if n >= 8 && buf[0] == 0 {
            return Some((buf[..n].to_vec(), 56));
        }
        None
    }
}

#[cfg(not(unix))]
fn send_unprivileged_icmpv4_echo(_dst: Ipv4Addr, _icmp_req: &[u8]) -> Option<(Vec<u8>, u8)> {
    None
}

#[cfg(unix)]
fn send_unprivileged_icmpv6_echo(dst: Ipv6Addr, icmp6_req: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let fd = libc::socket(libc::AF_INET6, libc::SOCK_DGRAM, libc::IPPROTO_ICMPV6);
        if fd < 0 {
            return None;
        }
        struct FdGuard(libc::c_int);
        impl Drop for FdGuard {
            fn drop(&mut self) {
                unsafe {
                    libc::close(self.0);
                }
            }
        }
        let _guard = FdGuard(fd);

        let tv = libc::timeval {
            tv_sec: 2,
            tv_usec: 0,
        };
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_RCVTIMEO,
            (&tv as *const libc::timeval).cast(),
            std::mem::size_of::<libc::timeval>() as libc::socklen_t,
        );

        let mut addr: libc::sockaddr_in6 = std::mem::zeroed();
        #[cfg(target_os = "macos")]
        {
            addr.sin6_len = std::mem::size_of::<libc::sockaddr_in6>() as u8;
        }
        addr.sin6_family = libc::AF_INET6 as libc::sa_family_t;
        addr.sin6_addr = libc::in6_addr {
            s6_addr: dst.octets(),
        };

        let sent = libc::sendto(
            fd,
            icmp6_req.as_ptr().cast(),
            icmp6_req.len(),
            0,
            (&addr as *const libc::sockaddr_in6).cast(),
            std::mem::size_of::<libc::sockaddr_in6>() as libc::socklen_t,
        );
        if sent < 0 {
            return None;
        }

        let mut buf = vec![0u8; 2048];
        let n = libc::recv(fd, buf.as_mut_ptr().cast(), buf.len(), 0);
        if n >= 8 && buf[0] == 129 {
            return Some(buf[..(n as usize)].to_vec());
        }
        None
    }
}

#[cfg(not(unix))]
fn send_unprivileged_icmpv6_echo(_dst: Ipv6Addr, _icmp6_req: &[u8]) -> Option<Vec<u8>> {
    None
}

#[allow(dead_code)]
fn _keep_format_mac_ref() {
    let _ = format_mac([0; 6]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nat_gateway_answers_arp_gateway_ping_and_builtin_dhcpv4() {
        let injected: Arc<Mutex<Vec<(String, Bytes)>>> = Arc::new(Mutex::new(Vec::new()));
        let injected_clone = injected.clone();
        let injector: FrameInjector = Arc::new(move |port, bytes| {
            injected_clone.lock().unwrap().push((port, bytes));
        });

        let mut gw = NatGatewayCore::new(
            "nat1".into(),
            "Host Internet".into(),
            vec!["nat1-p0".into()],
            NatGatewayConfig::default(),
            injector,
        );
        let now = Instant::now();
        let client_mac = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];

        // 1. ARP Who-Has 10.0.2.1
        let mut arp_req = Vec::new();
        arp_req.extend_from_slice(&1u16.to_be_bytes());
        arp_req.extend_from_slice(&ETHERTYPE_IPV4.to_be_bytes());
        arp_req.extend_from_slice(&[6, 4, 0, 1]);
        arp_req.extend_from_slice(&client_mac);
        arp_req.extend_from_slice(&[10, 0, 2, 15]);
        arp_req.extend_from_slice(&[0; 6]);
        arp_req.extend_from_slice(&[10, 0, 2, 1]);
        let arp_frame = wrap_ethernet([0xff; 6], client_mac, ETHERTYPE_ARP, None, &arp_req);
        let arp_out = gw.process_frame("nat1-p0", &arp_frame, now);
        assert_eq!(arp_out.len(), 1);
        assert_eq!(u16::from_be_bytes([arp_out[0].1[20], arp_out[0].1[21]]), 2);

        // 2. ICMP Echo Request to 10.0.2.1 -> Immediate Echo Reply
        let mut icmp = vec![8u8, 0, 0, 0, 0x12, 0x34, 0, 1, b'p', b'i', b'n', b'g'];
        let csum = internet_checksum(&icmp);
        icmp[2..4].copy_from_slice(&csum.to_be_bytes());
        let ip = build_ipv4_packet(
            Ipv4Addr::new(10, 0, 2, 15),
            Ipv4Addr::new(10, 0, 2, 1),
            IPPROTO_ICMP,
            64,
            &icmp,
        );
        let ping_eth = wrap_ethernet(gw.gateway_mac, client_mac, ETHERTYPE_IPV4, None, &ip);
        let pong_out = gw.process_frame("nat1-p0", &ping_eth, now);
        assert_eq!(pong_out.len(), 1);
        let pong_ip = ParsedIpv4::parse(&pong_out[0].1[14..]).unwrap();
        assert_eq!(pong_ip.src, Ipv4Addr::new(10, 0, 2, 1));
        assert_eq!(pong_ip.payload[0], 0); // Echo Reply

        // 3. Verify TCP segment builder + parser + checksum round-trip
        let tcp_bytes = build_tcp_segment_bytes(
            IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            IpAddr::V4(Ipv4Addr::new(10, 0, 2, 15)),
            443,
            51234,
            1000,
            2000,
            TCP_SYN | TCP_ACK,
            65535,
            &[2, 4, 0x05, 0x8c],
            b"",
        );
        assert_eq!(
            ipv4_upper_checksum(
                Ipv4Addr::new(93, 184, 216, 34),
                Ipv4Addr::new(10, 0, 2, 15),
                IPPROTO_TCP,
                &tcp_bytes
            ),
            0,
            "TCP pseudo-header checksum must verify to 0"
        );
        let (sp, dp, parsed) = parse_tcp_segment(&tcp_bytes).unwrap();
        assert_eq!(sp, 443);
        assert_eq!(dp, 51234);
        assert_eq!(parsed.seq, 1000);
        assert_eq!(parsed.ack, 2000);
        assert_eq!(parsed.flags, TCP_SYN | TCP_ACK);
    }

    #[test]
    fn external_ipv4_and_ipv6_route_guards_reject_loopback_and_local_subnet() {
        let gw4 = Ipv4Addr::new(10, 0, 2, 1);
        assert!(!is_routable_external_ipv4(Ipv4Addr::LOCALHOST, gw4, 24));
        assert!(!is_routable_external_ipv4(Ipv4Addr::BROADCAST, gw4, 24));
        assert!(!is_routable_external_ipv4(Ipv4Addr::new(10, 0, 2, 55), gw4, 24));
        assert!(is_routable_external_ipv4(Ipv4Addr::new(1, 1, 1, 1), gw4, 24));
        assert!(is_routable_external_ipv4(Ipv4Addr::new(192, 168, 1, 1), gw4, 24));

        let gw6: Ipv6Addr = "fd00:2::1".parse().unwrap();
        assert!(!is_routable_external_ipv6(Ipv6Addr::LOCALHOST, gw6, 64));
        assert!(!is_routable_external_ipv6("fe80::1".parse().unwrap(), gw6, 64));
        assert!(!is_routable_external_ipv6("fd00:2::99".parse().unwrap(), gw6, 64));
        assert!(is_routable_external_ipv6("2606:4700:4700::1111".parse().unwrap(), gw6, 64));
    }
}
