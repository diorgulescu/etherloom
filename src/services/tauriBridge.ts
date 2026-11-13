import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AcademyLabDetail,
  AcademyLabSummary,
  BaseTemplateInfo,
  CaptureFileInfo,
  CatalogComponent,
  ConsoleSessionEndpoints,
  DiskInfo,
  DiskTelemetry,
  DissectPcapRequest,
  EnvDoctorReport,
  FabricTelemetryEvent,
  InstallerMediaInfo,
  InstantiatedLabDto,
  LinkSnapshot,
  LiveWiresharkSessionInfo,
  MacTableEntry,
  NodeDiskStatusDto,
  OsProfile,
  OverlayRebaseReport,
  OverlayTemplateBinding,
  ProjectBundleDto,
  SaveProjectRequest,
  SpawnVmRequest,
  StartPcapRecordingResult,
  StopPcapRecordingResult,
  StorageMigrationProgress,
  StorageMigrationResult,
  StorageStateSnapshot,
  TcpflowyDissectionReport,
  TcpflowyEnvStatus,
  TcpflowyInstallProgress,
  TopologyDocument,
  UdpPortBinding,
  UpdateStorageRequest,
  VirtualDeviceInfo,
  VmInstanceInfo,
  VmStateEvent,
  WorkspaceNode,
} from "../types/studio";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

const FALLBACK_CATALOG: CatalogComponent[] = [
  {
    id: "guest-alpine-linux",
    name: "Alpine Linux",
    subtitle: "eth{n} • 256 MB RAM",
    kind: "vm",
    guestFamily: "linux",
    osProfileId: "alpine-linux",
    nicPrefix: "eth",
    defaultPorts: 2,
    defaultVcpus: 1,
    defaultMemoryMb: 256,
    consoleModes: ["serial", "vnc", "cocoa"],
  },
  {
    id: "guest-debian-linux",
    name: "Debian / Generic Linux",
    subtitle: "enp0s{n} / eth{n} • 512 MB RAM",
    kind: "vm",
    guestFamily: "linux",
    osProfileId: "debian-linux",
    nicPrefix: "eth",
    defaultPorts: 2,
    defaultVcpus: 2,
    defaultMemoryMb: 512,
    consoleModes: ["serial", "vnc", "cocoa"],
  },
  {
    id: "guest-freebsd",
    name: "FreeBSD",
    subtitle: "vtnet{n} • 512 MB RAM",
    kind: "vm",
    guestFamily: "freebsd",
    osProfileId: "freebsd",
    nicPrefix: "vtnet",
    defaultPorts: 2,
    defaultVcpus: 2,
    defaultMemoryMb: 512,
    consoleModes: ["serial", "vnc", "cocoa"],
  },
  {
    id: "guest-openbsd",
    name: "OpenBSD",
    subtitle: "vio{n} • 512 MB RAM",
    kind: "vm",
    guestFamily: "openbsd",
    osProfileId: "openbsd",
    nicPrefix: "vio",
    defaultPorts: 2,
    defaultVcpus: 2,
    defaultMemoryMb: 512,
    consoleModes: ["serial", "vnc", "cocoa"],
  },
  {
    id: "guest-netbsd",
    name: "NetBSD",
    subtitle: "vioif{n} • 256 MB RAM",
    kind: "vm",
    guestFamily: "netbsd",
    osProfileId: "netbsd",
    nicPrefix: "vioif",
    defaultPorts: 2,
    defaultVcpus: 1,
    defaultMemoryMb: 256,
    consoleModes: ["serial", "vnc", "cocoa"],
  },
  {
    id: "fabric-l2-switch",
    name: "L2 Ethernet Switch",
    subtitle: "p1..p8 • 802.1D MAC learning bridge",
    kind: "l2_switch",
    guestFamily: null,
    osProfileId: null,
    nicPrefix: "p",
    defaultPorts: 8,
    defaultVcpus: null,
    defaultMemoryMb: null,
    consoleModes: ["inspector"],
  },
  {
    id: "fabric-l1-hub",
    name: "L1 Ethernet Hub",
    subtitle: "p1..p6 • Shared-wire repeater",
    kind: "l1_hub",
    guestFamily: null,
    osProfileId: null,
    nicPrefix: "p",
    defaultPorts: 6,
    defaultVcpus: null,
    defaultMemoryMb: null,
    consoleModes: ["inspector"],
  },
];

export async function fetchComponentCatalog(): Promise<CatalogComponent[]> {
  if (!isTauriRuntime()) {
    return FALLBACK_CATALOG;
  }
  return invoke<CatalogComponent[]>("get_component_catalog");
}

export async function fetchEnvStatus(forceRefresh = false): Promise<EnvDoctorReport> {
  if (isTauriRuntime()) {
    return invoke<EnvDoctorReport>(
      forceRefresh ? "run_env_doctor" : "get_env_status"
    );
  }

  const emptyProbe = (name: string) => ({
    name,
    found: false,
    path: null,
    version: null,
    searchedPaths: ["/opt/homebrew/bin", "/usr/local/bin", "$PATH"],
    notes: "Launch inside Tauri (`npm run tauri dev`) to probe macOS binaries",
  });

  return {
    checkedAtMs: Date.now(),
    hostOs: "macos (browser preview)",
    hostArch: "aarch64",
    hvfSupported: false,
    appSupportDir: "~/Library/Application Support/Etherloom",
    templatesDir: "~/Library/Application Support/Etherloom/Library/templates",
    overallBadge: "warning",
    okCount: 0,
    warningCount: 5,
    qemuSystemAarch64: emptyProbe("qemu-system-aarch64"),
    qemuImg: emptyProbe("qemu-img"),
    edk2Aarch64Code: emptyProbe("edk2-aarch64-code.fd"),
    wireshark: emptyProbe("Wireshark"),
    python3: emptyProbe("python3"),
    uv: emptyProbe("uv"),
    checks: [
      {
        id: "qemu-system-aarch64",
        title: "QEMU System Emulator (qemu-system-aarch64)",
        category: "Hypervisor & Compute",
        requiredFor: "Booting Linux, FreeBSD, OpenBSD & NetBSD guests with -accel hvf",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install qemu",
        details: "Run inside Tauri desktop shell to execute live host probe",
        searchedPaths: ["/opt/homebrew/bin/qemu-system-aarch64", "/usr/local/bin/qemu-system-aarch64"],
      },
      {
        id: "qemu-img",
        title: "QEMU Disk Image Utility (qemu-img)",
        category: "Storage & Overlays",
        requiredFor: "Creating Copy-on-Write qcow2 lab overlays from base templates",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install qemu",
        details: null,
        searchedPaths: ["/opt/homebrew/bin/qemu-img", "/usr/local/bin/qemu-img"],
      },
      {
        id: "edk2-aarch64-code",
        title: "UEFI Firmware (edk2-aarch64-code.fd)",
        category: "Boot Firmware",
        requiredFor: "UEFI pflash boot & graphical ramfb console on -M virt",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install qemu",
        details: null,
        searchedPaths: [
          "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
          "/usr/local/share/qemu/edk2-aarch64-code.fd",
        ],
      },
      {
        id: "wireshark",
        title: "Wireshark / TShark Packet Analyzer",
        category: "Wiretap & Capture",
        requiredFor: "Live zero-root FIFO pipe packet inspection on virtual links",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install --cask wireshark",
        details: null,
        searchedPaths: ["/Applications/Wireshark.app/Contents/MacOS/Wireshark", "$PATH/wireshark"],
      },
      {
        id: "python-tcpflowy",
        title: "Python 3 / uv Runtime (tcpflowy Bridge)",
        category: "Flow Analysis",
        requiredFor: "Isolated PyPI tcpflowy environment for in-app GUI Flow Inspector",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install uv python",
        details: null,
        searchedPaths: ["/opt/homebrew/bin/uv", "/opt/homebrew/bin/python3"],
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// Phase 1b: Storage Settings, Volume Resilience & Native Folder Picker
// -----------------------------------------------------------------------------

const BROWSER_DEFAULT_STORAGE: StorageStateSnapshot = {
  config: {
    storageRoot: "~/Library/Application Support/Etherloom/Library",
    templatesDirOverride: null,
    isosDirOverride: null,
    workspacesDirOverride: null,
  },
  defaultStorageRoot: "~/Library/Application Support/Etherloom/Library",
  settingsFile: "~/Library/Application Support/Etherloom/settings.toml",
  pythonEnvDir: "~/Library/Application Support/Etherloom/python-env",
  runtimeSocketsDir: "/tmp/etherloom",
  resolvedTemplatesDir: "~/Library/Application Support/Etherloom/Library/templates",
  resolvedIsosDir: "~/Library/Application Support/Etherloom/Library/isos",
  resolvedWorkspacesDir: "~/Library/Application Support/Etherloom/Library/projects",
  status: { state: "ready" },
  diskTelemetry: {
    probedPath: "/",
    filesystemType: "apfs",
    freeBytes: 256 * 1024 * 1024 * 1024,
    totalBytes: 512 * 1024 * 1024 * 1024,
    isExternalVolume: false,
    isExfat: false,
    advisoryTip: null,
  },
};

export async function getStorageState(): Promise<StorageStateSnapshot> {
  if (!isTauriRuntime()) {
    return BROWSER_DEFAULT_STORAGE;
  }
  return invoke<StorageStateSnapshot>("get_storage_state");
}

export async function retryStorageDetection(): Promise<StorageStateSnapshot> {
  if (!isTauriRuntime()) {
    return BROWSER_DEFAULT_STORAGE;
  }
  return invoke<StorageStateSnapshot>("retry_storage_detection");
}

export async function fallbackToDefaultStorage(): Promise<StorageStateSnapshot> {
  if (!isTauriRuntime()) {
    return BROWSER_DEFAULT_STORAGE;
  }
  return invoke<StorageStateSnapshot>("fallback_to_default_storage");
}

export async function updateStorageLocation(
  request: UpdateStorageRequest
): Promise<StorageMigrationResult> {
  if (!isTauriRuntime()) {
    const root = request.storageRoot.trim();
    const snap: StorageStateSnapshot = {
      ...BROWSER_DEFAULT_STORAGE,
      config: {
        storageRoot: root,
        templatesDirOverride: request.templatesDirOverride,
        isosDirOverride: request.isosDirOverride,
        workspacesDirOverride: request.workspacesDirOverride,
      },
      resolvedTemplatesDir: request.templatesDirOverride || `${root}/templates`,
      resolvedIsosDir: request.isosDirOverride || `${root}/isos`,
      resolvedWorkspacesDir: request.workspacesDirOverride || `${root}/projects`,
    };
    return {
      snapshot: snap,
      filesCopied: 0,
      bytesCopied: 0,
      sourceCleaned: false,
      templatesDiscovered: 0,
      isosDiscovered: 0,
    };
  }
  return invoke<StorageMigrationResult>("update_storage_location", { request });
}

export async function probeStoragePathTelemetry(
  path: string
): Promise<DiskTelemetry> {
  if (!isTauriRuntime()) {
    return BROWSER_DEFAULT_STORAGE.diskTelemetry!;
  }
  return invoke<DiskTelemetry>("probe_storage_path_telemetry", { path });
}

/**
 * Opens a native macOS folder picker using `tauri-plugin-dialog`.
 */
export async function pickDirectoryDialog(
  title: string,
  defaultPath?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    title,
    directory: true,
    multiple: false,
    defaultPath: defaultPath && !defaultPath.startsWith("~") ? defaultPath : undefined,
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Opens a native macOS file picker for `.iso` or `.img` OS installer media.
 */
export async function pickInstallerImageDialog(
  defaultDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    title: "Select Guest OS Installer Media (.iso / .img)",
    directory: false,
    multiple: false,
    defaultPath: defaultDir && !defaultDir.startsWith("~") ? defaultDir : undefined,
    filters: [
      {
        name: "OS Installer Images",
        extensions: ["iso", "img", "raw"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Opens a native macOS folder picker to open an existing `*.etherloom` workspace directory.
 */
export async function pickOpenProjectDialog(
  defaultDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    title: "Open Etherloom Project (.etherloom folder)",
    directory: true,
    multiple: false,
    defaultPath: defaultDir && !defaultDir.startsWith("~") ? defaultDir : undefined,
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Opens a native macOS Save dialog to choose a destination `.etherloom` project path.
 */
export async function pickSaveProjectDialog(
  suggestedName: string,
  defaultDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const cleanName = suggestedName.trim().endsWith(".etherloom")
    ? suggestedName.trim()
    : `${suggestedName.trim() || "untitled-lab"}.etherloom`;
  const defaultPath =
    defaultDir && !defaultDir.startsWith("~")
      ? `${defaultDir.replace(/\/+$/, "")}/${cleanName}`
      : cleanName;

  const selected = await save({
    title: "Save Etherloom Project Workspace",
    defaultPath,
    filters: [
      {
        name: "Etherloom Project Bundle",
        extensions: ["etherloom"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export async function ensureOverlayRebased(
  overlayPath: string,
  templateId?: string | null
): Promise<OverlayRebaseReport> {
  return invoke<OverlayRebaseReport>("ensure_overlay_rebased", {
    overlayPath,
    templateId,
  });
}

export async function rebaseProjectOverlays(
  bindings: OverlayTemplateBinding[]
): Promise<OverlayRebaseReport[]> {
  return invoke<OverlayRebaseReport[]>("rebase_project_overlays", { bindings });
}

// -----------------------------------------------------------------------------
// Phase 1: Image Store & OS Profiles IPC Client
// -----------------------------------------------------------------------------

export async function listOsProfiles(): Promise<OsProfile[]> {
  if (!isTauriRuntime()) {
    return [
      {
        id: "alpine-linux",
        name: "Alpine Linux",
        guestFamily: "linux",
        nicPrefix: "eth",
        nicNamingPattern: "eth{n}",
        altNicNamingPattern: null,
        defaultRamMb: 256,
        defaultCpus: 1,
        recommendedDiskGb: 4,
        notes: "Lightweight musl/BusyBox Linux router & host (virtio-net eth0..n)",
      },
      {
        id: "debian-linux",
        name: "Debian / Generic Linux",
        guestFamily: "linux",
        nicPrefix: "eth",
        nicNamingPattern: "enp0s{n} / eth{n}",
        altNicNamingPattern: "enp0s{n}",
        defaultRamMb: 512,
        defaultCpus: 2,
        recommendedDiskGb: 10,
        notes: "Systemd / FRRouting / Linux network stack",
      },
      {
        id: "freebsd",
        name: "FreeBSD",
        guestFamily: "freebsd",
        nicPrefix: "vtnet",
        nicNamingPattern: "vtnet{n}",
        altNicNamingPattern: null,
        defaultRamMb: 512,
        defaultCpus: 2,
        recommendedDiskGb: 12,
        notes: "FreeBSD ARM64 UEFI guest with virtio vtnet0..n",
      },
      {
        id: "openbsd",
        name: "OpenBSD",
        guestFamily: "openbsd",
        nicPrefix: "vio",
        nicNamingPattern: "vio{n}",
        altNicNamingPattern: null,
        defaultRamMb: 512,
        defaultCpus: 2,
        recommendedDiskGb: 8,
        notes: "OpenBSD ARM64 UEFI guest with pf, bgpd, ospfd & vio0..n",
      },
      {
        id: "netbsd",
        name: "NetBSD",
        guestFamily: "netbsd",
        nicPrefix: "vioif",
        nicNamingPattern: "vioif{n}",
        altNicNamingPattern: null,
        defaultRamMb: 256,
        defaultCpus: 1,
        recommendedDiskGb: 6,
        notes: "NetBSD evbarm-aarch64 UEFI guest with npf & vioif0..n",
      },
    ];
  }
  return invoke<OsProfile[]>("list_os_profiles");
}

export async function listBaseTemplates(): Promise<BaseTemplateInfo[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<BaseTemplateInfo[]>("list_base_templates");
}

export async function listInstallerIsos(): Promise<InstallerMediaInfo[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<InstallerMediaInfo[]>("list_installer_isos");
}

export async function createBlankVmDisk(
  diskPath: string,
  sizeGb: number
): Promise<DiskInfo> {
  return invoke<DiskInfo>("create_blank_vm_disk", {
    request: { diskPath, sizeGb },
  });
}

export async function promoteDiskToTemplate(params: {
  sourceDiskPath: string;
  templateName: string;
  osProfileId: string;
  description?: string | null;
}): Promise<BaseTemplateInfo> {
  return invoke<BaseTemplateInfo>("promote_disk_to_template", {
    request: params,
  });
}

export async function createNodeOverlayDisk(params: {
  templateIdOrPath: string;
  overlaysDir: string;
  nodeId: string;
}): Promise<DiskInfo> {
  return invoke<DiskInfo>("create_node_overlay_disk", {
    request: params,
  });
}

export async function resetNodeOverlayDisk(
  overlayPath: string,
  backingTemplateOverride?: string | null
): Promise<DiskInfo> {
  return invoke<DiskInfo>("reset_node_overlay_disk", {
    request: { overlayPath, backingTemplateOverride },
  });
}

// -----------------------------------------------------------------------------
// Phase 1: QEMU HVF Process Supervisor IPC Client
// -----------------------------------------------------------------------------

export async function spawnVm(request: SpawnVmRequest): Promise<VmInstanceInfo> {
  return invoke<VmInstanceInfo>("spawn_vm", { request });
}

export async function stopVm(
  nodeId: string,
  force = false
): Promise<VmInstanceInfo> {
  return invoke<VmInstanceInfo>("stop_vm", { nodeId, force });
}

export async function listVms(): Promise<VmInstanceInfo[]> {
  return invoke<VmInstanceInfo[]>("list_vms");
}

export async function getVmInfo(nodeId: string): Promise<VmInstanceInfo | null> {
  return invoke<VmInstanceInfo | null>("get_vm_info", { nodeId });
}

export async function previewQemuCommand(
  request: SpawnVmRequest
): Promise<string[]> {
  return invoke<string[]>("preview_qemu_command", { request });
}

// -----------------------------------------------------------------------------
// Phase 1: PacketFabric & Virtual Switches IPC Client
// -----------------------------------------------------------------------------

export async function fabricCreateUdpPort(
  portId?: string,
  vmPort?: number
): Promise<UdpPortBinding> {
  return invoke<UdpPortBinding>("fabric_create_udp_port", { portId, vmPort });
}

export async function fabricRemovePort(portId: string): Promise<void> {
  return invoke<void>("fabric_remove_port", { portId });
}

export async function fabricCreateSwitch(
  name: string,
  portCount: number,
  switchId?: string
): Promise<VirtualDeviceInfo> {
  return invoke<VirtualDeviceInfo>("fabric_create_switch", {
    switchId,
    name,
    portCount,
  });
}

export async function fabricCreateHub(
  name: string,
  portCount: number,
  hubId?: string
): Promise<VirtualDeviceInfo> {
  return invoke<VirtualDeviceInfo>("fabric_create_hub", {
    hubId,
    name,
    portCount,
  });
}

export async function fabricRemoveDevice(deviceId: string): Promise<void> {
  return invoke<void>("fabric_remove_device", { deviceId });
}

export async function fabricCreateLink(params: {
  linkId?: string;
  portA: string;
  portB: string;
  adminUp?: boolean;
  latencyMs?: number;
  jitterMs?: number;
  lossPercent?: number;
}): Promise<LinkSnapshot> {
  return invoke<LinkSnapshot>("fabric_create_link", { request: params });
}

export async function fabricUpdateLink(params: {
  linkId: string;
  adminUp?: boolean;
  latencyMs?: number;
  jitterMs?: number;
  lossPercent?: number;
}): Promise<LinkSnapshot> {
  return invoke<LinkSnapshot>("fabric_update_link", { request: params });
}

export async function fabricRemoveLink(linkId: string): Promise<void> {
  return invoke<void>("fabric_remove_link", { linkId });
}

export async function fabricListLinks(): Promise<LinkSnapshot[]> {
  return invoke<LinkSnapshot[]>("fabric_list_links");
}

export async function fabricGetSwitchMacTable(
  switchId: string
): Promise<MacTableEntry[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<MacTableEntry[]>("fabric_get_switch_mac_table", { switchId });
}

export async function fabricClearSwitchMacTable(
  switchId: string
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>("fabric_clear_switch_mac_table", { switchId });
}

// -----------------------------------------------------------------------------
// Phase 2: Project Persistence (`*.etherloom`) & Topology Orchestration
// -----------------------------------------------------------------------------

export async function createNewProject(params: {
  bundlePath: string;
  name: string;
  notes?: string | null;
}): Promise<ProjectBundleDto> {
  if (!isTauriRuntime()) {
    const cleanBundle = params.bundlePath.endsWith(".etherloom")
      ? params.bundlePath
      : `${params.bundlePath}.etherloom`;
    return {
      bundlePath: cleanBundle,
      topologyFile: `${cleanBundle}/topology.toml`,
      overlaysDir: `${cleanBundle}/overlays`,
      capturesDir: `${cleanBundle}/captures`,
      rebasedOverlays: 0,
      topology: {
        schema_version: 1,
        name: params.name || "Untitled Lab",
        notes: params.notes ?? null,
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
        nodes: [],
        links: [],
      },
    };
  }
  return invoke<ProjectBundleDto>("create_new_project", params);
}

export async function saveProject(
  request: SaveProjectRequest
): Promise<ProjectBundleDto> {
  if (!isTauriRuntime()) {
    const cleanBundle = request.bundlePath.endsWith(".etherloom")
      ? request.bundlePath
      : `${request.bundlePath}.etherloom`;
    return {
      bundlePath: cleanBundle,
      topologyFile: `${cleanBundle}/topology.toml`,
      overlaysDir: `${cleanBundle}/overlays`,
      capturesDir: `${cleanBundle}/captures`,
      rebasedOverlays: 0,
      topology: {
        ...request.topology,
        updated_at_ms: Date.now(),
      },
    };
  }
  return invoke<ProjectBundleDto>("save_project", { request });
}

export async function openProject(path: string): Promise<ProjectBundleDto> {
  return invoke<ProjectBundleDto>("open_project", { path });
}

export async function resetScratchWorkspace(): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("reset_scratch_workspace");
}

export async function syncTopologyFabric(
  topology: TopologyDocument,
  resetFirst = false
): Promise<LinkSnapshot[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<LinkSnapshot[]>("sync_topology_fabric", {
    topology,
    resetFirst,
  });
}

export async function resolveNodeDiskPath(
  bundlePath: string | null,
  node: WorkspaceNode
): Promise<NodeDiskStatusDto> {
  if (!isTauriRuntime()) {
    return {
      diskPath: node.disk_path || `/tmp/etherloom/scratch-overlays/${node.id}.qcow2`,
      exists: false,
      sizeBytes: 0,
    };
  }
  return invoke<NodeDiskStatusDto>("resolve_node_disk_path", {
    bundlePath,
    node,
  });
}

export async function startTopologyVmNode(
  bundlePath: string | null,
  node: WorkspaceNode
): Promise<VmInstanceInfo> {
  return invoke<VmInstanceInfo>("start_topology_vm_node", {
    request: { bundlePath, node },
  });
}

// -----------------------------------------------------------------------------
// Phase 3: Unified Serial (`xterm.js`) & UEFI/VNC (`@novnc/novnc`) Console IPC
// -----------------------------------------------------------------------------

export async function getConsoleSessionEndpoints(
  nodeId: string
): Promise<ConsoleSessionEndpoints> {
  if (!isTauriRuntime()) {
    return {
      nodeId,
      wsPort: 0,
      serialWsUrl: "",
      vncWsUrl: null,
      vncTcpPort: null,
      displayMode: "vnc",
      vmRunning: false,
      serialSocketPath: `/tmp/etherloom/${nodeId}_serial.sock`,
    };
  }
  return invoke<ConsoleSessionEndpoints>("console_get_session_endpoints", {
    nodeId,
  });
}

export async function attachSerialChannel(
  nodeId: string,
  onBytes: (chunk: Uint8Array) => void
): Promise<void> {
  if (!isTauriRuntime()) return;
  const channel = new Channel<number[]>();
  channel.onmessage = (arr) => {
    onBytes(new Uint8Array(arr));
  };
  await invoke<void>("console_attach_serial_channel", { nodeId, channel });
}

export async function writeSerialBytes(
  nodeId: string,
  data: Uint8Array
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("console_write_serial", {
    nodeId,
    data: Array.from(data),
  });
}

export async function writeSerialCommand(
  nodeId: string,
  commandText: string
): Promise<void> {
  const normalized = commandText.endsWith("\n")
    ? commandText
    : `${commandText}\n`;
  const encoder = new TextEncoder();
  await writeSerialBytes(nodeId, encoder.encode(normalized));
}

export async function sendSerialBreak(nodeId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("console_send_serial_break", { nodeId });
}

export async function sendVmCtrlAltDel(nodeId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("console_send_ctrl_alt_del", { nodeId });
}

export async function focusCocoaVmWindow(nodeId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("console_focus_cocoa_window", { nodeId });
}

// -----------------------------------------------------------------------------
// Phase 4: Zero-Root Wiretaps (`.pcap` + Live Wireshark) & `tcpflowy` Dissector
// -----------------------------------------------------------------------------

const BROWSER_MOCK_CAPTURES: CaptureFileInfo[] = [];

export async function startPcapRecording(
  bundlePath: string | null,
  linkId: string,
  linkLabel?: string
): Promise<StartPcapRecordingResult> {
  if (!isTauriRuntime()) {
    const now = Date.now();
    const safe = (linkLabel ?? linkId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safe}_${now}.pcap`;
    const path = `${bundlePath ?? "/tmp/etherloom/scratch-captures"}/captures/${filename}`;
    BROWSER_MOCK_CAPTURES.unshift({
      filename,
      path,
      linkId,
      sizeBytes: 1840,
      packetCount: 12,
      modifiedAtMs: now,
      isRecording: true,
    });
    return { linkId, path, filename, startedAtMs: now };
  }
  return invoke<StartPcapRecordingResult>("pcap_start_recording", {
    bundlePath,
    linkId,
    linkLabel: linkLabel ?? null,
  });
}

export async function stopPcapRecording(
  linkId: string
): Promise<StopPcapRecordingResult> {
  if (!isTauriRuntime()) {
    const hit = BROWSER_MOCK_CAPTURES.find(
      (c) => c.linkId === linkId && c.isRecording
    );
    if (hit) hit.isRecording = false;
    return {
      linkId,
      path: hit?.path ?? `/tmp/etherloom/scratch-captures/${linkId}.pcap`,
      filename: hit?.filename ?? `${linkId}.pcap`,
      packetsWritten: hit?.packetCount ?? 12,
      bytesWritten: hit?.sizeBytes ?? 1840,
      durationMs: 3200,
    };
  }
  return invoke<StopPcapRecordingResult>("pcap_stop_recording", { linkId });
}

export async function startLiveWireshark(
  linkId: string
): Promise<LiveWiresharkSessionInfo> {
  if (!isTauriRuntime()) {
    return {
      linkId,
      fifoPath: `/tmp/etherloom/tap_${linkId}.pcap`,
      wiresharkBin: "/Applications/Wireshark.app/Contents/MacOS/Wireshark",
      pid: 4242,
    };
  }
  return invoke<LiveWiresharkSessionInfo>("pcap_start_live_wireshark", {
    linkId,
  });
}

export async function stopLiveWireshark(linkId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("pcap_stop_live_wireshark", { linkId });
}

export async function listProjectCaptures(
  bundlePath: string | null
): Promise<CaptureFileInfo[]> {
  if (!isTauriRuntime()) {
    return [...BROWSER_MOCK_CAPTURES];
  }
  return invoke<CaptureFileInfo[]>("pcap_list_captures", { bundlePath });
}

export async function deleteProjectCapture(pcapPath: string): Promise<void> {
  if (!isTauriRuntime()) {
    const idx = BROWSER_MOCK_CAPTURES.findIndex((c) => c.path === pcapPath);
    if (idx >= 0) BROWSER_MOCK_CAPTURES.splice(idx, 1);
    return;
  }
  await invoke<void>("pcap_delete_capture", { pcapPath });
}

export async function openPcapInWireshark(pcapPath: string): Promise<string> {
  if (!isTauriRuntime()) {
    return "/Applications/Wireshark.app/Contents/MacOS/Wireshark";
  }
  return invoke<string>("pcap_open_in_wireshark", { pcapPath });
}

export async function pickExternalPcapDialog(
  defaultDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const picked = await open({
    title: "Select Packet Capture (.pcap / .pcapng)",
    directory: false,
    multiple: false,
    defaultPath: defaultDir,
    filters: [
      {
        name: "Packet Capture",
        extensions: ["pcap", "pcapng", "cap"],
      },
    ],
  });
  return typeof picked === "string" ? picked : null;
}

export async function getTcpflowyStatus(): Promise<TcpflowyEnvStatus> {
  if (!isTauriRuntime()) {
    return {
      state: "ready",
      venvDir: "~/Library/Application Support/Etherloom/python-env",
      venvExists: true,
      pythonBin: "~/Library/Application Support/Etherloom/python-env/bin/python3",
      tsharkBin: "/opt/homebrew/bin/tshark",
      installedVersion: "1.1.0",
      localRepoPath: null,
      localRepoValid: false,
      activeSource: "pypi_venv",
      message: "tcpflowy v1.1.0 ready (managed python-env)",
    };
  }
  return invoke<TcpflowyEnvStatus>("tcpflowy_get_status");
}

export async function installOrUpgradeTcpflowy(): Promise<TcpflowyEnvStatus> {
  if (!isTauriRuntime()) {
    return getTcpflowyStatus();
  }
  return invoke<TcpflowyEnvStatus>("tcpflowy_install_or_upgrade");
}

export async function setTcpflowyLocalRepoPath(
  repoPath: string | null
): Promise<TcpflowyEnvStatus> {
  if (!isTauriRuntime()) {
    return {
      ...(await getTcpflowyStatus()),
      localRepoPath: repoPath,
      localRepoValid: Boolean(repoPath),
      activeSource: repoPath ? "local_repo" : "pypi_venv",
    };
  }
  return invoke<TcpflowyEnvStatus>("tcpflowy_set_local_repo_path", {
    repoPath,
  });
}

export async function dissectPcapWithTcpflowy(
  request: DissectPcapRequest
): Promise<TcpflowyDissectionReport> {
  if (!isTauriRuntime()) {
    const pcapName = request.pcapPath.split("/").pop() ?? "capture.pcap";
    return {
      tcpflowyVersion: "1.1.0",
      sourceMode: "venv",
      pcapPath: request.pcapPath,
      pcapName,
      totalPcapPackets: 7,
      suppressedNoiseFlows: 0,
      statistics: {
        total_pcaps: 1,
        total_flows: 1,
        total_packets: 7,
        total_bytes: 642,
        total_payload_bytes: 164,
        flows_by_application: { HTTP: 1 },
        bytes_by_application: { HTTP: 642 },
      },
      passiveDnsMap: { "10.0.1.1": "fw1.etherloom.lab" },
      generatedRules: [
        {
          type: "HTTP_SERVICE",
          streams: ["0"],
          direction: "C->S",
          dst_port: 80,
          hex_mask: null,
          ascii_mask: "fw1.etherloom.lab",
          wireshark_filter: 'http.host == "fw1.etherloom.lab"',
          suricata_rule:
            'alert http any any -> any any (msg:"TCPFLOWY HTTP Service [fw1.etherloom.lab]"; flow:to_server,established; http.host; content:"fw1.etherloom.lab"; sid:1000001; rev:1;)',
        },
      ],
      asciiChart:
        "=== Traffic Volume by Application/Protocol (Bytes) ===\n  HTTP                     | ████████████████████████████████████        642 B (1 flows)",
      rawCliReport:
        "[+] Summary: 1 TCP flows | 7 packets | 642 total bytes (164 payload bytes)",
      flows: [
        {
          pcap: pcapName,
          flow_id: "0",
          src_ip: "10.0.1.10",
          src_port: 54321,
          dst_ip: "10.0.1.1",
          dst_port: 80,
          src_fqdn: "srv1.etherloom.lab",
          dst_fqdn: "fw1.etherloom.lab",
          primary_domain: "fw1.etherloom.lab",
          detected_application: "HTTP",
          is_unknown_traffic: false,
          is_tls_decrypted: false,
          is_background_noise: false,
          noise_reason: null,
          packet_count: 7,
          total_bytes: 642,
          payload_bytes: 164,
          c2s_packets: 4,
          c2s_bytes: 334,
          c2s_payload_bytes: 78,
          s2c_packets: 3,
          s2c_bytes: 308,
          s2c_payload_bytes: 86,
          direction_profile: "BIDIRECTIONAL",
          splt_lengths: [78, -86],
          splt_iats_ms: [4.2],
          splt_signature: "+78B -> -86B",
          avg_iat_ms: 4.2,
          payload_entropy: 4.38,
          entropy_profile: "PLAINTEXT/ASCII",
          duration_sec: 0.027,
          protocols: ["eth", "ethertype", "ip", "tcp", "http"],
          sni_list: [],
          alpn_list: [],
          tls_version: null,
          ja3_list: [],
          cert_subjects: [],
          http_methods: ["GET"],
          http_hosts: ["fw1.etherloom.lab"],
          http_uris: ["/api/v1/routes"],
          http_user_agents: ["curl/8.6.0"],
          payload_samples: [],
          c2s_payload_samples: [],
          s2c_payload_samples: [],
          handshakeState: "COMPLETE (FIN)",
          retransmissions: 0,
          outOfOrder: 0,
          zeroWindows: 0,
          rstCount: 0,
          segments: [
            {
              frameNumber: 1,
              relTimeMs: 0,
              direction: "C->S",
              flags: ["SYN"],
              seq: 0,
              ack: 0,
              payloadLen: 0,
              frameLen: 54,
              window: 64240,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "",
            },
            {
              frameNumber: 2,
              relTimeMs: 4.5,
              direction: "S->C",
              flags: ["SYN", "ACK"],
              seq: 0,
              ack: 1,
              payloadLen: 0,
              frameLen: 54,
              window: 65535,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "",
            },
            {
              frameNumber: 3,
              relTimeMs: 9.0,
              direction: "C->S",
              flags: ["ACK"],
              seq: 1,
              ack: 1,
              payloadLen: 0,
              frameLen: 54,
              window: 64240,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "",
            },
            {
              frameNumber: 4,
              relTimeMs: 13.5,
              direction: "C->S",
              flags: ["PSH", "ACK"],
              seq: 1,
              ack: 1,
              payloadLen: 78,
              frameLen: 132,
              window: 64240,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "GET /api/v1/routes HTTP/1.1  Host: fw1.etherloom",
            },
            {
              frameNumber: 5,
              relTimeMs: 18.0,
              direction: "S->C",
              flags: ["PSH", "ACK"],
              seq: 1,
              ack: 79,
              payloadLen: 86,
              frameLen: 140,
              window: 65535,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "HTTP/1.1 200 OK  Content-Type: application/json",
            },
            {
              frameNumber: 6,
              relTimeMs: 22.5,
              direction: "C->S",
              flags: ["FIN", "ACK"],
              seq: 79,
              ack: 87,
              payloadLen: 0,
              frameLen: 54,
              window: 64240,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "",
            },
            {
              frameNumber: 7,
              relTimeMs: 27.0,
              direction: "S->C",
              flags: ["FIN", "ACK"],
              seq: 87,
              ack: 80,
              payloadLen: 0,
              frameLen: 54,
              window: 65535,
              isRetransmission: false,
              isOutOfOrder: false,
              isZeroWindow: false,
              preview: "",
            },
          ],
          streamReconstruction: {
            c2sAscii:
              "GET /api/v1/routes HTTP/1.1\r\nHost: fw1.etherloom.lab\r\nUser-Agent: curl/8.6.0\r\n\r\n",
            c2sHex: "47 45 54 20 2f 61 70 69 2f 76 31 2f 72 6f 75 74 65 73",
            s2cAscii:
              'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"bgp":"established"}',
            s2cHex: "48 54 54 50 2f 31 2e 31 20 32 30 30 20 4f 4b",
            turns: [
              {
                direction: "C->S",
                bytes: 78,
                ascii:
                  "GET /api/v1/routes HTTP/1.1\r\nHost: fw1.etherloom.lab\r\nUser-Agent: curl/8.6.0\r\n\r\n",
                hex: "47 45 54 20 2f 61 70 69 2f 76 31 2f 72 6f 75 74 65 73",
              },
              {
                direction: "S->C",
                bytes: 86,
                ascii:
                  'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"bgp":"established"}',
                hex: "48 54 54 50 2f 31 2e 31 20 32 30 30 20 4f 4b",
              },
            ],
          },
        },
      ],
    };
  }
  return invoke<TcpflowyDissectionReport>("tcpflowy_dissect_pcap", { request });
}

// -----------------------------------------------------------------------------
// Typed Event Subscriptions
// -----------------------------------------------------------------------------

export async function onVmStateChanged(
  handler: (event: VmStateEvent) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<VmStateEvent>("etherloom://vm-state", (e) => handler(e.payload));
}

export async function onFabricMetrics(
  handler: (event: FabricTelemetryEvent) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<FabricTelemetryEvent>("etherloom://fabric-metrics", (e) =>
    handler(e.payload)
  );
}

export async function onStorageStatusChanged(
  handler: (snapshot: StorageStateSnapshot) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<StorageStateSnapshot>("etherloom://storage-status", (e) =>
    handler(e.payload)
  );
}

export async function onStorageMigrationProgress(
  handler: (progress: StorageMigrationProgress) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<StorageMigrationProgress>(
    "etherloom://storage-migration-progress",
    (e) => handler(e.payload)
  );
}

export async function onTcpflowyInstallProgress(
  handler: (progress: TcpflowyInstallProgress) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<TcpflowyInstallProgress>(
    "etherloom://tcpflowy-install-progress",
    (e) => handler(e.payload)
  );
}

// -----------------------------------------------------------------------------
// Phase 5: Interactive Networking Academy & Guided Labs IPC Client
// -----------------------------------------------------------------------------

const BROWSER_FALLBACK_LABS: AcademyLabSummary[] = [
  {
    id: "01-ethernet-hubs-switches-arp",
    number: 1,
    title: "Ethernet, Hubs vs. Switches & ARP Under the Microscope",
    subtitle:
      "Compare shared-medium L1 Hubs against learning L2 Switches, capture ARP broadcasts, and watch 802.1D MAC tables populate live.",
    difficulty: "Beginner",
    estimatedMinutes: 20,
    tags: ["L2/ARP", "Switching", "Hubs vs. Switches", "Wireshark"],
    nodeCount: 5,
    linkCount: 3,
    stepCount: 4,
    requiredTemplates: [
      {
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: true,
    sourceKind: "builtin",
  },
  {
    id: "02-ip-subnetting-static-routing",
    number: 2,
    title: "IP Subnetting & Static Routing From Scratch",
    subtitle:
      "Bridge two isolated /24 subnets by turning a dual-homed host into an IPv4 router, and verify MAC rewrites & TTL decrements on the wire.",
    difficulty: "Beginner",
    estimatedMinutes: 25,
    tags: ["Routing", "IPv4 Subnets", "ICMP/TTL", "Linux"],
    nodeCount: 3,
    linkCount: 2,
    stepCount: 4,
    requiredTemplates: [
      {
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: true,
    sourceKind: "builtin",
  },
  {
    id: "03-openbsd-pf-stateful-nat",
    number: 3,
    title: "Stateful Firewalls & NAT with OpenBSD pf",
    subtitle:
      "Write an idiomatic /etc/pf.conf from scratch on an OpenBSD gateway: default-deny policy, NAT masquerading (nat-to), and port forwarding (rdr-to).",
    difficulty: "Intermediate",
    estimatedMinutes: 30,
    tags: ["OpenBSD PF", "NAT", "Port Forwarding", "tcpflowy"],
    nodeCount: 3,
    linkCount: 2,
    stepCount: 4,
    requiredTemplates: [
      {
        osProfileId: "openbsd",
        osProfileName: "OpenBSD",
        guestFamily: "openbsd",
        satisfied: false,
        matchedTemplateId: null,
        matchedTemplateName: null,
      },
      {
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: false,
    sourceKind: "builtin",
  },
  {
    id: "04-openbsd-carp-pfsync-ha",
    number: 4,
    title: "High-Availability Failover with OpenBSD CARP + pfsync",
    subtitle:
      "Build an active/standby OpenBSD firewall cluster sharing virtual gateway IPs via CARP and replicating live pf TCP states over pfsync.",
    difficulty: "Advanced",
    estimatedMinutes: 35,
    tags: ["OpenBSD PF", "CARP / HA", "pfsync", "Cable Cut", "tcpflowy"],
    nodeCount: 6,
    linkCount: 7,
    stepCount: 4,
    requiredTemplates: [
      {
        osProfileId: "openbsd",
        osProfileName: "OpenBSD",
        guestFamily: "openbsd",
        satisfied: false,
        matchedTemplateId: null,
        matchedTemplateName: null,
      },
      {
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: false,
    sourceKind: "builtin",
  },
  {
    id: "05-tcp-handshakes-window-loss",
    number: 5,
    title: "Dissecting TCP: Handshakes, Window Scaling & Packet Loss",
    subtitle:
      "Transfer bulk streams across an impaired wire (80ms latency, 5% packet loss) and dissect 3-way handshakes, duplicate ACKs, and retransmissions in tcpflowy.",
    difficulty: "Intermediate",
    estimatedMinutes: 25,
    tags: ["TCP Internals", "Retransmissions", "Link Impairments", "tcpflowy"],
    nodeCount: 2,
    linkCount: 1,
    stepCount: 4,
    requiredTemplates: [
      {
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: true,
    sourceKind: "builtin",
  },
];

export async function listAcademyLabs(): Promise<AcademyLabSummary[]> {
  if (!isTauriRuntime()) {
    return BROWSER_FALLBACK_LABS;
  }
  return invoke<AcademyLabSummary[]>("academy_list_labs");
}

export async function getAcademyLab(labId: string): Promise<AcademyLabDetail> {
  if (!isTauriRuntime()) {
    const summary =
      BROWSER_FALLBACK_LABS.find((l) => l.id === labId) ??
      BROWSER_FALLBACK_LABS[0];
    return {
      summary,
      steps: [
        {
          id: "step-1",
          title: "Step 1: Boot & Configure Interfaces",
          summary: "Assign IPv4 addresses and verify link state.",
          highlightLinks: ["link-lossy-wan"],
        },
      ],
      guideMarkdown: `# ${summary.title}\n\n${summary.subtitle}\n\n- [ ] Complete Step 1`,
      topology: {
        schema_version: 1,
        name: summary.title,
        notes: summary.subtitle,
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
        nodes: [
          {
            id: "node-tcp-client",
            name: "tcp-client",
            kind: "vm",
            guest_family: "linux",
            os_profile_id: "alpine-linux",
            vcpus: 1,
            memory_mb: 256,
            display_mode: "vnc",
            position: { x: 110, y: 175 },
            ports: [
              {
                id: "node-tcp-client-p0",
                index: 0,
                label: "eth0",
                mac: "52:54:00:50:00:10",
                ip_label: "10.50.0.10/24",
              },
            ],
          },
          {
            id: "node-tcp-server",
            name: "tcp-server",
            kind: "vm",
            guest_family: "linux",
            os_profile_id: "alpine-linux",
            vcpus: 1,
            memory_mb: 256,
            display_mode: "vnc",
            position: { x: 665, y: 175 },
            ports: [
              {
                id: "node-tcp-server-p0",
                index: 0,
                label: "eth0",
                mac: "52:54:00:50:00:20",
                ip_label: "10.50.0.20/24",
              },
            ],
          },
        ],
        links: [
          {
            id: "link-lossy-wan",
            source_node: "node-tcp-client",
            source_port: "node-tcp-client-p0",
            target_node: "node-tcp-server",
            target_port: "node-tcp-server-p0",
            admin_up: true,
            impairments: { latency_ms: 80, jitter_ms: 0, loss_percent: 5.0 },
          },
        ],
      },
    };
  }
  return invoke<AcademyLabDetail>("academy_get_lab", { labId });
}

export async function instantiateAcademyLab(
  labId: string,
  resetClean = true
): Promise<InstantiatedLabDto> {
  if (!isTauriRuntime()) {
    const lab = await getAcademyLab(labId);
    const bundlePath = `/tmp/etherloom/academy-${labId}.etherloom`;
    return {
      lab,
      bundle: {
        bundlePath,
        topologyFile: `${bundlePath}/topology.toml`,
        overlaysDir: `${bundlePath}/overlays`,
        capturesDir: `${bundlePath}/captures`,
        rebasedOverlays: 0,
        topology: lab.topology,
      },
      autoBoundTemplates: 1,
    };
  }
  return invoke<InstantiatedLabDto>("academy_instantiate_lab", {
    labId,
    resetClean,
  });
}
