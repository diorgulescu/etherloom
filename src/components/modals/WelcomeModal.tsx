import {
  FilePlus2,
  FolderOpen,
  GraduationCap,
  HardDriveDownload,
  ShieldCheck,
  Sparkles,
  Waves,
  Waypoints,
  X,
} from "lucide-react";
import type { AcademyLabSummary } from "../../types/studio";

interface WelcomeModalProps {
  open: boolean;
  labs: AcademyLabSummary[];
  showOnStartup: boolean;
  onChangeShowOnStartup: (show: boolean) => void;
  onClose: () => void;
  onOpenAcademy: () => void;
  onLaunchLab: (labId: string) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenCustomVmWizard: () => void;
}

export function WelcomeModal({
  open,
  labs,
  showOnStartup,
  onChangeShowOnStartup,
  onClose,
  onOpenAcademy,
  onLaunchLab,
  onNewProject,
  onOpenProject,
  onOpenCustomVmWizard,
}: WelcomeModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/55 dark:bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="etherloom-welcome-title"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Hero Banner */}
        <div className="px-6 py-5 bg-gradient-to-br from-indigo-600/15 via-sky-500/10 to-emerald-500/5 border-b border-slate-200/80 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shrink-0">
              <Waypoints className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="etherloom-welcome-title"
                  className="text-base font-bold text-slate-900 dark:text-zinc-100"
                >
                  Welcome to Etherloom Studio
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Zero-Root macOS HVF • GPLv3</span>
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 max-w-xl leading-relaxed">
                Orchestrate real Linux, OpenBSD, FreeBSD, and NetBSD virtual
                networks on Apple Silicon &amp; Intel Macs, inject live link
                impairments, stream wiretaps to Wireshark, and dissect TCP flows
                visually with <code className="font-mono">tcpflowy</code>.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss welcome screen"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[72vh]">
          {/* Primary Featured Card: Networking Academy & Guided Labs */}
          <div className="rounded-xl border border-indigo-500/35 bg-indigo-500/[0.06] dark:bg-indigo-500/[0.09] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-indigo-500" />
                <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  Interactive Networking Academy &amp; Guided Labs
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAcademy();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Browse All {labs.length || 5} Guided Labs</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {labs.slice(0, 4).map((lab) => (
                <button
                  key={lab.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    onLaunchLab(lab.id);
                  }}
                  className="text-left p-2.5 rounded-lg bg-white/90 dark:bg-zinc-900/90 hover:bg-white dark:hover:bg-zinc-800 border border-slate-200/90 dark:border-zinc-800 transition-colors"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                    <span>LAB {String(lab.number).padStart(2, "0")}</span>
                    <span>
                      {lab.difficulty} • {lab.estimatedMinutes}m
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate mt-0.5">
                    {lab.title}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quickstart Studio Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-left p-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 hover:border-sky-500/40 bg-slate-50/70 dark:bg-zinc-950/60 transition-colors space-y-1"
            >
              <Waves className="w-4 h-4 text-sky-500" />
              <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                Explore Demo Topology
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Jump directly into the pre-wired OpenBSD + FreeBSD + Alpine
                campus lab.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCustomVmWizard();
              }}
              className="text-left p-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 hover:border-emerald-500/40 bg-slate-50/70 dark:bg-zinc-950/60 transition-colors space-y-1"
            >
              <HardDriveDownload className="w-4 h-4 text-emerald-500" />
              <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                Install OS / Golden Template
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Boot any Linux or BSD <code className="font-mono">.iso/.img</code>{" "}
                over UEFI VNC and promote to a reusable template.
              </p>
            </button>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/60 space-y-2 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  Workspace Bundles
                </div>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Create or open portable{" "}
                  <code className="font-mono">*.etherloom</code> folders.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNewProject();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 hover:bg-slate-100"
                >
                  <FilePlus2 className="w-3 h-3 text-sky-500" />
                  <span>New</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProject();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 hover:bg-slate-100"
                >
                  <FolderOpen className="w-3 h-3 text-amber-500" />
                  <span>Open…</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/50 flex items-center justify-between text-xs">
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnStartup}
              onChange={(e) => onChangeShowOnStartup(e.target.checked)}
              className="rounded accent-indigo-500"
            />
            <span>Show Welcome screen on startup</span>
          </label>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 transition-colors"
          >
            Enter Studio
          </button>
        </div>
      </div>
    </div>
  );
}
