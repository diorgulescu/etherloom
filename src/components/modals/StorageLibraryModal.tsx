import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  EnvDoctorReport,
  OsCatalogEntryDto,
  StorageMigrationMode,
  StorageMigrationProgress,
  StorageMigrationResult,
  StorageStateSnapshot,
  UpdateStorageRequest,
  VmInstanceInfo,
} from "../../types/studio";
import { formatByteSize } from "../../utils/topology";
import { EtherloomBackdropOrnament, EtherloomMark } from "../brand";

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
  envReport?: EnvDoctorReport | null;
  onOpenEnvDoctor?: () => void;
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

function formatProgressStageBadge(stage?: string): string {
  switch ((stage ?? "").toLowerCase()) {
    case "resolving":
      return "Resolving Mirror…";
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying SHA-256";
    case "extracting":
      return "Extracting Archive";
    case "converting qcow2":
      return "Preparing qcow2";
    default:
      return stage || "Downloading";
  }
}

export function StorageLibraryModal({
  open,
  hostArch = "aarch64",
  envReport = null,
  onOpenEnvDoctor,
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

  // Keep latest parent callbacks in refs so catalog loading & Tauri event listeners
  // never re-trigger in a loop when parent telemetry re-renders App.
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const onTemplatesChangedRef = useRef(onTemplatesChanged);
  onTemplatesChangedRef.current = onTemplatesChanged;

  const focusedKey = useMemo(
    () =>
      focusedCatalogIds && focusedCatalogIds.length > 0
        ? focusedCatalogIds.join("|")
        : "",
    [focusedCatalogIds]
  );

  const refreshCatalog = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const list = await listCatalogEntries();
      setEntries(list);
    } catch (err: unknown) {
      onNotifyRef.current(
        "error",
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (focusedKey) {
      setFilterTab("all");
      setSearchQuery("");
    }
    void refreshCatalog();
  }, [focusedKey, open, refreshCatalog, storageState?.resolvedTemplatesDir]);

  // Sync storage drafts from active `storageState`
  useEffect(() => {
    if (!storageState) return;
    setStorageRootDraft(storageState.config.storageRoot);
    setTemplatesOverride(storageState.config.templatesDirOverride ?? "");
    setIsosOverride(storageState.config.isosDirOverride ?? "");
    setWorkspacesOverride(storageState.config.workspacesDirOverride ?? "");
    setProbedTelemetry(storageState.diskTelemetry);
  }, [storageState]);

  // Subscribe once to `"catalog://download-progress"` events (StrictMode & async-cleanup safe)
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onCatalogDownloadProgress((ev) => {
      if (disposed) return;
      setProgressById((prev) => ({ ...prev, [ev.catalogId]: ev }));
      if (
        ev.stage === "ready" ||
        ev.stage === "error" ||
        ev.stage === "cancelled"
      ) {
        if (ev.stage === "ready") {
          onNotifyRef.current("ok", ev.message);
          void onTemplatesChangedRef.current();
        } else if (ev.stage === "error" && ev.error) {
          onNotifyRef.current("error", `${ev.catalogId}: ${ev.error}`);
        }
        void refreshCatalog();
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshCatalog]);

  const safeEntries = useMemo(
    () =>
      Array.isArray(entries)
        ? entries.filter(
            (e): e is OsCatalogEntryDto =>
              Boolean(
                e &&
                  typeof e === "object" &&
                  typeof e.id === "string" &&
                  typeof e.name === "string"
              )
          )
        : [],
    [entries]
  );

  const readyCount = useMemo(
    () =>
      safeEntries.filter(
        (e) =>
          e.availability === "ready" || e.availability === "installer_ready"
      ).length,
    [safeEntries]
  );

  const filteredEntries = useMemo(() => {
    if (!open) return [];
    const q = searchQuery.trim().toLowerCase();
    const focusSet =
      focusedCatalogIds && focusedCatalogIds.length > 0
        ? new Set(focusedCatalogIds.map((id) => String(id).toLowerCase()))
        : null;

    return safeEntries.filter((entry) => {
      if (focusSet) {
        if (
          !focusSet.has((entry.id ?? "").toLowerCase()) &&
          !focusSet.has((entry.osProfileId ?? "").toLowerCase())
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
        (entry.name ?? "").toLowerCase().includes(q) ||
        (entry.version ?? "").toLowerCase().includes(q) ||
        (entry.category ?? "").toLowerCase().includes(q) ||
        (entry.summary ?? "").toLowerCase().includes(q) ||
        (entry.nicNamingHint ?? "").toLowerCase().includes(q) ||
        (entry.arch ?? "").toLowerCase().includes(q)
      );
    });
  }, [filterTab, focusedCatalogIds, open, safeEntries, searchQuery]);

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
      const msg = err instanceof Error ? err.message : String(err);
      setProgressById((prev) => ({
        ...prev,
        [entry.id]: {
          catalogId: entry.id,
          stage: "error",
          bytesDownloaded: 0,
          totalBytes: null,
          percent: 0,
          message: msg,
          error: msg,
        },
      }));
      onNotify("error", msg);
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
      case "BSD Family":
        return "bg-[#F59E0B]/15 text-amber-700 dark:text-[#F59E0B] border-[#F59E0B]/35";
      case "Routers & Firewalls":
        return "bg-[#6366F1]/15 text-indigo-700 dark:text-[#818CF8] border-[#6366F1]/35";
      case "Research, UNIX & Retro":
        return "bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399] border-[#10B981]/35";
      case "Linux":
      default:
        return "bg-[#22D3EE]/15 text-cyan-700 dark:text-[#22D3EE] border-[#22D3EE]/35";
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
      className="fixed inset-0 z-50 bg-slate-950/70 dark:bg-[#050912]/85 flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-library-title"
    >
      <div
        className="w-full max-w-6xl max-h-[92vh] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header with Woven Circuit Ornament */}
        <div className="relative px-5 py-3.5 border-b border-slate-200 dark:border-[rgba(34,211,238,0.16)] bg-gradient-to-r from-cyan-500/[0.08] via-indigo-500/[0.05] to-emerald-500/[0.05] dark:from-[#0D1321] dark:via-[#111827] dark:to-[#0D1321] flex items-center justify-between gap-4 shrink-0 overflow-hidden">
          <EtherloomBackdropOrnament
            rasterVariant="none"
            opacityClassName="opacity-20"
            className="hidden dark:block absolute inset-0"
          />
          <div className="relative z-10 flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-[#090E18] border border-[#22D3EE]/35 text-[#22D3EE] flex items-center justify-center shadow-sm shrink-0">
              <EtherloomMark size={28} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <HardDrive className="w-4 h-4 text-[#22D3EE] shrink-0" />
                <h2
                  id="storage-library-title"
                  className="text-sm font-bold text-slate-900 dark:text-slate-100"
                >
                  Storage &amp; OS Library Manager
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399] border border-[#10B981]/30">
                  {readyCount} / {entries.length || 15} Ready on Disk
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Download, import, or delete curated ARM64 HVF &amp; x86/Retro OS
                images directly on your internal drive or external SSD (zero{" "}
                <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                  /tmp
                </code>{" "}
                bloat).
              </p>
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              title="Rescan templates/ and isos/ directories"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-[#1E2B42]"
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingEntries ? "animate-spin text-[#22D3EE]" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Storage & OS Library Manager"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-[#1E2B42]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top Section: Active Storage Locations & Live Drive Telemetry */}
        <div className="px-5 py-3 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/80 dark:bg-[#0D1321]/85 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Active Heavy Media Storage
                </span>

                {storageState?.status.state === "volumeDisconnected" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F59E0B]/15 text-amber-700 dark:text-amber-300 border border-[#F59E0B]/35">
                    <AlertTriangle className="w-3 h-3" />
                    <span>
                      External Drive Unplugged (
                      {storageState.status.volumeName})
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399] border border-[#10B981]/30">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>
                      {activeTelemetry?.isExternalVolume
                        ? "External SSD Mounted & Ready"
                        : "Internal Storage Ready"}
                    </span>
                  </span>
                )}

                {activeTelemetry && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200/80 dark:bg-[#090E18] dark:border dark:border-[rgba(34,211,238,0.16)] text-slate-700 dark:text-[#22D3EE] uppercase">
                    {activeTelemetry.filesystemType}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <code className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">
                  {storageState?.config.storageRoot ??
                    "~/Library/Application Support/Etherloom/Library"}
                </code>
              </div>
            </div>

            {/* Capacity Meter + Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              {activeTelemetry && totalBytes > 0 && (
                <div className="w-48 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-300">
                    <span>{formatByteSize(freeBytes)} free</span>
                    <span className="text-slate-400 dark:text-slate-500">
                      / {formatByteSize(totalBytes)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#090E18] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usedPercent > 90
                          ? "bg-[#F43F5E]"
                          : usedPercent > 75
                          ? "bg-[#F59E0B]"
                          : "bg-gradient-to-r from-[#22D3EE] to-[#10B981]"
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
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-[rgba(34,211,238,0.20)] text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      Use Internal Disk
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void handleBrowseStorageRoot()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] text-xs font-semibold shadow-2xs transition-colors"
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
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.18)] bg-white dark:bg-[#162032] hover:bg-slate-100 dark:hover:bg-[#1E2B42] text-xs font-medium text-slate-700 dark:text-slate-200"
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
                      ? "border-[#22D3EE] bg-[#22D3EE]/12 text-cyan-700 dark:text-[#22D3EE]"
                      : "border-slate-200 dark:border-[rgba(34,211,238,0.18)] bg-white dark:bg-[#162032] text-slate-600 dark:text-slate-300 dark:hover:bg-[#1E2B42]"
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Paths &amp; Migrate</span>
                </button>
              </div>
            </div>
          </div>

          {activeTelemetry?.advisoryTip && (
            <div className="rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/25 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>{activeTelemetry.advisoryTip}</span>
            </div>
          )}

          {/* Expandable Storage Root, Folder Overrides & Live Migration Panel */}
          {storageEditorOpen && (
            <div className="rounded-xl bg-white dark:bg-[#162032] border border-slate-200 dark:border-[rgba(34,211,238,0.20)] p-3.5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    Storage Root Directory (e.g.{" "}
                    <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                      /Volumes/ExternalSSD/Etherloom
                    </code>
                    )
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={storageRootDraft}
                      onChange={(e) => setStorageRootDraft(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => void handleBrowseStorageRoot()}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-[#0D1321] dark:hover:bg-[#1E2B42] dark:border dark:border-[rgba(34,211,238,0.18)] text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      Browse…
                    </button>
                  </div>
                </label>

                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    When Changing Storage Location
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMigrationMode("move_existing_data")}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] ${
                        migrationMode === "move_existing_data"
                          ? "border-[#22D3EE] bg-[#22D3EE]/12 font-semibold text-cyan-700 dark:text-[#22D3EE]"
                          : "border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Migrate Existing Data
                    </button>
                    <button
                      type="button"
                      onClick={() => setMigrationMode("switch_only")}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] ${
                        migrationMode === "switch_only"
                          ? "border-[#22D3EE] bg-[#22D3EE]/12 font-semibold text-cyan-700 dark:text-[#22D3EE]"
                          : "border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-600 dark:text-slate-400"
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
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-600 dark:text-[#22D3EE] hover:underline"
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
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        templates/ Override (Optional)
                      </span>
                      <input
                        type="text"
                        value={templatesOverride}
                        onChange={(e) => setTemplatesOverride(e.target.value)}
                        placeholder={`${storageRootDraft}/templates`}
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        isos/ Override (Optional)
                      </span>
                      <input
                        type="text"
                        value={isosOverride}
                        onChange={(e) => setIsosOverride(e.target.value)}
                        placeholder={`${storageRootDraft}/isos`}
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        projects/ Override (Optional)
                      </span>
                      <input
                        type="text"
                        value={workspacesOverride}
                        onChange={(e) => setWorkspacesOverride(e.target.value)}
                        placeholder={`${storageRootDraft}/projects`}
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100"
                      />
                    </label>
                  </div>
                )}
              </div>

              {migrationProgress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-cyan-600 dark:text-[#22D3EE]">
                    <span>
                      {migrationProgress.phase}: {migrationProgress.currentFile}
                    </span>
                    <span>{Math.round(migrationProgress.percent)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#090E18] overflow-hidden">
                    <div
                      className="h-full bg-[#22D3EE] transition-all"
                      style={{ width: `${migrationProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {migrationMode === "move_existing_data" ? (
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={deleteSourceAfterVerify}
                      onChange={(e) =>
                        setDeleteSourceAfterVerify(e.target.checked)
                      }
                      className="rounded accent-cyan-500"
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
                    className="px-3 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#1E2B42]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applyingStorage}
                    onClick={() => void handleSaveStorageChanges()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] disabled:opacity-50 text-[#090E18] text-xs font-semibold"
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
        <div className="px-5 py-2.5 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
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
                      ? "bg-[#06B6D4] border-[#22D3EE] text-[#090E18] font-semibold shadow-2xs"
                      : "bg-slate-100/80 hover:bg-slate-200/70 dark:bg-[#162032] dark:hover:bg-[#1E2B42] border-slate-200/80 dark:border-[rgba(34,211,238,0.16)] text-slate-600 dark:text-slate-300"
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
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#22D3EE]/35"
            />
          </div>
        </div>

        {/* Missing QEMU Host Dependency Callout */}
        {envReport &&
          (!envReport.qemuImg.found || !envReport.qemuSystemAarch64.found) && (
            <div className="mx-5 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/35 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 max-w-3xl">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  <strong>QEMU is not installed on this Mac yet.</strong> Native{" "}
                  <code className="font-mono">.qcow2</code> images (like Alpine,
                  Debian &amp; FreeBSD) can still download right now, while
                  converting raw disk archives and booting VMs requires{" "}
                  <code className="font-mono text-amber-700 dark:text-amber-300">
                    brew install qemu
                  </code>
                  .
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText("brew install qemu");
                    onNotify("ok", "Copied `brew install qemu` to clipboard");
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#090E18] text-xs font-semibold transition-colors"
                >
                  Copy brew install qemu
                </button>
                {onOpenEnvDoctor && (
                  <button
                    type="button"
                    onClick={onOpenEnvDoctor}
                    className="px-2.5 py-1 rounded-lg border border-amber-500/40 text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/15 transition-colors"
                  >
                    Env Doctor
                  </button>
                )}
              </div>
            </div>
          )}

        {/* Academy Lab Prerequisite Filter Banner (when deep-linked from AcademyModal) */}
        {focusedCatalogIds && focusedCatalogIds.length > 0 && (
          <div className="mx-5 mt-3 rounded-xl bg-[#6366F1]/10 border border-[#6366F1]/35 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-900 dark:text-indigo-200">
              <Sparkles className="w-4 h-4 text-[#818CF8] shrink-0" />
              <span>
                Filtered to required OS image(s) for{" "}
                <strong>{focusedLabTitle ?? "Selected Academy Lab"}</strong> (
                <code className="font-mono text-[#22D3EE]">
                  {focusedCatalogIds.join(", ")}
                </code>
                ).
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onReturnToAcademy && (
                <button
                  type="button"
                  onClick={onReturnToAcademy}
                  className="px-2.5 py-1 rounded-lg bg-[#6366F1] hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                >
                  Back to Academy
                </button>
              )}
              {onClearFocusedCatalogIds && (
                <button
                  type="button"
                  onClick={onClearFocusedCatalogIds}
                  className="px-2.5 py-1 rounded-lg border border-[#6366F1]/35 text-xs font-medium text-indigo-700 dark:text-indigo-200 hover:bg-[#6366F1]/15 transition-colors"
                >
                  Show All 15 OSes
                </button>
              )}
            </div>
          </div>
        )}

        {/* Confirm Delete Modal Overlay when saved `.etherloom` projects reference an image */}
        {confirmDeleteEntry && (
          <div className="mx-5 mt-3 rounded-xl bg-[#F43F5E]/10 border border-[#F43F5E]/35 p-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
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
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Deleting a Read-Only Golden Template will prevent Copy-on-Write
                overlays in those projects from booting until re-downloaded.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteEntry(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-[#162032] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-700 dark:text-slate-200"
              >
                Keep Image
              </button>
              <button
                type="button"
                onClick={() => void handleRequestDelete(confirmDeleteEntry, true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F43F5E] hover:bg-rose-500 text-white"
              >
                Delete Anyway
              </button>
            </div>
          </div>
        )}

        {/* Scrollable 15-OS Catalog Grid (Opaque GPU-composited surface for macOS WKWebView stability) */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 bg-slate-50 dark:bg-[#0D1321]"
          aria-busy={loadingEntries}
        >
          {loadingEntries && entries.length === 0 ? (
            <div className="min-h-[320px] flex flex-col items-center justify-center py-10 space-y-6">
              <div className="rounded-2xl bg-white dark:bg-[#162032] border border-slate-200 dark:border-[rgba(34,211,238,0.24)] px-6 py-5 shadow-sm flex flex-col items-center text-center max-w-md space-y-2.5">
                <div className="w-11 h-11 rounded-xl bg-[#22D3EE]/15 border border-[#22D3EE]/35 flex items-center justify-center text-cyan-600 dark:text-[#22D3EE]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Please wait, loading OS Library…
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Scanning <code className="font-mono text-[#22D3EE]">templates/</code>{" "}
                  and <code className="font-mono text-[#22D3EE]">isos/</code>{" "}
                  on active storage and preparing the 15 curated OS catalog
                  cards.
                </p>
              </div>

              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 opacity-55 pointer-events-none select-none">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-200/80 dark:border-[rgba(34,211,238,0.12)] bg-white dark:bg-[#162032] p-4 space-y-3 animate-pulse"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-[#1E2B42]" />
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3.5 w-36 rounded bg-slate-200 dark:bg-[#1E2B42]" />
                        <div className="h-2.5 w-24 rounded bg-slate-100 dark:bg-[#090E18]" />
                      </div>
                    </div>
                    <div className="h-3 w-full rounded bg-slate-100 dark:bg-[#090E18]" />
                    <div className="h-3 w-4/5 rounded bg-slate-100 dark:bg-[#090E18]" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {loadingEntries && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-xl bg-[#22D3EE]/10 dark:bg-[#162032] border border-[#22D3EE]/35 px-3.5 py-2 flex items-center gap-2.5 text-xs text-cyan-800 dark:text-[#22D3EE]"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="font-medium">
                    Please wait, refreshing OS Library &amp; checking disk
                    templates…
                  </span>
                </div>
              )}

              {!loadingEntries &&
              filteredEntries.length === 0 &&
              entries.length > 0 ? (
                <div className="min-h-[220px] rounded-xl border border-dashed border-slate-300 dark:border-[rgba(34,211,238,0.2)] bg-white/70 dark:bg-[#162032]/60 p-8 flex flex-col items-center justify-center text-center space-y-2.5">
                  <Info className="w-5 h-5 text-slate-400 dark:text-[#22D3EE]" />
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    No operating systems match the current filter
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterTab("all");
                      setSearchQuery("");
                      onClearFocusedCatalogIds?.();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] text-xs font-semibold transition-colors"
                  >
                    Show All OSes
                  </button>
                </div>
              ) : (
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
              const tips = entry.quirksAndTips ?? [];

              return (
                <div
                  key={entry.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-colors ${
                    isReady
                      ? "bg-white dark:bg-[#162032] dark:hover:bg-[#1E2B42] border-[#10B981]/35 dark:border-[#10B981]/40"
                      : isInstallerReady
                      ? "bg-white dark:bg-[#162032] dark:hover:bg-[#1E2B42] border-[#F59E0B]/35"
                      : "bg-white dark:bg-[#162032] dark:hover:bg-[#1E2B42] border-slate-200 dark:border-[rgba(34,211,238,0.16)] dark:hover:border-[rgba(34,211,238,0.38)]"
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
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {entry.name}
                            </h3>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {entry.version}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                archInfo.native
                                  ? "bg-[#10B981]/12 text-emerald-700 dark:text-[#34D399] border-[#10B981]/30"
                                  : "bg-[#6366F1]/12 text-indigo-700 dark:text-[#818CF8] border-[#6366F1]/30"
                              }`}
                            >
                              {archInfo.text}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-[#090E18] dark:border dark:border-slate-700/70 text-slate-600 dark:text-slate-300">
                              {entry.category}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Availability Pill */}
                      {isReady ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399] border border-[#10B981]/35">
                          <CheckCircle2 className="w-3 h-3" />
                          <span className="font-mono">
                            Ready
                            {entry.templateSizeBytes
                              ? ` • ${formatByteSize(entry.templateSizeBytes)}`
                              : ""}
                          </span>
                        </span>
                      ) : isInstallerReady ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F59E0B]/15 text-amber-700 dark:text-amber-300 border border-[#F59E0B]/35">
                          <Sparkles className="w-3 h-3" />
                          <span>Installer Ready</span>
                        </span>
                      ) : isDownloading ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#22D3EE]/15 text-cyan-700 dark:text-[#22D3EE] border border-[#22D3EE]/35">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>{formatProgressStageBadge(prog?.stage)}</span>
                        </span>
                      ) : prog?.stage === "error" ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F43F5E]/15 text-rose-700 dark:text-rose-300 border border-[#F43F5E]/40">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Failed</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-[#090E18] dark:border dark:border-[rgba(34,211,238,0.14)] text-slate-500 dark:text-slate-400">
                          ~{entry.estimatedDownloadMb} MB
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {entry.summary}
                    </p>

                    {/* Hardware & Credentials Spec Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                      <div className="px-2 py-1 rounded bg-white/80 dark:bg-[#090E18] border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] truncate">
                        <span className="text-slate-400 dark:text-slate-500">
                          NIC:{" "}
                        </span>
                        <code className="font-mono text-slate-800 dark:text-[#22D3EE]">
                          {entry.nicNamingHint}
                        </code>
                      </div>
                      <div className="px-2 py-1 rounded bg-white/80 dark:bg-[#090E18] border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] truncate">
                        <span className="text-slate-400 dark:text-slate-500">
                          HW:{" "}
                        </span>
                        <code className="font-mono text-slate-800 dark:text-slate-200">
                          {entry.defaultCpus}c • {entry.defaultRamMb}M •{" "}
                          {String(entry.firmware ?? "uefi").toUpperCase()}
                        </code>
                      </div>
                      <div className="col-span-2 sm:col-span-1 px-2 py-1 rounded bg-white/80 dark:bg-[#090E18] border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] truncate">
                        <span className="text-slate-400 dark:text-slate-500">
                          Login:{" "}
                        </span>
                        <span
                          title={entry.defaultCredentials}
                          className="font-mono text-slate-800 dark:text-slate-200"
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
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-600 dark:text-[#22D3EE] hover:underline"
                      >
                        {tipsOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        <span>
                          Particularities &amp; Lab Tips (
                          {tips.length})
                        </span>
                      </button>

                      {tipsOpen && (
                        <div className="mt-2 rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200/80 dark:border-[rgba(34,211,238,0.16)] p-2.5 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                          <ul className="list-disc pl-4 space-y-1">
                            {tips.map((tip, idx) => (
                              <li key={idx} className="leading-snug">
                                {tip}
                              </li>
                            ))}
                          </ul>
                          <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
                            <span>
                              Driver:{" "}
                              <code className="font-mono text-[#22D3EE]">
                                {entry.nicModel}
                              </code>{" "}
                              • Disk:{" "}
                              <code className="font-mono text-[#34D399]">
                                {entry.diskBus}
                              </code>
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
                    <div className="rounded-lg bg-[#22D3EE]/10 border border-[#22D3EE]/30 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-cyan-800 dark:text-[#22D3EE] font-medium truncate">
                          {prog.message}
                        </span>
                        <span className="font-mono text-cyan-700 dark:text-cyan-300 shrink-0">
                          {prog.stage === "resolving" && prog.bytesDownloaded === 0 ? (
                            "Connecting…"
                          ) : prog.bytesDownloaded > 0 ? (
                            <>
                              {formatByteSize(prog.bytesDownloaded)}
                              {prog.totalBytes
                                ? ` / ${formatByteSize(prog.totalBytes)}`
                                : ""}
                              {prog.percent > 0
                                ? ` (${Math.round(prog.percent)}%)`
                                : ""}
                            </>
                          ) : prog.percent > 0 ? (
                            `${Math.round(prog.percent)}%`
                          ) : (
                            "Preparing…"
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-cyan-950/20 dark:bg-[#090E18] overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r from-[#22D3EE] to-[#10B981] transition-all duration-200 ${
                            prog.stage === "resolving" ? "animate-pulse" : ""
                          }`}
                          style={{
                            width:
                              prog.stage === "resolving"
                                ? "18%"
                                : `${Math.max(4, Math.min(100, prog.percent || 8))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Inline Download / Conversion Error Banner */}
                  {!isDownloading && prog?.stage === "error" && (
                    <div className="rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/35 p-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-[#F43F5E] shrink-0 mt-0.5" />
                          <span className="leading-snug break-words">
                            {prog.error || prog.message || "Download failed."}
                          </span>
                        </div>
                        <button
                          type="button"
                          title="Dismiss error"
                          onClick={() =>
                            setProgressById((prev) => {
                              const next = { ...prev };
                              delete next[entry.id];
                              return next;
                            })
                          }
                          className="p-0.5 rounded text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pl-6">
                        <button
                          type="button"
                          onClick={() => void handleStartDownload(entry)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F43F5E] hover:bg-rose-500 text-white text-[11px] font-semibold"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMirrorInputOpen((prev) => ({
                              ...prev,
                              [entry.id]: true,
                            }))
                          }
                          className="px-2.5 py-1 rounded-md border border-[#F43F5E]/35 text-rose-700 dark:text-rose-200 hover:bg-[#F43F5E]/15 text-[11px] font-medium"
                        >
                          Custom Mirror URL
                        </button>
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
                        className="flex-1 px-2.5 py-1 text-xs font-mono rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => void handleStartDownload(entry)}
                        className="px-2.5 py-1 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] text-xs font-semibold"
                      >
                        Fetch URL
                      </button>
                    </div>
                  )}

                  {/* Card Footer Action Bar */}
                  <div className="pt-2 border-t border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] flex flex-wrap items-center justify-between gap-2">
                    {isDownloading ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelDownload(entry.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F43F5E] hover:bg-rose-500 text-white text-xs font-semibold"
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10B981] hover:bg-emerald-400 text-[#090E18] text-xs font-semibold shadow-2xs transition-colors"
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
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.18)] hover:bg-slate-100 dark:hover:bg-[#0D1321] text-slate-600 dark:text-slate-300"
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
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.18)] hover:bg-slate-100 dark:hover:bg-[#0D1321] text-slate-600 dark:text-slate-300"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleRequestDelete(entry, false)}
                            title="Delete Golden Template from disk"
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[#F43F5E]/30 text-rose-600 dark:text-rose-400 hover:bg-[#F43F5E]/10 text-xs font-medium"
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
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.18)] hover:bg-slate-100 dark:hover:bg-[#0D1321] text-xs text-slate-700 dark:text-slate-200"
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
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.18)] hover:bg-slate-100 dark:hover:bg-[#0D1321] text-slate-600 dark:text-slate-300"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleRequestDelete(entry, false)}
                            title="Delete downloaded installer"
                            className="p-1.5 rounded-lg border border-[#F43F5E]/30 text-rose-600 dark:text-rose-400 hover:bg-[#F43F5E]/10"
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
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] disabled:opacity-50 text-[#090E18] text-xs font-semibold shadow-2xs transition-colors"
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
                                ? "bg-[#06B6D4] hover:bg-[#22D3EE] border-[#22D3EE] text-[#090E18] font-semibold"
                                : "border-slate-200 dark:border-[rgba(34,211,238,0.18)] bg-white dark:bg-[#0D1321] hover:bg-slate-100 dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200"
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
                          className="text-[11px] text-slate-500 hover:text-cyan-600 dark:text-slate-400 dark:hover:text-[#22D3EE]"
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
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/90 dark:bg-[#090E18]/90 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
            <span>
              All Golden Templates are marked Read-Only (
              <code className="font-mono text-[#22D3EE]">0444</code>) — topology
              nodes boot instant Copy-on-Write{" "}
              <code className="font-mono text-[#22D3EE]">.qcow2</code> overlays
              taking only a few MB.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1 rounded-lg bg-slate-200/80 hover:bg-slate-300/70 dark:bg-[#162032] dark:hover:bg-[#1E2B42] dark:border dark:border-[rgba(34,211,238,0.18)] text-slate-800 dark:text-slate-100 font-medium text-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
