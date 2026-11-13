export type CheckBadge = "ok" | "warning";

export type ThemePreference = "system" | "light" | "dark";

export interface ProbeDetail {
  name: string;
  found: boolean;
  path: string | null;
  version: string | null;
  searchedPaths: string[];
  notes: string | null;
}

export interface DependencyCheck {
  id: string;
  title: string;
  category: string;
  requiredFor: string;
  badge: CheckBadge;
  found: boolean;
  path: string | null;
  version: string | null;
  remediation: string | null;
  details: string | null;
  searchedPaths: string[];
}

export interface EnvDoctorReport {
  checkedAtMs: number;
  hostOs: string;
  hostArch: string;
  hvfSupported: boolean;
  appSupportDir: string;
  templatesDir: string;
  overallBadge: CheckBadge;
  okCount: number;
  warningCount: number;
  qemuSystemAarch64: ProbeDetail;
  qemuSystemX86_64?: ProbeDetail;
  qemuSystemI386?: ProbeDetail;
  qemuSystemRiscv64?: ProbeDetail;
  qemuImg: ProbeDetail;
  edk2Aarch64Code: ProbeDetail;
  edk2X86_64Code?: ProbeDetail;
  wireshark: ProbeDetail;
  python3: ProbeDetail;
  uv: ProbeDetail;
  checks: DependencyCheck[];
}

// -----------------------------------------------------------------------------
// Phase 1b: Configurable Storage & External Volume Types
// -----------------------------------------------------------------------------

export interface StorageConfig {
  storageRoot: string;
  templatesDirOverride: string | null;
  isosDirOverride: string | null;
  workspacesDirOverride: string | null;
}

export type StorageStatus =
  | { state: "ready" }
  | {
      state: "volumeDisconnected";
      expectedPath: string;
      volumeName: string;
    }
  | {
      state: "error";
      message: string;
    };

export interface DiskTelemetry {
  probedPath: string;
  filesystemType: string;
  freeBytes: number;
  totalBytes: number;
  isExternalVolume: boolean;
  isExfat: boolean;
  advisoryTip: string | null;
}

export interface StorageStateSnapshot {
  config: StorageConfig;
  defaultStorageRoot: string;
  settingsFile: string;
  pythonEnvDir: string;
  runtimeSocketsDir: string;
  resolvedTemplatesDir: string;
  resolvedIsosDir: string;
  resolvedWorkspacesDir: string;
  status: StorageStatus;
  diskTelemetry: DiskTelemetry | null;
}

export type StorageMigrationMode = "switch_only" | "move_existing_data";

export interface UpdateStorageRequest {
  storageRoot: string;
  templatesDirOverride: string | null;
  isosDirOverride: string | null;
  workspacesDirOverride: string | null;
  mode: StorageMigrationMode;
  deleteSourceAfterVerify: boolean;
}

export interface StorageMigrationResult {
  snapshot: StorageStateSnapshot;
  filesCopied: number;
  bytesCopied: number;
  sourceCleaned: boolean;
  templatesDiscovered: number;
  isosDiscovered: number;
}

export interface StorageMigrationProgress {
  phase: string;
  currentFile: string;
  filesCompleted: number;
  totalFiles: number;
  bytesCopied: number;
  totalBytes: number;
  percent: number;
}

export interface OverlayTemplateBinding {
  nodeId?: string | null;
  overlayPath: string;
  templateId?: string | null;
}

export interface OverlayRebaseReport {
  overlayPath: string;
  rebased: boolean;
  previousBacking: string | null;
  activeBacking: string | null;
  resolvedTemplateFilename: string | null;
}

// -----------------------------------------------------------------------------
// Phase 1 & Phase 6: Images, Multi-Arch VM Manager & PacketFabric Types
// -----------------------------------------------------------------------------

export type GuestFamily = "linux" | "freebsd" | "openbsd" | "netbsd" | "other";
export type NodeKind = "vm" | "l2_switch" | "l1_hub";

export type GuestArch = "aarch64" | "x86_64" | "i386" | "riscv64";
export type NicModel =
  | "virtio-net-pci"
  | "e1000"
  | "rtl8139"
  | "pcnet"
  | "ne2k_pci";
export type FirmwareType = "uefi" | "bios";
export type DiskBus = "virtio-blk" | "ahci" | "ide";

export interface CatalogComponent {
  id: string;
  name: string;
  subtitle: string;
  kind: NodeKind;
  guestFamily: GuestFamily | null;
  osProfileId?: string | null;
  arch?: GuestArch | null;
  defaultNicModel?: NicModel | null;
  defaultFirmware?: FirmwareType | null;
  defaultDiskBus?: DiskBus | null;
  nicPrefix: string;
  defaultPorts: number;
  defaultVcpus: number | null;
  defaultMemoryMb: number | null;
  consoleModes: string[];
}

export interface OsProfile {
  id: string;
  name: string;
  guestFamily: GuestFamily;
  arch?: GuestArch;
  defaultNicModel?: NicModel;
  defaultFirmware?: FirmwareType;
  defaultDiskBus?: DiskBus;
  nicPrefix: string;
  nicNamingPattern: string;
  altNicNamingPattern: string | null;
  defaultRamMb: number;
  defaultCpus: number;
  recommendedDiskGb: number;
  notes: string;
}

export interface BaseTemplateInfo {
  id: string;
  name: string;
  osProfileId: string;
  arch?: GuestArch;
  defaultNicModel?: NicModel;
  defaultFirmware?: FirmwareType;
  defaultDiskBus?: DiskBus;
  path: string;
  filename: string;
  virtualSizeBytes: number;
  actualSizeBytes: number;
  readOnly: boolean;
  createdAtMs: number;
  description: string | null;
}

export interface InstallerMediaInfo {
  filename: string;
  path: string;
  sizeBytes: number;
  mediaKind: "iso" | "img";
  modifiedAtMs: number;
}

export interface DiskInfo {
  path: string;
  format: string;
  virtualSizeBytes: number;
  actualSizeBytes: number;
  backingFile: string | null;
  readOnly: boolean;
}

export type VmDisplayMode = "vnc" | "cocoa";
export type BootMediaBus = "auto" | "cdrom" | "usb";
export type VmStatus = "starting" | "running" | "stopping" | "stopped" | "crashed";

export interface VmNicConfig {
  portId?: string | null;
  mac: string;
  nicModel?: NicModel | null;
  fabricPort?: number | null;
  vmPort?: number | null;
}

export interface ActiveVmNic {
  index: number;
  portId: string;
  mac: string;
  nicModel?: NicModel;
  fabricPort: number;
  vmPort: number;
}

export interface SpawnVmRequest {
  nodeId: string;
  name: string;
  arch?: GuestArch;
  nicModel?: NicModel;
  firmware?: FirmwareType;
  diskBus?: DiskBus;
  cpus: number;
  ramMb: number;
  diskPath: string;
  templateId?: string | null;
  bootMediaPath?: string | null;
  bootMediaBus?: BootMediaBus;
  displayMode?: VmDisplayMode;
  vncPortOffset?: number | null;
  nics: VmNicConfig[];
  biosPathOverride?: string | null;
}

export interface VmInstanceInfo {
  nodeId: string;
  name: string;
  arch?: GuestArch;
  accel?: string;
  nicModel?: NicModel;
  firmware?: FirmwareType;
  diskBus?: DiskBus;
  status: VmStatus;
  pid: number | null;
  cpus: number;
  ramMb: number;
  diskPath: string;
  bootMediaPath: string | null;
  displayMode: VmDisplayMode;
  vncPortOffset: number | null;
  vncTcpPort: number | null;
  serialSocketPath: string;
  qmpSocketPath: string;
  nics: ActiveVmNic[];
  qemuArgs: string[];
  startedAtMs: number;
  exitCode: number | null;
}

export interface VmStateEvent {
  nodeId: string;
  status: VmStatus;
  pid: number | null;
  vncTcpPort: number | null;
  serialSocketPath: string;
  message: string | null;
  timestampMs: number;
}

export interface UdpPortBinding {
  portId: string;
  fabricPort: number;
  vmPort: number;
}

export interface VirtualDeviceInfo {
  id: string;
  name: string;
  kind: "l2_switch" | "l1_hub";
  ports: string[];
}

export interface LinkSnapshot {
  id: string;
  portA: string;
  portB: string;
  adminUp: boolean;
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
  txPackets: number;
  rxPackets: number;
  txBytes: number;
  rxBytes: number;
  droppedPackets: number;
  bytesPerSec: number;
  capturingPcap?: boolean;
  capturedPackets?: number;
  capturedBytes?: number;
  captureStartedAtMs?: number | null;
  activePcapPath?: string | null;
  liveWireshark?: boolean;
}

export interface MacTableEntry {
  mac: string;
  macBytes: number[];
  portId: string;
  ageMs: number;
  ttlRemainingMs: number;
  framesSeen: number;
}

export interface FabricTelemetryEvent {
  timestampMs: number;
  links: LinkSnapshot[];
}

export type PortLinkState = "unplugged" | "up" | "active" | "cut";
export type NodeRunStatus = "stopped" | "booting" | "running";

export interface NodePort {
  id: string;
  index: number;
  label: string;
  mac: string;
  nicModel?: NicModel | null;
  ipLabel?: string | null;
  notes?: string | null;
}

export interface TopologyNodeData extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  guestFamily: GuestFamily | null;
  osProfileId?: string | null;
  arch?: GuestArch | null;
  nicModel?: NicModel | null;
  firmware?: FirmwareType | null;
  diskBus?: DiskBus | null;
  hostArch?: string | null;
  templateId?: string | null;
  diskPath?: string | null;
  diskSizeGb?: number | null;
  bootMediaPath?: string | null;
  bootMediaBus?: BootMediaBus;
  notes?: string | null;
  status: NodeRunStatus;
  vcpus: number | null;
  memoryMb: number | null;
  displayMode: VmDisplayMode;
  ports: NodePort[];
  portStates?: Record<string, PortLinkState>;
  onToggleRun?: (nodeId: string) => void;
  onOpenConsole?: (nodeId: string, mode?: "serial" | "display") => void;
  onOpenSettings?: (nodeId: string) => void;
}

export interface WireEdgeData extends Record<string, unknown> {
  sourcePortId: string;
  sourcePortLabel: string;
  targetPortId: string;
  targetPortLabel: string;
  adminUp: boolean;
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
  notes?: string | null;
  capturingPcap?: boolean;
  capturedPackets?: number;
  capturedBytes?: number;
  captureStartedAtMs?: number | null;
  activePcapPath?: string | null;
  liveWireshark?: boolean;
  highlightedByLab?: boolean;
  pps: number;
  bytesPerSec: number;
  txPackets: number;
  rxPackets: number;
  droppedPackets: number;
}

export interface LinkImpairments {
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
  adminUp: boolean;
  capturingPcap: boolean;
}

export type DockTab = "serial" | "display" | "link" | "tcpflowy";

export type VmConsoleSubMode = "serial" | "display";

export interface ConsoleTabSession {
  nodeId: string;
  mode: VmConsoleSubMode;
}

export interface ConsoleSessionEndpoints {
  nodeId: string;
  wsPort: number;
  serialWsUrl: string;
  vncWsUrl: string | null;
  vncTcpPort: number | null;
  displayMode: VmDisplayMode;
  vmRunning: boolean;
  serialSocketPath: string;
}

// -----------------------------------------------------------------------------
// Phase 2: Declarative `topology.toml` & `.etherloom` Workspace Bundle Types
// (Inner `TopologyDocument` fields use snake_case matching Rust `workspace.rs`)
// -----------------------------------------------------------------------------

export interface WorkspacePort {
  id: string;
  index: number;
  label: string;
  mac: string;
  nic_model?: NicModel | null;
  ip_label?: string | null;
  notes?: string | null;
}

export interface WorkspaceNode {
  id: string;
  name: string;
  kind: NodeKind;
  guest_family?: GuestFamily | null;
  os_profile_id?: string | null;
  arch?: GuestArch | null;
  nic_model?: NicModel | null;
  firmware?: FirmwareType | null;
  disk_bus?: DiskBus | null;
  template_id?: string | null;
  disk_path?: string | null;
  disk_size_gb?: number | null;
  boot_media_path?: string | null;
  boot_media_bus?: BootMediaBus | null;
  vcpus?: number | null;
  memory_mb?: number | null;
  display_mode?: VmDisplayMode | null;
  notes?: string | null;
  position: { x: number; y: number };
  ports: WorkspacePort[];
}

export interface WorkspaceLinkImpairments {
  latency_ms: number;
  jitter_ms: number;
  loss_percent: number;
}

export interface WorkspaceLink {
  id: string;
  source_node: string;
  source_port: string;
  target_node: string;
  target_port: string;
  admin_up: boolean;
  impairments: WorkspaceLinkImpairments;
  notes?: string | null;
}

export interface TopologyDocument {
  schema_version: number;
  name: string;
  notes?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  nodes: WorkspaceNode[];
  links: WorkspaceLink[];
}

export interface ProjectBundleDto {
  bundlePath: string;
  topologyFile: string;
  overlaysDir: string;
  capturesDir: string;
  rebasedOverlays: number;
  topology: TopologyDocument;
}

export interface SaveProjectRequest {
  bundlePath: string;
  copyFromBundle?: string | null;
  topology: TopologyDocument;
}

export interface NodeDiskStatusDto {
  diskPath: string;
  exists: boolean;
  sizeBytes: number;
}

// -----------------------------------------------------------------------------
// Phase 4: Zero-Root Wiretaps (`.pcap` + Live Wireshark) & `tcpflowy` Dissector
// -----------------------------------------------------------------------------

export interface CaptureFileInfo {
  filename: string;
  path: string;
  linkId: string | null;
  sizeBytes: number;
  packetCount: number | null;
  modifiedAtMs: number;
  isRecording: boolean;
}

export interface StartPcapRecordingResult {
  linkId: string;
  path: string;
  filename: string;
  startedAtMs: number;
}

export interface CaptureSummary {
  captureId: string;
  linkId: string;
  filePath: string;
  path: string;
  filename: string;
  packetCount: number;
  packetsWritten: number;
  byteSize: number;
  bytesWritten: number;
  durationMs: number;
}

export type StopPcapRecordingResult = CaptureSummary;

export interface LiveWiresharkSessionInfo {
  linkId: string;
  fifoPath: string;
  wiresharkBin: string;
  pid: number | null;
}

export interface TcpflowyEnvStatus {
  state:
    | "ready"
    | "not_installed"
    | "installing"
    | "missing_python"
    | "missing_tshark"
    | "error"
    | string;
  venvDir: string;
  venvExists: boolean;
  pythonBin: string | null;
  tsharkBin: string | null;
  installedVersion: string | null;
  localRepoPath: string | null;
  localRepoValid: boolean;
  activeSource: "pypi_venv" | "local_repo" | "none" | string;
  message: string;
}

export interface TcpflowyInstallProgress {
  phase: string;
  message: string;
  percent: number;
}

export interface DissectPcapRequest {
  pcapPath: string;
  filterNoise?: boolean;
  noIpLookup?: boolean;
  keylogPath?: string | null;
}

export interface TcpSegmentTimelineEntry {
  frameNumber: number;
  relTimeMs: number;
  direction: "C->S" | "S->C";
  flags: string[];
  seq: number;
  ack: number;
  payloadLen: number;
  frameLen: number;
  window: number;
  isRetransmission: boolean;
  isOutOfOrder: boolean;
  isZeroWindow: boolean;
  preview: string;
}

export interface TcpStreamTurn {
  direction: "C->S" | "S->C";
  bytes: number;
  ascii: string;
  hex: string;
}

export interface TcpStreamReconstruction {
  c2sAscii: string;
  c2sHex: string;
  s2cAscii: string;
  s2cHex: string;
  turns: TcpStreamTurn[];
}

export interface TcpflowyPayloadSample {
  direction: "C->S" | "S->C";
  length: number;
  raw_hex: string;
  hex_prefix: string;
  ascii_prefix: string;
  magic_4bytes: string;
}

export interface TcpflowyDissectedFlow {
  pcap: string;
  flow_id: string;
  src_ip: string | null;
  src_port: number | string | null;
  dst_ip: string | null;
  dst_port: number | string | null;
  src_fqdn: string | null;
  dst_fqdn: string | null;
  primary_domain: string | null;
  detected_application: string;
  is_unknown_traffic: boolean;
  is_tls_decrypted: boolean;
  is_background_noise: boolean;
  noise_reason: string | null;
  packet_count: number;
  total_bytes: number;
  payload_bytes: number;
  c2s_packets: number;
  c2s_bytes: number;
  c2s_payload_bytes: number;
  s2c_packets: number;
  s2c_bytes: number;
  s2c_payload_bytes: number;
  direction_profile: string;
  splt_lengths: number[];
  splt_iats_ms: number[];
  splt_signature: string | null;
  avg_iat_ms: number | null;
  payload_entropy: number | null;
  entropy_profile: string;
  duration_sec: number;
  protocols: string[];
  sni_list: string[];
  alpn_list: string[];
  tls_version: string | null;
  ja3_list: string[];
  cert_subjects: string[];
  http_methods: string[];
  http_hosts: string[];
  http_uris: string[];
  http_user_agents: string[];
  payload_samples: TcpflowyPayloadSample[];
  c2s_payload_samples: TcpflowyPayloadSample[];
  s2c_payload_samples: TcpflowyPayloadSample[];
  src_attributes?: Record<string, string | null | undefined>;
  dst_attributes?: Record<string, string | null | undefined>;
  // Enriched ladder & stream payload fields from `etherloom_tcpflowy_bridge.py`
  handshakeState: string;
  retransmissions: number;
  outOfOrder: number;
  zeroWindows: number;
  rstCount: number;
  segments: TcpSegmentTimelineEntry[];
  streamReconstruction: TcpStreamReconstruction;
}

export interface TcpflowyGeneratedRule {
  type: string;
  streams: string[];
  direction: string;
  dst_port: number | string | null;
  hex_mask: string | null;
  ascii_mask: string | null;
  wireshark_filter: string;
  suricata_rule: string;
}

export interface TcpflowyWildcardSignature {
  flow_ids: string[];
  flow_count: number;
  direction: string;
  dst_port: number | string | null;
  avg_entropy: number | null;
  hex_mask: string;
  ascii_mask: string;
  fixed_bytes_count: number;
}

export interface TcpflowyStatistics {
  total_pcaps?: number;
  total_flows?: number;
  decrypted_tls_flows?: number;
  background_noise_flows?: number;
  total_packets?: number;
  total_bytes?: number;
  total_payload_bytes?: number;
  flows_by_application?: Record<string, number>;
  bytes_by_application?: Record<string, number>;
  bytes_by_domain?: Record<string, number>;
  flows_by_dst_ip?: Record<string, number>;
  flows_by_organization?: Record<string, number>;
  ja3_fingerprints?: Record<string, number>;
  splt_signatures?: Record<string, number>;
  unknown_traffic?: {
    count: number;
    recurring_magic_4bytes?: Record<string, number>;
    recurring_dst_ports?: Record<string, number>;
    recurring_ascii_prefixes?: Record<string, number>;
    wildcard_signatures?: TcpflowyWildcardSignature[];
  };
}

export interface TcpflowyDissectionReport {
  tcpflowyVersion: string;
  sourceMode: string;
  pcapPath: string;
  pcapName: string;
  totalPcapPackets: number | null;
  suppressedNoiseFlows: number;
  statistics: TcpflowyStatistics;
  passiveDnsMap: Record<string, string>;
  generatedRules: TcpflowyGeneratedRule[];
  asciiChart: string;
  rawCliReport: string;
  flows: TcpflowyDissectedFlow[];
}

// -----------------------------------------------------------------------------
// Phase 5: Interactive Networking Academy & Guided Labs Types
// -----------------------------------------------------------------------------

export type LabDifficulty = "Beginner" | "Intermediate" | "Advanced" | string;

export interface LabStepDto {
  id: string;
  title: string;
  summary: string;
  highlightLinks: string[];
}

export interface LabTemplateRequirementStatus {
  catalogId?: string;
  osProfileId: string;
  osProfileName: string;
  guestFamily: GuestFamily | string;
  arch?: GuestArch | string;
  satisfied: boolean;
  matchedTemplateId: string | null;
  matchedTemplateName: string | null;
}

export interface AcademyLabSummary {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  difficulty: LabDifficulty;
  estimatedMinutes: number;
  tags: string[];
  nodeCount: number;
  linkCount: number;
  stepCount: number;
  requiredCatalogIds?: string[];
  requiredTemplates: LabTemplateRequirementStatus[];
  allTemplatesReady: boolean;
  sourceKind: "builtin" | "custom" | string;
}

export interface AcademyLabDetail {
  summary: AcademyLabSummary;
  steps: LabStepDto[];
  guideMarkdown: string;
  topology: TopologyDocument;
}

export interface InstantiatedLabDto {
  lab: AcademyLabDetail;
  bundle: ProjectBundleDto;
  autoBoundTemplates: number;
}

// -----------------------------------------------------------------------------
// Phase 6: Built-In 15-OS Curated Catalog & On-Demand Download Engine Types
// -----------------------------------------------------------------------------

export type CatalogCategory =
  | "Linux"
  | "BSD Family"
  | "Routers & Firewalls"
  | "Research, UNIX & Retro";

export type CatalogDeliveryKind =
  | "direct_template"
  | "guided_installer"
  | "local_import_only";

export type CatalogAvailability =
  | "not_downloaded"
  | "downloading"
  | "installer_ready"
  | "ready";

export interface OsCatalogEntryDto {
  id: string;
  name: string;
  version: string;
  category: CatalogCategory;
  guestFamily: GuestFamily;
  osProfileId: string;
  arch: GuestArch;
  nicModel: NicModel;
  nicNamingHint: string;
  firmware: FirmwareType;
  diskBus: DiskBus;
  defaultCpus: number;
  defaultRamMb: number;
  recommendedDiskGb: number;
  estimatedDownloadMb: number;
  deliveryKind: CatalogDeliveryKind;
  downloadUrl: string | null;
  checksumUrl: string | null;
  officialSiteUrl: string;
  defaultCredentials: string;
  summary: string;
  quirksAndTips: string[];
  availability: CatalogAvailability;
  templateId: string | null;
  templatePath: string | null;
  templateSizeBytes: number | null;
  installerPath: string | null;
  installerSizeBytes: number | null;
  referencingProjects: string[];
}

export interface CatalogDownloadProgressEvent {
  catalogId: string;
  stage: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  percent: number;
  message: string;
  error: string | null;
}

export interface DeleteCatalogImageResult {
  catalogId: string;
  deletedFiles: string[];
  bytesFreed: number;
  referencingProjects: string[];
  blockedByReferences: boolean;
}
