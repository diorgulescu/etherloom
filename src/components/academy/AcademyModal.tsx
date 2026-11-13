import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
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

interface AcademyModalProps {
  open: boolean;
  labs: AcademyLabSummary[];
  loading: boolean;
  launchingLabId: string | null;
  activeLabId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onLaunchLab: (labId: string) => void;
  onOpenTemplateWizard: () => void;
}

function difficultyBadgeClass(difficulty: string): string {
  switch (difficulty.toLowerCase()) {
    case "beginner":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "intermediate":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";
    case "advanced":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30";
    default:
      return "bg-slate-500/15 text-slate-700 dark:text-zinc-300 border-slate-500/30";
  }
}

export function AcademyModal({
  open,
  labs,
  loading,
  launchingLabId,
  activeLabId,
  onClose,
  onRefresh,
  onLaunchLab,
  onOpenTemplateWizard,
}: AcademyModalProps) {
  const [difficultyFilter, setDifficultyFilter] = useState<string>("All");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      onRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const lab of labs) {
      for (const tag of lab.tags) {
        set.add(tag);
      }
    }
    return Array.from(set);
  }, [labs]);

  const filteredLabs = useMemo(() => {
    return labs.filter((lab) => {
      if (
        difficultyFilter !== "All" &&
        lab.difficulty.toLowerCase() !== difficultyFilter.toLowerCase()
      ) {
        return false;
      }
      if (selectedTag && !lab.tags.includes(selectedTag)) {
        return false;
      }
      return true;
    });
  }, [difficultyFilter, labs, selectedTag]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/55 dark:bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="etherloom-academy-title"
    >
      <div className="w-full max-w-4xl max-h-[88vh] rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-zinc-800 bg-gradient-to-r from-indigo-500/[0.08] via-sky-500/[0.05] to-transparent flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-600 flex items-center justify-center shadow-sm shrink-0">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2
                id="etherloom-academy-title"
                className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2"
              >
                <span>Etherloom Networking Academy &amp; Guided Labs</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25">
                  {labs.length} Interactive Labs
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                Hands-on Linux &amp; OpenBSD labs powered by zero-root QEMU HVF,
                live Wireshark wiretaps, and{" "}
                <code className="font-mono">tcpflowy</code> stream dissection.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh template readiness & lab catalog"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Academy browser"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Difficulty & Topic Filter Strip */}
        <div className="px-5 py-2.5 border-b border-slate-200/70 dark:border-zinc-800/80 bg-slate-50/80 dark:bg-zinc-950/50 flex flex-wrap items-center justify-between gap-2">
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
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-slate-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
                      ? "bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-300"
                      : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:border-slate-300"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lab Cards List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
          {filteredLabs.map((lab) => {
            const isActive = activeLabId === lab.id;
            const isLaunching = launchingLabId === lab.id;
            const missingTemplates = lab.requiredTemplates.filter(
              (r) => !r.satisfied
            );

            return (
              <div
                key={lab.id}
                className={`rounded-xl border p-4 transition-all ${
                  isActive
                    ? "border-indigo-500/60 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.07] ring-1 ring-indigo-500/25"
                    : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 hover:border-slate-300 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0 flex-1">
                    {/* Top Badge Row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-900 text-white dark:bg-zinc-800 dark:text-zinc-100">
                        LAB {String(lab.number).padStart(2, "0")}
                      </span>
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${difficultyBadgeClass(
                          lab.difficulty
                        )}`}
                      >
                        {lab.difficulty}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
                        <Clock className="w-3 h-3" />
                        <span>{lab.estimatedMinutes} min</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
                        <Cpu className="w-3 h-3" />
                        <span>{lab.nodeCount} nodes</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
                        <Cable className="w-3 h-3" />
                        <span>{lab.linkCount} wires</span>
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>ACTIVE IN WORKSPACE</span>
                        </span>
                      )}
                    </div>

                    {/* Title & Subtitle */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                        {lab.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                        {lab.subtitle}
                      </p>
                    </div>

                    {/* Tags & Required OS Templates Readiness */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {lab.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800/90 text-[10.5px] font-mono text-slate-600 dark:text-zinc-300"
                        >
                          {tag}
                        </span>
                      ))}

                      <span className="mx-1 text-slate-300 dark:text-zinc-700">
                        |
                      </span>

                      {lab.requiredTemplates.map((req) => (
                        <span
                          key={req.osProfileId}
                          title={
                            req.satisfied
                              ? `Matched Golden Template: ${req.matchedTemplateName}`
                              : `No Golden Template found yet for ${req.osProfileName} — you can still launch the topology & guide immediately or build a template via the ISO Wizard.`
                          }
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10.5px] font-medium ${
                            req.satisfied
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                              : "bg-amber-500/10 border-amber-500/35 text-amber-800 dark:text-amber-200"
                          }`}
                        >
                          {req.satisfied ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                          )}
                          <span>
                            {req.osProfileName}
                            {req.satisfied ? " Ready" : " Template Needed"}
                          </span>
                        </span>
                      ))}
                    </div>

                    {/* Friendly Missing-Template Prompt */}
                    {missingTemplates.length > 0 && (
                      <div className="mt-1.5 rounded-lg bg-amber-500/[0.08] border border-amber-500/25 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                        <span>
                          Requires{" "}
                          <strong>
                            {missingTemplates
                              .map((m) => m.osProfileName)
                              .join(" + ")}
                          </strong>{" "}
                          Golden Template to boot VMs (you can still launch the
                          blueprint &amp; interactive guide right now).
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenTemplateWizard();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-medium shrink-0"
                        >
                          <HardDriveDownload className="w-3 h-3" />
                          <span>Install / Create Template…</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right Launch / Reset Action Column */}
                  <div className="flex md:flex-col items-center md:items-end justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(launchingLabId)}
                      onClick={() => onLaunchLab(lab.id)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 ${
                        isActive
                          ? "bg-amber-600 hover:bg-amber-500 text-white"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white"
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
                          : "Launch Lab"}
                      </span>
                    </button>

                    <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                      {lab.stepCount} guided steps
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/50 flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
            <span>
              Every lab instantiates an isolated{" "}
              <code className="font-mono">academy-*.etherloom</code> copy so you
              can experiment freely and hit <strong>Reset Lab</strong> anytime.
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
