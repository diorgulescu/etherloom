import type { Edge } from "@xyflow/react";
import type { EtherloomFlowNode } from "../components/canvas/EtherloomNode";
import type {
  DiskBus,
  FirmwareType,
  GuestArch,
  GuestFamily,
  NicModel,
  NodeKind,
  NodePort,
  TopologyDocument,
  WireEdgeData,
  WorkspaceLink,
  WorkspaceNode,
} from "../types/studio";

export type EtherloomWireEdge = Edge<WireEdgeData, "etherloomWire">;

/**
 * Generates a QEMU OUI (`52:54:00`) unicast MAC address.
 */
export function generateQemuMac(seed?: number, portIndex = 0): string {
  if (typeof seed === "number") {
    const b3 = ((seed >> 8) & 0xff).toString(16).padStart(2, "0");
    const b4 = (seed & 0xff).toString(16).padStart(2, "0");
    const b5 = (portIndex & 0xff).toString(16).padStart(2, "0");
    return `52:54:00:${b3}:${b4}:${b5}`;
  }
  const randByte = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  return `52:54:00:${randByte()}:${randByte()}:${randByte()}`;
}

/**
 * Resolves the canonical guest NIC prefix for a node kind / guest OS family.
 */
export function nicPrefixForFamily(
  kind: NodeKind,
  guestFamily: GuestFamily | null | undefined,
  osProfileId?: string | null,
  nicModel?: NicModel | null
): string {
  if (kind === "l2_switch" || kind === "l1_hub") {
    return "p";
  }
  const prof = (osProfileId ?? "").toLowerCase();
  const model: NicModel = nicModel ?? "virtio-net-pci";

  if (prof === "mikrotik-chr") return "ether";
  if (prof === "9front") return "/net/ether";
  if (prof === "omnios") return model === "virtio-net-pci" ? "vioif" : "e1000g";
  if (prof === "dragonflybsd") {
    if (model === "virtio-net-pci") return "vtnet";
    if (model === "rtl8139") return "re";
    return "em";
  }
  if (prof === "haiku") {
    if (model === "virtio-net-pci") return "/dev/net/virtio/";
    if (model === "rtl8139") return "/dev/net/rtl8139/";
    if (model === "pcnet") return "/dev/net/pcnet/";
    return "/dev/net/ipro1000/";
  }
  if (prof === "freedos") return "pkt";

  switch (guestFamily) {
    case "openbsd":
      if (model === "virtio-net-pci") return "vio";
      if (model === "e1000") return "em";
      if (model === "rtl8139") return "rl";
      if (model === "pcnet") return "pcn";
      return "ne";
    case "freebsd":
      if (model === "virtio-net-pci") return "vtnet";
      if (model === "e1000") return "em";
      if (model === "rtl8139") return "rl";
      if (model === "pcnet") return "le";
      return "ed";
    case "netbsd":
      if (model === "virtio-net-pci") return "vioif";
      if (model === "e1000") return "wm";
      if (model === "rtl8139") return "rtk";
      if (model === "pcnet") return "pcn";
      return "ne";
    case "linux":
    default:
      return "eth";
  }
}

/**
 * Formats an accurate interface label per OS profile + NIC model or switch/hub port index:
 * - OpenBSD: `vio0` (`virtio-net-pci`), `em0` (`e1000`), `rl0` (`rtl8139`), `pcn0` (`pcnet`)
 * - FreeBSD / OPNsense / pfSense: `vtnet0` (`virtio-net-pci`), `em0` (`e1000`), `rl0` (`rtl8139`)
 * - NetBSD: `vioif0` (`virtio-net-pci`), `wm0` (`e1000`), `rtk0` (`rtl8139`)
 * - MikroTik RouterOS CHR: `ether1`, `ether2` (1-based)
 * - 9front (Plan 9): `/net/ether0`, `/net/ether1`
 * - OmniOS: `e1000g0` / `vioif0`
 * - Haiku: `/dev/net/ipro1000/0`
 * - FreeDOS + mTCP: `PCNTPK 0x60` (`pcnet`), `NE2000 0x60` (`ne2k_pci`), `PKT 0x60` (`e1000`)
 * - Linux / OpenWrt / VyOS: `eth0`, `eth1`...
 * - Switch / Hub: `p1`..`p8` (1-based physical switch port numbering)
 */
export function formatInterfaceLabel(
  kind: NodeKind,
  guestFamily: GuestFamily | null | undefined,
  index: number,
  osProfileId?: string | null,
  nicModel?: NicModel | null
): string {
  if (kind === "l2_switch" || kind === "l1_hub") {
    return `p${index + 1}`;
  }
  const prof = (osProfileId ?? "").toLowerCase();
  const model: NicModel = nicModel ?? "virtio-net-pci";

  if (prof === "mikrotik-chr") {
    return `ether${index + 1}`;
  }
  if (prof === "freedos") {
    const vec = `0x${(0x60 + index).toString(16)}`;
    if (model === "pcnet") return `PCNTPK ${vec}`;
    if (model === "ne2k_pci") return `NE2000 ${vec}`;
    if (model === "rtl8139") return `RTSPKT ${vec}`;
    return `PKT ${vec}`;
  }

  const prefix = nicPrefixForFamily(kind, guestFamily, osProfileId, nicModel);
  return `${prefix}${index}`;
}

/**
 * Builds explicit `NodePort` entries for a node.
 * Note: for `l2_switch` and `l1_hub`, port IDs are `{nodeId}-p{index}` so they
 * match `PacketFabric::create_switch` / `create_hub` virtual port IDs 1:1.
 */
export function buildNodePorts(params: {
  nodeId: string;
  kind: NodeKind;
  guestFamily: GuestFamily | null;
  osProfileId?: string | null;
  nicModel?: NicModel | null;
  count: number;
  seed?: number;
}): NodePort[] {
  const { nodeId, kind, guestFamily, osProfileId, nicModel, count, seed } =
    params;
  return Array.from({ length: count }, (_, idx) => ({
    id: `${nodeId}-p${idx}`,
    index: idx,
    label: formatInterfaceLabel(kind, guestFamily, idx, osProfileId, nicModel),
    mac: generateQemuMac(seed, idx),
    nicModel: kind === "vm" ? nicModel ?? null : null,
    ipLabel: null,
    notes: null,
  }));
}

/**
 * Converts a single React Flow node into a declarative `WorkspaceNode` for `topology.toml` / IPC.
 */
export function flowNodeToWorkspaceNode(node: EtherloomFlowNode): WorkspaceNode {
  const d = node.data;
  return {
    id: node.id,
    name: d.label,
    kind: d.kind,
    guest_family: d.guestFamily ?? null,
    os_profile_id: d.osProfileId ?? null,
    arch: (d.arch as GuestArch | null | undefined) ?? null,
    nic_model: (d.nicModel as NicModel | null | undefined) ?? null,
    firmware: (d.firmware as FirmwareType | null | undefined) ?? null,
    disk_bus: (d.diskBus as DiskBus | null | undefined) ?? null,
    template_id: d.templateId ?? null,
    disk_path: d.diskPath ?? null,
    disk_size_gb: d.diskSizeGb ?? null,
    boot_media_path: d.bootMediaPath ?? null,
    boot_media_bus: d.bootMediaBus ?? null,
    vcpus: d.vcpus ?? null,
    memory_mb: d.memoryMb ?? null,
    display_mode: d.kind === "vm" ? d.displayMode : null,
    notes: d.notes ?? null,
    position: {
      x: Math.round(node.position.x * 10) / 10,
      y: Math.round(node.position.y * 10) / 10,
    },
    ports: d.ports.map((p, idx) => ({
      id: p.id,
      index: idx,
      label: p.label,
      mac: p.mac,
      nic_model: p.nicModel ?? null,
      ip_label: p.ipLabel?.trim() ? p.ipLabel.trim() : null,
      notes: p.notes?.trim() ? p.notes.trim() : null,
    })),
  };
}

/**
 * Serializes React Flow nodes & wire edges into a portable `TopologyDocument` (`topology.toml`).
 */
export function flowToTopologyDocument(params: {
  name: string;
  notes?: string | null;
  createdAtMs?: number;
  nodes: EtherloomFlowNode[];
  edges: EtherloomWireEdge[];
}): TopologyDocument {
  const wsNodes = params.nodes.map(flowNodeToWorkspaceNode);

  const wsLinks: WorkspaceLink[] = params.edges
    .map((edge): WorkspaceLink | null => {
      const sourcePort =
        edge.data?.sourcePortId || edge.sourceHandle || "";
      const targetPort =
        edge.data?.targetPortId || edge.targetHandle || "";
      if (!sourcePort || !targetPort) {
        return null;
      }
      return {
        id: edge.id,
        source_node: edge.source,
        source_port: sourcePort,
        target_node: edge.target,
        target_port: targetPort,
        admin_up: edge.data?.adminUp ?? true,
        impairments: {
          latency_ms: edge.data?.latencyMs ?? 0,
          jitter_ms: edge.data?.jitterMs ?? 0,
          loss_percent: edge.data?.lossPercent ?? 0,
        },
        notes: edge.data?.notes?.trim() ? edge.data.notes.trim() : null,
      };
    })
    .filter((item): item is WorkspaceLink => item !== null);

  return {
    schema_version: 1,
    name: params.name.trim() || "Untitled Lab",
    notes: params.notes?.trim() ? params.notes.trim() : null,
    created_at_ms: params.createdAtMs ?? 0,
    updated_at_ms: Date.now(),
    nodes: wsNodes,
    links: wsLinks,
  };
}

/**
 * Deserializes a loaded `TopologyDocument` (`topology.toml`) into React Flow nodes and wire edges.
 */
export function topologyDocumentToFlow(doc: TopologyDocument): {
  nodes: EtherloomFlowNode[];
  edges: EtherloomWireEdge[];
} {
  const portLabelById = new Map<string, string>();

  const nodes: EtherloomFlowNode[] = doc.nodes.map((wn) => {
    const ports: NodePort[] = wn.ports.map((wp, idx) => {
      portLabelById.set(wp.id, wp.label);
      return {
        id: wp.id,
        index: wp.index ?? idx,
        label: wp.label,
        mac: wp.mac,
        nicModel: wp.nic_model ?? null,
        ipLabel: wp.ip_label ?? null,
        notes: wp.notes ?? null,
      };
    });

    return {
      id: wn.id,
      type: "etherloomNode",
      position: { x: wn.position.x, y: wn.position.y },
      data: {
        label: wn.name,
        kind: wn.kind,
        guestFamily: wn.guest_family ?? null,
        osProfileId: wn.os_profile_id ?? null,
        arch: wn.arch ?? (wn.kind === "vm" ? "aarch64" : null),
        nicModel: wn.nic_model ?? (wn.kind === "vm" ? "virtio-net-pci" : null),
        firmware: wn.firmware ?? (wn.kind === "vm" ? "uefi" : null),
        diskBus: wn.disk_bus ?? (wn.kind === "vm" ? "virtio-blk" : null),
        templateId: wn.template_id ?? null,
        diskPath: wn.disk_path ?? null,
        diskSizeGb: wn.disk_size_gb ?? 8,
        bootMediaPath: wn.boot_media_path ?? null,
        bootMediaBus: wn.boot_media_bus ?? "auto",
        notes: wn.notes ?? null,
        status: "stopped",
        vcpus: wn.vcpus ?? (wn.kind === "vm" ? 2 : null),
        memoryMb: wn.memory_mb ?? (wn.kind === "vm" ? 512 : null),
        displayMode: wn.display_mode ?? "vnc",
        ports,
      },
    };
  });

  const edges: EtherloomWireEdge[] = doc.links.map((wl) => {
    const srcLabel = portLabelById.get(wl.source_port) ?? wl.source_port;
    const dstLabel = portLabelById.get(wl.target_port) ?? wl.target_port;
    return {
      id: wl.id,
      type: "etherloomWire",
      source: wl.source_node,
      target: wl.target_node,
      sourceHandle: wl.source_port,
      targetHandle: wl.target_port,
      data: {
        sourcePortId: wl.source_port,
        sourcePortLabel: srcLabel,
        targetPortId: wl.target_port,
        targetPortLabel: dstLabel,
        adminUp: wl.admin_up,
        latencyMs: wl.impairments?.latency_ms ?? 0,
        jitterMs: wl.impairments?.jitter_ms ?? 0,
        lossPercent: wl.impairments?.loss_percent ?? 0,
        notes: wl.notes ?? null,
        capturingPcap: false,
        pps: 0,
        bytesPerSec: 0,
        txPackets: 0,
        rxPackets: 0,
        droppedPackets: 0,
      },
    };
  });

  return { nodes, edges };
}

export function formatThroughput(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0 B/s";
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
