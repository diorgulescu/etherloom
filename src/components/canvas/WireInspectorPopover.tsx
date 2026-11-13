import { useEffect, useState } from "react";
import {
  Cable,
  Download,
  ExternalLink,
  FileSearch,
  Layers,
  Radio,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { SignalWaveformIcon } from "../brand";
import type { WireEdgeData } from "../../types/studio";
import {
  formatByteSize,
  formatDurationMmSs,
  formatThroughput,
} from "../../utils/topology";

interface WireInspectorPopoverProps {
  edgeId: string;
  sourceNodeName: string;
  targetNodeName: string;
  data: WireEdgeData;
  wiresharkAvailable: boolean;
  onUpdate: (patch: Partial<WireEdgeData>) => void;
  onStartPcapRecording: (edgeId: string) => void;
  onStopAndSavePcap: (edgeId: string) => void;
  onStopAndOpenWireshark: (edgeId: string) => void;
  onStopAndDissect: (edgeId: string) => void;
  onToggleLiveWireshark: (edgeId: string) => void;
  onDeleteWire: (edgeId: string) => void;
  onOpenFlowInspector: () => void;
  onClose: () => void;
}

export function WireInspectorPopover({
  edgeId,
  sourceNodeName,
  targetNodeName,
  data,
  wiresharkAvailable,
  onUpdate,
  onStartPcapRecording,
  onStopAndSavePcap,
  onStopAndOpenWireshark,
  onStopAndDissect,
  onToggleLiveWireshark,
  onDeleteWire,
  onOpenFlowInspector,
  onClose,
}: WireInspectorPopoverProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!data.capturingPcap) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [data.capturingPcap]);

  const elapsedMs =
    data.capturingPcap && data.captureStartedAtMs
      ? Math.max(0, nowMs - data.captureStartedAtMs)
      : 0;

  return (
    <div
      className="pointer-events-auto w-[372px] rounded-xl bg-white/95 dark:bg-[#111827]/95 backdrop-blur-xl border border-slate-200/90 dark:border-[rgba(34,211,238,0.26)] shadow-2xl p-3.5 space-y-3 z-30"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header: Endpoint A <-> Endpoint B */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Cable className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
            <span className="truncate">
              {sourceNodeName}:
              <span className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                {data.sourcePortLabel}
              </span>{" "}
              ── {targetNodeName}:
              <span className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                {data.targetPortLabel}
              </span>
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            UDP Wire ID: {edgeId}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Close Wire Inspector"
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live PPS & Throughput Counter */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200/80 dark:border-slate-800 px-2.5 py-1.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            Packet Rate
          </div>
          <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
            {data.pps} <span className="text-[10px] font-normal">pps</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200/80 dark:border-slate-800 px-2.5 py-1.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            Throughput
          </div>
          <div className="text-xs font-mono font-semibold text-emerald-600 dark:text-[#34D399]">
            {formatThroughput(data.bytesPerSec)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200/80 dark:border-slate-800 px-2.5 py-1.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            Frames / Drop
          </div>
          <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
            {data.txPackets + data.rxPackets}{" "}
            <span className="text-[10px] text-[#F43F5E]">
              ({data.droppedPackets})
            </span>
          </div>
        </div>
      </div>

      {/* Toggle Link Up / Cut Cable + Remove Wire */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onUpdate({ adminUp: !data.adminUp })}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${
            data.adminUp
              ? "bg-emerald-500/10 hover:bg-rose-500/15 border-emerald-500/30 hover:border-rose-500/40 text-emerald-700 hover:text-rose-700 dark:text-[#34D399] dark:hover:text-[#F43F5E]"
              : "bg-rose-500/15 hover:bg-emerald-500/15 border-rose-500/40 hover:border-emerald-500/35 text-rose-700 hover:text-emerald-700 dark:text-[#F43F5E] dark:hover:text-[#34D399]"
          }`}
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>
            {data.adminUp ? "Link Up — Cut Cable" : "Cable Cut — Restore Link"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onDeleteWire(edgeId)}
          title="Unplug & delete wire"
          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600 hover:border-rose-500/40 hover:bg-rose-500/10 dark:text-slate-400 dark:hover:text-[#F43F5E] transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Link Impairment Sliders */}
      <div className="space-y-2.5 pt-1 border-t border-slate-200/70 dark:border-slate-800/80">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            Link Impairments
          </span>
          {(data.latencyMs > 0 ||
            data.jitterMs > 0 ||
            data.lossPercent > 0) && (
            <button
              type="button"
              onClick={() =>
                onUpdate({ latencyMs: 0, jitterMs: 0, lossPercent: 0 })
              }
              className="text-[10px] font-mono text-cyan-600 dark:text-[#22D3EE] hover:underline"
            >
              Reset to 0
            </button>
          )}
        </div>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-slate-400">Latency</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {data.latencyMs} ms
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={300}
            step={1}
            value={data.latencyMs}
            onChange={(e) => onUpdate({ latencyMs: Number(e.target.value) })}
            className="w-full accent-[#22D3EE]"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-slate-400">Jitter</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              ±{data.jitterMs} ms
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={120}
            step={1}
            value={data.jitterMs}
            onChange={(e) => onUpdate({ jitterMs: Number(e.target.value) })}
            className="w-full accent-[#22D3EE]"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-slate-400">
              Packet Loss
            </span>
            <span className="font-mono text-amber-600 dark:text-[#F59E0B]">
              {data.lossPercent}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={0.5}
            value={data.lossPercent}
            onChange={(e) => onUpdate({ lossPercent: Number(e.target.value) })}
            className="w-full accent-[#F59E0B]"
          />
        </label>
      </div>

      {/* Packet Capture & Dissection Controls */}
      <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 space-y-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            <SignalWaveformIcon
              animated={Boolean(data.capturingPcap || data.liveWireshark)}
              className="w-4 h-3 text-[#22D3EE]"
            />
            Packet Capture &amp; Dissection
          </span>
          {!data.capturingPcap && (
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-400">
              captures/*.pcap
            </span>
          )}
        </div>

        {data.capturingPcap ? (
          <div className="space-y-2">
            {/* Active Recording Telemetry Banner */}
            <div className="rounded-lg bg-cyan-500/10 dark:bg-[#162032] border border-cyan-400/35 dark:border-[#22D3EE]/35 px-2.5 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="inline-flex items-center gap-1.5 font-semibold text-cyan-800 dark:text-[#22D3EE]">
                  <span className="w-2 h-2 rounded-full bg-[#22D3EE] animate-ping" />
                  <span>REC {formatDurationMmSs(elapsedMs)}</span>
                </span>
                <span className="text-slate-700 dark:text-slate-200">
                  <strong>{data.capturedPackets ?? 0}</strong> pkts •{" "}
                  <span className="text-emerald-700 dark:text-[#34D399]">
                    {formatByteSize(data.capturedBytes ?? 24)}
                  </span>
                </span>
              </div>
              {data.activePcapPath && (
                <div
                  title={data.activePcapPath}
                  className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate"
                >
                  {data.activePcapPath.split("/").pop()}
                </div>
              )}
            </div>

            {/* Three Explicit Stop Workflows */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => onStopAndSavePcap(edgeId)}
                title="Atomically flush & close .pcap, then save a copy anywhere via macOS Save dialog"
                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/14 hover:bg-emerald-500/24 border border-[#10B981]/45 text-emerald-800 dark:text-[#34D399] transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#10B981] dark:text-[#34D399]" />
                <span>Stop &amp; Save PCAP...</span>
              </button>

              <button
                type="button"
                disabled={!wiresharkAvailable}
                onClick={() => onStopAndOpenWireshark(edgeId)}
                title={
                  wiresharkAvailable
                    ? "Atomically flush & close .pcap, then open static capture in Wireshark (-r)"
                    : "Wireshark.app is not installed on this Mac (brew install --cask wireshark)"
                }
                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-cyan-500/14 hover:bg-cyan-500/24 border border-[#22D3EE]/45 text-cyan-800 dark:text-[#22D3EE] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
              >
                <SignalWaveformIcon className="w-3.5 h-3" />
                <span>Stop &amp; Open in Wireshark</span>
              </button>

              <button
                type="button"
                onClick={() => onStopAndDissect(edgeId)}
                title="Atomically flush & close .pcap, then dissect TCP flows & sequence ladders in tcpflowy"
                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#6366F1] hover:bg-[#818CF8] border border-[#818CF8]/40 text-white shadow-xs transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Stop &amp; Dissect (tcpflowy)</span>
              </button>
            </div>

            {/* Coexisting Live Wireshark Named-FIFO Stream (without stopping recording) */}
            <button
              type="button"
              disabled={!wiresharkAvailable && !data.liveWireshark}
              onClick={() => onToggleLiveWireshark(edgeId)}
              title={
                wiresharkAvailable || data.liveWireshark
                  ? "Stream live Ethernet frames simultaneously via named FIFO pipe (-k -i /tmp/etherloom/tap_*.pcap) without stopping .pcap recording"
                  : "Wireshark.app is not installed on this Mac (brew install --cask wireshark)"
              }
              className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg text-[10.5px] font-medium border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                data.liveWireshark
                  ? "bg-[#06B6D4] hover:bg-[#22D3EE] border-[#22D3EE] text-[#090E18] font-semibold"
                  : "bg-slate-100/80 hover:bg-slate-200/80 dark:bg-[#090E18] dark:hover:bg-[#162032] border-slate-200 dark:border-[rgba(34,211,238,0.22)] text-slate-600 dark:text-slate-300"
              }`}
            >
              <ExternalLink className="w-3 h-3 text-[#22D3EE]" />
              <span>
                {data.liveWireshark
                  ? "Stop Live Wireshark Stream"
                  : "Live Wireshark (FIFO Stream)"}
              </span>
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onStartPcapRecording(edgeId)}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-slate-100 hover:bg-slate-200/80 dark:bg-[#162032] dark:hover:bg-[#1E2B42] border-slate-200 dark:border-[rgba(34,211,238,0.22)] text-slate-700 dark:text-slate-200 transition-colors"
              >
                <Radio className="w-3 h-3 text-[#10B981]" />
                <span>Record .pcap</span>
              </button>

              <button
                type="button"
                disabled={!wiresharkAvailable && !data.liveWireshark}
                onClick={() => onToggleLiveWireshark(edgeId)}
                title={
                  wiresharkAvailable || data.liveWireshark
                    ? "Stream live Ethernet frames via named FIFO pipe into Wireshark (-k -i /tmp/etherloom/tap_*.pcap)"
                    : "Wireshark.app is not installed on this Mac (brew install --cask wireshark)"
                }
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                  data.liveWireshark
                    ? "bg-[#06B6D4] hover:bg-[#22D3EE] border-[#22D3EE] text-[#090E18] font-semibold"
                    : "bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400/30 text-cyan-700 dark:text-[#22D3EE]"
                }`}
              >
                <ExternalLink className="w-3 h-3" />
                <span>
                  {data.liveWireshark ? "Stop Wireshark" : "Live Wireshark"}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenFlowInspector}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/12 hover:bg-indigo-500/22 border border-indigo-400/30 text-indigo-700 dark:text-[#818CF8] transition-colors"
            >
              <FileSearch className="w-3.5 h-3.5" />
              <span>Open Captures &amp; tcpflowy Inspector</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
