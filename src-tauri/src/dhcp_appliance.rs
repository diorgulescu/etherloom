use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::{Duration, Instant};

pub const ETHERTYPE_IPV4: u16 = 0x0800;
pub const ETHERTYPE_ARP: u16 = 0x0806;
pub const ETHERTYPE_IPV6: u16 = 0x86dd;

pub const IPPROTO_ICMP: u8 = 1;
pub const IPPROTO_TCP: u8 = 6;
pub const IPPROTO_UDP: u8 = 17;
pub const IPPROTO_ICMPV6: u8 = 58;

const DHCP_MAGIC_COOKIE: [u8; 4] = [99, 130, 83, 99];

const DHCPDISCOVER: u8 = 1;
const DHCPOFFER: u8 = 2;
const DHCPREQUEST: u8 = 3;
const DHCPDECLINE: u8 = 4;
const DHCPACK: u8 = 5;
const DHCPNAK: u8 = 6;
const DHCPRELEASE: u8 = 7;
const DHCPINFORM: u8 = 8;

const DHCPV6_SOLICIT: u8 = 1;
const DHCPV6_ADVERTISE: u8 = 2;
const DHCPV6_REQUEST: u8 = 3;
const DHCPV6_CONFIRM: u8 = 4;
const DHCPV6_RENEW: u8 = 5;
const DHCPV6_REBIND: u8 = 6;
const DHCPV6_REPLY: u8 = 7;
const DHCPV6_RELEASE: u8 = 8;
const DHCPV6_DECLINE: u8 = 9;
const DHCPV6_INFO_REQUEST: u8 = 11;

const DHCPV6_OPT_CLIENTID: u16 = 1;
const DHCPV6_OPT_SERVERID: u16 = 2;
const DHCPV6_OPT_IA_NA: u16 = 3;
const DHCPV6_OPT_IAADDR: u16 = 5;
const DHCPV6_OPT_STATUS_CODE: u16 = 13;
const DHCPV6_OPT_RAPID_COMMIT: u16 = 14;
const DHCPV6_OPT_DNS_SERVERS: u16 = 23;
const DHCPV6_OPT_DOMAIN_LIST: u16 = 24;
const DHCPV6_OPT_FQDN: u16 = 39;

fn default_true() -> bool {
    true
}
fn default_server_ip_v4() -> String {
    "10.0.10.2".to_string()
}
fn default_subnet_mask_v4() -> String {
    "255.255.255.0".to_string()
}
fn default_pool_start_v4() -> String {
    "10.0.10.100".to_string()
}
fn default_pool_end_v4() -> String {
    "10.0.10.200".to_string()
}
fn default_gateway_v4() -> Option<String> {
    Some("10.0.10.1".to_string())
}
fn default_dns_v4() -> String {
    "1.1.1.1, 9.9.9.9".to_string()
}
fn default_domain_name() -> String {
    "lab.local".to_string()
}
fn default_lease_time_secs() -> u32 {
    3600
}
fn default_server_ip_v6() -> String {
    "fd00:10::2".to_string()
}
fn default_prefix_len_v6() -> u8 {
    64
}
fn default_pool_start_v6() -> String {
    "fd00:10::100".to_string()
}
fn default_pool_end_v6() -> String {
    "fd00:10::200".to_string()
}
fn default_dns_v6() -> String {
    "2606:4700:4700::1111, 2001:4860:4860::8888".to_string()
}

/// User-configurable Dual-Stack DHCPv4 + DHCPv6 + SLAAC settings persisted in `topology.toml`
/// and exchanged over Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DhcpServerConfig {
    #[serde(default = "default_true", alias = "v4Enabled")]
    pub v4_enabled: bool,
    #[serde(default = "default_server_ip_v4", alias = "serverIpV4")]
    pub server_ip_v4: String,
    #[serde(default = "default_subnet_mask_v4", alias = "subnetMaskV4")]
    pub subnet_mask_v4: String,
    #[serde(default = "default_pool_start_v4", alias = "poolStartV4")]
    pub pool_start_v4: String,
    #[serde(default = "default_pool_end_v4", alias = "poolEndV4")]
    pub pool_end_v4: String,
    #[serde(default = "default_gateway_v4", alias = "gatewayV4")]
    pub gateway_v4: Option<String>,
    #[serde(default = "default_dns_v4", alias = "dnsV4")]
    pub dns_v4: String,
    #[serde(default = "default_domain_name", alias = "domainName")]
    pub domain_name: String,
    #[serde(default = "default_lease_time_secs", alias = "leaseTimeSecs")]
    pub lease_time_secs: u32,

    #[serde(default = "default_true", alias = "v6Enabled")]
    pub v6_enabled: bool,
    #[serde(default = "default_server_ip_v6", alias = "serverIpV6")]
    pub server_ip_v6: String,
    #[serde(default = "default_prefix_len_v6", alias = "prefixLenV6")]
    pub prefix_len_v6: u8,
    #[serde(default = "default_pool_start_v6", alias = "poolStartV6")]
    pub pool_start_v6: String,
    #[serde(default = "default_pool_end_v6", alias = "poolEndV6")]
    pub pool_end_v6: String,
    #[serde(default, alias = "gatewayV6")]
    pub gateway_v6: Option<String>,
    #[serde(default = "default_dns_v6", alias = "dnsV6")]
    pub dns_v6: String,
    #[serde(default = "default_true", alias = "slaacEnabled")]
    pub slaac_enabled: bool,
    #[serde(default, alias = "advertiseDefaultRouteV6")]
    pub advertise_default_route_v6: bool,
}

impl Default for DhcpServerConfig {
    fn default() -> Self {
        Self {
            v4_enabled: true,
            server_ip_v4: default_server_ip_v4(),
            subnet_mask_v4: default_subnet_mask_v4(),
            pool_start_v4: default_pool_start_v4(),
            pool_end_v4: default_pool_end_v4(),
            gateway_v4: default_gateway_v4(),
            dns_v4: default_dns_v4(),
            domain_name: default_domain_name(),
            lease_time_secs: default_lease_time_secs(),
            v6_enabled: true,
            server_ip_v6: default_server_ip_v6(),
            prefix_len_v6: default_prefix_len_v6(),
            pool_start_v6: default_pool_start_v6(),
            pool_end_v6: default_pool_end_v6(),
            gateway_v6: None,
            dns_v6: default_dns_v6(),
            slaac_enabled: true,
            advertise_default_route_v6: false,
        }
    }
}

/// Live DHCPv4 / DHCPv6 lease entry exposed to the React UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DhcpLeaseDto {
    pub family: String, // "ipv4" | "ipv6"
    pub ip: String,
    pub client_id: String,
    pub mac: String,
    pub hostname: Option<String>,
    pub expires_in_secs: u64,
    pub state: String, // "leased" | "offered"
}

#[derive(Debug, Clone)]
struct LeaseV4Record {
    ip: Ipv4Addr,
    mac: [u8; 6],
    hostname: Option<String>,
    committed: bool,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
struct LeaseV6Record {
    ip: Ipv6Addr,
    duid: Vec<u8>,
    mac: [u8; 6],
    hostname: Option<String>,
    committed: bool,
    expires_at: Instant,
}

/// Pure-Rust Userspace Fabric Dual-Stack DHCPv4 + DHCPv6 + SLAAC RA Appliance.
pub struct DhcpServerCore {
    pub id: String,
    pub name: String,
    pub ports: Vec<String>,
    pub server_mac: [u8; 6],
    pub config: DhcpServerConfig,
    leases_v4: HashMap<[u8; 6], LeaseV4Record>,
    leases_v6: HashMap<Vec<u8>, LeaseV6Record>,
    mac_port_table: HashMap<[u8; 6], String>,
}

impl DhcpServerCore {
    pub fn new(
        id: String,
        name: String,
        ports: Vec<String>,
        config: DhcpServerConfig,
    ) -> Self {
        let server_mac = deterministic_appliance_mac(0xd4, &id);
        Self {
            id,
            name,
            ports,
            server_mac,
            config,
            leases_v4: HashMap::new(),
            leases_v6: HashMap::new(),
            mac_port_table: HashMap::new(),
        }
    }

    pub fn update_config(&mut self, next: DhcpServerConfig) {
        self.config = next;
    }

    pub fn clear_leases(&mut self) {
        self.leases_v4.clear();
        self.leases_v6.clear();
    }

    pub fn snapshot_leases(&mut self, now: Instant) -> Vec<DhcpLeaseDto> {
        self.leases_v4.retain(|_, rec| rec.expires_at > now);
        self.leases_v6.retain(|_, rec| rec.expires_at > now);

        let mut out = Vec::with_capacity(self.leases_v4.len() + self.leases_v6.len());
        for rec in self.leases_v4.values() {
            out.push(DhcpLeaseDto {
                family: "ipv4".to_string(),
                ip: rec.ip.to_string(),
                client_id: format_mac(rec.mac),
                mac: format_mac(rec.mac),
                hostname: rec.hostname.clone(),
                expires_in_secs: rec.expires_at.saturating_duration_since(now).as_secs(),
                state: if rec.committed {
                    "leased".to_string()
                } else {
                    "offered".to_string()
                },
            });
        }
        for rec in self.leases_v6.values() {
            out.push(DhcpLeaseDto {
                family: "ipv6".to_string(),
                ip: rec.ip.to_string(),
                client_id: hex_encode(&rec.duid),
                mac: format_mac(rec.mac),
                hostname: rec.hostname.clone(),
                expires_in_secs: rec.expires_at.saturating_duration_since(now).as_secs(),
                state: if rec.committed {
                    "leased".to_string()
                } else {
                    "offered".to_string()
                },
            });
        }
        out.sort_by(|a, b| a.family.cmp(&b.family).then_with(|| a.ip.cmp(&b.ip)));
        out
    }

    pub fn link_local_ipv6(&self) -> Ipv6Addr {
        mac_to_link_local_ipv6(self.server_mac)
    }

    /// Processes an incoming Ethernet II frame on `ingress_port` and returns `(egress_port, frame)`
    /// tuples to transmit onto attached virtual wires.
    pub fn process_frame(
        &mut self,
        ingress_port: &str,
        frame: &[u8],
        now: Instant,
    ) -> Vec<(String, Vec<u8>)> {
        if frame.len() < 14 {
            return Vec::new();
        }

        let dst_mac: [u8; 6] = frame[0..6].try_into().unwrap();
        let src_mac: [u8; 6] = frame[6..12].try_into().unwrap();
        if src_mac == self.server_mac {
            return Vec::new();
        }

        if (src_mac[0] & 0x01) == 0 {
            self.mac_port_table.insert(src_mac, ingress_port.to_string());
        }

        let (ethertype, l3_offset, vlan_tci) = parse_ethertype_and_vlan(frame);
        if frame.len() < l3_offset {
            return Vec::new();
        }
        let payload = &frame[l3_offset..];

        let mut replies = Vec::new();

        // 1. Handle local control-plane traffic (ARP, Ping, DHCPv4, NDP/RA, DHCPv6)
        if let Some(reply_l2) = self.try_handle_local_protocol(src_mac, dst_mac, ethertype, vlan_tci, payload, now) {
            replies.push((ingress_port.to_string(), reply_l2));
        }

        // 2. If user configured multiple ports on the DHCP appliance, bridge non-self traffic across ports
        if self.ports.len() > 1 && dst_mac != self.server_mac {
            let is_group = (dst_mac[0] & 0x01) != 0;
            if is_group {
                for p in &self.ports {
                    if p != ingress_port {
                        replies.push((p.clone(), frame.to_vec()));
                    }
                }
            } else if let Some(target_port) = self.mac_port_table.get(&dst_mac) {
                if target_port != ingress_port {
                    replies.push((target_port.clone(), frame.to_vec()));
                }
            } else {
                for p in &self.ports {
                    if p != ingress_port {
                        replies.push((p.clone(), frame.to_vec()));
                    }
                }
            }
        }

        replies
    }

    /// Reusable protocol handler (also callable by `NatGatewayCore` for built-in LAN DHCPv4/v6 + RA!).
    pub fn handle_service_packet(
        &mut self,
        src_mac: [u8; 6],
        dst_mac: [u8; 6],
        ethertype: u16,
        vlan_tci: Option<u16>,
        payload: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        self.try_handle_local_protocol(src_mac, dst_mac, ethertype, vlan_tci, payload, now)
    }

    fn try_handle_local_protocol(
        &mut self,
        src_mac: [u8; 6],
        _dst_mac: [u8; 6],
        ethertype: u16,
        vlan_tci: Option<u16>,
        payload: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        match ethertype {
            ETHERTYPE_ARP if self.config.v4_enabled => {
                let server_ip = self.parsed_server_ipv4()?;
                let arp_reply = handle_arp_request(payload, server_ip, self.server_mac)?;
                Some(wrap_ethernet(src_mac, self.server_mac, ETHERTYPE_ARP, vlan_tci, &arp_reply))
            }
            ETHERTYPE_IPV4 if self.config.v4_enabled => {
                self.handle_ipv4_packet(src_mac, vlan_tci, payload, now)
            }
            ETHERTYPE_IPV6 if self.config.v6_enabled => {
                self.handle_ipv6_packet(src_mac, vlan_tci, payload, now)
            }
            _ => None,
        }
    }

    fn handle_ipv4_packet(
        &mut self,
        src_mac: [u8; 6],
        vlan_tci: Option<u16>,
        pkt: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        let ip = ParsedIpv4::parse(pkt)?;
        let server_ip = self.parsed_server_ipv4()?;

        if ip.proto == IPPROTO_ICMP && ip.dst == server_ip {
            if ip.payload.len() >= 8 && ip.payload[0] == 8 && ip.payload[1] == 0 {
                let mut icmp_reply = ip.payload.to_vec();
                icmp_reply[0] = 0; // Echo Reply
                icmp_reply[2] = 0;
                icmp_reply[3] = 0;
                let csum = internet_checksum(&icmp_reply);
                icmp_reply[2..4].copy_from_slice(&csum.to_be_bytes());
                let ip_bytes = build_ipv4_packet(server_ip, ip.src, IPPROTO_ICMP, 64, &icmp_reply);
                return Some(wrap_ethernet(
                    src_mac,
                    self.server_mac,
                    ETHERTYPE_IPV4,
                    vlan_tci,
                    &ip_bytes,
                ));
            }
        }

        if ip.proto == IPPROTO_UDP && ip.payload.len() >= 8 {
            let src_port = u16::from_be_bytes([ip.payload[0], ip.payload[1]]);
            let dst_port = u16::from_be_bytes([ip.payload[2], ip.payload[3]]);
            let udp_len = u16::from_be_bytes([ip.payload[4], ip.payload[5]]) as usize;
            if dst_port == 67 && (src_port == 68 || src_port == 67) && ip.payload.len() >= udp_len && udp_len >= 8 {
                let dhcp_msg = &ip.payload[8..udp_len];
                return self.handle_dhcpv4(src_mac, ip.src, vlan_tci, dhcp_msg, now);
            }
        }

        None
    }

    fn handle_dhcpv4(
        &mut self,
        eth_src_mac: [u8; 6],
        ip_src: Ipv4Addr,
        vlan_tci: Option<u16>,
        msg: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        if msg.len() < 240 || msg[0] != 1 {
            return None;
        }
        if msg[236..240] != DHCP_MAGIC_COOKIE {
            return None;
        }

        let server_ip = self.parsed_server_ipv4()?;
        let mask = self
            .config
            .subnet_mask_v4
            .trim()
            .parse::<Ipv4Addr>()
            .unwrap_or(Ipv4Addr::new(255, 255, 255, 0));

        let xid: [u8; 4] = msg[4..8].try_into().ok()?;
        let flags = u16::from_be_bytes([msg[10], msg[11]]);
        let ciaddr = Ipv4Addr::new(msg[12], msg[13], msg[14], msg[15]);
        let mut chaddr = [0u8; 6];
        chaddr.copy_from_slice(&msg[28..34]);
        let client_mac = if chaddr == [0; 6] { eth_src_mac } else { chaddr };

        // Parse DHCPv4 options
        let mut msg_type: Option<u8> = None;
        let mut requested_ip: Option<Ipv4Addr> = None;
        let mut server_id_opt: Option<Ipv4Addr> = None;
        let mut hostname: Option<String> = None;

        let mut idx = 240;
        while idx < msg.len() {
            let code = msg[idx];
            if code == 255 {
                break;
            }
            if code == 0 {
                idx += 1;
                continue;
            }
            if idx + 1 >= msg.len() {
                break;
            }
            let len = msg[idx + 1] as usize;
            if idx + 2 + len > msg.len() {
                break;
            }
            let val = &msg[idx + 2..idx + 2 + len];
            match code {
                53 if len == 1 => msg_type = Some(val[0]),
                50 if len == 4 => requested_ip = Some(Ipv4Addr::new(val[0], val[1], val[2], val[3])),
                54 if len == 4 => server_id_opt = Some(Ipv4Addr::new(val[0], val[1], val[2], val[3])),
                12 if len > 0 => {
                    let clean: String = String::from_utf8_lossy(val)
                        .chars()
                        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.' || *c == '_')
                        .take(63)
                        .collect();
                    if !clean.is_empty() {
                        hostname = Some(clean);
                    }
                }
                _ => {}
            }
            idx += 2 + len;
        }

        let msg_type = msg_type?;
        self.leases_v4.retain(|_, r| r.expires_at > now);

        let lease_secs = self.config.lease_time_secs.clamp(60, 604_800);
        let ttl = Duration::from_secs(lease_secs as u64);

        match msg_type {
            DHCPDISCOVER => {
                let offered = self.allocate_ipv4(client_mac, requested_ip, now)?;
                self.leases_v4.insert(
                    client_mac,
                    LeaseV4Record {
                        ip: offered,
                        mac: client_mac,
                        hostname,
                        committed: false,
                        expires_at: now + Duration::from_secs(120).max(ttl),
                    },
                );
                let reply = self.build_dhcpv4_reply(
                    DHCPOFFER, xid, flags, ciaddr, offered, server_ip, mask, chaddr, lease_secs,
                );
                Some(self.encapsulate_dhcpv4_reply(
                    eth_src_mac, client_mac, flags, ciaddr, offered, server_ip, vlan_tci, &reply,
                ))
            }
            DHCPREQUEST => {
                if let Some(sid) = server_id_opt {
                    if sid != server_ip {
                        return None;
                    }
                }
                let desired = requested_ip.or_else(|| {
                    if !ciaddr.is_unspecified() {
                        Some(ciaddr)
                    } else {
                        self.leases_v4.get(&client_mac).map(|r| r.ip)
                    }
                });

                let assigned = match desired {
                    Some(req_ip) if self.is_ipv4_assignable(req_ip, client_mac) => Some(req_ip),
                    None => self.allocate_ipv4(client_mac, None, now),
                    _ => None,
                };

                if let Some(leased_ip) = assigned {
                    let prev_host = self
                        .leases_v4
                        .get(&client_mac)
                        .and_then(|r| r.hostname.clone());
                    self.leases_v4.insert(
                        client_mac,
                        LeaseV4Record {
                            ip: leased_ip,
                            mac: client_mac,
                            hostname: hostname.or(prev_host),
                            committed: true,
                            expires_at: now + ttl,
                        },
                    );
                    let reply = self.build_dhcpv4_reply(
                        DHCPACK, xid, flags, ciaddr, leased_ip, server_ip, mask, chaddr, lease_secs,
                    );
                    Some(self.encapsulate_dhcpv4_reply(
                        eth_src_mac, client_mac, flags, ciaddr, leased_ip, server_ip, vlan_tci, &reply,
                    ))
                } else {
                    let reply = self.build_dhcpv4_reply(
                        DHCPNAK,
                        xid,
                        flags | 0x8000,
                        Ipv4Addr::UNSPECIFIED,
                        Ipv4Addr::UNSPECIFIED,
                        server_ip,
                        mask,
                        chaddr,
                        lease_secs,
                    );
                    Some(self.encapsulate_dhcpv4_reply(
                        eth_src_mac,
                        [0xff; 6],
                        0x8000,
                        Ipv4Addr::UNSPECIFIED,
                        Ipv4Addr::UNSPECIFIED,
                        server_ip,
                        vlan_tci,
                        &reply,
                    ))
                }
            }
            DHCPINFORM => {
                let target_ip = if !ciaddr.is_unspecified() {
                    ciaddr
                } else {
                    ip_src
                };
                let reply = self.build_dhcpv4_reply(
                    DHCPACK,
                    xid,
                    flags,
                    ciaddr,
                    Ipv4Addr::UNSPECIFIED,
                    server_ip,
                    mask,
                    chaddr,
                    0,
                );
                Some(self.encapsulate_dhcpv4_reply(
                    eth_src_mac,
                    client_mac,
                    flags,
                    target_ip,
                    target_ip,
                    server_ip,
                    vlan_tci,
                    &reply,
                ))
            }
            DHCPRELEASE | DHCPDECLINE => {
                self.leases_v4.remove(&client_mac);
                None
            }
            _ => None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn build_dhcpv4_reply(
        &self,
        dhcp_type: u8,
        xid: [u8; 4],
        flags: u16,
        ciaddr: Ipv4Addr,
        yiaddr: Ipv4Addr,
        server_ip: Ipv4Addr,
        mask: Ipv4Addr,
        chaddr: [u8; 6],
        lease_secs: u32,
    ) -> Vec<u8> {
        let mut pkt = vec![0u8; 240];
        pkt[0] = 2; // BOOTREPLY
        pkt[1] = 1; // Ethernet
        pkt[2] = 6; // MAC length
        pkt[4..8].copy_from_slice(&xid);
        pkt[10..12].copy_from_slice(&flags.to_be_bytes());
        pkt[12..16].copy_from_slice(&ciaddr.octets());
        pkt[16..20].copy_from_slice(&yiaddr.octets());
        pkt[20..24].copy_from_slice(&server_ip.octets());
        pkt[28..34].copy_from_slice(&chaddr);
        pkt[236..240].copy_from_slice(&DHCP_MAGIC_COOKIE);

        // Option 53: DHCP Message Type
        pkt.extend_from_slice(&[53, 1, dhcp_type]);
        // Option 54: Server Identifier
        pkt.extend_from_slice(&[54, 4]);
        pkt.extend_from_slice(&server_ip.octets());

        if dhcp_type != DHCPNAK {
            if lease_secs > 0 {
                // Option 51: Lease Time
                pkt.extend_from_slice(&[51, 4]);
                pkt.extend_from_slice(&lease_secs.to_be_bytes());
                // Option 58 (T1) & Option 59 (T2)
                let t1 = lease_secs / 2;
                let t2 = (lease_secs.saturating_mul(7)) / 8;
                pkt.extend_from_slice(&[58, 4]);
                pkt.extend_from_slice(&t1.to_be_bytes());
                pkt.extend_from_slice(&[59, 4]);
                pkt.extend_from_slice(&t2.to_be_bytes());
            }

            // Option 1: Subnet Mask
            pkt.extend_from_slice(&[1, 4]);
            pkt.extend_from_slice(&mask.octets());

            // Option 28: Broadcast Address
            let bcast_u32 = (u32::from(server_ip) & u32::from(mask)) | !u32::from(mask);
            pkt.extend_from_slice(&[28, 4]);
            pkt.extend_from_slice(&Ipv4Addr::from(bcast_u32).octets());

            // Option 3: Default Gateway / Router
            if let Some(gw) = self.parsed_gateway_ipv4() {
                pkt.extend_from_slice(&[3, 4]);
                pkt.extend_from_slice(&gw.octets());
            }

            // Option 6: DNS Servers
            let dns_list = parse_ipv4_list(&self.config.dns_v4);
            if !dns_list.is_empty() {
                pkt.push(6);
                pkt.push((dns_list.len() * 4) as u8);
                for dns in dns_list {
                    pkt.extend_from_slice(&dns.octets());
                }
            }

            // Option 15: Domain Name
            let dom = self.config.domain_name.trim().trim_end_matches('.');
            if !dom.is_empty() && dom.len() <= 250 {
                pkt.push(15);
                pkt.push(dom.len() as u8);
                pkt.extend_from_slice(dom.as_bytes());
            }
        }

        // Option 255: End + RFC 1542 300-byte minimum BOOTP length
        pkt.push(255);
        if pkt.len() < 300 {
            pkt.resize(300, 0);
        }
        pkt
    }

    #[allow(clippy::too_many_arguments)]
    fn encapsulate_dhcpv4_reply(
        &self,
        eth_src_mac: [u8; 6],
        client_mac: [u8; 6],
        flags: u16,
        ciaddr: Ipv4Addr,
        yiaddr: Ipv4Addr,
        server_ip: Ipv4Addr,
        vlan_tci: Option<u16>,
        dhcp_payload: &[u8],
    ) -> Vec<u8> {
        let broadcast = (flags & 0x8000) != 0 || (ciaddr.is_unspecified() && yiaddr.is_unspecified());
        let (dst_mac, dst_ip) = if broadcast {
            ([0xff; 6], Ipv4Addr::BROADCAST)
        } else if !ciaddr.is_unspecified() {
            (eth_src_mac, ciaddr)
        } else {
            (client_mac, yiaddr)
        };

        let udp = build_udp_ipv4(server_ip, dst_ip, 67, 68, dhcp_payload);
        let ip = build_ipv4_packet(server_ip, dst_ip, IPPROTO_UDP, 64, &udp);
        wrap_ethernet(dst_mac, self.server_mac, ETHERTYPE_IPV4, vlan_tci, &ip)
    }

    fn handle_ipv6_packet(
        &mut self,
        src_mac: [u8; 6],
        vlan_tci: Option<u16>,
        pkt: &[u8],
        now: Instant,
    ) -> Option<Vec<u8>> {
        let ip6 = ParsedIpv6::parse(pkt)?;
        let link_local = self.link_local_ipv6();
        let server_v6 = self.parsed_server_ipv6();

        match ip6.next_header {
            IPPROTO_ICMPV6 if ip6.payload.len() >= 4 => {
                let icmp_type = ip6.payload[0];
                match icmp_type {
                    // ICMPv6 Echo Request (128) -> Echo Reply (129)
                    128 if ip6.payload.len() >= 8 => {
                        let is_ours = ip6.dst == link_local
                            || Some(ip6.dst) == server_v6;
                        if !is_ours {
                            return None;
                        }
                        let mut reply = ip6.payload.to_vec();
                        reply[0] = 129; // Echo Reply
                        reply[2] = 0;
                        reply[3] = 0;
                        let csum = ipv6_upper_checksum(ip6.dst, ip6.src, IPPROTO_ICMPV6, &reply);
                        reply[2..4].copy_from_slice(&csum.to_be_bytes());
                        let out_ip6 = build_ipv6_packet(ip6.dst, ip6.src, IPPROTO_ICMPV6, 64, &reply);
                        Some(wrap_ethernet(src_mac, self.server_mac, ETHERTYPE_IPV6, vlan_tci, &out_ip6))
                    }
                    // ICMPv6 Router Solicitation (133) -> Router Advertisement (134)
                    133 => {
                        let dst_ip = if ip6.src.is_unspecified() {
                            Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 0, 1)
                        } else {
                            ip6.src
                        };
                        let dst_mac = if ip6.src.is_unspecified() {
                            [0x33, 0x33, 0x00, 0x00, 0x00, 0x01]
                        } else {
                            src_mac
                        };
                        let ra = self.build_router_advertisement(link_local, dst_ip)?;
                        let out_ip6 = build_ipv6_packet(link_local, dst_ip, IPPROTO_ICMPV6, 255, &ra);
                        Some(wrap_ethernet(dst_mac, self.server_mac, ETHERTYPE_IPV6, vlan_tci, &out_ip6))
                    }
                    // ICMPv6 Neighbor Solicitation (135) -> Neighbor Advertisement (136)
                    135 if ip6.payload.len() >= 24 => {
                        let target = Ipv6Addr::from(
                            <[u8; 16]>::try_from(&ip6.payload[8..24]).ok()?,
                        );
                        if target != link_local && Some(target) != server_v6 {
                            return None;
                        }
                        let (dst_ip, dst_mac, solicited) = if ip6.src.is_unspecified() {
                            (
                                Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 0, 1),
                                [0x33, 0x33, 0x00, 0x00, 0x00, 0x01],
                                false,
                            )
                        } else {
                            (ip6.src, src_mac, true)
                        };
                        let mut flags_byte = 0x20u8; // Override
                        if solicited {
                            flags_byte |= 0x40; // Solicited
                        }
                        if self.config.advertise_default_route_v6 {
                            flags_byte |= 0x80; // Router
                        }
                        let mut na = Vec::with_capacity(32);
                        na.extend_from_slice(&[136, 0, 0, 0]);
                        na.extend_from_slice(&[flags_byte, 0, 0, 0]);
                        na.extend_from_slice(&target.octets());
                        // Option 2: Target Link-Layer Address (8 bytes)
                        na.extend_from_slice(&[2, 1]);
                        na.extend_from_slice(&self.server_mac);
                        let csum = ipv6_upper_checksum(target, dst_ip, IPPROTO_ICMPV6, &na);
                        na[2..4].copy_from_slice(&csum.to_be_bytes());
                        let out_ip6 = build_ipv6_packet(target, dst_ip, IPPROTO_ICMPV6, 255, &na);
                        Some(wrap_ethernet(dst_mac, self.server_mac, ETHERTYPE_IPV6, vlan_tci, &out_ip6))
                    }
                    _ => None,
                }
            }
            IPPROTO_UDP if ip6.payload.len() >= 8 => {
                let src_port = u16::from_be_bytes([ip6.payload[0], ip6.payload[1]]);
                let dst_port = u16::from_be_bytes([ip6.payload[2], ip6.payload[3]]);
                let udp_len = u16::from_be_bytes([ip6.payload[4], ip6.payload[5]]) as usize;
                if dst_port == 547 && ip6.payload.len() >= udp_len && udp_len >= 8 {
                    let dhcp6_msg = &ip6.payload[8..udp_len];
                    let reply_payload = self.handle_dhcpv6(src_mac, dhcp6_msg, now)?;
                    let out_src = link_local;
                    let out_dst = if ip6.src.is_unspecified() {
                        Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 0, 1)
                    } else {
                        ip6.src
                    };
                    let reply_port = if src_port == 0 { 546 } else { src_port };
                    let udp6 = build_udp_ipv6(out_src, out_dst, 547, reply_port, &reply_payload);
                    let out_ip6 = build_ipv6_packet(out_src, out_dst, IPPROTO_UDP, 64, &udp6);
                    return Some(wrap_ethernet(src_mac, self.server_mac, ETHERTYPE_IPV6, vlan_tci, &out_ip6));
                }
                None
            }
            _ => None,
        }
    }

    fn build_router_advertisement(&self, src_ip: Ipv6Addr, dst_ip: Ipv6Addr) -> Option<Vec<u8>> {
        let server_v6 = self.parsed_server_ipv6()?;
        let prefix_len = self.config.prefix_len_v6.clamp(8, 120);
        let prefix_net = mask_ipv6(server_v6, prefix_len);

        let lease_secs = self.config.lease_time_secs.clamp(120, 604_800);
        let router_lifetime: u16 = if self.config.advertise_default_route_v6 {
            1800
        } else {
            0
        };

        let mut ra = Vec::with_capacity(96);
        ra.push(134); // Type: Router Advertisement
        ra.push(0); // Code
        ra.extend_from_slice(&[0, 0]); // Checksum placeholder
        ra.push(64); // Cur Hop Limit
        // Flags: M=1 (stateful DHCPv6 IA_NA) | O=1 (other config DNS/domain)
        ra.push(0x80 | 0x40);
        ra.extend_from_slice(&router_lifetime.to_be_bytes());
        ra.extend_from_slice(&0u32.to_be_bytes()); // Reachable time
        ra.extend_from_slice(&0u32.to_be_bytes()); // Retrans timer

        // Option 1: Source Link-Layer Address (8 bytes)
        ra.extend_from_slice(&[1, 1]);
        ra.extend_from_slice(&self.server_mac);

        // Option 3: Prefix Information (32 bytes = length 4 in 8-octet units)
        ra.push(3);
        ra.push(4);
        ra.push(prefix_len);
        let pio_flags = 0x80 | if self.config.slaac_enabled { 0x40 } else { 0x00 }; // L=1, A=slaac
        ra.push(pio_flags);
        ra.extend_from_slice(&(lease_secs.saturating_mul(2)).to_be_bytes()); // Valid lifetime
        ra.extend_from_slice(&lease_secs.to_be_bytes()); // Preferred lifetime
        ra.extend_from_slice(&0u32.to_be_bytes()); // Reserved2
        ra.extend_from_slice(&prefix_net.octets());

        // Option 25: Recursive DNS Server (RFC 8106)
        let dns6 = parse_ipv6_list(&self.config.dns_v6);
        if !dns6.is_empty() {
            let opt_len_units = (1 + dns6.len() * 2) as u8;
            ra.push(25);
            ra.push(opt_len_units);
            ra.extend_from_slice(&[0, 0]); // Reserved
            ra.extend_from_slice(&lease_secs.to_be_bytes());
            for d in dns6 {
                ra.extend_from_slice(&d.octets());
            }
        }

        let csum = ipv6_upper_checksum(src_ip, dst_ip, IPPROTO_ICMPV6, &ra);
        ra[2..4].copy_from_slice(&csum.to_be_bytes());
        Some(ra)
    }

    fn server_duid(&self) -> Vec<u8> {
        // DUID-LL: type=3 (u16), hardware_type=1 Ethernet (u16), 6-byte MAC
        let mut d = Vec::with_capacity(10);
        d.extend_from_slice(&3u16.to_be_bytes());
        d.extend_from_slice(&1u16.to_be_bytes());
        d.extend_from_slice(&self.server_mac);
        d
    }

    fn handle_dhcpv6(&mut self, src_mac: [u8; 6], msg: &[u8], now: Instant) -> Option<Vec<u8>> {
        if msg.len() < 4 {
            return None;
        }
        let msg_type = msg[0];
        let xid = &msg[1..4];

        let mut client_duid: Option<Vec<u8>> = None;
        let mut server_duid_opt: Option<Vec<u8>> = None;
        let mut ia_na_iaid: Option<[u8; 4]> = None;
        let mut requested_v6: Option<Ipv6Addr> = None;
        let mut rapid_commit = false;
        let mut hostname: Option<String> = None;

        let mut idx = 4;
        while idx + 4 <= msg.len() {
            let opt_code = u16::from_be_bytes([msg[idx], msg[idx + 1]]);
            let opt_len = u16::from_be_bytes([msg[idx + 2], msg[idx + 3]]) as usize;
            if idx + 4 + opt_len > msg.len() {
                break;
            }
            let val = &msg[idx + 4..idx + 4 + opt_len];
            match opt_code {
                DHCPV6_OPT_CLIENTID if !val.is_empty() && val.len() <= 128 => {
                    client_duid = Some(val.to_vec());
                }
                DHCPV6_OPT_SERVERID => {
                    server_duid_opt = Some(val.to_vec());
                }
                DHCPV6_OPT_IA_NA if val.len() >= 12 => {
                    ia_na_iaid = val[0..4].try_into().ok();
                    let mut sub = 12;
                    while sub + 4 <= val.len() {
                        let scode = u16::from_be_bytes([val[sub], val[sub + 1]]);
                        let slen = u16::from_be_bytes([val[sub + 2], val[sub + 3]]) as usize;
                        if sub + 4 + slen > val.len() {
                            break;
                        }
                        if scode == DHCPV6_OPT_IAADDR && slen >= 24 {
                            if let Ok(octs) = <[u8; 16]>::try_from(&val[sub + 4..sub + 20]) {
                                requested_v6 = Some(Ipv6Addr::from(octs));
                            }
                        }
                        sub += 4 + slen;
                    }
                }
                DHCPV6_OPT_RAPID_COMMIT => {
                    rapid_commit = true;
                }
                DHCPV6_OPT_FQDN if val.len() > 1 => {
                    let clean: String = String::from_utf8_lossy(&val[1..])
                        .chars()
                        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.')
                        .take(63)
                        .collect();
                    if !clean.is_empty() {
                        hostname = Some(clean);
                    }
                }
                _ => {}
            }
            idx += 4 + opt_len;
        }

        self.leases_v6.retain(|_, r| r.expires_at > now);
        let our_duid = self.server_duid();
        let lease_secs = self.config.lease_time_secs.clamp(60, 604_800);
        let ttl = Duration::from_secs(lease_secs as u64);

        match msg_type {
            DHCPV6_INFO_REQUEST => {
                let mut reply = Vec::with_capacity(128);
                reply.push(DHCPV6_REPLY);
                reply.extend_from_slice(xid);
                if let Some(ref cduid) = client_duid {
                    append_dhcp6_opt(&mut reply, DHCPV6_OPT_CLIENTID, cduid);
                }
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_SERVERID, &our_duid);
                self.append_dhcpv6_dns_and_domain(&mut reply);
                Some(reply)
            }
            DHCPV6_SOLICIT => {
                let cduid = client_duid?;
                let iaid = ia_na_iaid.unwrap_or([0, 0, 0, 1]);
                let leased_ip = self.allocate_ipv6(&cduid, requested_v6)?;
                let commit_now = rapid_commit;
                self.leases_v6.insert(
                    cduid.clone(),
                    LeaseV6Record {
                        ip: leased_ip,
                        duid: cduid.clone(),
                        mac: src_mac,
                        hostname,
                        committed: commit_now,
                        expires_at: now + if commit_now { ttl } else { Duration::from_secs(120).max(ttl) },
                    },
                );
                let out_type = if commit_now { DHCPV6_REPLY } else { DHCPV6_ADVERTISE };
                Some(self.build_dhcpv6_ia_message(
                    out_type,
                    xid,
                    &cduid,
                    &our_duid,
                    iaid,
                    leased_ip,
                    lease_secs,
                    commit_now,
                ))
            }
            DHCPV6_REQUEST | DHCPV6_RENEW | DHCPV6_REBIND => {
                if msg_type != DHCPV6_REBIND {
                    if let Some(ref sid) = server_duid_opt {
                        if sid != &our_duid {
                            return None;
                        }
                    }
                }
                let cduid = client_duid?;
                let iaid = ia_na_iaid.unwrap_or([0, 0, 0, 1]);
                let leased_ip = self.allocate_ipv6(&cduid, requested_v6)?;
                let prev_host = self.leases_v6.get(&cduid).and_then(|r| r.hostname.clone());
                self.leases_v6.insert(
                    cduid.clone(),
                    LeaseV6Record {
                        ip: leased_ip,
                        duid: cduid.clone(),
                        mac: src_mac,
                        hostname: hostname.or(prev_host),
                        committed: true,
                        expires_at: now + ttl,
                    },
                );
                Some(self.build_dhcpv6_ia_message(
                    DHCPV6_REPLY,
                    xid,
                    &cduid,
                    &our_duid,
                    iaid,
                    leased_ip,
                    lease_secs,
                    false,
                ))
            }
            DHCPV6_CONFIRM => {
                let cduid = client_duid?;
                let server_v6 = self.parsed_server_ipv6()?;
                let plen = self.config.prefix_len_v6.clamp(8, 120);
                let on_link = requested_v6
                    .map(|req| mask_ipv6(req, plen) == mask_ipv6(server_v6, plen))
                    .unwrap_or(false);
                let mut reply = Vec::with_capacity(96);
                reply.push(DHCPV6_REPLY);
                reply.extend_from_slice(xid);
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_CLIENTID, &cduid);
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_SERVERID, &our_duid);
                let status_code: u16 = if on_link { 0 } else { 4 }; // 0=Success, 4=NotOnLink
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_STATUS_CODE, &status_code.to_be_bytes());
                Some(reply)
            }
            DHCPV6_RELEASE | DHCPV6_DECLINE => {
                let cduid = client_duid?;
                self.leases_v6.remove(&cduid);
                let mut reply = Vec::with_capacity(64);
                reply.push(DHCPV6_REPLY);
                reply.extend_from_slice(xid);
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_CLIENTID, &cduid);
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_SERVERID, &our_duid);
                append_dhcp6_opt(&mut reply, DHCPV6_OPT_STATUS_CODE, &0u16.to_be_bytes());
                Some(reply)
            }
            _ => None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn build_dhcpv6_ia_message(
        &self,
        msg_type: u8,
        xid: &[u8],
        client_duid: &[u8],
        server_duid: &[u8],
        iaid: [u8; 4],
        leased_ip: Ipv6Addr,
        lease_secs: u32,
        include_rapid_commit: bool,
    ) -> Vec<u8> {
        let mut pkt = Vec::with_capacity(180);
        pkt.push(msg_type);
        pkt.extend_from_slice(xid);

        append_dhcp6_opt(&mut pkt, DHCPV6_OPT_CLIENTID, client_duid);
        append_dhcp6_opt(&mut pkt, DHCPV6_OPT_SERVERID, server_duid);

        // IA_NA option (id + T1 + T2 + nested IAADDR)
        let t1 = lease_secs / 2;
        let t2 = (lease_secs.saturating_mul(4)) / 5;
        let mut ia_na = Vec::with_capacity(40);
        ia_na.extend_from_slice(&iaid);
        ia_na.extend_from_slice(&t1.to_be_bytes());
        ia_na.extend_from_slice(&t2.to_be_bytes());

        let mut iaaddr = Vec::with_capacity(24);
        iaaddr.extend_from_slice(&leased_ip.octets());
        iaaddr.extend_from_slice(&lease_secs.to_be_bytes()); // preferred-lifetime
        iaaddr.extend_from_slice(&(lease_secs.saturating_mul(2)).to_be_bytes()); // valid-lifetime
        append_dhcp6_opt(&mut ia_na, DHCPV6_OPT_IAADDR, &iaaddr);
        append_dhcp6_opt(&mut pkt, DHCPV6_OPT_IA_NA, &ia_na);

        if include_rapid_commit {
            append_dhcp6_opt(&mut pkt, DHCPV6_OPT_RAPID_COMMIT, &[]);
        }

        self.append_dhcpv6_dns_and_domain(&mut pkt);
        pkt
    }

    fn append_dhcpv6_dns_and_domain(&self, pkt: &mut Vec<u8>) {
        let dns_v6 = parse_ipv6_list(&self.config.dns_v6);
        if !dns_v6.is_empty() {
            let mut buf = Vec::with_capacity(dns_v6.len() * 16);
            for addr in dns_v6 {
                buf.extend_from_slice(&addr.octets());
            }
            append_dhcp6_opt(pkt, DHCPV6_OPT_DNS_SERVERS, &buf);
        }

        if let Some(encoded_domain) = encode_dns_domain_name(&self.config.domain_name) {
            append_dhcp6_opt(pkt, DHCPV6_OPT_DOMAIN_LIST, &encoded_domain);
        }
    }

    fn parsed_server_ipv4(&self) -> Option<Ipv4Addr> {
        self.config.server_ip_v4.trim().parse().ok()
    }

    fn parsed_gateway_ipv4(&self) -> Option<Ipv4Addr> {
        self.config
            .gateway_v4
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|s| s.parse().ok())
    }

    fn parsed_server_ipv6(&self) -> Option<Ipv6Addr> {
        self.config.server_ip_v6.trim().parse().ok()
    }

    fn parsed_gateway_ipv6(&self) -> Option<Ipv6Addr> {
        self.config
            .gateway_v6
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|s| s.parse().ok())
    }

    fn v4_pool_bounds(&self) -> Option<(u32, u32)> {
        let a: Ipv4Addr = self.config.pool_start_v4.trim().parse().ok()?;
        let b: Ipv4Addr = self.config.pool_end_v4.trim().parse().ok()?;
        let lo = u32::from(a).min(u32::from(b));
        let hi = u32::from(a).max(u32::from(b));
        Some((lo, hi))
    }

    fn is_ipv4_assignable(&self, candidate: Ipv4Addr, client_mac: [u8; 6]) -> bool {
        let Some((lo, hi)) = self.v4_pool_bounds() else {
            return false;
        };
        let c_u32 = u32::from(candidate);
        if c_u32 < lo || c_u32 > hi {
            return false;
        }
        if Some(candidate) == self.parsed_server_ipv4()
            || Some(candidate) == self.parsed_gateway_ipv4()
        {
            return false;
        }
        !self
            .leases_v4
            .values()
            .any(|rec| rec.ip == candidate && rec.mac != client_mac)
    }

    fn allocate_ipv4(
        &self,
        client_mac: [u8; 6],
        requested: Option<Ipv4Addr>,
        _now: Instant,
    ) -> Option<Ipv4Addr> {
        if let Some(existing) = self.leases_v4.get(&client_mac) {
            if self.is_ipv4_assignable(existing.ip, client_mac) {
                return Some(existing.ip);
            }
        }
        if let Some(req) = requested {
            if self.is_ipv4_assignable(req, client_mac) {
                return Some(req);
            }
        }

        let (lo, hi) = self.v4_pool_bounds()?;
        let span = (hi - lo) as u64 + 1;
        let max_probe = span.min(4096);
        let seed = ((client_mac[2] as u64) << 24)
            | ((client_mac[3] as u64) << 16)
            | ((client_mac[4] as u64) << 8)
            | (client_mac[5] as u64);

        for i in 0..max_probe {
            let cand = Ipv4Addr::from(lo + ((seed + i) % span) as u32);
            if self.is_ipv4_assignable(cand, client_mac) {
                return Some(cand);
            }
        }
        None
    }

    fn v6_pool_bounds(&self) -> Option<(u128, u128)> {
        let a: Ipv6Addr = self.config.pool_start_v6.trim().parse().ok()?;
        let b: Ipv6Addr = self.config.pool_end_v6.trim().parse().ok()?;
        let lo = u128::from(a).min(u128::from(b));
        let hi = u128::from(a).max(u128::from(b));
        Some((lo, hi))
    }

    fn is_ipv6_assignable(&self, candidate: Ipv6Addr, client_duid: &[u8]) -> bool {
        let Some((lo, hi)) = self.v6_pool_bounds() else {
            return false;
        };
        let c = u128::from(candidate);
        if c < lo || c > hi {
            return false;
        }
        if Some(candidate) == self.parsed_server_ipv6()
            || Some(candidate) == self.parsed_gateway_ipv6()
        {
            return false;
        }
        !self
            .leases_v6
            .values()
            .any(|rec| rec.ip == candidate && rec.duid.as_slice() != client_duid)
    }

    fn allocate_ipv6(&self, client_duid: &[u8], requested: Option<Ipv6Addr>) -> Option<Ipv6Addr> {
        if let Some(existing) = self.leases_v6.get(client_duid) {
            if self.is_ipv6_assignable(existing.ip, client_duid) {
                return Some(existing.ip);
            }
        }
        if let Some(req) = requested {
            if self.is_ipv6_assignable(req, client_duid) {
                return Some(req);
            }
        }

        let (lo, hi) = self.v6_pool_bounds()?;
        let span = hi.saturating_sub(lo).saturating_add(1).min(65535);
        let mut hash: u128 = 0xcbf2_9ce4_8422_2325;
        for &b in client_duid {
            hash ^= b as u128;
            hash = hash.wrapping_mul(0x1000_0000_01b3);
        }
        let max_probe = span.min(4096);
        for i in 0..max_probe {
            let cand = Ipv6Addr::from(lo + ((hash + i) % span));
            if self.is_ipv6_assignable(cand, client_duid) {
                return Some(cand);
            }
        }
        None
    }
}

// =============================================================================
// Shared L2 / L3 / L4 Packet & Checksum Primitives (used by DHCP & NAT Gateway)
// =============================================================================

pub(crate) fn deterministic_appliance_mac(prefix_byte: u8, id: &str) -> [u8; 6] {
    let mut h: u32 = 2166136261;
    for b in id.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    [
        0x52,
        0x54,
        0x00,
        prefix_byte,
        ((h >> 8) & 0xff) as u8,
        (h & 0xff) as u8,
    ]
}

pub(crate) fn mac_to_link_local_ipv6(mac: [u8; 6]) -> Ipv6Addr {
    Ipv6Addr::new(
        0xfe80,
        0,
        0,
        0,
        (((mac[0] ^ 0x02) as u16) << 8) | (mac[1] as u16),
        ((mac[2] as u16) << 8) | 0x00ff,
        0xfe00 | (mac[3] as u16),
        ((mac[4] as u16) << 8) | (mac[5] as u16),
    )
}

pub(crate) fn mask_ipv6(addr: Ipv6Addr, prefix_len: u8) -> Ipv6Addr {
    if prefix_len == 0 {
        return Ipv6Addr::UNSPECIFIED;
    }
    if prefix_len >= 128 {
        return addr;
    }
    let mask = !0u128 << (128 - prefix_len);
    Ipv6Addr::from(u128::from(addr) & mask)
}

pub(crate) fn parse_ethertype_and_vlan(frame: &[u8]) -> (u16, usize, Option<u16>) {
    if frame.len() < 14 {
        return (0, 14, None);
    }
    let outer = u16::from_be_bytes([frame[12], frame[13]]);
    if (outer == 0x8100 || outer == 0x88a8) && frame.len() >= 18 {
        let tci = u16::from_be_bytes([frame[14], frame[15]]);
        let inner = u16::from_be_bytes([frame[16], frame[17]]);
        (inner, 18, Some(tci))
    } else {
        (outer, 14, None)
    }
}

pub(crate) fn wrap_ethernet(
    dst_mac: [u8; 6],
    src_mac: [u8; 6],
    ethertype: u16,
    vlan_tci: Option<u16>,
    payload: &[u8],
) -> Vec<u8> {
    let hdr_len = if vlan_tci.is_some() { 18 } else { 14 };
    let mut out = Vec::with_capacity(hdr_len + payload.len());
    out.extend_from_slice(&dst_mac);
    out.extend_from_slice(&src_mac);
    if let Some(tci) = vlan_tci {
        out.extend_from_slice(&0x8100u16.to_be_bytes());
        out.extend_from_slice(&tci.to_be_bytes());
    }
    out.extend_from_slice(&ethertype.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

pub(crate) fn handle_arp_request(
    arp: &[u8],
    our_ip: Ipv4Addr,
    our_mac: [u8; 6],
) -> Option<Vec<u8>> {
    if arp.len() < 28 {
        return None;
    }
    let htype = u16::from_be_bytes([arp[0], arp[1]]);
    let ptype = u16::from_be_bytes([arp[2], arp[3]]);
    let hlen = arp[4];
    let plen = arp[5];
    let oper = u16::from_be_bytes([arp[6], arp[7]]);
    if htype != 1 || ptype != ETHERTYPE_IPV4 || hlen != 6 || plen != 4 || oper != 1 {
        return None;
    }
    let sha: [u8; 6] = arp[8..14].try_into().ok()?;
    let spa: [u8; 4] = arp[14..18].try_into().ok()?;
    let tpa = Ipv4Addr::new(arp[24], arp[25], arp[26], arp[27]);
    if tpa != our_ip {
        return None;
    }

    let mut reply = Vec::with_capacity(28);
    reply.extend_from_slice(&1u16.to_be_bytes()); // Ethernet
    reply.extend_from_slice(&ETHERTYPE_IPV4.to_be_bytes()); // IPv4
    reply.extend_from_slice(&[6, 4]);
    reply.extend_from_slice(&2u16.to_be_bytes()); // ARP Reply
    reply.extend_from_slice(&our_mac);
    reply.extend_from_slice(&our_ip.octets());
    reply.extend_from_slice(&sha);
    reply.extend_from_slice(&spa);
    Some(reply)
}

#[allow(dead_code)]
pub(crate) struct ParsedIpv4<'a> {
    pub src: Ipv4Addr,
    pub dst: Ipv4Addr,
    pub proto: u8,
    pub ttl: u8,
    pub payload: &'a [u8],
}

impl<'a> ParsedIpv4<'a> {
    pub fn parse(pkt: &'a [u8]) -> Option<Self> {
        if pkt.len() < 20 || (pkt[0] >> 4) != 4 {
            return None;
        }
        let ihl = ((pkt[0] & 0x0f) as usize) * 4;
        let total_len = u16::from_be_bytes([pkt[2], pkt[3]]) as usize;
        if ihl < 20 || total_len < ihl || pkt.len() < total_len {
            return None;
        }
        // Drop non-first or fragmented IP packets only if fragment offset != 0
        let frag_field = u16::from_be_bytes([pkt[6], pkt[7]]);
        if (frag_field & 0x1fff) != 0 {
            return None;
        }
        Some(Self {
            src: Ipv4Addr::new(pkt[12], pkt[13], pkt[14], pkt[15]),
            dst: Ipv4Addr::new(pkt[16], pkt[17], pkt[18], pkt[19]),
            proto: pkt[9],
            ttl: pkt[8],
            payload: &pkt[ihl..total_len],
        })
    }
}

#[allow(dead_code)]
pub(crate) struct ParsedIpv6<'a> {
    pub src: Ipv6Addr,
    pub dst: Ipv6Addr,
    pub next_header: u8,
    pub hop_limit: u8,
    pub payload: &'a [u8],
}

impl<'a> ParsedIpv6<'a> {
    pub fn parse(pkt: &'a [u8]) -> Option<Self> {
        if pkt.len() < 40 || (pkt[0] >> 4) != 6 {
            return None;
        }
        let payload_len = u16::from_be_bytes([pkt[4], pkt[5]]) as usize;
        if pkt.len() < 40 + payload_len {
            return None;
        }
        let src = Ipv6Addr::from(<[u8; 16]>::try_from(&pkt[8..24]).ok()?);
        let dst = Ipv6Addr::from(<[u8; 16]>::try_from(&pkt[24..40]).ok()?);
        let mut next_header = pkt[6];
        let hop_limit = pkt[7];
        let mut offset = 40usize;
        let end = 40 + payload_len;

        // Skip standard Hop-by-Hop (0), Routing (43), Destination Options (60) extension headers
        while matches!(next_header, 0 | 43 | 60) && offset + 8 <= end {
            let ext_next = pkt[offset];
            let ext_len = (pkt[offset + 1] as usize + 1) * 8;
            if offset + ext_len > end {
                return None;
            }
            next_header = ext_next;
            offset += ext_len;
        }

        Some(Self {
            src,
            dst,
            next_header,
            hop_limit,
            payload: &pkt[offset..end],
        })
    }
}

pub(crate) fn internet_checksum(data: &[u8]) -> u16 {
    checksum_finalize(checksum_add_slice(0, data))
}

pub(crate) fn checksum_add_slice(mut sum: u32, data: &[u8]) -> u32 {
    let mut chunks = data.chunks_exact(2);
    for chunk in &mut chunks {
        sum += u16::from_be_bytes([chunk[0], chunk[1]]) as u32;
    }
    if let Some(&rem) = chunks.remainder().first() {
        sum += (rem as u32) << 8;
    }
    sum
}

pub(crate) fn checksum_finalize(mut sum: u32) -> u16 {
    while (sum >> 16) != 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

pub(crate) fn ipv4_upper_checksum(
    src: Ipv4Addr,
    dst: Ipv4Addr,
    proto: u8,
    segment: &[u8],
) -> u16 {
    let mut sum = 0u32;
    sum = checksum_add_slice(sum, &src.octets());
    sum = checksum_add_slice(sum, &dst.octets());
    sum += proto as u32;
    sum += segment.len() as u32;
    sum = checksum_add_slice(sum, segment);
    checksum_finalize(sum)
}

pub(crate) fn ipv6_upper_checksum(
    src: Ipv6Addr,
    dst: Ipv6Addr,
    next_header: u8,
    segment: &[u8],
) -> u16 {
    let mut sum = 0u32;
    sum = checksum_add_slice(sum, &src.octets());
    sum = checksum_add_slice(sum, &dst.octets());
    let len = segment.len() as u32;
    sum += (len >> 16) & 0xffff;
    sum += len & 0xffff;
    sum += next_header as u32;
    sum = checksum_add_slice(sum, segment);
    checksum_finalize(sum)
}

pub(crate) fn build_ipv4_packet(
    src: Ipv4Addr,
    dst: Ipv4Addr,
    proto: u8,
    ttl: u8,
    payload: &[u8],
) -> Vec<u8> {
    let total_len = (20 + payload.len()) as u16;
    let mut hdr = [0u8; 20];
    hdr[0] = 0x45; // IPv4, IHL = 5
    hdr[2..4].copy_from_slice(&total_len.to_be_bytes());
    let id = fastrand::u16(..);
    hdr[4..6].copy_from_slice(&id.to_be_bytes());
    hdr[6..8].copy_from_slice(&0x4000u16.to_be_bytes()); // Don't Fragment
    hdr[8] = ttl;
    hdr[9] = proto;
    hdr[12..16].copy_from_slice(&src.octets());
    hdr[16..20].copy_from_slice(&dst.octets());
    let csum = internet_checksum(&hdr);
    hdr[10..12].copy_from_slice(&csum.to_be_bytes());

    let mut out = Vec::with_capacity(20 + payload.len());
    out.extend_from_slice(&hdr);
    out.extend_from_slice(payload);
    out
}

pub(crate) fn build_ipv6_packet(
    src: Ipv6Addr,
    dst: Ipv6Addr,
    next_header: u8,
    hop_limit: u8,
    payload: &[u8],
) -> Vec<u8> {
    let plen = payload.len() as u16;
    let mut out = Vec::with_capacity(40 + payload.len());
    out.extend_from_slice(&[0x60, 0x00, 0x00, 0x00]);
    out.extend_from_slice(&plen.to_be_bytes());
    out.push(next_header);
    out.push(hop_limit);
    out.extend_from_slice(&src.octets());
    out.extend_from_slice(&dst.octets());
    out.extend_from_slice(payload);
    out
}

pub(crate) fn build_udp_ipv4(
    src_ip: Ipv4Addr,
    dst_ip: Ipv4Addr,
    src_port: u16,
    dst_port: u16,
    payload: &[u8],
) -> Vec<u8> {
    let udp_len = (8 + payload.len()) as u16;
    let mut udp = Vec::with_capacity(8 + payload.len());
    udp.extend_from_slice(&src_port.to_be_bytes());
    udp.extend_from_slice(&dst_port.to_be_bytes());
    udp.extend_from_slice(&udp_len.to_be_bytes());
    udp.extend_from_slice(&[0, 0]);
    udp.extend_from_slice(payload);
    let csum = ipv4_upper_checksum(src_ip, dst_ip, IPPROTO_UDP, &udp);
    let csum = if csum == 0 { 0xffff } else { csum };
    udp[6..8].copy_from_slice(&csum.to_be_bytes());
    udp
}

pub(crate) fn build_udp_ipv6(
    src_ip: Ipv6Addr,
    dst_ip: Ipv6Addr,
    src_port: u16,
    dst_port: u16,
    payload: &[u8],
) -> Vec<u8> {
    let udp_len = (8 + payload.len()) as u16;
    let mut udp = Vec::with_capacity(8 + payload.len());
    udp.extend_from_slice(&src_port.to_be_bytes());
    udp.extend_from_slice(&dst_port.to_be_bytes());
    udp.extend_from_slice(&udp_len.to_be_bytes());
    udp.extend_from_slice(&[0, 0]);
    udp.extend_from_slice(payload);
    let csum = ipv6_upper_checksum(src_ip, dst_ip, IPPROTO_UDP, &udp);
    let csum = if csum == 0 { 0xffff } else { csum };
    udp[6..8].copy_from_slice(&csum.to_be_bytes());
    udp
}

fn append_dhcp6_opt(buf: &mut Vec<u8>, code: u16, data: &[u8]) {
    buf.extend_from_slice(&code.to_be_bytes());
    buf.extend_from_slice(&(data.len() as u16).to_be_bytes());
    buf.extend_from_slice(data);
}

fn encode_dns_domain_name(domain: &str) -> Option<Vec<u8>> {
    let clean = domain.trim().trim_matches('.');
    if clean.is_empty() {
        return None;
    }
    let mut out = Vec::with_capacity(clean.len() + 2);
    for label in clean.split('.') {
        if label.is_empty() || label.len() > 63 {
            return None;
        }
        out.push(label.len() as u8);
        out.extend_from_slice(label.as_bytes());
    }
    out.push(0);
    Some(out)
}

pub(crate) fn parse_ipv4_list(raw: &str) -> Vec<Ipv4Addr> {
    raw.split(|c: char| c == ',' || c.is_whitespace() || c == ';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<Ipv4Addr>().ok())
        .collect()
}

pub(crate) fn parse_ipv6_list(raw: &str) -> Vec<Ipv6Addr> {
    raw.split(|c: char| c == ',' || c.is_whitespace() || c == ';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<Ipv6Addr>().ok())
        .collect()
}

pub(crate) fn format_mac(mac: [u8; 6]) -> String {
    format!(
        "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    )
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_dhcpv4_client_frame(
        client_mac: [u8; 6],
        msg_type: u8,
        requested_ip: Option<Ipv4Addr>,
        server_id: Option<Ipv4Addr>,
    ) -> Vec<u8> {
        let mut bootp = vec![0u8; 240];
        bootp[0] = 1; // BOOTREQUEST
        bootp[1] = 1;
        bootp[2] = 6;
        bootp[4..8].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        bootp[10..12].copy_from_slice(&0x8000u16.to_be_bytes());
        bootp[28..34].copy_from_slice(&client_mac);
        bootp[236..240].copy_from_slice(&DHCP_MAGIC_COOKIE);
        bootp.extend_from_slice(&[53, 1, msg_type]);
        bootp.extend_from_slice(&[12, 7]);
        bootp.extend_from_slice(b"alpine1");
        if let Some(req) = requested_ip {
            bootp.extend_from_slice(&[50, 4]);
            bootp.extend_from_slice(&req.octets());
        }
        if let Some(sid) = server_id {
            bootp.extend_from_slice(&[54, 4]);
            bootp.extend_from_slice(&sid.octets());
        }
        bootp.push(255);

        let udp = build_udp_ipv4(Ipv4Addr::UNSPECIFIED, Ipv4Addr::BROADCAST, 68, 67, &bootp);
        let ip = build_ipv4_packet(Ipv4Addr::UNSPECIFIED, Ipv4Addr::BROADCAST, IPPROTO_UDP, 64, &udp);
        wrap_ethernet([0xff; 6], client_mac, ETHERTYPE_IPV4, None, &ip)
    }

    #[test]
    fn dhcpv4_full_dora_handshake_arp_and_lease_snapshot() {
        let mut srv = DhcpServerCore::new(
            "dhcp1".into(),
            "Lab DHCP".into(),
            vec!["dhcp1-p0".into()],
            DhcpServerConfig::default(),
        );
        let now = Instant::now();
        let client_mac = [0x52, 0x54, 0x00, 0xaa, 0xbb, 0x01];

        // 1. ARP Who-Has 10.0.10.2
        let mut arp_req = Vec::new();
        arp_req.extend_from_slice(&1u16.to_be_bytes());
        arp_req.extend_from_slice(&ETHERTYPE_IPV4.to_be_bytes());
        arp_req.extend_from_slice(&[6, 4, 0, 1]);
        arp_req.extend_from_slice(&client_mac);
        arp_req.extend_from_slice(&[10, 0, 10, 50]);
        arp_req.extend_from_slice(&[0; 6]);
        arp_req.extend_from_slice(&[10, 0, 10, 2]);
        let arp_frame = wrap_ethernet([0xff; 6], client_mac, ETHERTYPE_ARP, None, &arp_req);
        let arp_out = srv.process_frame("dhcp1-p0", &arp_frame, now);
        assert_eq!(arp_out.len(), 1);
        assert_eq!(u16::from_be_bytes([arp_out[0].1[20], arp_out[0].1[21]]), 2); // ARP Reply

        // 2. DHCPDISCOVER -> DHCPOFFER
        let disc = build_dhcpv4_client_frame(client_mac, DHCPDISCOVER, None, None);
        let offer_out = srv.process_frame("dhcp1-p0", &disc, now);
        assert_eq!(offer_out.len(), 1);
        let offer_ip = ParsedIpv4::parse(&offer_out[0].1[14..]).unwrap();
        let offer_bootp = &offer_ip.payload[8..];
        let yiaddr = Ipv4Addr::new(
            offer_bootp[16],
            offer_bootp[17],
            offer_bootp[18],
            offer_bootp[19],
        );
        assert!(
            u32::from(yiaddr) >= u32::from(Ipv4Addr::new(10, 0, 10, 100))
                && u32::from(yiaddr) <= u32::from(Ipv4Addr::new(10, 0, 10, 200)),
            "unexpected offered IP: {yiaddr}"
        );

        // 3. DHCPREQUEST -> DHCPACK
        let req = build_dhcpv4_client_frame(
            client_mac,
            DHCPREQUEST,
            Some(yiaddr),
            Some(Ipv4Addr::new(10, 0, 10, 2)),
        );
        let ack_out = srv.process_frame("dhcp1-p0", &req, now + Duration::from_secs(1));
        assert_eq!(ack_out.len(), 1);
        let ack_ip = ParsedIpv4::parse(&ack_out[0].1[14..]).unwrap();
        let ack_bootp = &ack_ip.payload[8..];
        assert_eq!(ack_bootp[242], DHCPACK);

        let leases = srv.snapshot_leases(now + Duration::from_secs(2));
        assert_eq!(leases.len(), 1);
        assert_eq!(leases[0].family, "ipv4");
        assert_eq!(leases[0].ip, yiaddr.to_string());
        assert_eq!(leases[0].hostname.as_deref(), Some("alpine1"));
        assert_eq!(leases[0].state, "leased");
    }

    #[test]
    fn icmpv6_router_advertisement_and_stateful_dhcpv6_sarr_handshake() {
        let mut srv = DhcpServerCore::new(
            "dhcp6-1".into(),
            "Dual-Stack DHCP".into(),
            vec!["dhcp6-1-p0".into()],
            DhcpServerConfig::default(),
        );
        let now = Instant::now();
        let client_mac = [0x52, 0x54, 0x00, 0xcc, 0xdd, 0x02];
        let client_ll = mac_to_link_local_ipv6(client_mac);
        let all_routers = Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 0, 2);

        // 1. ICMPv6 Router Solicitation (133) -> Router Advertisement (134) from link-local!
        let mut rs = vec![133u8, 0, 0, 0, 0, 0, 0, 0];
        let csum = ipv6_upper_checksum(client_ll, all_routers, IPPROTO_ICMPV6, &rs);
        rs[2..4].copy_from_slice(&csum.to_be_bytes());
        let rs_ip6 = build_ipv6_packet(client_ll, all_routers, IPPROTO_ICMPV6, 255, &rs);
        let rs_eth = wrap_ethernet(
            [0x33, 0x33, 0x00, 0x00, 0x00, 0x02],
            client_mac,
            ETHERTYPE_IPV6,
            None,
            &rs_ip6,
        );
        let ra_out = srv.process_frame("dhcp6-1-p0", &rs_eth, now);
        assert_eq!(ra_out.len(), 1);
        let parsed_ra = ParsedIpv6::parse(&ra_out[0].1[14..]).unwrap();
        assert_eq!(parsed_ra.src, srv.link_local_ipv6());
        assert_eq!(parsed_ra.hop_limit, 255);
        assert_eq!(parsed_ra.payload[0], 134); // Router Advertisement

        // 2. Stateful DHCPv6 SOLICIT -> ADVERTISE -> REQUEST -> REPLY
        let all_dhcp_servers = Ipv6Addr::new(0xff02, 0, 0, 0, 0, 0, 1, 2);
        let client_duid = [0, 3, 0, 1, 0x52, 0x54, 0x00, 0xcc, 0xdd, 0x02];
        let mut solicit = vec![DHCPV6_SOLICIT, 0x11, 0x22, 0x33];
        append_dhcp6_opt(&mut solicit, DHCPV6_OPT_CLIENTID, &client_duid);
        append_dhcp6_opt(&mut solicit, DHCPV6_OPT_IA_NA, &[0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);

        let sol_udp = build_udp_ipv6(client_ll, all_dhcp_servers, 546, 547, &solicit);
        let sol_ip6 = build_ipv6_packet(client_ll, all_dhcp_servers, IPPROTO_UDP, 64, &sol_udp);
        let sol_eth = wrap_ethernet(
            [0x33, 0x33, 0x00, 0x01, 0x00, 0x02],
            client_mac,
            ETHERTYPE_IPV6,
            None,
            &sol_ip6,
        );
        let adv_out = srv.process_frame("dhcp6-1-p0", &sol_eth, now);
        assert_eq!(adv_out.len(), 1);
        let adv_ip6 = ParsedIpv6::parse(&adv_out[0].1[14..]).unwrap();
        let adv_dhcp = &adv_ip6.payload[8..];
        assert_eq!(adv_dhcp[0], DHCPV6_ADVERTISE);

        // Rapid-commit or REQUEST -> REPLY
        let mut req6 = vec![DHCPV6_REQUEST, 0x11, 0x22, 0x34];
        append_dhcp6_opt(&mut req6, DHCPV6_OPT_CLIENTID, &client_duid);
        append_dhcp6_opt(&mut req6, DHCPV6_OPT_SERVERID, &srv.server_duid());
        append_dhcp6_opt(&mut req6, DHCPV6_OPT_IA_NA, &[0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
        let req_udp = build_udp_ipv6(client_ll, all_dhcp_servers, 546, 547, &req6);
        let req_ip6 = build_ipv6_packet(client_ll, all_dhcp_servers, IPPROTO_UDP, 64, &req_udp);
        let req_eth = wrap_ethernet(
            [0x33, 0x33, 0x00, 0x01, 0x00, 0x02],
            client_mac,
            ETHERTYPE_IPV6,
            None,
            &req_ip6,
        );
        let rep_out = srv.process_frame("dhcp6-1-p0", &req_eth, now + Duration::from_secs(1));
        assert_eq!(rep_out.len(), 1);
        let rep_ip6 = ParsedIpv6::parse(&rep_out[0].1[14..]).unwrap();
        assert_eq!(rep_ip6.payload[8], DHCPV6_REPLY);

        let leases = srv.snapshot_leases(now + Duration::from_secs(2));
        assert_eq!(leases.len(), 1);
        assert_eq!(leases[0].family, "ipv6");
        assert!(leases[0].ip.starts_with("fd00:10::"));
        assert_eq!(leases[0].state, "leased");
    }
}
