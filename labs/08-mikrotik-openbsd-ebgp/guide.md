# Lab 08 — Multi-Vendor eBGP Peering & Failover: MikroTik CHR v7 ↔ OpenBSD (`OpenBGPD`)

The **Border Gateway Protocol (`BGP-4`, RFC 4271)** glues the global Internet together over standard **`TCP` port `179`**. Modern BGP implementations—including **MikroTik RouterOS v7** and **OpenBSD `OpenBGPD`**—strictly enforce **RFC 8212**: *by default, an eBGP speaker neither advertises nor accepts any prefixes until explicit import and export routing filters are configured!*

In this multi-vendor lab, you will peer **AS 65001 (`MikroTik CHR v7`)** with **AS 65002 (`OpenBSD`)** across redundant `/30` links, dissect the `TCP/179` `OPEN`, `UPDATE`, and `KEEPALIVE` state machine in **`tcpflowy`**, and trigger live BGP reconvergence by **cutting the primary fiber** on the canvas.

```diagram
        AS 65001 (MikroTik CHR v7)                eBGP Peering (TCP/179)               AS 65002 (OpenBSD OpenBGPD)
 ┌─────────────┐       ┌────────────────┐    Primary: 172.16.0.0/30 (LP 200)   ┌────────────────┐       ┌─────────────┐
 │    lan-a    │─eth0─▶│ether2    ether1│═════════════════════════════════════▶│vio0        vio1│─eth0─▶│    lan-b    │
 │192.168.101.x│       │  chr-as65001   │                                      │  obsd-as65002  │       │192.168.202.x│
 └─────────────┘       │         ether3 │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶│vio2            │       └─────────────┘
                       └────────────────┘    Backup:  172.16.1.0/30 (LP 100)   └────────────────┘
```

---

## Step 1: Bring Up Transit (`/30`) & Customer LAN (`/24`) Interfaces

Boot all four VMs (**Start All**). On **`chr-as65001`**, log in as `admin` (empty password on first boot; press `n` if prompted to read the license, and set a lab password when asked).

1. **Configure MikroTik CHR v7 (`chr-as65001`)** *(note RouterOS uses **1-indexed** `ether1`, `ether2`, `ether3`)*:

```routeros node=node-chr-as65001 title="Configure transit & LAN IPs on MikroTik CHR v7 (AS 65001)"
/system/identity set name=chr-as65001
/ip/dhcp-client remove [find]
/ip/address add address=172.16.0.1/30 interface=ether1 comment="Primary eBGP to AS65002"
/ip/address add address=192.168.101.1/24 interface=ether2 comment="AS65001 Customer LAN"
/ip/address add address=172.16.1.1/30 interface=ether3 comment="Backup eBGP to AS65002"
/ip/address print
```

2. **Configure OpenBSD (`obsd-as65002`)** interfaces (`vio0`, `vio1`, `vio2`) and IPv4 packet forwarding:

```sh node=node-obsd-as65002 title="Configure vio0..vio2 + IPv4 forwarding on OpenBSD (AS 65002)"
ifconfig vio0 inet 172.16.0.2 netmask 255.255.255.252 description "Primary eBGP to AS65001" up
ifconfig vio1 inet 192.168.202.1 netmask 255.255.255.0 description "AS65002 Customer LAN" up
ifconfig vio2 inet 172.16.1.2 netmask 255.255.255.252 description "Backup eBGP to AS65001" up
sysctl net.inet.ip.forwarding=1
ping -c 1 172.16.0.1 && ping -c 1 172.16.1.1
```

3. **Configure Customer LAN Hosts** (`lan-a` in `192.168.101.0/24` and `lan-b` in `192.168.202.0/24`—with **no static routes** between the two Autonomous Systems!):

```sh node=node-lan-a title="Configure lan-a (192.168.101.10/24, default gw 192.168.101.1)"
ip addr flush dev eth0
ip addr add 192.168.101.10/24 dev eth0
ip link set eth0 up
ip route replace default via 192.168.101.1
```

```sh node=node-lan-b title="Configure lan-b (192.168.202.10/24, default gw 192.168.202.1)"
ip addr flush dev eth0
ip addr add 192.168.202.10/24 dev eth0
ip link set eth0 up
ip route replace default via 192.168.202.1
```

- [ ] Brought up `172.16.0.0/30`, `172.16.1.0/30`, and both customer `/24` LANs (`lan-a` cannot reach `lan-b` yet!).

---

## Step 2: Start Capture on `link-ebgp-primary` *Before* Starting BGP

1. Click **`link-ebgp-primary`** (`chr-as65001:ether1 ── obsd-as65002:vio0`) and start **Record `.pcap`** (plus **Live Wireshark** with display filter `bgp || tcp.port == 179`).
2. Starting the wiretap *before* enabling BGP ensures we record the initial `TCP/179` `SYN` handshake, capability negotiation (`OPEN`), initial RIB convergence (`UPDATE`), and `KEEPALIVE` timers!

- [ ] Armed `.pcap` recording on `link-ebgp-primary` prior to BGP session establishment.

---

## Step 3: Configure RouterOS v7 BGP & OpenBSD `/etc/bgpd.conf` (RFC 8212!)

1. **On MikroTik CHR v7 (`chr-as65001`)**, use **authentic RouterOS v7** syntax (`/ip/firewall/address-list` for originated networks, `/routing/filter/rule` for explicit RFC 8212 policy + `LOCAL_PREF` / `AS_PATH` engineering, and `/routing/bgp/connection` with `local.role=ebgp` and `15s` hold timer):

```routeros node=node-chr-as65001 title="Configure RouterOS v7 eBGP + RFC 8212 filters on chr-as65001"
/ip/firewall/address-list add list=bgp-networks address=192.168.101.0/24

/routing/filter/rule add chain=ebgp-in-pri rule="if (dst == 192.168.202.0/24) { set bgp-local-pref 200; accept; }"
/routing/filter/rule add chain=ebgp-out-pri rule="if (dst == 192.168.101.0/24) { accept; }"

/routing/filter/rule add chain=ebgp-in-bak rule="if (dst == 192.168.202.0/24) { set bgp-local-pref 100; accept; }"
/routing/filter/rule add chain=ebgp-out-bak rule="if (dst == 192.168.101.0/24) { set bgp-path-prepend 2; accept; }"

/routing/bgp/connection add name=to-openbsd-pri as=65001 router-id=172.16.0.1 \
    local.address=172.16.0.1 local.role=ebgp \
    remote.address=172.16.0.2 remote.as=65002 \
    output.network=bgp-networks input.filter=ebgp-in-pri output.filter=ebgp-out-pri \
    hold-time=15s keepalive-time=5s

/routing/bgp/connection add name=to-openbsd-bak as=65001 router-id=172.16.0.1 \
    local.address=172.16.1.1 local.role=ebgp \
    remote.address=172.16.1.2 remote.as=65002 \
    output.network=bgp-networks input.filter=ebgp-in-bak output.filter=ebgp-out-bak \
    hold-time=15s keepalive-time=5s
```

2. **On OpenBSD (`obsd-as65002`)**, write `/etc/bgpd.conf` with strict `0600` permissions (`OpenBGPD` refuses world-readable config files!) and explicit **RFC 8212** `allow from ebgp` / `allow to ebgp` policy, validate with `bgpd -nv`, and start `bgpd`:

```sh node=node-obsd-as65002 title="Write /etc/bgpd.conf (RFC 8212 policy) & start OpenBGPD on obsd-as65002"
cat << 'EOF' > /etc/bgpd.conf
AS 65002
router-id 172.16.0.2
holdtime 15

# Originate AS 65002 customer prefix
network 192.168.202.0/24

neighbor 172.16.0.1 {
	remote-as 65001
	descr "MikroTik-CHR-Primary"
	set localpref 200
}

neighbor 172.16.1.1 {
	remote-as 65001
	descr "MikroTik-CHR-Backup"
	set localpref 100
	set prepend-self 2
}

# RFC 8212 Explicit External BGP Import & Export Policy
allow from ebgp prefix 192.168.101.0/24
allow to ebgp prefix 192.168.202.0/24
EOF
chmod 0600 /etc/bgpd.conf
bgpd -nv -f /etc/bgpd.conf
rcctl -f start bgpd
sleep 3
bgpctl show summary
bgpctl show rib
```

3. Verify the established sessions on MikroTik CHR v7 and test end-to-end reachability between `lan-a` and `lan-b`:

```routeros node=node-chr-as65001 title="Verify Established BGP sessions & learned RIB on MikroTik CHR v7"
/routing/bgp/session print
/ip/route print where bgp
```

```sh node=node-lan-a title="Verify inter-AS reachability & traceroute from lan-a -> lan-b"
ping -c 2 192.168.202.10
traceroute -n -m 5 192.168.202.10
```

<details>
<summary>Under the Hood: Why did BGP sessions stay at 0 prefixes before RFC 8212 filters?</summary>

Historically, misconfigured edge routers accidentally leaked full BGP tables ("route leaks"), taking down major portions of the Internet. **RFC 8212** (*Default External BGP Route Propagation Behavior without Policies*) mandates that eBGP speakers treat missing import/export policies as **`deny all`**. Both OpenBSD `OpenBGPD` (since OpenBSD 6.4) and MikroTik **RouterOS v7** implement RFC 8212 natively—even when `TCP/179` reaches `Established`, `0` NLRIs are exchanged unless explicit `allow` / `accept` rules exist!
</details>

- [ ] Established primary & backup eBGP sessions (`Established`), exchanged `/24` NLRIs, and verified `lan-a ↔ lan-b` routing.

---

## Step 4: Dissect BGP over `TCP/179` in `tcpflowy` & Cut Primary Cable!

1. Let the session send 1–2 periodic heartbeats (`5s` keepalive interval), then click **Stop & Dissect with tcpflowy** on **`link-ebgp-primary`**:
   - Select the **`TCP :179`** flow in **`tcpflowy`**:
     - **3-Way Handshake**: Active BGP speaker opens `TCP/179` (`SYN → SYN,ACK → ACK`).
     - **`PSH, ACK` — BGP `OPEN` (Type 1)**: Inspect the `0xff..ff` 16-byte marker, version `4`, My AS (`65001` / `65002`), Hold Time (`15s`), BGP Identifier (`172.16.0.1` / `172.16.0.2`), and Multiprotocol / 4-byte ASN capabilities (`RFC 6793`).
     - **`PSH, ACK` — BGP `KEEPALIVE` (Type 4)**: Exact **19-byte** BGP payload confirming `OPEN` parameters (`OpenConfirm → Established`), then repeating every `5` seconds like clockwork!
     - **`PSH, ACK` — BGP `UPDATE` (Type 2)**: Carries Path Attributes (`ORIGIN: IGP`, `AS_PATH: 65001` or `65002`, `NEXT_HOP: 172.16.0.x`) and the `NLRI` (`192.168.101.0/24` and `192.168.202.0/24`).
2. **Test Live Fiber-Cut Failover**:
   - Start a continuous 1-packet-per-second ping on `lan-a`:

```sh node=node-lan-a title="Run continuous inter-AS ping during primary fiber cut"
ping -c 25 192.168.202.10
```

   - Click **`link-ebgp-primary`** on the canvas and toggle **Cut Cable** (`Admin Down`)!
   - Watch `bgpctl show summary` on OpenBSD: within **`15` seconds** (`holdtime 15`), the primary neighbor `172.16.0.1` expires (`Idle`/`Active`), both routers immediately promote the backup BGP path via **`172.16.1.0/30`** (`link-ebgp-backup`), and `lan-a`'s pings resume automatically over `ether3 ── vio2`!

```sh node=node-obsd-as65002 title="Inspect failover onto Backup eBGP Neighbor (172.16.1.1) on OpenBSD"
bgpctl show summary
bgpctl show fib bgp
```

- [ ] Dissected `TCP/179` BGP `OPEN`/`UPDATE`/`KEEPALIVE` segments in `tcpflowy` and verified live BGP failover on cable cut.
