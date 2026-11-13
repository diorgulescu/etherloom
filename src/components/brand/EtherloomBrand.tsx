import { useState } from "react";

export interface EtherloomMarkProps {
  size?: number;
  className?: string;
  /** When true, attempts `/brand/logo.png` first and falls back to pure vector SVG if absent. */
  preferRaster?: boolean;
}

/**
 * Pure geometric vector SVG depicting Etherloom's signature woven circuit knot:
 * Stream Cyan (`#22D3EE`), HVF Emerald (`#10B981`), and Loom Indigo (`#6366F1`)
 * ribbons terminating in hollow circular ring-jack port nodes on the cardinal axes.
 */
export function EtherloomMark({
  size = 28,
  className = "",
  preferRaster = false,
}: EtherloomMarkProps) {
  const [rasterFailed, setRasterFailed] = useState(false);

  if (preferRaster && !rasterFailed) {
    return (
      <img
        src="/brand/logo.png"
        alt="Etherloom"
        width={size}
        height={size}
        onError={() => setRasterFailed(true)}
        className={`object-cover rounded-lg shrink-0 select-none ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 select-none ${className}`}
    >
      {/* Layer 1: Loom Indigo (#6366F1) inner diamond & orbital traces */}
      <circle
        cx="50"
        cy="50"
        r="31"
        stroke="#6366F1"
        strokeWidth="4.4"
        opacity="0.92"
      />
      <path
        d="M 50 14 L 86 50 L 50 86 L 14 50 Z"
        stroke="#6366F1"
        strokeWidth="3.8"
        strokeLinejoin="round"
        opacity="0.88"
      />

      {/* Dark sheath under-crossings to create true over/under woven depth */}
      <path
        d="M 24 38 C 12 26, 26 12, 38 24 L 76 62 C 88 74, 74 88, 62 76 Z"
        stroke="#090E18"
        strokeWidth="8.2"
        strokeLinejoin="round"
      />

      {/* Layer 2: HVF Emerald (#10B981) diagonal woven figure-eight ribbon */}
      <path
        d="M 24 38 C 12 26, 26 12, 38 24 L 76 62 C 88 74, 74 88, 62 76 Z"
        stroke="#10B981"
        strokeWidth="4.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Diagonal corner PCB pads (NW, NE, SE, SW) */}
      <path
        d="M 24 24 L 19 19 M 76 24 L 81 19 M 76 76 L 81 81 M 24 76 L 19 81"
        stroke="#10B981"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="18" cy="18" r="3.6" fill="#10B981" />
      <circle cx="82" cy="18" r="3.6" fill="#10B981" />
      <circle cx="82" cy="82" r="3.6" fill="#10B981" />
      <circle cx="18" cy="82" r="3.6" fill="#10B981" />

      {/* Dark sheath under-crossings for top-most Stream Cyan ribbon */}
      <path
        d="M 38 76 C 26 88, 12 74, 24 62 L 62 24 C 74 12, 88 26, 76 38 Z"
        stroke="#090E18"
        strokeWidth="8.2"
        strokeLinejoin="round"
      />

      {/* Layer 3: Stream Cyan (#22D3EE) orthogonal woven ribbon */}
      <path
        d="M 38 76 C 26 88, 12 74, 24 62 L 62 24 C 74 12, 88 26, 76 38 Z"
        stroke="#22D3EE"
        strokeWidth="4.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Over-weave Emerald bridge segments so all three threads interlock symmetrically */}
      <path
        d="M 33 47 L 47 61"
        stroke="#090E18"
        strokeWidth="8.2"
        strokeLinecap="round"
      />
      <path
        d="M 31 45 L 49 63"
        stroke="#10B981"
        strokeWidth="4.8"
        strokeLinecap="round"
      />
      <path
        d="M 53 39 L 67 53"
        stroke="#090E18"
        strokeWidth="8.2"
        strokeLinecap="round"
      />
      <path
        d="M 51 37 L 69 55"
        stroke="#818CF8"
        strokeWidth="4.4"
        strokeLinecap="round"
      />

      {/* Inner Indigo Ring-Jack Vias */}
      <circle
        cx="35"
        cy="35"
        r="3.2"
        fill="#0D1321"
        stroke="#818CF8"
        strokeWidth="2.2"
      />
      <circle
        cx="65"
        cy="65"
        r="3.2"
        fill="#0D1321"
        stroke="#818CF8"
        strokeWidth="2.2"
      />

      {/* Signature Cardinal Ring-Jack Port Terminals (N, E, S, W) */}
      <circle
        cx="50"
        cy="7.5"
        r="4.6"
        fill="#090E18"
        stroke="#22D3EE"
        strokeWidth="3"
      />
      <circle
        cx="92.5"
        cy="50"
        r="4.6"
        fill="#090E18"
        stroke="#22D3EE"
        strokeWidth="3"
      />
      <circle
        cx="50"
        cy="92.5"
        r="4.6"
        fill="#090E18"
        stroke="#22D3EE"
        strokeWidth="3"
      />
      <circle
        cx="7.5"
        cy="50"
        r="4.6"
        fill="#090E18"
        stroke="#22D3EE"
        strokeWidth="3"
      />
    </svg>
  );
}

export interface EtherloomWordmarkProps {
  markSize?: number;
  textClassName?: string;
  subtitle?: string;
  preferRaster?: boolean;
  className?: string;
}

export function EtherloomWordmark({
  markSize = 28,
  textClassName = "text-sm font-semibold tracking-tight",
  subtitle,
  preferRaster = false,
  className = "",
}: EtherloomWordmarkProps) {
  const [rasterFailed, setRasterFailed] = useState(false);

  if (preferRaster && !rasterFailed) {
    return (
      <img
        src="/brand/logo-text.png"
        alt="Etherloom"
        onError={() => setRasterFailed(true)}
        style={{ height: markSize + 8 }}
        className={`w-auto rounded-lg object-contain select-none ${className}`}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <EtherloomMark size={markSize} />
      <span className="flex flex-col leading-none">
        <span
          className={`text-slate-900 dark:text-slate-100 ${textClassName}`}
        >
          Etherloom
        </span>
        {subtitle && (
          <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400/90 mt-0.5">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}

export interface SignalWaveformIconProps {
  className?: string;
  animated?: boolean;
}

/**
 * Signature packet-capture ECG / signal spike waveform icon matching the
 * trace spikes in the official Etherloom banner artwork.
 */
export function SignalWaveformIcon({
  className = "w-3.5 h-3.5",
  animated = false,
}: SignalWaveformIconProps) {
  return (
    <svg
      viewBox="0 0 20 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 ${animated ? "animate-loom-waveform" : ""} ${className}`}
    >
      <path
        d="M1 7.5 H4.2 L6 2 L8.2 12 L10.4 4.2 L12.1 9.6 L13.6 7.5 H19"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface EtherloomBackdropOrnamentProps {
  className?: string;
  /** Optional raster asset (`/brand/banner.png` or `/brand/ornament.png`) with zero-broken-image SVG fallback. */
  rasterVariant?: "none" | "banner" | "ornament";
  opacityClassName?: string;
}

/**
 * Decorative low-opacity woven circuit ribbon & packet-capture ECG waveform backdrop
 * for empty workspace states, Welcome Hero, Academy header, and Storage Library header.
 */
export function EtherloomBackdropOrnament({
  className = "",
  rasterVariant = "none",
  opacityClassName = "opacity-20",
}: EtherloomBackdropOrnamentProps) {
  const [rasterFailed, setRasterFailed] = useState(false);

  const rasterSrc =
    rasterVariant === "banner"
      ? "/brand/banner.png"
      : rasterVariant === "ornament"
      ? "/brand/ornament.png"
      : null;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none overflow-hidden ${className}`}
    >
      {rasterSrc && !rasterFailed && (
        <img
          src={rasterSrc}
          alt=""
          onError={() => setRasterFailed(true)}
          className={`w-full h-full object-cover mix-blend-lighten ${opacityClassName}`}
          style={{
            WebkitMaskImage:
              "linear-gradient(to right, rgba(0,0,0,0.92), rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.92))",
            maskImage:
              "linear-gradient(to right, rgba(0,0,0,0.92), rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.92))",
          }}
        />
      )}

      {/* Pure inline SVG woven circuit & ECG waveform traces (always crisp, instant fallback) */}
      {(!rasterSrc || rasterFailed) && (
        <svg
          viewBox="0 0 1200 260"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
          className={`w-full h-full ${opacityClassName}`}
        >
          {/* Left-entering woven ribbons */}
          <path
            d="M -20 42 C 95 42, 130 128, 250 128 L 350 128"
            stroke="#22D3EE"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M -20 112 C 85 112, 135 58, 235 58 L 325 58"
            stroke="#10B981"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M -20 186 C 95 186, 145 96, 265 96 L 340 96"
            stroke="#6366F1"
            strokeWidth="4.2"
            strokeLinecap="round"
          />
          <path
            d="M -20 226 C 110 226, 150 168, 280 168 L 365 168"
            stroke="#22D3EE"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity="0.75"
          />

          {/* Left ring-jack port pads */}
          <circle
            cx="356"
            cy="128"
            r="5.5"
            fill="#0D1321"
            stroke="#22D3EE"
            strokeWidth="3"
          />
          <circle
            cx="331"
            cy="58"
            r="5"
            fill="#0D1321"
            stroke="#10B981"
            strokeWidth="2.8"
          />
          <circle
            cx="346"
            cy="96"
            r="5"
            fill="#0D1321"
            stroke="#818CF8"
            strokeWidth="2.8"
          />
          <circle
            cx="371"
            cy="168"
            r="4.5"
            fill="#0D1321"
            stroke="#22D3EE"
            strokeWidth="2.5"
          />

          {/* Left ECG packet waveform trace */}
          <path
            d="M 55 28 H 148 L 156 12 L 164 42 L 172 20 L 179 33 L 185 28 H 288"
            stroke="#34D399"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="293"
            cy="28"
            r="3.2"
            fill="#0D1321"
            stroke="#34D399"
            strokeWidth="2"
          />

          <path
            d="M 85 212 H 180 L 188 196 L 196 226 L 204 205 L 210 217 L 216 212 H 312"
            stroke="#22D3EE"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Right-entering symmetrical woven ribbons */}
          <path
            d="M 1220 48 C 1105 48, 1070 134, 950 134 L 850 134"
            stroke="#10B981"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M 1220 118 C 1115 118, 1065 64, 965 64 L 875 64"
            stroke="#22D3EE"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M 1220 192 C 1105 192, 1055 102, 935 102 L 860 102"
            stroke="#6366F1"
            strokeWidth="4.2"
            strokeLinecap="round"
          />
          <path
            d="M 1220 230 C 1090 230, 1050 172, 920 172 L 835 172"
            stroke="#10B981"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity="0.75"
          />

          {/* Right ring-jack port pads */}
          <circle
            cx="844"
            cy="134"
            r="5.5"
            fill="#0D1321"
            stroke="#10B981"
            strokeWidth="3"
          />
          <circle
            cx="869"
            cy="64"
            r="5"
            fill="#0D1321"
            stroke="#22D3EE"
            strokeWidth="2.8"
          />
          <circle
            cx="854"
            cy="102"
            r="5"
            fill="#0D1321"
            stroke="#818CF8"
            strokeWidth="2.8"
          />
          <circle
            cx="829"
            cy="172"
            r="4.5"
            fill="#0D1321"
            stroke="#10B981"
            strokeWidth="2.5"
          />

          {/* Right ECG packet waveform traces */}
          <path
            d="M 1145 32 H 1052 L 1044 16 L 1036 46 L 1028 24 L 1021 37 L 1015 32 H 912"
            stroke="#22D3EE"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="907"
            cy="32"
            r="3.2"
            fill="#0D1321"
            stroke="#22D3EE"
            strokeWidth="2"
          />

          <path
            d="M 1115 216 H 1020 L 1012 200 L 1004 230 L 996 209 L 990 221 L 984 216 H 888"
            stroke="#818CF8"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
