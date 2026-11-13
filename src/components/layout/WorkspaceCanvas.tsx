import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
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
import {
  Cable,
  Download,
  ExternalLink,
  FileSearch,
  Layers,
  MousePointerClick,
  Radio,
  Scissors,
  ShieldCheck,
  Sliders,
  Trash2,
} from "lucide-react";
import {
  EtherloomBackdropOrnament,
  EtherloomMark,
  SignalWaveformIcon,
} from "../brand";
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
import { formatByteSize, formatDurationMmSs } from "../../utils/topology";

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
  wiresharkAvailable: boolean;
  resolvedTheme: "light" | "dark";
  onNodesChange: OnNodesChange<EtherloomFlowNode>;
  onEdgesChange: OnEdgesChange<EtherloomWireEdgeType>;
  onConnect: OnConnect;
  onSelectNode: (nodeId: string | null) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  onSelectEdge: (edgeId: string | null, openPopover?: boolean) => void;
  onCloseWirePopover: () => void;
  onUpdateEdgeData: (edgeId: string, patch: Partial<WireEdgeData>) => void;
  onStartPcapRecording: (edgeId: string) => void;
  onStopAndSavePcap: (edgeId: string) => void;
  onStopAndOpenWireshark: (edgeId: string) => void;
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

interface WireContextMenuState {
  edgeId: string;
  x: number;
  y: number;
}

function WorkspaceCanvasInner({
  nodes,
  edges,
  selectedEdgeId,
  wirePopoverOpen,
  wiresharkAvailable,
  resolvedTheme,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onNodeDoubleClick,
  onSelectEdge,
  onCloseWirePopover,
  onUpdateEdgeData,
  onStartPcapRecording,
  onStopAndSavePcap,
  onStopAndOpenWireshark,
  onStopAndDissect,
  onToggleLiveWireshark,
  onDeleteEdge,
  onOpenFlowInspector,
  onDropCatalogComponent,
  onDropBaseTemplate,
}: WorkspaceCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const mainRef = useRef<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<WireContextMenuState | null>(
    null
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const contextMenuEdge = contextMenu
    ? edges.find((e) => e.id === contextMenu.edgeId) ?? null
    : null;

  useEffect(() => {
    if (!contextMenuEdge?.data?.capturingPcap) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [contextMenuEdge?.data?.capturingPcap]);

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
      ref={mainRef}
      className="flex-1 relative min-w-0 min-h-0 bg-slate-100/80 dark:bg-[#0D1321]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => {
        if (contextMenu) setContextMenu(null);
      }}
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
          setContextMenu(null);
          onSelectEdge(null, false);
          onSelectNode(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          setContextMenu(null);
          onNodeDoubleClick(node.id);
        }}
        onEdgeClick={(_, edge) => {
          setContextMenu(null);
          onSelectNode(null);
          onSelectEdge(edge.id, true);
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          const rect = mainRef.current?.getBoundingClientRect();
          const rawX = rect ? event.clientX - rect.left : 140;
          const rawY = rect ? event.clientY - rect.top : 120;
          const maxX = rect ? Math.max(16, rect.width - 284) : rawX;
          const maxY = rect ? Math.max(16, rect.height - 310) : rawY;
          onSelectNode(null);
          onSelectEdge(edge.id, false);
          setContextMenu({
            edgeId: edge.id,
            x: Math.min(Math.max(12, rawX), maxX),
            y: Math.min(Math.max(12, rawY), maxY),
          });
        }}
        onPaneClick={() => {
          setContextMenu(null);
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

      {/* Right-Click Wire Context Menu */}
      {contextMenu && contextMenuEdge && contextMenuEdge.data && (
        <div
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute z-40 w-[272px] rounded-xl bg-white/96 dark:bg-[#111827]/96 backdrop-blur-xl border border-slate-200/90 dark:border-[rgba(34,211,238,0.28)] shadow-2xl p-2 space-y-1.5 text-xs"
        >
          <div className="px-2 py-1 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
              <SignalWaveformIcon
                animated={Boolean(
                  contextMenuEdge.data.capturingPcap ||
                    contextMenuEdge.data.liveWireshark
                )}
                className="w-3.5 h-2.5 text-[#22D3EE] shrink-0"
              />
              <span className="truncate font-mono text-[11px]">
                {nodeNameMap.get(contextMenuEdge.source) ??
                  contextMenuEdge.source}
                :{contextMenuEdge.data.sourcePortLabel} ──{" "}
                {nodeNameMap.get(contextMenuEdge.target) ??
                  contextMenuEdge.target}
                :{contextMenuEdge.data.targetPortLabel}
              </span>
            </div>
            {contextMenuEdge.data.capturingPcap && (
              <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-cyan-700 dark:text-[#22D3EE]">
                <span>
                  ● REC{" "}
                  {formatDurationMmSs(
                    contextMenuEdge.data.captureStartedAtMs
                      ? nowMs - contextMenuEdge.data.captureStartedAtMs
                      : 0
                  )}
                </span>
                <span>
                  {contextMenuEdge.data.capturedPackets ?? 0} pkts •{" "}
                  {formatByteSize(contextMenuEdge.data.capturedBytes ?? 24)}
                </span>
              </div>
            )}
          </div>

          {contextMenuEdge.data.capturingPcap ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  const id = contextMenuEdge.id;
                  setContextMenu(null);
                  onStopAndSavePcap(id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left font-medium bg-emerald-500/12 hover:bg-emerald-500/22 border border-[#10B981]/40 text-emerald-800 dark:text-[#34D399] transition-colors"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Stop &amp; Save PCAP...</span>
              </button>

              <button
                type="button"
                disabled={!wiresharkAvailable}
                title={
                  wiresharkAvailable
                    ? "Flush & open capture in Wireshark (-r)"
                    : "Wireshark.app is not installed (brew install --cask wireshark)"
                }
                onClick={() => {
                  const id = contextMenuEdge.id;
                  setContextMenu(null);
                  onStopAndOpenWireshark(id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left font-medium bg-cyan-500/12 hover:bg-cyan-500/22 border border-[#22D3EE]/40 text-cyan-800 dark:text-[#22D3EE] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
              >
                <SignalWaveformIcon className="w-3.5 h-2.5 shrink-0" />
                <span>Stop &amp; Open in Wireshark</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const id = contextMenuEdge.id;
                  setContextMenu(null);
                  onStopAndDissect(id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left font-semibold bg-[#6366F1] hover:bg-[#818CF8] text-white transition-colors"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>Stop &amp; Dissect (tcpflowy)</span>
              </button>

              <button
                type="button"
                disabled={
                  !wiresharkAvailable && !contextMenuEdge.data.liveWireshark
                }
                onClick={() => {
                  const id = contextMenuEdge.id;
                  setContextMenu(null);
                  onToggleLiveWireshark(id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-700 dark:text-slate-300 disabled:opacity-45 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
                <span>
                  {contextMenuEdge.data.liveWireshark
                    ? "Stop Live Wireshark Stream"
                    : "Live Wireshark (FIFO Stream)"}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  const id = contextMenuEdge.id;
                  setContextMenu(null);
                  onStartPcapRecording(id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left font-medium hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-800 dark:text-slate-100 transition-colors"
              >
                <Radio className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                <span>Record .pcap on Wire</span>
              </button>

              <button
                type="button"
                disabled={
                  !wiresharkAvailable && !contextMenuEdge.data.liveWireshark
                }
                title={
                  wiresharkAvailable || contextMenuEdge.data.liveWireshark
                    ? "Stream live frames via named FIFO pipe into Wireshark"
                    : "Wireshark.app is not installed (brew install --cask wireshark)"
                }
                onClick={() => {
                  const id = contextMenuEdge.id;
                  setContextMenu(null);
                  onToggleLiveWireshark(id);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-700 dark:text-slate-200 disabled:opacity-45 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
                <span>
                  {contextMenuEdge.data.liveWireshark
                    ? "Stop Live Wireshark"
                    : "Live Wireshark Stream"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  onOpenFlowInspector();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-[#162032] text-indigo-700 dark:text-[#818CF8] transition-colors"
              >
                <FileSearch className="w-3.5 h-3.5 shrink-0" />
                <span>Open Captures &amp; tcpflowy</span>
              </button>
            </div>
          )}

          <div className="pt-1 border-t border-slate-200/80 dark:border-slate-800 space-y-0.5">
            <button
              type="button"
              onClick={() => {
                const id = contextMenuEdge.id;
                setContextMenu(null);
                onSelectEdge(id, true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-700 dark:text-slate-300 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
              <span>Wire Impairments &amp; Inspector...</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = contextMenuEdge.id;
                const nextUp = !contextMenuEdge.data?.adminUp;
                setContextMenu(null);
                onUpdateEdgeData(id, { adminUp: nextUp });
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-700 dark:text-slate-300 transition-colors"
            >
              <Scissors className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
              <span>
                {contextMenuEdge.data.adminUp
                  ? "Cut Cable (Link Down)"
                  : "Restore Cable (Link Up)"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = contextMenuEdge.id;
                setContextMenu(null);
                onDeleteEdge(id);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-rose-500/12 text-rose-600 dark:text-[#F43F5E] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Unplug &amp; Delete Wire</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Wire Inspector Bar / Popover when clicking a wire */}
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
            wiresharkAvailable={wiresharkAvailable}
            onUpdate={(patch) => onUpdateEdgeData(inspectedEdge.id, patch)}
            onStartPcapRecording={onStartPcapRecording}
            onStopAndSavePcap={onStopAndSavePcap}
            onStopAndOpenWireshark={onStopAndOpenWireshark}
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
