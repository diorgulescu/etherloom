import {
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Radio, Scissors, Sparkles, Waves } from "lucide-react";
import type { WireEdgeData } from "../../types/studio";
import { formatThroughput } from "../../utils/topology";

export type EtherloomWireEdgeType = Edge<WireEdgeData, "etherloomWire">;

function endpointBadgeCoords(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  offsetPx: number
): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: ax, y: ay };
  const ratio = Math.min(0.32, offsetPx / dist);
  return {
    x: ax + dx * ratio,
    y: ay + dy * ratio,
  };
}

export function EtherloomWireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<EtherloomWireEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const adminUp = data?.adminUp ?? true;
  const pps = data?.pps ?? 0;
  const bytesPerSec = data?.bytesPerSec ?? 0;
  const hasTraffic = adminUp && (pps > 0 || bytesPerSec > 0);
  const latencyMs = data?.latencyMs ?? 0;
  const jitterMs = data?.jitterMs ?? 0;
  const lossPercent = data?.lossPercent ?? 0;
  const hasImpairment = latencyMs > 0 || jitterMs > 0 || lossPercent > 0;
  const capturing = Boolean(data?.capturingPcap);
  const capturedPackets = data?.capturedPackets ?? 0;
  const liveWireshark = Boolean(data?.liveWireshark);
  const highlightedByLab = Boolean(data?.highlightedByLab);

  const srcBadge = endpointBadgeCoords(sourceX, sourceY, labelX, labelY, 34);
  const dstBadge = endpointBadgeCoords(targetX, targetY, labelX, labelY, 34);

  const strokeColor = !adminUp
    ? "#f43f5e"
    : selected
    ? "#0ea5e9"
    : highlightedByLab
    ? "#6366f1"
    : hasImpairment
    ? "#f59e0b"
    : "#10b981";

  return (
    <>
      {/* Wide invisible hit target for easy click & right-click selection */}
      <path
        id={`${id}-hit`}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="react-flow__edge-interaction cursor-pointer"
      />

      {/* Guided Academy Lab Step Highlight Beacon Halo */}
      {highlightedByLab && (
        <path
          d={edgePath}
          fill="none"
          stroke="rgba(99, 102, 241, 0.42)"
          strokeWidth={11}
          strokeLinecap="round"
        >
          <animate
            attributeName="opacity"
            values="0.35;0.95;0.35"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </path>
      )}

      {/* Selected glow halo */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={adminUp ? "rgba(14,165,233,0.28)" : "rgba(244,63,94,0.28)"}
          strokeWidth={7}
          strokeLinecap="round"
        />
      )}

      {/* Primary Ethernet Cable Path */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={selected ? 2.6 : 2.1}
        strokeDasharray={!adminUp ? "6 6" : undefined}
        strokeLinecap="round"
        opacity={!adminUp ? 0.85 : 0.92}
      />

      {/* Subtle Animated Packet Flow Dashes when PPS / Throughput > 0 */}
      {hasTraffic && (
        <path
          d={edgePath}
          fill="none"
          stroke="#e0f2fe"
          strokeWidth={2}
          strokeDasharray="5 9"
          strokeLinecap="round"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="28"
            to="0"
            dur="0.7s"
            repeatCount="indefinite"
          />
        </path>
      )}

      <EdgeLabelRenderer>
        {/* Source Interface Port Label */}
        {data?.sourcePortLabel && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${srcBadge.x}px, ${srcBadge.y}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan px-1.5 py-0.5 rounded bg-white/95 dark:bg-zinc-900/95 border border-slate-200/90 dark:border-zinc-700/90 text-[10px] font-mono font-medium text-slate-700 dark:text-zinc-200 shadow-2xs"
          >
            {data.sourcePortLabel}
          </div>
        )}

        {/* Target Interface Port Label */}
        {data?.targetPortLabel && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${dstBadge.x}px, ${dstBadge.y}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan px-1.5 py-0.5 rounded bg-white/95 dark:bg-zinc-900/95 border border-slate-200/90 dark:border-zinc-700/90 text-[10px] font-mono font-medium text-slate-700 dark:text-zinc-200 shadow-2xs"
          >
            {data.targetPortLabel}
          </div>
        )}

        {/* Midpoint Wire Status Pill: Cable Cut Scissors / Impairments / Live Rate / PCAP + Packet Counter / Wireshark */}
        {(!adminUp ||
          hasImpairment ||
          hasTraffic ||
          capturing ||
          liveWireshark ||
          highlightedByLab) && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className={`nodrag nopan inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border shadow-sm backdrop-blur-sm ${
              !adminUp
                ? "bg-rose-500/95 border-rose-400 text-white"
                : capturing
                ? "bg-rose-50/95 dark:bg-zinc-900/95 border-rose-500/60 text-rose-700 dark:text-rose-300"
                : liveWireshark
                ? "bg-sky-50/95 dark:bg-zinc-900/95 border-sky-500/60 text-sky-700 dark:text-sky-300"
                : highlightedByLab
                ? "bg-indigo-600/95 border-indigo-400 text-white ring-2 ring-indigo-400/40"
                : hasImpairment
                ? "bg-amber-50/95 dark:bg-zinc-900/95 border-amber-400/70 text-amber-800 dark:text-amber-300"
                : "bg-white/95 dark:bg-zinc-900/95 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {!adminUp ? (
              <>
                <Scissors className="w-3 h-3" />
                <span>CUT</span>
              </>
            ) : (
              <>
                {highlightedByLab && !capturing && !liveWireshark && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>TAP / INSPECT</span>
                  </span>
                )}
                {capturing && (
                  <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                    <Radio className="w-2.5 h-2.5 animate-pulse" />
                    <span>REC {capturedPackets} pkts</span>
                  </span>
                )}
                {liveWireshark && (
                  <span className="inline-flex items-center gap-1 font-semibold text-sky-600 dark:text-sky-400">
                    <Waves className="w-2.5 h-2.5 animate-pulse" />
                    <span>WS LIVE</span>
                  </span>
                )}
                {hasTraffic && <span>{formatThroughput(bytesPerSec)}</span>}
                {hasImpairment && (
                  <span>
                    {latencyMs > 0 ? `${latencyMs}ms` : ""}
                    {jitterMs > 0 ? `±${jitterMs}` : ""}
                    {lossPercent > 0 ? ` ${lossPercent}%` : ""}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
