import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  MemoryStick,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { sampleActivityMonitor } from "../../services/tauriBridge";
import type {
  ActivityMonitorSnapshot,
  NodeKind,
  NodePort,
  NodeRunStatus,
  PortLinkState,
  PortTrafficTelemetry,
  TopologyNodeData,
  VmProcessTelemetry,
} from "../../types/studio";

export interface ActivityMonitorNodeInput {
  id: string;
  data: TopologyNodeData;
  isGuidedSetup?: boolean;
}

interface ActivityMonitorModalProps {
  open: boolean;
  nodes: ActivityMonitorNodeInput[];
  onClose: () => void;
  onToggleNodeRun: (nodeId: string) => void;
  onOpenNodeConsole: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

type NodeFilterMode = "all" | "running" | "vms" | "switches";
type SortField = "name" | "status" | "cpu" | "memory" | "rx" | "tx";
type PollIntervalSec = 1 | 2 | 5 | 0; // 0 = paused

interface PortRowDetail {
  port: NodePort;
  linkState: PortLinkState;
  telemetry: PortTrafficTelemetry | null;
}

interface EnrichedNodeTelemetryRow {
  id: string;
  label: string;
  kind: NodeKind;
  isGuidedSetup: boolean;
  status: NodeRunStatus;
  pid: number | null;
  archLabel: string;
  accelLabel: string | null;
  allocatedCpus: number;
  allocatedRamMb: number;
  uptimeMs: number;
  cpuPercent: number;
  cpuNormalizedPercent: number;
  memoryBytes: number;
  residentBytes: number;
  threadCount: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  overlayDiskBytes: number;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxPacketsPerSec: number;
  txPacketsPerSec: number;
  rxBytesTotal: number;
  txBytesTotal: number;
  rxPacketsTotal: number;
  txPacketsTotal: number;
  droppedPacketsTotal: number;
  connectedPorts: number;
  totalPorts: number;
  portDetails: PortRowDetail[];
}

const SPARKLINE_POINTS = 30;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

function formatByteRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0.5) return "0 B/s";
  if (bytesPerSec >= 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  }
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSec)} B/s`;
}

function formatCountCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatUptime(ms: number): string {
  if (!ms || ms < 1000) return "—";
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(
      2,
      "0"
    )}s`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

function MiniSparkline({
  values,
  strokeColor,
  fillId,
}: {
  values: number[];
  strokeColor: string;
  fillId: string;
}) {
  const width = 112;
  const height = 28;
  if (values.length === 0) {
    return <div className="w-28 h-7" />;
  }

  const padded =
    values.length < SPARKLINE_POINTS
      ? [...Array(SPARKLINE_POINTS - values.length).fill(0), ...values]
      : values.slice(-SPARKLINE_POINTS);
  const maxVal = Math.max(1, ...padded);

  const pts = padded.map((v, idx) => {
    const x = (idx / (SPARKLINE_POINTS - 1)) * width;
    const y = height - 2 - (Math.min(v, maxVal) / maxVal) * (height - 5);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${pts.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.32" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${fillId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ActivityMonitorModal({
  open,
  nodes,
  onClose,
  onToggleNodeRun,
  onOpenNodeConsole,
  onSelectNode,
}: ActivityMonitorModalProps) {
  const [snapshot, setSnapshot] = useState<ActivityMonitorSnapshot | null>(
    null
  );
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollIntervalSec, setPollIntervalSec] = useState<PollIntervalSec>(2);
  const lastActiveIntervalRef = useRef<1 | 2 | 5>(2);
  const [filterMode, setFilterMode] = useState<NodeFilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("cpu");
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set()
  );

  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [netHistory, setNetHistory] = useState<number[]>([]);
  const inFlightRef = useRef(false);
  const hasSnapshotRef = useRef(false);

  const fetchSample = useCallback(async (isManual = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (isManual) setRefreshing(true);
    try {
      const snap = await sampleActivityMonitor();
      hasSnapshotRef.current = true;
      setSnapshot(snap);
      setError(null);
      setCpuHistory((prev) => [
        ...prev.slice(-(SPARKLINE_POINTS - 1)),
        snap.host.totalVmCpuPercent + snap.host.studioCpuPercent,
      ]);
      setNetHistory((prev) => [
        ...prev.slice(-(SPARKLINE_POINTS - 1)),
        snap.host.totalFabricBytesPerSec,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setLoadingInitial(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!hasSnapshotRef.current) {
      setLoadingInitial(true);
    }
    void fetchSample(false);
  }, [open, fetchSample]);

  useEffect(() => {
    if (!open || pollIntervalSec === 0) return;
    const timer = window.setInterval(() => {
      void fetchSample(false);
    }, pollIntervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [open, pollIntervalSec, fetchSample]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const rows = useMemo<EnrichedNodeTelemetryRow[]>(() => {
    if (!open || !Array.isArray(nodes)) return [];
    const vmById = new Map<string, VmProcessTelemetry>();
    for (const vm of snapshot?.vms ?? []) {
      vmById.set(vm.nodeId, vm);
    }
    const portMap = snapshot?.portTraffic ?? {};

    // Combine canvas nodes + any backend-tracked VMs not in `nodes`
    const seenIds = new Set<string>();
    const result: EnrichedNodeTelemetryRow[] = [];

    for (const node of nodes) {
      seenIds.add(node.id);
      const d = node.data;
      const vm = vmById.get(node.id);

      let rxBytesPerSec = 0;
      let txBytesPerSec = 0;
      let rxPacketsPerSec = 0;
      let txPacketsPerSec = 0;
      let rxBytesTotal = 0;
      let txBytesTotal = 0;
      let rxPacketsTotal = 0;
      let txPacketsTotal = 0;
      let droppedPacketsTotal = 0;
      let connectedPorts = 0;

      const portDetails: PortRowDetail[] = (d.ports ?? []).map((port) => {
        const pt = portMap[port.id] ?? null;
        const linkState: PortLinkState =
          d.portStates?.[port.id] ??
          (pt ? (pt.adminUp ? "up" : "cut") : "unplugged");
        if (pt || linkState !== "unplugged") {
          connectedPorts += 1;
        }
        if (pt) {
          rxBytesPerSec += pt.rxBytesPerSec;
          txBytesPerSec += pt.txBytesPerSec;
          rxPacketsPerSec += pt.rxPacketsPerSec;
          txPacketsPerSec += pt.txPacketsPerSec;
          rxBytesTotal += pt.rxBytes;
          txBytesTotal += pt.txBytes;
          rxPacketsTotal += pt.rxPackets;
          txPacketsTotal += pt.txPackets;
          droppedPacketsTotal += pt.droppedPackets;
        }
        return {
          port,
          linkState,
          telemetry: pt,
        };
      });

      const effectiveStatus: NodeRunStatus =
        d.kind !== "vm"
          ? "running"
          : vm?.status === "running"
          ? "running"
          : vm?.status === "starting"
          ? "booting"
          : d.status;

      const allocatedCpus = vm?.allocatedCpus ?? d.vcpus ?? 2;
      const allocatedRamMb = vm?.allocatedRamMb ?? d.memoryMb ?? 512;

      result.push({
        id: node.id,
        label: d.label || vm?.name || node.id,
        kind: d.kind,
        isGuidedSetup: Boolean(node.isGuidedSetup),
        status: effectiveStatus,
        pid: effectiveStatus === "running" ? vm?.pid ?? null : null,
        archLabel:
          d.kind === "vm"
            ? vm?.arch ?? d.arch ?? "aarch64"
            : d.kind === "l2_switch"
            ? "802.1D L2"
            : d.kind === "dhcp_server"
            ? "DHCPv4/v6"
            : d.kind === "nat_gateway"
            ? "Host NAT WAN"
            : "L1 Repeater",
        accelLabel:
          d.kind === "vm" && vm?.accel ? vm.accel.toUpperCase() : null,
        allocatedCpus,
        allocatedRamMb,
        uptimeMs: vm?.uptimeMs ?? 0,
        cpuPercent: vm?.cpuPercent ?? 0,
        cpuNormalizedPercent: vm?.cpuNormalizedPercent ?? 0,
        memoryBytes: vm?.memoryBytes ?? 0,
        residentBytes: vm?.residentBytes ?? 0,
        threadCount: vm?.threadCount ?? 0,
        diskReadBytes: vm?.diskReadBytes ?? 0,
        diskWriteBytes: vm?.diskWriteBytes ?? 0,
        overlayDiskBytes: vm?.overlayDiskBytes ?? 0,
        rxBytesPerSec,
        txBytesPerSec,
        rxPacketsPerSec,
        txPacketsPerSec,
        rxBytesTotal,
        txBytesTotal,
        rxPacketsTotal,
        txPacketsTotal,
        droppedPacketsTotal,
        connectedPorts,
        totalPorts: (d.ports ?? []).length,
        portDetails,
      });
    }

    // Include any standalone/guided VM tracked by VmManager not already in `nodes`
    for (const vm of snapshot?.vms ?? []) {
      if (seenIds.has(vm.nodeId)) continue;
      if (vm.status !== "running" && vm.status !== "starting") continue;
      result.push({
        id: vm.nodeId,
        label: vm.name,
        kind: "vm",
        isGuidedSetup: vm.nodeId.startsWith("setup-"),
        status: vm.status === "running" ? "running" : "booting",
        pid: vm.pid,
        archLabel: vm.arch,
        accelLabel: vm.accel ? vm.accel.toUpperCase() : null,
        allocatedCpus: vm.allocatedCpus,
        allocatedRamMb: vm.allocatedRamMb,
        uptimeMs: vm.uptimeMs,
        cpuPercent: vm.cpuPercent,
        cpuNormalizedPercent: vm.cpuNormalizedPercent,
        memoryBytes: vm.memoryBytes,
        residentBytes: vm.residentBytes,
        threadCount: vm.threadCount,
        diskReadBytes: vm.diskReadBytes,
        diskWriteBytes: vm.diskWriteBytes,
        overlayDiskBytes: vm.overlayDiskBytes,
        rxBytesPerSec: 0,
        txBytesPerSec: 0,
        rxPacketsPerSec: 0,
        txPacketsPerSec: 0,
        rxBytesTotal: 0,
        txBytesTotal: 0,
        rxPacketsTotal: 0,
        txPacketsTotal: 0,
        droppedPacketsTotal: 0,
        connectedPorts: 0,
        totalPorts: 0,
        portDetails: [],
      });
    }

    return result;
  }, [nodes, open, snapshot]);

  const counts = useMemo(() => {
    let running = 0;
    let vmsTotal = 0;
    let vmsRunning = 0;
    let switches = 0;
    for (const r of rows) {
      if (r.kind === "vm") {
        vmsTotal += 1;
        if (r.status === "running" || r.status === "booting") {
          vmsRunning += 1;
          running += 1;
        }
      } else {
        switches += 1;
        running += 1;
      }
    }
    return {
      all: rows.length,
      running,
      vmsTotal,
      vmsRunning,
      switches,
    };
  }, [rows]);

  const filteredAndSortedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (filterMode === "running") {
        if (r.kind === "vm" && r.status === "stopped") return false;
      } else if (filterMode === "vms") {
        if (r.kind !== "vm") return false;
      } else if (filterMode === "switches") {
        if (r.kind === "vm") return false;
      }

      if (!q) return true;
      return (
        r.label.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.archLabel.toLowerCase().includes(q) ||
        (r.pid !== null && String(r.pid).includes(q))
      );
    });

    const statusRank = (r: EnrichedNodeTelemetryRow): number => {
      if (r.kind === "vm" && r.status === "running") return 3;
      if (r.kind === "vm" && r.status === "booting") return 2;
      if (r.kind !== "vm") return 1;
      return 0;
    };

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.label.localeCompare(b.label);
          break;
        case "status":
          cmp = statusRank(a) - statusRank(b);
          break;
        case "cpu":
          cmp =
            a.cpuPercent - b.cpuPercent ||
            statusRank(a) - statusRank(b) ||
            a.rxBytesPerSec +
              a.txBytesPerSec -
              (b.rxBytesPerSec + b.txBytesPerSec);
          break;
        case "memory":
          cmp = a.memoryBytes - b.memoryBytes || statusRank(a) - statusRank(b);
          break;
        case "rx":
          cmp =
            a.rxBytesPerSec - b.rxBytesPerSec ||
            a.rxBytesTotal - b.rxBytesTotal;
          break;
        case "tx":
          cmp =
            a.txBytesPerSec - b.txBytesPerSec ||
            a.txBytesTotal - b.txBytesTotal;
          break;
      }
      if (cmp === 0) {
        return a.label.localeCompare(b.label);
      }
      return sortDesc ? -cmp : cmp;
    });

    return filtered;
  }, [rows, filterMode, searchQuery, sortField, sortDesc]);

  if (!open) return null;

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc((d) => !d);
    } else {
      setSortField(field);
      setSortDesc(field !== "name");
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const host = snapshot?.host;
  const totalFootprintBytes =
    (host?.totalVmMemoryBytes ?? 0) + (host?.studioMemoryBytes ?? 0);
  const hostMemRatio =
    host && host.hostTotalMemoryBytes > 0
      ? Math.min(100, (totalFootprintBytes / host.hostTotalMemoryBytes) * 100)
      : 0;

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDesc ? (
      <ArrowDown className="w-3 h-3 text-[#22D3EE] inline ml-0.5" />
    ) : (
      <ArrowUp className="w-3 h-3 text-[#22D3EE] inline ml-0.5" />
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 dark:bg-[#050810]/80"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Etherloom Activity Monitor"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-200 dark:border-[rgba(34,211,238,0.22)] bg-white dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 shadow-2xl overflow-hidden"
      >
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/90 dark:bg-[#111827] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/12 dark:bg-[#162032] border border-cyan-500/30 dark:border-[rgba(34,211,238,0.28)] flex items-center justify-center text-cyan-600 dark:text-[#22D3EE]">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">
                  Activity Monitor
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/12 text-emerald-700 dark:text-[#34D399] border border-emerald-500/25">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      pollIntervalSec === 0
                        ? "bg-amber-400"
                        : "bg-emerald-400 animate-pulse"
                    }`}
                  />
                  {pollIntervalSec === 0
                    ? "Paused"
                    : `Live • ${pollIntervalSec}s`}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real-time per-node CPU load, macOS physical memory footprint &
                PacketFabric network I/O
              </p>
            </div>
          </div>

          {/* Sampling Interval & Actions */}
          <div className="flex items-center gap-2">
            <div
              className="flex items-center bg-slate-200/75 dark:bg-[#090E18] p-0.5 rounded-lg border border-slate-300/70 dark:border-[rgba(34,211,238,0.16)] text-[11px] font-mono"
              role="group"
              aria-label="Sampling interval"
            >
              {([1, 2, 5] as const).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    lastActiveIntervalRef.current = sec;
                    setPollIntervalSec(sec);
                  }}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    pollIntervalSec === sec
                      ? "bg-white dark:bg-[#162032] text-cyan-700 dark:text-[#22D3EE] font-semibold shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  {sec}s
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPollIntervalSec((curr) =>
                    curr === 0 ? lastActiveIntervalRef.current : 0
                  )
                }
                title={
                  pollIntervalSec === 0
                    ? "Resume live polling"
                    : "Pause live polling"
                }
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                  pollIntervalSec === 0
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {pollIntervalSec === 0 ? (
                  <Play className="w-3 h-3 fill-current" />
                ) : (
                  <Pause className="w-3 h-3" />
                )}
                <span>{pollIntervalSec === 0 ? "Resume" : "Pause"}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void fetchSample(true)}
              title="Sample immediately"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.16)] bg-white dark:bg-[#162032] text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-[#22D3EE] transition-colors"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close Activity Monitor (Esc)"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#162032] dark:hover:text-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top 4 Host & Fabric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 px-5 py-3.5 bg-slate-50/50 dark:bg-[#0E1628] border-b border-slate-200 dark:border-[rgba(34,211,238,0.12)] shrink-0 tabular-nums">
          {/* CPU Card */}
          <div className="rounded-xl p-3 bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <Cpu className="w-3.5 h-3.5 text-[#22D3EE]" />
                <span>Guest VM CPU</span>
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                {(host?.totalVmCpuPercent ?? 0).toFixed(1)}%
              </div>
              <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 truncate">
                Studio {(host?.studioCpuPercent ?? 0).toFixed(1)}% •{" "}
                {host?.hostLogicalCpus ?? "—"} host cores
              </div>
            </div>
            <MiniSparkline
              values={cpuHistory}
              strokeColor="#22D3EE"
              fillId="el-cpu-spark"
            />
          </div>

          {/* Memory Card */}
          <div className="rounded-xl p-3 bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <MemoryStick className="w-3.5 h-3.5 text-[#818CF8]" />
                <span>Physical Memory</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {host && host.hostTotalMemoryBytes > 0
                  ? `${hostMemRatio.toFixed(1)}% of ${formatBytes(
                      host.hostTotalMemoryBytes
                    )}`
                  : ""}
              </span>
            </div>
            <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
              {formatBytes(host?.totalVmMemoryBytes ?? 0)}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-[#090E18] overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 dark:bg-[#818CF8] transition-all duration-300"
                  style={{ width: `${Math.max(2, hostMemRatio)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                +{formatBytes(host?.studioMemoryBytes ?? 0)} app
              </span>
            </div>
          </div>

          {/* Fabric Network Card */}
          <div className="rounded-xl p-3 bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <Network className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Fabric Throughput</span>
              </div>
              <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                {formatByteRate(host?.totalFabricBytesPerSec ?? 0)}
              </div>
              <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 truncate">
                {Math.round(host?.totalFabricPacketsPerSec ?? 0)} pkt/s across
                wires
              </div>
            </div>
            <MiniSparkline
              values={netHistory}
              strokeColor="#10B981"
              fillId="el-net-spark"
            />
          </div>

          {/* Active Topology Summary Card */}
          <div className="rounded-xl p-3 bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <Activity className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>Active Nodes</span>
              </div>
              {host?.studioPid ? (
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  Studio PID {host.studioPid}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
              {counts.vmsRunning} / {counts.vmsTotal}{" "}
              <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">
                VMs up
              </span>
            </div>
            <div className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 truncate">
              {counts.switches} Fabric Device
              {counts.switches === 1 ? "" : "s"} in PacketFabric
            </div>
          </div>
        </div>

        {/* Filter Bar & Search */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-[rgba(34,211,238,0.12)] bg-white dark:bg-[#0B1120] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                { id: "all", label: `All Nodes (${counts.all})` },
                { id: "running", label: `Running (${counts.running})` },
                { id: "vms", label: `VMs (${counts.vmsTotal})` },
                {
                  id: "switches",
                  label: `Fabric Devices (${counts.switches})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filterMode === tab.id
                    ? "bg-cyan-500/15 text-cyan-800 dark:text-[#22D3EE] border border-cyan-500/35"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#162032] border border-transparent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by node, arch, or PID…"
              className="w-full pl-8 pr-7 py-1.5 rounded-lg text-xs bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-rose-500/12 border border-rose-500/35 text-xs text-rose-700 dark:text-rose-300 shrink-0">
            Telemetry sample error: {error}
          </div>
        )}

        {/* Per-Node Resource Table */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loadingInitial && !snapshot ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin text-[#22D3EE]" />
              <p className="text-xs font-medium">
                Sampling node processes & PacketFabric counters…
              </p>
            </div>
          ) : filteredAndSortedRows.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <Server className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600 mb-2" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {rows.length === 0
                  ? "No nodes on the topology canvas yet"
                  : "No nodes match the current filter"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {rows.length === 0
                  ? "Drag an OS node or L2 Switch onto the canvas (or launch an Academy Lab) to inspect live CPU, memory, and network usage."
                  : "Try switching back to All Nodes or clearing the search filter."}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#111827] border-b border-slate-200 dark:border-[rgba(34,211,238,0.14)] text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 select-none">
                <tr>
                  <th
                    onClick={() => toggleSort("name")}
                    className="py-2.5 pl-4 pr-2 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
                  >
                    Node {renderSortIcon("name")}
                  </th>
                  <th
                    onClick={() => toggleSort("status")}
                    className="py-2.5 px-2 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
                  >
                    State / PID {renderSortIcon("status")}
                  </th>
                  <th
                    onClick={() => toggleSort("cpu")}
                    className="py-2.5 px-2 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
                  >
                    CPU Load {renderSortIcon("cpu")}
                  </th>
                  <th
                    onClick={() => toggleSort("memory")}
                    className="py-2.5 px-2 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
                  >
                    Memory {renderSortIcon("memory")}
                  </th>
                  <th
                    onClick={() => toggleSort("rx")}
                    className="py-2.5 px-2 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
                  >
                    Net RX (In) {renderSortIcon("rx")}
                  </th>
                  <th
                    onClick={() => toggleSort("tx")}
                    className="py-2.5 px-2 cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
                  >
                    Net TX (Out) {renderSortIcon("tx")}
                  </th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-[rgba(34,211,238,0.08)] text-xs tabular-nums">
                {filteredAndSortedRows.map((row) => {
                  const isExpanded = expandedNodeIds.has(row.id);
                  const isVm = row.kind === "vm";
                  const isRunning = row.status === "running";
                  const isBooting = row.status === "booting";
                  const allocBytes = row.allocatedRamMb * 1024 * 1024;
                  const memPct =
                    isVm && allocBytes > 0
                      ? Math.min(100, (row.memoryBytes / allocBytes) * 100)
                      : 0;

                  return (
                    <NodeResourceRowGroup
                      key={row.id}
                      row={row}
                      isExpanded={isExpanded}
                      isVm={isVm}
                      isRunning={isRunning}
                      isBooting={isBooting}
                      memPct={memPct}
                      onToggleExpand={() => toggleExpanded(row.id)}
                      onToggleRun={() => onToggleNodeRun(row.id)}
                      onOpenConsole={() => {
                        onOpenNodeConsole(row.id);
                        onClose();
                      }}
                      onFocusNode={
                        onSelectNode && !row.isGuidedSetup
                          ? () => {
                              onSelectNode(row.id);
                              onClose();
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Note */}
        <div className="px-5 py-2.5 border-t border-slate-200 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/90 dark:bg-[#111827] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>
            Click any node row to inspect per-interface (`eth0..n`) packet
            rates, MAC addresses & host CoW `.qcow2` disk I/O.
          </span>
          <span className="font-mono text-[10.5px]">
            Shortcut: <kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-[#090E18] text-slate-700 dark:text-slate-300">⌘⇧M</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}

function NodeResourceRowGroup({
  row,
  isExpanded,
  isVm,
  isRunning,
  isBooting,
  memPct,
  onToggleExpand,
  onToggleRun,
  onOpenConsole,
  onFocusNode,
}: {
  row: EnrichedNodeTelemetryRow;
  isExpanded: boolean;
  isVm: boolean;
  isRunning: boolean;
  isBooting: boolean;
  memPct: number;
  onToggleExpand: () => void;
  onToggleRun: () => void;
  onOpenConsole: () => void;
  onFocusNode?: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggleExpand}
        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-[#131D31] transition-colors"
      >
        {/* Node Name & Type */}
        <td className="py-2.5 pl-4 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 dark:text-slate-500 shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                isVm
                  ? isRunning
                    ? "bg-emerald-500/12 border-emerald-500/30 text-emerald-600 dark:text-[#34D399]"
                    : "bg-slate-100 dark:bg-[#162032] border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
                  : row.kind === "nat_gateway"
                  ? "bg-emerald-500/12 border-emerald-500/30 text-emerald-600 dark:text-[#34D399]"
                  : row.kind === "dhcp_server"
                  ? "bg-indigo-500/12 border-indigo-500/30 text-indigo-600 dark:text-[#818CF8]"
                  : "bg-cyan-500/12 border-cyan-500/30 text-cyan-600 dark:text-[#22D3EE]"
              }`}
            >
              {isVm ? (
                <Server className="w-3.5 h-3.5" />
              ) : row.kind === "nat_gateway" ? (
                <Globe className="w-3.5 h-3.5" />
              ) : row.kind === "dhcp_server" ? (
                <Server className="w-3.5 h-3.5" />
              ) : (
                <Network className="w-3.5 h-3.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {row.label}
                </span>
                {row.isGuidedSetup && (
                  <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    Setup
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
                <span>{row.archLabel}</span>
                {row.accelLabel && (
                  <span className="px-1 rounded bg-slate-200/70 dark:bg-[#162032] text-cyan-700 dark:text-[#22D3EE]">
                    {row.accelLabel}
                  </span>
                )}
                <span>
                  • {row.connectedPorts}/{row.totalPorts} NICs
                </span>
              </div>
            </div>
          </div>
        </td>

        {/* Status / PID */}
        <td className="py-2.5 px-2 font-mono">
          {!isVm ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] bg-cyan-500/12 text-cyan-800 dark:text-[#22D3EE] border border-cyan-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE]" />
              Fabric Core
            </span>
          ) : isRunning ? (
            <div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] bg-emerald-500/12 text-emerald-700 dark:text-[#34D399] border border-emerald-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                PID {row.pid ?? "—"}
              </span>
              {row.uptimeMs > 0 && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 pl-1">
                  up {formatUptime(row.uptimeMs)}
                </div>
              )}
            </div>
          ) : isBooting ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 animate-pulse">
              Booting…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] bg-slate-200/70 dark:bg-[#162032] text-slate-600 dark:text-slate-400">
              Stopped
            </span>
          )}
        </td>

        {/* CPU Load */}
        <td className="py-2.5 px-2 w-40">
          {!isVm ? (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              In-process (0% VM)
            </span>
          ) : isRunning ? (
            <div>
              <div className="flex items-baseline justify-between font-mono">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {row.cpuPercent.toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {row.allocatedCpus} vCPU
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#090E18] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    row.cpuNormalizedPercent > 80
                      ? "bg-[#F43F5E]"
                      : row.cpuNormalizedPercent > 45
                      ? "bg-[#F59E0B]"
                      : "bg-[#22D3EE]"
                  }`}
                  style={{
                    width: `${Math.max(
                      row.cpuPercent > 0 ? 3 : 0,
                      row.cpuNormalizedPercent
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              0.0% ({row.allocatedCpus} vCPU)
            </span>
          )}
        </td>

        {/* Memory */}
        <td className="py-2.5 px-2 w-44">
          {!isVm ? (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              Shared fabric tables
            </span>
          ) : isRunning ? (
            <div>
              <div className="flex items-baseline justify-between font-mono">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatBytes(row.memoryBytes)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  / {row.allocatedRamMb} MB
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#090E18] overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 dark:bg-[#818CF8] transition-all duration-300"
                  style={{ width: `${Math.max(2, memPct)}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              — ({row.allocatedRamMb} MB cfg)
            </span>
          )}
        </td>

        {/* Net RX */}
        <td className="py-2.5 px-2 font-mono">
          <div className="flex items-center gap-1 text-emerald-700 dark:text-[#34D399] font-semibold">
            <ArrowDownLeft className="w-3 h-3 shrink-0" />
            <span>{formatByteRate(row.rxBytesPerSec)}</span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {formatBytes(row.rxBytesTotal)} •{" "}
            {formatCountCompact(row.rxPacketsTotal)} pkts
          </div>
        </td>

        {/* Net TX */}
        <td className="py-2.5 px-2 font-mono">
          <div className="flex items-center gap-1 text-cyan-700 dark:text-[#22D3EE] font-semibold">
            <ArrowUpRight className="w-3 h-3 shrink-0" />
            <span>{formatByteRate(row.txBytesPerSec)}</span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {formatBytes(row.txBytesTotal)} •{" "}
            {formatCountCompact(row.txPacketsTotal)} pkts
          </div>
        </td>

        {/* Quick Actions */}
        <td
          className="py-2.5 pl-2 pr-4 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="inline-flex items-center justify-end gap-1">
            {isVm && (
              <>
                <button
                  type="button"
                  onClick={onOpenConsole}
                  title="Open Serial / Graphical Console"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Terminal className="w-3 h-3 text-[#22D3EE]" />
                  <span className="hidden xl:inline">Console</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleRun}
                  title={isRunning || isBooting ? "Stop VM" : "Boot VM"}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    isRunning || isBooting
                      ? "bg-rose-500/12 hover:bg-rose-500/22 text-rose-700 dark:text-[#F43F5E]"
                      : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-[#34D399]"
                  }`}
                >
                  {isRunning || isBooting ? (
                    <>
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>Boot</span>
                    </>
                  )}
                </button>
              </>
            )}
            {!isVm && onFocusNode && (
              <button
                type="button"
                onClick={onFocusNode}
                className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200 transition-colors"
              >
                Select
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded Per-Node Detail Drawer */}
      {isExpanded && (
        <tr className="bg-slate-50/90 dark:bg-[#090E18]/90">
          <td colSpan={7} className="px-6 py-3">
            {isVm && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-2.5 pb-2 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.12)] text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-[#22D3EE]" />
                  Threads: <strong className="text-slate-900 dark:text-slate-200">{row.threadCount || "—"}</strong>
                </span>
                <span>
                  RSS:{" "}
                  <strong className="text-slate-900 dark:text-slate-200">
                    {isRunning ? formatBytes(row.residentBytes) : "—"}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-[#F59E0B]" />
                  Disk Read:{" "}
                  <strong className="text-slate-900 dark:text-slate-200">
                    {formatBytes(row.diskReadBytes)}
                  </strong>
                </span>
                <span>
                  Disk Write:{" "}
                  <strong className="text-slate-900 dark:text-slate-200">
                    {formatBytes(row.diskWriteBytes)}
                  </strong>
                </span>
                {row.overlayDiskBytes > 0 && (
                  <span>
                    CoW Overlay:{" "}
                    <strong className="text-slate-900 dark:text-slate-200">
                      {formatBytes(row.overlayDiskBytes)}
                    </strong>
                  </span>
                )}
              </div>
            )}

            {row.portDetails.length === 0 ? (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                No network interfaces configured on this node.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {row.portDetails.map(({ port, linkState, telemetry }) => (
                  <div
                    key={port.id}
                    className="rounded-lg px-3 py-2 bg-white dark:bg-[#111827] border border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2 text-[11px] font-mono"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            linkState === "active" || linkState === "up"
                              ? "bg-[#10B981]"
                              : linkState === "cut"
                              ? "bg-[#F43F5E]"
                              : "bg-slate-400 dark:bg-slate-600"
                          }`}
                        />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {port.label}
                        </span>
                        {port.ipLabel && (
                          <span className="text-[10px] text-cyan-700 dark:text-[#22D3EE] truncate">
                            {port.ipLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {port.mac || linkState}
                      </div>
                    </div>

                    {telemetry ? (
                      <div className="text-right shrink-0">
                        <div className="text-emerald-700 dark:text-[#34D399]">
                          ↓ {formatByteRate(telemetry.rxBytesPerSec)}{" "}
                          <span className="text-[10px] text-slate-400">
                            ({formatBytes(telemetry.rxBytes)})
                          </span>
                        </div>
                        <div className="text-cyan-700 dark:text-[#22D3EE]">
                          ↑ {formatByteRate(telemetry.txBytesPerSec)}{" "}
                          <span className="text-[10px] text-slate-400">
                            ({formatBytes(telemetry.txBytes)})
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        Unplugged
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
