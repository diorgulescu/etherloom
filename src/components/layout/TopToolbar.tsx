import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  FolderDown,
  FolderOpen,
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
  Waypoints,
} from "lucide-react";
import type { EnvDoctorReport, ThemePreference } from "../../types/studio";

interface TopToolbarProps {
  projectName: string;
  bundlePath: string | null;
  isDirty: boolean;
  projectBusy: boolean;
  activeLabNumber: number | null;
  labDrawerOpen: boolean;
  readyTemplateCount?: number;
  onOpenWelcomeModal: () => void;
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
  onOpenWelcomeModal,
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
  const bundleBasename = bundlePath
    ? bundlePath.split("/").filter(Boolean).pop() ?? projectName
    : `${projectName} (unsaved)`;

  return (
    <header className="h-12 shrink-0 border-b border-slate-200/80 dark:border-zinc-800/90 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md px-3 flex items-center justify-between gap-2 z-20">
      {/* Left section: Sidebar toggle, Brand, Project File Actions & Active Bundle */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={
            sidebarOpen ? "Hide Component Sidebar" : "Show Component Sidebar"
          }
          className={`p-1.5 rounded-md transition-colors ${
            sidebarOpen
              ? "bg-slate-200/70 text-slate-900 dark:bg-zinc-800 dark:text-zinc-100"
              : "text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
          }`}
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onOpenWelcomeModal}
          title="Open Etherloom Welcome Screen"
          className="flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-zinc-800 hover:opacity-85 transition-opacity"
        >
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Waypoints className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-slate-900 dark:text-zinc-100 hidden md:inline">
            Etherloom
          </span>
        </button>

        {/* Project Workspace File Controls: New | Open… | Save | Save As… */}
        <div className="flex items-center gap-0.5 bg-slate-100/90 dark:bg-zinc-800/80 p-0.5 rounded-lg border border-slate-200/70 dark:border-zinc-700/60">
          <button
            type="button"
            disabled={projectBusy}
            onClick={onNewProject}
            title="New Project Workspace"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-700/80 disabled:opacity-40 transition-colors"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-sky-500" />
            <span className="hidden lg:inline">New</span>
          </button>

          <button
            type="button"
            disabled={projectBusy}
            onClick={onOpenProject}
            title="Open .etherloom Project Folder…"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-700/80 disabled:opacity-40 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden lg:inline">Open…</span>
          </button>

          <button
            type="button"
            disabled={projectBusy}
            onClick={onSaveProject}
            title="Save topology.toml (⌘S)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-700/80 disabled:opacity-40 transition-colors"
          >
            <Save className="w-3.5 h-3.5 text-emerald-500" />
            <span className="hidden lg:inline">Save</span>
            {isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-500"
                title="Unsaved topology changes"
              />
            )}
          </button>

          <button
            type="button"
            disabled={projectBusy}
            onClick={onSaveProjectAs}
            title="Save Project As New .etherloom Bundle…"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-700/80 disabled:opacity-40 transition-colors"
          >
            <FolderDown className="w-3.5 h-3.5 text-indigo-500" />
            <span className="hidden xl:inline">Save As…</span>
          </button>
        </div>

        {/* Active Bundle Path Pill */}
        <div
          title={bundlePath ?? "Unsaved scratch workspace — click Save to persist *.etherloom"}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100/80 dark:bg-zinc-800/60 border border-slate-200/70 dark:border-zinc-700/60 text-xs text-slate-600 dark:text-zinc-300 max-w-[230px] truncate"
        >
          <span className="font-mono truncate">{bundleBasename}</span>
          {isDirty && (
            <span className="text-amber-600 dark:text-amber-400 font-bold">
              •
            </span>
          )}
        </div>
      </div>

      {/* Center section: Orchestration controls */}
      <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-zinc-800/80 p-1 rounded-lg border border-slate-200/70 dark:border-zinc-700/60 shrink-0">
        <button
          type="button"
          onClick={onToggleLabRunning}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            labRunning
              ? "bg-emerald-600 text-white shadow-sm"
              : "hover:bg-white dark:hover:bg-zinc-700/70 text-slate-700 dark:text-zinc-200"
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
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 dark:text-zinc-300 enabled:hover:bg-white dark:enabled:hover:bg-zinc-700/70 disabled:opacity-40 transition-colors"
        >
          <Square className="w-3 h-3 fill-current" />
          <span>Stop</span>
        </button>
      </div>

      {/* Right section: OS Library, Academy Browser, Env Doctor Status Pill, Theme Selector, Settings, Docks */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenStorageLibraryModal}
          title="Open Storage & 15-OS Library Manager (Download / Import / External SSD)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/30 text-sky-700 dark:text-sky-300 transition-colors"
        >
          <HardDriveDownload className="w-3.5 h-3.5" />
          <span>OS Library</span>
          {readyTemplateCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-sky-500/20 text-sky-800 dark:text-sky-200">
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
              ? "bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white shadow-xs"
              : "bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 text-indigo-700 dark:text-indigo-300"
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
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            envLoading
              ? "bg-slate-100 dark:bg-zinc-800 border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300"
              : isAllOk
              ? "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/35 text-amber-700 dark:text-amber-300"
          }`}
        >
          {envLoading ? (
            <Activity className="w-3.5 h-3.5 animate-pulse" />
          ) : isAllOk ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          )}
          <span className="hidden xl:inline">
            {envLoading
              ? "Checking Host…"
              : isAllOk
              ? `Ready (${envReport.okCount}/${envReport.checks.length})`
              : `Env Doctor (${envReport?.warningCount ?? 0})`}
          </span>
        </button>

        {/* macOS Segmented Theme Switcher: System | Light | Dark */}
        <div
          className="flex items-center bg-slate-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-slate-200/80 dark:border-zinc-700/70"
          role="group"
          aria-label="Theme mode"
        >
          {(
            [
              { id: "system", label: "System theme", icon: Laptop },
              { id: "light", label: "Light theme", icon: Sun },
              { id: "dark", label: "Dark theme", icon: Moon },
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
                    ? "bg-white dark:bg-zinc-700 text-slate-900 dark:text-zinc-100 shadow-sm"
                    : "text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200"
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
          title="Settings & Storage"
          aria-label="Settings & Storage"
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100 transition-colors"
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
              ? "bg-slate-200/70 text-slate-900 dark:bg-zinc-800 dark:text-zinc-100"
              : "text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
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
                ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
}
