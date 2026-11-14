import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Disc,
  Download,
  FolderOpen,
  HardDrive,
  Layers,
  Monitor,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { EtherloomFlowNode } from "../canvas/EtherloomNode";
import {
  createBlankVmDisk,
  listInstallerIsos,
  pickInstallerImageDialog,
  promoteDiskToTemplate,
  resetNodeOverlayDisk,
  resolveNodeDiskPath,
} from "../../services/tauriBridge";
import type {
  BaseTemplateInfo,
  BootMediaBus,
  DiskBus,
  FirmwareType,
  GuestArch,
  GuestFamily,
  InstallerMediaInfo,
  NicModel,
  NodeDiskStatusDto,
  NodePort,
  OsProfile,
  TopologyNodeData,
  VmDisplayMode,
} from "../../types/studio";
import {
  flowNodeToWorkspaceNode,
  formatByteSize,
  formatInterfaceLabel,
  generateQemuMac,
} from "../../utils/topology";

export type ConfigTab = "general" | "interfaces" | "storage";

interface NodeConfigModalProps {
  open: boolean;
  node: EtherloomFlowNode | null;
  initialTab?: ConfigTab;
  bundlePath: string | null;
  isosDir?: string;
  osProfiles: OsProfile[];
  baseTemplates: BaseTemplateInfo[];
  onClose: () => void;
  onSaveNode: (nodeId: string, patch: Partial<TopologyNodeData>) => void;
  onDeleteNode: (nodeId: string) => void;
  onTemplatesChanged: () => Promise<void>;
  onOpenOsLibrary?: (osProfileId?: string | null) => void;
}

export function NodeConfigModal({
  open,
  node,
  initialTab = "general",
  bundlePath,
  isosDir,
  osProfiles,
  baseTemplates,
  onClose,
  onSaveNode,
  onDeleteNode,
  onTemplatesChanged,
  onOpenOsLibrary,
}: NodeConfigModalProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>("general");
  const initializedSessionKeyRef = useRef<string | null>(null);

  // Editable draft fields
  const [label, setLabel] = useState("");
  const [osProfileId, setOsProfileId] = useState<string>("openbsd");
  const [guestFamily, setGuestFamily] = useState<GuestFamily>("openbsd");
  const [arch, setArch] = useState<GuestArch>("aarch64");
  const [nicModel, setNicModel] = useState<NicModel>("virtio-net-pci");
  const [firmware, setFirmware] = useState<FirmwareType>("uefi");
  const [diskBus, setDiskBus] = useState<DiskBus>("virtio-blk");
  const [vcpus, setVcpus] = useState<number>(2);
  const [memoryMb, setMemoryMb] = useState<number>(512);
  const [displayMode, setDisplayMode] = useState<VmDisplayMode>("vnc");
  const [notes, setNotes] = useState<string>("");
  const [ports, setPorts] = useState<NodePort[]>([]);

  // Storage & OS Installer fields
  const [storageSource, setStorageSource] = useState<"template" | "installer">(
    "installer"
  );
  const [templateId, setTemplateId] = useState<string>("");
  const [bootMediaPath, setBootMediaPath] = useState<string>("");
  const [bootMediaBus, setBootMediaBus] = useState<BootMediaBus>("auto");
  const [diskSizeGb, setDiskSizeGb] = useState<number>(8);

  // Live disk status & discovered ISOs
  const [diskStatus, setDiskStatus] = useState<NodeDiskStatusDto | null>(null);
  const [discoveredIsos, setDiscoveredIsos] = useState<InstallerMediaInfo[]>(
    []
  );
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  // Promote-to-Template inline subform
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoteDesc, setPromoteDesc] = useState("");

  // Initialize draft state ONLY when the modal opens or switches to a different `node.id`
  // (never when parent telemetry / enrichedNodes / baseTemplates references refresh while editing!)
  useEffect(() => {
    if (!open || !node) {
      initializedSessionKeyRef.current = null;
      return;
    }
    if (initializedSessionKeyRef.current === node.id) {
      return;
    }
    initializedSessionKeyRef.current = node.id;

    const d = node.data;
    const requestedTab: ConfigTab =
      initialTab === "storage" && d.kind !== "vm" ? "general" : initialTab;
    setActiveTab(requestedTab);
    setFeedback(null);
    setPromoteOpen(false);

    setLabel(d.label);
    const fam = d.guestFamily ?? "linux";
    const resolvedProfId =
      d.osProfileId || (fam === "linux" ? "alpine-linux" : fam);
    const matchedProf = osProfiles.find((p) => p.id === resolvedProfId);
    setGuestFamily(fam);
    setOsProfileId(resolvedProfId);
    setArch(d.arch ?? matchedProf?.arch ?? "aarch64");
    setNicModel(
      d.nicModel ?? matchedProf?.defaultNicModel ?? "virtio-net-pci"
    );
    setFirmware(d.firmware ?? matchedProf?.defaultFirmware ?? "uefi");
    setDiskBus(d.diskBus ?? matchedProf?.defaultDiskBus ?? "virtio-blk");
    setVcpus(d.vcpus ?? 2);
    setMemoryMb(d.memoryMb ?? 512);
    setDisplayMode(d.displayMode ?? "vnc");
    setNotes(d.notes ?? "");
    setPorts(d.ports.map((p) => ({ ...p })));

    const matchedTpl = d.templateId
      ? baseTemplates.find(
          (t) => t.id === d.templateId || t.filename === d.templateId
        )
      : baseTemplates.find((t) => t.osProfileId === resolvedProfId);

    if (matchedTpl) {
      setStorageSource("template");
      setTemplateId(matchedTpl.id);
    } else if (d.bootMediaPath) {
      setStorageSource("installer");
      setTemplateId("");
    } else if (baseTemplates.length > 0) {
      setStorageSource("template");
      setTemplateId(d.templateId || baseTemplates[0].id);
    } else {
      setStorageSource("template");
      setTemplateId("");
    }

    setBootMediaPath(d.bootMediaPath ?? "");
    setBootMediaBus(d.bootMediaBus ?? "auto");
    setDiskSizeGb(d.diskSizeGb ?? matchedProf?.recommendedDiskGb ?? 8);
    setPromoteName(`${d.label} Golden Image`);
    setPromoteDesc(`Installed ${fam.toUpperCase()} base image`);

    if (d.kind === "vm") {
      void listInstallerIsos()
        .then(setDiscoveredIsos)
        .catch(() => setDiscoveredIsos([]));
      void resolveNodeDiskPath(bundlePath, flowNodeToWorkspaceNode(node))
        .then(setDiskStatus)
        .catch(() => setDiskStatus(null));
    } else {
      setDiskStatus(null);
    }
  }, [open, node, initialTab, bundlePath, baseTemplates, osProfiles]);

  // If templates finish downloading while the modal is open and no template is selected yet, populate gently
  useEffect(() => {
    if (!open || !node || node.data.kind !== "vm") return;
    if (templateId || baseTemplates.length === 0) return;
    const byProfile = baseTemplates.find((t) => t.osProfileId === osProfileId);
    setTemplateId((byProfile ?? baseTemplates[0]).id);
  }, [open, node, baseTemplates, osProfileId, templateId]);

  if (!open || !node) return null;

  const isVm = node.data.kind === "vm";
  const isRunning =
    node.data.status === "running" || node.data.status === "booting";

  const handleSelectProfile = (profileId: string) => {
    setOsProfileId(profileId);
    const prof = osProfiles.find((p) => p.id === profileId);
    if (prof) {
      const nextNic: NicModel = prof.defaultNicModel ?? "virtio-net-pci";
      setGuestFamily(prof.guestFamily);
      setArch(prof.arch ?? "aarch64");
      setNicModel(nextNic);
      setFirmware(prof.defaultFirmware ?? "uefi");
      setDiskBus(prof.defaultDiskBus ?? "virtio-blk");
      setVcpus(prof.defaultCpus);
      setMemoryMb(prof.defaultRamMb);
      setDiskSizeGb(prof.recommendedDiskGb);
      // Relabel standard guest NICs accurately per OS profile + NIC model
      setPorts((prev) =>
        prev.map((p, idx) => ({
          ...p,
          index: idx,
          nicModel: nextNic,
          label: formatInterfaceLabel(
            "vm",
            prof.guestFamily,
            idx,
            prof.id,
            nextNic
          ),
        }))
      );
    }
  };

  const handleChangeNicModel = (nextModel: NicModel) => {
    setNicModel(nextModel);
    setPorts((prev) =>
      prev.map((p, idx) => ({
        ...p,
        index: idx,
        nicModel: nextModel,
        label: formatInterfaceLabel(
          "vm",
          guestFamily,
          idx,
          osProfileId,
          nextModel
        ),
      }))
    );
  };

  const handleAddPort = () => {
    setPorts((prev) => {
      const nextIdx = prev.length;
      return [
        ...prev,
        {
          id: `${node.id}-p${nextIdx}-${Date.now().toString(36).slice(-3)}`,
          index: nextIdx,
          label: formatInterfaceLabel(
            node.data.kind,
            isVm ? guestFamily : null,
            nextIdx,
            isVm ? osProfileId : null,
            isVm ? nicModel : null
          ),
          mac: generateQemuMac(),
          nicModel: isVm ? nicModel : null,
          ipLabel: null,
          notes: null,
        },
      ];
    });
  };

  const handleRemovePort = (portId: string) => {
    if (ports.length <= 1) return;
    setPorts((prev) =>
      prev
        .filter((p) => p.id !== portId)
        .map((p, idx) => ({
          ...p,
          index: idx,
          label: formatInterfaceLabel(
            node.data.kind,
            isVm ? guestFamily : null,
            idx,
            isVm ? osProfileId : null,
            isVm ? nicModel : null
          ),
        }))
    );
  };

  const handleUpdatePort = (portId: string, patch: Partial<NodePort>) => {
    setPorts((prev) =>
      prev.map((p) => (p.id === portId ? { ...p, ...patch } : p))
    );
  };

  const handleBrowseInstaller = async () => {
    const chosen = await pickInstallerImageDialog(isosDir);
    if (chosen) {
      setBootMediaPath(chosen);
      setStorageSource("installer");
    }
  };

  const handleResetDisk = async () => {
    if (!diskStatus) return;
    setBusyMessage("Resetting node disk…");
    setFeedback(null);
    try {
      if (storageSource === "template" && templateId) {
        await resetNodeOverlayDisk(diskStatus.diskPath, templateId);
      } else {
        await createBlankVmDisk(diskStatus.diskPath, diskSizeGb);
      }
      const updated = await resolveNodeDiskPath(
        bundlePath,
        flowNodeToWorkspaceNode(node)
      );
      setDiskStatus(updated);
      setFeedback({
        kind: "ok",
        text: "Node disk wiped and reset cleanly.",
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyMessage(null);
    }
  };

  const handlePromoteToTemplate = async () => {
    if (!diskStatus?.exists) {
      setFeedback({
        kind: "error",
        text: "Boot and install an OS onto this node's disk first before saving as a template.",
      });
      return;
    }
    if (!promoteName.trim()) {
      setFeedback({
        kind: "error",
        text: "Enter a name for the reusable Base Template.",
      });
      return;
    }

    setBusyMessage("Promoting installed disk to Read-Only Golden Template…");
    setFeedback(null);
    try {
      const created = await promoteDiskToTemplate({
        sourceDiskPath: diskStatus.diskPath,
        templateName: promoteName.trim(),
        osProfileId,
        description: promoteDesc.trim() || null,
      });
      await onTemplatesChanged();
      setStorageSource("template");
      setTemplateId(created.id);
      setBootMediaPath("");
      setPromoteOpen(false);
      setFeedback({
        kind: "ok",
        text: `Saved reusable template "${created.name}" (${created.filename}) in templates/!`,
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyMessage(null);
    }
  };

  const handleSave = () => {
    const cleanName = label.trim() || node.data.label;
    if (isVm) {
      onSaveNode(node.id, {
        label: cleanName,
        guestFamily,
        osProfileId,
        arch,
        nicModel,
        firmware,
        diskBus,
        vcpus: Math.max(1, vcpus),
        memoryMb: Math.max(16, memoryMb),
        displayMode,
        notes: notes.trim() || null,
        ports,
        templateId:
          storageSource === "template" && templateId.trim()
            ? templateId.trim()
            : null,
        bootMediaPath:
          storageSource === "installer" && bootMediaPath.trim()
            ? bootMediaPath.trim()
            : bootMediaPath.trim() || null,
        bootMediaBus,
        diskSizeGb: Math.max(1, diskSizeGb),
      });
    } else {
      // Ensure switch / hub port IDs stay `{node.id}-p{idx}` so PacketFabric maps 1:1
      const normalizedSwitchPorts: NodePort[] = ports.map((p, idx) => ({
        ...p,
        id: `${node.id}-p${idx}`,
        index: idx,
        label: `p${idx + 1}`,
      }));
      onSaveNode(node.id, {
        label: cleanName,
        notes: notes.trim() || null,
        ports: normalizedSwitchPorts,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 dark:bg-[#050912]/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[rgba(34,211,238,0.16)] bg-slate-50/70 dark:bg-[#0D1321]/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#22D3EE]/15 border border-[#22D3EE]/35 text-cyan-600 dark:text-[#22D3EE] flex items-center justify-center">
              {isVm ? (
                <Cpu className="w-4 h-4" />
              ) : (
                <Network className="w-4 h-4" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Configure {isVm ? "Virtual Machine" : "Fabric Device"} —{" "}
                <span className="font-mono text-cyan-600 dark:text-[#22D3EE]">
                  {node.data.label}
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Node ID: <code className="font-mono">{node.id}</code>
                {isRunning &&
                  " • Stop VM before changing hardware or disk attachments"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-[#1E2B42]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2 border-b border-slate-200 dark:border-[rgba(34,211,238,0.14)] flex items-center gap-1 bg-slate-50/70 dark:bg-[#0D1321]/80">
          {(
            [
              { id: "general", label: "General & Compute", icon: Cpu },
              {
                id: "interfaces",
                label: `Network Interfaces (${ports.length})`,
                icon: Network,
              },
              ...(isVm
                ? [
                    {
                      id: "storage" as const,
                      label: "Storage & OS Installer",
                      icon: HardDrive,
                    },
                  ]
                : []),
            ] as const
          ).map(({ id, label: tabLabel, icon: TabIcon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  active
                    ? "border-[#22D3EE] text-cyan-600 dark:text-[#22D3EE]"
                    : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                <span>{tabLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4 bg-white dark:bg-[#111827]">
          {feedback && (
            <div
              className={`rounded-lg px-3.5 py-2.5 text-xs border flex items-center gap-2 ${
                feedback.kind === "ok"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
              }`}
            >
              {feedback.kind === "ok" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {activeTab === "general" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                    Hostname / Label
                  </span>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="fw1"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </label>

                {isVm && (
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Guest OS Family &amp; NIC Naming
                    </span>
                    <select
                      value={osProfileId}
                      disabled={isRunning}
                      onChange={(e) => handleSelectProfile(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-zinc-100"
                    >
                      {osProfiles.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.name} ({prof.nicNamingPattern})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {isVm && (
                <>
                  {/* Multi-Architecture QEMU Emulation & Hardware Emulation Matrix */}
                  <div className="rounded-xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                        CPU Architecture, NIC Driver &amp; System Bus
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                        qemu-system-{arch}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                          Guest CPU Architecture
                        </span>
                        <select
                          value={arch}
                          disabled={isRunning}
                          onChange={(e) => setArch(e.target.value as GuestArch)}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                        >
                          <option value="aarch64">
                            ARM64 (aarch64 • -M virt • HVF on Apple Silicon)
                          </option>
                          <option value="x86_64">
                            x86_64 (amd64 • -M q35 • HVF on Intel / TCG MTTCG)
                          </option>
                          <option value="i386">
                            i386 (32-bit x86 • -M pc • Retro / FreeDOS)
                          </option>
                          <option value="riscv64">
                            RISC-V 64 (riscv64 • -M virt • Research)
                          </option>
                        </select>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                          NIC Hardware Model (Auto-Relabels Ports)
                        </span>
                        <select
                          value={nicModel}
                          disabled={isRunning}
                          onChange={(e) =>
                            handleChangeNicModel(e.target.value as NicModel)
                          }
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                        >
                          <option value="virtio-net-pci">
                            virtio-net-pci (eth / vtnet / vio / vioif)
                          </option>
                          <option value="e1000">
                            Intel e1000 Gigabit (em / wm / e1000g / ipro1000)
                          </option>
                          <option value="rtl8139">
                            Realtek RTL8139 Fast Ethernet (rl / rtk / re)
                          </option>
                          <option value="pcnet">
                            AMD PCnet-PCI II (pcn / le / FreeDOS PCNTPK)
                          </option>
                          <option value="ne2k_pci">
                            NE2000 PCI Classic (ne / ed / Crynwr NE2000)
                          </option>
                        </select>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                          Boot Firmware
                        </span>
                        <select
                          value={firmware}
                          disabled={isRunning}
                          onChange={(e) =>
                            setFirmware(e.target.value as FirmwareType)
                          }
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                        >
                          <option value="uefi">
                            UEFI (EDK2 pflash / OpenSBI)
                          </option>
                          <option value="bios">
                            SeaBIOS / Legacy BIOS (OPNsense nano, VyOS, FreeDOS)
                          </option>
                        </select>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                          Primary Disk Bus
                        </span>
                        <select
                          value={diskBus}
                          disabled={isRunning}
                          onChange={(e) =>
                            setDiskBus(e.target.value as DiskBus)
                          }
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                        >
                          <option value="virtio-blk">
                            VirtIO Block (virtio-blk-pci — Fastest)
                          </option>
                          <option value="ahci">
                            AHCI SATA (DragonFly BSD / Haiku / OmniOS)
                          </option>
                          <option value="ide">
                            Legacy IDE (FreeDOS / Retro OSes)
                          </option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                        vCPU Cores (-smp)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        disabled={isRunning}
                        value={vcpus}
                        onChange={(e) =>
                          setVcpus(Math.max(1, Number(e.target.value) || 1))
                        }
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                    </label>

                    <div className="space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                        Memory MB (-m)
                      </span>
                      <input
                        type="number"
                        min={16}
                        max={16384}
                        step={32}
                        disabled={isRunning}
                        value={memoryMb}
                        onChange={(e) =>
                          setMemoryMb(
                            Math.max(16, Number(e.target.value) || 256)
                          )
                        }
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                      <div className="flex flex-wrap gap-1 pt-1">
                        {[32, 128, 256, 512, 1024, 2048, 4096].map((mb) => (
                          <button
                            key={mb}
                            type="button"
                            disabled={isRunning}
                            onClick={() => setMemoryMb(mb)}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                              memoryMb === mb
                                ? "bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-300"
                                : "bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400"
                            }`}
                          >
                            {mb} MB
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Graphical UEFI Display Mode */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                      UEFI Graphical Display Mode (-device ramfb)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => setDisplayMode("vnc")}
                        className={`text-left p-3 rounded-xl border transition-all ${
                          displayMode === "vnc"
                            ? "border-sky-500 bg-sky-500/10"
                            : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                          <Monitor className="w-3.5 h-3.5 text-sky-500" />
                          <span>Headless + Embedded VNC</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                          Streams UEFI framebuffer inside Etherloom&apos;s dock
                          without opening extra macOS windows.
                        </p>
                      </button>

                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => setDisplayMode("cocoa")}
                        className={`text-left p-3 rounded-xl border transition-all ${
                          displayMode === "cocoa"
                            ? "border-sky-500 bg-sky-500/10"
                            : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                          <Monitor className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Native macOS Cocoa Window</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                          Launches QEMU&apos;s native Metal/Cocoa window
                          (-display cocoa) alongside serial console.
                        </p>
                      </button>
                    </div>
                  </div>
                </>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Role / Topology Notes (Optional)
                </span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. AS65001 Edge pf + bgpd router"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-zinc-100"
                />
              </label>
            </div>
          )}

          {activeTab === "interfaces" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-600 dark:text-zinc-400">
                  {isVm
                    ? "Add/remove virtio-net-pci NICs, customize MACs, and attach IP helper badges shown directly on the canvas."
                    : "Configure switch/hub port count and optional VLAN/segment labels."}
                </p>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={handleAddPort}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isVm ? "Add NIC" : "Add Port"}</span>
                </button>
              </div>

              <div className="space-y-2">
                {ports.map((port) => (
                  <div
                    key={port.id}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                  >
                    <div className="sm:col-span-2 flex items-center gap-1.5">
                      <span className="px-2 py-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-mono text-xs font-semibold">
                        {port.label}
                      </span>
                    </div>

                    <div className="sm:col-span-4 flex items-center gap-1">
                      <input
                        type="text"
                        disabled={isRunning}
                        value={port.mac}
                        onChange={(e) =>
                          handleUpdatePort(port.id, { mac: e.target.value })
                        }
                        title="MAC Address"
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      />
                      <button
                        type="button"
                        disabled={isRunning}
                        title="Regenerate random 52:54:00 MAC"
                        onClick={() =>
                          handleUpdatePort(port.id, { mac: generateQemuMac() })
                        }
                        className="p-1.5 rounded-md border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        value={port.ipLabel ?? ""}
                        onChange={(e) =>
                          handleUpdatePort(port.id, {
                            ipLabel: e.target.value || null,
                          })
                        }
                        placeholder="IP badge (e.g. 10.0.1.1/24)"
                        className="w-full px-2 py-1 text-xs font-mono rounded-md bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        value={port.notes ?? ""}
                        onChange={(e) =>
                          handleUpdatePort(port.id, {
                            notes: e.target.value || null,
                          })
                        }
                        placeholder="Notes"
                        className="w-full px-2 py-1 text-xs rounded-md bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      />
                    </div>

                    <div className="sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        disabled={isRunning || ports.length <= 1}
                        onClick={() => handleRemovePort(port.id)}
                        title="Remove interface"
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "storage" && isVm && (
            <div className="space-y-4">
              {/* Provisioning Source Selector */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setStorageSource("template")}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    storageSource === "template"
                      ? "border-sky-500 bg-sky-500/10"
                      : "border-slate-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                    <Layers className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Read-Only Base Template</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                    Instant Copy-on-Write qcow2 overlay backed by a Golden
                    Image.
                  </p>
                </button>

                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setStorageSource("installer")}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    storageSource === "installer"
                      ? "border-sky-500 bg-sky-500/10"
                      : "border-slate-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                    <Disc className="w-3.5 h-3.5 text-amber-500" />
                    <span>Install OS from .iso / .img</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                    Boot official OpenBSD, FreeBSD, NetBSD, or Linux media onto
                    a blank disk.
                  </p>
                </button>
              </div>

              {storageSource === "template" ? (
                <div className="space-y-3 rounded-xl bg-slate-50 dark:bg-[#0D1321] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] p-3.5">
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      Select Registered Base Template
                    </span>
                    {baseTemplates.length === 0 ? (
                      <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2.5">
                        <p className="leading-relaxed">
                          No Golden Base Templates are downloaded in{" "}
                          <code className="font-mono">templates/</code> yet.
                          Download <strong>{osProfiles.find((p) => p.id === osProfileId)?.name ?? osProfileId}</strong>{" "}
                          directly in the OS Library, or switch to{" "}
                          <strong>Install OS from .iso / .img</strong>.
                        </p>
                        {onOpenOsLibrary && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenOsLibrary(osProfileId);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] text-xs font-semibold shadow-sm transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              Open OS Library to Download{" "}
                              {osProfiles.find((p) => p.id === osProfileId)?.name ?? "OS Image"}
                            </span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <select
                          value={templateId}
                          disabled={isRunning}
                          onChange={(e) => setTemplateId(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-900 dark:text-slate-100"
                        >
                          <option value="">-- Choose a Base Template --</option>
                          {baseTemplates.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              {tpl.name} ({tpl.filename} •{" "}
                              {formatByteSize(tpl.actualSizeBytes)})
                            </option>
                          ))}
                        </select>
                        {onOpenOsLibrary &&
                          !baseTemplates.some(
                            (t) => t.osProfileId === osProfileId
                          ) && (
                            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#22D3EE]/10 border border-[#22D3EE]/25 px-3 py-2 text-[11px] text-cyan-800 dark:text-cyan-200">
                              <span>
                                No template matching{" "}
                                <code className="font-mono">{osProfileId}</code>{" "}
                                is downloaded yet.
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onOpenOsLibrary(osProfileId);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] font-semibold"
                              >
                                <Download className="w-3 h-3" />
                                <span>Download in OS Library</span>
                              </button>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 p-3.5">
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Installer Media (.iso or .img, e.g. install76.img)
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        disabled={isRunning}
                        value={bootMediaPath}
                        onChange={(e) => setBootMediaPath(e.target.value)}
                        placeholder="/path/to/install76.img or FreeBSD-arm64.iso"
                        className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      />
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => void handleBrowseInstaller()}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Browse…</span>
                      </button>
                      {bootMediaPath && (
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={() => setBootMediaPath("")}
                          title="Eject installer media"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60"
                        >
                          Eject
                        </button>
                      )}
                    </div>

                    {discoveredIsos.length > 0 && (
                      <div className="pt-1">
                        <select
                          value=""
                          disabled={isRunning}
                          onChange={(e) => {
                            if (e.target.value) {
                              setBootMediaPath(e.target.value);
                            }
                          }}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300"
                        >
                          <option value="">
                            Quick-select from Library isos/ (
                            {discoveredIsos.length} found)…
                          </option>
                          {discoveredIsos.map((iso) => (
                            <option key={iso.path} value={iso.path}>
                              {iso.filename} ({formatByteSize(iso.sizeBytes)})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                        Boot Media Attachment Bus
                      </span>
                      <select
                        value={bootMediaBus}
                        disabled={isRunning}
                        onChange={(e) =>
                          setBootMediaBus(e.target.value as BootMediaBus)
                        }
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      >
                        <option value="auto">
                          Auto (USB for .img, SCSI CD for .iso)
                        </option>
                        <option value="usb">
                          USB Storage (Best for OpenBSD .img)
                        </option>
                        <option value="cdrom">
                          Virtio-SCSI CD-ROM (Best for .iso)
                        </option>
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                        Blank Virtual Disk Size (GB)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={256}
                        disabled={isRunning}
                        value={diskSizeGb}
                        onChange={(e) =>
                          setDiskSizeGb(Math.max(1, Number(e.target.value) || 8))
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Active Node Disk Status + Wipe & Promote-to-Template Actions */}
              <div className="rounded-xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                      Node Virtual Disk (.qcow2)
                    </div>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 truncate">
                      {diskStatus?.diskPath ?? "overlays/" + node.id + ".qcow2"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      diskStatus?.exists
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                    }`}
                  >
                    {diskStatus?.exists
                      ? `Provisioned (${formatByteSize(diskStatus.sizeBytes)})`
                      : "Created on Boot"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isRunning || Boolean(busyMessage) || !diskStatus?.exists}
                    onClick={() => void handleResetDisk()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Wipe / Reset Node Disk</span>
                  </button>

                  <button
                    type="button"
                    disabled={isRunning || Boolean(busyMessage)}
                    onClick={() => setPromoteOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium shadow-2xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Save Installed Disk as Reusable Template</span>
                  </button>
                </div>

                {promoteOpen && (
                  <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-500/30 space-y-2.5">
                    <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      Promote Shut-Down Disk to Read-Only Golden Template
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={promoteName}
                        onChange={(e) => setPromoteName(e.target.value)}
                        placeholder="Template Name (e.g. OpenBSD 7.6 Base)"
                        className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                      <input
                        type="text"
                        value={promoteDesc}
                        onChange={(e) => setPromoteDesc(e.target.value)}
                        placeholder="Optional description"
                        className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPromoteOpen(false)}
                        className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyMessage)}
                        onClick={() => void handlePromoteToTemplate()}
                        className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                      >
                        {busyMessage ? "Promoting…" : "Create Golden Template"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/80 dark:bg-[#090E18]/90 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onDeleteNode(node.id);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-[#F43F5E]/10 dark:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Node</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-[#1E2B42]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] text-xs font-semibold shadow-sm transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Apply Configuration</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
