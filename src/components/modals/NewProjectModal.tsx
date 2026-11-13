import { useEffect, useState } from "react";
import { FilePlus2, FolderOpen, X } from "lucide-react";
import { pickDirectoryDialog } from "../../services/tauriBridge";

interface NewProjectModalProps {
  open: boolean;
  defaultParentDir: string;
  onClose: () => void;
  onCreate: (params: {
    name: string;
    bundlePath: string;
    notes: string | null;
  }) => Promise<void>;
}

function slugifyName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled-lab";
}

export function NewProjectModal({
  open,
  defaultParentDir,
  onClose,
  onCreate,
}: NewProjectModalProps) {
  const [name, setName] = useState("Campus BGP Lab");
  const [parentDir, setParentDir] = useState(defaultParentDir);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setParentDir(defaultParentDir);
    setError(null);
  }, [open, defaultParentDir]);

  if (!open) return null;

  const bundlePreview = `${parentDir.replace(/\/+$/, "")}/${slugifyName(
    name
  )}.etherloom`;

  const handleBrowseFolder = async () => {
    const picked = await pickDirectoryDialog(
      "Select Parent Directory for New .etherloom Project",
      parentDir
    );
    if (picked) {
      setParentDir(picked);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim() || "Untitled Lab",
        bundlePath: bundlePreview,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 dark:bg-[#050912]/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[rgba(34,211,238,0.22)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[rgba(34,211,238,0.16)] bg-slate-50/70 dark:bg-[#0D1321]/90 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-[#22D3EE]" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              New Etherloom Project
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          {error && (
            <div className="rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Project Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campus Dual-Stack Lab"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-900 dark:text-slate-100"
            />
          </label>

          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Location
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void handleBrowseFolder()}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[rgba(34,211,238,0.20)] dark:bg-[#162032] text-xs font-medium hover:bg-slate-100 dark:hover:bg-[#1E2B42]"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#22D3EE]" />
                <span>Choose…</span>
              </button>
            </div>
            <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate pt-0.5">
              Bundle: {bundlePreview}
            </p>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Lab Notes (Optional)
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="OSPFv2/v3 + pf firewall topology"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.18)] text-slate-900 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/80 dark:bg-[#090E18]/90 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#1E2B42]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="px-4 py-1.5 rounded-lg bg-[#06B6D4] hover:bg-[#22D3EE] disabled:opacity-40 text-[#090E18] text-xs font-semibold transition-colors"
          >
            {busy ? "Creating…" : "Create .etherloom Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
