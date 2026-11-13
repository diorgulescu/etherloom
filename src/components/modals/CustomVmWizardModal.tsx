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
  GuestFamily,
  InstallerMediaInfo,
  OsProfile,
  VmDisplayMode,
} from "../../types/studio";
import { formatByteSize } from "../../utils/topology";

export interface CustomVmWizardSubmission {
  hostname: string;
  osProfileId: string;
  guestFamily: GuestFamily;
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
      setTemplateId(baseTemplates[0].id);
    }
  }, [open, baseTemplates, bootMediaPath, templateId]);

  if (!open) return null;

  const handleSelectProfile = (id: string) => {
    setOsProfileId(id);
    const prof = osProfiles.find((p) => p.id === id);
    if (prof) {
      setGuestFamily(prof.guestFamily);
      setVcpus(prof.defaultCpus);
      setMemoryMb(prof.defaultRamMb);
      setDiskSizeGb(prof.recommendedDiskGb);
      if (hostname.endsWith("-install1") || hostname.startsWith("vm")) {
        setHostname(`${prof.guestFamily}-1`);
      }
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
      hostname: hostname.trim() || `${guestFamily}-1`,
      osProfileId,
      guestFamily,
      vcpus: Math.max(1, vcpus),
      memoryMb: Math.max(128, memoryMb),
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
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Disc className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                New Custom VM / Install OS Wizard
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                UEFI ARM64 (-M virt -accel hvf) with Dual Serial &amp; Graphical
                Console
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
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
                min={128}
                max={16384}
                step={128}
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
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
                  >
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
        <div className="px-5 py-3 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-950/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add VM to Topology</span>
          </button>
        </div>
      </div>
    </div>
  );
}
