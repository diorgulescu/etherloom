import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AcademyLabDetail,
  AcademyLabSummary,
  ActivityMonitorSnapshot,
  BaseTemplateInfo,
  CaptureFileInfo,
  CaptureSummary,
  CatalogComponent,
  CatalogDownloadProgressEvent,
  ConsoleSessionEndpoints,
  DeleteCatalogImageResult,
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
  OsCatalogEntryDto,
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
    warningCount: 6,
    qemuSystemAarch64: emptyProbe("qemu-system-aarch64"),
    qemuSystemX86_64: emptyProbe("qemu-system-x86_64"),
    qemuSystemI386: emptyProbe("qemu-system-i386"),
    qemuSystemRiscv64: emptyProbe("qemu-system-riscv64"),
    qemuImg: emptyProbe("qemu-img"),
    edk2Aarch64Code: emptyProbe("edk2-aarch64-code.fd"),
    edk2X86_64Code: emptyProbe("edk2-x86_64-code.fd"),
    wireshark: emptyProbe("Wireshark"),
    python3: emptyProbe("python3"),
    uv: emptyProbe("uv"),
    checks: [
      {
        id: "qemu-system-aarch64",
        title: "QEMU System Emulator (qemu-system-aarch64)",
        category: "Hypervisor & Compute",
        requiredFor: "Booting ARM64 Linux, BSD & Router guests with native -accel hvf",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install qemu",
        details: "Run inside Tauri desktop shell to execute live host probe",
        searchedPaths: ["/opt/homebrew/bin/qemu-system-aarch64", "/usr/local/bin/qemu-system-aarch64"],
      },
      {
        id: "qemu-multi-arch",
        title: "QEMU Multi-Architecture Emulators (x86_64 / i386 / riscv64)",
        category: "Hypervisor & Compute",
        requiredFor: "OPNsense, pfSense, VyOS, OmniOS, DragonFly BSD, Haiku & FreeDOS",
        badge: "warning",
        found: false,
        path: null,
        version: null,
        remediation: "brew install qemu",
        details: "Installed automatically by Homebrew's `qemu` formula",
        searchedPaths: ["/opt/homebrew/bin/qemu-system-x86_64", "/opt/homebrew/bin/qemu-system-i386"],
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
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
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
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
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
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "vtnet",
        nicNamingPattern: "vtnet{n}",
        altNicNamingPattern: "em{n}",
        defaultRamMb: 512,
        defaultCpus: 2,
        recommendedDiskGb: 12,
        notes: "FreeBSD ARM64 UEFI guest with virtio vtnet0..n (or em0..n)",
      },
      {
        id: "openbsd",
        name: "OpenBSD",
        guestFamily: "openbsd",
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "vio",
        nicNamingPattern: "vio{n}",
        altNicNamingPattern: "em{n}",
        defaultRamMb: 512,
        defaultCpus: 2,
        recommendedDiskGb: 8,
        notes: "OpenBSD ARM64 UEFI guest with pf, bgpd, ospfd & vio0..n",
      },
      {
        id: "netbsd",
        name: "NetBSD",
        guestFamily: "netbsd",
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "vioif",
        nicNamingPattern: "vioif{n}",
        altNicNamingPattern: "wm{n}",
        defaultRamMb: 256,
        defaultCpus: 1,
        recommendedDiskGb: 6,
        notes: "NetBSD evbarm-aarch64 UEFI guest with npf & vioif0..n",
      },
      {
        id: "openwrt",
        name: "OpenWrt",
        guestFamily: "linux",
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "eth",
        nicNamingPattern: "eth{n}",
        altNicNamingPattern: null,
        defaultRamMb: 128,
        defaultCpus: 1,
        recommendedDiskGb: 2,
        notes: "Ultra-fast embedded router (UCI, nftables, LuCI)",
      },
      {
        id: "mikrotik-chr",
        name: "MikroTik RouterOS CHR",
        guestFamily: "linux",
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "ether",
        nicNamingPattern: "ether{n+1}",
        altNicNamingPattern: null,
        defaultRamMb: 256,
        defaultCpus: 2,
        recommendedDiskGb: 2,
        notes: "MikroTik Cloud Hosted Router v7 ARM64 (ether1..n)",
      },
      {
        id: "vyos",
        name: "VyOS",
        guestFamily: "linux",
        arch: "x86_64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "bios",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "eth",
        nicNamingPattern: "eth{n}",
        altNicNamingPattern: null,
        defaultRamMb: 1024,
        defaultCpus: 2,
        recommendedDiskGb: 8,
        notes: "Enterprise Juniper-style CLI router (FRRouting BGP/OSPF/MPLS)",
      },
      {
        id: "opnsense",
        name: "OPNsense",
        guestFamily: "freebsd",
        arch: "x86_64",
        defaultNicModel: "e1000",
        defaultFirmware: "bios",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "em",
        nicNamingPattern: "em{n} / vtnet{n}",
        altNicNamingPattern: "vtnet{n}",
        defaultRamMb: 2048,
        defaultCpus: 2,
        recommendedDiskGb: 16,
        notes: "HardenedBSD firewall appliance (nano serial image)",
      },
      {
        id: "pfsense",
        name: "pfSense CE",
        guestFamily: "freebsd",
        arch: "x86_64",
        defaultNicModel: "e1000",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "em",
        nicNamingPattern: "em{n} / vtnet{n}",
        altNicNamingPattern: "vtnet{n}",
        defaultRamMb: 2048,
        defaultCpus: 2,
        recommendedDiskGb: 16,
        notes: "Classic FreeBSD pf enterprise firewall appliance",
      },
      {
        id: "9front",
        name: "9front (Plan 9)",
        guestFamily: "other",
        arch: "aarch64",
        defaultNicModel: "virtio-net-pci",
        defaultFirmware: "uefi",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "/net/ether",
        nicNamingPattern: "/net/ether{n}",
        altNicNamingPattern: null,
        defaultRamMb: 512,
        defaultCpus: 2,
        recommendedDiskGb: 4,
        notes: "Bell Labs Plan 9 distributed OS (/net/ipifc)",
      },
      {
        id: "omnios",
        name: "OmniOS (Illumos)",
        guestFamily: "other",
        arch: "x86_64",
        defaultNicModel: "e1000",
        defaultFirmware: "bios",
        defaultDiskBus: "virtio-blk",
        nicPrefix: "e1000g",
        nicNamingPattern: "e1000g{n} / vioif{n}",
        altNicNamingPattern: "vioif{n}",
        defaultRamMb: 2048,
        defaultCpus: 2,
        recommendedDiskGb: 16,
        notes: "OpenSolaris/Illumos Crossbow (dladm/ipadm, DTrace, Zones)",
      },
      {
        id: "dragonflybsd",
        name: "DragonFly BSD",
        guestFamily: "freebsd",
        arch: "x86_64",
        defaultNicModel: "e1000",
        defaultFirmware: "bios",
        defaultDiskBus: "ahci",
        nicPrefix: "em",
        nicNamingPattern: "em{n} / vtnet{n}",
        altNicNamingPattern: "vtnet{n}",
        defaultRamMb: 1024,
        defaultCpus: 2,
        recommendedDiskGb: 12,
        notes: "LWKT per-CPU network stack & HAMMER2 filesystem",
      },
      {
        id: "haiku",
        name: "Haiku OS",
        guestFamily: "other",
        arch: "x86_64",
        defaultNicModel: "e1000",
        defaultFirmware: "uefi",
        defaultDiskBus: "ahci",
        nicPrefix: "/dev/net/ipro1000/",
        nicNamingPattern: "/dev/net/ipro1000/{n}",
        altNicNamingPattern: null,
        defaultRamMb: 1024,
        defaultCpus: 2,
        recommendedDiskGb: 8,
        notes: "BeOS spiritual successor with graphical desktop over VNC",
      },
      {
        id: "freedos",
        name: "FreeDOS + mTCP",
        guestFamily: "other",
        arch: "i386",
        defaultNicModel: "pcnet",
        defaultFirmware: "bios",
        defaultDiskBus: "ide",
        nicPrefix: "PCNTPK",
        nicNamingPattern: "PCNTPK 0x60",
        altNicNamingPattern: "NE2000 0x60",
        defaultRamMb: 32,
        defaultCpus: 1,
        recommendedDiskGb: 1,
        notes: "16/32-bit DOS Crynwr packet drivers + mTCP userspace stack",
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

function formatBrowserCaptureTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate()
  )}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds()
  )}`;
}

export async function startPcapRecording(
  bundlePath: string | null,
  linkId: string,
  linkLabel?: string,
  endpointA?: string,
  endpointB?: string
): Promise<StartPcapRecordingResult> {
  if (!isTauriRuntime()) {
    const now = Date.now();
    const cleanToken = (raw: string) =>
      raw
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "") || "endpoint";
    const stem =
      endpointA && endpointB
        ? `${cleanToken(endpointA)}__${cleanToken(endpointB)}`
        : (linkLabel ?? linkId).replace(/[^a-zA-Z0-9_-]/g, "-");
    const filename = `${stem}__${formatBrowserCaptureTimestamp(
      new Date(now)
    )}.pcap`;
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
    endpointA: endpointA ?? null,
    endpointB: endpointB ?? null,
  });
}

export async function stopWireCapture(linkId: string): Promise<CaptureSummary> {
  if (!isTauriRuntime()) {
    const hit = BROWSER_MOCK_CAPTURES.find(
      (c) => c.linkId === linkId && c.isRecording
    );
    if (hit) hit.isRecording = false;
    const filePath =
      hit?.path ?? `/tmp/etherloom/scratch-captures/${linkId}.pcap`;
    const packetCount = hit?.packetCount ?? 12;
    const byteSize = hit?.sizeBytes ?? 1840;
    return {
      captureId: `${linkId}__${Date.now()}`,
      linkId,
      filePath,
      path: filePath,
      filename: hit?.filename ?? `${linkId}.pcap`,
      packetCount,
      packetsWritten: packetCount,
      byteSize,
      bytesWritten: byteSize,
      durationMs: 3200,
    };
  }
  return invoke<CaptureSummary>("stop_wire_capture", { linkId });
}

export async function stopPcapRecording(
  linkId: string
): Promise<StopPcapRecordingResult> {
  return stopWireCapture(linkId);
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

export async function openPcapInWireshark(pcapPath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("open_pcap_in_wireshark", { pcapPath });
}

export async function exportPcapCopy(
  sourcePcapPath: string,
  destinationPath: string
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("export_pcap_copy", {
    sourcePcapPath,
    destinationPath,
  });
}

export async function revealPcapInFinder(pcapPath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("reveal_pcap_in_finder", { pcapPath });
}

/**
 * Opens a native macOS Save File dialog pre-populated with `<nodeA>-<nicA>__<nodeB>-<nicB>__<timestamp>.pcap`.
 */
export async function pickSavePcapDialog(
  suggestedFilename: string,
  defaultDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    const clean = suggestedFilename.trim().endsWith(".pcap")
      ? suggestedFilename.trim()
      : `${suggestedFilename.trim() || "capture"}.pcap`;
    return `/tmp/etherloom/${clean}`;
  }
  const cleanName = suggestedFilename.trim().endsWith(".pcap")
    ? suggestedFilename.trim()
    : `${suggestedFilename.trim() || "capture"}.pcap`;
  const defaultPath =
    defaultDir && !defaultDir.startsWith("~")
      ? `${defaultDir.replace(/\/+$/, "")}/${cleanName}`
      : cleanName;

  const selected = await save({
    title: "Save Packet Capture (.pcap)",
    defaultPath,
    filters: [
      {
        name: "Packet Capture",
        extensions: ["pcap"],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
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
    requiredCatalogIds: ["alpine-linux"],
    requiredTemplates: [
      {
        catalogId: "alpine-linux",
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        arch: "aarch64",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: true,
    sourceKind: "builtin",
  },
  {
    id: "06-freedos-mtcp-zero-noise",
    number: 6,
    title: "Zero-Noise ARP & TCP Dissection with FreeDOS (mTCP)",
    subtitle:
      "Eliminate modern OS background chatter completely by pairing 32-bit FreeDOS (PCNTPK 0x60 + mTCP) with an IPv6-quieted Alpine server—capturing the exact 4 frames of ARP+ICMP and a pure TCP stream in tcpflowy.",
    difficulty: "Beginner",
    estimatedMinutes: 20,
    tags: ["Zero-Noise", "FreeDOS i386", "ARP", "TCP Internals", "tcpflowy"],
    nodeCount: 2,
    linkCount: 1,
    stepCount: 4,
    requiredCatalogIds: ["freedos", "alpine-linux"],
    requiredTemplates: [
      {
        catalogId: "freedos",
        osProfileId: "freedos",
        osProfileName: "FreeDOS + mTCP",
        guestFamily: "other",
        arch: "i386",
        satisfied: false,
        matchedTemplateId: null,
        matchedTemplateName: null,
      },
      {
        catalogId: "alpine-linux",
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        arch: "aarch64",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: false,
    sourceKind: "builtin",
  },
  {
    id: "07-openwrt-8021q-vlans",
    number: 7,
    title: "802.1Q VLAN Segmentation, Trunking & Inter-VLAN Routing on OpenWrt",
    subtitle:
      "Configure modern OpenWrt UCI bridge-vlan filtering (no legacy swconfig!), prove L2 broadcast isolation, capture double-tagged 802.1Q frames on a trunk wire, and enforce fw4/nftables zone rules.",
    difficulty: "Intermediate",
    estimatedMinutes: 30,
    tags: ["802.1Q VLANs", "OpenWrt ARM64", "Bridge-VLAN / DSA", "L2 Isolation"],
    nodeCount: 4,
    linkCount: 3,
    stepCount: 4,
    requiredCatalogIds: ["openwrt", "alpine-linux"],
    requiredTemplates: [
      {
        catalogId: "openwrt",
        osProfileId: "openwrt",
        osProfileName: "OpenWrt",
        guestFamily: "linux",
        arch: "aarch64",
        satisfied: false,
        matchedTemplateId: null,
        matchedTemplateName: null,
      },
      {
        catalogId: "alpine-linux",
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        arch: "aarch64",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: false,
    sourceKind: "builtin",
  },
  {
    id: "08-mikrotik-openbsd-ebgp",
    number: 8,
    title:
      "Multi-Vendor eBGP Peering & Route Failover: MikroTik CHR v7 ↔ OpenBSD (OpenBGPD)",
    subtitle:
      "Establish RFC 8212-compliant eBGP sessions over TCP/179 between MikroTik RouterOS v7 (AS 65001) and OpenBSD OpenBGPD (AS 65002), dissect BGP OPEN/UPDATE/KEEPALIVE in tcpflowy, and test live Cut Cable failover.",
    difficulty: "Advanced",
    estimatedMinutes: 35,
    tags: ["eBGP", "MikroTik CHR v7", "OpenBSD OpenBGPD", "RFC 8212", "TCP/179"],
    nodeCount: 4,
    linkCount: 4,
    stepCount: 4,
    requiredCatalogIds: ["mikrotik-chr", "openbsd", "alpine-linux"],
    requiredTemplates: [
      {
        catalogId: "mikrotik-chr",
        osProfileId: "mikrotik-chr",
        osProfileName: "MikroTik RouterOS CHR",
        guestFamily: "linux",
        arch: "aarch64",
        satisfied: false,
        matchedTemplateId: null,
        matchedTemplateName: null,
      },
      {
        catalogId: "openbsd",
        osProfileId: "openbsd",
        osProfileName: "OpenBSD",
        guestFamily: "openbsd",
        arch: "aarch64",
        satisfied: false,
        matchedTemplateId: null,
        matchedTemplateName: null,
      },
      {
        catalogId: "alpine-linux",
        osProfileId: "alpine-linux",
        osProfileName: "Alpine Linux",
        guestFamily: "linux",
        arch: "aarch64",
        satisfied: true,
        matchedTemplateId: "tpl-alpine",
        matchedTemplateName: "Alpine Linux 3.20",
      },
    ],
    allTemplatesReady: false,
    sourceKind: "builtin",
  },
];

function syncBrowserFallbackLabReadiness(): AcademyLabSummary[] {
  return BROWSER_FALLBACK_LABS.map((lab) => {
    const updatedReqs = lab.requiredTemplates.map((req) => {
      const catId = req.catalogId ?? req.osProfileId;
      const catEntry = BROWSER_FALLBACK_OS_CATALOG.find(
        (e) => e.id === catId || e.osProfileId === req.osProfileId
      );
      if (catEntry && catEntry.availability === "ready") {
        return {
          ...req,
          satisfied: true,
          matchedTemplateId: catEntry.templateId ?? `tpl-${catId}`,
          matchedTemplateName: catEntry.name,
        };
      }
      return req;
    });
    return {
      ...lab,
      requiredTemplates: updatedReqs,
      allTemplatesReady: updatedReqs.every((r) => r.satisfied),
    };
  });
}

export async function listAcademyLabs(): Promise<AcademyLabSummary[]> {
  if (!isTauriRuntime()) {
    return syncBrowserFallbackLabReadiness();
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

// -----------------------------------------------------------------------------
// Phase 6: Curated 15-OS Catalog & On-Demand Image Download Manager IPC Client
// -----------------------------------------------------------------------------

const BROWSER_FALLBACK_OS_CATALOG: OsCatalogEntryDto[] = [
  {
    id: "alpine-linux",
    name: "Alpine Linux",
    version: "3.21 Cloud ARM64",
    category: "Linux",
    guestFamily: "linux",
    osProfileId: "alpine-linux",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "eth0, eth1 …",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 1,
    defaultRamMb: 256,
    recommendedDiskGb: 4,
    estimatedDownloadMb: 58,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/cloud/nocloud_alpine-3.21.3-aarch64-uefi-tiny-r0.qcow2",
    checksumUrl: null,
    officialSiteUrl: "https://alpinelinux.org/cloud/",
    defaultCredentials: "root (passwordless on serial ttyAMA0)",
    summary:
      "Featherweight musl + BusyBox Linux router & service host booting in ~2 seconds via native ARM64 HVF.",
    quirksAndTips: [
      "Interfaces enumerate predictably as eth0, eth1 in PCI slot order.",
      "Configure IPs instantly via `ip addr add 10.0.1.10/24 dev eth0 && ip link set eth0 up`.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "debian-linux",
    name: "Debian Cloud",
    version: "12 Bookworm ARM64",
    category: "Linux",
    guestFamily: "linux",
    osProfileId: "debian-linux",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "enp0s1 / eth0 …",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 512,
    recommendedDiskGb: 10,
    estimatedDownloadMb: 340,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-nocloud-arm64.qcow2",
    checksumUrl: null,
    officialSiteUrl: "https://cloud.debian.org/images/cloud/",
    defaultCredentials: "root (passwordless console on nocloud image)",
    summary:
      "Full glibc + systemd Debian 12 nocloud image ideal for FRRouting, WireGuard, nftables, and Python/Go services.",
    quirksAndTips: [
      "The `nocloud` variant logs `root` in directly on serial console without requiring cloud-init seed ISOs.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "freebsd",
    name: "FreeBSD",
    version: "14.2-RELEASE ARM64",
    category: "BSD Family",
    guestFamily: "freebsd",
    osProfileId: "freebsd",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "vtnet0, vtnet1 (or em0 with e1000)",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 512,
    recommendedDiskGb: 12,
    estimatedDownloadMb: 620,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://download.freebsd.org/releases/VM-IMAGES/14.2-RELEASE/aarch64/Latest/FreeBSD-14.2-RELEASE-arm64-aarch64.qcow2.xz",
    checksumUrl: null,
    officialSiteUrl: "https://www.freebsd.org/where/",
    defaultCredentials: "root (no password)",
    summary:
      "Official FreeBSD 14.2 ARM64 VM image featuring VNET jails, pf/ipfw, dummynet, CARP, and ZFS.",
    quirksAndTips: [
      "VirtIO NICs appear as `vtnet0`, `vtnet1`; Intel e1000 NICs appear as `em0`, `em1`.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "openbsd",
    name: "OpenBSD",
    version: "7.6 ARM64",
    category: "BSD Family",
    guestFamily: "openbsd",
    osProfileId: "openbsd",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "vio0, vio1 (or em0 with e1000)",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 512,
    recommendedDiskGb: 8,
    estimatedDownloadMb: 495,
    deliveryKind: "guided_installer",
    downloadUrl: "https://cdn.openbsd.org/pub/OpenBSD/7.6/arm64/install76.img",
    checksumUrl: "https://cdn.openbsd.org/pub/OpenBSD/7.6/arm64/SHA256",
    officialSiteUrl: "https://www.openbsd.org/arm64.html",
    defaultCredentials: "root (set during 2-minute installer)",
    summary:
      "Reference platform for pf stateful firewalling, CARP + pfsync HA, OpenBGPD, ospfd, and relayd.",
    quirksAndTips: [
      "OpenBSD ships verified installer images (`install76.img` + `SHA256`) rather than pre-baked cloud disks.",
      "Click 'Launch Guided Template Setup' — at `boot>` type `set tty com0`, install to `sd0`, and run `halt -p` to auto-promote!",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "netbsd",
    name: "NetBSD",
    version: "10.1 evbarm-aarch64",
    category: "BSD Family",
    guestFamily: "netbsd",
    osProfileId: "netbsd",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "vioif0, vioif1 (or wm0 with e1000)",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 1,
    defaultRamMb: 256,
    recommendedDiskGb: 6,
    estimatedDownloadMb: 330,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://cdn.netbsd.org/pub/NetBSD/NetBSD-10.1/evbarm-aarch64/binary/gzimg/arm64.img.gz",
    checksumUrl: null,
    officialSiteUrl: "https://wiki.netbsd.org/ports/evbarm/",
    defaultCredentials: "root (no password)",
    summary:
      "Clean, portable BSD UNIX featuring the NPF packet filter, rump kernels, and pre-installed bootable `arm64.img`.",
    quirksAndTips: [
      "Automatically resizes root FFS partition on first UEFI boot.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "openwrt",
    name: "OpenWrt",
    version: "23.05.5 armsr/armv8",
    category: "Routers & Firewalls",
    guestFamily: "linux",
    osProfileId: "openwrt",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "eth0 (br-lan), eth1 (wan)",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 1,
    defaultRamMb: 128,
    recommendedDiskGb: 2,
    estimatedDownloadMb: 14,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://downloads.openwrt.org/releases/23.05.5/targets/armsr/armv8/openwrt-23.05.5-armsr-armv8-generic-ext4-combined-efi.img.gz",
    checksumUrl: null,
    officialSiteUrl: "https://openwrt.org/",
    defaultCredentials: "root (press Enter on serial for instant root shell)",
    summary:
      "14 MB ARM64 embedded router OS with UCI declarative config, fw4/nftables, dnsmasq, and 802.1Q VLAN bridges.",
    quirksAndTips: [
      "Press Enter in the serial terminal after boot messages settle to open root ash shell.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "mikrotik-chr",
    name: "MikroTik RouterOS CHR",
    version: "7.16.2 Stable ARM64",
    category: "Routers & Firewalls",
    guestFamily: "linux",
    osProfileId: "mikrotik-chr",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "ether1, ether2, ether3 (1-based)",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 256,
    recommendedDiskGb: 2,
    estimatedDownloadMb: 55,
    deliveryKind: "direct_template",
    downloadUrl: "https://download.mikrotik.com/routeros/7.16.2/chr-7.16.2-arm64.img.zip",
    checksumUrl: null,
    officialSiteUrl: "https://mikrotik.com/download",
    defaultCredentials: "admin / (blank password — prompts on first login)",
    summary:
      "Native ARM64 Cloud Hosted Router running at full Apple Silicon HVF speed with BGP, OSPF, MPLS, VXLAN, and WireGuard.",
    quirksAndTips: [
      "Interfaces are 1-indexed (`ether1`, `ether2`). Free tier supports unlimited lab features (1 Mbps/port cap).",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "vyos",
    name: "VyOS",
    version: "1.5 Stream Rolling (x86_64)",
    category: "Routers & Firewalls",
    guestFamily: "linux",
    osProfileId: "vyos",
    arch: "x86_64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "eth0, eth1, eth2 …",
    firmware: "bios",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 1024,
    recommendedDiskGb: 8,
    estimatedDownloadMb: 490,
    deliveryKind: "guided_installer",
    downloadUrl:
      "https://github.com/vyos/vyos-rolling-nightly-builds/releases/latest/download/vyos-1.5-rolling-amd64.iso",
    checksumUrl: null,
    officialSiteUrl: "https://vyos.io/",
    defaultCredentials: "vyos / vyos",
    summary:
      "Juniper-inspired (`configure` / `set` / `commit`) enterprise router OS built on Debian + FRRouting.",
    quirksAndTips: [
      "Boots live from ISO (`vyos`/`vyos`); run `install image` then `poweroff` in Guided Setup to create a permanent Golden Template.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "9front",
    name: "9front (Plan 9)",
    version: "arm64.img.gz",
    category: "Research, UNIX & Retro",
    guestFamily: "other",
    osProfileId: "9front",
    arch: "aarch64",
    nicModel: "virtio-net-pci",
    nicNamingHint: "/net/ether0, /net/ether1",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 512,
    recommendedDiskGb: 4,
    estimatedDownloadMb: 380,
    deliveryKind: "direct_template",
    downloadUrl: "https://9front.org/iso/9front-10931.arm64.img.gz",
    checksumUrl: null,
    officialSiteUrl: "https://9front.org/",
    defaultCredentials: "glenda (autologin)",
    summary:
      "Community fork of Bell Labs' Plan 9 where the entire network stack is a synthetic `/net` filesystem!",
    quirksAndTips: [
      "Dial TCP in pure shell without sockets: `ip/ipconfig` and inspect `/net/ipifc`.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "opnsense",
    name: "OPNsense",
    version: "24.7 Nano Serial (amd64)",
    category: "Routers & Firewalls",
    guestFamily: "freebsd",
    osProfileId: "opnsense",
    arch: "x86_64",
    nicModel: "e1000",
    nicNamingHint: "em0 (LAN), em1 (WAN)",
    firmware: "bios",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 2048,
    recommendedDiskGb: 16,
    estimatedDownloadMb: 510,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://pkg.opnsense.org/releases/24.7/OPNsense-24.7-nano-amd64.img.bz2",
    checksumUrl: null,
    officialSiteUrl: "https://opnsense.org/download/",
    defaultCredentials: "root / opnsense",
    summary:
      "Pre-installed `nano` serial appliance of OPNsense — boots straight to console menu & HTTPS WebGUI with zero installation.",
    quirksAndTips: [
      "Uses `e1000` (`em0`, `em1`) by default for rock-solid FreeBSD checksum offload compatibility.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "pfsense",
    name: "pfSense CE",
    version: "2.7.2 CE (amd64)",
    category: "Routers & Firewalls",
    guestFamily: "freebsd",
    osProfileId: "pfsense",
    arch: "x86_64",
    nicModel: "e1000",
    nicNamingHint: "em0 (WAN), em1 (LAN)",
    firmware: "uefi",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 2048,
    recommendedDiskGb: 16,
    estimatedDownloadMb: 790,
    deliveryKind: "local_import_only",
    downloadUrl: null,
    checksumUrl: null,
    officialSiteUrl: "https://www.pfsense.org/download/",
    defaultCredentials: "admin / pfsense",
    summary:
      "Classic FreeBSD pf enterprise firewall appliance (import your downloaded Netgate ISO/memstick via Local File Import).",
    quirksAndTips: [
      "Netgate distributes pfSense CE through their free storefront checkout rather than static mirror URLs — use 'Import Local File' below.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "omnios",
    name: "OmniOS (Illumos)",
    version: "r151052 LTS Cloud (x86_64)",
    category: "Research, UNIX & Retro",
    guestFamily: "other",
    osProfileId: "omnios",
    arch: "x86_64",
    nicModel: "e1000",
    nicNamingHint: "e1000g0, e1000g1 (dladm / ipadm)",
    firmware: "bios",
    diskBus: "virtio-blk",
    defaultCpus: 2,
    defaultRamMb: 2048,
    recommendedDiskGb: 16,
    estimatedDownloadMb: 460,
    deliveryKind: "direct_template",
    downloadUrl:
      "https://downloads.omnios.org/media/stable/omnios-r151052.cloud.qcow2.xz",
    checksumUrl: null,
    officialSiteUrl: "https://omnios.org/",
    defaultCredentials: "root (no password on console)",
    summary:
      "OpenSolaris / Illumos distribution showcasing Crossbow (`dladm` VNICs/etherstubs, `ipadm`), DTrace, ZFS, and Zones.",
    quirksAndTips: [
      "Create virtual NICs & switches inside a single host with `dladm create-etherstub` and `dladm create-vnic`.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "dragonflybsd",
    name: "DragonFly BSD",
    version: "6.4.0-RELEASE (x86_64)",
    category: "BSD Family",
    guestFamily: "freebsd",
    osProfileId: "dragonflybsd",
    arch: "x86_64",
    nicModel: "e1000",
    nicNamingHint: "em0, em1",
    firmware: "bios",
    diskBus: "ahci",
    defaultCpus: 2,
    defaultRamMb: 1024,
    recommendedDiskGb: 12,
    estimatedDownloadMb: 360,
    deliveryKind: "guided_installer",
    downloadUrl:
      "https://avalon.dragonflybsd.org/iso-images/dfly-x86_64-6.4.0_REL.img.bz2",
    checksumUrl: null,
    officialSiteUrl: "https://www.dragonflybsd.org/",
    defaultCredentials: "root (no password) or installer",
    summary:
      "Famous for lockless per-CPU LWKT network protocol threads and the HAMMER2 filesystem.",
    quirksAndTips: [
      "Defaults to AHCI SATA (`ad0` / `da0`) and Intel `e1000` (`em0`) for maximum hardware compatibility.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "haiku",
    name: "Haiku OS",
    version: "R1/beta5 (x86_64)",
    category: "Research, UNIX & Retro",
    guestFamily: "other",
    osProfileId: "haiku",
    arch: "x86_64",
    nicModel: "e1000",
    nicNamingHint: "/dev/net/ipro1000/0",
    firmware: "uefi",
    diskBus: "ahci",
    defaultCpus: 2,
    defaultRamMb: 1024,
    recommendedDiskGb: 8,
    estimatedDownloadMb: 820,
    deliveryKind: "guided_installer",
    downloadUrl:
      "https://eu.hpkg.haiku-os.org/haiku/release/r1beta5/haiku-r1beta5-x86_64-anyboot.iso",
    checksumUrl: null,
    officialSiteUrl: "https://www.haiku-os.org/",
    defaultCredentials: "user (graphical BeOS-style desktop via Embedded VNC)",
    summary:
      "Spiritual successor to BeOS — boots into an ultra-responsive graphical desktop inside Etherloom's VNC console tab.",
    quirksAndTips: [
      "Click 'Try Haiku' on the boot splash to launch a live desktop immediately or 'Install Haiku' to create a Golden Template.",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
  {
    id: "freedos",
    name: "FreeDOS + mTCP",
    version: "1.3 LiveCD (i386 Retro)",
    category: "Research, UNIX & Retro",
    guestFamily: "other",
    osProfileId: "freedos",
    arch: "i386",
    nicModel: "pcnet",
    nicNamingHint: "PCNTPK INT=0x60",
    firmware: "bios",
    diskBus: "ide",
    defaultCpus: 1,
    defaultRamMb: 32,
    recommendedDiskGb: 1,
    estimatedDownloadMb: 410,
    deliveryKind: "guided_installer",
    downloadUrl:
      "https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.3/official/FD13-LiveCD.zip",
    checksumUrl: null,
    officialSiteUrl: "https://www.freedos.org/",
    defaultCredentials: "Single-user DOS prompt (`C:\\>`)",
    summary:
      "Boots in under 1 second in 32 MB RAM! Teaches raw Ethernet packet drivers (`PCNTPKT 0x60`) and userspace mTCP.",
    quirksAndTips: [
      "Zero background multicast/IPv6/ARP chatter — when you run `ping.exe` or `htget.exe` in mTCP, Wireshark shows ONLY your exact frames!",
    ],
    availability: "not_downloaded",
    templateId: null,
    templatePath: null,
    templateSizeBytes: null,
    installerPath: null,
    installerSizeBytes: null,
    referencingProjects: [],
  },
];

export async function pickCatalogDiskOrArchiveDialog(
  defaultDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    title: "Import Disk Image, Installer ISO, or Compressed Archive",
    directory: false,
    multiple: false,
    defaultPath: defaultDir && !defaultDir.startsWith("~") ? defaultDir : undefined,
    filters: [
      {
        name: "VM Disks, ISOs & Compressed Archives",
        extensions: [
          "qcow2",
          "img",
          "raw",
          "iso",
          "xz",
          "gz",
          "bz2",
          "zip",
          "vmdk",
          "vdi",
        ],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

function normalizeCatalogEntryDto(
  raw: Record<string, unknown>
): OsCatalogEntryDto {
  const deliveryRaw = String(raw.deliveryKind ?? "direct_template");
  const deliveryKind =
    deliveryRaw === "ready_to_boot" || deliveryRaw === "direct_template"
      ? "direct_template"
      : deliveryRaw === "guided_installer"
      ? "guided_installer"
      : "local_import_only";

  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    version: String(
      raw.version ?? raw.upstreamSourceLabel ?? "Official Upstream"
    ),
    category: (raw.category as OsCatalogEntryDto["category"]) ?? "Linux",
    guestFamily:
      (raw.guestFamily as OsCatalogEntryDto["guestFamily"]) ?? "linux",
    osProfileId: String(raw.osProfileId ?? raw.id ?? "alpine-linux"),
    arch: (raw.arch as OsCatalogEntryDto["arch"]) ?? "aarch64",
    nicModel:
      (raw.nicModel as OsCatalogEntryDto["nicModel"]) ??
      (raw.defaultNicModel as OsCatalogEntryDto["nicModel"]) ??
      "virtio-net-pci",
    nicNamingHint: String(
      raw.nicNamingHint ?? raw.interfaceNaming ?? "eth0, eth1, …"
    ),
    firmware:
      (raw.firmware as OsCatalogEntryDto["firmware"]) ??
      (raw.defaultFirmware as OsCatalogEntryDto["firmware"]) ??
      "uefi",
    diskBus:
      (raw.diskBus as OsCatalogEntryDto["diskBus"]) ??
      (raw.defaultDiskBus as OsCatalogEntryDto["diskBus"]) ??
      "virtio-blk",
    defaultCpus: Number(raw.defaultCpus ?? raw.defaultVcpus ?? 1),
    defaultRamMb: Number(raw.defaultRamMb ?? 256),
    recommendedDiskGb: Number(raw.recommendedDiskGb ?? 4),
    estimatedDownloadMb: Number(raw.estimatedDownloadMb ?? 100),
    deliveryKind,
    downloadUrl:
      typeof raw.downloadUrl === "string"
        ? raw.downloadUrl
        : deliveryKind !== "local_import_only"
        ? String(raw.officialUrl ?? raw.officialSiteUrl ?? "")
        : null,
    checksumUrl: typeof raw.checksumUrl === "string" ? raw.checksumUrl : null,
    officialSiteUrl: String(raw.officialSiteUrl ?? raw.officialUrl ?? ""),
    defaultCredentials: String(raw.defaultCredentials ?? ""),
    summary: String(raw.summary ?? raw.tagline ?? ""),
    quirksAndTips: Array.isArray(raw.quirksAndTips)
      ? raw.quirksAndTips.map(String)
      : [],
    availability:
      (raw.availability as OsCatalogEntryDto["availability"]) ??
      "not_downloaded",
    templateId:
      typeof raw.templateId === "string"
        ? raw.templateId
        : typeof raw.installedTemplateId === "string"
        ? raw.installedTemplateId
        : null,
    templatePath:
      typeof raw.templatePath === "string"
        ? raw.templatePath
        : typeof raw.installedTemplatePath === "string"
        ? raw.installedTemplatePath
        : null,
    templateSizeBytes:
      typeof raw.templateSizeBytes === "number"
        ? raw.templateSizeBytes
        : typeof raw.installedSizeBytes === "number"
        ? raw.installedSizeBytes
        : null,
    installerPath:
      typeof raw.installerPath === "string"
        ? raw.installerPath
        : typeof raw.installerMediaPath === "string"
        ? raw.installerMediaPath
        : null,
    installerSizeBytes:
      typeof raw.installerSizeBytes === "number"
        ? raw.installerSizeBytes
        : typeof raw.installerMediaSizeBytes === "number"
        ? raw.installerMediaSizeBytes
        : null,
    referencingProjects: Array.isArray(raw.referencingProjects)
      ? raw.referencingProjects.map(String)
      : [],
  };
}

export async function listCatalogEntries(): Promise<OsCatalogEntryDto[]> {
  if (!isTauriRuntime()) {
    return BROWSER_FALLBACK_OS_CATALOG;
  }
  const raw = await invoke<Record<string, unknown>[]>("catalog_list_entries");
  return raw.map(normalizeCatalogEntryDto);
}

export async function startCatalogDownload(
  catalogId: string,
  customUrl?: string | null
): Promise<void> {
  if (!isTauriRuntime()) {
    const hit = BROWSER_FALLBACK_OS_CATALOG.find((e) => e.id === catalogId);
    if (hit) {
      hit.availability =
        hit.deliveryKind === "guided_installer" ? "installer_ready" : "ready";
      if (hit.availability === "ready") {
        hit.templateId = `${catalogId}-${hit.arch}-base`;
        hit.templatePath = `~/Library/Application Support/Etherloom/Library/templates/${catalogId}-${hit.arch}-base.qcow2`;
        hit.templateSizeBytes = hit.estimatedDownloadMb * 1024 * 1024;
      } else {
        hit.installerPath = `~/Library/Application Support/Etherloom/Library/isos/${catalogId}-installer.img`;
        hit.installerSizeBytes = hit.estimatedDownloadMb * 1024 * 1024;
      }
    }
    return;
  }
  return invoke<void>("catalog_start_download", {
    request: {
      catalogId,
      customUrl: customUrl?.trim() ? customUrl.trim() : null,
    },
  });
}

export async function cancelCatalogDownload(
  catalogId: string
): Promise<boolean> {
  if (!isTauriRuntime()) {
    return true;
  }
  return invoke<boolean>("catalog_cancel_download", { catalogId });
}

export async function importCatalogLocalFile(
  catalogId: string,
  sourcePath: string
): Promise<OsCatalogEntryDto> {
  if (!isTauriRuntime()) {
    const hit =
      BROWSER_FALLBACK_OS_CATALOG.find((e) => e.id === catalogId) ??
      BROWSER_FALLBACK_OS_CATALOG[0];
    hit.availability = sourcePath.endsWith(".iso") ? "installer_ready" : "ready";
    return { ...hit };
  }
  const raw = await invoke<Record<string, unknown>>(
    "catalog_import_local_file",
    {
      request: { catalogId, sourcePath },
    }
  );
  return normalizeCatalogEntryDto(raw);
}

export async function deleteCatalogImage(
  catalogId: string,
  force = false
): Promise<DeleteCatalogImageResult> {
  if (!isTauriRuntime()) {
    const hit = BROWSER_FALLBACK_OS_CATALOG.find((e) => e.id === catalogId);
    if (hit) {
      hit.availability = "not_downloaded";
      hit.templateId = null;
      hit.templatePath = null;
      hit.templateSizeBytes = null;
      hit.installerPath = null;
      hit.installerSizeBytes = null;
    }
    return {
      catalogId,
      deletedFiles: [],
      bytesFreed: 0,
      referencingProjects: [],
      blockedByReferences: false,
    };
  }
  const raw = await invoke<Record<string, unknown>>("catalog_delete_image", {
    catalogId,
    force,
  });
  const refs = Array.isArray(raw.referencingProjects)
    ? raw.referencingProjects.map(String)
    : [];
  const deleted = Boolean(raw.deleted ?? true);
  return {
    catalogId: String(raw.catalogId ?? catalogId),
    deletedFiles: Array.isArray(raw.deletedFiles)
      ? raw.deletedFiles.map(String)
      : Array.isArray(raw.removedPaths)
      ? raw.removedPaths.map(String)
      : [],
    bytesFreed: Number(raw.bytesFreed ?? 0),
    referencingProjects: refs,
    blockedByReferences:
      typeof raw.blockedByReferences === "boolean"
        ? raw.blockedByReferences
        : !deleted && refs.length > 0,
  };
}

export async function launchCatalogGuidedSetup(
  catalogId: string
): Promise<VmInstanceInfo> {
  return invoke<VmInstanceInfo>("catalog_launch_guided_setup", { catalogId });
}

export async function revealInFinder(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("reveal_in_finder", { path });
}

export async function onCatalogDownloadProgress(
  handler: (event: CatalogDownloadProgressEvent) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => {};
  return listen<Record<string, unknown>>("catalog://download-progress", (e) => {
    const p = e.payload;
    const rawStage = String(p.stage ?? "downloading");
    const stageLower = rawStage.toLowerCase();
    const normalizedStage =
      stageLower === "ready" || stageLower === "installerready"
        ? "ready"
        : stageLower === "cancelled"
        ? "cancelled"
        : stageLower === "error"
        ? "error"
        : stageLower;
    handler({
      catalogId: String(p.catalogId ?? ""),
      stage: normalizedStage,
      bytesDownloaded: Number(p.bytesDownloaded ?? 0),
      totalBytes: typeof p.totalBytes === "number" ? p.totalBytes : null,
      percent: typeof p.percent === "number" ? p.percent : 0,
      message: String(p.message ?? ""),
      error: typeof p.error === "string" ? p.error : null,
    });
  });
}

// -----------------------------------------------------------------------------
// Activity Monitor IPC Client
// -----------------------------------------------------------------------------

export async function sampleActivityMonitor(): Promise<ActivityMonitorSnapshot> {
  if (!isTauriRuntime()) {
    return {
      host: {
        timestampMs: Date.now(),
        sampleIntervalMs: 1000,
        hostArch: "aarch64",
        hostLogicalCpus: 10,
        hostTotalMemoryBytes: 24 * 1024 * 1024 * 1024,
        studioPid: 1001,
        studioCpuPercent: 0.6,
        studioMemoryBytes: 86 * 1024 * 1024,
        activeVmCount: 0,
        totalVmCpuPercent: 0,
        totalVmMemoryBytes: 0,
        totalFabricBytesPerSec: 0,
        totalFabricPacketsPerSec: 0,
      },
      vms: [],
      portTraffic: {},
    };
  }
  return invoke<ActivityMonitorSnapshot>("sample_activity_monitor");
}
