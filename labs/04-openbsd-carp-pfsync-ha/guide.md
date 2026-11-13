# Lab 04 — High-Availability Failover with OpenBSD `CARP` + `pfsync`

What happens to active TCP sessions when your primary edge firewall loses power or suffers a severed fiber link? Without stateful high availability, every established TCP connection dies instantly.

OpenBSD solved this cleanly without proprietary licensing using two patent-free kernel subsystems:
1. **`CARP` (Common Address Redundancy Protocol, IP proto `112`)**: Shares a virtual IP + virtual MAC (`00:00:5e:00:01:<vhid>`) across multiple routers and elects a `MASTER` based on `advskew`.
2. **`pfsync` (IP proto `240`)**: Replicates `pf` state-table inserts, updates, and deletions in real time over a dedicated sync interface (`vio2`) so `fw-backup` already knows the exact TCP sequence windows of in-flight connections!

```diagram
                                 ┌───────────────────┐
                        ✂ CUT!   │     fw-master     │ (advskew 10 -> MASTER)
                     ┌───✕──────▶│ vio0   vio2  vio1 │──────┐
 ┌────────────┐   ┌──┴───┐       └─────────┬─────────┘   ┌──▼───┐   ┌───────────┐
 │ lan-client │──▶│sw-lan│                 │ pfsync0     │sw-wan│──▶│  wan-srv  │
 │10.20.1.50  │   └──┬───┘       ┌─────────▼─────────┐   └──▲───┘   │198.51...80│
 └────────────┘      └──────────▶│ vio0   vio2  vio1 │──────┘       └───────────┘
   GW: VIP 10.20.1.1             │     fw-backup     │  GW: VIP 198.51.100.1
                                 └───────────────────┘ (Promotes to MASTER!)
```

---

## Step 1: Configure `lan-client`, `wan-srv`, and Physical Firewall Links

Boot all four VMs (**Start Lab**). Point `lan-client` and `wan-srv` at the **shared CARP Virtual IPs** (`10.20.1.1` and `198.51.100.1`)—neither endpoint ever needs to know `fw-master` or `fw-backup`'s physical IP!

```sh node=node-lan-client title="Configure lan-client (gw = CARP VIP 10.20.1.1)"
ip addr flush dev eth0
ip addr add 10.20.1.50/24 dev eth0
ip link set eth0 up
ip route replace default via 10.20.1.1
```

```sh node=node-wan-srv title="Configure wan-srv (gw = CARP VIP 198.51.100.1)"
ip addr flush dev eth0
ip addr add 198.51.100.80/24 dev eth0
ip link set eth0 up
ip route replace default via 198.51.100.1
```

Now configure the physical LAN (`vio0`), WAN (`vio1`), and `pfsync` (`vio2`) interfaces + `net.inet.carp.preempt=1` on both OpenBSD routers:

```sh node=node-fw-master title="Configure physical NICs + sysctls on fw-master"
ifconfig vio0 inet 10.20.1.2 netmask 255.255.255.0 up
ifconfig vio1 inet 198.51.100.2 netmask 255.255.255.0 up
ifconfig vio2 inet 172.16.254.1 netmask 255.255.255.252 up
sysctl net.inet.ip.forwarding=1
sysctl net.inet.carp.preempt=1
```

```sh node=node-fw-backup title="Configure physical NICs + sysctls on fw-backup"
ifconfig vio0 inet 10.20.1.3 netmask 255.255.255.0 up
ifconfig vio1 inet 198.51.100.3 netmask 255.255.255.0 up
ifconfig vio2 inet 172.16.254.2 netmask 255.255.255.252 up
sysctl net.inet.ip.forwarding=1
sysctl net.inet.carp.preempt=1
```

<details>
<summary>Hint / Why is net.inet.carp.preempt=1 essential on a dual-sided router?</summary>

Without `carp.preempt=1`, if `fw-master`'s **LAN** cable fails (`carp0` drops), `fw-master` might still remain `MASTER` on **WAN** (`carp1`), causing asymmetric blackholing! Enabling `net.inet.carp.preempt=1` instructs OpenBSD to demote *all* `carp` group interfaces together whenever any single `carp` interface fails, failing over LAN and WAN as an atomic unit.
</details>

- [ ] Configured endpoints and physical `vio0`/`vio1`/`vio2` interfaces on both OpenBSD firewalls.

---

## Step 2: Bring Up `carp0`, `carp1`, `pfsync0`, and Stateful `pf`

Create the shared virtual interfaces (`vhid 10` = `10.20.1.1` on LAN, `vhid 20` = `198.51.100.1` on WAN) and load an identical `pf.conf` allowing `carp` and `pfsync` protocols:

```sh node=node-fw-master title="Configure CARP (advskew 10 = MASTER) + pfsync0 + pf on fw-master"
ifconfig carp0 create
ifconfig carp0 vhid 10 pass etherloomha carpdev vio0 advskew 10 inet 10.20.1.1 netmask 255.255.255.0 up
ifconfig carp1 create
ifconfig carp1 vhid 20 pass etherloomha carpdev vio1 advskew 10 inet 198.51.100.1 netmask 255.255.255.0 up
ifconfig pfsync0 syncdev vio2 up

cat << 'EOF' > /etc/pf.conf
set skip on lo
block all
pass quick on vio2 proto pfsync keep state (no-sync)
pass quick on { vio0, vio1 } proto carp keep state (no-sync)
pass inet proto { tcp, udp, icmp } from 10.20.1.0/24 to 198.51.100.0/24 keep state
EOF
pfctl -f /etc/pf.conf && pfctl -e
ifconfig carp
```

```sh node=node-fw-backup title="Configure CARP (advskew 100 = BACKUP) + pfsync0 + pf on fw-backup"
ifconfig carp0 create
ifconfig carp0 vhid 10 pass etherloomha carpdev vio0 advskew 100 inet 10.20.1.1 netmask 255.255.255.0 up
ifconfig carp1 create
ifconfig carp1 vhid 20 pass etherloomha carpdev vio1 advskew 100 inet 198.51.100.1 netmask 255.255.255.0 up
ifconfig pfsync0 syncdev vio2 up

cat << 'EOF' > /etc/pf.conf
set skip on lo
block all
pass quick on vio2 proto pfsync keep state (no-sync)
pass quick on { vio0, vio1 } proto carp keep state (no-sync)
pass inet proto { tcp, udp, icmp } from 10.20.1.0/24 to 198.51.100.0/24 keep state
EOF
pfctl -f /etc/pf.conf && pfctl -e
ifconfig carp
```

Verify that `fw-master` reports `carp: MASTER` and `fw-backup` reports `carp: BACKUP`! Also click **`sw-lan`'s MAC Table** badge on the canvas—spot the virtual CARP MAC **`00:00:5e:00:01:0a`** learned on `fw-master`'s switch port (`p2`)!

- [ ] Verified `fw-master` (`MASTER`) and `fw-backup` (`BACKUP`) election and virtual MAC `00:00:5e:00:01:0a` on `sw-lan`.

---

## Step 3: Cut `fw-master`'s Cable Mid-Transfer!

Let's put `CARP` + `pfsync` through a live chaos test:

1. Start **Record `.pcap`** on **`link-client-lan`** (`lan-client:eth0 ── sw-lan:p1`).
2. Start a streaming TCP server on `wan-srv:7000` that sends 10 numbered heartbeat ticks (1 per second):

```sh node=node-wan-srv title="Start 10-second streaming TCP responder on wan-srv:7000"
sh -c 'i=1; while [ $i -le 10 ]; do echo "TICK_$i_VIA_HA_CLUSTER"; sleep 1; i=$((i+1)); done | nc -l -p 7000 &'
```

3. Connect from `lan-client`:

```sh node=node-lan-client title="Open live TCP stream from lan-client to wan-srv:7000"
nc 198.51.100.80 7000
```

4. **While `TICK_2` / `TICK_3` are printing** in `lan-client`'s serial console:
   - Click the wire **`sw-lan:p2 ── fw-master:vio0`** (`link-master-lan`) on the canvas and click **"Link Up — Cut Cable"** (`Scissors`)!
   - Watch `lan-client`'s console: after a brief ~1–2 second CARP takeover pause, **the exact same TCP connection keeps printing `TICK_5`..`TICK_10` through `fw-backup`** without disconnecting!

Check `fw-backup` to confirm it promoted to `MASTER` and used the synced `pf` state:

```sh node=node-fw-backup title="Verify fw-backup took over MASTER + active pf state"
ifconfig carp
pfctl -ss
```

- [ ] Cut `fw-master`'s cable mid-stream and watched `fw-backup` seamlessly continue the active TCP session!

---

## Step 4: Dissect the Failover Stream in `tcpflowy`

Click **Stop & Dissect with tcpflowy** on **`link-client-lan`**:
- Open **TCP Conversation `#0` (`10.20.1.50 ↔ 198.51.100.80:7000`)**.
- Notice its Handshake/State badge is **`COMPLETE (FIN)`** (zero `RST`s!).
- In the **Sequence Timeline**, spot at most 1–2 `RETRANS` segments during the ~1.5s CARP advertisement timeout, followed immediately by normal `PSH, ACK` segments once `sw-lan` relearned `00:00:5e:00:01:0a` on `fw-backup`'s port (`p3`)!
- In **Stream Payload**, verify all 10 `TICK_1_VIA_HA_CLUSTER` … `TICK_10_VIA_HA_CLUSTER` lines reconstructed intact without a single lost byte!

- [ ] Inspected the uninterrupted TCP conversation and `RETRANS` recovery across router failover in `tcpflowy`.
