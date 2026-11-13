import { AlertTriangle, HardDrive, ShieldCheck } from "lucide-react";
import type { StorageStateSnapshot } from "../../types/studio";

interface StatusBarProps {
  storageState: StorageStateSnapshot | null;
  nodeCount: number;
  linkCount: number;
  onOpenStorageSettings: () => void;
}

export function formatBytesCompact(bytes: number): string {
  if (bytes >= 1099511627776) {
    return `${(bytes / 1099511627776).toFixed(2)} TB`;
  }
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function StatusBar({
  storageState,
  nodeCount,
  linkCount,
  onOpenStorageSettings,
}: StatusBarProps) {
  const disconnected = storageState?.status.state === "volumeDisconnected";
  const telemetry = storageState?.diskTelemetry ?? null;

  return (
    <footer className="h-7 shrink-0 border-t border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] bg-slate-100/90 dark:bg-[#090E18] px-3 flex items-center justify-between gap-3 text-[11px] text-slate-600 dark:text-slate-400 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-[#34D399] font-medium shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          HVF Userspace
        </span>
        <span className="text-slate-300 dark:text-slate-800">|</span>
        <span className="font-mono truncate">
          {nodeCount} Nodes • {linkCount} Wires
        </span>
        {storageState && (
          <>
            <span className="hidden md:inline text-slate-300 dark:text-slate-800">
              |
            </span>
            <span
              title={storageState.config.storageRoot}
              className="hidden md:inline font-mono text-[10px] text-slate-500 dark:text-slate-500 truncate"
            >
              Library: {storageState.config.storageRoot}
            </span>
          </>
        )}
      </div>

      {/* SSD / Volume Free Space Telemetry Pill */}
      <button
        type="button"
        onClick={onOpenStorageSettings}
        title="Configure Storage & External SSD Library"
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium border transition-colors shrink-0 ${
          disconnected
            ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-[#F59E0B] hover:bg-amber-500/25"
            : telemetry?.isExternalVolume
            ? "bg-emerald-500/12 border-emerald-500/30 text-emerald-700 dark:text-[#34D399] hover:bg-emerald-500/20"
            : "bg-white dark:bg-[#111827] border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-700 dark:text-slate-200 hover:border-cyan-400/45"
        }`}
      >
        {disconnected ? (
          <>
            <AlertTriangle className="w-3 h-3 text-[#F59E0B]" />
            <span>
              Drive Offline (
              {storageState.status.state === "volumeDisconnected"
                ? storageState.status.volumeName
                : "Volume"}
              )
            </span>
          </>
        ) : telemetry ? (
          <>
            <HardDrive
              className={`w-3 h-3 ${
                telemetry.isExternalVolume
                  ? "text-[#10B981]"
                  : "text-[#22D3EE]"
              }`}
            />
            <span>{formatBytesCompact(telemetry.freeBytes)} Free</span>
            <span className="uppercase text-[9px] px-1 rounded bg-slate-100 dark:bg-[#090E18] text-slate-500 dark:text-slate-400">
              {telemetry.filesystemType}
            </span>
          </>
        ) : (
          <>
            <HardDrive className="w-3 h-3 text-[#22D3EE]" />
            <span>Storage Settings</span>
          </>
        )}
      </button>
    </footer>
  );
}
