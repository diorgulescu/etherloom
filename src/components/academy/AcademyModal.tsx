import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Cable,
  CheckCircle2,
  Clock,
  Cpu,
  GraduationCap,
  HardDriveDownload,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { AcademyLabSummary } from "../../types/studio";
import { EtherloomBackdropOrnament, EtherloomMark } from "../brand";

interface AcademyModalProps {
  open: boolean;
  labs: AcademyLabSummary[];
  loading: boolean;
  launchingLabId: string | null;
  activeLabId: string | null;
  initialPromptLabId?: string | null;
  onClearInitialPromptLab?: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onLaunchLab: (labId: string) => void;
  onOpenTemplateWizard: () => void;
  onOpenOsLibraryForCatalogIds?: (
    catalogIds: string[],
    labTitle?: string
  ) => void;
}

function difficultyBadgeClass(difficulty: string | undefined): string {
  switch ((difficulty ?? "").toLowerCase()) {
    case "beginner":
      return "bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399] border-[#10B981]/35";
    case "intermediate":
      return "bg-[#22D3EE]/15 text-cyan-700 dark:text-[#22D3EE] border-[#22D3EE]/35";
    case "advanced":
      return "bg-[#6366F1]/15 text-indigo-700 dark:text-[#818CF8] border-[#6366F1]/35";
    default:
      return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30";
  }
}

function getMissingCatalogIds(lab: AcademyLabSummary): string[] {
  const reqs = Array.isArray(lab.requiredTemplates)
    ? lab.requiredTemplates
    : [];
  return reqs
    .filter((r) => r && !r.satisfied)
    .map((r) => r.catalogId ?? r.osProfileId);
}

export function AcademyModal({
  open,
  labs,
  loading,
  launchingLabId,
  activeLabId,
  initialPromptLabId = null,
  onClearInitialPromptLab,
  onClose,
  onRefresh,
  onLaunchLab,
  onOpenTemplateWizard,
  onOpenOsLibraryForCatalogIds,
}: AcademyModalProps) {
  const [difficultyFilter, setDifficultyFilter] = useState<string>("All");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [missingPromptLabId, setMissingPromptLabId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (open) {
      onRefresh();
    } else {
      setMissingPromptLabId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && initialPromptLabId) {
      setMissingPromptLabId(initialPromptLabId);
      onClearInitialPromptLab?.();
    }
  }, [initialPromptLabId, onClearInitialPromptLab, open]);

  const safeLabs = useMemo(
    () =>
      Array.isArray(labs)
        ? labs.filter(
            (l): l is AcademyLabSummary =>
              Boolean(
                l &&
                  typeof l === "object" &&
                  typeof l.id === "string" &&
                  typeof l.title === "string"
              )
          )
        : [],
    [labs]
  );

  const promptLab = useMemo(
    () =>
      open && missingPromptLabId
        ? safeLabs.find((l) => l.id === missingPromptLabId) ?? null
        : null,
    [missingPromptLabId, open, safeLabs]
  );

  const allTags = useMemo(() => {
    if (!open) return [];
    const set = new Set<string>();
    for (const lab of safeLabs) {
      const tags = Array.isArray(lab.tags) ? lab.tags : [];
      for (const tag of tags) {
        if (typeof tag === "string" && tag) {
          set.add(tag);
        }
      }
    }
    return Array.from(set);
  }, [open, safeLabs]);

  const filteredLabs = useMemo(() => {
    if (!open) return [];
    return safeLabs.filter((lab) => {
      const diff = (lab.difficulty ?? "").toLowerCase();
      const tags = Array.isArray(lab.tags) ? lab.tags : [];
      if (
        difficultyFilter !== "All" &&
        diff !== difficultyFilter.toLowerCase()
      ) {
        return false;
      }
      if (selectedTag && !tags.includes(selectedTag)) {
        return false;
      }
      return true;
    });
  }, [difficultyFilter, open, safeLabs, selectedTag]);

  if (!open) return null;

  const handleDeepLinkMissingImages = (lab: AcademyLabSummary) => {
    const missingIds = getMissingCatalogIds(lab);
    setMissingPromptLabId(null);
    if (onOpenOsLibraryForCatalogIds && missingIds.length > 0) {
      onOpenOsLibraryForCatalogIds(
        missingIds,
        `Lab ${String(lab.number).padStart(2, "0")}: ${lab.title}`
      );
    } else {
      onClose();
      onOpenTemplateWizard();
    }
  };

  const handleClickStartLab = (lab: AcademyLabSummary) => {
    const isActive = activeLabId === lab.id;
    if (!isActive && !lab.allTemplatesReady) {
      setMissingPromptLabId(lab.id);
      return;
    }
    onLaunchLab(lab.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 dark:bg-[#050912]/85"
      role="dialog"
      aria-modal="true"
      aria-labelledby="etherloom-academy-title"
    >
      <div className="relative w-full max-w-4xl max-h-[88vh] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header with Woven Circuit Backdrop Ornament */}
        <div className="relative px-5 py-4 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.16)] bg-gradient-to-r from-indigo-500/[0.08] via-cyan-500/[0.05] to-transparent dark:from-[#0D1321] dark:via-[#111827] dark:to-[#0D1321] flex items-center justify-between gap-4 overflow-hidden">
          <EtherloomBackdropOrnament
            rasterVariant="none"
            opacityClassName="opacity-20"
            className="hidden dark:block absolute inset-0"
          />
          <div className="relative z-10 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-[#090E18] border border-[#6366F1]/40 flex items-center justify-center shadow-sm shrink-0">
              <EtherloomMark size={30} />
            </div>
            <div>
              <h2
                id="etherloom-academy-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2"
              >
                <GraduationCap className="w-4 h-4 text-[#6366F1] dark:text-[#818CF8] shrink-0" />
                <span>Etherloom Networking Academy &amp; Guided Labs</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#6366F1]/15 text-indigo-700 dark:text-[#818CF8] border border-[#6366F1]/30">
                  {safeLabs.length} Interactive Labs
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Multi-OS guided labs across Alpine Linux, OpenBSD, OpenWrt,
                MikroTik CHR v7 &amp; FreeDOS — powered by QEMU HVF/TCG,
                Wireshark wiretaps, and{" "}
                <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                  tcpflowy
                </code>
                .
              </p>
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh template readiness & lab catalog"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-[#1E2B42]"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin text-[#22D3EE]" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Academy browser"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-[#1E2B42]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Difficulty & Topic Filter Strip */}
        <div className="px-5 py-2.5 border-b border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/80 dark:bg-[#0D1321]/90 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(["All", "Beginner", "Intermediate", "Advanced"] as const).map(
              (diff) => {
                const active = difficultyFilter === diff;
                return (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setDifficultyFilter(diff)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      active
                        ? "bg-[#6366F1] text-white shadow-2xs"
                        : "text-slate-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-[#1E2B42]"
                    }`}
                  >
                    {diff}
                  </button>
                );
              }
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {allTags.map((tag) => {
              const active = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(active ? null : tag)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors ${
                    active
                      ? "bg-[#22D3EE]/15 border-[#22D3EE]/45 text-cyan-700 dark:text-[#22D3EE]"
                      : "bg-white dark:bg-[#162032] border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-500 dark:text-slate-400 hover:border-cyan-400/40"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lab Cards List */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 space-y-3 bg-slate-50 dark:bg-[#0D1321]">
          {filteredLabs.map((lab) => {
            const isActive = activeLabId === lab.id;
            const isLaunching = launchingLabId === lab.id;
            const labTags = Array.isArray(lab.tags) ? lab.tags : [];
            const labReqs = Array.isArray(lab.requiredTemplates)
              ? lab.requiredTemplates
              : [];
            const missingTemplates = labReqs.filter((r) => r && !r.satisfied);

            return (
              <div
                key={lab.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isActive
                    ? "border-[#22D3EE]/60 bg-cyan-500/[0.04] dark:bg-[#1E2B42] ring-1 ring-[#22D3EE]/25 shadow-loom-cyan"
                    : "border-slate-200 dark:border-[rgba(34,211,238,0.15)] bg-white dark:bg-[#162032] hover:border-slate-300 dark:hover:bg-[#1E2B42] dark:hover:border-[rgba(34,211,238,0.40)]"
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0 flex-1">
                    {/* Top Badge Row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-900 text-white dark:bg-[#090E18] dark:text-[#22D3EE] dark:border dark:border-[#22D3EE]/30">
                        LAB {String(lab.number).padStart(2, "0")}
                      </span>
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${difficultyBadgeClass(
                          lab.difficulty
                        )}`}
                      >
                        {lab.difficulty}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <Clock className="w-3 h-3" />
                        <span>{lab.estimatedMinutes} min</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <Cpu className="w-3 h-3" />
                        <span>{lab.nodeCount} nodes</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <Cable className="w-3 h-3" />
                        <span>{lab.linkCount} wires</span>
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#22D3EE]/20 text-cyan-800 dark:text-[#22D3EE] border border-[#22D3EE]/40">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>ACTIVE IN WORKSPACE</span>
                        </span>
                      )}
                    </div>

                    {/* Title & Subtitle */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {lab.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                        {lab.subtitle}
                      </p>
                    </div>

                    {/* Tags & Required OS Templates Readiness */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {labTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#090E18] dark:border dark:border-slate-700/70 text-[10.5px] font-mono text-slate-600 dark:text-slate-300"
                        >
                          {tag}
                        </span>
                      ))}

                      <span className="mx-1 text-slate-300 dark:text-slate-700">
                        |
                      </span>

                      {labReqs.map((req) => (
                        <span
                          key={req.catalogId ?? req.osProfileId}
                          title={
                            req.satisfied
                              ? `Matched Golden Template: ${req.matchedTemplateName}`
                              : `Required OS image '${req.osProfileName}' (${req.catalogId ?? req.osProfileId}) is not in your active templates folder yet.`
                          }
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10.5px] font-medium ${
                            req.satisfied
                              ? "bg-[#10B981]/10 border-[#10B981]/30 text-emerald-700 dark:text-[#34D399]"
                              : "bg-[#F59E0B]/10 border-[#F59E0B]/35 text-amber-800 dark:text-amber-200"
                          }`}
                        >
                          {req.satisfied ? (
                            <CheckCircle2 className="w-3 h-3 text-[#10B981]" />
                          ) : (
                            <AlertTriangle className="w-3 h-3 text-[#F59E0B]" />
                          )}
                          <span>
                            {req.osProfileName}
                            {req.arch && req.arch !== "aarch64"
                              ? ` (${req.arch})`
                              : ""}
                            {req.satisfied ? " • Ready" : " • Missing"}
                          </span>
                        </span>
                      ))}
                    </div>

                    {/* Inline Actionable Missing-OS Callout */}
                    {missingTemplates.length > 0 && (
                      <div className="mt-1.5 rounded-lg bg-[#F59E0B]/[0.08] border border-[#F59E0B]/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                        <span>
                          <strong>Required OS Images Missing:</strong>{" "}
                          {missingTemplates
                            .map((m) => m.osProfileName)
                            .join(" + ")}{" "}
                          not downloaded/built in active{" "}
                          <code className="font-mono">templates/</code> yet.
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeepLinkMissingImages(lab)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-semibold shrink-0 shadow-2xs transition-colors"
                        >
                          <HardDriveDownload className="w-3 h-3" />
                          <span>Download / Setup in OS Library</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right Start / Reset Action Column */}
                  <div className="flex md:flex-col items-center md:items-end justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(launchingLabId)}
                      onClick={() => handleClickStartLab(lab)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 ${
                        isActive
                          ? "bg-amber-600 hover:bg-amber-500 text-white"
                          : "bg-[#6366F1] hover:bg-indigo-500 text-white"
                      }`}
                    >
                      {isLaunching ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isActive ? (
                        <RotateCcw className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      <span>
                        {isLaunching
                          ? "Provisioning…"
                          : isActive
                          ? "Reset Sandbox"
                          : "Start Lab"}
                      </span>
                    </button>

                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      {lab.stepCount} guided steps
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/70 dark:bg-[#090E18]/90 flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <BookOpen className="w-3.5 h-3.5 text-[#22D3EE]" />
            <span>
              Every lab instantiates an isolated{" "}
              <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                academy-*.etherloom
              </code>{" "}
              copy so you can experiment freely and hit{" "}
              <strong>Reset Lab</strong> anytime.
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#1E2B42]"
          >
            Close
          </button>
        </div>

        {/* Focused "Required OS Images Missing" Prompt Overlay when clicking Start Lab */}
        {promptLab && !promptLab.allTemplatesReady && (
          <div className="absolute inset-0 z-20 bg-slate-950/75 dark:bg-[#050912]/88 flex items-center justify-center p-5">
            <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#111827] border border-amber-500/45 shadow-2xl overflow-hidden">
              <div className="px-5 py-4 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent border-b border-slate-200 dark:border-[rgba(34,211,238,0.14)] flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/35 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-[#F59E0B]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Required OS Images Missing
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      LAB {String(promptLab.number).padStart(2, "0")} —{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {promptLab.title}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMissingPromptLabId(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3.5">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  One or more Golden OS Templates required to boot this lab’s
                  virtual machines are not yet present in your active{" "}
                  <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                    templates/
                  </code>{" "}
                  directory:
                </p>

                <div className="space-y-2">
                  {(Array.isArray(promptLab.requiredTemplates)
                    ? promptLab.requiredTemplates
                    : []
                  ).map((req) => {
                    const catId = req.catalogId ?? req.osProfileId;
                    return (
                      <div
                        key={catId}
                        className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-3 ${
                          req.satisfied
                            ? "bg-[#10B981]/[0.06] border-[#10B981]/25"
                            : "bg-[#F59E0B]/[0.08] border-[#F59E0B]/35"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {req.satisfied ? (
                            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                              <span>{req.osProfileName}</span>
                              {req.arch && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-[#090E18] text-slate-600 dark:text-slate-300">
                                  {req.arch}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {req.satisfied
                                ? `Ready (${req.matchedTemplateName ?? catId})`
                                : `Catalog ID: ${catId} — needs download or Guided Template Setup`}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            req.satisfied
                              ? "bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399]"
                              : "bg-[#F59E0B]/20 text-amber-800 dark:text-amber-200"
                          }`}
                        >
                          {req.satisfied ? "Ready" : "Missing"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const id = promptLab.id;
                      setMissingPromptLabId(null);
                      onLaunchLab(id);
                    }}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.20)] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1E2B42] transition-colors"
                  >
                    Preview Blueprint &amp; Guide Anyway
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeepLinkMissingImages(promptLab)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#6366F1] hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5" />
                    <span>Download / Setup in OS Library</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
