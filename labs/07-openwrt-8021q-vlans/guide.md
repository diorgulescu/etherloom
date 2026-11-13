# Lab 07 — 802.1Q VLAN Segmentation, Trunking & Inter-VLAN Routing on OpenWrt

IEEE **802.1Q Virtual LANs (VLANs)** carve a single physical switch fabric into isolated Layer-2 broadcast domains and multiplex multiple subnets over a single **Tagged Trunk** cable by inserting a 4-byte `0x8100` header (`1518` bytes max frame size).

In this lab, you will configure **modern OpenWrt UCI `bridge-vlan` filtering** (used across all DSA and Linux bridge switches since OpenWrt 21.02+—replacing deprecated `swconfig`), build a **Router-on-a-Stick**, watch tagged `0x8100` frames traverse the trunk **twice** in Wireshark, and enforce unidirectional **`fw4` (`nftables`)** zone isolation.

```diagram
  VLAN 10 Access (Untagged)          OpenWrt Bridge-VLAN Switch          802.1Q Trunk (0x8100)         OpenWrt Router-on-a-Stick
 ┌─────────────────────────┐              ┌───────────────┐                link-dot1q-trunk             ┌─────────────────────┐
 │        host-eng         │──eth0:u*────▶│               │                                             │     openwrt-rtr     │
 │   10.10.10.10/24 (gw.1) │  VLAN 10     │  openwrt-sw1  │═══ eth2:t ═══════[VID 10 | VID 20]═══ eth0 ═▶ eth0.10: 10.10.10.1 │
 └─────────────────────────┘              │  br-lan (DSA) │                                             │ eth0.20: 10.10.20.1 │
 ┌─────────────────────────┐              │               │                                             │   fw4 / nftables    │
 │       host-guest        │──eth1:u*────▶│               │                                             └─────────────────────┘
 │   10.10.20.20/24 (gw.1) │  VLAN 20     └───────────────┘
 └─────────────────────────┘
  VLAN 20 Access (Untagged)
```

---

## Step 1: Modern OpenWrt `bridge-vlan` Switch & Router-on-a-Stick Setup

Boot all four VMs (**Start All**; press `Enter` inside OpenWrt's serial console once boot finishes to activate the root shell).

1. **Configure `openwrt-sw1` as a VLAN-Aware Layer-2 Bridge (`br-lan`)** using modern UCI `bridge-vlan` syntax (`:u*` = untagged egress + ingress PVID; `:t` = IEEE `802.1Q` tagged trunk):

```sh node=node-openwrt-sw1 title="Configure modern UCI bridge-vlan filtering on openwrt-sw1 (no legacy swconfig!)"
uci -q batch << 'EOF'
delete network.lan
delete network.wan
delete network.wan6
delete network.@device[0]

set network.br_sw=device
set network.br_sw.name='br-lan'
set network.br_sw.type='bridge'
set network.br_sw.vlan_filtering='1'
add_list network.br_sw.ports='eth0'
add_list network.br_sw.ports='eth1'
add_list network.br_sw.ports='eth2'

set network.vlan10=bridge-vlan
set network.vlan10.device='br-lan'
set network.vlan10.vlan='10'
add_list network.vlan10.ports='eth0:u*'
add_list network.vlan10.ports='eth2:t'

set network.vlan20=bridge-vlan
set network.vlan20.device='br-lan'
set network.vlan20.vlan='20'
add_list network.vlan20.ports='eth1:u*'
add_list network.vlan20.ports='eth2:t'

set network.mgmt=interface
set network.mgmt.device='br-lan.10'
set network.mgmt.proto='static'
set network.mgmt.ipaddr='10.10.10.2'
set network.mgmt.netmask='255.255.255.0'
EOF
uci commit network
/etc/init.d/network restart
sleep 2
bridge vlan show
```

2. **Configure `openwrt-rtr` as a Router-on-a-Stick** terminating `eth0.10` (`10.10.10.1/24`) and `eth0.20` (`10.10.20.1/24`) in dedicated `fw4` zones (`eng` and `guest`), initially permitting bidirectional routing for Step 3:

```sh node=node-openwrt-rtr title="Configure 802.1Q subinterfaces (eth0.10 & eth0.20) + fw4 zones on openwrt-rtr"
uci -q batch << 'EOF'
delete network.lan
delete network.wan
delete network.wan6
delete network.@device[0]

set network.eth0_dev=device
set network.eth0_dev.name='eth0'

set network.dev_v10=device
set network.dev_v10.type='8021q'
set network.dev_v10.ifname='eth0'
set network.dev_v10.vid='10'
set network.dev_v10.name='eth0.10'

set network.dev_v20=device
set network.dev_v20.type='8021q'
set network.dev_v20.ifname='eth0'
set network.dev_v20.vid='20'
set network.dev_v20.name='eth0.20'

set network.eng=interface
set network.eng.device='eth0.10'
set network.eng.proto='static'
set network.eng.ipaddr='10.10.10.1'
set network.eng.netmask='255.255.255.0'

set network.guest=interface
set network.guest.device='eth0.20'
set network.guest.proto='static'
set network.guest.ipaddr='10.10.20.1'
set network.guest.netmask='255.255.255.0'
EOF
uci commit network

cat << 'EOF' > /etc/config/firewall
config defaults
	option input 'ACCEPT'
	option output 'ACCEPT'
	option forward 'REJECT'

config zone 'zone_eng'
	option name 'eng'
	list network 'eng'
	option input 'ACCEPT'
	option output 'ACCEPT'
	option forward 'ACCEPT'

config zone 'zone_guest'
	option name 'guest'
	list network 'guest'
	option input 'ACCEPT'
	option output 'ACCEPT'
	option forward 'ACCEPT'

config forwarding 'eng_to_guest'
	option src 'eng'
	option dest 'guest'

config forwarding 'guest_to_eng'
	option src 'guest'
	option dest 'eng'
EOF
/etc/init.d/network restart
/etc/init.d/firewall restart
```

3. **Configure the two Alpine access workstations** (`host-eng` in VLAN 10 and `host-guest` in VLAN 20):

```sh node=node-host-eng title="Configure host-eng (10.10.10.10/24, gateway 10.10.10.1)"
ip addr flush dev eth0
ip addr add 10.10.10.10/24 dev eth0
ip link set eth0 up
ip route replace default via 10.10.10.1
```

```sh node=node-host-guest title="Configure host-guest (10.10.20.20/24, gateway 10.10.20.1)"
ip addr flush dev eth0
ip addr add 10.10.20.20/24 dev eth0
ip link set eth0 up
ip route replace default via 10.10.20.1
```

<details>
<summary>Under the Hood: What do :u* and :t mean in OpenWrt bridge-vlan?</summary>

In OpenWrt's modern Linux Bridge / DSA configuration, every port membership suffix controls hardware/kernel VLAN tag handling:
- **`eth0:u*`**: **`u`** strips the 4-byte `802.1Q` header on egress (untagged access port), and **`*`** marks VLAN 10 as the port's **PVID (Port VLAN ID)** so incoming untagged frames from `host-eng` are classified into VLAN 10.
- **`eth2:t`**: **`t`** preserves/inserts the 4-byte `0x8100` `802.1Q` tag (`12-bit VID`) on egress and expects tagged frames on ingress—allowing VLAN 10 and VLAN 20 to share one physical cable!
</details>

- [ ] Configured `bridge-vlan` filtering on `openwrt-sw1`, `eth0.10`/`eth0.20` on `openwrt-rtr`, and both Alpine hosts.

---

## Step 2: Verify Layer-2 Broadcast Domain Isolation

Even though `host-eng` (`eth0`) and `host-guest` (`eth1`) are plugged into the **same `br-lan` bridge** on `openwrt-sw1`, `vlan_filtering='1'` isolates their broadcast domains at Layer 2:

1. Start **Live Wireshark** (or **Record `.pcap`**) on **`link-guest-access`** (`host-guest:eth0 ── openwrt-sw1:eth1`).
2. From **`host-eng`**, emit Layer-2 ARP broadcasts (`ff:ff:ff:ff:ff:ff`) onto VLAN 10:

```sh node=node-host-eng title="Send L2 broadcast ARP probes from host-eng (VLAN 10)"
arping -c 3 -I eth0 10.10.10.99 || true
```

3. Check **`link-guest-access`** in Wireshark: **zero ARP broadcasts from `10.10.10.10` ever leak onto VLAN 20's wire!**

- [ ] Verified in Wireshark that VLAN 10 Layer-2 broadcasts never reach `link-guest-access` (VLAN 20).

---

## Step 3: Inspect Live `802.1Q` Tags on the Trunk Wire (`EtherType 0x8100`)

Now attach **Live Wireshark** + **Record `.pcap`** onto the trunk wire **`link-dot1q-trunk`** (`openwrt-sw1:eth2 ── openwrt-rtr:eth0`), and send a single cross-VLAN ping from Engineering (`10.10.10.10`) to Guest (`10.10.20.20`):

```sh node=node-host-eng title="Cross-VLAN ping from VLAN 10 (10.10.10.10) -> VLAN 20 (10.10.20.20)"
ping -c 2 10.10.20.20
```

Expand the **`802.1Q Virtual LAN`** header in Wireshark on `link-dot1q-trunk`—notice every Echo Request (and Reply) crosses the trunk wire **twice**:
1. **Switch → Router (`eth2 → eth0`)**: Outer `EtherType = 0x8100`, **`ID: 10`** (`PRI: 0, DEI: 0, ID: 10`), IP `TTL = 64`, Destination MAC = `openwrt-rtr:eth0`.
2. **Router → Switch (`eth0 → eth2`)**: Outer `EtherType = 0x8100`, **`ID: 20`**, IP **`TTL = 63`** (decremented by routing!), Source MAC = `openwrt-rtr:eth0`.

<details>
<summary>Under the Hood: Why did Etherloom's PacketFabric need >= 2048 / 9216-byte frame buffers here?</summary>

A full-sized 1500-byte IP packet normally occupies `1514` bytes on Ethernet (`14B` header + `1500B` payload). When `openwrt-sw1` pushes an `802.1Q` tag onto `eth2`, the frame grows to **`1518` bytes** (or `1522` bytes with `802.1ad` QinQ). Etherloom's `PacketFabric` allocates jumbo-safe buffers (`>= 9216` bytes) and switches strictly on outer `dst_mac`/`src_mac` (`bytes[0..12]`), preserving `0x8100` headers intact across wires, switches, and `.pcap` captures.
</details>

- [ ] Observed cross-VLAN packets traversing `link-dot1q-trunk` twice (`VID 10` → routed `TTL-1` → `VID 20`).

---

## Step 4: Firewall Zone Isolation (`fw4` / `nftables`) & `tcpflowy` Verification

In production networks, **Engineering (`VLAN 10`)** may reach **Guest (`VLAN 20`)** diagnostics, while **Guest (`VLAN 20`)** must **never** initiate connections into Engineering.

1. Remove the `guest_to_eng` forwarding rule on **`openwrt-rtr`** and reload `fw4` (`nftables`):

```sh node=node-openwrt-rtr title="Block Guest (VLAN 20) -> Eng (VLAN 10) while keeping stateful return traffic"
uci delete firewall.guest_to_eng
uci commit firewall
/etc/init.d/firewall reload
nft list chain inet fw4 forward_guest
```

2. Start TCP listeners on both Alpine hosts (`:8080`), ensure **Record `.pcap`** is running on **`link-dot1q-trunk`**, and test both directions:

```sh node=node-host-eng title="Start :8080 service on host-eng & connect outbound Eng -> Guest (ALLOWED)"
pkill -f "nc -l -p 8080" 2>/dev/null || true
sh -c 'printf "ENG_SECRET_8080\r\n" | nc -l -p 8080 &'
```

```sh node=node-host-guest title="Start :8080 on host-guest, verify Eng->Guest works, then test Guest->Eng (BLOCKED)"
pkill -f "nc -l -p 8080" 2>/dev/null || true
sh -c 'printf "GUEST_HELLO_8080\r\n" | nc -l -p 8080 &'
```

```sh node=node-host-eng title="1) Allowed flow: Eng (10.10.10.10) -> Guest (10.10.20.20:8080)"
nc -w 2 10.10.20.20 8080
```

```sh node=node-host-guest title="2) Blocked flow: Guest (10.10.20.20) -> Eng (10.10.10.10:8080)"
nc -zv -w 2 10.10.10.10 8080 || true
```

3. Click **Stop & Dissect with tcpflowy** on **`link-dot1q-trunk`**:
   - **`10.10.10.10 → 10.10.20.20:8080`**: **`COMPLETE (FIN)`** — `fw4`'s `ct state { related, established } accept` rule allowed Guest's `SYN-ACK` and `"GUEST_HELLO_8080"` reply cleanly back into VLAN 10!
   - **`10.10.20.20 → 10.10.10.10:8080`**: **`RESET (RST)`** — `openwrt-rtr`'s `forward_guest` chain rejected the `SYN` on VLAN 20 (`handle_reject` TCP `RST`), so the unauthorized `SYN` was never even tagged onto VLAN 10!

- [ ] Verified unidirectional `fw4` (`nftables`) inter-VLAN policy and dissected `COMPLETE` vs `RESET` TCP flows in `tcpflowy`.
