import { FolderSearch, HardDriveDownload, RefreshCw, Unplug } from "lucide-react";

interface VolumeDisconnectedBannerProps {
  volumeName: string;
  expectedPath: string;
  busy: boolean;
  onRetry: () => void;
  onSelectDifferentFolder: () => void;
  onFallbackInternal: () => void;
}

export function VolumeDisconnectedBanner({
  volumeName,
  expectedPath,
  busy,
  onRetry,
  onSelectDifferentFolder,
  onFallbackInternal,
}: VolumeDisconnectedBannerProps) {
  return (
    <div className="shrink-0 bg-amber-500/12 dark:bg-amber-500/15 border-b border-amber-500/35 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 z-20">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/35 flex items-center justify-center shrink-0">
          <Unplug className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            External Volume &ldquo;{volumeName}&rdquo; Disconnected
          </p>
          <p className="text-[11px] text-amber-800/90 dark:text-amber-300/85 truncate font-mono">
            Expected library path: {expectedPath}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 hover:bg-white dark:bg-[#162032] dark:hover:bg-[#1E2B42] border border-amber-500/35 text-amber-900 dark:text-amber-200 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          <span>Retry Detection</span>
        </button>

        <button
          type="button"
          onClick={onSelectDifferentFolder}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 hover:bg-white dark:bg-[#162032] dark:hover:bg-[#1E2B42] border border-amber-500/35 text-amber-900 dark:text-amber-200 disabled:opacity-50 transition-colors"
        >
          <FolderSearch className="w-3.5 h-3.5" />
          <span>Select Different Folder…</span>
        </button>

        <button
          type="button"
          onClick={onFallbackInternal}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 transition-colors shadow-2xs"
        >
          <HardDriveDownload className="w-3.5 h-3.5" />
          <span>Fallback to Default Internal Storage</span>
        </button>
      </div>
    </div>
  );
}
