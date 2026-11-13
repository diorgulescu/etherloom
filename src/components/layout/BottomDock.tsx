import {
  Activity,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Maximize2,
  Minimize2,
  Monitor,
  PanelBottom,
  PictureInPicture2,
  Plus,
  Radio,
  Scissors,
  Sliders,
  Sparkles,
  Terminal,
  Waves,
  X,
} from "lucide-react";
import type {
  CaptureFileInfo,
  ConsoleTabSession,
  TcpflowyEnvStatus,
  TcpflowyInstallProgress,
  VmConsoleSubMode,
  VmDisplayMode,
  WireEdgeData,
} from "../../types/studio";
import type { EtherloomFlowNode } from "../canvas/EtherloomNode";
import type { EtherloomWireEdgeType } from "../canvas/EtherloomWireEdge";
import { VmConsoleTabContent } from "../console/VmConsoleTabContent";
import { TcpflowyInspectorPane } from "../inspector/TcpflowyInspectorPane";
import { formatThroughput } from "../../utils/topology";

export type ActiveWorkspaceTabId = `vm:${string}` | "link" | "tcpflowy";

interface BottomDockProps {
  open: boolean;
  expanded: boolean;
  floating: boolean;
  activeTabId: ActiveWorkspaceTabId;
  consoleTabs: ConsoleTabSession[];
  vmNodes: EtherloomFlowNode[];
  selectedEdge: EtherloomWireEdgeType | null;
  capturesDir?: string;
  captures: CaptureFileInfo[];
  selectedPcapPath: string | null;
  dissectNonce: number;
  tcpflowyStatus: TcpflowyEnvStatus | null;
  tcpflowyProgress: TcpflowyInstallProgress | null;
  installingTcpflowy: boolean;
  onSelectTab: (tabId: ActiveWorkspaceTabId) => void;
  onOpenVmTab: (nodeId: string, mode?: VmConsoleSubMode) => void;
  onCloseVmTab: (nodeId: string) => void;
  onChangeVmTabMode: (nodeId: string, mode: VmConsoleSubMode) => void;
  onToggleVmRun: (nodeId: string) => void;
  onOpenNodeSettings: (nodeId: string) => void;
  onChangeVmDisplayMode: (nodeId: string, mode: VmDisplayMode) => void;
  onUpdateSelectedEdge: (patch: Partial<WireEdgeData>) => void;
  onTogglePcapRecording: (edgeId: string) => void;
  onStopAndDissect: (edgeId: string) => void;
  onToggleLiveWireshark: (edgeId: string) => void;
  onSelectPcap: (pcapPath: string | null) => void;
  onRefreshCaptures: () => Promise<void>;
  onInstallTcpflowy: () => Promise<void>;
  onOpenSettingsTcpflowy: () => void;
  onNotify: (kind: "ok" | "error", text: string) => void;
  onToggleOpen: () => void;
  onToggleExpanded: () => void;
  onToggleFloating: () => void;
}

export function BottomDock({
  open,
  expanded,
  floating,
  activeTabId,
  consoleTabs,
  vmNodes,
  selectedEdge,
  capturesDir,
  captures,
  selectedPcapPath,
  dissectNonce,
  tcpflowyStatus,
  tcpflowyProgress,
  installingTcpflowy,
  onSelectTab,
  onOpenVmTab,
  onCloseVmTab,
  onChangeVmTabMode,
  onToggleVmRun,
  onOpenNodeSettings,
  onChangeVmDisplayMode,
  onUpdateSelectedEdge,
  onTogglePcapRecording,
  onStopAndDissect,
  onToggleLiveWireshark,
  onSelectPcap,
  onRefreshCaptures,
  onInstallTcpflowy,
  onOpenSettingsTcpflowy,
  onNotify,
  onToggleOpen,
  onToggleExpanded,
  onToggleFloating,
}: BottomDockProps) {
  const vmMap = new Map(vmNodes.map((n) => [n.id, n]));
  const openVmSet = new Set(consoleTabs.map((t) => t.nodeId));
  const unopenedVms = vmNodes.filter((n) => !openVmSet.has(n.id));
  const edgeData = selectedEdge?.data;

  const containerClass = floating
    ? open
      ? expanded
        ? "fixed inset-5 rounded-2xl border border-slate-300 dark:border-zinc-700 bg-white/98 dark:bg-zinc-900/98 backdrop-blur-xl shadow-2xl flex flex-col z-40"
        : "fixed bottom-10 right-4 w-[min(920px,94vw)] h-[min(540px,72vh)] rounded-2xl border border-slate-300 dark:border-zinc-700 bg-white/98 dark:bg-zinc-900/98 backdrop-blur-xl shadow-2xl flex flex-col z-40"
      : "hidden"
    : `${
        !open ? "h-9" : expanded ? "h-[72vh]" : "h-72"
      } shrink-0 border-t border-slate-200/90 dark:border-zinc-800/90 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md flex flex-col transition-[height] duration-200 z-10`;

  const workspaceBody = (
    <section className={containerClass}>
      {/* Multi-Tab Header Bar */}
      <div className="h-9 px-2.5 border-b border-slate-200/70 dark:border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto min-w-0 py-0.5">
          {/* Open Per-VM Dual-Console Tabs */}
          {consoleTabs.map((tab) => {
            const vm = vmMap.get(tab.nodeId);
            if (!vm) return null;
            const tabId: ActiveWorkspaceTabId = `vm:${tab.nodeId}`;
            const isActive = open && activeTabId === tabId;
            const st = vm.data.status;
            const ModeIcon = tab.mode === "display" ? Monitor : Terminal;

            return (
              <div
                key={tab.nodeId}
                className={`group inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-md text-xs font-medium whitespace-nowrap border transition-colors ${
                  isActive
                    ? "bg-sky-500/15 border-sky-500/35 text-sky-700 dark:text-sky-300"
                    : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectTab(tabId);
                    if (!open) onToggleOpen();
                  }}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      st === "running"
                        ? "bg-emerald-500"
                        : st === "booting"
                        ? "bg-amber-400 animate-pulse"
                        : "bg-slate-400 dark:bg-zinc-600"
                    }`}
                  />
                  <ModeIcon className="w-3 h-3 opacity-80" />
                  <span className="font-mono">{vm.data.label}</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseVmTab(tab.nodeId);
                  }}
                  title={`Close ${vm.data.label} console tab`}
                  className="p-0.5 rounded hover:bg-slate-200/80 dark:hover:bg-zinc-700 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Quick Add VM Console Selector if unopened VMs exist */}
          {unopenedVms.length > 0 && (
            <div className="relative inline-flex items-center">
              <Plus className="w-3 h-3 text-slate-400 absolute left-2 pointer-events-none" />
              <select
                aria-label="Open VM Console Tab"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onOpenVmTab(e.target.value);
                  }
                }}
                className="pl-6 pr-2 py-1 rounded-md text-[11px] bg-slate-100/80 hover:bg-slate-200/70 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-slate-200/70 dark:border-zinc-700/70 cursor-pointer focus:outline-none"
              >
                <option value="">Console…</option>
                {unopenedVms.map((vm) => (
                  <option key={vm.id} value={vm.id}>
                    {vm.data.label} ({vm.data.guestFamily ?? "vm"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-zinc-800 shrink-0" />

          {/* Studio Link & Flow Inspector Tabs */}
          <button
            type="button"
            onClick={() => {
              onSelectTab("link");
              if (!open) onToggleOpen();
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              open && activeTabId === "link"
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Link &amp; Wiretap</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab("tcpflowy");
              if (!open) onToggleOpen();
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              open && activeTabId === "tcpflowy"
                ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
            }`}
          >
            <Waves className="w-3.5 h-3.5" />
            <span>Captures &amp; tcpflowy</span>
            {captures.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                {captures.length}
              </span>
            )}
          </button>
        </div>

        {/* Right Controls: Pop-Out Floating / Maximize / Collapse */}
        <div className="flex items-center gap-1 shrink-0">
          {open && (
            <>
              <button
                type="button"
                onClick={onToggleFloating}
                title={
                  floating
                    ? "Dock Console Back to Bottom"
                    : "Pop Out Floating Console Workspace"
                }
                className={`p-1 rounded transition-colors ${
                  floating
                    ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                    : "hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400"
                }`}
              >
                {floating ? (
                  <PanelBottom className="w-3.5 h-3.5" />
                ) : (
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={onToggleExpanded}
                title={expanded ? "Restore Console Size" : "Maximize Console"}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400"
              >
                {expanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onToggleOpen}
            title={open ? "Minimize Console Dock" : "Expand Console Dock"}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400"
          >
            {open ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Active Tab Content */}
      {open && (
        <div className="flex-1 min-h-0 overflow-hidden p-2.5">
          {/* Keep all open VM console tabs mounted so xterm scrollback & VNC sessions stay live */}
          {consoleTabs.map((tab) => {
            const vm = vmMap.get(tab.nodeId);
            if (!vm) return null;
            return (
              <VmConsoleTabContent
                key={tab.nodeId}
                node={vm}
                active={activeTabId === `vm:${tab.nodeId}`}
                mode={tab.mode}
                onChangeMode={(nextMode) =>
                  onChangeVmTabMode(tab.nodeId, nextMode)
                }
                onToggleRun={onToggleVmRun}
                onOpenNodeSettings={onOpenNodeSettings}
                onChangeDisplayMode={onChangeVmDisplayMode}
              />
            );
          })}

          {/* Empty state if an active `vm:*` tab was closed and no tabs remain */}
          {activeTabId.startsWith("vm:") && consoleTabs.length === 0 && (
            <div className="h-full rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800 p-4 flex items-center justify-center text-xs text-slate-500 dark:text-zinc-400">
              Double-click any VM node on the canvas (or click its Console icon)
              to open an interactive Serial + UEFI Graphical session.
            </div>
          )}

          {activeTabId === "link" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 h-full overflow-y-auto">
              {selectedEdge && edgeData ? (
                <>
                  <div className="md:col-span-2 rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                        Wire {edgeData.sourcePortLabel} ──{" "}
                        {edgeData.targetPortLabel} •{" "}
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">
                          {edgeData.pps} pps (
                          {formatThroughput(edgeData.bytesPerSec)})
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSelectedEdge({ adminUp: !edgeData.adminUp })
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                          edgeData.adminUp
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                            : "bg-rose-500/15 border-rose-500/35 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        <Scissors className="w-3.5 h-3.5" />
                        {edgeData.adminUp
                          ? "Link Up (Cut Cable)"
                          : "Cable Cut (Restore)"}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-1">
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                          Latency ({edgeData.latencyMs} ms)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={300}
                          value={edgeData.latencyMs}
                          onChange={(e) =>
                            onUpdateSelectedEdge({
                              latencyMs: Number(e.target.value),
                            })
                          }
                          className="w-full accent-sky-500"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                          Jitter (±{edgeData.jitterMs} ms)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          value={edgeData.jitterMs}
                          onChange={(e) =>
                            onUpdateSelectedEdge({
                              jitterMs: Number(e.target.value),
                            })
                          }
                          className="w-full accent-sky-500"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                          Packet Loss ({edgeData.lossPercent}%)
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={50}
                          step={0.5}
                          value={edgeData.lossPercent}
                          onChange={(e) =>
                            onUpdateSelectedEdge({
                              lossPercent: Number(e.target.value),
                            })
                          }
                          className="w-full accent-amber-500"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800 p-3 flex flex-col justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-800 dark:text-zinc-100 flex items-center justify-between gap-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-sky-500" />
                          <span>Zero-Root Wiretap</span>
                        </span>
                        {edgeData.capturingPcap && (
                          <span className="text-[10px] font-mono text-rose-600 dark:text-rose-400">
                            REC • {edgeData.capturedPackets ?? 0} pkts
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                        Mirrors raw Ethernet II UDP datagrams into libpcap{" "}
                        <code className="font-mono">.pcap</code> files or named
                        FIFO pipes for live Wireshark.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onTogglePcapRecording(selectedEdge.id)}
                          className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium transition-colors ${
                            edgeData.capturingPcap
                              ? "bg-rose-600 hover:bg-rose-500 text-white"
                              : "bg-sky-600 hover:bg-sky-500 text-white"
                          }`}
                        >
                          <Radio
                            className={`w-3.5 h-3.5 ${
                              edgeData.capturingPcap ? "animate-pulse" : ""
                            }`}
                          />
                          <span>
                            {edgeData.capturingPcap
                              ? "Stop .pcap"
                              : "Record .pcap"}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onToggleLiveWireshark(selectedEdge.id)}
                          className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium border transition-colors ${
                            edgeData.liveWireshark
                              ? "bg-sky-600 text-white border-sky-500"
                              : "bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/30 text-sky-700 dark:text-sky-300"
                          }`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>
                            {edgeData.liveWireshark
                              ? "Stop Wireshark"
                              : "Live Wireshark"}
                          </span>
                        </button>
                      </div>

                      {edgeData.capturingPcap && (
                        <button
                          type="button"
                          onClick={() => onStopAndDissect(selectedEdge.id)}
                          className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Stop &amp; Dissect with tcpflowy</span>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="md:col-span-3 rounded-lg bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800 p-4 flex items-center justify-center text-xs text-slate-500 dark:text-zinc-400">
                  Click or right-click any Ethernet wire on the canvas to
                  inspect live PPS/throughput, cut/restore the cable, or tune
                  latency, jitter, and packet loss.
                </div>
              )}
            </div>
          )}

          {activeTabId === "tcpflowy" && (
            <TcpflowyInspectorPane
              capturesDir={capturesDir}
              captures={captures}
              selectedPcapPath={selectedPcapPath}
              dissectNonce={dissectNonce}
              tcpflowyStatus={tcpflowyStatus}
              installProgress={tcpflowyProgress}
              installingTcpflowy={installingTcpflowy}
              onSelectPcap={onSelectPcap}
              onRefreshCaptures={onRefreshCaptures}
              onInstallTcpflowy={onInstallTcpflowy}
              onOpenSettingsTcpflowy={onOpenSettingsTcpflowy}
              onNotify={onNotify}
            />
          )}
        </div>
      )}
    </section>
  );

  if (!floating) {
    return workspaceBody;
  }

  return (
    <>
      {workspaceBody}
      {/* Slim placeholder bar at bottom when Console Workspace is popped out */}
      <div className="h-8 shrink-0 border-t border-slate-200/90 dark:border-zinc-800/90 bg-white/90 dark:bg-zinc-900/90 px-3 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <PictureInPicture2 className="w-3.5 h-3.5 text-sky-500" />
          <span>
            Console Workspace is popped out ({consoleTabs.length} VM tab
            {consoleTabs.length === 1 ? "" : "s"} active)
          </span>
        </span>
        <div className="flex items-center gap-2">
          {!open && (
            <button
              type="button"
              onClick={onToggleOpen}
              className="text-sky-600 dark:text-sky-400 font-medium hover:underline"
            >
              Show Floating Window
            </button>
          )}
          <button
            type="button"
            onClick={onToggleFloating}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200"
          >
            <PanelBottom className="w-3 h-3" />
            <span>Dock to Bottom</span>
          </button>
        </div>
      </div>
    </>
  );
}
