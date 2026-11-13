import {
  Monitor,
  Play,
  Settings,
  Square,
  Terminal,
} from "lucide-react";
import type { EtherloomFlowNode } from "../canvas/EtherloomNode";
import {
  SerialTerminalPane,
  serialDeviceNameForFamily,
} from "./SerialTerminalPane";
import { VncScreenPane } from "./VncScreenPane";
import type { VmConsoleSubMode, VmDisplayMode } from "../../types/studio";

interface VmConsoleTabContentProps {
  node: EtherloomFlowNode;
  active: boolean;
  mode: VmConsoleSubMode;
  onChangeMode: (mode: VmConsoleSubMode) => void;
  onToggleRun: (nodeId: string) => void;
  onOpenNodeSettings: (nodeId: string) => void;
  onChangeDisplayMode: (nodeId: string, mode: VmDisplayMode) => void;
}

export function VmConsoleTabContent({
  node,
  active,
  mode,
  onChangeMode,
  onToggleRun,
  onOpenNodeSettings,
  onChangeDisplayMode,
}: VmConsoleTabContentProps) {
  const { label, guestFamily, status, displayMode } = node.data;
  const serialDev = serialDeviceNameForFamily(guestFamily);
  const isUp = status === "running" || status === "booting";

  return (
    <div
      className={`h-full w-full flex flex-col gap-2 ${
        active ? "" : "hidden"
      }`}
    >
      {/* Per-VM Subheader with Instant Top-Right Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              status === "running"
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                : status === "booting"
                ? "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300"
                : "bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === "running"
                  ? "bg-emerald-500 animate-pulse"
                  : status === "booting"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-slate-400"
              }`}
            />
            <span className="font-mono font-semibold">{label}</span>
            <span className="opacity-75">
              ({(guestFamily ?? "linux").toUpperCase()})
            </span>
          </span>

          <button
            type="button"
            onClick={() => onToggleRun(node.id)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isUp
                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {isUp ? (
              <>
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>Start VM</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenNodeSettings(node.id)}
            title="Configure Hardware, NICs & Boot ISO"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800 border border-slate-200/80 dark:border-zinc-700/80"
          >
            <Settings className="w-3 h-3" />
            <span className="hidden sm:inline">Hardware / ISO</span>
          </button>
        </div>

        {/* Instant Top-Right Dual-Console Switcher */}
        <div
          className="flex items-center bg-slate-100 dark:bg-[#162032] p-0.5 rounded-lg border border-slate-200/80 dark:border-[rgba(34,211,238,0.16)]"
          role="tablist"
          aria-label="Console view switcher"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "serial"}
            onClick={() => onChangeMode("serial")}
            title="Serial Console (ttyAMA0 / com0 / ttyu0)"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              mode === "serial"
                ? "bg-white dark:bg-[#090E18] text-cyan-700 dark:text-[#22D3EE] shadow-xs"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="font-mono">Serial ({serialDev})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === "display"}
            onClick={() => onChangeMode("display")}
            title="UEFI / Graphical Framebuffer Screen (@novnc/novnc or Cocoa)"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              mode === "display"
                ? "bg-white dark:bg-[#090E18] text-indigo-700 dark:text-[#818CF8] shadow-xs"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>UEFI / Graphical Screen</span>
          </button>
        </div>
      </div>

      {/* Mounted Dual Console Panes (0ms instant switch) */}
      <div className="flex-1 min-h-0">
        <SerialTerminalPane
          nodeId={node.id}
          hostname={label}
          guestFamily={guestFamily}
          status={status}
          visible={active && mode === "serial"}
          onBootVm={() => onToggleRun(node.id)}
        />
        <VncScreenPane
          nodeId={node.id}
          hostname={label}
          guestFamily={guestFamily}
          displayMode={displayMode}
          status={status}
          visible={active && mode === "display"}
          onBootVm={() => onToggleRun(node.id)}
          onSwitchDisplayMode={(nextMode) =>
            onChangeDisplayMode(node.id, nextMode)
          }
        />
      </div>
    </div>
  );
}
