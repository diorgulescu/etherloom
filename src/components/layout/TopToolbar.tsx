import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  FolderDown,
  FolderOpen,
  Gauge,
  GraduationCap,
  HardDriveDownload,
  Laptop,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Save,
  Settings,
  Square,
  Sun,
} from "lucide-react";
import { EtherloomMark } from "../brand";
import { evaluateQemuHostStatus } from "./QemuMissingBanner";
import type { EnvDoctorReport, ThemePreference } from "../../types/studio";

interface TopToolbarProps {
  projectName: string;
  bundlePath: string | null;
  isDirty: boolean;
  projectBusy: boolean;
  activeLabNumber: number | null;
  labDrawerOpen: boolean;
  readyTemplateCount?: number;
  runningVmCount?: number;
  onOpenWelcomeModal: () => void;
  onOpenActivityMonitorModal: () => void;
  onOpenAcademyModal: () => void;
  onOpenStorageLibraryModal: () => void;
  onToggleLabDrawer: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  dockOpen: boolean;
  onToggleDock: () => void;
  themePreference: ThemePreference;
  onChangeTheme: (pref: ThemePreference) => void;
  envReport: EnvDoctorReport | null;
  envLoading: boolean;
  onOpenDoctorModal: () => void;
  onOpenSettingsModal: () => void;
  labRunning: boolean;
  onToggleLabRunning: () => void;
}

export function TopToolbar({
  projectName,
  bundlePath,
  isDirty,
  projectBusy,
  activeLabNumber,
  labDrawerOpen,
  readyTemplateCount = 0,
  runningVmCount = 0,
  onOpenWelcomeModal,
  onOpenActivityMonitorModal,
  onOpenAcademyModal,
  onOpenStorageLibraryModal,
  onToggleLabDrawer,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  sidebarOpen,
  onToggleSidebar,
  dockOpen,
  onToggleDock,
  themePreference,
  onChangeTheme,
  envReport,
  envLoading,
  onOpenDoctorModal,
  onOpenSettingsModal,
  labRunning,
  onToggleLabRunning,
}: TopToolbarProps) {
  const isAllOk = envReport?.overallBadge === "ok";
  const qemuStatus = evaluateQemuHostStatus(envReport);
  const isQemuMissing = !envLoading && Boolean(envReport) && !qemuStatus.ready;
  const bundleBasename = bundlePath
    ? bundlePath.split("/").filter(Boolean).pop() ?? projectName
    : `${projectName} (unsaved)`;

  return (
    <header className="h-12 shrink-0 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-white dark:bg-[#111827] px-3 flex items-center justify-between gap-2 z-20">
      {/* Left section: Sidebar toggle, Official Brand Emblem, Project File Actions & Active Bundle */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={
            sidebarOpen ? "Hide Component Sidebar" : "Show Component Sidebar"
          }
          className={`p-1.5 rounded-md transition-colors ${
            sidebarOpen
              ? "bg-slate-200/70 text-slate-900 dark:bg-[#162032] dark:text-[#22D3EE]"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#162032]/80"
          }`}
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onOpenWelcomeModal}
          title="Open Etherloom Welcome & Brand Overview"
          className="group flex items-center gap-2 pr-2.5 border-r border-slate-200 dark:border-[rgba(34,211,238,0.14)] hover:opacity-90 transition-opacity"
        >
          <div className="w-7 h-7 rounded-lg bg-[#090E18] border border-[rgba(34,211,238,0.28)] group-hover:border-[#22D3EE]/70 flex items-center justify-center shadow-xs transition-colors">
            <EtherloomMark size={22} />
          </div>
          <span className="font-semibold text-sm tracking-tight text-slate-900 dark:text-slate-100 hidden md:inline">
            Etherloom
          </span>
        </button>

        {/* Project Workspace File Controls: New | Open… | Save ⌘S | Save As… */}
        <div className="flex items-center gap-0.5 bg-slate-100/90 dark:bg-[#162032]/90 p-0.5 rounded-lg border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)]">
          <button
            type="button"
            disabled={projectBusy}
            onClick={onNewProject}
            title="New Project Workspace"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#1E2B42] disabled:opacity-40 transition-colors"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-[#22D3EE]" />
            <span className="hidden lg:inline">New</span>
          </button>

          <button
            type="button"
            disabled={projectBusy}
            onClick={onOpenProject}
            title="Open .etherloom Project Folder…"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#1E2B42] disabled:opacity-40 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span className="hidden lg:inline">Open…</span>
          </button>

          <button
            type="button"
            disabled={projectBusy}
            onClick={onSaveProject}
            title="Save topology.toml (⌘S)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#1E2B42] disabled:opacity-40 transition-colors"
          >
            <Save className="w-3.5 h-3.5 text-[#10B981]" />
            <span className="hidden lg:inline">Save</span>
            <kbd className="hidden 2xl:inline text-[9.5px] font-mono px-1 py-0.5 rounded bg-slate-200/70 dark:bg-[#090E18] text-slate-500 dark:text-slate-400">
              ⌘S
            </kbd>
            {isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"
                title="Unsaved topology changes"
              />
            )}
          </button>

          <button
            type="button"
            disabled={projectBusy}
            onClick={onSaveProjectAs}
            title="Save Project As New .etherloom Bundle…"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#1E2B42] disabled:opacity-40 transition-colors"
          >
            <FolderDown className="w-3.5 h-3.5 text-[#818CF8]" />
            <span className="hidden xl:inline">Save As…</span>
          </button>
        </div>

        {/* Active Bundle Path Pill */}
        <div
          title={
            bundlePath ??
            "Unsaved scratch workspace — click Save to persist *.etherloom"
          }
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100/80 dark:bg-[#090E18]/75 border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] text-xs text-slate-600 dark:text-slate-300 max-w-[230px] truncate"
        >
          <span className="font-mono truncate">{bundleBasename}</span>
          {isDirty && (
            <span className="text-amber-600 dark:text-[#F59E0B] font-bold">
              •
            </span>
          )}
        </div>
      </div>

      {/* Center section: Orchestration controls */}
      <div className="flex items-center gap-1 bg-slate-100/90 dark:bg-[#162032]/90 p-1 rounded-lg border border-slate-200/70 dark:border-[rgba(34,211,238,0.14)] shrink-0">
        <button
          type="button"
          onClick={onToggleLabRunning}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            labRunning
              ? "bg-[#10B981] text-slate-950 font-semibold shadow-[0_0_12px_rgba(16,185,129,0.35)]"
              : "hover:bg-white dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200"
          }`}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{labRunning ? "Lab Active" : "Start Lab"}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (labRunning) onToggleLabRunning();
          }}
          disabled={!labRunning}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300 enabled:hover:bg-rose-500/15 enabled:hover:text-[#F43F5E] disabled:opacity-35 transition-colors"
        >
          <Square className="w-3 h-3 fill-current" />
          <span>Stop</span>
        </button>
      </div>

      {/* Right section: Activity Monitor, OS Library, Academy Browser, Env Doctor Status Pill, Theme Selector, Settings, Docks */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenActivityMonitorModal}
          title="Open Node Activity Monitor — CPU, Memory & Network (⌘⇧M)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-400/30 text-emerald-800 dark:text-[#34D399] transition-colors"
        >
          <Gauge className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Monitor</span>
          {runningVmCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-900 dark:text-emerald-100">
              {runningVmCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenStorageLibraryModal}
          title="Open Storage & 15-OS Library Manager (Download / Import / External SSD)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400/30 text-cyan-800 dark:text-[#22D3EE] transition-colors"
        >
          <HardDriveDownload className="w-3.5 h-3.5" />
          <span>OS Library</span>
          {readyTemplateCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-900 dark:text-cyan-100">
              {readyTemplateCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenAcademyModal}
          title="Open Interactive Networking Academy & Guided Labs"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            activeLabNumber !== null
              ? "bg-[#6366F1] hover:bg-[#818CF8] border-[#818CF8]/60 text-white shadow-[0_0_12px_rgba(99,102,241,0.35)]"
              : "bg-indigo-500/12 hover:bg-indigo-500/22 border-indigo-400/30 text-indigo-700 dark:text-[#818CF8]"
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>
            {activeLabNumber !== null
              ? `Lab ${String(activeLabNumber).padStart(2, "0")}`
              : "Academy"}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenDoctorModal}
          title={
            isQemuMissing
              ? `QEMU Missing (${qemuStatus.missingItems.join(", ")}) — Click for setup instructions`
              : "Open System Status & Host Dependency Check"
          }
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            envLoading
              ? "bg-slate-100 dark:bg-[#162032] border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              : isQemuMissing
              ? "bg-[#F43F5E]/15 hover:bg-[#F43F5E]/25 border-[#F43F5E]/45 text-rose-700 dark:text-rose-300 font-semibold"
              : isAllOk
              ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
              : "bg-amber-500/12 hover:bg-amber-500/22 border-amber-500/35 text-amber-700 dark:text-[#F59E0B]"
          }`}
        >
          {envLoading ? (
            <Activity className="w-3.5 h-3.5 animate-pulse" />
          ) : isQemuMissing ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[#F43F5E]" />
          ) : isAllOk ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
          )}
          <span
            className={`${
              isQemuMissing ? "inline" : "hidden xl:inline"
            } font-mono text-[11px]`}
          >
            {envLoading
              ? "Checking…"
              : isQemuMissing
              ? "QEMU Missing"
              : isAllOk
              ? `Ready (${envReport.okCount}/${envReport.checks.length})`
              : `QEMU OK • ${envReport?.warningCount ?? 0} opt`}
          </span>
        </button>

        {/* macOS Segmented Theme Switcher: System | Light | Dark */}
        <div
          className="flex items-center bg-slate-100 dark:bg-[#162032] p-0.5 rounded-lg border border-slate-200/80 dark:border-[rgba(34,211,238,0.14)]"
          role="group"
          aria-label="Theme mode"
        >
          {(
            [
              { id: "system", label: "System theme", icon: Laptop },
              { id: "light", label: "Light theme", icon: Sun },
              { id: "dark", label: "Dark theme (Woven Patchbay)", icon: Moon },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = themePreference === id;
            return (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => onChangeTheme(id)}
                className={`p-1.5 rounded-md transition-colors ${
                  active
                    ? "bg-white dark:bg-[#090E18] text-slate-900 dark:text-[#22D3EE] shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onOpenSettingsModal}
          title="Settings, Storage & About"
          aria-label="Settings & Storage"
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#162032] dark:hover:text-[#22D3EE] transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onToggleDock}
          title={
            dockOpen
              ? "Collapse Console & Inspector Dock"
              : "Expand Console & Inspector Dock"
          }
          className={`p-1.5 rounded-md transition-colors ${
            dockOpen
              ? "bg-slate-200/70 text-slate-900 dark:bg-[#162032] dark:text-[#22D3EE]"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#162032]/80"
          }`}
        >
          <PanelBottom className="w-4 h-4" />
        </button>

        {activeLabNumber !== null && (
          <button
            type="button"
            onClick={onToggleLabDrawer}
            title={
              labDrawerOpen
                ? "Hide Interactive Lab Guide Drawer"
                : "Show Interactive Lab Guide Drawer"
            }
            className={`p-1.5 rounded-md transition-colors ${
              labDrawerOpen
                ? "bg-indigo-500/20 text-indigo-700 dark:text-[#818CF8]"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#162032]/80"
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
}
