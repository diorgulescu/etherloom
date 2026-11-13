# Lab 01 — Ethernet, Hubs vs. Switches & ARP Under the Microscope

Welcome to **Etherloom Academy**! In this foundational lab, you will observe how raw IEEE 802.3 / Ethernet II frames travel across a Layer-1 repeater (**Hub**) versus a Layer-2 learning bridge (**Switch**), and why the **Address Resolution Protocol (ARP)** bridges IPv4 addresses to 48-bit MAC addresses.

```diagram
  PART A: L1 HUB (Blind Repeater)           PART B: L2 SWITCH (MAC Learning)
 ┌────────┐                                ┌────────┐
 │   h1   │ 52:54:00:10:01:01              │   h1   │──p1─┐  MAC Table:
 │10.0.1.1│──p1─┐                          └────────┘     │  ..:01:01 -> p1
 └────────┘     │     ┌─────────┐          ┌────────┐     ▼  ..:01:02 -> p2
 ┌────────┐     ├────▶│  hub-1  │          │   h2   │──p2─[ sw-1 ]
 │   h2   │──p2─┤     │Floods to│          └────────┘     │
 │10.0.1.2│     │     │ALL ports│          ┌────────┐     ✗ (Unicast isolated!)
 └────────┘     │     └─────────┘          │   h3   │──p3─┘
 ┌────────┐     ▼                          └────────┘
 │   h3   │◀─p3─┘ (Sees h1<->h2 unicast!)
 └────────┘
```

---

## Step 1: Boot the 3 Hosts & Configure `eth0`

Click **Start Lab** in the top toolbar to boot `h1`, `h2`, and `h3`. Once booted (and logged in as `root` on each serial console), assign their IPv4 addresses inside `10.0.1.0/24`:

```sh node=node-h1 title="Configure h1 (10.0.1.1/24)"
ip addr flush dev eth0
ip addr add 10.0.1.1/24 dev eth0
ip link set eth0 up
ip -br link show eth0
```

```sh node=node-h2 title="Configure h2 (10.0.1.2/24)"
ip addr flush dev eth0
ip addr add 10.0.1.2/24 dev eth0
ip link set eth0 up
```

```sh node=node-h3 title="Configure h3 (10.0.1.3/24)"
ip addr flush dev eth0
ip addr add 10.0.1.3/24 dev eth0
ip link set eth0 up
```

- [ ] Booted `h1`, `h2`, and `h3` and brought `eth0` UP on all three hosts.

---

## Step 2: Observe Unicast Leakage on an L1 Hub

Right now, all three hosts are plugged into **`hub-1`** (an L1 Ethernet Hub). Let's eavesdrop on **`h3`'s wire (`link-h3-hub`)** while `h1` talks exclusively to `h2`!

1. Click the highlighted wire **`h3:eth0 ── hub-1:p3`** on the canvas and start **Live Wireshark** (or **Record `.pcap`**).
2. Flush `h1`'s ARP cache and send 3 ICMP pings to `h2` (`10.0.1.2`):

```sh node=node-h1 title="Flush ARP & Ping h2 from h1"
ip neigh flush all
ping -c 3 10.0.1.2
ip neigh show
```

3. Even better — start a quick TCP listener on `h2` and send a cleartext message from `h1`:

```sh node=node-h2 title="Start one-shot TCP listener on h2:9000"
sh -c 'echo "HELLO_FROM_H2" | nc -l -p 9000 &'
```

```sh node=node-h1 title="Connect from h1 to h2:9000"
sh -c 'echo "SECRET_ON_HUB_WIRE" | nc -w 1 10.0.1.2 9000'
```

4. On **`h3`'s wire**, click **Stop & Dissect with tcpflowy**! Notice that **`h3`'s cable captured the entire `h1 ↔ h2` TCP flow** (`SECRET_ON_HUB_WIRE`), even though `h3` (`10.0.1.3`) was never addressed!

<details>
<summary>Hint / Why did h3's wire see h1 ↔ h2's private unicast frames?</summary>

An **L1 Ethernet Hub** has zero awareness of Ethernet II headers or 48-bit MAC addresses. Electrically (and in `PacketFabric`), it acts as a shared bus repeater: every frame arriving on `p1` is copied verbatim out `p2` **and** `p3`. Before switches replaced hubs, any host in promiscuous mode (`tcpdump -i eth0`) could read every unencrypted session on the LAN segment.
</details>

- [ ] Captured `h1 ↔ h2` unicast ICMP & TCP frames leaking onto bystander `h3`'s hub wire.

---

## Step 3: Swap Cables to L2 Switch `sw-1` & Inspect MAC Learning

Now let's upgrade the LAN from Layer 1 to Layer 2 without changing a single IP address inside the VMs:

1. Click each of the three wires attached to **`hub-1`** and click the **Trash (`Unplug & delete wire`)** icon (or select and press `Backspace`).
2. Drag new Ethernet cables from:
   - `h1` (`eth0`) ──▶ `sw-1` (`p1`)
   - `h2` (`eth0`) ──▶ `sw-1` (`p2`)
   - `h3` (`eth0`) ──▶ `sw-1` (`p3`)
3. Click the **MAC Table** badge right on the **`sw-1`** node card on the canvas — notice it starts empty (`0 MACs`)!

- [ ] Re-cabled `h1`, `h2`, and `h3` onto **`sw-1`** (`p1`, `p2`, `p3`).

---

## Step 4: ARP Broadcast Flooding vs. Unicast Isolation

1. Start **Live Wireshark** (or **Record `.pcap`**) on **`h3:eth0 ── sw-1:p3`**.
2. Flush ARP on `h1` so it forgets `h2`'s MAC address, then ping `h2` again:

```sh node=node-h1 title="Flush ARP on h1 & Ping h2 across sw-1"
ip neigh flush all
ping -c 3 10.0.1.2
```

3. Inspect what arrived on **`h3`'s switch wire**:
   - You see **1 single frame**: the `ARP Request` (`Who has 10.0.1.2? Tell 10.0.1.1`) sent to broadcast MAC **`ff:ff:ff:ff:ff:ff`**.
   - You see **ZERO** `ARP Reply` frames and **ZERO** `ICMP Echo Request / Reply` frames!
4. Click the **MAC Table** button on **`sw-1`** on the canvas:
   - `52:54:00:10:01:01` (`h1`) was learned dynamically on `p1` when `h1` sent the ARP Request!
   - `52:54:00:10:01:02` (`h2`) was learned dynamically on `p2` when `h2` sent its unicast ARP Reply!

<details>
<summary>Why did the ARP Request reach h3, while the ARP Reply and pings did not?</summary>

When `h1` didn't know `10.0.1.2`'s MAC, it set `dst_mac = ff:ff:ff:ff:ff:ff` (Ethernet broadcast). An IEEE 802.1D **L2 Switch** *must* flood broadcast (and unknown-unicast) frames out all other active ports (`p2` and `p3`), while simultaneously recording `(src_mac = 52:54:00:10:01:01) -> p1` in its forwarding database.

When `h2` replied directly to `dst_mac = 52:54:00:10:01:01`, `sw-1` already knew `p1` owned that MAC—so it forwarded the reply **exclusively** out `p1`, learning `h2 -> p2` at the same instant. All subsequent unicast frames stay strictly between `p1` and `p2`!
</details>

- [ ] Verified that `sw-1` flooded the `ff:ff:ff:ff:ff:ff` ARP broadcast to `h3` while isolating all subsequent unicast frames, and confirmed learned entries in `sw-1`'s live MAC table.
