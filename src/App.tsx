import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import type { EtherloomFlowNode } from "./components/canvas/EtherloomNode";
import type { EtherloomWireEdgeType } from "./components/canvas/EtherloomWireEdge";
import { AcademyModal } from "./components/academy/AcademyModal";
import { LabGuideDrawer } from "./components/academy/LabGuideDrawer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  BottomDock,
  type ActiveWorkspaceTabId,
} from "./components/layout/BottomDock";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TopToolbar } from "./components/layout/TopToolbar";
import {
  QemuMissingBanner,
  evaluateQemuHostStatus,
} from "./components/layout/QemuMissingBanner";
import { VolumeDisconnectedBanner } from "./components/layout/VolumeDisconnectedBanner";
import { WorkspaceCanvas } from "./components/layout/WorkspaceCanvas";
import {
  ActivityMonitorModal,
  type ActivityMonitorNodeInput,
} from "./components/modals/ActivityMonitorModal";
import {
  CustomVmWizardModal,
  type CustomVmWizardSubmission,
} from "./components/modals/CustomVmWizardModal";
import { DependencyCheckModal } from "./components/modals/DependencyCheckModal";
import { NewProjectModal } from "./components/modals/NewProjectModal";
import {
  NodeConfigModal,
  type ConfigTab,
} from "./components/modals/NodeConfigModal";
import {
  SettingsModal,
  type SettingsSectionId,
} from "./components/modals/SettingsModal";
import { StorageLibraryModal } from "./components/modals/StorageLibraryModal";
import { WelcomeModal } from "./components/modals/WelcomeModal";
import { useTheme } from "./hooks/useTheme";
import {
  createNewProject,
  exportPcapCopy,
  fabricRemoveLink,
  fabricUpdateLink,
  fallbackToDefaultStorage,
  fetchComponentCatalog,
  fetchEnvStatus,
  getStorageState,
  getTcpflowyStatus,
  installOrUpgradeTcpflowy,
  instantiateAcademyLab,
  isTauriRuntime,
  listAcademyLabs,
  listBaseTemplates,
  listOsProfiles,
  listProjectCaptures,
  listVms,
  onFabricMetrics,
  onStorageMigrationProgress,
  onStorageStatusChanged,
  onTcpflowyInstallProgress,
  onVmStateChanged,
  openPcapInWireshark,
  openProject,
  pickOpenProjectDialog,
  pickSavePcapDialog,
  pickSaveProjectDialog,
  retryStorageDetection,
  revealPcapInFinder,
  saveProject,
  startLiveWireshark,
  startPcapRecording,
  startTopologyVmNode,
  stopLiveWireshark,
  stopVm,
  stopWireCapture,
  syncTopologyFabric,
  updateStorageLocation,
  writeSerialCommand,
} from "./services/tauriBridge";
import {
  createDefaultDhcpServerConfig,
  createDefaultNatGatewayConfig,
  type AcademyLabDetail,
  type AcademyLabSummary,
  type BaseTemplateInfo,
  type CaptureFileInfo,
  type CatalogComponent,
  type ConsoleTabSession,
  type EnvDoctorReport,
  type GuestFamily,
  type NodeRunStatus,
  type OsCatalogEntryDto,
  type OsProfile,
  type PortLinkState,
  type StorageMigrationProgress,
  type StorageStateSnapshot,
  type TcpflowyEnvStatus,
  type TcpflowyInstallProgress,
  type TopologyNodeData,
  type UpdateStorageRequest,
  type VmConsoleSubMode,
  type VmDisplayMode,
  type VmInstanceInfo,
  type WireEdgeData,
} from "./types/studio";
import {
  buildNodePorts,
  flowNodeToWorkspaceNode,
  flowToTopologyDocument,
  resolveTemplateProfileMismatch,
  topologyDocumentToFlow,
} from "./utils/topology";

function createInitialDemoTopology(): {
  nodes: EtherloomFlowNode[];
  edges: EtherloomWireEdgeType[];
} {
  const fwPorts = buildNodePorts({
    nodeId: "node-fw1",
    kind: "vm",
    guestFamily: "openbsd",
    count: 3,
    seed: 0x1001,
  });
  fwPorts[0].ipLabel = "10.0.1.1/24";

  const swPorts = buildNodePorts({
    nodeId: "node-sw-core",
    kind: "l2_switch",
    guestFamily: null,
    count: 8,
    seed: 0x2001,
  });

  const srvPorts = buildNodePorts({
    nodeId: "node-srv1",
    kind: "vm",
    guestFamily: "linux",
    count: 2,
    seed: 0x3001,
  });
  srvPorts[0].ipLabel = "10.0.1.10/24";

  const bsdPorts = buildNodePorts({
    nodeId: "node-bsd1",
    kind: "vm",
    guestFamily: "freebsd",
    count: 2,
    seed: 0x4001,
  });
  bsdPorts[0].ipLabel = "10.0.1.20/24";

  const nodes: EtherloomFlowNode[] = [
    {
      id: "node-fw1",
      type: "etherloomNode",
      position: { x: 70, y: 145 },
      data: {
        label: "fw1",
        kind: "vm",
        guestFamily: "openbsd",
        osProfileId: "openbsd",
        templateId: null,
        diskSizeGb: 8,
        notes: "pf + bgpd gateway",
        status: "stopped",
        vcpus: 2,
        memoryMb: 512,
        displayMode: "vnc",
        ports: fwPorts,
      },
    },
    {
      id: "node-sw-core",
      type: "etherloomNode",
      position: { x: 390, y: 135 },
      data: {
        label: "sw-core",
        kind: "l2_switch",
        guestFamily: null,
        osProfileId: null,
        templateId: null,
        notes: "802.1D bridge",
        status: "stopped",
        vcpus: null,
        memoryMb: null,
        displayMode: "vnc",
        ports: swPorts,
      },
    },
    {
      id: "node-srv1",
      type: "etherloomNode",
      position: { x: 720, y: 65 },
      data: {
        label: "srv1",
        kind: "vm",
        guestFamily: "linux",
        osProfileId: "alpine-linux",
        templateId: null,
        diskSizeGb: 4,
        notes: "Alpine service host",
        status: "stopped",
        vcpus: 1,
        memoryMb: 256,
        displayMode: "vnc",
        ports: srvPorts,
      },
    },
    {
      id: "node-bsd1",
      type: "etherloomNode",
      position: { x: 720, y: 245 },
      data: {
        label: "bsd1",
        kind: "vm",
        guestFamily: "freebsd",
        osProfileId: "freebsd",
        templateId: null,
        diskSizeGb: 12,
        notes: "FreeBSD VNET host",
        status: "stopped",
        vcpus: 2,
        memoryMb: 512,
        displayMode: "vnc",
        ports: bsdPorts,
      },
    },
  ];

  const makeWire = (
    id: string,
    srcNode: string,
    srcPortId: string,
    srcLabel: string,
    dstNode: string,
    dstPortId: string,
    dstLabel: string
  ): EtherloomWireEdgeType => ({
    id,
    type: "etherloomWire",
    source: srcNode,
    target: dstNode,
    sourceHandle: srcPortId,
    targetHandle: dstPortId,
    data: {
      sourcePortId: srcPortId,
      sourcePortLabel: srcLabel,
      targetPortId: dstPortId,
      targetPortLabel: dstLabel,
      adminUp: true,
      latencyMs: 0,
      jitterMs: 0,
      lossPercent: 0,
      capturingPcap: false,
      pps: 0,
      bytesPerSec: 0,
      txPackets: 0,
      rxPackets: 0,
      droppedPackets: 0,
    },
  });

  const edges: EtherloomWireEdgeType[] = [
    makeWire(
      "link-fw1-sw",
      "node-fw1",
      "node-fw1-p0",
      "vio0",
      "node-sw-core",
      "node-sw-core-p0",
      "p1"
    ),
    makeWire(
      "link-sw-srv1",
      "node-sw-core",
      "node-sw-core-p1",
      "p2",
      "node-srv1",
      "node-srv1-p0",
      "eth0"
    ),
    makeWire(
      "link-sw-bsd1",
      "node-sw-core",
      "node-sw-core-p2",
      "p3",
      "node-bsd1",
      "node-bsd1-p0",
      "vtnet0"
    ),
  ];

  return { nodes, edges };
}

const INITIAL_DEMO = createInitialDemoTopology();

export function App() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  // Studio Panels & Modals
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockFloating, setDockFloating] = useState(false);
  const [consoleTabs, setConsoleTabs] = useState<ConsoleTabSession[]>([
    { nodeId: "node-fw1", mode: "serial" },
  ]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<ActiveWorkspaceTabId>("vm:node-fw1");
  const [doctorModalOpen, setDoctorModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSectionId>("storage");
  const [storageLibraryOpen, setStorageLibraryOpen] = useState(false);
  const [libraryFocusedCatalogIds, setLibraryFocusedCatalogIds] = useState<
    string[] | null
  >(null);
  const [libraryFocusedLabTitle, setLibraryFocusedLabTitle] = useState<
    string | null
  >(null);
  const [academyPromptLabId, setAcademyPromptLabId] = useState<string | null>(
    null
  );
  const [guidedSetupVms, setGuidedSetupVms] = useState<EtherloomFlowNode[]>([]);
  const [customVmWizardOpen, setCustomVmWizardOpen] = useState(false);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [configNodeId, setConfigNodeId] = useState<string | null>(null);
  const [configNodeInitialTab, setConfigNodeInitialTab] =
    useState<ConfigTab>("general");

  // Phase 5: Welcome Launchpad & Interactive Networking Academy State
  const [showWelcomeOnStartup, setShowWelcomeOnStartup] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem("etherloom:welcome-startup") !== "0";
      } catch {
        return true;
      }
    }
  );
  const [welcomeModalOpen, setWelcomeModalOpen] = useState<boolean>(
    showWelcomeOnStartup
  );
  const [academyModalOpen, setAcademyModalOpen] = useState(false);
  const [academyLabs, setAcademyLabs] = useState<AcademyLabSummary[]>([]);
  const [academyLoading, setAcademyLoading] = useState(false);
  const [launchingLabId, setLaunchingLabId] = useState<string | null>(null);
  const [activeLab, setActiveLab] = useState<AcademyLabDetail | null>(null);
  const [labDrawerOpen, setLabDrawerOpen] = useState(false);
  const [activeLabStepIndex, setActiveLabStepIndex] = useState(0);

  // Phase 4: Captures & Managed `tcpflowy` Dissector State
  const [captures, setCaptures] = useState<CaptureFileInfo[]>([]);
  const [selectedPcapPath, setSelectedPcapPath] = useState<string | null>(null);
  const [dissectNonce, setDissectNonce] = useState(0);
  const [tcpflowyStatus, setTcpflowyStatus] =
    useState<TcpflowyEnvStatus | null>(null);
  const [tcpflowyProgress, setTcpflowyProgress] =
    useState<TcpflowyInstallProgress | null>(null);
  const [installingTcpflowy, setInstallingTcpflowy] = useState(false);

  // Catalog, OS Profiles, Base Templates & Host Environment
  const [catalog, setCatalog] = useState<CatalogComponent[]>([]);
  const [osProfiles, setOsProfiles] = useState<OsProfile[]>([]);
  const [baseTemplates, setBaseTemplates] = useState<BaseTemplateInfo[]>([]);
  const [envReport, setEnvReport] = useState<EnvDoctorReport | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [qemuBannerDismissed, setQemuBannerDismissed] = useState(false);
  const [activityMonitorOpen, setActivityMonitorOpen] = useState(false);
  const prevQemuMissingRef = useRef(false);
  const lastFocusProbeMsRef = useRef(0);

  // Storage & Volume Resilience
  const [storageState, setStorageState] =
    useState<StorageStateSnapshot | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [migrationProgress, setMigrationProgress] =
    useState<StorageMigrationProgress | null>(null);

  // Active `.etherloom` Project Metadata
  const [projectName, setProjectName] = useState("Campus Dual-Stack Lab");
  const [projectNotes, setProjectNotes] = useState<string | null>(
    "OpenBSD + FreeBSD + Alpine zero-root lab"
  );
  const [projectCreatedAtMs, setProjectCreatedAtMs] = useState<number>(0);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);

  // Toast notifications
  const [toast, setToast] = useState<{
    kind: "ok" | "error";
    text: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);

  // React Flow Topology State
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<EtherloomFlowNode>(
    INITIAL_DEMO.nodes
  );
  const [edges, setEdges, onEdgesChangeBase] =
    useEdgesState<EtherloomWireEdgeType>(INITIAL_DEMO.edges);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    "node-fw1"
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [wirePopoverOpen, setWirePopoverOpen] = useState(false);

  // Previous packet counters for computing live PPS per wire
  const prevLinkStatsRef = useRef<
    Map<string, { totalPkts: number; tsMs: number }>
  >(new Map());

  // Track in-flight VM launches & user-requested Stop cancellations so UI state never gets trapped
  const startingNodesRef = useRef<Map<string, number>>(new Map());
  const cancelledStartsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback(
    (
      kind: "ok" | "error",
      text: string,
      actionLabel?: string,
      onAction?: () => void
    ) => {
      setToast({ kind, text, actionLabel, onAction });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const durationMs = toast.kind === "error" ? 9000 : 5500;
    const t = window.setTimeout(() => setToast(null), durationMs);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadDiagnostics = useCallback(
    async (forceRefresh = false) => {
      setEnvLoading(true);
      try {
        const report = await fetchEnvStatus(forceRefresh);
        const evalNow = evaluateQemuHostStatus(report);
        if (!evalNow.ready) {
          prevQemuMissingRef.current = true;
        } else if (prevQemuMissingRef.current) {
          prevQemuMissingRef.current = false;
          setQemuBannerDismissed(false);
          showToast(
            "ok",
            `QEMU detected (${evalNow.versionSummary ?? "ready"})! Host is ready to boot virtual machines.`
          );
        }
        setEnvReport(report);
      } finally {
        setEnvLoading(false);
      }
    },
    [showToast]
  );

  // Automatically re-check host binaries on window focus when QEMU was missing
  // (e.g. right after the user finishes running `brew install qemu` in Terminal!)
  useEffect(() => {
    if (!envReport) return;
    const evalStatus = evaluateQemuHostStatus(envReport);
    if (evalStatus.ready) return;

    const handleWindowFocus = () => {
      const now = Date.now();
      if (now - lastFocusProbeMsRef.current < 3000) return;
      lastFocusProbeMsRef.current = now;
      void loadDiagnostics(true);
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [envReport, loadDiagnostics]);

  const refreshAcademyLabs = useCallback(async () => {
    setAcademyLoading(true);
    try {
      const list = await listAcademyLabs();
      const normalized = Array.isArray(list)
        ? list
            .filter(
              (l): l is AcademyLabSummary =>
                Boolean(
                  l &&
                    typeof l === "object" &&
                    typeof l.id === "string" &&
                    typeof l.title === "string"
                )
            )
            .map((l) => ({
              ...l,
              tags: Array.isArray(l.tags) ? l.tags : [],
              requiredTemplates: Array.isArray(l.requiredTemplates)
                ? l.requiredTemplates
                : [],
            }))
        : [];
      setAcademyLabs(normalized);
    } catch {
      setAcademyLabs([]);
    } finally {
      setAcademyLoading(false);
    }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const tpls = await listBaseTemplates();
      setBaseTemplates(tpls);
      setNodes((curr) => {
        let changed = false;
        const next = curr.map((n) => {
          if (
            n.data.kind !== "vm" ||
            !n.data.osProfileId ||
            n.data.bootMediaPath ||
            n.data.status === "running" ||
            n.data.status === "booting"
          ) {
            return n;
          }
          const mismatched = resolveTemplateProfileMismatch(
            n.data.osProfileId,
            n.data.templateId,
            tpls
          );
          if (!n.data.templateId || mismatched) {
            const matchedTpl =
              tpls.find((t) => t.osProfileId === n.data.osProfileId)?.id ??
              null;
            const nextTplId = mismatched
              ? matchedTpl
              : matchedTpl ?? n.data.templateId;
            if ((nextTplId ?? null) !== (n.data.templateId ?? null)) {
              changed = true;
              return {
                ...n,
                data: {
                  ...n.data,
                  templateId: nextTplId,
                },
              };
            }
          }
          return n;
        });
        return changed ? next : curr;
      });
    } catch {
      setBaseTemplates([]);
    }
    void refreshAcademyLabs();
  }, [refreshAcademyLabs, setNodes]);

  const handleChangeShowWelcomeOnStartup = useCallback((show: boolean) => {
    setShowWelcomeOnStartup(show);
    try {
      localStorage.setItem("etherloom:welcome-startup", show ? "1" : "0");
    } catch {
      // Ignore private browsing / storage quota errors
    }
  }, []);

  const lastStorageSignatureRef = useRef<string>("");

  const computeStorageSignature = useCallback(
    (snap: StorageStateSnapshot | null) => {
      if (!snap) return "";
      const st =
        snap.status.state === "volumeDisconnected"
          ? `disconnected:${snap.status.volumeName}:${snap.status.expectedPath}`
          : snap.status.state === "error"
          ? `error:${snap.status.message}`
          : "ready";
      return `${snap.config.storageRoot}|${snap.config.templatesDirOverride ?? ""}|${snap.config.isosDirOverride ?? ""}|${snap.config.workspacesDirOverride ?? ""}|${st}`;
    },
    []
  );

  const loadStorage = useCallback(async () => {
    const snap = await getStorageState();
    lastStorageSignatureRef.current = computeStorageSignature(snap);
    setStorageState(snap);
  }, [computeStorageSignature]);

  // Reconciles React VM node status badges against ground-truth `VmManager::list_vms()`
  // so missed IPC events, Vite HMR reloads, or dev backend restarts never leave nodes stuck in "booting".
  const reconcileVmStates = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const vms = await listVms();
      const vmMap = new Map(vms.map((v) => [v.nodeId, v]));
      const now = Date.now();

      const resolveNodeStatus = (
        nodeId: string,
        currentStatus: NodeRunStatus
      ): NodeRunStatus => {
        const vm = vmMap.get(nodeId);
        const bootStartedAt = startingNodesRef.current.get(nodeId);
        const withinLaunchGrace =
          bootStartedAt !== undefined && now - bootStartedAt < 4500;

        if (vm) {
          if (vm.status === "running") return "running";
          if (vm.status === "starting") return "booting";
          if (vm.status === "stopping") return "stopped";
          if (withinLaunchGrace && currentStatus === "booting") {
            return "booting";
          }
          return "stopped";
        }

        if (withinLaunchGrace && currentStatus === "booting") {
          return "booting";
        }
        return "stopped";
      };

      setNodes((curr) => {
        let changed = false;
        const next = curr.map((n) => {
          if (n.data.kind !== "vm") return n;
          const effective = resolveNodeStatus(n.id, n.data.status);
          if (effective === n.data.status) return n;
          changed = true;
          return {
            ...n,
            data: {
              ...n.data,
              status: effective,
            },
          };
        });
        return changed ? next : curr;
      });

      setGuidedSetupVms((curr) => {
        let changed = false;
        const next = curr.map((g) => {
          const effective = resolveNodeStatus(g.id, g.data.status);
          if (effective === g.data.status) return g;
          changed = true;
          return {
            ...g,
            data: {
              ...g.data,
              status: effective,
            },
          };
        });
        return changed ? next : curr;
      });
    } catch {
      // Ignore transient IPC errors during app shutdown
    }
  }, [setNodes]);

  const refreshCaptures = useCallback(
    async (explicitBundle?: string | null) => {
      try {
        const list = await listProjectCaptures(
          explicitBundle !== undefined ? explicitBundle : bundlePath
        );
        setCaptures(list);
      } catch {
        setCaptures([]);
      }
    },
    [bundlePath]
  );

  useEffect(() => {
    void refreshCaptures(bundlePath);
  }, [bundlePath, refreshCaptures]);

  const refreshTcpflowyStatus = useCallback(() => {
    void getTcpflowyStatus()
      .then(setTcpflowyStatus)
      .catch(() => {});
  }, []);

  const handleInstallTcpflowy = useCallback(async () => {
    setInstallingTcpflowy(true);
    setTcpflowyProgress({
      phase: "starting",
      message: "Preparing managed python-env…",
      percent: 5,
    });
    try {
      const st = await installOrUpgradeTcpflowy();
      setTcpflowyStatus(st);
      if (st.state === "ready") {
        showToast(
          "ok",
          `tcpflowy v${st.installedVersion ?? "1.1"} is ready in python-env`
        );
      } else {
        showToast("error", st.message);
      }
    } catch (err: unknown) {
      refreshTcpflowyStatus();
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingTcpflowy(false);
      setTcpflowyProgress(null);
    }
  }, [refreshTcpflowyStatus, showToast]);

  // Initial bootstrap + Tauri event subscriptions
  useEffect(() => {
    void fetchComponentCatalog().then(setCatalog);
    void listOsProfiles().then(setOsProfiles);
    void refreshTemplates();
    void loadDiagnostics(false);
    void loadStorage();
    void reconcileVmStates();
    void getTcpflowyStatus()
      .then(setTcpflowyStatus)
      .catch(() => {});

    let disposed = false;
    let unlistenStorage: (() => void) | null = null;
    let unlistenProgress: (() => void) | null = null;
    let unlistenTcpflowyProg: (() => void) | null = null;
    let unlistenVm: (() => void) | null = null;
    let unlistenMetrics: (() => void) | null = null;

    void onStorageStatusChanged((snap) => {
      if (disposed) return;
      const nextSig = computeStorageSignature(snap);
      const changed = nextSig !== lastStorageSignatureRef.current;
      lastStorageSignatureRef.current = nextSig;
      setStorageState(snap);
      if (changed) {
        void refreshTemplates();
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlistenStorage = fn;
    });

    void onStorageMigrationProgress((prog) => {
      if (disposed) return;
      setMigrationProgress(prog);
    }).then((fn) => {
      if (disposed) fn();
      else unlistenProgress = fn;
    });

    void onTcpflowyInstallProgress((prog) => {
      if (disposed) return;
      setTcpflowyProgress(prog);
    }).then((fn) => {
      if (disposed) fn();
      else unlistenTcpflowyProg = fn;
    });

    const activeRunningVms = new Set<string>();

    void onVmStateChanged((ev) => {
      if (disposed) return;
      const wasRunning = activeRunningVms.has(ev.nodeId);
      if (ev.status === "running") {
        activeRunningVms.add(ev.nodeId);
      } else if (ev.status === "stopped" || ev.status === "crashed") {
        activeRunningVms.delete(ev.nodeId);
      }

      if (ev.status === "crashed" && wasRunning && ev.message) {
        showToast("error", `VM ${ev.nodeId} crashed: ${ev.message}`);
      }

      const mappedStatus =
        ev.status === "starting"
          ? "booting"
          : ev.status === "running"
          ? "running"
          : "stopped";

      if (ev.nodeId.startsWith("setup-")) {
        setGuidedSetupVms((curr) =>
          curr.map((vm) =>
            vm.id === ev.nodeId
              ? { ...vm, data: { ...vm.data, status: mappedStatus } }
              : vm
          )
        );
        if (ev.status === "stopped" || ev.status === "crashed") {
          void fetchComponentCatalog().then(setCatalog);
          void refreshTemplates();
          if (ev.message?.includes("Golden Template")) {
            showToast("ok", ev.message, "OS Library", () =>
              setStorageLibraryOpen(true)
            );
          }
        }
        return;
      }

      setNodes((curr) =>
        curr.map((n) => {
          if (n.id !== ev.nodeId) return n;
          return {
            ...n,
            data: {
              ...n.data,
              status: mappedStatus,
            },
          };
        })
      );
    }).then((fn) => {
      if (disposed) fn();
      else unlistenVm = fn;
    });

    void onFabricMetrics((ev) => {
      if (disposed) return;
      const linkMap = new Map(ev.links.map((l) => [l.id, l]));
      setEdges((curr) => {
        let changed = false;
        const next = curr.map((edge) => {
          const snap = linkMap.get(edge.id);
          if (!snap || !edge.data) return edge;
          const totalPkts = snap.txPackets + snap.rxPackets;
          const prev = prevLinkStatsRef.current.get(edge.id);
          let pps = 0;
          if (prev && ev.timestampMs > prev.tsMs) {
            const dtSec = (ev.timestampMs - prev.tsMs) / 1000;
            if (dtSec > 0) {
              pps = Math.max(
                0,
                Math.round((totalPkts - prev.totalPkts) / dtSec)
              );
            }
          }
          prevLinkStatsRef.current.set(edge.id, {
            totalPkts,
            tsMs: ev.timestampMs,
          });

          const nextCapturing = snap.capturingPcap ?? false;
          const nextCapturedPkts = snap.capturedPackets ?? 0;
          const nextCapturedBytes = snap.capturedBytes ?? 0;
          const nextActivePcap = snap.activePcapPath ?? null;
          const nextCaptureStartedAtMs = nextCapturing
            ? snap.captureStartedAtMs ?? edge.data.captureStartedAtMs ?? null
            : null;
          const nextLiveWs = snap.liveWireshark ?? false;

          if (
            edge.data.pps === pps &&
            edge.data.bytesPerSec === snap.bytesPerSec &&
            edge.data.txPackets === snap.txPackets &&
            edge.data.rxPackets === snap.rxPackets &&
            edge.data.droppedPackets === snap.droppedPackets &&
            Boolean(edge.data.capturingPcap) === nextCapturing &&
            (edge.data.capturedPackets ?? 0) === nextCapturedPkts &&
            (edge.data.capturedBytes ?? 0) === nextCapturedBytes &&
            (edge.data.activePcapPath ?? null) === nextActivePcap &&
            (edge.data.captureStartedAtMs ?? null) === nextCaptureStartedAtMs &&
            Boolean(edge.data.liveWireshark) === nextLiveWs
          ) {
            return edge;
          }

          changed = true;
          return {
            ...edge,
            data: {
              ...edge.data,
              pps,
              bytesPerSec: snap.bytesPerSec,
              txPackets: snap.txPackets,
              rxPackets: snap.rxPackets,
              droppedPackets: snap.droppedPackets,
              capturingPcap: nextCapturing,
              capturedPackets: nextCapturedPkts,
              capturedBytes: nextCapturedBytes,
              activePcapPath: nextActivePcap,
              captureStartedAtMs: nextCaptureStartedAtMs,
              liveWireshark: nextLiveWs,
            },
          };
        });
        return changed ? next : curr;
      });
    }).then((fn) => {
      if (disposed) fn();
      else unlistenMetrics = fn;
    });

    return () => {
      disposed = true;
      unlistenStorage?.();
      unlistenProgress?.();
      unlistenTcpflowyProg?.();
      unlistenVm?.();
      unlistenMetrics?.();
    };
  }, [
    computeStorageSignature,
    loadDiagnostics,
    loadStorage,
    reconcileVmStates,
    refreshTemplates,
    setEdges,
    setNodes,
  ]);

  // Periodically & on window focus reconcile VM statuses whenever any VM is booting or running
  const anyVmActiveOrBooting = useMemo(
    () =>
      nodes.some(
        (n) =>
          n.data.kind === "vm" &&
          (n.data.status === "booting" || n.data.status === "running")
      ) ||
      guidedSetupVms.some(
        (g) => g.data.status === "booting" || g.data.status === "running"
      ),
    [guidedSetupVms, nodes]
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const onFocus = () => {
      void reconcileVmStates();
    };
    window.addEventListener("focus", onFocus);
    let timer: number | null = null;
    if (anyVmActiveOrBooting) {
      timer = window.setInterval(() => {
        void reconcileVmStates();
      }, 2500);
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [anyVmActiveOrBooting, reconcileVmStates]);

  // Keep PacketFabric switches, hubs, DHCP/NAT appliances, UDP endpoints, and wires synchronized when topology or appliance config changes
  const structuralKey = useMemo(() => {
    const nk = nodes
      .map(
        (n) =>
          `${n.id}:${n.data.kind}:${n.data.ports
            .map((p) => p.id)
            .join(",")}:${JSON.stringify(
            n.data.dhcpConfig ?? null
          )}:${JSON.stringify(n.data.natConfig ?? null)}`
      )
      .join("|");
    const ek = edges
      .map(
        (e) =>
          `${e.id}:${e.data?.sourcePortId}:${e.data?.targetPortId}:${e.data?.adminUp}:${e.data?.latencyMs}:${e.data?.jitterMs}:${e.data?.lossPercent}`
      )
      .join("|");
    return `${nk}__${ek}`;
  }, [nodes, edges]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const doc = flowToTopologyDocument({
      name: projectName,
      notes: projectNotes,
      createdAtMs: projectCreatedAtMs,
      nodes,
      edges,
    });
    void syncTopologyFabric(doc, false).catch(() => {
      // Non-fatal if a port is temporarily busy
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey]);

  // Storage resilience handlers
  const handleRetryStorage = useCallback(async () => {
    setStorageBusy(true);
    try {
      const snap = await retryStorageDetection();
      lastStorageSignatureRef.current = computeStorageSignature(snap);
      setStorageState(snap);
      void refreshTemplates();
      void loadDiagnostics(true);
    } finally {
      setStorageBusy(false);
    }
  }, [computeStorageSignature, loadDiagnostics, refreshTemplates]);

  const handleFallbackInternalStorage = useCallback(async () => {
    setStorageBusy(true);
    try {
      const snap = await fallbackToDefaultStorage();
      lastStorageSignatureRef.current = computeStorageSignature(snap);
      setStorageState(snap);
      void refreshTemplates();
      void loadDiagnostics(true);
    } finally {
      setStorageBusy(false);
    }
  }, [computeStorageSignature, loadDiagnostics, refreshTemplates]);

  const handleApplyStorageUpdate = useCallback(
    async (request: UpdateStorageRequest) => {
      setMigrationProgress(null);
      try {
        const res = await updateStorageLocation(request);
        lastStorageSignatureRef.current = computeStorageSignature(res.snapshot);
        setStorageState(res.snapshot);
        void refreshTemplates();
        void loadDiagnostics(true);
        return res;
      } finally {
        setMigrationProgress(null);
      }
    },
    [computeStorageSignature, loadDiagnostics, refreshTemplates]
  );

  const handleCloseVmConsoleTab = useCallback((nodeId: string) => {
    setConsoleTabs((prev) => {
      const remaining = prev.filter((t) => t.nodeId !== nodeId);
      setActiveWorkspaceTab((curr) => {
        if (curr !== `vm:${nodeId}`) return curr;
        return remaining.length > 0
          ? `vm:${remaining[remaining.length - 1].nodeId}`
          : "link";
      });
      return remaining;
    });
  }, []);

  // Track dirty state on node drag/delete and edge delete
  const handleNodesChange = useCallback(
    (changes: NodeChange<EtherloomFlowNode>[]) => {
      for (const ch of changes) {
        if (ch.type === "remove") {
          handleCloseVmConsoleTab(ch.id);
        }
      }
      onNodesChangeBase(changes);
      if (
        changes.some(
          (c) =>
            (c.type === "position" && !c.dragging) || c.type === "remove"
        )
      ) {
        setIsDirty(true);
      }
    },
    [handleCloseVmConsoleTab, onNodesChangeBase]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<EtherloomWireEdgeType>[]) => {
      for (const ch of changes) {
        if (ch.type === "remove") {
          void fabricRemoveLink(ch.id).catch(() => {});
          setIsDirty(true);
        }
      }
      onEdgesChangeBase(changes);
    },
    [onEdgesChangeBase]
  );

  // Interactive Port-to-Port Cabling
  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) return;
      if (source === target) return;

      const srcNode = nodes.find((n) => n.id === source);
      const dstNode = nodes.find((n) => n.id === target);
      if (!srcNode || !dstNode) return;

      const srcPort = srcNode.data.ports.find((p) => p.id === sourceHandle);
      const dstPort = dstNode.data.ports.find((p) => p.id === targetHandle);
      if (!srcPort || !dstPort) return;

      const newEdgeId = `link-${Date.now().toString(36)}-${Math.floor(
        Math.random() * 999
      )}`;
      const newEdge: EtherloomWireEdgeType = {
        id: newEdgeId,
        type: "etherloomWire",
        source,
        target,
        sourceHandle,
        targetHandle,
        data: {
          sourcePortId: srcPort.id,
          sourcePortLabel: srcPort.label,
          targetPortId: dstPort.id,
          targetPortLabel: dstPort.label,
          adminUp: true,
          latencyMs: 0,
          jitterMs: 0,
          lossPercent: 0,
          capturingPcap: false,
          pps: 0,
          bytesPerSec: 0,
          txPackets: 0,
          rxPackets: 0,
          droppedPackets: 0,
        },
      };

      setEdges((eds) => [...eds, newEdge]);
      setSelectedEdgeId(newEdgeId);
      setWirePopoverOpen(true);
      setIsDirty(true);
    },
    [nodes, setEdges]
  );

  const handleUpdateEdgeData = useCallback(
    (edgeId: string, patch: Partial<WireEdgeData>) => {
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edgeId || !e.data) return e;
          return {
            ...e,
            data: {
              ...e.data,
              ...patch,
            },
          };
        })
      );
      setIsDirty(true);

      if (
        patch.adminUp !== undefined ||
        patch.latencyMs !== undefined ||
        patch.jitterMs !== undefined ||
        patch.lossPercent !== undefined
      ) {
        void fabricUpdateLink({
          linkId: edgeId,
          adminUp: patch.adminUp,
          latencyMs: patch.latencyMs,
          jitterMs: patch.jitterMs,
          lossPercent: patch.lossPercent,
        }).catch(() => {});
      }
    },
    [setEdges]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
        setWirePopoverOpen(false);
      }
      setIsDirty(true);
      void fabricRemoveLink(edgeId).catch(() => {});
    },
    [selectedEdgeId, setEdges]
  );

  // Phase 4 & Phase 9: Zero-Root `.pcap` Recording, Atomic Finalization,
  // Stop & Save PCAP..., Stop & Open in Wireshark, Stop & Dissect (tcpflowy), & Live FIFO
  const stopCaptureOnEdge = useCallback(
    async (edgeId: string) => {
      const stopped = await stopWireCapture(edgeId);
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId && e.data
            ? {
                ...e,
                data: {
                  ...e.data,
                  capturingPcap: false,
                  activePcapPath: null,
                  captureStartedAtMs: null,
                },
              }
            : e
        )
      );
      await refreshCaptures();
      setSelectedPcapPath(stopped.filePath);
      return stopped;
    },
    [refreshCaptures, setEdges]
  );

  const handleStartPcapRecording = useCallback(
    async (edgeId: string) => {
      const targetEdge = edges.find((e) => e.id === edgeId);
      if (!targetEdge || !targetEdge.data || targetEdge.data.capturingPcap) {
        return;
      }

      const srcName =
        nodes.find((n) => n.id === targetEdge.source)?.data.label ??
        targetEdge.source;
      const dstName =
        nodes.find((n) => n.id === targetEdge.target)?.data.label ??
        targetEdge.target;
      const endpointA = `${srcName}-${targetEdge.data.sourcePortLabel}`;
      const endpointB = `${dstName}-${targetEdge.data.targetPortLabel}`;
      const linkLabel = `${endpointA}__${endpointB}`;

      try {
        const started = await startPcapRecording(
          bundlePath,
          edgeId,
          linkLabel,
          endpointA,
          endpointB
        );
        setEdges((eds) =>
          eds.map((e) =>
            e.id === edgeId && e.data
              ? {
                  ...e,
                  data: {
                    ...e.data,
                    capturingPcap: true,
                    capturedPackets: 0,
                    capturedBytes: 24,
                    activePcapPath: started.path,
                    captureStartedAtMs: started.startedAtMs || Date.now(),
                  },
                }
              : e
          )
        );
        await refreshCaptures();
        showToast("ok", `Recording wire to ${started.filename}`);
      } catch (err: unknown) {
        showToast("error", err instanceof Error ? err.message : String(err));
      }
    },
    [bundlePath, edges, nodes, refreshCaptures, setEdges, showToast]
  );

  const handleStopAndSavePcap = useCallback(
    async (edgeId: string) => {
      try {
        // 1. Always finalize & fsync canonical .pcap inside workspace `captures/` first
        const stopped = await stopCaptureOnEdge(edgeId);
        setWirePopoverOpen(false);

        // 2. Open native macOS Save dialog pre-populated with `<nodeA>-<nicA>__<nodeB>-<nicB>__<timestamp>.pcap`
        const destPath = await pickSavePcapDialog(stopped.filename);
        if (!destPath) {
          showToast(
            "ok",
            `Capture stored in project Captures (${stopped.packetCount} packets)`,
            "Captures",
            () => {
              setActiveWorkspaceTab("tcpflowy");
              setDockOpen(true);
            }
          );
          return;
        }

        // 3. Export atomic copy to user-chosen location on macOS
        await exportPcapCopy(stopped.filePath, destPath);
        showToast(
          "ok",
          `Capture saved (${stopped.packetCount} packets)`,
          "Reveal in Finder",
          () => {
            void revealPcapInFinder(destPath).catch((err: unknown) => {
              showToast(
                "error",
                err instanceof Error ? err.message : String(err)
              );
            });
          }
        );
      } catch (err: unknown) {
        showToast("error", err instanceof Error ? err.message : String(err));
      }
    },
    [showToast, stopCaptureOnEdge]
  );

  const handleStopAndOpenWireshark = useCallback(
    async (edgeId: string) => {
      try {
        const stopped = await stopCaptureOnEdge(edgeId);
        setWirePopoverOpen(false);
        await openPcapInWireshark(stopped.filePath);
        showToast(
          "ok",
          `Opened ${stopped.filename} (${stopped.packetCount} packets) in Wireshark`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("wireshark")) {
          showToast("error", msg, "Env Doctor", () => setDoctorModalOpen(true));
        } else {
          showToast("error", msg);
        }
      }
    },
    [showToast, stopCaptureOnEdge]
  );

  const handleStopAndDissect = useCallback(
    async (edgeId: string) => {
      try {
        const stopped = await stopCaptureOnEdge(edgeId);
        setDissectNonce((n) => n + 1);
        setActiveWorkspaceTab("tcpflowy");
        setDockOpen(true);
        setWirePopoverOpen(false);
        showToast(
          "ok",
          `Stopped ${stopped.filename} (${stopped.packetCount} pkts) — dissecting with tcpflowy…`
        );
      } catch (err: unknown) {
        showToast("error", err instanceof Error ? err.message : String(err));
      }
    },
    [showToast, stopCaptureOnEdge]
  );

  const handleTogglePcapRecording = useCallback(
    async (edgeId: string) => {
      const targetEdge = edges.find((e) => e.id === edgeId);
      if (!targetEdge || !targetEdge.data) return;

      if (targetEdge.data.capturingPcap) {
        try {
          const stopped = await stopCaptureOnEdge(edgeId);
          showToast(
            "ok",
            `Saved ${stopped.filename} (${stopped.packetCount} pkts)`,
            "Dissect",
            () => {
              setSelectedPcapPath(stopped.filePath);
              setDissectNonce((n) => n + 1);
              setActiveWorkspaceTab("tcpflowy");
              setDockOpen(true);
            }
          );
        } catch (err: unknown) {
          showToast("error", err instanceof Error ? err.message : String(err));
        }
        return;
      }

      await handleStartPcapRecording(edgeId);
    },
    [edges, handleStartPcapRecording, showToast, stopCaptureOnEdge]
  );

  const handleToggleLiveWireshark = useCallback(
    async (edgeId: string) => {
      const targetEdge = edges.find((e) => e.id === edgeId);
      if (!targetEdge || !targetEdge.data) return;

      if (targetEdge.data.liveWireshark) {
        try {
          await stopLiveWireshark(edgeId);
          setEdges((eds) =>
            eds.map((e) =>
              e.id === edgeId && e.data
                ? { ...e, data: { ...e.data, liveWireshark: false } }
                : e
            )
          );
          showToast("ok", "Closed live Wireshark FIFO stream");
        } catch (err: unknown) {
          showToast("error", err instanceof Error ? err.message : String(err));
        }
        return;
      }

      try {
        const session = await startLiveWireshark(edgeId);
        setEdges((eds) =>
          eds.map((e) =>
            e.id === edgeId && e.data
              ? { ...e, data: { ...e.data, liveWireshark: true } }
              : e
          )
        );
        showToast(
          "ok",
          `Streaming live frames into Wireshark via ${session.fifoPath}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("wireshark")) {
          showToast("error", msg, "Env Doctor", () => setDoctorModalOpen(true));
        } else {
          showToast("error", msg);
        }
      }
    },
    [edges, setEdges, showToast]
  );

  // Node Start/Stop, Console & Settings Quick Actions
  const handleToggleNodeRun = useCallback(
    async (nodeId: string) => {
      if (nodeId.startsWith("setup-")) {
        try {
          await stopVm(nodeId, false);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.toLowerCase().includes("not found")) {
            showToast("error", msg);
          }
        } finally {
          setGuidedSetupVms((curr) =>
            curr.map((vm) =>
              vm.id === nodeId
                ? { ...vm, data: { ...vm.data, status: "stopped" } }
                : vm
            )
          );
        }
        return;
      }
      const target = nodes.find((n) => n.id === nodeId);
      if (!target || target.data.kind !== "vm") return;

      const currentlyUp =
        target.data.status === "running" || target.data.status === "booting";

      if (!isTauriRuntime()) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: currentlyUp ? "stopped" : "running",
                  },
                }
              : n
          )
        );
        return;
      }

      if (currentlyUp) {
        cancelledStartsRef.current.add(nodeId);
        startingNodesRef.current.delete(nodeId);
        try {
          await stopVm(nodeId, false);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.toLowerCase().includes("not found")) {
            showToast("error", msg);
          }
        } finally {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "stopped" } }
                : n
            )
          );
        }
        return;
      }

      if (startingNodesRef.current.has(nodeId)) {
        return;
      }
      cancelledStartsRef.current.delete(nodeId);
      startingNodesRef.current.set(nodeId, Date.now());

      // Transition to booting & spawn via QEMU HVF supervisor
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, status: "booting" } }
            : n
        )
      );

      try {
        const vmInfo = await startTopologyVmNode(
          bundlePath,
          flowNodeToWorkspaceNode(target)
        );
        const wasStoppedOrCancelled =
          cancelledStartsRef.current.has(nodeId) ||
          vmInfo.status === "stopped" ||
          vmInfo.status === "crashed";
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: wasStoppedOrCancelled ? "stopped" : "running",
                  },
                }
              : n
          )
        );
      } catch (err) {
        const wasCancelled = cancelledStartsRef.current.has(nodeId);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "stopped" } }
              : n
          )
        );
        if (!wasCancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          const profId = target.data.osProfileId;
          const hasMatchingTemplate = profId
            ? baseTemplates.some((t) => t.osProfileId === profId)
            : baseTemplates.length > 0;
          if (msg.includes("OS Library") && !hasMatchingTemplate) {
            showToast("error", msg, "Open OS Library", () => {
              setLibraryFocusedCatalogIds(profId ? [profId] : null);
              setLibraryFocusedLabTitle(null);
              setStorageLibraryOpen(true);
            });
          } else if (msg.includes("Node Settings")) {
            showToast("error", msg, "Configure Storage", () => {
              setConfigNodeInitialTab("storage");
              setConfigNodeId(nodeId);
            });
          } else if (msg.toLowerCase().includes("qemu")) {
            showToast("error", msg, "Env Doctor", () =>
              setDoctorModalOpen(true)
            );
          } else {
            showToast("error", msg);
          }
        }
      } finally {
        startingNodesRef.current.delete(nodeId);
        cancelledStartsRef.current.delete(nodeId);
      }
    },
    [baseTemplates, bundlePath, nodes, setNodes, showToast]
  );

  const handleOpenVmConsoleTab = useCallback(
    (nodeId: string, preferredMode?: VmConsoleSubMode) => {
      const target = nodes.find((n) => n.id === nodeId);
      setSelectedNodeId(nodeId);
      if (!target || target.data.kind !== "vm") {
        setConfigNodeId(nodeId);
        return;
      }

      const defaultMode: VmConsoleSubMode =
        target.data.bootMediaPath && !target.data.templateId
          ? "display"
          : "serial";

      setConsoleTabs((prev) => {
        const existing = prev.find((t) => t.nodeId === nodeId);
        if (existing) {
          if (!preferredMode || existing.mode === preferredMode) {
            return prev;
          }
          return prev.map((t) =>
            t.nodeId === nodeId ? { ...t, mode: preferredMode } : t
          );
        }
        return [...prev, { nodeId, mode: preferredMode ?? defaultMode }];
      });

      setActiveWorkspaceTab(`vm:${nodeId}`);
      setDockOpen(true);
    },
    [nodes]
  );

  const handleOpenNodeConsole = useCallback(
    (nodeId: string, mode: "serial" | "display" = "serial") => {
      handleOpenVmConsoleTab(nodeId, mode);
    },
    [handleOpenVmConsoleTab]
  );

  const handleOpenNodeSettings = useCallback(
    (nodeId: string, initialTab: ConfigTab = "general") => {
      setSelectedNodeId(nodeId);
      setConfigNodeInitialTab(initialTab);
      setConfigNodeId(nodeId);
    },
    []
  );

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (target?.data.kind === "vm") {
        handleOpenVmConsoleTab(nodeId);
      } else {
        handleOpenNodeSettings(nodeId);
      }
    },
    [handleOpenNodeSettings, handleOpenVmConsoleTab, nodes]
  );

  const handleChangeVmTabMode = useCallback(
    (nodeId: string, mode: VmConsoleSubMode) => {
      setConsoleTabs((prev) =>
        prev.map((t) => (t.nodeId === nodeId ? { ...t, mode } : t))
      );
    },
    []
  );

  const labRunning = useMemo(
    () =>
      nodes.some(
        (n) =>
          n.data.kind === "vm" &&
          (n.data.status === "running" || n.data.status === "booting")
      ),
    [nodes]
  );

  const handleToggleLabRunning = useCallback(async () => {
    const vmNodes = nodes.filter((n) => n.data.kind === "vm");
    if (labRunning) {
      for (const vm of vmNodes) {
        if (vm.data.status === "running" || vm.data.status === "booting") {
          void handleToggleNodeRun(vm.id);
        }
      }
    } else {
      for (const vm of vmNodes) {
        if (vm.data.status === "stopped") {
          await handleToggleNodeRun(vm.id);
        }
      }
    }
  }, [handleToggleNodeRun, labRunning, nodes]);

  // Adding Palette Items (Click or Drag-and-Drop)
  const handleAddComponent = useCallback(
    (component: CatalogComponent, dropPos?: { x: number; y: number }) => {
      setNodes((current) => {
        const index = current.length + 1;
        const shortBase =
          component.kind === "l2_switch"
            ? "sw"
            : component.kind === "l1_hub"
            ? "hub"
            : component.kind === "dhcp_server"
            ? "dhcp"
            : component.kind === "nat_gateway"
            ? "wan"
            : component.osProfileId?.split("-")[0] ??
              component.guestFamily ??
              "vm";
        const label = `${shortBase}${index}`;
        const nodeId = `node-${label}-${Date.now().toString(36).slice(-4)}`;
        const nicModel =
          component.kind === "vm"
            ? component.defaultNicModel ?? "virtio-net-pci"
            : null;

        const matchedTpl =
          component.kind === "vm" && component.osProfileId
            ? baseTemplates.find((t) => t.osProfileId === component.osProfileId)
            : undefined;

        const newNode: EtherloomFlowNode = {
          id: nodeId,
          type: "etherloomNode",
          position: dropPos ?? {
            x: 210 + ((index * 60) % 360),
            y: 110 + ((index * 50) % 240),
          },
          data: {
            label,
            kind: component.kind,
            guestFamily: component.guestFamily,
            osProfileId: component.osProfileId ?? null,
            arch:
              component.kind === "vm" ? component.arch ?? "aarch64" : null,
            nicModel,
            firmware:
              component.kind === "vm"
                ? component.defaultFirmware ?? "uefi"
                : null,
            diskBus:
              component.kind === "vm"
                ? component.defaultDiskBus ?? "virtio-blk"
                : null,
            templateId: matchedTpl?.id ?? null,
            diskSizeGb: 8,
            status: "stopped",
            vcpus: component.defaultVcpus,
            memoryMb: component.defaultMemoryMb,
            displayMode: "vnc",
            dhcpConfig:
              component.kind === "dhcp_server"
                ? createDefaultDhcpServerConfig()
                : null,
            natConfig:
              component.kind === "nat_gateway"
                ? createDefaultNatGatewayConfig()
                : null,
            ports: buildNodePorts({
              nodeId,
              kind: component.kind,
              guestFamily: component.guestFamily,
              osProfileId: component.osProfileId ?? null,
              nicModel,
              count: component.defaultPorts,
            }),
          },
        };
        setSelectedNodeId(nodeId);
        return [...current, newNode];
      });
      setIsDirty(true);
    },
    [baseTemplates, setNodes]
  );

  const handleAddFromTemplate = useCallback(
    (template: BaseTemplateInfo, dropPos?: { x: number; y: number }) => {
      const prof = osProfiles.find((p) => p.id === template.osProfileId);
      const fam: GuestFamily =
        prof?.guestFamily ??
        (template.osProfileId.includes("openbsd")
          ? "openbsd"
          : template.osProfileId.includes("freebsd") ||
            template.osProfileId.includes("opnsense") ||
            template.osProfileId.includes("pfsense") ||
            template.osProfileId.includes("dragonfly")
          ? "freebsd"
          : template.osProfileId.includes("netbsd")
          ? "netbsd"
          : template.osProfileId.includes("9front") ||
            template.osProfileId.includes("omnios") ||
            template.osProfileId.includes("haiku") ||
            template.osProfileId.includes("freedos")
          ? "other"
          : "linux");
      const arch = template.arch ?? prof?.arch ?? "aarch64";
      const nicModel =
        template.defaultNicModel ?? prof?.defaultNicModel ?? "virtio-net-pci";
      const firmware =
        template.defaultFirmware ?? prof?.defaultFirmware ?? "uefi";
      const diskBus =
        template.defaultDiskBus ?? prof?.defaultDiskBus ?? "virtio-blk";

      setNodes((current) => {
        const index = current.length + 1;
        const shortSlug = template.osProfileId.split("-")[0] || fam;
        const label = `${shortSlug}${index}`;
        const nodeId = `node-${label}-${Date.now().toString(36).slice(-4)}`;
        const newNode: EtherloomFlowNode = {
          id: nodeId,
          type: "etherloomNode",
          position: dropPos ?? {
            x: 230 + ((index * 55) % 360),
            y: 120 + ((index * 45) % 240),
          },
          data: {
            label,
            kind: "vm",
            guestFamily: fam,
            osProfileId: template.osProfileId,
            arch,
            nicModel,
            firmware,
            diskBus,
            templateId: template.id,
            diskSizeGb: prof?.recommendedDiskGb ?? 8,
            status: "stopped",
            vcpus: prof?.defaultCpus ?? 2,
            memoryMb: prof?.defaultRamMb ?? 512,
            displayMode: "vnc",
            ports: buildNodePorts({
              nodeId,
              kind: "vm",
              guestFamily: fam,
              osProfileId: template.osProfileId,
              nicModel,
              count: 2,
            }),
          },
        };
        setSelectedNodeId(nodeId);
        return [...current, newNode];
      });
      setIsDirty(true);
    },
    [osProfiles, setNodes]
  );

  const handleAddCatalogOsNode = useCallback(
    (entry: OsCatalogEntryDto) => {
      setNodes((current) => {
        const index = current.length + 1;
        const shortSlug = entry.id.split("-")[0] || "vm";
        const label = `${shortSlug}${index}`;
        const nodeId = `node-${label}-${Date.now().toString(36).slice(-4)}`;
        const newNode: EtherloomFlowNode = {
          id: nodeId,
          type: "etherloomNode",
          position: {
            x: 220 + ((index * 55) % 360),
            y: 120 + ((index * 45) % 240),
          },
          data: {
            label,
            kind: "vm",
            guestFamily: entry.guestFamily,
            osProfileId: entry.osProfileId,
            arch: entry.arch,
            nicModel: entry.nicModel,
            firmware: entry.firmware,
            diskBus: entry.diskBus,
            templateId: entry.templateId,
            diskSizeGb: entry.recommendedDiskGb,
            notes: `${entry.name} ${entry.version}`,
            status: "stopped",
            vcpus: entry.defaultCpus,
            memoryMb: entry.defaultRamMb,
            displayMode: "vnc",
            ports: buildNodePorts({
              nodeId,
              kind: "vm",
              guestFamily: entry.guestFamily,
              osProfileId: entry.osProfileId,
              nicModel: entry.nicModel,
              count: 2,
            }),
          },
        };
        setSelectedNodeId(nodeId);
        return [...current, newNode];
      });
      setIsDirty(true);
      showToast("ok", `Added ${entry.name} (${entry.arch}) node to topology`);
    },
    [setNodes, showToast]
  );

  const handleGuidedSetupStarted = useCallback(
    (entry: OsCatalogEntryDto, vm: VmInstanceInfo) => {
      const setupNode: EtherloomFlowNode = {
        id: vm.nodeId,
        type: "etherloomNode",
        position: { x: 0, y: 0 },
        data: {
          label: `${entry.id}-setup`,
          kind: "vm",
          guestFamily: entry.guestFamily,
          osProfileId: entry.osProfileId,
          arch: entry.arch,
          nicModel: entry.nicModel,
          firmware: entry.firmware,
          diskBus: entry.diskBus,
          bootMediaPath: vm.bootMediaPath,
          status: "running",
          vcpus: vm.cpus,
          memoryMb: vm.ramMb,
          displayMode: vm.displayMode,
          ports: [],
        },
      };
      setGuidedSetupVms((prev) => {
        const filtered = prev.filter((item) => item.id !== vm.nodeId);
        return [...filtered, setupNode];
      });
      const initialMode: VmConsoleSubMode =
        entry.id === "openbsd" || entry.id === "vyos" ? "serial" : "display";
      setConsoleTabs((prev) => {
        const filtered = prev.filter((t) => t.nodeId !== vm.nodeId);
        return [...filtered, { nodeId: vm.nodeId, mode: initialMode }];
      });
      setActiveWorkspaceTab(`vm:${vm.nodeId}`);
      setDockOpen(true);
      setDockExpanded(true);
      setStorageLibraryOpen(false);
      showToast(
        "ok",
        `Guided Setup started for ${entry.name}! Complete OS install in the Console below, then run halt -p / poweroff to auto-create your Golden Template.`
      );
    },
    [showToast]
  );

  const handleCreateCustomVm = useCallback(
    (spec: CustomVmWizardSubmission) => {
      const nodeId = `node-${spec.hostname
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "") || "vm"}-${Date.now()
        .toString(36)
        .slice(-4)}`;
      const initialMode: VmConsoleSubMode =
        spec.bootMediaPath && !spec.templateId ? "display" : "serial";

      setNodes((current) => {
        const newNode: EtherloomFlowNode = {
          id: nodeId,
          type: "etherloomNode",
          position: {
            x: 240 + ((current.length * 50) % 340),
            y: 130 + ((current.length * 40) % 220),
          },
          data: {
            label: spec.hostname,
            kind: "vm",
            guestFamily: spec.guestFamily,
            osProfileId: spec.osProfileId,
            arch: spec.arch,
            nicModel: spec.nicModel,
            firmware: spec.firmware,
            diskBus: spec.diskBus,
            templateId: spec.templateId,
            bootMediaPath: spec.bootMediaPath,
            bootMediaBus: spec.bootMediaBus,
            diskSizeGb: spec.diskSizeGb,
            notes: spec.notes,
            status: "stopped",
            vcpus: spec.vcpus,
            memoryMb: spec.memoryMb,
            displayMode: spec.displayMode,
            ports: buildNodePorts({
              nodeId,
              kind: "vm",
              guestFamily: spec.guestFamily,
              osProfileId: spec.osProfileId,
              nicModel: spec.nicModel,
              count: spec.nicCount,
            }),
          },
        };
        return [...current, newNode];
      });
      setSelectedNodeId(nodeId);
      setConsoleTabs((prev) => [...prev, { nodeId, mode: initialMode }]);
      setActiveWorkspaceTab(`vm:${nodeId}`);
      setDockOpen(true);
      setIsDirty(true);
    },
    [setNodes]
  );

  const handleSaveNodeConfig = useCallback(
    (nodeId: string, patch: Partial<TopologyNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )
      );

      // Sync edge labels or prune cables attached to deleted NICs
      if (patch.ports) {
        const validPortMap = new Map(
          patch.ports.map((p) => [p.id, p.label])
        );
        setEdges((eds) =>
          eds
            .filter((e) => {
              if (e.source === nodeId) {
                const sp = e.data?.sourcePortId ?? e.sourceHandle ?? "";
                if (!validPortMap.has(sp)) {
                  void fabricRemoveLink(e.id).catch(() => {});
                  return false;
                }
              }
              if (e.target === nodeId) {
                const tp = e.data?.targetPortId ?? e.targetHandle ?? "";
                if (!validPortMap.has(tp)) {
                  void fabricRemoveLink(e.id).catch(() => {});
                  return false;
                }
              }
              return true;
            })
            .map((e) => {
              if (!e.data) return e;
              let nextData = e.data;
              if (e.source === nodeId) {
                const lbl = validPortMap.get(e.data.sourcePortId);
                if (lbl && lbl !== e.data.sourcePortLabel) {
                  nextData = { ...nextData, sourcePortLabel: lbl };
                }
              }
              if (e.target === nodeId) {
                const lbl = validPortMap.get(e.data.targetPortId);
                if (lbl && lbl !== e.data.targetPortLabel) {
                  nextData = { ...nextData, targetPortLabel: lbl };
                }
              }
              return nextData === e.data ? e : { ...e, data: nextData };
            })
        );
      }

      setIsDirty(true);
    },
    [setEdges, setNodes]
  );

  const handleChangeVmDisplayMode = useCallback(
    (nodeId: string, mode: VmDisplayMode) => {
      handleSaveNodeConfig(nodeId, { displayMode: mode });
    },
    [handleSaveNodeConfig]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (
        target?.data.kind === "vm" &&
        (target.data.status === "running" || target.data.status === "booting")
      ) {
        void stopVm(nodeId, true).catch(() => {});
      }

      handleCloseVmConsoleTab(nodeId);

      setEdges((eds) =>
        eds.filter((e) => {
          const attached = e.source === nodeId || e.target === nodeId;
          if (attached) {
            void fabricRemoveLink(e.id).catch(() => {});
          }
          return !attached;
        })
      );
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setIsDirty(true);
    },
    [handleCloseVmConsoleTab, nodes, selectedNodeId, setEdges, setNodes]
  );

  // ---------------------------------------------------------------------------
  // Phase 5: Guided Academy Lab Instantiation / Reset & Direct Serial Commands
  // ---------------------------------------------------------------------------

  const handleLaunchAcademyLab = useCallback(
    async (labId: string) => {
      setLaunchingLabId(labId);
      try {
        const inst = await instantiateAcademyLab(labId, true);
        const { nodes: loadedNodes, edges: loadedEdges } =
          topologyDocumentToFlow(inst.bundle.topology);
        const firstVm = loadedNodes.find((n) => n.data.kind === "vm");

        setNodes(loadedNodes);
        setEdges(loadedEdges);
        if (firstVm) {
          setConsoleTabs([{ nodeId: firstVm.id, mode: "serial" }]);
          setActiveWorkspaceTab(`vm:${firstVm.id}`);
        } else {
          setConsoleTabs([]);
          setActiveWorkspaceTab("link");
        }
        setSelectedNodeId(loadedNodes[0]?.id ?? null);
        setSelectedEdgeId(null);
        setWirePopoverOpen(false);
        setSelectedPcapPath(null);
        setProjectName(inst.bundle.topology.name);
        setProjectNotes(inst.bundle.topology.notes ?? null);
        setProjectCreatedAtMs(inst.bundle.topology.created_at_ms);
        setBundlePath(inst.bundle.bundlePath);
        setIsDirty(false);

        setActiveLab(inst.lab);
        setActiveLabStepIndex(0);
        setLabDrawerOpen(true);
        setAcademyModalOpen(false);
        setWelcomeModalOpen(false);

        void refreshCaptures(inst.bundle.bundlePath);
        void refreshAcademyLabs();

        const missingReqs = inst.lab.summary.requiredTemplates.filter(
          (r) => !r.satisfied
        );
        if (missingReqs.length > 0) {
          const names = missingReqs.map((r) => r.osProfileName).join(", ");
          const missingIds = missingReqs.map(
            (r) => r.catalogId ?? r.osProfileId
          );
          showToast(
            "ok",
            `Loaded Lab ${String(inst.lab.summary.number).padStart(2, "0")} sandbox. Download or import ${names} in OS Library before starting VMs.`,
            "OS Library",
            () => {
              setLibraryFocusedCatalogIds(missingIds);
              setLibraryFocusedLabTitle(
                `Lab ${String(inst.lab.summary.number).padStart(2, "0")}: ${inst.lab.summary.title}`
              );
              setStorageLibraryOpen(true);
            }
          );
        } else {
          const boundNote =
            inst.autoBoundTemplates > 0
              ? ` (${inst.autoBoundTemplates} VM(s) bound to Golden Templates)`
              : "";
          showToast(
            "ok",
            `Ready: Lab ${String(inst.lab.summary.number).padStart(2, "0")} — ${inst.lab.summary.title}${boundNote}`
          );
        }
      } catch (err: unknown) {
        showToast("error", err instanceof Error ? err.message : String(err));
      } finally {
        setLaunchingLabId(null);
      }
    },
    [refreshAcademyLabs, refreshCaptures, setEdges, setNodes, showToast]
  );

  const handleSendCommandToSerial = useCallback(
    async (nodeId: string, command: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (!target || target.data.kind !== "vm") {
        showToast("error", `Target VM "${nodeId}" not found in topology.`);
        return;
      }

      if (isTauriRuntime() && target.data.status !== "running") {
        showToast(
          "error",
          `${target.data.label} is currently ${target.data.status}. Start the VM before sending serial commands.`,
          "Start VM",
          () => {
            void handleToggleNodeRun(nodeId);
          }
        );
        return;
      }

      handleOpenVmConsoleTab(nodeId, "serial");
      try {
        await writeSerialCommand(nodeId, command);
        showToast(
          "ok",
          `Sent ${command.trim().split("\n").length} line(s) to ${target.data.label} serial console`
        );
      } catch (err: unknown) {
        showToast("error", err instanceof Error ? err.message : String(err));
      }
    },
    [handleOpenVmConsoleTab, handleToggleNodeRun, nodes, showToast]
  );

  // ---------------------------------------------------------------------------
  // Project Persistence (`New`, `Open…`, `Save`, `Save As…`)
  // ---------------------------------------------------------------------------

  const handleCreateNewProjectConfirm = useCallback(
    async (params: {
      name: string;
      bundlePath: string;
      notes: string | null;
    }) => {
      setProjectBusy(true);
      try {
        const created = await createNewProject(params);
        setNodes([]);
        setEdges([]);
        setConsoleTabs([]);
        setActiveWorkspaceTab("link");
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setWirePopoverOpen(false);
        setActiveLab(null);
        setLabDrawerOpen(false);
        setProjectName(created.topology.name);
        setProjectNotes(created.topology.notes ?? null);
        setProjectCreatedAtMs(created.topology.created_at_ms);
        setBundlePath(created.bundlePath);
        setIsDirty(false);
        showToast("ok", `Created workspace ${created.bundlePath}`);
      } finally {
        setProjectBusy(false);
      }
    },
    [setEdges, setNodes, showToast]
  );

  const handleOpenProject = useCallback(async () => {
    const chosen = await pickOpenProjectDialog(
      storageState?.resolvedWorkspacesDir
    );
    if (!chosen) return;

    setProjectBusy(true);
    try {
      const loaded = await openProject(chosen);
      const { nodes: loadedNodes, edges: loadedEdges } = topologyDocumentToFlow(
        loaded.topology
      );
      const firstVm = loadedNodes.find((n) => n.data.kind === "vm");
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      if (firstVm) {
        const initMode: VmConsoleSubMode =
          firstVm.data.bootMediaPath && !firstVm.data.templateId
            ? "display"
            : "serial";
        setConsoleTabs([{ nodeId: firstVm.id, mode: initMode }]);
        setActiveWorkspaceTab(`vm:${firstVm.id}`);
      } else {
        setConsoleTabs([]);
        setActiveWorkspaceTab("link");
      }
      setSelectedNodeId(loadedNodes[0]?.id ?? null);
      setSelectedEdgeId(null);
      setWirePopoverOpen(false);
      setActiveLab(null);
      setLabDrawerOpen(false);
      setProjectName(loaded.topology.name);
      setProjectNotes(loaded.topology.notes ?? null);
      setProjectCreatedAtMs(loaded.topology.created_at_ms);
      setBundlePath(loaded.bundlePath);
      setIsDirty(false);
      const rebaseMsg =
        loaded.rebasedOverlays > 0
          ? ` (${loaded.rebasedOverlays} qcow2 overlay(s) auto-rebased)`
          : "";
      showToast(
        "ok",
        `Opened "${loaded.topology.name}" — ${loadedNodes.length} nodes, ${loadedEdges.length} wires${rebaseMsg}`
      );
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setProjectBusy(false);
    }
  }, [setEdges, setNodes, showToast, storageState?.resolvedWorkspacesDir]);

  const executeSaveToPath = useCallback(
    async (targetPath: string, copyFrom: string | null) => {
      setProjectBusy(true);
      try {
        const doc = flowToTopologyDocument({
          name: projectName,
          notes: projectNotes,
          createdAtMs: projectCreatedAtMs,
          nodes,
          edges,
        });
        const saved = await saveProject({
          bundlePath: targetPath,
          copyFromBundle: copyFrom,
          topology: doc,
        });
        setBundlePath(saved.bundlePath);
        setProjectCreatedAtMs(saved.topology.created_at_ms);
        setIsDirty(false);
        void refreshCaptures(saved.bundlePath);
        showToast("ok", `Saved topology.toml → ${saved.bundlePath}`);
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : String(err));
      } finally {
        setProjectBusy(false);
      }
    },
    [
      edges,
      nodes,
      projectCreatedAtMs,
      projectName,
      projectNotes,
      refreshCaptures,
      showToast,
    ]
  );

  const handleSaveProject = useCallback(async () => {
    if (bundlePath) {
      await executeSaveToPath(bundlePath, null);
      return;
    }
    const defaultDir = storageState?.resolvedWorkspacesDir;
    const picked = await pickSaveProjectDialog(projectName, defaultDir);
    if (picked) {
      const derivedName =
        picked
          .split("/")
          .pop()
          ?.replace(/\.etherloom$/i, "") || projectName;
      setProjectName(derivedName);
      await executeSaveToPath(picked, null);
    } else if (!isTauriRuntime()) {
      await executeSaveToPath(
        `${defaultDir ?? "/tmp"}/campus-dual-stack.etherloom`,
        null
      );
    }
  }, [
    bundlePath,
    executeSaveToPath,
    projectName,
    storageState?.resolvedWorkspacesDir,
  ]);

  const handleSaveProjectAs = useCallback(async () => {
    const defaultDir = storageState?.resolvedWorkspacesDir;
    const picked = await pickSaveProjectDialog(projectName, defaultDir);
    if (!picked) return;
    const derivedName =
      picked
        .split("/")
        .pop()
        ?.replace(/\.etherloom$/i, "") || projectName;
    setProjectName(derivedName);
    await executeSaveToPath(picked, bundlePath);
  }, [
    bundlePath,
    executeSaveToPath,
    projectName,
    storageState?.resolvedWorkspacesDir,
  ]);

  // ⌘S / Ctrl+S shortcut for Project Save & ⌘⇧M / Ctrl+Shift+M for Activity Monitor
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveProject();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        setActivityMonitorOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveProject]);

  // Enrich nodes with computed per-port link status LEDs (`unplugged` | `up` | `active` | `cut`) & quick actions
  const enrichedNodes = useMemo<EtherloomFlowNode[]>(() => {
    const portStateMap = new Map<string, PortLinkState>();
    for (const edge of edges) {
      const d = edge.data;
      const sp = d?.sourcePortId ?? edge.sourceHandle;
      const tp = d?.targetPortId ?? edge.targetHandle;
      const state: PortLinkState =
        d?.adminUp === false
          ? "cut"
          : (d?.pps ?? 0) > 0 || (d?.bytesPerSec ?? 0) > 0
          ? "active"
          : "up";
      if (sp) portStateMap.set(sp, state);
      if (tp) portStateMap.set(tp, state);
    }

    return nodes.map((node) => {
      const portStates: Record<string, PortLinkState> = {};
      for (const p of node.data.ports) {
        portStates[p.id] = portStateMap.get(p.id) ?? "unplugged";
      }
      return {
        ...node,
        data: {
          ...node.data,
          hostArch: envReport?.hostArch ?? "aarch64",
          portStates,
          onToggleRun: handleToggleNodeRun,
          onOpenConsole: handleOpenNodeConsole,
          onOpenSettings: handleOpenNodeSettings,
        },
      };
    });
  }, [
    edges,
    envReport?.hostArch,
    handleOpenNodeConsole,
    handleOpenNodeSettings,
    handleToggleNodeRun,
    nodes,
  ]);

  const vmNodes = useMemo(
    () => [
      ...enrichedNodes.filter((n) => n.data.kind === "vm"),
      ...guidedSetupVms,
    ],
    [enrichedNodes, guidedSetupVms]
  );

  const configNode = useMemo(
    () => enrichedNodes.find((n) => n.id === configNodeId) ?? null,
    [configNodeId, enrichedNodes]
  );

  // Derive canvas wire highlights for the active Academy Lab step (without mutating topology.toml)
  const displayEdges = useMemo<EtherloomWireEdgeType[]>(() => {
    const highlightedIds =
      activeLab && labDrawerOpen
        ? activeLab.steps[activeLabStepIndex]?.highlightLinks ?? []
        : [];
    if (highlightedIds.length === 0) {
      return edges;
    }
    const highlightSet = new Set(highlightedIds);
    return edges.map((edge) => {
      if (!edge.data) return edge;
      const shouldHighlight = highlightSet.has(edge.id);
      if (Boolean(edge.data.highlightedByLab) === shouldHighlight) {
        return edge;
      }
      return {
        ...edge,
        data: {
          ...edge.data,
          highlightedByLab: shouldHighlight,
        },
      };
    });
  }, [activeLab, activeLabStepIndex, edges, labDrawerOpen]);

  const selectedEdge = useMemo(
    () => displayEdges.find((e) => e.id === selectedEdgeId) ?? null,
    [displayEdges, selectedEdgeId]
  );

  const handleSelectEdge = useCallback(
    (edgeId: string | null, openPopover = false) => {
      setSelectedEdgeId(edgeId);
      setWirePopoverOpen(Boolean(edgeId && openPopover));
      if (edgeId) {
        setActiveWorkspaceTab("link");
      }
    },
    []
  );

  const activeTemplatesDir =
    storageState?.resolvedTemplatesDir ??
    envReport?.templatesDir ??
    "~/Library/Application Support/Etherloom/Library/templates";

  const activeWorkspacesDir =
    storageState?.resolvedWorkspacesDir ??
    "~/Library/Application Support/Etherloom/Library/projects";

  const wiresharkAvailable =
    !isTauriRuntime() || (envReport ? envReport.wireshark.found : true);

  const anyModalOpen =
    storageLibraryOpen ||
    welcomeModalOpen ||
    academyModalOpen ||
    Boolean(configNode) ||
    customVmWizardOpen ||
    newProjectModalOpen ||
    doctorModalOpen ||
    settingsModalOpen;

  const handleClearLibraryFocus = useCallback(() => {
    setLibraryFocusedCatalogIds(null);
    setLibraryFocusedLabTitle(null);
  }, []);

  const handleCloseStorageLibrary = useCallback(() => {
    setStorageLibraryOpen(false);
    setLibraryFocusedCatalogIds(null);
    setLibraryFocusedLabTitle(null);
  }, []);

  const handleClearAcademyPrompt = useCallback(() => {
    setAcademyPromptLabId(null);
  }, []);

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0D1321] dark:text-slate-100 ${
        anyModalOpen ? "loom-modal-open" : ""
      }`}
    >
      <TopToolbar
        projectName={projectName}
        bundlePath={bundlePath}
        isDirty={isDirty}
        projectBusy={projectBusy}
        activeLabNumber={activeLab?.summary.number ?? null}
        labDrawerOpen={labDrawerOpen}
        readyTemplateCount={baseTemplates.length}
        runningVmCount={
          nodes.filter(
            (n) =>
              n.data.kind === "vm" &&
              (n.data.status === "running" || n.data.status === "booting")
          ).length +
          guidedSetupVms.filter(
            (n) => n.data.status === "running" || n.data.status === "booting"
          ).length
        }
        onOpenWelcomeModal={() => setWelcomeModalOpen(true)}
        onOpenActivityMonitorModal={() => setActivityMonitorOpen(true)}
        onOpenAcademyModal={() => setAcademyModalOpen(true)}
        onOpenStorageLibraryModal={() => setStorageLibraryOpen(true)}
        onToggleLabDrawer={() => setLabDrawerOpen((v) => !v)}
        onNewProject={() => setNewProjectModalOpen(true)}
        onOpenProject={() => void handleOpenProject()}
        onSaveProject={() => void handleSaveProject()}
        onSaveProjectAs={() => void handleSaveProjectAs()}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        dockOpen={dockOpen}
        onToggleDock={() => setDockOpen((v) => !v)}
        themePreference={preference}
        onChangeTheme={setPreference}
        envReport={envReport}
        envLoading={envLoading}
        onOpenDoctorModal={() => setDoctorModalOpen(true)}
        onOpenSettingsModal={() => {
          setSettingsInitialSection("storage");
          setSettingsModalOpen(true);
        }}
        labRunning={labRunning}
        onToggleLabRunning={() => void handleToggleLabRunning()}
      />

      {/* Graceful External Drive Disconnected Banner */}
      {storageState?.status.state === "volumeDisconnected" && (
        <VolumeDisconnectedBanner
          volumeName={storageState.status.volumeName}
          expectedPath={storageState.status.expectedPath}
          busy={storageBusy}
          onRetry={() => void handleRetryStorage()}
          onSelectDifferentFolder={() => setSettingsModalOpen(true)}
          onFallbackInternal={() => void handleFallbackInternalStorage()}
        />
      )}

      {/* Automatic Host QEMU Hypervisor Missing Banner */}
      {envReport && !qemuBannerDismissed && (
        <QemuMissingBanner
          report={envReport}
          loading={envLoading}
          onRefresh={() => void loadDiagnostics(true)}
          onOpenDoctor={() => setDoctorModalOpen(true)}
          onDismiss={() => setQemuBannerDismissed(true)}
        />
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {sidebarOpen && (
          <LeftSidebar
            catalog={catalog}
            baseTemplates={baseTemplates}
            templatesDir={activeTemplatesDir}
            onAddComponent={handleAddComponent}
            onAddFromTemplate={handleAddFromTemplate}
            onOpenCustomVmWizard={() => setCustomVmWizardOpen(true)}
            onOpenStorageLibraryModal={() => setStorageLibraryOpen(true)}
          />
        )}

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <WorkspaceCanvas
            nodes={enrichedNodes}
            edges={displayEdges}
            selectedEdgeId={selectedEdgeId}
            wirePopoverOpen={wirePopoverOpen}
            wiresharkAvailable={wiresharkAvailable}
            resolvedTheme={resolvedTheme}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onSelectNode={setSelectedNodeId}
            onNodeDoubleClick={handleNodeDoubleClick}
            onSelectEdge={handleSelectEdge}
            onCloseWirePopover={() => setWirePopoverOpen(false)}
            onUpdateEdgeData={handleUpdateEdgeData}
            onStartPcapRecording={(id) => void handleStartPcapRecording(id)}
            onStopAndSavePcap={(id) => void handleStopAndSavePcap(id)}
            onStopAndOpenWireshark={(id) => void handleStopAndOpenWireshark(id)}
            onStopAndDissect={(id) => void handleStopAndDissect(id)}
            onToggleLiveWireshark={(id) => void handleToggleLiveWireshark(id)}
            onDeleteEdge={handleDeleteEdge}
            onOpenFlowInspector={() => {
              setActiveWorkspaceTab("tcpflowy");
              setDockOpen(true);
            }}
            onDropCatalogComponent={handleAddComponent}
            onDropBaseTemplate={handleAddFromTemplate}
          />

          <BottomDock
            open={dockOpen}
            expanded={dockExpanded}
            floating={dockFloating}
            activeTabId={activeWorkspaceTab}
            consoleTabs={consoleTabs}
            vmNodes={vmNodes}
            selectedEdge={selectedEdge}
            capturesDir={
              bundlePath ? `${bundlePath}/captures` : undefined
            }
            captures={captures}
            selectedPcapPath={selectedPcapPath}
            dissectNonce={dissectNonce}
            wiresharkAvailable={wiresharkAvailable}
            tcpflowyStatus={tcpflowyStatus}
            tcpflowyProgress={tcpflowyProgress}
            installingTcpflowy={installingTcpflowy}
            onSelectTab={setActiveWorkspaceTab}
            onOpenVmTab={handleOpenVmConsoleTab}
            onCloseVmTab={handleCloseVmConsoleTab}
            onChangeVmTabMode={handleChangeVmTabMode}
            onToggleVmRun={(id) => void handleToggleNodeRun(id)}
            onOpenNodeSettings={handleOpenNodeSettings}
            onChangeVmDisplayMode={handleChangeVmDisplayMode}
            onUpdateSelectedEdge={(patch) => {
              if (selectedEdgeId) {
                handleUpdateEdgeData(selectedEdgeId, patch);
              }
            }}
            onStartPcapRecording={(id) => void handleStartPcapRecording(id)}
            onStopAndSavePcap={(id) => void handleStopAndSavePcap(id)}
            onStopAndOpenWireshark={(id) => void handleStopAndOpenWireshark(id)}
            onStopAndDissect={(id) => void handleStopAndDissect(id)}
            onToggleLiveWireshark={(id) => void handleToggleLiveWireshark(id)}
            onSelectPcap={setSelectedPcapPath}
            onRefreshCaptures={() => refreshCaptures()}
            onInstallTcpflowy={handleInstallTcpflowy}
            onRefreshTcpflowyStatus={refreshTcpflowyStatus}
            onOpenSettingsTcpflowy={() => {
              setSettingsInitialSection("tcpflowy");
              setSettingsModalOpen(true);
            }}
            onNotify={showToast}
            onToggleOpen={() => setDockOpen((v) => !v)}
            onToggleExpanded={() => setDockExpanded((v) => !v)}
            onToggleFloating={() => {
              setDockFloating((v) => !v);
              setDockOpen(true);
            }}
          />
        </div>

        {/* Right-Side Collapsible Interactive Lab Guide Drawer */}
        {activeLab && labDrawerOpen && (
          <LabGuideDrawer
            lab={activeLab}
            nodes={enrichedNodes}
            edges={displayEdges}
            activeStepIndex={activeLabStepIndex}
            resetting={launchingLabId === activeLab.summary.id}
            onSelectStep={setActiveLabStepIndex}
            onResetLab={() => void handleLaunchAcademyLab(activeLab.summary.id)}
            onOpenAcademyBrowser={() => setAcademyModalOpen(true)}
            onSendCommandToSerial={(nodeId, cmd) =>
              void handleSendCommandToSerial(nodeId, cmd)
            }
            onToggleWireCapture={(edgeId) =>
              void handleTogglePcapRecording(edgeId)
            }
            onOpenTcpflowy={() => {
              setActiveWorkspaceTab("tcpflowy");
              setDockOpen(true);
            }}
            onCloseDrawer={() => setLabDrawerOpen(false)}
          />
        )}
      </div>

      <StatusBar
        storageState={storageState}
        nodeCount={nodes.length}
        linkCount={edges.length}
        onOpenStorageSettings={() => setStorageLibraryOpen(true)}
        onOpenActivityMonitor={() => setActivityMonitorOpen(true)}
      />

      {/* Modals — conditionally mount transient modals so closed dialogs do zero background work and can never throw over an active session */}
      {activityMonitorOpen && (
        <ErrorBoundary
          scopeLabel="Activity Monitor"
          onReset={() => setActivityMonitorOpen(false)}
        >
          <ActivityMonitorModal
            open={activityMonitorOpen}
            nodes={[
              ...enrichedNodes.map(
                (n): ActivityMonitorNodeInput => ({
                  id: n.id,
                  data: n.data,
                  isGuidedSetup: false,
                })
              ),
              ...guidedSetupVms.map(
                (g): ActivityMonitorNodeInput => ({
                  id: g.id,
                  data: g.data,
                  isGuidedSetup: true,
                })
              ),
            ]}
            onClose={() => setActivityMonitorOpen(false)}
            onToggleNodeRun={(nodeId) => void handleToggleNodeRun(nodeId)}
            onOpenNodeConsole={(nodeId) => {
              handleOpenVmConsoleTab(nodeId);
              setDockOpen(true);
            }}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
            }}
          />
        </ErrorBoundary>
      )}
      <ErrorBoundary
        scopeLabel="Storage & OS Library Manager"
        active={storageLibraryOpen}
        onReset={handleCloseStorageLibrary}
      >
        <StorageLibraryModal
          open={storageLibraryOpen}
          hostArch={envReport?.hostArch ?? "aarch64"}
          envReport={envReport}
          onOpenEnvDoctor={() => setDoctorModalOpen(true)}
          storageState={storageState}
          migrationProgress={migrationProgress}
          focusedCatalogIds={libraryFocusedCatalogIds}
          focusedLabTitle={libraryFocusedLabTitle}
          onClearFocusedCatalogIds={handleClearLibraryFocus}
          onReturnToAcademy={
            libraryFocusedCatalogIds
              ? () => {
                  setStorageLibraryOpen(false);
                  setLibraryFocusedCatalogIds(null);
                  setLibraryFocusedLabTitle(null);
                  setAcademyModalOpen(true);
                }
              : undefined
          }
          onClose={handleCloseStorageLibrary}
          onApplyStorageUpdate={handleApplyStorageUpdate}
          onRetryDetection={handleRetryStorage}
          onFallbackInternal={handleFallbackInternalStorage}
          onAddCatalogOsNode={handleAddCatalogOsNode}
          onGuidedSetupStarted={handleGuidedSetupStarted}
          onTemplatesChanged={refreshTemplates}
          onNotify={showToast}
        />
      </ErrorBoundary>

      {welcomeModalOpen && (
        <ErrorBoundary
          scopeLabel="Welcome Launchpad"
          onReset={() => setWelcomeModalOpen(false)}
        >
          <WelcomeModal
            open={welcomeModalOpen}
            labs={academyLabs}
            envReport={envReport}
            envLoading={envLoading}
            onRefreshEnv={() => void loadDiagnostics(true)}
            onOpenDoctorModal={() => setDoctorModalOpen(true)}
            showOnStartup={showWelcomeOnStartup}
            onChangeShowOnStartup={handleChangeShowWelcomeOnStartup}
            onClose={() => setWelcomeModalOpen(false)}
            onOpenAcademy={() => {
              setWelcomeModalOpen(false);
              setAcademyModalOpen(true);
            }}
            onOpenStorageLibrary={() => {
              setWelcomeModalOpen(false);
              setLibraryFocusedCatalogIds(null);
              setLibraryFocusedLabTitle(null);
              setStorageLibraryOpen(true);
            }}
            onLaunchLab={(labId) => {
              const summary = Array.isArray(academyLabs)
                ? academyLabs.find((l) => l && l.id === labId)
                : undefined;
              if (summary && !summary.allTemplatesReady) {
                setWelcomeModalOpen(false);
                setAcademyPromptLabId(labId);
                setAcademyModalOpen(true);
                return;
              }
              void handleLaunchAcademyLab(labId);
            }}
            onNewProject={() => setNewProjectModalOpen(true)}
            onOpenProject={() => void handleOpenProject()}
            onOpenCustomVmWizard={() => setCustomVmWizardOpen(true)}
          />
        </ErrorBoundary>
      )}

      {academyModalOpen && (
        <ErrorBoundary
          scopeLabel="Networking Academy"
          onReset={() => setAcademyModalOpen(false)}
        >
          <AcademyModal
            open={academyModalOpen}
            labs={academyLabs}
            loading={academyLoading}
            launchingLabId={launchingLabId}
            activeLabId={activeLab?.summary.id ?? null}
            initialPromptLabId={academyPromptLabId}
            onClearInitialPromptLab={handleClearAcademyPrompt}
            onClose={() => setAcademyModalOpen(false)}
            onRefresh={() => void refreshAcademyLabs()}
            onLaunchLab={(labId) => void handleLaunchAcademyLab(labId)}
            onOpenTemplateWizard={() => {
              setAcademyModalOpen(false);
              setLibraryFocusedCatalogIds(null);
              setLibraryFocusedLabTitle(null);
              setStorageLibraryOpen(true);
            }}
            onOpenOsLibraryForCatalogIds={(catalogIds, labTitle) => {
              setAcademyModalOpen(false);
              setLibraryFocusedCatalogIds(catalogIds);
              setLibraryFocusedLabTitle(labTitle ?? null);
              setStorageLibraryOpen(true);
            }}
          />
        </ErrorBoundary>
      )}

      {configNode && (
        <NodeConfigModal
          open={Boolean(configNode)}
          node={configNode}
          initialTab={configNodeInitialTab}
          bundlePath={bundlePath}
          isosDir={storageState?.resolvedIsosDir}
          osProfiles={osProfiles}
          baseTemplates={baseTemplates}
          onClose={() => {
            setConfigNodeId(null);
            setConfigNodeInitialTab("general");
          }}
          onSaveNode={handleSaveNodeConfig}
          onDeleteNode={handleDeleteNode}
          onTemplatesChanged={refreshTemplates}
          onOpenOsLibrary={(profId) => {
            setLibraryFocusedCatalogIds(profId ? [profId] : null);
            setLibraryFocusedLabTitle(null);
            setStorageLibraryOpen(true);
          }}
        />
      )}

      {customVmWizardOpen && (
        <CustomVmWizardModal
          open={customVmWizardOpen}
          isosDir={storageState?.resolvedIsosDir}
          osProfiles={osProfiles}
          baseTemplates={baseTemplates}
          onClose={() => setCustomVmWizardOpen(false)}
          onCreateVm={handleCreateCustomVm}
        />
      )}

      {newProjectModalOpen && (
        <NewProjectModal
          open={newProjectModalOpen}
          defaultParentDir={activeWorkspacesDir}
          onClose={() => setNewProjectModalOpen(false)}
          onCreate={handleCreateNewProjectConfirm}
        />
      )}

      {doctorModalOpen && (
        <DependencyCheckModal
          open={doctorModalOpen}
          report={envReport}
          loading={envLoading}
          onClose={() => setDoctorModalOpen(false)}
          onRefresh={() => void loadDiagnostics(true)}
        />
      )}

      {settingsModalOpen && (
        <SettingsModal
          open={settingsModalOpen}
          initialSection={settingsInitialSection}
          storageState={storageState}
          migrationProgress={migrationProgress}
          tcpflowyStatus={tcpflowyStatus}
          tcpflowyProgress={tcpflowyProgress}
          installingTcpflowy={installingTcpflowy}
          themePreference={preference}
          onChangeTheme={setPreference}
          onClose={() => setSettingsModalOpen(false)}
          onApplyStorageUpdate={handleApplyStorageUpdate}
          onRetryDetection={handleRetryStorage}
          onFallbackInternal={handleFallbackInternalStorage}
          onInstallTcpflowy={handleInstallTcpflowy}
          onTcpflowyStatusChanged={setTcpflowyStatus}
        />
      )}

      {/* Non-blocking Toast Notification (z-[100] so notifications stay visible above any open modal) */}
      {toast && (
        <div
          className={`fixed bottom-10 right-4 z-[100] max-w-lg rounded-xl border px-3.5 py-2.5 shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs ${
            toast.kind === "ok"
              ? "bg-white/95 dark:bg-[#111827]/96 border-[#10B981]/45 text-slate-800 dark:text-slate-100"
              : "bg-white/95 dark:bg-[#111827]/96 border-[#F43F5E]/50 text-slate-800 dark:text-slate-100"
          }`}
        >
          {toast.kind === "ok" ? (
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-[#F43F5E] shrink-0" />
          )}
          <span className="flex-1 leading-snug break-words">{toast.text}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                setToast(null);
              }}
              className="shrink-0 px-2.5 py-1 rounded-md bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] font-semibold"
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
