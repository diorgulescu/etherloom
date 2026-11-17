import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  GripVertical,
  Layers,
  Maximize2,
  Minimize2,
  Monitor,
  PanelBottom,
  PictureInPicture2,
  Plus,
  Radio,
  Scissors,
  Sliders,
  Terminal,
  X,
} from "lucide-react";
import { SignalWaveformIcon } from "../brand";
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
import {
  formatByteSize,
  formatDurationMmSs,
  formatThroughput,
} from "../../utils/topology";

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
  wiresharkAvailable: boolean;
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
  onStartPcapRecording: (edgeId: string) => void;
  onStopAndSavePcap: (edgeId: string) => void;
  onStopAndOpenWireshark: (edgeId: string) => void;
  onStopAndDissect: (edgeId: string) => void;
  onToggleLiveWireshark: (edgeId: string) => void;
  onSelectPcap: (pcapPath: string | null) => void;
  onRefreshCaptures: () => Promise<void>;
  onInstallTcpflowy: () => Promise<void>;
  onRefreshTcpflowyStatus?: () => void;
  onOpenSettingsTcpflowy: () => void;
  onNotify: (
    kind: "ok" | "error",
    text: string,
    actionLabel?: string,
    onAction?: () => void
  ) => void;
  onToggleOpen: () => void;
  onToggleExpanded: () => void;
  onToggleFloating: () => void;
}

const MIN_FLOATING_WIDTH = 460;
const MIN_FLOATING_HEIGHT = 260;
const FLOATING_VIEWPORT_MARGIN = 16;

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

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
  wiresharkAvailable,
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
  onStartPcapRecording,
  onStopAndSavePcap,
  onStopAndOpenWireshark,
  onStopAndDissect,
  onToggleLiveWireshark,
  onSelectPcap,
  onRefreshCaptures,
  onInstallTcpflowy,
  onRefreshTcpflowyStatus,
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

  const isCapturing = Boolean(edgeData?.capturingPcap);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [fallbackStartMs, setFallbackStartMs] = useState<number>(() =>
    Date.now()
  );

  const sectionRef = useRef<HTMLElement | null>(null);
  const [floatingPos, setFloatingPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [floatingSize, setFloatingSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragSessionRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const resizeSessionRef = useRef<{
    pointerId: number;
    dir: ResizeDirection;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const isMoveableFloating = floating && open && !expanded;

  const clampFloatingSize = useCallback((width: number, height: number) => {
    const maxW = Math.max(
      MIN_FLOATING_WIDTH,
      window.innerWidth - FLOATING_VIEWPORT_MARGIN
    );
    const maxH = Math.max(
      MIN_FLOATING_HEIGHT,
      window.innerHeight - FLOATING_VIEWPORT_MARGIN
    );
    return {
      width: Math.round(Math.min(Math.max(MIN_FLOATING_WIDTH, width), maxW)),
      height: Math.round(Math.min(Math.max(MIN_FLOATING_HEIGHT, height), maxH)),
    };
  }, []);

  const clampFloatingPos = useCallback(
    (x: number, y: number, width: number, height: number) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const minVisibleX = Math.min(240, width);
      const minX = Math.min(8, -(width - minVisibleX));
      const maxX = Math.max(8, vw - minVisibleX);
      const minY = 8;
      const maxY = Math.max(8, vh - Math.min(height, 48));
      return {
        x: Math.round(Math.min(Math.max(minX, x), maxX)),
        y: Math.round(Math.min(Math.max(minY, y), maxY)),
      };
    },
    []
  );

  useEffect(() => {
    if (!floating || (!floatingPos && !floatingSize)) return;
    const onResize = () => {
      const rect = sectionRef.current?.getBoundingClientRect();
      const nextSize = floatingSize
        ? clampFloatingSize(floatingSize.width, floatingSize.height)
        : null;
      if (nextSize) {
        setFloatingSize(nextSize);
      }
      const w =
        nextSize?.width ??
        rect?.width ??
        Math.min(920, window.innerWidth * 0.94);
      const h =
        nextSize?.height ??
        rect?.height ??
        Math.min(540, window.innerHeight * 0.72);
      setFloatingPos((prev) =>
        prev ? clampFloatingPos(prev.x, prev.y, w, h) : null
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampFloatingPos, clampFloatingSize, floating, floatingPos, floatingSize]);

  useEffect(() => {
    if (!isMoveableFloating && (isDragging || isResizing)) {
      dragSessionRef.current = null;
      resizeSessionRef.current = null;
      setIsDragging(false);
      setIsResizing(false);
    }
  }, [isMoveableFloating, isDragging, isResizing]);

  const handleHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMoveableFloating || e.button !== 0 || isResizing) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        "button, select, input, textarea, a, option, [data-no-drag]"
      )
    ) {
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragSessionRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setFloatingPos(
      (prev) =>
        prev ?? clampFloatingPos(rect.left, rect.top, rect.width, rect.height)
    );
    setIsDragging(true);
  };

  const handleHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    setFloatingPos(
      clampFloatingPos(
        e.clientX - sess.offsetX,
        e.clientY - sess.offsetY,
        sess.width,
        sess.height
      )
    );
  };

  const handleHeaderPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragSessionRef.current = null;
    setIsDragging(false);
  };

  const handleResizePointerDown =
    (dir: ResizeDirection) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMoveableFloating || e.button !== 0) return;
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeSessionRef.current = {
        pointerId: e.pointerId,
        dir,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        startWidth: rect.width,
        startHeight: rect.height,
      };
      setFloatingPos(
        (prev) => prev ?? { x: Math.round(rect.left), y: Math.round(rect.top) }
      );
      setFloatingSize(
        (prev) => prev ?? clampFloatingSize(rect.width, rect.height)
      );
      setIsResizing(true);
    };

  const handleResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sess = resizeSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = Math.max(MIN_FLOATING_WIDTH, vw - FLOATING_VIEWPORT_MARGIN);
    const maxH = Math.max(MIN_FLOATING_HEIGHT, vh - FLOATING_VIEWPORT_MARGIN);

    const dx = e.clientX - sess.startClientX;
    const dy = e.clientY - sess.startClientY;

    let nextLeft = sess.startLeft;
    let nextTop = sess.startTop;
    let nextWidth = sess.startWidth;
    let nextHeight = sess.startHeight;

    if (sess.dir.includes("e")) {
      const maxEastWidth = Math.max(
        MIN_FLOATING_WIDTH,
        Math.min(maxW, vw - 8 - sess.startLeft)
      );
      nextWidth = Math.min(
        Math.max(MIN_FLOATING_WIDTH, sess.startWidth + dx),
        maxEastWidth
      );
    } else if (sess.dir.includes("w")) {
      const rightEdge = sess.startLeft + sess.startWidth;
      const maxWestWidth = Math.max(
        MIN_FLOATING_WIDTH,
        Math.min(maxW, rightEdge - 8)
      );
      nextWidth = Math.min(
        Math.max(MIN_FLOATING_WIDTH, sess.startWidth - dx),
        maxWestWidth
      );
      nextLeft = rightEdge - nextWidth;
    }

    if (sess.dir.includes("s")) {
      const maxSouthHeight = Math.max(
        MIN_FLOATING_HEIGHT,
        Math.min(maxH, vh - 8 - sess.startTop)
      );
      nextHeight = Math.min(
        Math.max(MIN_FLOATING_HEIGHT, sess.startHeight + dy),
        maxSouthHeight
      );
    } else if (sess.dir.includes("n")) {
      const bottomEdge = sess.startTop + sess.startHeight;
      const maxNorthHeight = Math.max(
        MIN_FLOATING_HEIGHT,
        Math.min(maxH, bottomEdge - 8)
      );
      nextHeight = Math.min(
        Math.max(MIN_FLOATING_HEIGHT, sess.startHeight - dy),
        maxNorthHeight
      );
      nextTop = bottomEdge - nextHeight;
    }

    setFloatingSize({
      width: Math.round(nextWidth),
      height: Math.round(nextHeight),
    });
    setFloatingPos({
      x: Math.round(nextLeft),
      y: Math.round(nextTop),
    });
  };

  const handleResizePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sess = resizeSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    resizeSessionRef.current = null;
    setIsResizing(false);
  };

  useEffect(() => {
    if (!isCapturing) return;
    setFallbackStartMs(Date.now());
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [isCapturing, selectedEdge?.id]);

  const effectiveStartMs = edgeData?.captureStartedAtMs ?? fallbackStartMs;
  const elapsedMs = isCapturing ? Math.max(0, nowMs - effectiveStartMs) : 0;

  const containerClass = floating
    ? open
      ? expanded
        ? "fixed inset-5 rounded-2xl border border-slate-300 dark:border-[rgba(34,211,238,0.25)] bg-white dark:bg-[#111827] shadow-2xl flex flex-col z-40"
        : `fixed ${floatingPos ? "" : "bottom-10 right-4 "}${
            floatingSize ? "" : "w-[min(920px,94vw)] h-[min(540px,72vh)] "
          }rounded-2xl border border-slate-300 dark:border-[rgba(34,211,238,0.25)] bg-white dark:bg-[#111827] shadow-2xl flex flex-col z-40${
            isDragging || isResizing ? " select-none" : ""
          }`
      : "hidden"
    : `${
        !open ? "h-9" : expanded ? "h-[72vh]" : "h-72"
      } shrink-0 border-t border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] bg-white dark:bg-[#111827] flex flex-col transition-[height] duration-200 z-10`;

  const floatingStyle =
    isMoveableFloating && (floatingPos || floatingSize)
      ? {
          ...(floatingPos
            ? { left: `${floatingPos.x}px`, top: `${floatingPos.y}px` }
            : {}),
          ...(floatingSize
            ? {
                width: `${floatingSize.width}px`,
                height: `${floatingSize.height}px`,
              }
            : {}),
        }
      : undefined;

  const resizeHandles: Array<{
    dir: ResizeDirection;
    className: string;
  }> = [
    { dir: "n", className: "top-0 left-3 right-3 h-1.5 -mt-0.5 cursor-ns-resize" },
    { dir: "s", className: "bottom-0 left-3 right-3 h-2 -mb-0.5 cursor-ns-resize" },
    { dir: "w", className: "left-0 top-3 bottom-3 w-2 -ml-0.5 cursor-ew-resize" },
    { dir: "e", className: "right-0 top-3 bottom-3 w-2 -mr-0.5 cursor-ew-resize" },
    { dir: "nw", className: "top-0 left-0 w-3.5 h-3.5 -mt-0.5 -ml-0.5 cursor-nwse-resize" },
    { dir: "ne", className: "top-0 right-0 w-3.5 h-3.5 -mt-0.5 -mr-0.5 cursor-nesw-resize" },
    { dir: "sw", className: "bottom-0 left-0 w-3.5 h-3.5 -mb-0.5 -ml-0.5 cursor-nesw-resize" },
    { dir: "se", className: "bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-1" },
  ];

  const workspaceBody = (
    <section
      ref={sectionRef}
      className={containerClass}
      style={floatingStyle}
    >
      {/* 8-Direction Resize Handles for Popped-Out Floating Console */}
      {isMoveableFloating &&
        resizeHandles.map(({ dir, className }) => (
          <div
            key={dir}
            data-no-drag
            onPointerDown={handleResizePointerDown(dir)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
            title={
              dir === "se"
                ? "Drag edges or corners to resize floating console"
                : undefined
            }
            className={`absolute z-50 touch-none ${className}`}
          >
            {dir === "se" && (
              <svg
                viewBox="0 0 10 10"
                className="w-2.5 h-2.5 text-slate-400/80 dark:text-cyan-400/60 pointer-events-none"
              >
                <path
                  d="M9 1L1 9M9 5L5 9M9 8.5L8.5 9"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
        ))}

      {/* Multi-Tab Header Bar */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerEnd}
        onPointerCancel={handleHeaderPointerEnd}
        className={`h-9 px-2.5 border-b border-slate-200/70 dark:border-[rgba(34,211,238,0.12)] flex items-center justify-between gap-1.5 shrink-0 ${
          isMoveableFloating
            ? isDragging
              ? "cursor-grabbing select-none"
              : "cursor-grab"
            : ""
        }`}
      >
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {isMoveableFloating && (
            <div
              role="presentation"
              onDoubleClick={() => {
                setFloatingPos(null);
                setFloatingSize(null);
              }}
              title="Drag to move floating console • Drag edges/corners to resize (double-click to reset)"
              className="shrink-0 p-1 -ml-1 rounded text-slate-400 hover:text-cyan-600 dark:text-slate-500 dark:hover:text-[#22D3EE] hover:bg-slate-100/80 dark:hover:bg-[#162032] transition-colors"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </div>
          )}

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
                    ? "bg-cyan-500/12 border-[#22D3EE]/40 text-cyan-800 dark:text-[#22D3EE]"
                    : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#162032]"
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
                        ? "bg-[#10B981]"
                        : st === "booting"
                        ? "bg-[#F59E0B] animate-pulse"
                        : "bg-slate-400 dark:bg-slate-600"
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
                  className="p-0.5 rounded hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
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
                className="pl-6 pr-5 py-1 rounded-md text-[11px] bg-slate-100/80 hover:bg-slate-200/70 dark:bg-[#162032] dark:hover:bg-[#1E2B42] text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-[rgba(34,211,238,0.16)] cursor-pointer focus:outline-none"
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

          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-800 shrink-0" />

          {/* Studio Link & Flow Inspector Tabs */}
          <button
            type="button"
            onClick={() => {
              onSelectTab("link");
              if (!open) onToggleOpen();
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap border transition-colors ${
              open && activeTabId === "link"
                ? "bg-cyan-500/12 border-[#22D3EE]/35 text-cyan-800 dark:text-[#22D3EE]"
                : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#162032]"
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
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap border transition-colors ${
              open && activeTabId === "tcpflowy"
                ? "bg-indigo-500/15 border-[#6366F1]/40 text-indigo-700 dark:text-[#818CF8]"
                : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#162032]"
            }`}
          >
            <SignalWaveformIcon className="w-3.5 h-3" />
            <span>Captures &amp; tcpflowy</span>
            {captures.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/20 text-indigo-700 dark:text-[#818CF8]">
                {captures.length}
              </span>
            )}
          </button>
          </div>
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
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE]"
                    : "hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-500 dark:text-slate-400"
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
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-500 dark:text-slate-400"
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
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#162032] text-slate-500 dark:text-slate-400"
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
            <div className="h-full rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.14)] p-4 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              Double-click any VM node on the canvas (or click its Console icon)
              to open an interactive Serial + UEFI Graphical session.
            </div>
          )}

          {activeTabId === "link" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 h-full overflow-y-auto">
              {selectedEdge && edgeData ? (
                <>
                  <div className="md:col-span-2 rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.14)] p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        Wire{" "}
                        <span className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                          {edgeData.sourcePortLabel}
                        </span>{" "}
                        ──{" "}
                        <span className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                          {edgeData.targetPortLabel}
                        </span>{" "}
                        •{" "}
                        <span className="font-mono text-emerald-600 dark:text-[#34D399]">
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
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
                            : "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-[#F43F5E]"
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
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
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
                          className="w-full accent-[#22D3EE]"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
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
                          className="w-full accent-[#22D3EE]"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
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
                          className="w-full accent-[#F59E0B]"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.14)] p-3 flex flex-col justify-between gap-2">
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-between gap-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <SignalWaveformIcon
                            animated={Boolean(
                              edgeData.capturingPcap || edgeData.liveWireshark
                            )}
                            className="w-4 h-3 text-[#22D3EE]"
                          />
                          <span>Zero-Root Wiretap</span>
                        </span>
                        {edgeData.capturingPcap && (
                          <span className="text-[10px] font-mono font-semibold text-[#22D3EE]">
                            REC {formatDurationMmSs(elapsedMs)}
                          </span>
                        )}
                      </div>

                      {edgeData.capturingPcap ? (
                        <div className="rounded-md bg-cyan-500/10 border border-cyan-400/30 px-2 py-1 flex items-center justify-between text-[10px] font-mono text-cyan-800 dark:text-slate-200">
                          <span className="text-[#34D399] font-semibold">
                            {edgeData.capturedPackets ?? 0} pkts
                          </span>
                          <span className="text-slate-400">
                            {formatByteSize(edgeData.capturedBytes ?? 0)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Mirrors raw Ethernet II UDP datagrams into libpcap{" "}
                          <code className="font-mono">.pcap</code> files or
                          named FIFO pipes for live Wireshark.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {edgeData.capturingPcap ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onStopAndSavePcap(selectedEdge.id)}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-semibold bg-[#10B981] hover:bg-[#34D399] text-[#090E18] transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Stop &amp; Save PCAP…</span>
                          </button>

                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              disabled={!wiresharkAvailable}
                              onClick={() =>
                                onStopAndOpenWireshark(selectedEdge.id)
                              }
                              title={
                                !wiresharkAvailable
                                  ? "Wireshark is not installed on macOS (brew install --cask wireshark)"
                                  : "Finalize .pcap and open in Wireshark"
                              }
                              className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[11px] font-semibold bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                            >
                              <SignalWaveformIcon className="w-3.5 h-2.5" />
                              <span className="truncate">Stop &amp; Wireshark</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onStopAndDissect(selectedEdge.id)}
                              className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[11px] font-semibold bg-[#6366F1] hover:bg-[#818CF8] text-white transition-colors"
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span className="truncate">Stop &amp; Dissect</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => onToggleLiveWireshark(selectedEdge.id)}
                            className={`w-full inline-flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
                              edgeData.liveWireshark
                                ? "bg-[#22D3EE] text-slate-950 font-semibold border-[#22D3EE]"
                                : "bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400/30 text-cyan-700 dark:text-[#22D3EE]"
                            }`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>
                              {edgeData.liveWireshark
                                ? "Stop Live Wireshark FIFO"
                                : "Live Wireshark (FIFO Stream)"}
                            </span>
                          </button>
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => onStartPcapRecording(selectedEdge.id)}
                            className="inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-semibold bg-[#0891B2] hover:bg-[#06B6D4] text-white transition-colors"
                          >
                            <Radio className="w-3.5 h-3.5" />
                            <span>Record .pcap</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleLiveWireshark(selectedEdge.id)}
                            className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium border transition-colors ${
                              edgeData.liveWireshark
                                ? "bg-[#22D3EE] text-slate-950 font-semibold border-[#22D3EE]"
                                : "bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400/30 text-cyan-700 dark:text-[#22D3EE]"
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
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="md:col-span-3 rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.14)] p-4 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
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
              wiresharkAvailable={wiresharkAvailable}
              tcpflowyStatus={tcpflowyStatus}
              installProgress={tcpflowyProgress}
              installingTcpflowy={installingTcpflowy}
              onSelectPcap={onSelectPcap}
              onRefreshCaptures={onRefreshCaptures}
              onInstallTcpflowy={onInstallTcpflowy}
              onRefreshTcpflowyStatus={onRefreshTcpflowyStatus}
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
      <div className="h-8 shrink-0 border-t border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] bg-white dark:bg-[#111827] px-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <PictureInPicture2 className="w-3.5 h-3.5 text-[#22D3EE]" />
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
              className="text-cyan-600 dark:text-[#22D3EE] font-medium hover:underline"
            >
              Show Floating Window
            </button>
          )}
          <button
            type="button"
            onClick={onToggleFloating}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200"
          >
            <PanelBottom className="w-3 h-3" />
            <span>Dock to Bottom</span>
          </button>
        </div>
      </div>
    </>
  );
}
