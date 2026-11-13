# Lab 03 — Stateful Firewalls & NAT with OpenBSD `pf`

OpenBSD's **Packet Filter (`pf`)** is legendary for its clean, readable grammar and rock-solid stateful inspection engine. In this lab, you will build a real edge firewall from a blank `/etc/pf.conf`, masquerade an RFC1918 private LAN (`192.168.10.0/24`) behind a public IP (`203.0.113.1`), publish an internal port via `rdr-to`, and verify **both sides of the firewall** using **`tcpflowy`**.

```diagram
   Private LAN (RFC1918)                 OpenBSD pf-gw                   Public WAN (TEST-NET-3)
 ┌──────────────────────┐   link-lan-pf   ┌───────────┐   link-pf-wan   ┌──────────────────────┐
 │       lan-host       │────────────────▶│vio0   vio1│────────────────▶│       wan-srv        │
 │  192.168.10.10:54112 │                 │ .10.1  .1 │                 │    203.0.113.80:80   │
 └──────────────────────┘                 └───────────┘                 └──────────────────────┘
    Wire A sees:                             pf state:                     Wire B sees:
    Src = 192.168.10.10:54112   ═══ nat-to (vio1:0) ═══▶                   Src = 203.0.113.1:61042
```

---

## Step 1: Configure `lan-host`, OpenBSD `pf-gw`, and `wan-srv`

Boot all three VMs (**Start Lab**) and configure their interfaces. Notice that **`wan-srv` intentionally has NO route to `192.168.10.0/24`**—just like a real Internet server, it only knows its local `203.0.113.0/24` segment!

```sh node=node-lan-host title="Configure lan-host (192.168.10.10/24, gw 192.168.10.1)"
ip addr flush dev eth0
ip addr add 192.168.10.10/24 dev eth0
ip link set eth0 up
ip route replace default via 192.168.10.1
```

```sh node=node-pf-gw title="Configure OpenBSD pf-gw (vio0 LAN + vio1 WAN + forwarding)"
ifconfig vio0 inet 192.168.10.1 netmask 255.255.255.0 up
ifconfig vio1 inet 203.0.113.1 netmask 255.255.255.0 up
sysctl net.inet.ip.forwarding=1
```

```sh node=node-wan-srv title="Configure wan-srv (203.0.113.80/24 — NO private LAN route!)"
ip addr flush dev eth0
ip addr add 203.0.113.80/24 dev eth0
ip link set eth0 up
```

- [ ] Configured `lan-host`, `pf-gw` (`vio0` + `vio1`), and `wan-srv`.

---

## Step 2: Write `/etc/pf.conf` From Scratch (Default Block + Outbound NAT)

If you try `ping -c 1 203.0.113.80` from `lan-host` without NAT, `wan-srv` receives a packet from `192.168.10.10` and cannot reply (`Network is unreachable`).

Let's write a clean, production-grade `/etc/pf.conf` on `pf-gw` featuring:
- Macros (`lan_if = "vio0"`, `wan_if = "vio1"`)
- `set block-policy return` (sends TCP `RST` / ICMP unreachable so blocked flows show clearly in captures!)
- Default `block log all`
- Outbound source NAT masquerading: `match out on $wan_if inet from ($lan_if:network) to any nat-to ($wan_if:0)`
- Inbound port forward (`rdr-to`): WAN TCP `8080` → `192.168.10.10:8080`

```sh node=node-pf-gw title="Write & syntax-check /etc/pf.conf on pf-gw"
cat << 'EOF' > /etc/pf.conf
lan_if = "vio0"
wan_if = "vio1"
internal_app = "192.168.10.10"

set skip on lo
set block-policy return

# 1. Default-deny security posture
block log all

# 2. Outbound NAT Masquerading (RFC1918 LAN -> WAN IP 203.0.113.1)
match out on $wan_if inet from ($lan_if:network) to any nat-to ($wan_if:0)

# 3. Allow LAN clients to initiate outbound TCP, UDP, and ICMP statefully
pass in on $lan_if inet proto { tcp, udp, icmp } from ($lan_if:network) to any
pass out on $wan_if inet proto { tcp, udp, icmp } from ($wan_if) to any

# 4. Inbound Port Forwarding (DNAT): WAN :8080 -> lan-host :8080
pass in on $wan_if inet proto tcp from any to ($wan_if) port 8080 rdr-to $internal_app port 8080
pass out on $lan_if inet proto tcp from any to $internal_app port 8080
EOF
pfctl -nf /etc/pf.conf && pfctl -f /etc/pf.conf && pfctl -e
pfctl -sr
```

<details>
<summary>Hint / Why do we put parentheses around ($wan_if:0) in nat-to?</summary>

In OpenBSD `pf`, wrapping an interface name in parentheses—`($wan_if:0)`—tells the kernel to evaluate the interface's primary IPv4 address **dynamically at packet time** rather than hardcoding it when `pfctl -f` loads the file. Even if DHCP or PPPoE renews `vio1`'s IP address later, NAT continues working without reloading `pf.conf`!
</details>

- [ ] Validated (`pfctl -nf`) and loaded `/etc/pf.conf` on `pf-gw`.

---

## Step 3: Start Listeners & Capture Both Sides of the Firewall

1. Click **Record `.pcap`** on **both** highlighted wires:
   - **`link-lan-pf`** (`lan-host:eth0 ── pf-gw:vio0`)
   - **`link-pf-wan`** (`pf-gw:vio1 ── wan-srv:eth0`)
2. Start an HTTP responder on `wan-srv:80` (for outbound NAT testing) and an internal responder on `lan-host:8080` (for inbound port-forwarding testing):

```sh node=node-wan-srv title="Start WAN HTTP server on wan-srv:80"
sh -c 'printf "HTTP/1.1 200 OK\r\nContent-Length: 17\r\n\r\nHELLO_FROM_WAN_80" | nc -l -p 80 &'
```

```sh node=node-lan-host title="Start internal LAN service on lan-host:8080"
sh -c 'printf "HTTP/1.1 200 OK\r\nContent-Length: 25\r\n\r\nPORT_FORWARDED_TO_LAN_10!" | nc -l -p 8080 &'
```

3. Test **Outbound NAT** from `lan-host` → `wan-srv:80`:

```sh node=node-lan-host title="Outbound NAT HTTP request from lan-host -> 203.0.113.80:80"
sh -c 'printf "GET /nat-check HTTP/1.1\r\nHost: 203.0.113.80\r\n\r\n" | nc -w 1 203.0.113.80 80'
```

4. Test **Blocked WAN Port (`:9999`)** vs. **Port-Forwarded WAN Port (`:8080`)** from `wan-srv` → `203.0.113.1`:

```sh node=node-wan-srv title="Test blocked port 9999 vs forwarded port 8080 from WAN"
nc -zv -w 1 203.0.113.1 9999 || true
sh -c 'printf "GET /dmz HTTP/1.1\r\nHost: 203.0.113.1:8080\r\n\r\n" | nc -w 1 203.0.113.1 8080'
```

- [ ] Tested outbound NAT (`:80`), blocked WAN (`:9999`), and inbound `rdr-to` port forwarding (`:8080`).

---

## Step 4: Inspect `pfctl -ss` & Compare Both Captures in `tcpflowy`

1. Dump the live stateful NAT bindings on `pf-gw`:

```sh node=node-pf-gw title="Inspect OpenBSD pf state table"
pfctl -ss
pfctl -si | head -n 16
```

2. Click **Stop & Dissect with tcpflowy** on **`link-pf-wan`**, then compare with **`link-lan-pf`** in the `Captures & tcpflowy` dropdown:
   - **Outbound Flow**:
     - On `link-lan-pf`: `192.168.10.10:<ephem> ↔ 203.0.113.80:80` (`COMPLETE (FIN)`).
     - On `link-pf-wan`: `203.0.113.1:<nat_port> ↔ 203.0.113.80:80` — `wan-srv` never saw `192.168.10.10`!
   - **Blocked WAN Probe (`:9999`)**:
     - On `link-pf-wan`: `203.0.113.80 ↔ 203.0.113.1:9999` shows **`RESET (RST)`** (`set block-policy return` sent an immediate `RST, ACK`), and **`link-lan-pf` never saw a single packet** of that probe!
   - **Port-Forwarded Flow (`:8080`)**:
     - Translated seamlessly to `192.168.10.10:8080` and returned `PORT_FORWARDED_TO_LAN_10!`.

- [ ] Verified NAT source/destination translation and `RESET (RST)` firewall rejection across both wires in `tcpflowy`.
