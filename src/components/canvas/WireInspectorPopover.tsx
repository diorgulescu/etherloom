import {
  Activity,
  Cable,
  ExternalLink,
  FileSearch,
  Radio,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { WireEdgeData } from "../../types/studio";
import { formatThroughput } from "../../utils/topology";

interface WireInspectorPopoverProps {
  edgeId: string;
  sourceNodeName: string;
  targetNodeName: string;
  data: WireEdgeData;
  onUpdate: (patch: Partial<WireEdgeData>) => void;
  onTogglePcapRecording: (edgeId: string) => void;
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
  onUpdate,
  onTogglePcapRecording,
  onStopAndDissect,
  onToggleLiveWireshark,
  onDeleteWire,
  onOpenFlowInspector,
  onClose,
}: WireInspectorPopoverProps) {
  return (
    <div
      className="pointer-events-auto w-[360px] rounded-xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-700/90 shadow-2xl p-3.5 space-y-3 z-30"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header: Endpoint A <-> Endpoint B */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-zinc-100">
            <Cable className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="truncate">
              {sourceNodeName}:
              <span className="font-mono text-sky-600 dark:text-sky-400">
                {data.sourcePortLabel}
              </span>{" "}
              ── {targetNodeName}:
              <span className="font-mono text-sky-600 dark:text-sky-400">
                {data.targetPortLabel}
              </span>
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 mt-0.5">
            UDP Wire ID: {edgeId}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Close Wire Inspector"
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live PPS & Throughput Counter */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5">
          <div className="text-[10px] text-slate-500 dark:text-zinc-400">
            Packet Rate
          </div>
          <div className="text-xs font-mono font-semibold text-slate-900 dark:text-zinc-100">
            {data.pps} <span className="text-[10px] font-normal">pps</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5">
          <div className="text-[10px] text-slate-500 dark:text-zinc-400">
            Throughput
          </div>
          <div className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
            {formatThroughput(data.bytesPerSec)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800 px-2.5 py-1.5">
          <div className="text-[10px] text-slate-500 dark:text-zinc-400">
            Frames / Drop
          </div>
          <div className="text-xs font-mono font-semibold text-slate-900 dark:text-zinc-100">
            {data.txPackets + data.rxPackets}{" "}
            <span className="text-[10px] text-rose-500">
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
              ? "bg-emerald-500/10 hover:bg-rose-500/15 border-emerald-500/30 hover:border-rose-500/35 text-emerald-700 hover:text-rose-700 dark:text-emerald-300 dark:hover:text-rose-300"
              : "bg-rose-500/15 hover:bg-emerald-500/15 border-rose-500/35 hover:border-emerald-500/35 text-rose-700 hover:text-emerald-700 dark:text-rose-300 dark:hover:text-emerald-300"
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
          className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-500 hover:text-rose-600 hover:border-rose-500/40 hover:bg-rose-500/10 dark:text-zinc-400 dark:hover:text-rose-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Link Impairment Sliders */}
      <div className="space-y-2.5 pt-1 border-t border-slate-200/70 dark:border-zinc-800/80">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-zinc-300">
            Link Impairments
          </span>
          {(data.latencyMs > 0 || data.jitterMs > 0 || data.lossPercent > 0) && (
            <button
              type="button"
              onClick={() =>
                onUpdate({ latencyMs: 0, jitterMs: 0, lossPercent: 0 })
              }
              className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline"
            >
              Reset to 0
            </button>
          )}
        </div>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-zinc-400">Latency</span>
            <span className="font-mono text-slate-800 dark:text-zinc-200">
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
            className="w-full accent-sky-500"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-zinc-400">Jitter</span>
            <span className="font-mono text-slate-800 dark:text-zinc-200">
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
            className="w-full accent-sky-500"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-zinc-400">
              Packet Loss
            </span>
            <span className="font-mono text-amber-600 dark:text-amber-400">
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
            className="w-full accent-amber-500"
          />
        </label>
      </div>

      {/* Packet Capture & Dissection Controls */}
      <div className="pt-2 border-t border-slate-200/70 dark:border-zinc-800/80 space-y-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-zinc-300">
            <Activity className="w-3 h-3 text-sky-500" />
            Packet Capture &amp; Dissection
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
            {data.capturingPcap
              ? `REC • ${data.capturedPackets ?? 0} pkts`
              : "captures/*.pcap"}
          </span>
        </div>

        {data.capturingPcap && data.activePcapPath && (
          <div className="px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/25 text-[10px] font-mono text-rose-700 dark:text-rose-300 truncate">
            {data.activePcapPath.split("/").pop()}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onTogglePcapRecording(edgeId)}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
              data.capturingPcap
                ? "bg-rose-600 hover:bg-rose-500 border-rose-500 text-white"
                : "bg-slate-100 hover:bg-slate-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200"
            }`}
          >
            <Radio
              className={`w-3 h-3 ${data.capturingPcap ? "animate-pulse" : ""}`}
            />
            <span>
              {data.capturingPcap ? "Stop .pcap" : "Record .pcap"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onToggleLiveWireshark(edgeId)}
            title="Stream live Ethernet frames via named FIFO pipe into Wireshark (-k -i /tmp/etherloom/tap_*.pcap)"
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
              data.liveWireshark
                ? "bg-sky-600 hover:bg-sky-500 border-sky-500 text-white"
                : "bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/30 text-sky-700 dark:text-sky-300"
            }`}
          >
            <ExternalLink className="w-3 h-3" />
            <span>
              {data.liveWireshark ? "Stop Wireshark" : "Live Wireshark"}
            </span>
          </button>
        </div>

        {data.capturingPcap ? (
          <button
            type="button"
            onClick={() => onStopAndDissect(edgeId)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Stop &amp; Dissect with tcpflowy</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenFlowInspector}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 text-indigo-700 dark:text-indigo-300 transition-colors"
          >
            <FileSearch className="w-3.5 h-3.5" />
            <span>Open Captures &amp; tcpflowy Inspector</span>
          </button>
        )}
      </div>
    </div>
  );
}
