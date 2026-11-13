import {
  FilePlus2,
  FolderOpen,
  GraduationCap,
  HardDriveDownload,
  ShieldCheck,
  Sparkles,
  Waves,
  X,
} from "lucide-react";
import type { AcademyLabSummary } from "../../types/studio";
import {
  EtherloomBackdropOrnament,
  EtherloomMark,
  EtherloomWordmark,
} from "../brand";

interface WelcomeModalProps {
  open: boolean;
  labs: AcademyLabSummary[];
  showOnStartup: boolean;
  onChangeShowOnStartup: (show: boolean) => void;
  onClose: () => void;
  onOpenAcademy: () => void;
  onOpenStorageLibrary: () => void;
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
  onOpenStorageLibrary,
  onLaunchLab,
  onNewProject,
  onOpenProject,
  onOpenCustomVmWizard: _onOpenCustomVmWizard,
}: WelcomeModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 dark:bg-[#050912]/85"
      role="dialog"
      aria-modal="true"
      aria-labelledby="etherloom-welcome-title"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl overflow-hidden flex flex-col">
        {/* Hero Banner with Official Etherloom Artwork & Woven SVG Fallback */}
        <div className="relative px-6 py-6 bg-gradient-to-br from-slate-900 via-[#0D1321] to-[#111827] border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.16)] flex items-start justify-between gap-4 overflow-hidden">
          <EtherloomBackdropOrnament
            rasterVariant="banner"
            opacityClassName="opacity-30"
            className="absolute inset-0"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none bg-gradient-to-r from-[#0D1321]/85 via-[#0D1321]/65 to-[#0D1321]/85"
          />

          <div className="relative z-10 flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#090E18]/90 border border-[#22D3EE]/35 flex items-center justify-center shadow-loom-cyan shrink-0 p-1">
              <EtherloomMark size={46} preferRaster />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2
                  id="etherloom-welcome-title"
                  className="text-base font-bold text-white flex items-center gap-2"
                >
                  <EtherloomWordmark
                    markSize={0}
                    preferRaster={false}
                    textClassName="text-lg font-bold tracking-tight !text-white"
                    className="[&>svg]:hidden gap-0"
                  />
                  <span className="text-cyan-300 font-semibold text-sm">
                    Studio
                  </span>
                </h2>
                <span className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-[#22D3EE] border border-cyan-400/35">
                  v{__APP_VERSION__}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/35">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Zero-Root macOS HVF • GPLv3</span>
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1.5 max-w-xl leading-relaxed">
                Orchestrate 15 curated Linux, BSD, Router/Firewall, and UNIX/Retro
                operating systems on Apple Silicon &amp; Intel Macs, inject live
                link impairments, stream wiretaps to Wireshark, and dissect TCP
                flows visually with{" "}
                <code className="font-mono text-[#22D3EE]">tcpflowy</code>.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss welcome screen"
            className="relative z-10 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto overscroll-contain max-h-[72vh] bg-white dark:bg-[#111827]">
          {/* Primary Featured Card: Networking Academy & Guided Labs */}
          <div className="rounded-xl border border-[#6366F1]/35 bg-[#6366F1]/[0.06] dark:bg-[#162032]/90 dark:border-[#6366F1]/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-[#6366F1] dark:text-[#818CF8]" />
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Interactive Networking Academy &amp; Guided Labs
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAcademy();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#6366F1] hover:bg-indigo-500 text-white shadow-xs transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Browse All {labs.length || 8} Guided Labs</span>
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
                  className="text-left p-2.5 rounded-lg bg-white/90 dark:bg-[#0D1321]/90 hover:bg-white dark:hover:bg-[#1E2B42] border border-slate-200/90 dark:border-[rgba(34,211,238,0.16)] dark:hover:border-[rgba(34,211,238,0.45)] transition-colors"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-indigo-600 dark:text-[#22D3EE]">
                    <span>LAB {String(lab.number).padStart(2, "0")}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {lab.difficulty} • {lab.estimatedMinutes}m
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
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
              className="text-left p-3.5 rounded-xl border border-slate-200 dark:border-[rgba(34,211,238,0.16)] hover:border-cyan-500/45 dark:hover:border-[#22D3EE]/50 bg-slate-50/70 dark:bg-[#162032] dark:hover:bg-[#1E2B42] transition-colors space-y-1"
            >
              <Waves className="w-4 h-4 text-cyan-500 dark:text-[#22D3EE]" />
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Explore Demo Topology
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Jump directly into the pre-wired OpenBSD + FreeBSD + Alpine
                campus lab.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenStorageLibrary();
              }}
              className="text-left p-3.5 rounded-xl border border-slate-200 dark:border-[rgba(34,211,238,0.16)] hover:border-emerald-500/45 dark:hover:border-[#10B981]/55 bg-slate-50/70 dark:bg-[#162032] dark:hover:bg-[#1E2B42] transition-colors space-y-1"
            >
              <HardDriveDownload className="w-4 h-4 text-[#10B981]" />
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                15-OS Library &amp; External SSD
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Download Alpine, FreeBSD, OpenBSD, RouterOS CHR, OpenWrt,
                OPNsense, 9front &amp; FreeDOS on demand.
              </p>
            </button>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-[rgba(34,211,238,0.16)] bg-slate-50/70 dark:bg-[#162032] space-y-2 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Workspace Bundles
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Create or open portable{" "}
                  <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
                    *.etherloom
                  </code>{" "}
                  folders.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNewProject();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-[#0D1321] border border-slate-200 dark:border-[rgba(34,211,238,0.2)] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2B42]"
                >
                  <FilePlus2 className="w-3 h-3 text-[#22D3EE]" />
                  <span>New</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProject();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-[#0D1321] border border-slate-200 dark:border-[rgba(34,211,238,0.2)] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2B42]"
                >
                  <FolderOpen className="w-3 h-3 text-[#F59E0B]" />
                  <span>Open…</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/70 dark:bg-[#090E18]/90 flex items-center justify-between text-xs">
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnStartup}
              onChange={(e) => onChangeShowOnStartup(e.target.checked)}
              className="rounded accent-cyan-500"
            />
            <span>Show Welcome screen on startup</span>
          </label>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg font-semibold bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] shadow-xs transition-colors"
          >
            Enter Studio
          </button>
        </div>
      </div>
    </div>
  );
}
