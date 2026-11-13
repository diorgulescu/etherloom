import type { Edge } from "@xyflow/react";
import type { EtherloomFlowNode } from "../components/canvas/EtherloomNode";
import type {
  GuestFamily,
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
  guestFamily: GuestFamily | null | undefined
): string {
  if (kind === "l2_switch" || kind === "l1_hub") {
    return "p";
  }
  switch (guestFamily) {
    case "openbsd":
      return "vio";
    case "freebsd":
      return "vtnet";
    case "netbsd":
      return "vioif";
    case "linux":
    default:
      return "eth";
  }
}

/**
 * Formats an accurate interface label per OS profile or switch/hub port index:
 * - OpenBSD: `vio0`, `vio1`...
 * - FreeBSD: `vtnet0`, `vtnet1`...
 * - NetBSD: `vioif0`, `vioif1`...
 * - Linux: `eth0`, `eth1`...
 * - Switch / Hub: `p1`..`p8` (1-based physical switch port numbering)
 */
export function formatInterfaceLabel(
  kind: NodeKind,
  guestFamily: GuestFamily | null | undefined,
  index: number
): string {
  if (kind === "l2_switch" || kind === "l1_hub") {
    return `p${index + 1}`;
  }
  const prefix = nicPrefixForFamily(kind, guestFamily);
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
  count: number;
  seed?: number;
}): NodePort[] {
  const { nodeId, kind, guestFamily, count, seed } = params;
  return Array.from({ length: count }, (_, idx) => ({
    id: `${nodeId}-p${idx}`,
    index: idx,
    label: formatInterfaceLabel(kind, guestFamily, idx),
    mac: generateQemuMac(seed, idx),
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
