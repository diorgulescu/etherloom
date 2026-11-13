import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { EnvDoctorReport } from "../../types/studio";

interface DependencyCheckModalProps {
  open: boolean;
  report: EnvDoctorReport | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function DependencyCheckModal({
  open,
  report,
  loading,
  onClose,
  onRefresh,
}: DependencyCheckModalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const handleCopy = async (id: string, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 dark:bg-[#050912]/85"
      role="dialog"
      aria-modal="true"
      aria-labelledby="env-doctor-title"
    >
      <div className="w-full max-w-2xl max-h-[86vh] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.16)] bg-slate-50/70 dark:bg-[#0D1321]/90 flex items-center justify-between gap-4">
          <div>
            <h2
              id="env-doctor-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              System Status &amp; Dependency Check
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Zero-root macOS host diagnostics powered by{" "}
              <code className="font-mono text-[11px] text-cyan-700 dark:text-[#22D3EE]">
                env_doctor
              </code>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200/80 dark:bg-[#162032] dark:hover:bg-[#1E2B42] dark:border dark:border-[rgba(34,211,238,0.18)] text-slate-700 dark:text-slate-200 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#22D3EE]" : ""}`}
              />
              <span>Re-scan</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-[#1E2B42] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Host Summary Banner */}
        {report && (
          <div className="px-5 py-3 bg-slate-50/90 dark:bg-[#0D1321]/80 border-b border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] font-mono text-[11px] text-slate-700 dark:text-slate-200">
                <Cpu className="w-3.5 h-3.5 text-[#22D3EE]" />
                {report.hostOs} / {report.hostArch}
              </span>

              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium text-[11px] border ${
                  report.hvfSupported
                    ? "bg-[#10B981]/12 border-[#10B981]/35 text-emerald-700 dark:text-[#34D399]"
                    : "bg-[#F59E0B]/12 border-[#F59E0B]/35 text-amber-700 dark:text-amber-300"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {report.hvfSupported
                  ? "Hypervisor.framework Ready"
                  : "HVF Unverified"}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-[#10B981]/15 text-emerald-700 dark:text-[#34D399] font-medium">
                {report.okCount} Passed
              </span>
              {report.warningCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[#F59E0B]/15 text-amber-700 dark:text-amber-300 font-medium">
                  {report.warningCount} Amber Warning
                  {report.warningCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Dependency Cards */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-3 bg-slate-50 dark:bg-[#0D1321]">
          {!report ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              Running macOS environment checks…
            </div>
          ) : (
            report.checks.map((check) => {
              const isOk = check.badge === "ok";
              return (
                <div
                  key={check.id}
                  className={`rounded-xl border p-3.5 transition-colors ${
                    isOk
                      ? "bg-white dark:bg-[#162032] border-slate-200/90 dark:border-[rgba(34,211,238,0.16)]"
                      : "bg-amber-500/[0.04] dark:bg-[#162032] border-[#F59E0B]/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {check.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#090E18] dark:border dark:border-[rgba(34,211,238,0.14)] text-slate-500 dark:text-slate-400">
                          {check.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {check.requiredFor}
                      </p>
                    </div>

                    {/* Green / Amber Status Badge */}
                    <span
                      className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        isOk
                          ? "bg-[#10B981]/15 border-[#10B981]/35 text-emerald-700 dark:text-[#34D399]"
                          : "bg-[#F59E0B]/15 border-[#F59E0B]/35 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {isOk ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                          <span>Ready</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
                          <span>Missing</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Detected Path & Version or Searched Locations */}
                  <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-[rgba(34,211,238,0.14)] space-y-1.5 text-[11px]">
                    {check.found ? (
                      <>
                        {check.version && (
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-400 dark:text-slate-500 w-14 shrink-0">
                              Version
                            </span>
                            <span className="font-mono text-slate-800 dark:text-slate-200 break-all">
                              {check.version}
                            </span>
                          </div>
                        )}
                        {check.path && (
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-400 dark:text-slate-500 w-14 shrink-0">
                              Path
                            </span>
                            <span className="font-mono text-emerald-700 dark:text-[#34D399] break-all">
                              {check.path}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-slate-400 dark:text-slate-500 w-16 shrink-0">
                          Searched
                        </span>
                        <span className="font-mono text-slate-600 dark:text-slate-400 break-all">
                          {check.searchedPaths.join(", ")}
                        </span>
                      </div>
                    )}

                    {/* Detailed breakdown for python3 + uv */}
                    {check.id === "python-tcpflowy" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                            python3
                          </span>
                          <span
                            className={`font-mono text-[10px] truncate ${
                              report.python3.found
                                ? "text-emerald-600 dark:text-[#34D399]"
                                : "text-amber-600 dark:text-[#F59E0B]"
                            }`}
                          >
                            {report.python3.found
                              ? report.python3.version ?? report.python3.path
                              : "Not found"}
                          </span>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                            uv
                          </span>
                          <span
                            className={`font-mono text-[10px] truncate ${
                              report.uv.found
                                ? "text-emerald-600 dark:text-[#34D399]"
                                : "text-amber-600 dark:text-[#F59E0B]"
                            }`}
                          >
                            {report.uv.found
                              ? report.uv.version ?? report.uv.path
                              : "Optional (brew install uv)"}
                          </span>
                        </div>
                      </div>
                    )}

                    {check.details && (
                      <p className="text-slate-500 dark:text-slate-400">
                        {check.details}
                      </p>
                    )}

                    {check.remediation && (
                      <div className="pt-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/25">
                        <code className="font-mono text-amber-800 dark:text-amber-200">
                          $ {check.remediation}
                        </code>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(check.id, check.remediation!)
                          }
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/80 dark:bg-[#090E18] text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#1E2B42] text-[10px] font-medium transition-colors"
                        >
                          {copiedId === check.id ? (
                            <>
                              <Check className="w-3 h-3 text-[#10B981]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/70 dark:bg-[#090E18]/90 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="truncate font-mono">
            Templates: {report?.templatesDir ?? "~/Library/Application Support/Etherloom/templates"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] font-semibold text-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
