# Lab 05 — Dissecting TCP: Handshakes, Window Scaling & Packet Loss

Why does a `1 Gbps` transcontinental link slow to a crawl when packet loss reaches just `2%–5%`? Because **TCP treats every lost segment as congestion**, halving its congestion window (`cwnd`) while stalling receiver reassembly until missing sequence ranges are retransmitted!

In this lab, Etherloom's `PacketFabric` has pre-configured the wire **`link-lossy-wan`** with **80 ms one-way latency (`160 ms` RTT)** and **5% packet loss**. You will record a live bulk transfer and dissect every segment inside Etherloom's integrated **`tcpflowy` Visual Flow Dissector**.

```diagram
  Client (10.50.0.10)              link-lossy-wan (80ms, 5% loss)             Server (10.50.0.20)
       │                                                                             │
 +0ms  │ ─────────────── [SYN] Seq=0 Win=64240 (WS=128) ───────────────────────────▶ │
+160ms │ ◀────────────── [SYN, ACK] Seq=0 Ack=1 Win=65160 (WS=128) ───────────────── │
+160ms │ ─────────────── [ACK] Seq=1 Ack=1 ────────────────────────────────────────▶ │
       │ ─────────────── [PSH, ACK] Seq=1    Len=1448 ────✕ (DROPPED BY 5% LOSS!)    │
       │ ─────────────── [PSH, ACK] Seq=1449 Len=1448 ─────────────────────────────▶ │ (Gap! Sends Dup ACK=1)
       │ ◀────────────── [ACK] Ack=1 (Dup ACK #1..#3) ────────────────────────────── │
       │ ─────────────── [RETRANS]  Seq=1    Len=1448 ─────────────────────────────▶ │ (Fast Retransmit!)
```

---

## Step 1: Configure Hosts & Measure the 160 ms RTT Baseline

Click **Start Lab** to boot `tcp-client` and `tcp-server`. Notice the amber pill **`80ms 5%`** on **`link-lossy-wan`** (`80 ms` in *each* direction = **`~160 ms` round-trip time**).

```sh node=node-tcp-client title="Configure tcp-client (10.50.0.10/24) & check TCP window scaling"
ip addr flush dev eth0
ip addr add 10.50.0.10/24 dev eth0
ip link set eth0 up
sysctl net.ipv4.tcp_window_scaling net.ipv4.tcp_sack
```

```sh node=node-tcp-server title="Configure tcp-server (10.50.0.20/24)"
ip addr flush dev eth0
ip addr add 10.50.0.20/24 dev eth0
ip link set eth0 up
```

Verify the ~160 ms round-trip delay with 8 ICMP pings:

```sh node=node-tcp-client title="Measure baseline RTT (~160 ms) across link-lossy-wan"
ping -c 8 10.50.0.20
```

- [ ] Configured both hosts and confirmed ~160 ms round-trip latency across `link-lossy-wan`.

---

## Step 2: Record `.pcap` & Transfer 128 KB Over TCP

1. Click the highlighted wire **`tcp-client:eth0 ── tcp-server:eth0`** (`link-lossy-wan`) on the canvas and click **Record `.pcap`**.
2. Start a TCP sink on `tcp-server:9090` that receives data and replies with a confirmation banner:

```sh node=node-tcp-server title="Start TCP receiver on tcp-server:9090"
sh -c '(cat > /dev/null; printf "RECEIVED_128KB_OK\n") | nc -l -p 9090 &'
```

3. Stream **128 KB** (`~90` full-sized `1448 B` MSS segments — practically guaranteeing ~4–6 dropped packets at 5% loss!) from `tcp-client`:

```sh node=node-tcp-client title="Send 128 KB stream from tcp-client to tcp-server:9090"
sh -c 'dd if=/dev/zero bs=1024 count=128 2>/dev/null | tr "\0" "A" | nc -N 10.50.0.20 9090 || dd if=/dev/zero bs=1024 count=128 2>/dev/null | tr "\0" "A" | nc -w 2 10.50.0.20 9090'
```

- [ ] Recorded a 128 KB TCP stream over the 80 ms / 5% loss link.

---

## Step 3: Dissect Handshake, Dup ACKs & Retransmissions in `tcpflowy`

Click **`link-lossy-wan`** on the canvas and hit the indigo **Stop & Dissect with tcpflowy** button!

Explore the dissected `10.50.0.10 ↔ 10.50.0.20:9090` flow in the **`Captures & tcpflowy`** pane:

1. **Conversations Table (Left Pane)**:
   - Check the red **`X retrans`** badge right on the flow row and note total duration (`duration_sec`).
2. **Sequence Timeline Tab (Right Pane)**:
   - **Three-Way Handshake (Frames #1–#3)**:
     - `#1`: `SYN` (`───────▶`) `Seq=0 Ack=0 Len=0 Win=64240` at `+0.00ms`
     - `#2`: `SYN, ACK` (`◀───────`) `Seq=0 Ack=1 Len=0 Win=65160` at `~+160ms`
     - `#3`: `ACK` (`───────▶`) `Seq=1 Ack=1 Len=0` — notice `Win=...` jumps once RFC 1323 **Window Scaling (`WS`)** kicks in!
   - **Duplicate ACKs & Fast Retransmit**:
     - Scroll down until you spot a crimson **`RETRANS`** pill (and **`OUT-OF-ORDER`** pills on segments that arrived after a dropped sequence hole).
     - Look immediately *above* the `RETRANS` row: you will see `tcp-server` sending repeated `◀─────── ACK` segments carrying the **exact same `Ack=` number** (**Duplicate ACKs**) telling `tcp-client` which byte offset went missing!
3. **Stream Payload & DPI Tab**:
   - Notice Shannon Entropy is **`0.00 bits/B`** (`LOW ENTROPY` because our payload was repeated `'A'` bytes!), yet TCP delivered all 131,072 bytes cleanly despite 5% raw frame loss!

<details>
<summary>Hint / Why does Window Scaling only appear as a multiplier AFTER the SYN/SYN-ACK?</summary>

Per **RFC 7323 (TCP Extensions for High Performance)**, the `Window Scale` shift count (`0..14`) is negotiated *only* inside the `SYN` and `SYN-ACK` TCP options—never on regular `ACK` or data segments. Once `tshark` / `tcpflowy` observes both `SYN` and `SYN-ACK`, it multiplies subsequent 16-bit `th_win` header values by $2^{\text{shift}}$ to show the true calculated receive window!
</details>

- [ ] Located the 3-way handshake, scaled `Win=` values, Duplicate `ACK`s, and `RETRANS` badges in `tcpflowy`.

---

## Step 4: Live Experiment — 0% Loss vs. 15% Loss

Let's prove the **Mathis TCP Throughput Equation** ($\text{BW}_{\max} \approx \frac{\text{MSS}}{\text{RTT} \cdot \sqrt{p}}$) empirically:

1. Click **`link-lossy-wan`**, drag **Packet Loss** down to **`0%`** (keeping Latency at `80 ms`), record a new `.pcap`, and run the exact same 128 KB transfer:

```sh node=node-tcp-server title="Re-arm TCP receiver on tcp-server:9090"
sh -c 'cat > /dev/null < /dev/tcp/0.0.0.0/9090 2>/dev/null || nc -l -p 9090 > /dev/null &'
```

```sh node=node-tcp-client title="Re-run 128 KB transfer & compare duration!"
sh -c 'dd if=/dev/zero bs=1024 count=128 2>/dev/null | tr "\0" "B" | nc -w 2 10.50.0.20 9090'
```

2. Stop & dissect in `tcpflowy` — observe **`0 retrans`** and a fraction of the completion time! Now try **`15%` Packet Loss** to watch exponential **RTO (Retransmission Timeout)** stalls when retransmitted packets themselves get dropped!

- [ ] Compared `0%` vs `5%` / `15%` loss captures in `tcpflowy` and observed congestion collapse firsthand.
