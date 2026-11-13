import { useCallback, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type IsValidConnection,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Cable, MousePointerClick, ShieldCheck } from "lucide-react";
import { EtherloomBackdropOrnament, EtherloomMark } from "../brand";
import {
  EtherloomNode,
  type EtherloomFlowNode,
} from "../canvas/EtherloomNode";
import {
  EtherloomWireEdge,
  type EtherloomWireEdgeType,
} from "../canvas/EtherloomWireEdge";
import { WireInspectorPopover } from "../canvas/WireInspectorPopover";
import {
  PALETTE_DRAG_MIME,
  type PaletteDropPayload,
} from "./LeftSidebar";
import type {
  BaseTemplateInfo,
  CatalogComponent,
  WireEdgeData,
} from "../../types/studio";

const nodeTypes: NodeTypes = {
  etherloomNode: EtherloomNode,
};

const edgeTypes: EdgeTypes = {
  etherloomWire: EtherloomWireEdge,
};

interface WorkspaceCanvasProps {
  nodes: EtherloomFlowNode[];
  edges: EtherloomWireEdgeType[];
  selectedEdgeId: string | null;
  wirePopoverOpen: boolean;
  resolvedTheme: "light" | "dark";
  onNodesChange: OnNodesChange<EtherloomFlowNode>;
  onEdgesChange: OnEdgesChange<EtherloomWireEdgeType>;
  onConnect: OnConnect;
  onSelectNode: (nodeId: string | null) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  onSelectEdge: (edgeId: string | null, openPopover?: boolean) => void;
  onCloseWirePopover: () => void;
  onUpdateEdgeData: (edgeId: string, patch: Partial<WireEdgeData>) => void;
  onTogglePcapRecording: (edgeId: string) => void;
  onStopAndDissect: (edgeId: string) => void;
  onToggleLiveWireshark: (edgeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onOpenFlowInspector: () => void;
  onDropCatalogComponent: (
    component: CatalogComponent,
    position: { x: number; y: number }
  ) => void;
  onDropBaseTemplate: (
    template: BaseTemplateInfo,
    position: { x: number; y: number }
  ) => void;
}

function WorkspaceCanvasInner({
  nodes,
  edges,
  selectedEdgeId,
  wirePopoverOpen,
  resolvedTheme,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onNodeDoubleClick,
  onSelectEdge,
  onCloseWirePopover,
  onUpdateEdgeData,
  onTogglePcapRecording,
  onStopAndDissect,
  onToggleLiveWireshark,
  onDeleteEdge,
  onOpenFlowInspector,
  onDropCatalogComponent,
  onDropBaseTemplate,
}: WorkspaceCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();

  const isValidConnection = useCallback<
    IsValidConnection<EtherloomWireEdgeType>
  >(
    (conn: Connection | EtherloomWireEdgeType) => {
      if (!conn.source || !conn.target) return false;
      if (conn.source === conn.target) return false;
      const srcPort = conn.sourceHandle;
      const dstPort = conn.targetHandle;
      if (!srcPort || !dstPort || srcPort === dstPort) return false;

      // Ensure neither interface port is already occupied by an existing cable
      const occupied = edges.some((e) => {
        const ea = e.data?.sourcePortId ?? e.sourceHandle;
        const eb = e.data?.targetPortId ?? e.targetHandle;
        return (
          ea === srcPort ||
          eb === srcPort ||
          ea === dstPort ||
          eb === dstPort
        );
      });
      return !occupied;
    },
    [edges]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw) as PaletteDropPayload;
        const pos = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        const centeredPos = { x: pos.x - 115, y: pos.y - 45 };
        if (parsed.kind === "catalog") {
          onDropCatalogComponent(parsed.component, centeredPos);
        } else if (parsed.kind === "template") {
          onDropBaseTemplate(parsed.template, centeredPos);
        }
      } catch {
        // Ignore malformed drag data
      }
    },
    [onDropBaseTemplate, onDropCatalogComponent, screenToFlowPosition]
  );

  const inspectedEdge =
    wirePopoverOpen && selectedEdgeId
      ? edges.find((e) => e.id === selectedEdgeId) ?? null
      : null;

  const nodeNameMap = new Map<string, string>(
    nodes.map((n) => [n.id, n.data.label])
  );

  return (
    <main
      className="flex-1 relative min-w-0 min-h-0 bg-slate-100/80 dark:bg-[#0D1321]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        colorMode={resolvedTheme}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          onSelectEdge(null, false);
          onSelectNode(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          onNodeDoubleClick(node.id);
        }}
        onEdgeClick={(_, edge) => {
          onSelectNode(null);
          onSelectEdge(edge.id, true);
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          onSelectNode(null);
          onSelectEdge(edge.id, true);
        }}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectEdge(null, false);
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        defaultEdgeOptions={{
          type: "etherloomWire",
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.35}
          color={resolvedTheme === "dark" ? "#1E2D45" : "#CBD5E1"}
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as EtherloomFlowNode["data"] | undefined;
            if (d?.kind === "l2_switch" || d?.kind === "l1_hub")
              return "#22D3EE";
            if (d?.status === "running") return "#10B981";
            const arch = d?.arch ?? "aarch64";
            if (arch !== "aarch64") return "#6366F1";
            return resolvedTheme === "dark" ? "#334155" : "#64748B";
          }}
          maskColor={
            resolvedTheme === "dark"
              ? "rgba(9, 14, 24, 0.74)"
              : "rgba(241, 245, 249, 0.74)"
          }
          maskStrokeColor={resolvedTheme === "dark" ? "#22D3EE" : "#0EA5E9"}
          maskStrokeWidth={1.5}
          className="!rounded-xl !border !border-slate-200/80 dark:!border-[rgba(34,211,238,0.18)] !bg-white/90 dark:!bg-[#111827]/90 !backdrop-blur-md !shadow-lg"
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>

      {/* Gentle Radial Vignette so glowing Patchbay nodes & Loom cables pop */}
      {resolvedTheme === "dark" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              "radial-gradient(circle at 50% 48%, transparent 54%, rgba(6, 10, 19, 0.56) 100%)",
          }}
        />
      )}

      {/* Ornamental Woven Circuit Backdrop when Workspace Canvas is Empty */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center z-10 px-6">
          <EtherloomBackdropOrnament
            rasterVariant="ornament"
            opacityClassName="opacity-20"
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-72"
          />
          <div className="relative flex flex-col items-center text-center max-w-md rounded-2xl bg-white/85 dark:bg-[#111827]/85 backdrop-blur-md border border-slate-200/80 dark:border-[rgba(34,211,238,0.18)] px-6 py-5 shadow-xl">
            <EtherloomMark size={44} />
            <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Empty Patchbay Canvas
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Drag an <strong>L2 Switch</strong>, <strong>Golden OS Template</strong>,
              or <strong>Guest OS Profile</strong> from the left palette onto the
              loom, or open <strong>Academy</strong> to launch a pre-wired lab.
            </p>
          </div>
        </div>
      )}

      {/* Subtle Floating Topology HUD Pill */}
      <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-2 z-20">
        <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/88 dark:bg-[#111827]/88 backdrop-blur-md border border-slate-200/80 dark:border-[rgba(34,211,238,0.16)] text-[11px] text-slate-600 dark:text-slate-300 shadow-md">
          <Cable className="w-3.5 h-3.5 text-[#22D3EE]" />
          <span className="font-mono">
            <strong className="text-slate-900 dark:text-slate-100">
              {nodes.length}
            </strong>{" "}
            Nodes •{" "}
            <strong className="text-slate-900 dark:text-slate-100">
              {edges.length}
            </strong>{" "}
            Wires
          </span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-[#34D399] font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            Zero-Root
          </span>
          <span className="hidden md:inline text-slate-300 dark:text-slate-700">
            |
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <MousePointerClick className="w-3 h-3 text-[#22D3EE]/80" />
            Drag ring-jacks to cable • Double-click VM for console
          </span>
        </div>
      </div>

      {/* Floating Wire Inspector Bar / Popover when clicking or right-clicking any wire */}
      {inspectedEdge && inspectedEdge.data && (
        <div className="pointer-events-none absolute top-3 right-3 z-30">
          <WireInspectorPopover
            edgeId={inspectedEdge.id}
            sourceNodeName={
              nodeNameMap.get(inspectedEdge.source) ?? inspectedEdge.source
            }
            targetNodeName={
              nodeNameMap.get(inspectedEdge.target) ?? inspectedEdge.target
            }
            data={inspectedEdge.data}
            onUpdate={(patch) => onUpdateEdgeData(inspectedEdge.id, patch)}
            onTogglePcapRecording={onTogglePcapRecording}
            onStopAndDissect={onStopAndDissect}
            onToggleLiveWireshark={onToggleLiveWireshark}
            onDeleteWire={onDeleteEdge}
            onOpenFlowInspector={onOpenFlowInspector}
            onClose={onCloseWirePopover}
          />
        </div>
      )}
    </main>
  );
}

export function WorkspaceCanvas(props: WorkspaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
