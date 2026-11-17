import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  deleteProjectCapture,
  dissectPcapWithTcpflowy,
  exportPcapCopy,
  openPcapInWireshark,
  pickExternalPcapDialog,
  pickSavePcapDialog,
  revealPcapInFinder,
} from "../../services/tauriBridge";
import type {
  CaptureFileInfo,
  TcpflowyDissectedFlow,
  TcpflowyDissectionReport,
  TcpflowyEnvStatus,
  TcpflowyInstallProgress,
} from "../../types/studio";
import { formatBytesCompact } from "../layout/StatusBar";
import { EtherloomBackdropOrnament, SignalWaveformIcon } from "../brand";

type FlowSortKey = "stream" | "packets" | "bytes" | "duration" | "anomalies";
type DetailTab = "timeline" | "payload" | "report";

interface TcpflowyInspectorPaneProps {
  capturesDir?: string;
  captures: CaptureFileInfo[];
  selectedPcapPath: string | null;
  dissectNonce: number;
  wiresharkAvailable: boolean;
  tcpflowyStatus: TcpflowyEnvStatus | null;
  installProgress: TcpflowyInstallProgress | null;
  installingTcpflowy: boolean;
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
}

function handshakeBadgeStyle(state: string): string {
  const upper = state.toUpperCase();
  if (upper.includes("COMPLETE") || upper.includes("ESTABLISHED")) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-500/35";
  }
  if (upper.includes("RESET") || upper.includes("RST")) {
    return "bg-rose-500/15 text-rose-700 dark:text-[#F43F5E] border-rose-500/40";
  }
  if (upper.includes("UNANSWERED") || upper.includes("NO_ACK")) {
    return "bg-amber-500/15 text-amber-700 dark:text-[#F59E0B] border-amber-500/40";
  }
  return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30";
}

function tcpFlagPillStyle(flags: string[]): string {
  if (flags.includes("RST")) {
    return "bg-rose-500/20 text-rose-700 dark:text-[#F43F5E] border-rose-500/45";
  }
  if (flags.includes("SYN")) {
    return "bg-cyan-500/20 text-cyan-700 dark:text-[#22D3EE] border-cyan-400/45";
  }
  if (flags.includes("PSH")) {
    return "bg-emerald-500/20 text-emerald-700 dark:text-[#34D399] border-emerald-500/45";
  }
  if (flags.includes("FIN")) {
    return "bg-amber-500/20 text-amber-700 dark:text-[#F59E0B] border-amber-500/45";
  }
  return "bg-slate-200/80 dark:bg-[#162032] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700";
}

function ladderArrowColor(seg: {
  flags: string[];
  isRetransmission: boolean;
  isOutOfOrder: boolean;
  isZeroWindow: boolean;
}): string {
  if (seg.flags.includes("RST") || seg.isRetransmission || seg.isZeroWindow) {
    return "text-rose-600 dark:text-[#F43F5E]";
  }
  if (seg.isOutOfOrder || seg.flags.includes("FIN")) {
    return "text-amber-600 dark:text-[#F59E0B]";
  }
  if (seg.flags.includes("SYN")) {
    return "text-cyan-600 dark:text-[#22D3EE]";
  }
  if (seg.flags.includes("PSH")) {
    return "text-emerald-600 dark:text-[#10B981]";
  }
  return "text-indigo-600 dark:text-[#818CF8]";
}

export function TcpflowyInspectorPane({
  capturesDir,
  captures,
  selectedPcapPath,
  dissectNonce,
  wiresharkAvailable,
  tcpflowyStatus,
  installProgress,
  installingTcpflowy,
  onSelectPcap,
  onRefreshCaptures,
  onInstallTcpflowy,
  onRefreshTcpflowyStatus,
  onOpenSettingsTcpflowy,
  onNotify,
}: TcpflowyInspectorPaneProps) {
  const [externalPcaps, setExternalPcaps] = useState<string[]>([]);
  const [filterNoise, setFilterNoise] = useState(false);
  const [noIpLookup, setNoIpLookup] = useState(true);
  const [showCapturesDrawer, setShowCapturesDrawer] = useState(false);

  const [dissecting, setDissecting] = useState(false);
  const [dissectError, setDissectError] = useState<string | null>(null);
  const [report, setReport] = useState<TcpflowyDissectionReport | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<FlowSortKey>("stream");
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("timeline");
  const [payloadViewMode, setPayloadViewMode] = useState<"ascii" | "hex">(
    "ascii"
  );
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const lastHandledNonceRef = useRef<number>(0);

  // Auto-select most recent capture when captures appear and nothing is selected
  useEffect(() => {
    if (!selectedPcapPath && captures.length > 0) {
      onSelectPcap(captures[0].path);
    }
  }, [captures, onSelectPcap, selectedPcapPath]);

  const copyText = useCallback((token: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedToken(token);
    window.setTimeout(() => {
      setCopiedToken((curr) => (curr === token ? null : curr));
    }, 1600);
  }, []);

  // Clear stale environment-setup errors once tcpflowy installation starts or finishes cleanly
  useEffect(() => {
    if (installingTcpflowy || tcpflowyStatus?.state === "ready") {
      setDissectError(null);
    }
  }, [installingTcpflowy, tcpflowyStatus?.state]);

  const runDissection = useCallback(
    async (targetPath: string) => {
      if (!targetPath) return;
      setDissecting(true);
      setDissectError(null);
      try {
        const res = await dissectPcapWithTcpflowy({
          pcapPath: targetPath,
          filterNoise,
          noIpLookup,
          keylogPath: null,
        });
        setReport(res);
        setSelectedFlowId((prev) => {
          if (prev && res.flows.some((f) => f.flow_id === prev)) {
            return prev;
          }
          return res.flows[0]?.flow_id ?? null;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setDissectError(msg);
      } finally {
        setDissecting(false);
        if (tcpflowyStatus?.state !== "ready") {
          onRefreshTcpflowyStatus?.();
        }
      }
    },
    [filterNoise, noIpLookup, onRefreshTcpflowyStatus, tcpflowyStatus?.state]
  );

  // Trigger automatic dissection when "Stop & Dissect with tcpflowy" increments `dissectNonce`
  useEffect(() => {
    if (
      dissectNonce > 0 &&
      dissectNonce !== lastHandledNonceRef.current &&
      selectedPcapPath
    ) {
      lastHandledNonceRef.current = dissectNonce;
      void runDissection(selectedPcapPath);
    }
  }, [dissectNonce, runDissection, selectedPcapPath]);

  const handleImportExternalPcap = async () => {
    const picked = await pickExternalPcapDialog(capturesDir);
    if (!picked) return;
    setExternalPcaps((prev) =>
      prev.includes(picked) ? prev : [picked, ...prev]
    );
    onSelectPcap(picked);
    void runDissection(picked);
  };

  const handleOpenPathInWireshark = async (pcapPath: string) => {
    if (!pcapPath) return;
    try {
      await openPcapInWireshark(pcapPath);
      onNotify(
        "ok",
        `Opened ${pcapPath.split("/").pop() ?? pcapPath} in Wireshark`
      );
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenWireshark = async () => {
    if (!selectedPcapPath) return;
    await handleOpenPathInWireshark(selectedPcapPath);
  };

  const handleRevealInFinder = async (pcapPath: string) => {
    if (!pcapPath) return;
    try {
      await revealPcapInFinder(pcapPath);
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveCopyAs = async (
    pcapPath: string,
    suggestedFilename: string,
    packetCount: number | null
  ) => {
    if (!pcapPath) return;
    try {
      const destPath = await pickSavePcapDialog(suggestedFilename);
      if (!destPath) return;
      await exportPcapCopy(pcapPath, destPath);
      const label =
        packetCount !== null
          ? `Capture saved (${packetCount} packets)`
          : `Capture saved (${destPath.split("/").pop() ?? suggestedFilename})`;
      onNotify("ok", label, "Reveal in Finder", () => {
        void handleRevealInFinder(destPath);
      });
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDissectCaptureRow = (pcapPath: string) => {
    onSelectPcap(pcapPath);
    setShowCapturesDrawer(false);
    void runDissection(pcapPath);
  };

  const selectedManagedCapture = useMemo(
    () => captures.find((c) => c.path === selectedPcapPath) ?? null,
    [captures, selectedPcapPath]
  );

  const selectedFilename = useMemo(() => {
    if (selectedManagedCapture) return selectedManagedCapture.filename;
    if (!selectedPcapPath) return "capture.pcap";
    return selectedPcapPath.split("/").pop() ?? "capture.pcap";
  }, [selectedManagedCapture, selectedPcapPath]);

  const handleDeleteCapture = async (target: CaptureFileInfo) => {
    if (target.isRecording) return;
    try {
      const targetPath = target.path;
      await deleteProjectCapture(targetPath);
      if (report?.pcapPath === targetPath) {
        setReport(null);
      }
      await onRefreshCaptures();
      const remaining = captures.filter((c) => c.path !== targetPath);
      if (selectedPcapPath === targetPath) {
        onSelectPcap(remaining[0]?.path ?? externalPcaps[0] ?? null);
      }
      onNotify("ok", `Deleted ${target.filename}`);
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedManagedCapture || selectedManagedCapture.isRecording) return;
    await handleDeleteCapture(selectedManagedCapture);
  };

  const filteredFlows = useMemo<TcpflowyDissectedFlow[]>(() => {
    if (!report) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? report.flows.filter((f) => {
          const hay = [
            f.flow_id,
            f.src_ip,
            String(f.src_port ?? ""),
            f.dst_ip,
            String(f.dst_port ?? ""),
            f.detected_application,
            f.primary_domain,
            f.src_fqdn,
            f.dst_fqdn,
            f.handshakeState,
            ...f.sni_list,
            ...f.http_hosts,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : [...report.flows];

    list.sort((a, b) => {
      switch (sortKey) {
        case "packets":
          return b.packet_count - a.packet_count;
        case "bytes":
          return b.total_bytes - a.total_bytes;
        case "duration":
          return b.duration_sec - a.duration_sec;
        case "anomalies":
          return (
            b.retransmissions +
            b.rstCount +
            b.outOfOrder -
            (a.retransmissions + a.rstCount + a.outOfOrder)
          );
        case "stream":
        default:
          return Number(a.flow_id) - Number(b.flow_id);
      }
    });
    return list;
  }, [report, searchQuery, sortKey]);

  const selectedFlow = useMemo<TcpflowyDissectedFlow | null>(() => {
    if (!report || report.flows.length === 0) return null;
    return (
      filteredFlows.find((f) => f.flow_id === selectedFlowId) ??
      report.flows.find((f) => f.flow_id === selectedFlowId) ??
      filteredFlows[0] ??
      null
    );
  }, [filteredFlows, report, selectedFlowId]);

  const envReady = tcpflowyStatus?.state === "ready";

  const renderSavedCapturesRows = () => (
    <div className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
      {captures.map((cap) => {
        const isSelected = cap.path === selectedPcapPath;
        const createdDate =
          cap.modifiedAtMs > 0
            ? new Date(cap.modifiedAtMs).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : null;

        return (
          <div
            key={cap.path}
            onClick={() => onSelectPcap(cap.path)}
            className={`px-3 py-2 flex flex-wrap items-center justify-between gap-2 transition-colors cursor-pointer ${
              isSelected
                ? "bg-indigo-500/10 dark:bg-[#162032]"
                : "hover:bg-slate-100/80 dark:hover:bg-[#162032]/70"
            }`}
          >
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <SignalWaveformIcon
                animated={cap.isRecording}
                className={`w-4 h-3 shrink-0 ${
                  cap.isRecording ? "text-[#22D3EE]" : "text-[#818CF8]"
                }`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
                    {cap.filename}
                  </span>
                  {cap.isRecording && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-cyan-500/20 text-[#22D3EE] border border-cyan-400/35">
                      REC
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <span>
                    {cap.packetCount !== null ? `${cap.packetCount} pkts` : "pcap"}
                  </span>
                  <span>•</span>
                  <span>{formatBytesCompact(cap.sizeBytes)}</span>
                  {createdDate && (
                    <>
                      <span>•</span>
                      <span>{createdDate}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 4 Explicit Row Actions (+ Delete) */}
            <div
              className="flex items-center gap-1 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1. Dissect Flows (tcpflowy) */}
              <button
                type="button"
                disabled={cap.isRecording || dissecting}
                onClick={() => handleDissectCaptureRow(cap.path)}
                title={
                  cap.isRecording
                    ? "Stop active recording first to dissect flows"
                    : "Dissect Flows (tcpflowy)"
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-[#6366F1]/18 hover:bg-[#6366F1] text-indigo-700 dark:text-[#818CF8] hover:text-white border border-[#6366F1]/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Layers className="w-3 h-3" />
                <span className="hidden sm:inline">Dissect</span>
              </button>

              {/* 2. Open in Wireshark */}
              <button
                type="button"
                disabled={!wiresharkAvailable || cap.isRecording}
                onClick={() => void handleOpenPathInWireshark(cap.path)}
                title={
                  !wiresharkAvailable
                    ? "Wireshark is not installed on macOS (brew install --cask wireshark)"
                    : cap.isRecording
                    ? "Stop active recording before opening static .pcap in Wireshark"
                    : "Open in Wireshark"
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-cyan-500/12 hover:bg-[#06B6D4] text-cyan-700 dark:text-[#22D3EE] hover:text-[#090E18] border border-cyan-400/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <SignalWaveformIcon className="w-3.5 h-2.5" />
                <span className="hidden md:inline">Wireshark</span>
              </button>

              {/* 3. Save Copy As... */}
              <button
                type="button"
                disabled={cap.isRecording}
                onClick={() =>
                  void handleSaveCopyAs(
                    cap.path,
                    cap.filename,
                    cap.packetCount
                  )
                }
                title={
                  cap.isRecording
                    ? "Stop active recording before exporting a copy"
                    : "Save Copy As... (Export .pcap anywhere on macOS)"
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-500/12 hover:bg-[#10B981] text-emerald-700 dark:text-[#34D399] hover:text-[#090E18] border border-emerald-500/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="w-3 h-3" />
                <span className="hidden md:inline">Save Copy As…</span>
              </button>

              {/* 4. Reveal in Finder */}
              <button
                type="button"
                onClick={() => void handleRevealInFinder(cap.path)}
                title="Reveal in macOS Finder"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#090E18] hover:bg-slate-100 dark:hover:bg-[#1E2B42] text-slate-600 dark:text-slate-300 transition-colors"
              >
                <FolderOpen className="w-3 h-3" />
                <span className="hidden xl:inline">Finder</span>
              </button>

              {!cap.isRecording && (
                <button
                  type="button"
                  onClick={() => void handleDeleteCapture(cap)}
                  title="Delete capture from workspace"
                  className="p-1 rounded-md border border-transparent hover:border-rose-500/40 hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 dark:hover:text-[#F43F5E] transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      {/* Top Capture & Dissector Control Bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          <FileSearch className="w-3.5 h-3.5 text-[#818CF8] shrink-0" />
          <select
            aria-label="Select .pcap capture file"
            value={selectedPcapPath ?? ""}
            onChange={(e) => onSelectPcap(e.target.value || null)}
            className="max-w-[300px] min-w-[175px] px-2 py-1 rounded-md text-xs font-mono bg-white dark:bg-[#162032] border border-slate-200 dark:border-[rgba(34,211,238,0.20)] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/40"
          >
            <option value="">
              {captures.length === 0 && externalPcaps.length === 0
                ? "No .pcap captures yet — Record wire or Import…"
                : "Select a .pcap capture…"}
            </option>
            {captures.length > 0 && (
              <optgroup label="Workspace Captures (captures/*.pcap)">
                {captures.map((cap) => (
                  <option key={cap.path} value={cap.path}>
                    {cap.isRecording ? "● [REC] " : ""}
                    {cap.filename} (
                    {cap.packetCount !== null ? `${cap.packetCount} pkts, ` : ""}
                    {formatBytesCompact(cap.sizeBytes)})
                  </option>
                ))}
              </optgroup>
            )}
            {externalPcaps.length > 0 && (
              <optgroup label="Imported External PCAPs">
                {externalPcaps.map((extPath) => (
                  <option key={extPath} value={extPath}>
                    {extPath.split("/").pop() ?? extPath}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {captures.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCapturesDrawer((v) => !v)}
              title="Toggle workspace saved captures history list (captures/*.pcap)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                showCapturesDrawer
                  ? "bg-indigo-500/18 border-[#6366F1]/45 text-indigo-700 dark:text-[#818CF8]"
                  : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#162032] hover:bg-slate-100 dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200"
              }`}
            >
              <span>Captures ({captures.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void onRefreshCaptures()}
            title="Refresh project captures folder"
            className="p-1.5 rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => void handleImportExternalPcap()}
            title="Import an external .pcap or .pcapng file"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200"
          >
            <FolderOpen className="w-3 h-3" />
            <span>Import .pcap…</span>
          </button>

          {selectedPcapPath && !selectedManagedCapture?.isRecording && (
            <>
              <button
                type="button"
                onClick={() =>
                  void handleSaveCopyAs(
                    selectedPcapPath,
                    selectedFilename,
                    selectedManagedCapture?.packetCount ?? null
                  )
                }
                title="Save Copy As... (Export .pcap anywhere on macOS)"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-500/12 hover:bg-emerald-500/22 text-emerald-700 dark:text-[#34D399] border border-emerald-500/35 transition-colors"
              >
                <Download className="w-3 h-3" />
                <span className="hidden lg:inline">Save Copy As…</span>
              </button>

              <button
                type="button"
                onClick={() => void handleRevealInFinder(selectedPcapPath)}
                title="Reveal selected .pcap in macOS Finder"
                className="p-1.5 rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {selectedManagedCapture && !selectedManagedCapture.isRecording && (
            <button
              type="button"
              onClick={() => void handleDeleteSelected()}
              title="Delete selected capture from disk"
              className="p-1.5 rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 text-slate-500 dark:text-zinc-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <span className="hidden xl:inline h-4 w-px bg-slate-200 dark:bg-zinc-800 mx-0.5" />

          <label
            title="tcpflowy --filter-noise (-n): suppress background OS chatter"
            className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-zinc-400 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              checked={filterNoise}
              onChange={(e) => setFilterNoise(e.target.checked)}
              className="rounded accent-indigo-500"
            />
            <span>Filter Noise</span>
          </label>

          <label
            title="tcpflowy --no-ip-lookup: fast offline dissection without external RDAP queries"
            className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-zinc-400 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              checked={noIpLookup}
              onChange={(e) => setNoIpLookup(e.target.checked)}
              className="rounded accent-indigo-500"
            />
            <span>Offline RDAP</span>
          </label>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {tcpflowyStatus && (
            <>
              {envReady ? (
                <button
                  type="button"
                  onClick={onOpenSettingsTcpflowy}
                  title={`${tcpflowyStatus.message} — Click to configure Python / local repo in Settings`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/20"
                >
                  <span>
                    tcpflowy v{tcpflowyStatus.installedVersion ?? "1.1"}
                    {tcpflowyStatus.activeSource === "local_repo"
                      ? " (repo)"
                      : ""}
                  </span>
                  <Settings2 className="w-3 h-3 opacity-75" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={installingTcpflowy}
                  onClick={() =>
                    tcpflowyStatus.state === "not_installed"
                      ? void onInstallTcpflowy()
                      : onOpenSettingsTcpflowy()
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-200 border border-amber-500/35 disabled:opacity-55"
                >
                  {installingTcpflowy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  <span>
                    {installingTcpflowy
                      ? "Installing tcpflowy…"
                      : tcpflowyStatus.state === "not_installed"
                      ? "Setup tcpflowy venv"
                      : "Configure tcpflowy"}
                  </span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            disabled={
              !selectedPcapPath ||
              dissecting ||
              Boolean(selectedManagedCapture?.isRecording)
            }
            onClick={() =>
              selectedPcapPath && void runDissection(selectedPcapPath)
            }
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-[#6366F1] hover:bg-[#818CF8] disabled:opacity-45 text-white shadow-xs transition-colors"
          >
            {dissecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{dissecting ? "Dissecting…" : "Dissect with tcpflowy"}</span>
          </button>

          <button
            type="button"
            disabled={
              !selectedPcapPath ||
              !wiresharkAvailable ||
              Boolean(selectedManagedCapture?.isRecording)
            }
            onClick={() => void handleOpenWireshark()}
            title={
              !wiresharkAvailable
                ? "Wireshark is not installed on macOS (brew install --cask wireshark)"
                : selectedManagedCapture?.isRecording
                ? "Stop active recording first to open finalized .pcap in Wireshark"
                : "Open this .pcap capture file directly in macOS Wireshark.app"
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-[#22D3EE] border border-cyan-400/35 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
          >
            <SignalWaveformIcon className="w-3.5 h-2.5" />
            <span>Open in Wireshark</span>
          </button>
        </div>
      </div>

      {/* Collapsible Saved Captures History List (when viewing a report or toggled open) */}
      {showCapturesDrawer && report && captures.length > 0 && (
        <div className="shrink-0 max-h-44 overflow-y-auto rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)]">
          <div className="px-3 py-1.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-[#111827] flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Saved Workspace Captures (
              <code className="font-mono text-[#22D3EE]">captures/*.pcap</code>)
            </span>
            <button
              type="button"
              onClick={() => setShowCapturesDrawer(false)}
              className="text-[10px] font-mono text-slate-400 hover:text-slate-200"
            >
              Hide
            </button>
          </div>
          {renderSavedCapturesRows()}
        </div>
      )}

      {/* Live venv / pip install progress banner */}
      {installingTcpflowy && installProgress && (
        <div className="shrink-0 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-3 py-2 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-indigo-900 dark:text-indigo-200">
              {installProgress.message}
            </span>
            <span className="font-mono text-indigo-700 dark:text-indigo-300">
              {installProgress.percent}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-indigo-950/20 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${installProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Banner */}
      {dissectError && (
        <div className="shrink-0 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 flex items-center justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="truncate">{dissectError}</span>
          </div>
          {!envReady && (
            <button
              type="button"
              onClick={() =>
                tcpflowyStatus?.state === "not_installed"
                  ? void onInstallTcpflowy()
                  : onOpenSettingsTcpflowy()
              }
              className="shrink-0 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium"
            >
              {tcpflowyStatus?.state === "not_installed"
                ? "Install tcpflowy Now"
                : "Open tcpflowy Settings"}
            </button>
          )}
        </div>
      )}

      {/* Main Split View or Saved Captures + Empty State */}
      {!report ? (
        captures.length > 0 ? (
          <div className="flex-1 min-h-0 rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-[#111827] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                <SignalWaveformIcon className="w-4 h-3 text-[#22D3EE]" />
                <span>
                  Project Captures History (
                  <code className="font-mono text-[#22D3EE]">
                    captures/*.pcap
                  </code>
                  )
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                Dissect with tcpflowy, open in Wireshark, export a copy, or
                reveal in Finder
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {renderSavedCapturesRows()}
            </div>
          </div>
        ) : (
          <div className="relative flex-1 min-h-0 rounded-lg bg-slate-50/80 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] p-4 flex flex-col items-center justify-center text-center gap-2 overflow-hidden">
            <EtherloomBackdropOrnament
              opacityClassName="opacity-20"
              className="absolute inset-0"
            />
            <div className="relative flex flex-col items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-[#6366F1]/35 flex items-center justify-center text-[#22D3EE]">
                <SignalWaveformIcon animated className="w-5 h-3.5" />
              </div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Visual TCP Flow &amp; Stream Dissector (Powered by{" "}
                <code className="font-mono text-[#818CF8]">tcpflowy</code>)
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xl">
                Click any wire on the topology canvas to{" "}
                <strong className="text-slate-700 dark:text-slate-200">
                  Record .pcap
                </strong>{" "}
                and finish with{" "}
                <strong className="text-emerald-600 dark:text-[#34D399]">
                  Stop &amp; Save PCAP…
                </strong>
                ,{" "}
                <strong className="text-cyan-600 dark:text-[#22D3EE]">
                  Stop &amp; Open in Wireshark
                </strong>
                , or{" "}
                <strong className="text-indigo-600 dark:text-[#818CF8]">
                  Stop &amp; Dissect (tcpflowy)
                </strong>
                .
              </p>
            </div>
          </div>
        )
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2.5 overflow-hidden">
          {/* LEFT PANE: Conversations / TCP Flows Table */}
          <div className="lg:col-span-5 min-h-0 rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] flex flex-col overflow-hidden">
            {/* Summary + Search & Sort Header */}
            <div className="p-2 border-b border-slate-200/80 dark:border-slate-800 space-y-1.5 shrink-0 bg-slate-50/70 dark:bg-[#111827]">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-800 dark:text-zinc-100">
                  TCP Conversations ({filteredFlows.length}
                  {filteredFlows.length !== report.flows.length
                    ? `/${report.flows.length}`
                    : ""}
                  )
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-zinc-400">
                  {report.totalPcapPackets !== null
                    ? `${report.totalPcapPackets} total frames • `
                    : ""}
                  {formatBytesCompact(report.statistics.total_bytes ?? 0)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter IP, port, SNI/host, app, state…"
                    className="w-full pl-6 pr-2 py-1 rounded-md text-[11px] bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="inline-flex items-center gap-1 shrink-0">
                  <ArrowDownUp className="w-3 h-3 text-slate-400" />
                  <select
                    aria-label="Sort TCP flows"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as FlowSortKey)}
                    className="px-1.5 py-1 rounded-md text-[11px] bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200"
                  >
                    <option value="stream">Stream #</option>
                    <option value="packets">Packets</option>
                    <option value="bytes">Total Bytes</option>
                    <option value="duration">Duration</option>
                    <option value="anomalies">Retrans / RST</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Flows List */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/80">
              {filteredFlows.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 dark:text-zinc-400">
                  {report.flows.length === 0
                    ? "No TCP streams found in this PCAP (try Wireshark for pure ARP / ICMP / UDP frames)."
                    : "No TCP flows match your search filter."}
                </div>
              ) : (
                filteredFlows.map((flow) => {
                  const active = selectedFlow?.flow_id === flow.flow_id;
                  const anomalies =
                    flow.retransmissions + flow.rstCount + flow.outOfOrder;
                  return (
                    <button
                      key={flow.flow_id}
                      type="button"
                      onClick={() => setSelectedFlowId(flow.flow_id)}
                      className={`w-full text-left px-2.5 py-2 transition-colors ${
                        active
                          ? "bg-indigo-500/12 dark:bg-indigo-500/18"
                          : "hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 shrink-0">
                            #{flow.flow_id}
                          </span>
                          <span className="text-[11px] font-mono font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {flow.src_ip}:{flow.src_port} ↔ {flow.dst_ip}:
                            {flow.dst_port}
                          </span>
                        </div>

                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25">
                          {flow.detected_application}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded border font-mono text-[9.5px] ${handshakeBadgeStyle(
                              flow.handshakeState
                            )}`}
                          >
                            {flow.handshakeState}
                          </span>
                          {flow.primary_domain && (
                            <span className="font-mono text-sky-600 dark:text-sky-400 truncate max-w-[150px]">
                              {flow.primary_domain}
                            </span>
                          )}
                          {anomalies > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 font-mono">
                              {flow.retransmissions > 0
                                ? `${flow.retransmissions} retrans `
                                : ""}
                              {flow.rstCount > 0 ? `${flow.rstCount} RST` : ""}
                            </span>
                          )}
                        </div>

                        <span className="font-mono text-slate-500 dark:text-zinc-400 shrink-0">
                          {flow.packet_count} pkts •{" "}
                          {formatBytesCompact(flow.total_bytes)} •{" "}
                          {(flow.duration_sec * 1000).toFixed(1)}ms
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT PANE: Visual Sequence Ladder + Stream Payload + Raw Report */}
          <div className="lg:col-span-7 min-h-0 rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] flex flex-col overflow-hidden">
            {/* Sub-Tabs Header */}
            <div className="px-2.5 py-1.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1">
                {(
                  [
                    {
                      id: "timeline",
                      label: "Sequence Timeline",
                      icon: Layers,
                    },
                    {
                      id: "payload",
                      label: "Stream Payload & DPI",
                      icon: TerminalSquare,
                    },
                    {
                      id: "report",
                      label: `Report & Rules (${report.generatedRules.length})`,
                      icon: ShieldAlert,
                    },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  const active = detailTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDetailTab(t.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        active
                          ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
                          : "text-slate-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {selectedFlow && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `stream-${selectedFlow.flow_id}`,
                      `tcp.stream eq ${selectedFlow.flow_id}`
                    )
                  }
                  title="Copy Wireshark display filter for this TCP stream"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-slate-200/70 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300"
                >
                  {copiedToken === `stream-${selectedFlow.flow_id}` ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>tcp.stream eq {selectedFlow.flow_id}</span>
                </button>
              )}
            </div>

            {/* TAB 1: Interactive Visual Sequence / Packet Ladder Diagram */}
            {detailTab === "timeline" && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {!selectedFlow ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-zinc-400">
                    Select a TCP conversation on the left to inspect its packet
                    sequence timeline.
                  </div>
                ) : (
                  <>
                    {/* Endpoint Column Headers */}
                    <div className="px-3 py-1.5 border-b border-slate-200/70 dark:border-slate-800/80 bg-slate-50/50 dark:bg-[#162032]/75 grid grid-cols-12 items-center text-[11px] font-mono shrink-0">
                      <div className="col-span-2 text-[10px] text-slate-400">
                        Δ Time
                      </div>
                      <div className="col-span-5 font-semibold text-cyan-700 dark:text-[#22D3EE] truncate">
                        Client {selectedFlow.src_ip}:{selectedFlow.src_port}
                      </div>
                      <div className="col-span-5 text-right font-semibold text-indigo-700 dark:text-[#818CF8] truncate">
                        Server {selectedFlow.dst_ip}:{selectedFlow.dst_port}
                      </div>
                    </div>

                    {/* Segment Ladder Rows */}
                    <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                      {selectedFlow.segments.map((seg) => {
                        const isC2S = seg.direction === "C->S";
                        return (
                          <div
                            key={seg.frameNumber}
                            className="px-3 py-1.5 grid grid-cols-12 items-center gap-2 text-[11px] hover:bg-slate-50/90 dark:hover:bg-[#162032]/55"
                          >
                            {/* Frame # & Relative Time */}
                            <div className="col-span-2 font-mono text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                              <div>+{seg.relTimeMs.toFixed(2)}ms</div>
                              <div className="text-[9.5px] text-slate-400 dark:text-slate-500">
                                #{seg.frameNumber}
                              </div>
                            </div>

                            {/* Visual Directional Ladder Arrow + TCP Flags + SEQ/ACK/WIN */}
                            <div className="col-span-10 space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${tcpFlagPillStyle(
                                    seg.flags
                                  )}`}
                                >
                                  {seg.flags.join(", ")}
                                </span>

                                <span
                                  className={`font-mono text-[11px] font-bold ${ladderArrowColor(
                                    seg
                                  )}`}
                                >
                                  {isC2S ? "───────▶" : "◀───────"}
                                </span>

                                <span className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                                  Seq={seg.seq} Ack={seg.ack} Len=
                                  {seg.payloadLen} Win={seg.window}
                                </span>

                                {seg.isRetransmission && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-[#F43F5E] border border-rose-500/40 text-[9.5px] font-mono font-semibold">
                                    RETRANS
                                  </span>
                                )}
                                {seg.isOutOfOrder && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-[#F59E0B] border border-amber-500/40 text-[9.5px] font-mono font-semibold">
                                    DUP-ACK / OOO
                                  </span>
                                )}
                                {seg.isZeroWindow && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-[#F43F5E] border border-rose-500/40 text-[9.5px] font-mono font-semibold">
                                    ZERO-WIN
                                  </span>
                                )}
                              </div>

                              {seg.preview && (
                                <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate pl-1">
                                  {seg.preview}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB 2: Reconstructed Stream Payload & tcpflowy DPI Metadata */}
            {detailTab === "payload" && (
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {!selectedFlow ? (
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    Select a TCP conversation to view reconstructed payloads.
                  </div>
                ) : (
                  <>
                    {/* tcpflowy DPI Telemetry Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div className="rounded-md bg-slate-50 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800 p-2">
                        <div className="text-slate-400">Direction / Bytes</div>
                        <div className="font-mono font-semibold text-slate-800 dark:text-zinc-100 mt-0.5">
                          ↑{formatBytesCompact(selectedFlow.c2s_payload_bytes)}{" "}
                          / ↓
                          {formatBytesCompact(selectedFlow.s2c_payload_bytes)}
                        </div>
                        <div className="font-mono text-slate-500 truncate">
                          {selectedFlow.direction_profile}
                        </div>
                      </div>

                      <div className="rounded-md bg-slate-50 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800 p-2">
                        <div className="text-slate-400">Shannon Entropy</div>
                        <div className="font-mono font-semibold text-slate-800 dark:text-zinc-100 mt-0.5">
                          {selectedFlow.payload_entropy !== null
                            ? `${selectedFlow.payload_entropy.toFixed(2)} bits/B`
                            : "0.00"}
                        </div>
                        <div className="font-mono text-indigo-600 dark:text-indigo-400 truncate">
                          {selectedFlow.entropy_profile}
                        </div>
                      </div>

                      <div className="rounded-md bg-slate-50 dark:bg-zinc-900/70 border border-slate-200/80 dark:border-zinc-800 p-2 col-span-2">
                        <div className="text-slate-400">
                          SPLT Sequence Signature (First Payload Bursts)
                        </div>
                        <div className="font-mono font-semibold text-slate-800 dark:text-zinc-100 mt-0.5 truncate">
                          {selectedFlow.splt_signature ?? "Handshake-only (0B)"}
                        </div>
                        <div className="font-mono text-slate-500 truncate">
                          Avg IAT:{" "}
                          {selectedFlow.avg_iat_ms !== null
                            ? `${selectedFlow.avg_iat_ms} ms`
                            : "n/a"}
                        </div>
                      </div>
                    </div>

                    {/* TLS / HTTP Extracted Attributes */}
                    {(selectedFlow.sni_list.length > 0 ||
                      selectedFlow.ja3_list.length > 0 ||
                      selectedFlow.http_hosts.length > 0 ||
                      selectedFlow.http_uris.length > 0) && (
                      <div className="rounded-md bg-indigo-500/[0.06] border border-indigo-500/25 p-2.5 text-[11px] font-mono space-y-1">
                        {selectedFlow.tls_version && (
                          <div>
                            <span className="text-slate-500">TLS:</span>{" "}
                            {selectedFlow.tls_version}{" "}
                            {selectedFlow.alpn_list.length > 0 &&
                              `ALPN=[${selectedFlow.alpn_list.join(", ")}]`}
                          </div>
                        )}
                        {selectedFlow.sni_list.length > 0 && (
                          <div>
                            <span className="text-slate-500">SNI:</span>{" "}
                            {selectedFlow.sni_list.join(", ")}
                          </div>
                        )}
                        {selectedFlow.ja3_list.length > 0 && (
                          <div className="truncate">
                            <span className="text-slate-500">JA3:</span>{" "}
                            {selectedFlow.ja3_list.join(", ")}
                          </div>
                        )}
                        {(selectedFlow.http_methods.length > 0 ||
                          selectedFlow.http_uris.length > 0) && (
                          <div>
                            <span className="text-slate-500">HTTP:</span>{" "}
                            {selectedFlow.http_methods.join("/")}{" "}
                            {selectedFlow.http_hosts.join(", ")}{" "}
                            {selectedFlow.http_uris.join(", ")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stream Reconstruction Header */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                        Reconstructed TCP Conversation Stream
                      </span>
                      <div className="inline-flex rounded-md border border-slate-200 dark:border-zinc-800 overflow-hidden text-[11px]">
                        <button
                          type="button"
                          onClick={() => setPayloadViewMode("ascii")}
                          className={`px-2 py-0.5 font-medium ${
                            payloadViewMode === "ascii"
                              ? "bg-indigo-600 text-white"
                              : "bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300"
                          }`}
                        >
                          ASCII
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayloadViewMode("hex")}
                          className={`px-2 py-0.5 font-medium ${
                            payloadViewMode === "hex"
                              ? "bg-indigo-600 text-white"
                              : "bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300"
                          }`}
                        >
                          Hex
                        </button>
                      </div>
                    </div>

                    {selectedFlow.streamReconstruction.turns.length > 0 ? (
                      <div className="space-y-2">
                        {selectedFlow.streamReconstruction.turns.map(
                          (turn, idx) => {
                            const isC2S = turn.direction === "C->S";
                            return (
                              <div
                                key={idx}
                                className={`rounded-md border p-2.5 font-mono text-[11px] bg-slate-50 dark:bg-[#090E18] ${
                                  isC2S
                                    ? "border-cyan-500/35 text-cyan-950 dark:text-[#67E8F9]"
                                    : "border-[#6366F1]/45 text-indigo-950 dark:text-[#A5B4FC]"
                                }`}
                              >
                                <div className="text-[10px] font-semibold opacity-85 mb-1">
                                  {isC2S
                                    ? `Client → Server (${turn.bytes} bytes)`
                                    : `Server → Client (${turn.bytes} bytes)`}
                                </div>
                                <pre className="whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">
                                  {payloadViewMode === "ascii"
                                    ? turn.ascii
                                    : turn.hex}
                                </pre>
                              </div>
                            );
                          }
                        )}
                      </div>
                    ) : selectedFlow.payload_samples.length > 0 ? (
                      <div className="space-y-2">
                        {selectedFlow.payload_samples.map((samp, idx) => (
                          <div
                            key={idx}
                            className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/70 p-2.5 font-mono text-[11px]"
                          >
                            <div className="text-[10px] text-slate-500 mb-1">
                              {samp.direction} ({samp.length} B • magic 0x
                              {samp.magic_4bytes})
                            </div>
                            <pre className="whitespace-pre-wrap break-all">
                              {payloadViewMode === "ascii"
                                ? samp.ascii_prefix
                                : samp.hex_prefix}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 text-xs text-slate-500 dark:text-zinc-400">
                        Zero application payload bytes transferred on this TCP
                        stream (control/handshake packets only).
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TAB 3: Full tcpflowy CLI Report, Charts & Generated IDS/Wireshark Rules */}
            {detailTab === "report" && (
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {report.generatedRules.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                      Auto-Generated Wireshark Filters &amp; Suricata Rules
                    </div>
                    <div className="space-y-2">
                      {report.generatedRules.map((rule, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-2.5 space-y-1.5 text-[11px]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-indigo-700 dark:text-indigo-300 font-mono">
                              {rule.type} • Streams [{rule.streams.join(", ")}]
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                copyText(`ws-${idx}`, rule.wireshark_filter)
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-[10px] font-mono"
                            >
                              {copiedToken === `ws-${idx}` ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>Copy Wireshark Filter</span>
                            </button>
                          </div>
                          <div className="font-mono text-[10px] text-sky-700 dark:text-sky-300 break-all">
                            {rule.wireshark_filter}
                          </div>
                          <div className="font-mono text-[10px] text-slate-600 dark:text-zinc-400 break-all">
                            {rule.suricata_rule}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.asciiChart && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                      Application Volume Breakdown
                    </div>
                    <pre className="rounded-md bg-zinc-950 text-emerald-300 border border-zinc-800 p-2.5 text-[10.5px] font-mono overflow-x-auto leading-relaxed">
                      {report.asciiChart}
                    </pre>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                    Raw <code className="font-mono">tcpflowy</code> Intelligence
                    Summary
                  </div>
                  <pre className="rounded-md bg-zinc-950 text-zinc-200 border border-zinc-800 p-2.5 text-[10.5px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {report.rawCliReport}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
