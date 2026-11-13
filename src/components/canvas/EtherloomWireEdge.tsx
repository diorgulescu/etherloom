import {
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Scissors, Sparkles } from "lucide-react";
import { SignalWaveformIcon } from "../brand";
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
  const hasTap = capturing || liveWireshark;

  const srcBadge = endpointBadgeCoords(sourceX, sourceY, labelX, labelY, 34);
  const dstBadge = endpointBadgeCoords(targetX, targetY, labelX, labelY, 34);

  // Inner core color: Stream Cyan (#22D3EE) normal, Amber (#F59E0B) impaired, Severed Rose (#F43F5E) cut
  const coreColor = !adminUp
    ? "#F43F5E"
    : hasImpairment
    ? "#F59E0B"
    : highlightedByLab
    ? "#818CF8"
    : "#22D3EE";

  // Smooth pulse duration proportional to activity (clamped so it never flickers)
  const pulseDurationSec = hasTraffic
    ? Math.max(0.55, Math.min(1.65, 2.2 / Math.log2(pps + 3)))
    : 1.2;

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
          stroke="rgba(99, 102, 241, 0.45)"
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

      {/* Selected luminous outer aura */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={
            !adminUp
              ? "rgba(244, 63, 94, 0.34)"
              : "rgba(34, 211, 238, 0.34)"
          }
          strokeWidth={9}
          strokeLinecap="round"
        />
      )}

      {/* Layer 1: Dark Outer Cable Sheath (#090E18) for true 3D woven crossing depth */}
      <path
        d={edgePath}
        fill="none"
        stroke="#090E18"
        strokeWidth={6}
        strokeLinecap="round"
        opacity={!adminUp ? 0.65 : 0.9}
      />

      {/* Layer 2: Luminous Inner Core */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={coreColor}
        strokeWidth={selected ? 2.8 : 2.3}
        strokeDasharray={!adminUp ? "6 6" : undefined}
        strokeLinecap="round"
        opacity={!adminUp ? 0.92 : 0.96}
      />

      {/* Layer 3: Live Traffic Packet Pulses along the wire when PPS > 0 (zero CPU drain when idle) */}
      {hasTraffic && (
        <>
          <circle r="3" fill="#34D399" opacity="0.95">
            <animateMotion
              dur={`${pulseDurationSec.toFixed(2)}s`}
              repeatCount="indefinite"
              path={edgePath}
            />
          </circle>
          <circle r="2.4" fill="#67E8F9" opacity="0.9">
            <animateMotion
              dur={`${pulseDurationSec.toFixed(2)}s`}
              begin={`${(pulseDurationSec / 2).toFixed(2)}s`}
              repeatCount="indefinite"
              path={edgePath}
            />
          </circle>
        </>
      )}

      <EdgeLabelRenderer>
        {/* Source Interface Port Monospace Pill */}
        {data?.sourcePortLabel && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${srcBadge.x}px, ${srcBadge.y}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan px-1.5 py-0.5 rounded bg-white/95 dark:bg-[#090E18]/92 border border-slate-200/90 dark:border-[rgba(34,211,238,0.22)] text-[10px] font-mono font-medium text-slate-700 dark:text-slate-200 shadow-xs"
          >
            {data.sourcePortLabel}
          </div>
        )}

        {/* Target Interface Port Monospace Pill */}
        {data?.targetPortLabel && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${dstBadge.x}px, ${dstBadge.y}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan px-1.5 py-0.5 rounded bg-white/95 dark:bg-[#090E18]/92 border border-slate-200/90 dark:border-[rgba(34,211,238,0.22)] text-[10px] font-mono font-medium text-slate-700 dark:text-slate-200 shadow-xs"
          >
            {data.targetPortLabel}
          </div>
        )}

        {/* Midpoint Wire Badge: Severed Scissors / Signature ECG Waveform Tap Badge / Impairments / Live Rate */}
        {(!adminUp ||
          hasTap ||
          hasImpairment ||
          hasTraffic ||
          highlightedByLab) && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className={`nodrag nopan inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium border backdrop-blur-md shadow-md ${
              !adminUp
                ? "bg-[#F43F5E]/95 border-rose-300/60 text-white"
                : hasTap
                ? "bg-[#090E18]/95 border-[#22D3EE]/70 text-[#22D3EE] shadow-[0_0_14px_rgba(34,211,238,0.28)]"
                : highlightedByLab
                ? "bg-[#6366F1]/95 border-indigo-300/60 text-white ring-2 ring-indigo-400/40"
                : hasImpairment
                ? "bg-white/95 dark:bg-[#090E18]/95 border-[#F59E0B]/70 text-amber-800 dark:text-[#F59E0B]"
                : "bg-white/95 dark:bg-[#090E18]/92 border-[#10B981]/50 text-emerald-700 dark:text-[#34D399]"
            }`}
          >
            {!adminUp ? (
              <>
                <Scissors className="w-3 h-3" />
                <span className="font-semibold">CUT</span>
              </>
            ) : (
              <>
                {highlightedByLab && !hasTap && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>TAP / INSPECT</span>
                  </span>
                )}

                {/* Signature ECG / Signal Waveform Tap Badge */}
                {hasTap && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#22D3EE]">
                    <SignalWaveformIcon
                      animated
                      className="w-4 h-3 text-[#22D3EE]"
                    />
                    {capturing && (
                      <span>
                        REC {capturedPackets} pkts
                      </span>
                    )}
                    {capturing && liveWireshark && (
                      <span className="opacity-55">•</span>
                    )}
                    {liveWireshark && <span>WS LIVE</span>}
                  </span>
                )}

                {hasTraffic && (
                  <span className={hasTap ? "text-[#34D399]" : ""}>
                    {formatThroughput(bytesPerSec)}
                  </span>
                )}

                {hasImpairment && (
                  <span className={hasTap ? "text-[#F59E0B]" : ""}>
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
