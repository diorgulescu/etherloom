import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Waves,
  X,
} from "lucide-react";
import {
  pickDirectoryDialog,
  probeStoragePathTelemetry,
  setTcpflowyLocalRepoPath,
} from "../../services/tauriBridge";
import type {
  DiskTelemetry,
  StorageMigrationMode,
  StorageMigrationProgress,
  StorageMigrationResult,
  StorageStateSnapshot,
  TcpflowyEnvStatus,
  TcpflowyInstallProgress,
  ThemePreference,
  UpdateStorageRequest,
} from "../../types/studio";
import { formatBytesCompact } from "../layout/StatusBar";

export type SettingsSectionId = "storage" | "tcpflowy" | "general";

interface SettingsModalProps {
  open: boolean;
  initialSection?: SettingsSectionId;
  storageState: StorageStateSnapshot | null;
  migrationProgress: StorageMigrationProgress | null;
  tcpflowyStatus: TcpflowyEnvStatus | null;
  tcpflowyProgress: TcpflowyInstallProgress | null;
  installingTcpflowy: boolean;
  themePreference: ThemePreference;
  onChangeTheme: (pref: ThemePreference) => void;
  onClose: () => void;
  onApplyStorageUpdate: (
    request: UpdateStorageRequest
  ) => Promise<StorageMigrationResult>;
  onRetryDetection: () => Promise<void>;
  onFallbackInternal: () => Promise<void>;
  onInstallTcpflowy: () => Promise<void>;
  onTcpflowyStatusChanged: (next: TcpflowyEnvStatus) => void;
}

export function SettingsModal({
  open,
  initialSection = "storage",
  storageState,
  migrationProgress,
  tcpflowyStatus,
  tcpflowyProgress,
  installingTcpflowy,
  themePreference,
  onChangeTheme,
  onClose,
  onApplyStorageUpdate,
  onRetryDetection,
  onFallbackInternal,
  onInstallTcpflowy,
  onTcpflowyStatusChanged,
}: SettingsModalProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>(initialSection);

  const [localRepoDraft, setLocalRepoDraft] = useState("");
  const [repoSaving, setRepoSaving] = useState(false);
  const [tcpflowyFeedback, setTcpflowyFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const [storageRoot, setStorageRoot] = useState("");
  const [showAdvancedOverrides, setShowAdvancedOverrides] = useState(false);
  const [templatesOverride, setTemplatesOverride] = useState("");
  const [isosOverride, setIsosOverride] = useState("");
  const [workspacesOverride, setWorkspacesOverride] = useState("");

  const [mode, setMode] = useState<StorageMigrationMode>("switch_only");
  const [deleteSource, setDeleteSource] = useState(false);

  const [previewTelemetry, setPreviewTelemetry] =
    useState<DiskTelemetry | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveSection(initialSection);
    setTcpflowyFeedback(null);
  }, [initialSection, open]);

  useEffect(() => {
    if (!open || !tcpflowyStatus) return;
    setLocalRepoDraft(tcpflowyStatus.localRepoPath ?? "");
  }, [open, tcpflowyStatus]);

  useEffect(() => {
    if (!open || !storageState) return;
    setStorageRoot(storageState.config.storageRoot);
    const tOv = storageState.config.templatesDirOverride ?? "";
    const iOv = storageState.config.isosDirOverride ?? "";
    const wOv = storageState.config.workspacesDirOverride ?? "";
    setTemplatesOverride(tOv);
    setIsosOverride(iOv);
    setWorkspacesOverride(wOv);
    setShowAdvancedOverrides(Boolean(tOv || iOv || wOv));
    setFeedbackError(null);
    setFeedbackSuccess(null);
  }, [open, storageState]);

  const hasChanges = useMemo(() => {
    if (!storageState) return false;
    const norm = (s: string | null | undefined) => (s ?? "").trim();
    return (
      norm(storageRoot) !== norm(storageState.config.storageRoot) ||
      norm(templatesOverride) !==
        norm(storageState.config.templatesDirOverride) ||
      norm(isosOverride) !== norm(storageState.config.isosDirOverride) ||
      norm(workspacesOverride) !==
        norm(storageState.config.workspacesDirOverride)
    );
  }, [
    isosOverride,
    storageRoot,
    storageState,
    templatesOverride,
    workspacesOverride,
  ]);

  useEffect(() => {
    if (!open || !storageRoot.trim()) {
      setPreviewTelemetry(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    probeStoragePathTelemetry(storageRoot.trim())
      .then((tel) => {
        if (!cancelled) {
          setPreviewTelemetry(tel);
          setPreviewError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviewTelemetry(null);
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, storageRoot]);

  if (!open) return null;

  const activeTelemetry = previewTelemetry ?? storageState?.diskTelemetry ?? null;
  const usedPercent =
    activeTelemetry && activeTelemetry.totalBytes > 0
      ? Math.min(
          100,
          Math.max(
            0,
            ((activeTelemetry.totalBytes - activeTelemetry.freeBytes) /
              activeTelemetry.totalBytes) *
              100
          )
        )
      : 0;

  const handleBrowse = async (
    title: string,
    currentVal: string,
    setter: (next: string) => void
  ) => {
    const picked = await pickDirectoryDialog(title, currentVal || undefined);
    if (picked) {
      setter(picked);
      setFeedbackError(null);
      setFeedbackSuccess(null);
    }
  };

  const handleSave = async () => {
    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const result = await onApplyStorageUpdate({
        storageRoot: storageRoot.trim(),
        templatesDirOverride: templatesOverride.trim() || null,
        isosDirOverride: isosOverride.trim() || null,
        workspacesDirOverride: workspacesOverride.trim() || null,
        mode,
        deleteSourceAfterVerify:
          mode === "move_existing_data" ? deleteSource : false,
      });

      if (mode === "move_existing_data") {
        setFeedbackSuccess(
          `Transferred ${result.filesCopied} file(s) (${formatBytesCompact(
            result.bytesCopied
          )}) and verified sizes.${
            result.sourceCleaned ? " Old source directory cleaned." : ""
          }`
        );
      } else {
        setFeedbackSuccess(
          `Switched active library (${result.templatesDiscovered} template(s), ${result.isosDiscovered} ISO/IMG file(s) detected).`
        );
      }
    } catch (err: unknown) {
      setFeedbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 dark:bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="etherloom-settings-title"
    >
      <div className="w-full max-w-3xl max-h-[88vh] rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-sky-500" />
            <h2
              id="etherloom-settings-title"
              className="text-sm font-semibold text-slate-900 dark:text-zinc-100"
            >
              Etherloom Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close settings"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body with left sidebar */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <nav className="w-48 shrink-0 border-r border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-950/40 p-2.5 space-y-1">
            <button
              type="button"
              onClick={() => setActiveSection("storage")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeSection === "storage"
                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Storage &amp; Disks</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("tcpflowy")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeSection === "tcpflowy"
                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
              }`}
            >
              <Waves className="w-3.5 h-3.5" />
              <span>tcpflowy &amp; Capture</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("general")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeSection === "general"
                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Appearance</span>
            </button>
          </nav>

          {/* Right Pane */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {activeSection === "storage" && storageState && (
              <>
                {/* Disconnected Warning Card inside Modal */}
                {storageState.status.state === "volumeDisconnected" && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>
                        Volume &ldquo;{storageState.status.volumeName}&rdquo; is
                        Currently Unmounted
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
                      Etherloom blocked directory creation on{" "}
                      <code className="font-mono">
                        {storageState.status.expectedPath}
                      </code>{" "}
                      to protect <code className="font-mono">/Volumes</code>.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void onRetryDetection()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white dark:bg-zinc-900 border border-amber-500/30 text-amber-800 dark:text-amber-200"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry Detection
                      </button>
                      <button
                        type="button"
                        onClick={() => void onFallbackInternal()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-600 text-white"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Fallback to Default Internal Storage
                      </button>
                    </div>
                  </div>
                )}

                {/* Volume Capacity & Filesystem Telemetry Card */}
                {activeTelemetry && (
                  <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-950/60 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-sky-500" />
                        <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                          {activeTelemetry.isExternalVolume
                            ? "External Volume Telemetry"
                            : "Storage Volume Telemetry"}
                        </span>
                        <span className="uppercase text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                          {activeTelemetry.filesystemType}
                        </span>
                      </div>
                      <span className="text-xs font-mono font-medium text-emerald-700 dark:text-emerald-400">
                        {formatBytesCompact(activeTelemetry.freeBytes)} free of{" "}
                        {formatBytesCompact(activeTelemetry.totalBytes)}
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all"
                        style={{ width: `${usedPercent.toFixed(1)}%` }}
                      />
                    </div>

                    {/* Non-blocking ExFAT sparse qcow2 tip */}
                    {activeTelemetry.advisoryTip && (
                      <div className="flex items-start gap-2 pt-1 text-[11px] text-sky-700 dark:text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded-lg px-3 py-2">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-500" />
                        <span>{activeTelemetry.advisoryTip}</span>
                      </div>
                    )}
                  </div>
                )}

                {previewError && (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                    {previewError}
                  </div>
                )}

                {/* Primary storage_root Folder Picker */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                      Primary Media Library Root (<code className="font-mono">storage_root</code>)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setStorageRoot(storageState.defaultStorageRoot)
                      }
                      className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      Use Default Internal Path
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Stores heavy VM base templates, installer ISOs/IMGs, and new{" "}
                    <code className="font-mono">*.etherloom</code> lab workspaces
                    (supports external <code className="font-mono">/Volumes/...</code>{" "}
                    USB-C / Thunderbolt SSDs).
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={storageRoot}
                      onChange={(e) => setStorageRoot(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void handleBrowse(
                          "Select Etherloom Media Library Folder",
                          storageRoot,
                          setStorageRoot
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 transition-colors shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Browse…</span>
                    </button>
                  </div>
                </div>

                {/* Optional Independent Overrides */}
                <div className="border border-slate-200/80 dark:border-zinc-800 rounded-xl p-3.5 space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedOverrides((v) => !v)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                      Optional Independent Folder Overrides
                    </span>
                    <span className="text-[11px] text-sky-600 dark:text-sky-400">
                      {showAdvancedOverrides ? "Hide" : "Customize"}
                    </span>
                  </button>

                  {showAdvancedOverrides && (
                    <div className="space-y-2.5 pt-1 border-t border-slate-100 dark:border-zinc-800">
                      {(
                        [
                          {
                            label: "Templates Directory (templates_dir)",
                            placeholder: `${storageRoot.replace(/\/$/, "")}/templates`,
                            value: templatesOverride,
                            setter: setTemplatesOverride,
                          },
                          {
                            label: "Installer ISOs / IMGs (isos_dir)",
                            placeholder: `${storageRoot.replace(/\/$/, "")}/isos`,
                            value: isosOverride,
                            setter: setIsosOverride,
                          },
                          {
                            label: "Default Projects Parent (workspaces_dir)",
                            placeholder: `${storageRoot.replace(/\/$/, "")}/projects`,
                            value: workspacesOverride,
                            setter: setWorkspacesOverride,
                          },
                        ] as const
                      ).map((row) => (
                        <div key={row.label} className="space-y-1">
                          <label className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                            {row.label}
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={row.value}
                              onChange={(e) => row.setter(e.target.value)}
                              placeholder={`Default: ${row.placeholder}`}
                              className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void handleBrowse(
                                  row.label,
                                  row.value || storageRoot,
                                  row.setter
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200"
                            >
                              Browse…
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Migration Mode Options when Path Changed */}
                {hasChanges && (
                  <div className="rounded-xl border border-sky-500/35 bg-sky-500/[0.06] p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                      <ArrowRightLeft className="w-4 h-4 text-sky-500" />
                      <span>How should Etherloom apply the new storage location?</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setMode("switch_only")}
                        className={`text-left p-3 rounded-lg border transition-all ${
                          mode === "switch_only"
                            ? "bg-white dark:bg-zinc-900 border-sky-500 ring-2 ring-sky-500/25"
                            : "bg-white/60 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800"
                        }`}
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                          1. Switch Path Only
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                          Point immediately to the chosen folder and auto-discover
                          existing <code className="font-mono">.qcow2</code>{" "}
                          templates and <code className="font-mono">.iso/.img</code>{" "}
                          files there.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setMode("move_existing_data")}
                        className={`text-left p-3 rounded-lg border transition-all ${
                          mode === "move_existing_data"
                            ? "bg-white dark:bg-zinc-900 border-sky-500 ring-2 ring-sky-500/25"
                            : "bg-white/60 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800"
                        }`}
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                          2. Move Existing Library Data
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                          Copy existing templates &amp; ISOs to the new drive with
                          live progress, verify file sizes, and update{" "}
                          <code className="font-mono">settings.toml</code>.
                        </p>
                      </button>
                    </div>

                    {mode === "move_existing_data" && (
                      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={deleteSource}
                          onChange={(e) => setDeleteSource(e.target.checked)}
                          className="rounded accent-sky-500"
                        />
                        <span>
                          Clean up old source files after byte-size verification
                          completes
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* Live Migration Progress Bar */}
                {submitting && migrationProgress && (
                  <div className="rounded-xl border border-indigo-500/35 bg-indigo-500/10 p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-indigo-900 dark:text-indigo-200 truncate">
                        Migrating: {migrationProgress.currentFile}
                      </span>
                      <span className="font-mono text-[11px] text-indigo-700 dark:text-indigo-300 shrink-0">
                        {migrationProgress.filesCompleted}/
                        {migrationProgress.totalFiles} files •{" "}
                        {formatBytesCompact(migrationProgress.bytesCopied)} /{" "}
                        {formatBytesCompact(migrationProgress.totalBytes)} (
                        {migrationProgress.percent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-indigo-950/20 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{
                          width: `${migrationProgress.percent.toFixed(1)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {feedbackError && (
                  <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                    {feedbackError}
                  </div>
                )}

                {feedbackSuccess && (
                  <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                    <span>{feedbackSuccess}</span>
                  </div>
                )}

                {/* Fixed Internal Local Runtime Paths Info Card */}
                <div className="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-950/40 p-3.5 space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-zinc-300">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Internal Runtime State (Always Kept on Local SSD)</span>
                  </div>
                  <p className="text-slate-500 dark:text-zinc-400">
                    Kept local to guarantee POSIX symlink &amp; Unix domain socket
                    compatibility even when media resides on ExFAT drives:
                  </p>
                  <div className="font-mono text-[10px] text-slate-600 dark:text-zinc-400 space-y-0.5 pt-1">
                    <div>Config: {storageState.settingsFile}</div>
                    <div>tcpflowy venv: {storageState.pythonEnvDir}</div>
                    <div>QEMU sockets &amp; FIFOs: {storageState.runtimeSocketsDir}</div>
                  </div>
                </div>
              </>
            )}

            {activeSection === "tcpflowy" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Waves className="w-4 h-4 text-indigo-500" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                        Managed <code className="font-mono">tcpflowy</code>{" "}
                        Python Dissector Environment
                      </span>
                    </div>
                    {tcpflowyStatus && (
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          tcpflowyStatus.state === "ready"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30"
                        }`}
                      >
                        {tcpflowyStatus.state === "ready"
                          ? `READY • v${tcpflowyStatus.installedVersion ?? "1.1"} (${
                              tcpflowyStatus.activeSource
                            })`
                          : tcpflowyStatus.state.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {tcpflowyStatus && (
                    <p className="text-[11px] text-slate-600 dark:text-zinc-400">
                      {tcpflowyStatus.message}
                    </p>
                  )}

                  {tcpflowyStatus && (
                    <div className="font-mono text-[10.5px] text-slate-600 dark:text-zinc-400 space-y-1 pt-1 border-t border-slate-200/70 dark:border-zinc-800">
                      <div>Managed venv: {tcpflowyStatus.venvDir}</div>
                      <div>
                        Python binary:{" "}
                        {tcpflowyStatus.pythonBin ?? "Not detected"}
                      </div>
                      <div>
                        tshark binary:{" "}
                        {tcpflowyStatus.tsharkBin ??
                          "Not detected (brew install --cask wireshark)"}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={installingTcpflowy}
                      onClick={() => {
                        setTcpflowyFeedback(null);
                        void onInstallTcpflowy();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
                    >
                      {installingTcpflowy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {installingTcpflowy
                          ? "Installing / Upgrading…"
                          : tcpflowyStatus?.venvExists &&
                            tcpflowyStatus?.installedVersion
                          ? "Upgrade tcpflowy from PyPI"
                          : "Create venv & Install tcpflowy (PyPI)"}
                      </span>
                    </button>
                  </div>

                  {installingTcpflowy && tcpflowyProgress && (
                    <div className="rounded-lg border border-indigo-500/35 bg-indigo-500/10 p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-indigo-900 dark:text-indigo-200">
                          {tcpflowyProgress.message}
                        </span>
                        <span className="font-mono text-[11px] text-indigo-700 dark:text-indigo-300">
                          {tcpflowyProgress.percent}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-indigo-950/20 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all"
                          style={{ width: `${tcpflowyProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Local tcpflowy Git Repository Override for Development */}
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                      Local <code className="font-mono">tcpflowy</code>{" "}
                      Repository Override (Development)
                    </label>
                    {localRepoDraft && (
                      <button
                        type="button"
                        disabled={repoSaving}
                        onClick={async () => {
                          setRepoSaving(true);
                          setTcpflowyFeedback(null);
                          try {
                            const st = await setTcpflowyLocalRepoPath(null);
                            setLocalRepoDraft("");
                            onTcpflowyStatusChanged(st);
                            setTcpflowyFeedback({
                              kind: "ok",
                              text: "Cleared local repository override; using managed python-env.",
                            });
                          } catch (err: unknown) {
                            setTcpflowyFeedback({
                              kind: "error",
                              text:
                                err instanceof Error
                                  ? err.message
                                  : String(err),
                            });
                          } finally {
                            setRepoSaving(false);
                          }
                        }}
                        className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        Clear Override
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Optional: point directly to a local{" "}
                    <code className="font-mono">tcpflowy</code> checkout
                    containing <code className="font-mono">tcpflowy.py</code>{" "}
                    and <code className="font-mono">include/</code> to test
                    dissector changes live without reinstalling from PyPI.
                  </p>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={localRepoDraft}
                      onChange={(e) => setLocalRepoDraft(e.target.value)}
                      placeholder="/path/to/local/tcpflowy"
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void handleBrowse(
                          "Select Local tcpflowy Repository Folder",
                          localRepoDraft,
                          setLocalRepoDraft
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Browse…</span>
                    </button>
                    <button
                      type="button"
                      disabled={repoSaving}
                      onClick={async () => {
                        setRepoSaving(true);
                        setTcpflowyFeedback(null);
                        try {
                          const st = await setTcpflowyLocalRepoPath(
                            localRepoDraft.trim() || null
                          );
                          onTcpflowyStatusChanged(st);
                          setTcpflowyFeedback({
                            kind: "ok",
                            text: localRepoDraft.trim()
                              ? `Active source set to local repository (${st.localRepoPath}).`
                              : "Using managed PyPI python-env.",
                          });
                        } catch (err: unknown) {
                          setTcpflowyFeedback({
                            kind: "error",
                            text:
                              err instanceof Error ? err.message : String(err),
                          });
                        } finally {
                          setRepoSaving(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shrink-0"
                    >
                      {repoSaving ? "Saving…" : "Apply"}
                    </button>
                  </div>

                  {tcpflowyFeedback && (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        tcpflowyFeedback.kind === "ok"
                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      }`}
                    >
                      {tcpflowyFeedback.text}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSection === "general" && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                  Studio Theme
                </h3>
                <div className="grid grid-cols-3 gap-2.5">
                  {(
                    [
                      { id: "system", title: "System Automatic" },
                      { id: "light", title: "Light Mode" },
                      { id: "dark", title: "Dark Mode" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onChangeTheme(opt.id)}
                      className={`p-3 rounded-xl border text-xs font-medium transition-all ${
                        themePreference === opt.id
                          ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          : "border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300"
                      }`}
                    >
                      {opt.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 dark:text-zinc-400">
            Portable <code className="font-mono">qcow2</code> overlays auto-rebase
            when templates move.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
            >
              Close
            </button>
            {activeSection === "storage" && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!hasChanges || submitting || Boolean(previewError)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white transition-colors"
              >
                {submitting
                  ? "Applying…"
                  : mode === "move_existing_data" && hasChanges
                  ? "Move Data & Save"
                  : "Save Storage Path"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
