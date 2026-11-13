# Lab 02 — IP Subnetting & Static Routing From Scratch

What separates an ordinary host from a **Layer-3 IP Router**? Nothing mystical — just two or more network interfaces, a forwarding table (FIB), and a single kernel flag!

In this lab, you will connect two completely separate IPv4 broadcast domains (`10.10.1.0/24` and `10.10.2.0/24`) through `rtr-1`, diagnose asymmetric routing on the wire, and inspect how Ethernet MAC headers change hop-by-hop while IP headers stay end-to-end.

```diagram
      Subnet A (10.10.1.0/24)                  Subnet B (10.10.2.0/24)
 ┌──────────────┐      link-lan1      ┌───────────────┐      link-lan2      ┌──────────────┐
 │    host-a    │────────────────────▶│     rtr-1     │────────────────────▶│    host-b    │
 │ 10.10.1.10   │ eth0           eth0 │ .1.1     .2.1 │ eth1           eth0 │ 10.10.2.20   │
 │  TTL = 64    │ SrcMAC: ..:01:10    │  ip_forward=1 │ SrcMAC: ..:02:01    │  TTL = 63    │
 └──────────────┘ DstMAC: ..:01:01    └───────────────┘ DstMAC: ..:02:20    └──────────────┘
```

---

## Step 1: Configure Interfaces on Both `/24` Subnets

Click **Start Lab** to boot `host-a`, `rtr-1`, and `host-b`, then configure their interfaces:

```sh node=node-host-a title="Configure host-a (10.10.1.10/24)"
ip addr flush dev eth0
ip addr add 10.10.1.10/24 dev eth0
ip link set eth0 up
ip route show
```

```sh node=node-rtr1 title="Configure rtr-1 (eth0 = 10.10.1.1/24, eth1 = 10.10.2.1/24)"
ip addr flush dev eth0
ip addr flush dev eth1
ip addr add 10.10.1.1/24 dev eth0
ip addr add 10.10.2.1/24 dev eth1
ip link set eth0 up
ip link set eth1 up
ip route show
```

```sh node=node-host-b title="Configure host-b (10.10.2.20/24)"
ip addr flush dev eth0
ip addr add 10.10.2.20/24 dev eth0
ip link set eth0 up
```

Try pinging `host-b` (`10.10.2.20`) from `host-a` right now:

```sh node=node-host-a title="Test unrouted ping from host-a"
ping -c 1 10.10.2.20 || true
```

Notice the kernel immediately returns `Network is unreachable` **without transmitting a single packet on `eth0`** because `10.10.2.20` is outside `10.10.1.0/24` and no route matches!

- [ ] Configured `10.10.1.0/24` and `10.10.2.0/24` interfaces and observed `Network is unreachable`.

---

## Step 2: Add a Static Route & Catch Two Classic Routing Pitfalls

Let's teach `host-a` to reach `10.10.2.0/24` via next-hop gateway `10.10.1.1` (`rtr-1`):

```sh node=node-host-a title="Add static route on host-a via 10.10.1.1"
ip route add 10.10.2.0/24 via 10.10.1.1
ip route get 10.10.2.20
```

Now start **Live Wireshark** (or **Record `.pcap`**) on **both** `link-lan1` and `link-lan2`, and send 2 pings from `host-a`:

```sh node=node-host-a title="Ping 10.10.2.20 (watch link-lan1 vs link-lan2!)"
ping -c 2 -W 1 10.10.2.20 || true
```

Look closely at the two wires:
- **`link-lan1` (`host-a ── rtr-1`)**: You see `ARP Who-has 10.10.1.1?` (notice `host-a` ARPs for **its next-hop router**, NEVER for `10.10.2.20`!), followed by the `ICMP Echo Request` (`Dst IP = 10.10.2.20`, `Dst MAC = 52:54:00:20:01:01`).
- **`link-lan2` (`rtr-1 ── host-b`)**: **Dead silence!** `rtr-1` dropped the packet!

<details>
<summary>Hint / Why did rtr-1 drop a valid packet destined for its own connected subnet?</summary>

By default, general-purpose UNIX kernels operate as **end-hosts**, not routers:
- **Linux**: `sysctl net.ipv4.ip_forward` defaults to `0`
- **OpenBSD / FreeBSD / NetBSD**: `sysctl net.inet.ip.forwarding` defaults to `0`

When `ip_forward = 0`, any ingress IPv4 packet whose destination IP does not belong to `rtr-1` itself is silently discarded at Layer 3.
</details>

- [ ] Observed `host-a` ARPing for next-hop `10.10.1.1` and `rtr-1` dropping transit traffic while `ip_forward=0`.

---

## Step 3: Enable Kernel Forwarding & Fix Asymmetric Return Routing

1. Turn `rtr-1` into a true IPv4 router:

```sh node=node-rtr1 title="Enable IPv4 forwarding on rtr-1"
sysctl -w net.ipv4.ip_forward=1
```

2. Send 1 ping from `host-a` while watching **`link-lan2`**:

```sh node=node-host-a title="Test one-way forwarding to host-b"
ping -c 1 -W 1 10.10.2.20 || true
```

Now the `ICMP Echo Request` **arrives at `host-b`** on `link-lan2` — yet `host-a` still gets 100% packet loss! Why? Because **`host-b` has no return route back to `10.10.1.0/24`**! Routing is *always* bidirectional. Add the symmetric return route on `host-b`:

```sh node=node-host-b title="Add return static route on host-b via 10.10.2.1"
ip route add 10.10.1.0/24 via 10.10.2.1
```

Now ping again from `host-a` — instant 0% packet loss!

```sh node=node-host-a title="Verify bidirectional routed connectivity"
ping -c 3 10.10.2.20
```

- [ ] Enabled `net.ipv4.ip_forward=1` and added the return route on `host-b` to achieve full end-to-end connectivity.

---

## Step 4: Trace TTL Decrement & Dissect a Routed Flow in `tcpflowy`

Every router hop decrements the IPv4 **Time-To-Live (`TTL`)** field by 1 (and recomputes the IPv4 header checksum). If `TTL` hits `0` in transit, the router returns **`ICMP Time Exceeded (Type 11, Code 0)`** — the exact mechanism behind `traceroute`!

1. Start **Record `.pcap`** on **`link-lan1`** (`host-a ── rtr-1`) and **`link-lan2`** (`rtr-1 ── host-b`).
2. Send a packet with `TTL = 1` from `host-a`, then run an HTTP request across the router to `host-b`:

```sh node=node-host-b title="Start simple HTTP responder on host-b:8080"
sh -c 'printf "HTTP/1.1 200 OK\r\nContent-Length: 23\r\n\r\nROUTED_ACROSS_SUBNETS!\n" | nc -l -p 8080 &'
```

```sh node=node-host-a title="Trigger TTL=1 Time Exceeded + Routed HTTP GET"
ping -c 1 -t 1 10.10.2.20 || true
sh -c 'printf "GET /subnet-b HTTP/1.1\r\nHost: 10.10.2.20\r\n\r\n" | nc -w 1 10.10.2.20 8080'
```

3. Click **Stop & Dissect with tcpflowy** on **`link-lan2`** (and open in Wireshark to compare `link-lan1` vs `link-lan2`):
   - In **`tcpflowy`**, verify the `10.10.1.10 ↔ 10.10.2.20:8080` `HTTP` flow (`COMPLETE (FIN)`) and read the reconstructed `ROUTED_ACROSS_SUBNETS!` payload.
   - In **Wireshark**, compare the same packet on `link-lan1` vs `link-lan2`:
     - `link-lan1`: `Src MAC = 52:54:00:20:01:10` → `Dst MAC = 52:54:00:20:01:01`, `IP TTL = 64`
     - `link-lan2`: `Src MAC = 52:54:00:20:02:01` → `Dst MAC = 52:54:00:20:02:20`, `IP TTL = 63`

- [ ] Verified TTL decrement (`64 → 63`), `ICMP Time Exceeded` on `TTL=1`, and dissected the routed HTTP stream in `tcpflowy`.
