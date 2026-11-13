# Lab 06 — Zero-Noise ARP & TCP Dissection with FreeDOS (`mTCP`)

When newcomers open Wireshark on a modern OS for the first time, they are immediately buried under dozens of unrequested packets—**ICMPv6 Router Solicitations**, **Duplicate Address Detection (DAD)**, **MLDv2 multicast joins**, **mDNS**, and **NTP**.

In this lab, we pair a **32-bit `i386` FreeDOS** machine (`32 MB` RAM under QEMU `TCG`, AMD `PCnet-PCI` NIC, Crynwr `PCNTPK` packet driver at `INT 0x60`, and Michael Brutman's **`mTCP`** user-space TCP/IP suite) with an IPv6-quieted **Alpine Linux** (`aarch64` `HVF`) responder. Because DOS is single-tasking and has no kernel background daemons, **zero frames ever touch the wire unless you press Enter**.

```diagram
   FreeDOS 1.3 (i386 TCG, 32 MB)                 Wire A                  Alpine Linux (aarch64 HVF)
 ┌───────────────────────────────┐            link-wire-a              ┌────────────────────────────┐
 │          dos-client           │════════════════════════════════════▶│         alpine-srv         │
 │   AMD PCnet-PCI (pcnet)       │   0 background packets at idle!     │   virtio-net-pci (eth0)    │
 │   PCNTPK INT 0x60 + mTCP      │   10.0.60.10/24 ───▶ 10.0.60.1/24   │   IPv6 disabled + :8080    │
 └───────────────────────────────┘                                     └────────────────────────────┘
```

---

## Step 1: Silence the Linux Peer *Before* Bringing `eth0` Up

Boot both nodes (**Start All** in the top toolbar). Before starting our packet capture, configure **`alpine-srv`** so the Linux kernel disables IPv6 on `eth0` **prior** to setting `eth0` `UP`, then launch a lightweight TCP listener on port `8080`:

```sh node=node-alpine-srv title="Silence IPv6 BEFORE link-up & start TCP :8080 responder on alpine-srv"
ip link set eth0 down
ip addr flush dev eth0
sysctl -w net.ipv6.conf.all.disable_ipv6=1
sysctl -w net.ipv6.conf.default.disable_ipv6=1
sysctl -w net.ipv6.conf.eth0.disable_ipv6=1
ip addr add 10.0.60.1/24 dev eth0
ip link set eth0 up
pkill -f "nc -l -p 8080" 2>/dev/null || true
sh -c 'while true; do printf "ACK_FROM_ALPINE\r\n" | nc -l -p 8080 >/tmp/last_dos_msg.txt; done &'
```

<details>
<summary>Under the Hood: Why must disable_ipv6=1 run BEFORE ip link set eth0 up?</summary>

The instant a Linux interface transitions to `IFF_UP` with IPv6 enabled, the kernel auto-generates an `fe80::/64` EUI-64 link-local address and immediately transmits **Neighbor Solicitation (DAD)**, **MLDv2 Multicast Listener Report**, and **ICMPv6 Router Solicitation (`ff02::2`)** frames onto the Ethernet wire. Disabling IPv6 while the interface is still `DOWN` guarantees `eth0` comes up in pure, silent IPv4-only mode!
</details>

- [ ] Silenced IPv6 on `alpine-srv`, assigned `10.0.60.1/24`, and started the `:8080` TCP listener.

---

## Step 2: Start `.pcap` Recording + Live Wireshark on Wire A

1. Click the highlighted cable **`link-wire-a`** (`dos-client:PCNTPK 0x60 ── alpine-srv:eth0`) or use the **Wiretap Actions** card above.
2. Start **Record `.pcap`** (and optionally click **Live Wireshark**).
3. Watch the live packet badge right on the canvas wire for 10 seconds: **`0 pkts`**! Neither FreeDOS nor the quieted Alpine server emits a single stray frame.

- [ ] Started `.pcap` capture on `link-wire-a` and confirmed **0 background packets** on the wire.

---

## Step 3: Load `PCNTPK` (`INT 0x60`) & Configure `mTCP` on FreeDOS

Double-click **`dos-client`** and select its **Display (`noVNC`)** console tab (FreeDOS uses classic BIOS VGA text mode). At the `C:\>` prompt, load the AMD PCnet-PCI packet driver on software interrupt `0x60`, write `C:\MTCP\MTCP.CFG`, and send **one** ICMP Echo Request:

```bat title="Type inside dos-client VGA console (FreeDOS C:\>)"
C:\FDOS\BIN\PCNTPK.COM INT=0x60
MKDIR C:\MTCP
ECHO PACKETINT 0x60 > C:\MTCP\MTCP.CFG
ECHO IPADDR 10.0.60.10 >> C:\MTCP\MTCP.CFG
ECHO NETMASK 255.255.255.0 >> C:\MTCP\MTCP.CFG
ECHO GATEWAY 10.0.60.1 >> C:\MTCP\MTCP.CFG
ECHO MTU 1500 >> C:\MTCP\MTCP.CFG
SET MTCPCFG=C:\MTCP\MTCP.CFG
TYPE C:\MTCP\MTCP.CFG
C:\FDOS\PROGS\MTCP\PING.EXE -count 1 10.0.60.1
```

*(Tip: Depending on the FreeDOS image layout, `PCNTPK.COM` and `mTCP` binaries such as `PING.EXE`, `NC.EXE`, and `HTGET.EXE` may already be in `%PATH%`—if so, simply run `pcntpk int=0x60` and `ping -count 1 10.0.60.1`!)*

Look at **`link-wire-a`**—the packet counter jumps from **`0`** to **exactly `4` packets**:
1. **Frame 1 (`ARP Request`)**: Broadcast `ff:ff:ff:ff:ff:ff` — *"Who has `10.0.60.1`? Tell `10.0.60.10`"*
2. **Frame 2 (`ARP Reply`)**: Unicast `52:54:00:60:00:10` — *"`10.0.60.1` is at `52:54:00:60:00:01`"*
3. **Frame 3 (`ICMP Echo Request`)**: `10.0.60.10 → 10.0.60.1`
4. **Frame 4 (`ICMP Echo Reply`)**: `10.0.60.1 → 10.0.60.10`

<details>
<summary>Under the Hood: How does a DOS Packet Driver (INT 0x60) + mTCP work without a kernel?</summary>

FreeDOS has no built-in TCP/IP stack in the OS kernel. Instead, `PCNTPK.COM` is a tiny Terminate-and-Stay-Resident (**TSR**) driver conforming to the 1989 **Crynwr Packet Driver Specification**. It hooks x86 software interrupt **`0x60`** to expose raw Ethernet II TX/RX callbacks. When you launch `PING.EXE` or `NC.EXE`, the `mTCP` library links ARP, IPv4, ICMP, and TCP directly inside the application binary, polling the NIC while running and vanishing from RAM the moment the command exits!
</details>

- [ ] Loaded `pcntpk int=0x60`, configured `C:\MTCP\MTCP.CFG`, and observed the exact 4 ARP + ICMP frames.

---

## Step 4: Pure TCP Session & `tcpflowy` Sequence/Ack Dissection

1. In **`dos-client`**, open a raw TCP connection to `alpine-srv:8080` using `mTCP` Netcat (`nc`), type a short message (`HELLO DOS`), and press **`Alt-X`** (or **`Ctrl-Z`** + `Enter`) to close cleanly:

```bat title="Open a clean TCP stream from FreeDOS mTCP to 10.0.60.1:8080"
nc -target 10.0.60.1 8080
```

*(Alternatively, run `htget http://10.0.60.1:8080/` to perform an automated non-interactive TCP connect, request, response, and `FIN` close in one shot!)*

2. Verify `alpine-srv` received your exact bytes:

```sh node=node-alpine-srv title="Check received payload on alpine-srv"
cat /tmp/last_dos_msg.txt
```

3. Click **Stop & Dissect with tcpflowy** on **`link-wire-a`** and open the **Captures & `tcpflowy`** tab in the Bottom Dock:
   - **Suppressed Noise Flows**: `0` — every single packet in the `.pcap` belongs to your experiment!
   - **3-Way Handshake**:
     - `C -> S` `SYN` (`Seq = 0`, `Len = 0`) — consumes 1 logical sequence number (`SYN` phantom byte).
     - `S -> C` `SYN, ACK` (`Seq = 0`, `Ack = 1`, `Len = 0`) — acknowledges client `SYN` and announces server ISN.
     - `C -> S` `ACK` (`Seq = 1`, `Ack = 1`, `Len = 0`) — connection `ESTABLISHED`.
   - **Payload `PSH, ACK` Byte Math**:
     - Notice how `S -> C` sends `"ACK_FROM_ALPINE\r\n"` (`17` bytes) at `Seq = 1`, advancing the next client `Ack` to `1 + 17 = 18`—and your FreeDOS message advances the server's `Ack` by the exact length of your string!
   - **4-Way `FIN` Teardown**: Each `FIN` flag consumes `+1` sequence number, ending in **`COMPLETE (FIN)`**.

- [ ] Dissected the zero-noise 3-way handshake, `PSH-ACK` byte math, and `FIN` teardown in `tcpflowy`.
