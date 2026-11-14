import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  RefreshCw,
  Stethoscope,
  Terminal,
  X,
} from "lucide-react";
import type { EnvDoctorReport } from "../../types/studio";

export interface QemuHostEvaluation {
  ready: boolean;
  missingItems: string[];
  versionSummary: string | null;
}

/**
 * Evaluates whether the required host QEMU hypervisor binaries & UEFI firmware
 * are installed on the current Mac (`aarch64` Apple Silicon or `x86_64` Intel).
 */
export function evaluateQemuHostStatus(
  report: EnvDoctorReport | null
): QemuHostEvaluation {
  if (!report) {
    return { ready: true, missingItems: [], versionSummary: null };
  }

  const missing: string[] = [];
  const isArmHost = report.hostArch === "aarch64";

  if (isArmHost) {
    if (!report.qemuSystemAarch64?.found) {
      missing.push("qemu-system-aarch64");
    }
    if (!report.edk2Aarch64Code?.found) {
      missing.push("edk2-aarch64-code.fd (UEFI firmware)");
    }
  } else {
    if (!report.qemuSystemX86_64?.found) {
      missing.push("qemu-system-x86_64");
    }
    if (!report.edk2X86_64Code?.found) {
      missing.push("edk2-x86_64-code.fd (UEFI firmware)");
    }
  }

  if (!report.qemuImg?.found) {
    missing.push("qemu-img");
  }

  const primaryProbe = isArmHost
    ? report.qemuSystemAarch64
    : report.qemuSystemX86_64;

  return {
    ready: missing.length === 0,
    missingItems: missing,
    versionSummary:
      primaryProbe?.version ?? report.qemuImg?.version ?? null,
  };
}

interface QemuMissingBannerProps {
  report: EnvDoctorReport;
  loading: boolean;
  onRefresh: () => void;
  onOpenDoctor: () => void;
  onDismiss: () => void;
}

export function QemuMissingBanner({
  report,
  loading,
  onRefresh,
  onOpenDoctor,
  onDismiss,
}: QemuMissingBannerProps) {
  const [copied, setCopied] = useState(false);
  const evalStatus = evaluateQemuHostStatus(report);

  if (evalStatus.ready) return null;

  const handleCopyInstall = async () => {
    try {
      await navigator.clipboard.writeText("brew install qemu");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 px-4 py-2.5 bg-rose-500/[0.09] dark:bg-[#1A1220] border-b border-[#F43F5E]/35 flex flex-wrap items-center justify-between gap-3 text-xs z-10"
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-[#F43F5E]/15 border border-[#F43F5E]/35 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4 text-[#F43F5E]" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-rose-900 dark:text-rose-200">
              QEMU Hypervisor Not Installed on Host
            </span>
            <span className="text-[11px] font-mono text-rose-700/90 dark:text-rose-300/90">
              Missing: {evalStatus.missingItems.join(", ")}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
            You can design topologies and download{" "}
            <code className="font-mono text-cyan-700 dark:text-[#22D3EE]">
              .qcow2
            </code>{" "}
            OS templates right now, but booting VMs requires QEMU via Homebrew:{" "}
            <code className="font-mono px-1.5 py-0.5 rounded bg-white/80 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-amber-800 dark:text-amber-300">
              brew install qemu
            </code>{" "}
            <span className="text-slate-500 dark:text-slate-400">
              (Etherloom automatically re-detects QEMU as soon as installation
              finishes).
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void handleCopyInstall()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-amber-400 text-[#090E18] font-semibold transition-colors shadow-xs"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Terminal className="w-3.5 h-3.5" />
              <span>Copy brew install qemu</span>
              <Copy className="w-3 h-3 opacity-80" />
            </>
          )}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#162032] hover:bg-slate-100 dark:hover:bg-[#1E2B42] border border-slate-200 dark:border-[rgba(34,211,238,0.2)] text-slate-700 dark:text-slate-200 font-medium disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              loading ? "animate-spin text-[#22D3EE]" : ""
            }`}
          />
          <span>Re-check</span>
        </button>

        <button
          type="button"
          onClick={onOpenDoctor}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#162032] hover:bg-slate-100 dark:hover:bg-[#1E2B42] border border-slate-200 dark:border-[rgba(34,211,238,0.2)] text-slate-700 dark:text-slate-200 font-medium transition-colors"
        >
          <Stethoscope className="w-3.5 h-3.5 text-[#22D3EE]" />
          <span className="hidden md:inline">Full Report</span>
        </button>

        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss banner for this session"
          aria-label="Dismiss QEMU warning banner"
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-[#1E2B42]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
