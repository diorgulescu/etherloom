import { useEffect, useState } from "react";
import {
  Disc,
  FolderOpen,
  Layers,
  Monitor,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  listInstallerIsos,
  pickInstallerImageDialog,
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
  OsProfile,
  VmDisplayMode,
} from "../../types/studio";
import { formatByteSize } from "../../utils/topology";

export interface CustomVmWizardSubmission {
  hostname: string;
  osProfileId: string;
  guestFamily: GuestFamily;
  arch: GuestArch;
  nicModel: NicModel;
  firmware: FirmwareType;
  diskBus: DiskBus;
  vcpus: number;
  memoryMb: number;
  nicCount: number;
  displayMode: VmDisplayMode;
  sourceMode: "installer" | "template";
  templateId: string | null;
  bootMediaPath: string | null;
  bootMediaBus: BootMediaBus;
  diskSizeGb: number;
  notes: string | null;
}

interface CustomVmWizardModalProps {
  open: boolean;
  isosDir?: string;
  osProfiles: OsProfile[];
  baseTemplates: BaseTemplateInfo[];
  onClose: () => void;
  onCreateVm: (spec: CustomVmWizardSubmission) => void;
}

export function CustomVmWizardModal({
  open,
  isosDir,
  osProfiles,
  baseTemplates,
  onClose,
  onCreateVm,
}: CustomVmWizardModalProps) {
  const [hostname, setHostname] = useState("bsd-install1");
  const [osProfileId, setOsProfileId] = useState("openbsd");
  const [guestFamily, setGuestFamily] = useState<GuestFamily>("openbsd");
  const [arch, setArch] = useState<GuestArch>("aarch64");
  const [nicModel, setNicModel] = useState<NicModel>("virtio-net-pci");
  const [firmware, setFirmware] = useState<FirmwareType>("uefi");
  const [diskBus, setDiskBus] = useState<DiskBus>("virtio-blk");
  const [vcpus, setVcpus] = useState(2);
  const [memoryMb, setMemoryMb] = useState(512);
  const [nicCount, setNicCount] = useState(2);
  const [displayMode, setDisplayMode] = useState<VmDisplayMode>("vnc");
  const [sourceMode, setSourceMode] = useState<"installer" | "template">(
    "installer"
  );
  const [templateId, setTemplateId] = useState<string>("");
  const [bootMediaPath, setBootMediaPath] = useState("");
  const [bootMediaBus, setBootMediaBus] = useState<BootMediaBus>("auto");
  const [diskSizeGb, setDiskSizeGb] = useState(8);
  const [notes, setNotes] = useState("");
  const [discoveredIsos, setDiscoveredIsos] = useState<InstallerMediaInfo[]>(
    []
  );

  useEffect(() => {
    if (!open) return;
    void listInstallerIsos()
      .then((isos) => {
        setDiscoveredIsos(isos);
        if (isos.length > 0 && !bootMediaPath) {
          setBootMediaPath(isos[0].path);
        }
      })
      .catch(() => setDiscoveredIsos([]));
    if (baseTemplates.length > 0 && !templateId) {
      const byProfile = baseTemplates.find(
        (t) => t.osProfileId === osProfileId
      );
      if (byProfile) {
        setTemplateId(byProfile.id);
      }
    }
  }, [open, baseTemplates, bootMediaPath, osProfileId, templateId]);

  if (!open) return null;

  const handleSelectProfile = (id: string, overrideTemplateId?: string) => {
    setOsProfileId(id);
    setTemplateId(
      overrideTemplateId ??
        baseTemplates.find((t) => t.osProfileId === id)?.id ??
        ""
    );
    const prof = osProfiles.find((p) => p.id === id);
    if (prof) {
      setGuestFamily(prof.guestFamily);
      setArch(prof.arch ?? "aarch64");
      setNicModel(prof.defaultNicModel ?? "virtio-net-pci");
      setFirmware(prof.defaultFirmware ?? "uefi");
      setDiskBus(prof.defaultDiskBus ?? "virtio-blk");
      setVcpus(prof.defaultCpus);
      setMemoryMb(prof.defaultRamMb);
      setDiskSizeGb(prof.recommendedDiskGb);
      if (hostname.endsWith("-install1") || hostname.startsWith("vm")) {
        setHostname(`${prof.id}-1`);
      }
    }
  };

  const handleSelectTemplate = (nextTplId: string) => {
    setTemplateId(nextTplId);
    const chosen = baseTemplates.find((t) => t.id === nextTplId);
    if (
      chosen &&
      chosen.osProfileId &&
      chosen.description !== "Discovered qcow2 base template" &&
      chosen.osProfileId !== osProfileId
    ) {
      handleSelectProfile(chosen.osProfileId, chosen.id);
    }
  };

  const handleBrowse = async () => {
    const picked = await pickInstallerImageDialog(isosDir);
    if (picked) {
      setBootMediaPath(picked);
      setSourceMode("installer");
    }
  };

  const handleSubmit = () => {
    onCreateVm({
      hostname: hostname.trim() || `${osProfileId}-1`,
      osProfileId,
      guestFamily,
      arch,
      nicModel,
      firmware,
      diskBus,
      vcpus: Math.max(1, vcpus),
      memoryMb: Math.max(16, memoryMb),
      nicCount: Math.max(1, Math.min(16, nicCount)),
      displayMode,
      sourceMode,
      templateId:
        sourceMode === "template" && templateId ? templateId : null,
      bootMediaPath:
        sourceMode === "installer" && bootMediaPath.trim()
          ? bootMediaPath.trim()
          : null,
      bootMediaBus,
      diskSizeGb: Math.max(1, diskSizeGb),
      notes: notes.trim() || null,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 dark:bg-[#050912]/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[rgba(34,211,238,0.16)] bg-slate-50/70 dark:bg-[#0D1321]/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#090E18] border border-[#22D3EE]/35 text-[#22D3EE] flex items-center justify-center shadow-xs">
              <Disc className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                New Custom VM / Install OS Wizard
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Multi-Arch QEMU (ARM64 HVF • x86_64 • i386 • RISC-V) with Dual
                Console
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

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto overscroll-contain bg-white dark:bg-[#111827]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Hostname
              </span>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="openbsd-router1"
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                OS Family Profile
              </span>
              <select
                value={osProfileId}
                onChange={(e) => handleSelectProfile(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              >
                {osProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.nicNamingPattern})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                Architecture
              </span>
              <select
                value={arch}
                onChange={(e) => setArch(e.target.value as GuestArch)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              >
                <option value="aarch64">aarch64 (ARM64)</option>
                <option value="x86_64">x86_64 (amd64)</option>
                <option value="i386">i386 (Retro)</option>
                <option value="riscv64">riscv64</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                NIC Driver
              </span>
              <select
                value={nicModel}
                onChange={(e) => setNicModel(e.target.value as NicModel)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              >
                <option value="virtio-net-pci">virtio-net-pci</option>
                <option value="e1000">Intel e1000</option>
                <option value="rtl8139">RTL8139</option>
                <option value="pcnet">AMD PCnet</option>
                <option value="ne2k_pci">NE2000 PCI</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                Firmware
              </span>
              <select
                value={firmware}
                onChange={(e) => setFirmware(e.target.value as FirmwareType)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              >
                <option value="uefi">UEFI (EDK2)</option>
                <option value="bios">SeaBIOS</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                Disk Bus
              </span>
              <select
                value={diskBus}
                onChange={(e) => setDiskBus(e.target.value as DiskBus)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              >
                <option value="virtio-blk">virtio-blk</option>
                <option value="ahci">AHCI SATA</option>
                <option value="ide">Legacy IDE</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                vCPUs
              </span>
              <input
                type="number"
                min={1}
                max={16}
                value={vcpus}
                onChange={(e) => setVcpus(Number(e.target.value) || 1)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                RAM (MB)
              </span>
              <input
                type="number"
                min={16}
                max={16384}
                step={32}
                value={memoryMb}
                onChange={(e) => setMemoryMb(Number(e.target.value) || 512)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                NICs
              </span>
              <input
                type="number"
                min={1}
                max={12}
                value={nicCount}
                onChange={(e) => setNicCount(Number(e.target.value) || 2)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
              />
            </label>
          </div>

          {/* Source Mode */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setSourceMode("installer")}
              className={`p-2.5 rounded-xl border text-left ${
                sourceMode === "installer"
                  ? "border-sky-500 bg-sky-500/10"
                  : "border-slate-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                <Disc className="w-3.5 h-3.5 text-amber-500" />
                <span>Fresh Install (.iso / .img)</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Attach official installer &amp; create blank qcow2 disk
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSourceMode("template")}
              className={`p-2.5 rounded-xl border text-left ${
                sourceMode === "template"
                  ? "border-sky-500 bg-sky-500/10"
                  : "border-slate-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-zinc-100">
                <Layers className="w-3.5 h-3.5 text-emerald-500" />
                <span>From Base Template</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                Instant Copy-on-Write clone from Golden Image
              </p>
            </button>
          </div>

          {sourceMode === "installer" ? (
            <div className="rounded-xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 p-3.5 space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                  OS Installer Image (.iso / .img)
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={bootMediaPath}
                    onChange={(e) => setBootMediaPath(e.target.value)}
                    placeholder="Select install76.img, FreeBSD-disc1.iso, etc."
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => void handleBrowse()}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Browse…</span>
                  </button>
                </div>

                {discoveredIsos.length > 0 && (
                  <select
                    value={bootMediaPath}
                    onChange={(e) => setBootMediaPath(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                  >
                    <option value="">
                      -- Or pick from Library isos/ ({discoveredIsos.length}) --
                    </option>
                    {discoveredIsos.map((iso) => (
                      <option key={iso.path} value={iso.path}>
                        {iso.filename} ({formatByteSize(iso.sizeBytes)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                    Attachment Bus
                  </span>
                  <select
                    value={bootMediaBus}
                    onChange={(e) =>
                      setBootMediaBus(e.target.value as BootMediaBus)
                    }
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                  >
                    <option value="auto">
                      Auto (USB for .img, CD-ROM for .iso)
                    </option>
                    <option value="usb">USB Storage (qemu-xhci)</option>
                    <option value="cdrom">Virtio-SCSI CD-ROM</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                    Blank Disk Size (GB)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={diskSizeGb}
                    onChange={(e) =>
                      setDiskSizeGb(Math.max(1, Number(e.target.value) || 8))
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 dark:bg-zinc-950/70 border border-slate-200 dark:border-zinc-800 p-3.5">
              {baseTemplates.length === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  No Base Templates registered yet. Use{" "}
                  <strong>Fresh Install (.iso / .img)</strong> to install an OS,
                  then promote its shut-down disk to a reusable template in Node
                  Settings.
                </p>
              ) : (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                    Base Template
                  </span>
                  <select
                    value={templateId}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                  >
                    <option value="">-- Choose a Base Template --</option>
                    {baseTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.filename})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {/* Display Mode for UEFI Installer */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setDisplayMode("vnc")}
              className={`p-2.5 rounded-xl border text-left ${
                displayMode === "vnc"
                  ? "border-sky-500 bg-sky-500/10"
                  : "border-slate-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-900 dark:text-zinc-100">
                <Monitor className="w-3.5 h-3.5 text-sky-500" />
                <span>Embedded VNC (ramfb)</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("cocoa")}
              className={`p-2.5 rounded-xl border text-left ${
                displayMode === "cocoa"
                  ? "border-sky-500 bg-sky-500/10"
                  : "border-slate-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-900 dark:text-zinc-100">
                <Monitor className="w-3.5 h-3.5 text-indigo-500" />
                <span>Native Cocoa Window</span>
              </div>
            </button>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
              Role / Topology Notes (Optional)
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. OpenBSD 7.6 Edge Firewall"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800"
            />
          </label>

          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 flex items-start gap-2 text-[11px] text-emerald-800 dark:text-emerald-300">
            <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Tip: After completing installation inside the UEFI display and
              halting the guest, open <strong>Node Settings → Storage</strong>{" "}
              and click{" "}
              <strong>Save Installed Disk as Reusable Template</strong>.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/80 dark:bg-[#090E18]/90 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-[#1E2B42]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18] text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add VM to Topology</span>
          </button>
        </div>
      </div>
    </div>
  );
}
