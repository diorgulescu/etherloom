import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  cancelCatalogDownload,
  deleteCatalogImage,
  importCatalogLocalFile,
  launchCatalogGuidedSetup,
  listCatalogEntries,
  onCatalogDownloadProgress,
  pickCatalogDiskOrArchiveDialog,
  pickDirectoryDialog,
  probeStoragePathTelemetry,
  revealInFinder,
  startCatalogDownload,
} from "../../services/tauriBridge";
import type {
  CatalogDownloadProgressEvent,
  DiskTelemetry,
  OsCatalogEntryDto,
  StorageMigrationMode,
  StorageMigrationProgress,
  StorageMigrationResult,
  StorageStateSnapshot,
  UpdateStorageRequest,
  VmInstanceInfo,
} from "../../types/studio";
import { formatByteSize } from "../../utils/topology";

type FilterTabId =
  | "all"
  | "ready"
  | "arm64"
  | "x86"
  | "Linux"
  | "BSD Family"
  | "Routers & Firewalls"
  | "Research, UNIX & Retro";

interface StorageLibraryModalProps {
  open: boolean;
  hostArch?: string;
  storageState: StorageStateSnapshot | null;
  migrationProgress: StorageMigrationProgress | null;
  focusedCatalogIds?: string[] | null;
  focusedLabTitle?: string | null;
  onClearFocusedCatalogIds?: () => void;
  onReturnToAcademy?: () => void;
  onClose: () => void;
  onApplyStorageUpdate: (
    request: UpdateStorageRequest
  ) => Promise<StorageMigrationResult>;
  onRetryDetection: () => Promise<void>;
  onFallbackInternal: () => Promise<void>;
  onAddCatalogOsNode: (entry: OsCatalogEntryDto) => void;
  onGuidedSetupStarted: (entry: OsCatalogEntryDto, vm: VmInstanceInfo) => void;
  onTemplatesChanged: () => Promise<void>;
  onNotify: (kind: "ok" | "error", text: string) => void;
}

export function StorageLibraryModal({
  open,
  hostArch = "aarch64",
  storageState,
  migrationProgress,
  focusedCatalogIds = null,
  focusedLabTitle = null,
  onClearFocusedCatalogIds,
  onReturnToAcademy,
  onClose,
  onApplyStorageUpdate,
  onRetryDetection,
  onFallbackInternal,
  onAddCatalogOsNode,
  onGuidedSetupStarted,
  onTemplatesChanged,
  onNotify,
}: StorageLibraryModalProps) {
  const [entries, setEntries] = useState<OsCatalogEntryDto[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTabId>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Live download progress map keyed by `catalogId`
  const [progressById, setProgressById] = useState<
    Record<string, CatalogDownloadProgressEvent>
  >({});

  // Per-card UI state: expanded tips, custom mirror URL input, delete confirm
  const [expandedTips, setExpandedTips] = useState<Record<string, boolean>>({});
  const [mirrorInputOpen, setMirrorInputOpen] = useState<
    Record<string, boolean>
  >({});
  const [customMirrorUrl, setCustomMirrorUrl] = useState<
    Record<string, string>
  >({});
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] =
    useState<OsCatalogEntryDto | null>(null);

  // Collapsible Storage Location & Overrides Editor
  const [storageEditorOpen, setStorageEditorOpen] = useState(false);
  const [storageRootDraft, setStorageRootDraft] = useState("");
  const [templatesOverride, setTemplatesOverride] = useState("");
  const [isosOverride, setIsosOverride] = useState("");
  const [workspacesOverride, setWorkspacesOverride] = useState("");
  const [overridesExpanded, setOverridesExpanded] = useState(false);
  const [migrationMode, setMigrationMode] =
    useState<StorageMigrationMode>("move_existing_data");
  const [deleteSourceAfterVerify, setDeleteSourceAfterVerify] = useState(false);
  const [probedTelemetry, setProbedTelemetry] = useState<DiskTelemetry | null>(
    null
  );
  const [applyingStorage, setApplyingStorage] = useState(false);

  const refreshCatalog = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const list = await listCatalogEntries();
      setEntries(list);
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEntries(false);
    }
  }, [onNotify]);

  useEffect(() => {
    if (!open) return;
    if (focusedCatalogIds && focusedCatalogIds.length > 0) {
      setFilterTab("all");
      setSearchQuery("");
    }
    void refreshCatalog();
  }, [focusedCatalogIds, open, refreshCatalog, storageState?.resolvedTemplatesDir]);

  // Sync storage drafts from active `storageState`
  useEffect(() => {
    if (!storageState) return;
    setStorageRootDraft(storageState.config.storageRoot);
    setTemplatesOverride(storageState.config.templatesDirOverride ?? "");
    setIsosOverride(storageState.config.isosDirOverride ?? "");
    setWorkspacesOverride(storageState.config.workspacesDirOverride ?? "");
    setProbedTelemetry(storageState.diskTelemetry);
  }, [storageState]);

  // Subscribe to `"catalog://download-progress"` events while open (or globally)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onCatalogDownloadProgress((ev) => {
      setProgressById((prev) => ({ ...prev, [ev.catalogId]: ev }));
      if (
        ev.stage === "ready" ||
        ev.stage === "error" ||
        ev.stage === "cancelled"
      ) {
        if (ev.stage === "ready") {
          onNotify("ok", ev.message);
          void onTemplatesChanged();
        } else if (ev.stage === "error" && ev.error) {
          onNotify("error", `${ev.catalogId}: ${ev.error}`);
        }
        void refreshCatalog();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [onNotify, onTemplatesChanged, refreshCatalog]);

  const readyCount = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.availability === "ready" || e.availability === "installer_ready"
      ).length,
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const focusSet =
      focusedCatalogIds && focusedCatalogIds.length > 0
        ? new Set(focusedCatalogIds.map((id) => id.toLowerCase()))
        : null;

    return entries.filter((entry) => {
      if (focusSet) {
        if (
          !focusSet.has(entry.id.toLowerCase()) &&
          !focusSet.has(entry.osProfileId.toLowerCase())
        ) {
          return false;
        }
      }

      if (filterTab === "ready") {
        if (
          entry.availability !== "ready" &&
          entry.availability !== "installer_ready"
        ) {
          return false;
        }
      } else if (filterTab === "arm64") {
        if (entry.arch !== "aarch64") return false;
      } else if (filterTab === "x86") {
        if (entry.arch === "aarch64") return false;
      } else if (
        filterTab === "Linux" ||
        filterTab === "BSD Family" ||
        filterTab === "Routers & Firewalls" ||
        filterTab === "Research, UNIX & Retro"
      ) {
        if (entry.category !== filterTab) return false;
      }

      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.version.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        entry.nicNamingHint.toLowerCase().includes(q) ||
        entry.arch.toLowerCase().includes(q)
      );
    });
  }, [entries, filterTab, focusedCatalogIds, searchQuery]);

  if (!open) return null;

  const activeTelemetry = probedTelemetry ?? storageState?.diskTelemetry ?? null;
  const freeBytes = activeTelemetry?.freeBytes ?? 0;
  const totalBytes = activeTelemetry?.totalBytes ?? 0;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent =
    totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

  const handleBrowseStorageRoot = async () => {
    const picked = await pickDirectoryDialog(
      "Choose Etherloom Heavy Media & OS Library Folder (Internal or /Volumes External SSD)",
      storageRootDraft
    );
    if (picked) {
      setStorageRootDraft(picked);
      setStorageEditorOpen(true);
      try {
        const tele = await probeStoragePathTelemetry(picked);
        setProbedTelemetry(tele);
      } catch {
        // Keep current telemetry if directory does not exist yet
      }
    }
  };

  const handleSaveStorageChanges = async () => {
    if (!storageRootDraft.trim()) return;
    setApplyingStorage(true);
    try {
      const res = await onApplyStorageUpdate({
        storageRoot: storageRootDraft.trim(),
        templatesDirOverride: templatesOverride.trim() || null,
        isosDirOverride: isosOverride.trim() || null,
        workspacesDirOverride: workspacesOverride.trim() || null,
        mode: migrationMode,
        deleteSourceAfterVerify,
      });
      setStorageEditorOpen(false);
      await refreshCatalog();
      onNotify(
        "ok",
        `Active OS Library path updated (${res.templatesDiscovered} templates, ${res.isosDiscovered} installers discovered)`
      );
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingStorage(false);
    }
  };

  const handleStartDownload = async (entry: OsCatalogEntryDto) => {
    const customUrl = customMirrorUrl[entry.id]?.trim() || null;
    setProgressById((prev) => ({
      ...prev,
      [entry.id]: {
        catalogId: entry.id,
        stage: "resolving",
        bytesDownloaded: 0,
        totalBytes: entry.estimatedDownloadMb * 1024 * 1024,
        percent: 1,
        message: `Starting download for ${entry.name} into .staging/ …`,
        error: null,
      },
    }));
    try {
      await startCatalogDownload(entry.id, customUrl);
      await refreshCatalog();
    } catch (err: unknown) {
      setProgressById((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancelDownload = async (catalogId: string) => {
    try {
      await cancelCatalogDownload(catalogId);
      setProgressById((prev) => {
        const next = { ...prev };
        delete next[catalogId];
        return next;
      });
      await refreshCatalog();
      onNotify("ok", `Cancelled download and cleaned .staging/ temporary files`);
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleImportLocal = async (entry: OsCatalogEntryDto) => {
    const picked = await pickCatalogDiskOrArchiveDialog(
      storageState?.resolvedIsosDir
    );
    if (!picked) return;
    setBusyCardId(entry.id);
    try {
      const updated = await importCatalogLocalFile(entry.id, picked);
      await onTemplatesChanged();
      await refreshCatalog();
      onNotify(
        "ok",
        updated.availability === "ready"
          ? `Imported ${entry.name} as a Read-Only Golden Template!`
          : `Imported ${entry.name} installer media — ready for 1-Click Guided Setup!`
      );
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyCardId(null);
    }
  };

  const handleLaunchGuidedSetup = async (entry: OsCatalogEntryDto) => {
    setBusyCardId(entry.id);
    try {
      const vm = await launchCatalogGuidedSetup(entry.id);
      onGuidedSetupStarted(entry, vm);
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyCardId(null);
    }
  };

  const handleRequestDelete = async (
    entry: OsCatalogEntryDto,
    force = false
  ) => {
    if (!force && entry.referencingProjects.length > 0) {
      setConfirmDeleteEntry(entry);
      return;
    }
    setBusyCardId(entry.id);
    try {
      const res = await deleteCatalogImage(entry.id, force);
      if (res.blockedByReferences) {
        setConfirmDeleteEntry({
          ...entry,
          referencingProjects: res.referencingProjects,
        });
        return;
      }
      setConfirmDeleteEntry(null);
      await onTemplatesChanged();
      await refreshCatalog();
      onNotify(
        "ok",
        `Deleted ${entry.name} image (${formatByteSize(res.bytesFreed)} freed)`
      );
    } catch (err: unknown) {
      onNotify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyCardId(null);
    }
  };

  const describeArchAccel = (entry: OsCatalogEntryDto) => {
    const isNativeHvf =
      (entry.arch === "aarch64" && hostArch === "aarch64") ||
      (entry.arch === "x86_64" && hostArch === "x86_64");
    if (entry.arch === "aarch64") {
      return {
        text: isNativeHvf ? "ARM64 • HVF Native" : "ARM64 • TCG Multi-Thread",
        native: isNativeHvf,
      };
    }
    if (entry.arch === "x86_64") {
      return {
        text: isNativeHvf
          ? "x86_64 • HVF Native"
          : "x86_64 • TCG Multi-Thread",
        native: isNativeHvf,
      };
    }
    if (entry.arch === "i386") {
      return { text: "i386 • TCG Fast Retro", native: false };
    }
    return { text: "RISC-V 64 • TCG", native: false };
  };

  const categoryAccent = (category: OsCatalogEntryDto["category"]) => {
    switch (category) {
      case "Linux":
        return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";
      case "BSD Family":
        return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
      case "Routers & Firewalls":
        return "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30";
      case "Research, UNIX & Retro":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    }
  };

  const CategoryIcon = ({
    category,
  }: {
    category: OsCatalogEntryDto["category"];
  }) => {
    if (category === "Routers & Firewalls")
      return <Shield className="w-4 h-4" />;
    if (category === "BSD Family") return <Server className="w-4 h-4" />;
    if (category === "Research, UNIX & Retro")
      return <Terminal className="w-4 h-4" />;
    return <Cpu className="w-4 h-4" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-library-title"
    >
      <div
        className="w-full max-w-6xl max-h-[92vh] rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800 bg-gradient-to-r from-sky-500/[0.08] via-indigo-500/[0.05] to-emerald-500/[0.05] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="storage-library-title"
                  className="text-sm font-bold text-slate-900 dark:text-zinc-100"
                >
                  Storage &amp; OS Library Manager
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  {readyCount} / {entries.length || 15} Ready on Disk
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                Download, import, or delete curated ARM64 HVF &amp; x86/Retro OS
                images directly on your internal drive or external SSD (zero{" "}
                <code className="font-mono">/tmp</code> bloat).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              title="Rescan templates/ and isos/ directories"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingEntries ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Storage & OS Library Manager"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top Section: Active Storage Locations & Live Drive Telemetry */}
        <div className="px-5 py-3 border-b border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-950/50 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  Active Heavy Media Storage
                </span>

                {storageState?.status.state === "volumeDisconnected" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35">
                    <AlertTriangle className="w-3 h-3" />
                    <span>
                      External Drive Unplugged (
                      {storageState.status.volumeName})
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>
                      {activeTelemetry?.isExternalVolume
                        ? "External SSD Mounted & Ready"
                        : "Internal Storage Ready"}
                    </span>
                  </span>
                )}

                {activeTelemetry && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 uppercase">
                    {activeTelemetry.filesystemType}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <code className="text-xs font-mono text-slate-800 dark:text-zinc-200 truncate">
                  {storageState?.config.storageRoot ??
                    "~/Library/Application Support/Etherloom/Library"}
                </code>
              </div>
            </div>

            {/* Capacity Meter + Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              {activeTelemetry && totalBytes > 0 && (
                <div className="w-48 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-zinc-300">
                    <span>{formatByteSize(freeBytes)} free</span>
                    <span className="text-slate-400 dark:text-zinc-500">
                      / {formatByteSize(totalBytes)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usedPercent > 90
                          ? "bg-rose-500"
                          : usedPercent > 75
                          ? "bg-amber-500"
                          : "bg-sky-500"
                      }`}
                      style={{ width: `${usedPercent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                {storageState?.status.state === "volumeDisconnected" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void onRetryDetection()}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium"
                    >
                      Retry Drive
                    </button>
                    <button
                      type="button"
                      onClick={() => void onFallbackInternal()}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-200"
                    >
                      Use Internal Disk
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void handleBrowseStorageRoot()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-2xs"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Change…</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const target =
                      storageState?.resolvedTemplatesDir ??
                      storageState?.config.storageRoot;
                    if (target) void revealInFinder(target);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs font-medium text-slate-700 dark:text-zinc-200"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Reveal in Finder</span>
                </button>

                <button
                  type="button"
                  onClick={() => setStorageEditorOpen((v) => !v)}
                  title="Configure folder overrides or migrate existing templates to an external SSD"
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    storageEditorOpen
                      ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300"
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Paths &amp; Migrate</span>
                </button>
              </div>
            </div>
          </div>

          {activeTelemetry?.advisoryTip && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>{activeTelemetry.advisoryTip}</span>
            </div>
          )}

          {/* Expandable Storage Root, Folder Overrides & Live Migration Panel */}
          {storageEditorOpen && (
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-3.5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                    Storage Root Directory (e.g.{" "}
                    <code className="font-mono">
                      /Volumes/ExternalSSD/Etherloom
                    </code>
                    )
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={storageRootDraft}
                      onChange={(e) => setStorageRootDraft(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                    />
                    <button
                      type="button"
                      onClick={() => void handleBrowseStorageRoot()}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-medium"
                    >
                      Browse…
                    </button>
                  </div>
                </label>

                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                    When Changing Storage Location
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMigrationMode("move_existing_data")}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] ${
                        migrationMode === "move_existing_data"
                          ? "border-sky-500 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
                          : "border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400"
                      }`}
                    >
                      Migrate Existing Data
                    </button>
                    <button
                      type="button"
                      onClick={() => setMigrationMode("switch_only")}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] ${
                        migrationMode === "switch_only"
                          ? "border-sky-500 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
                          : "border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400"
                      }`}
                    >
                      Switch Path Only
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setOverridesExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:underline"
                >
                  {overridesExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>
                    Individual Folder Overrides (templates/, isos/, projects/)
                  </span>
                </button>

                {overridesExpanded && (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono text-slate-500">
                        templates/ Override (Optional)
                      </span>
                      <input
                        type="text"
                        value={templatesOverride}
                        onChange={(e) => setTemplatesOverride(e.target.value)}
                        placeholder={`${storageRootDraft}/templates`}
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono text-slate-500">
                        isos/ Override (Optional)
                      </span>
                      <input
                        type="text"
                        value={isosOverride}
                        onChange={(e) => setIsosOverride(e.target.value)}
                        placeholder={`${storageRootDraft}/isos`}
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono text-slate-500">
                        projects/ Override (Optional)
                      </span>
                      <input
                        type="text"
                        value={workspacesOverride}
                        onChange={(e) => setWorkspacesOverride(e.target.value)}
                        placeholder={`${storageRootDraft}/projects`}
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                    </label>
                  </div>
                )}
              </div>

              {migrationProgress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-sky-600 dark:text-sky-400">
                    <span>
                      {migrationProgress.phase}: {migrationProgress.currentFile}
                    </span>
                    <span>{Math.round(migrationProgress.percent)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all"
                      style={{ width: `${migrationProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {migrationMode === "move_existing_data" ? (
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={deleteSourceAfterVerify}
                      onChange={(e) =>
                        setDeleteSourceAfterVerify(e.target.checked)
                      }
                      className="rounded"
                    />
                    <span>
                      Remove old source files after byte-size verification
                    </span>
                  </label>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStorageEditorOpen(false)}
                    className="px-3 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applyingStorage}
                    onClick={() => void handleSaveStorageChanges()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    {applyingStorage && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>Apply Storage Location</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Category / Architecture Filter Bar + Search */}
        <div className="px-5 py-2.5 border-b border-slate-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                { id: "all", label: `All (${entries.length || 15})` },
                { id: "ready", label: `Installed / Ready (${readyCount})` },
                { id: "arm64", label: "Native ARM64 (HVF)" },
                { id: "x86", label: "x86_64 / i386 (TCG)" },
                { id: "Linux", label: "Linux" },
                { id: "BSD Family", label: "BSD" },
                { id: "Routers & Firewalls", label: "Routers & Firewalls" },
                { id: "Research, UNIX & Retro", label: "UNIX & Retro" },
              ] as const
            ).map((tab) => {
              const active = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? "bg-sky-600 border-sky-600 text-white shadow-2xs"
                      : "bg-slate-100/80 hover:bg-slate-200/70 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 border-slate-200/80 dark:border-zinc-700/70 text-slate-600 dark:text-zinc-300"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 15 OSes, NICs, protocols…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
        </div>

        {/* Academy Lab Prerequisite Filter Banner (when deep-linked from AcademyModal) */}
        {focusedCatalogIds && focusedCatalogIds.length > 0 && (
          <div className="mx-5 mt-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-900 dark:text-indigo-200">
              <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>
                Filtered to required OS image(s) for{" "}
                <strong>{focusedLabTitle ?? "Selected Academy Lab"}</strong> (
                <code className="font-mono">{focusedCatalogIds.join(", ")}</code>
                ).
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onReturnToAcademy && (
                <button
                  type="button"
                  onClick={onReturnToAcademy}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                >
                  Back to Academy
                </button>
              )}
              {onClearFocusedCatalogIds && (
                <button
                  type="button"
                  onClick={onClearFocusedCatalogIds}
                  className="px-2.5 py-1 rounded-lg border border-indigo-500/35 text-xs font-medium text-indigo-700 dark:text-indigo-200 hover:bg-indigo-500/15 transition-colors"
                >
                  Show All 15 OSes
                </button>
              )}
            </div>
          </div>
        )}

        {/* Confirm Delete Modal Overlay when saved `.etherloom` projects reference an image */}
        {confirmDeleteEntry && (
          <div className="mx-5 mt-3 rounded-xl bg-rose-500/10 border border-rose-500/35 p-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="space-y-1 max-w-3xl">
              <div className="text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {confirmDeleteEntry.name} is referenced by{" "}
                  {confirmDeleteEntry.referencingProjects.length} saved project
                  overlay(s):
                </span>
              </div>
              <p className="text-[11px] font-mono text-rose-800/90 dark:text-rose-200/90">
                {confirmDeleteEntry.referencingProjects.join(", ")}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400">
                Deleting a Read-Only Golden Template will prevent Copy-on-Write
                overlays in those projects from booting until re-downloaded.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteEntry(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700"
              >
                Keep Image
              </button>
              <button
                type="button"
                onClick={() => void handleRequestDelete(confirmDeleteEntry, true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
              >
                Delete Anyway
              </button>
            </div>
          </div>
        )}

        {/* Scrollable 15-OS Catalog Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredEntries.map((entry) => {
              const prog = progressById[entry.id];
              const isDownloading =
                entry.availability === "downloading" ||
                (prog &&
                  prog.stage !== "ready" &&
                  prog.stage !== "error" &&
                  prog.stage !== "cancelled");
              const isReady = entry.availability === "ready";
              const isInstallerReady = entry.availability === "installer_ready";
              const isBusy = busyCardId === entry.id;
              const archInfo = describeArchAccel(entry);
              const tipsOpen = Boolean(expandedTips[entry.id]);
              const mirrorOpen = Boolean(mirrorInputOpen[entry.id]);

              return (
                <div
                  key={entry.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                    isReady
                      ? "bg-emerald-500/[0.03] dark:bg-emerald-500/[0.04] border-emerald-500/35"
                      : isInstallerReady
                      ? "bg-amber-500/[0.03] dark:bg-amber-500/[0.04] border-amber-500/35"
                      : "bg-slate-50/60 dark:bg-zinc-950/60 border-slate-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${categoryAccent(
                            entry.category
                          )}`}
                        >
                          <CategoryIcon category={entry.category} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                              {entry.name}
                            </h3>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400">
                              {entry.version}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                archInfo.native
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"
                                  : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25"
                              }`}
                            >
                              {archInfo.text}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                              {entry.category}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Availability Pill */}
                      {isReady ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>
                            Ready
                            {entry.templateSizeBytes
                              ? ` • ${formatByteSize(entry.templateSizeBytes)}`
                              : ""}
                          </span>
                        </span>
                      ) : isInstallerReady ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          <Sparkles className="w-3 h-3" />
                          <span>Installer Ready</span>
                        </span>
                      ) : isDownloading ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>{prog?.stage ?? "Downloading"}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
                          ~{entry.estimatedDownloadMb} MB
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
                      {entry.summary}
                    </p>

                    {/* Hardware & Credentials Spec Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                      <div className="px-2 py-1 rounded bg-white/80 dark:bg-zinc-900/80 border border-slate-200/70 dark:border-zinc-800 truncate">
                        <span className="text-slate-400 dark:text-zinc-500">
                          NIC:{" "}
                        </span>
                        <code className="font-mono text-slate-800 dark:text-zinc-200">
                          {entry.nicNamingHint}
                        </code>
                      </div>
                      <div className="px-2 py-1 rounded bg-white/80 dark:bg-zinc-900/80 border border-slate-200/70 dark:border-zinc-800 truncate">
                        <span className="text-slate-400 dark:text-zinc-500">
                          HW:{" "}
                        </span>
                        <code className="font-mono text-slate-800 dark:text-zinc-200">
                          {entry.defaultCpus}c • {entry.defaultRamMb}M •{" "}
                          {entry.firmware.toUpperCase()}
                        </code>
                      </div>
                      <div className="col-span-2 sm:col-span-1 px-2 py-1 rounded bg-white/80 dark:bg-zinc-900/80 border border-slate-200/70 dark:border-zinc-800 truncate">
                        <span className="text-slate-400 dark:text-zinc-500">
                          Login:{" "}
                        </span>
                        <span
                          title={entry.defaultCredentials}
                          className="font-mono text-slate-800 dark:text-zinc-200"
                        >
                          {entry.defaultCredentials}
                        </span>
                      </div>
                    </div>

                    {/* Expandable Particularities & Lab Tips */}
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTips((prev) => ({
                            ...prev,
                            [entry.id]: !prev[entry.id],
                          }))
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        {tipsOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        <span>
                          Particularities &amp; Lab Tips (
                          {entry.quirksAndTips.length})
                        </span>
                      </button>

                      {tipsOpen && (
                        <div className="mt-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 p-2.5 space-y-1.5 text-[11px] text-slate-600 dark:text-zinc-300">
                          <ul className="list-disc pl-4 space-y-1">
                            {entry.quirksAndTips.map((tip, idx) => (
                              <li key={idx} className="leading-snug">
                                {tip}
                              </li>
                            ))}
                          </ul>
                          <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400 dark:text-zinc-500 border-t border-slate-100 dark:border-zinc-800">
                            <span>
                              Driver: <code>{entry.nicModel}</code> • Disk:{" "}
                              <code>{entry.diskBus}</code>
                            </span>
                            <span className="font-mono truncate max-w-[230px]">
                              {entry.officialSiteUrl}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Live Download Progress Bar */}
                  {isDownloading && prog && (
                    <div className="rounded-lg bg-sky-500/10 border border-sky-500/25 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-sky-800 dark:text-sky-200 font-medium truncate">
                          {prog.message}
                        </span>
                        <span className="font-mono text-sky-700 dark:text-sky-300 shrink-0">
                          {formatByteSize(prog.bytesDownloaded)}
                          {prog.totalBytes
                            ? ` / ${formatByteSize(prog.totalBytes)}`
                            : ""}{" "}
                          ({Math.round(prog.percent)}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-sky-950/15 dark:bg-sky-200/15 overflow-hidden">
                        <div
                          className="h-full bg-sky-500 transition-all duration-200"
                          style={{
                            width: `${Math.max(2, Math.min(100, prog.percent))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Optional Custom Mirror URL Input */}
                  {mirrorOpen && !isDownloading && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="url"
                        value={customMirrorUrl[entry.id] ?? entry.downloadUrl ?? ""}
                        onChange={(e) =>
                          setCustomMirrorUrl((prev) => ({
                            ...prev,
                            [entry.id]: e.target.value,
                          }))
                        }
                        placeholder="https://mirror.example.org/os-image.qcow2.xz"
                        className="flex-1 px-2.5 py-1 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      />
                      <button
                        type="button"
                        onClick={() => void handleStartDownload(entry)}
                        className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                      >
                        Fetch URL
                      </button>
                    </div>
                  )}

                  {/* Card Footer Action Bar */}
                  <div className="pt-2 border-t border-slate-200/70 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
                    {isDownloading ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelDownload(entry.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel Download</span>
                      </button>
                    ) : isReady ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onAddCatalogOsNode(entry);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Node to Canvas</span>
                        </button>

                        <div className="flex items-center gap-1">
                          {entry.templatePath && (
                            <button
                              type="button"
                              onClick={() =>
                                void revealInFinder(entry.templatePath!)
                              }
                              title="Reveal Golden Template in Finder"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {entry.downloadUrl && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleStartDownload(entry)}
                              title="Re-download fresh upstream image"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleRequestDelete(entry, false)}
                            title="Delete Golden Template from disk"
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-medium"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </>
                    ) : isInstallerReady ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleLaunchGuidedSetup(entry)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow-2xs"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                          <span>Launch 1-Click Guided Setup</span>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleImportLocal(entry)}
                            title="Import pre-built .qcow2 or alternate ISO"
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs text-slate-700 dark:text-zinc-200"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>Import Disk</span>
                          </button>
                          {entry.installerPath && (
                            <button
                              type="button"
                              onClick={() =>
                                void revealInFinder(entry.installerPath!)
                              }
                              title="Reveal installer in Finder"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleRequestDelete(entry, false)}
                            title="Delete downloaded installer"
                            className="p-1.5 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {entry.deliveryKind !== "local_import_only" &&
                          entry.downloadUrl ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleStartDownload(entry)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold shadow-2xs"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>
                                {entry.deliveryKind === "guided_installer"
                                  ? "Download Installer"
                                  : "Download & Prepare"}
                              </span>
                            </button>
                          ) : null}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleImportLocal(entry)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
                              entry.deliveryKind === "local_import_only"
                                ? "bg-sky-600 hover:bg-sky-500 border-sky-600 text-white font-semibold"
                                : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200"
                            }`}
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Upload className="w-3.5 h-3.5" />
                            )}
                            <span>Import Local File…</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setMirrorInputOpen((prev) => ({
                              ...prev,
                              [entry.id]: !prev[entry.id],
                            }))
                          }
                          className="text-[11px] text-slate-500 hover:text-sky-600 dark:text-zinc-400 dark:hover:text-sky-400"
                        >
                          {mirrorOpen ? "Hide URL" : "Custom URL…"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/90 dark:bg-zinc-950/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-zinc-400 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>
              All Golden Templates are marked Read-Only (<code className="font-mono">0444</code>) — topology nodes boot instant Copy-on-Write{" "}
              <code className="font-mono">.qcow2</code> overlays taking only a few MB.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1 rounded-lg bg-slate-200/80 hover:bg-slate-300/70 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-100 font-medium text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
