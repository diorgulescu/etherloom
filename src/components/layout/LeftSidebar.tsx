import { useMemo, useState, type DragEvent } from "react";
import {
  Cpu,
  Disc,
  Globe,
  GripVertical,
  HardDrive,
  HardDriveDownload,
  Layers,
  Network,
  Plus,
  Radio,
  Search,
  Server,
  Shield,
  Sparkles,
} from "lucide-react";
import type {
  BaseTemplateInfo,
  CatalogComponent,
  GuestFamily,
} from "../../types/studio";
import { formatByteSize, nicPrefixForFamily } from "../../utils/topology";

export const PALETTE_DRAG_MIME = "application/etherloom-palette";

export type PaletteDropPayload =
  | { kind: "catalog"; component: CatalogComponent }
  | { kind: "template"; template: BaseTemplateInfo };

interface LeftSidebarProps {
  catalog: CatalogComponent[];
  baseTemplates: BaseTemplateInfo[];
  templatesDir: string;
  onAddComponent: (
    component: CatalogComponent,
    position?: { x: number; y: number }
  ) => void;
  onAddFromTemplate: (
    template: BaseTemplateInfo,
    position?: { x: number; y: number }
  ) => void;
  onOpenCustomVmWizard: () => void;
  onOpenStorageLibraryModal: () => void;
}

function resolveFamilyFromProfileId(profileId: string): GuestFamily {
  const lower = profileId.toLowerCase();
  if (lower.includes("openbsd")) return "openbsd";
  if (
    lower.includes("freebsd") ||
    lower.includes("opnsense") ||
    lower.includes("pfsense") ||
    lower.includes("dragonfly")
  ) {
    return "freebsd";
  }
  if (lower.includes("netbsd")) return "netbsd";
  if (
    lower.includes("9front") ||
    lower.includes("omnios") ||
    lower.includes("haiku") ||
    lower.includes("freedos")
  ) {
    return "other";
  }
  return "linux";
}

function getComponentIcon(item: CatalogComponent) {
  if (item.kind === "l2_switch") return Network;
  if (item.kind === "l1_hub") return Radio;
  if (item.kind === "dhcp_server") return Server;
  if (item.kind === "nat_gateway") return Globe;
  if (item.guestFamily === "openbsd") return Shield;
  if (item.guestFamily === "freebsd" || item.guestFamily === "netbsd") {
    return Server;
  }
  return Cpu;
}

function getAccentClasses(
  kind: CatalogComponent["kind"],
  guestFamily: GuestFamily | null
): string {
  if (kind === "l2_switch" || kind === "l1_hub") {
    return "bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE] border-cyan-400/30";
  }
  if (kind === "dhcp_server") {
    return "bg-indigo-500/15 text-indigo-700 dark:text-[#818CF8] border-indigo-400/30";
  }
  if (kind === "nat_gateway") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-400/30";
  }
  switch (guestFamily) {
    case "openbsd":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30";
    case "freebsd":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-400/30";
    case "netbsd":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30";
    default:
      return "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-400/30";
  }
}

export function LeftSidebar({
  catalog,
  baseTemplates,
  templatesDir,
  onAddComponent,
  onAddFromTemplate,
  onOpenCustomVmWizard,
  onOpenStorageLibraryModal,
}: LeftSidebarProps) {
  const [query, setQuery] = useState("");

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        c.nicPrefix.toLowerCase().includes(q)
    );
  }, [catalog, query]);

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return baseTemplates;
    return baseTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.osProfileId.toLowerCase().includes(q) ||
        t.filename.toLowerCase().includes(q)
    );
  }, [baseTemplates, query]);

  const fabricNodes = filteredCatalog.filter((c) => c.kind !== "vm");
  const guestNodes = filteredCatalog.filter((c) => c.kind === "vm");

  const startPaletteDrag = (
    e: DragEvent<HTMLElement>,
    payload: PaletteDropPayload
  ) => {
    e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="w-72 shrink-0 border-r border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-50 dark:bg-[#111827] flex flex-col h-full select-none">
      {/* Search Box + OS Library Downloader + Custom VM Wizard CTA */}
      <div className="p-3 space-y-2 border-b border-slate-200/70 dark:border-[rgba(34,211,238,0.12)]">
        <button
          type="button"
          onClick={onOpenStorageLibraryModal}
          className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-[#0891B2] via-[#06B6D4] to-[#6366F1] hover:brightness-110 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5"
        >
          <HardDriveDownload className="w-3.5 h-3.5 shrink-0" />
          <span>+ Get More OS Images (15)</span>
        </button>

        <button
          type="button"
          onClick={onOpenCustomVmWizard}
          className="w-full py-1.5 px-3 rounded-lg bg-white hover:bg-slate-100 dark:bg-[#162032] dark:hover:bg-[#1E2B42] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] dark:hover:border-[rgba(34,211,238,0.42)] text-slate-700 dark:text-slate-200 text-xs font-medium transition-all flex items-center justify-center gap-1.5"
        >
          <Disc className="w-3.5 h-3.5 shrink-0 text-[#F59E0B]" />
          <span>New Custom VM / Install ISO</span>
        </button>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter switches, templates, OS…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#090E18] border border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-[#22D3EE]/60 focus:ring-2 focus:ring-[#22D3EE]/25"
          />
        </div>
      </div>

      {/* Scrollable Drag-and-Drop / Click-to-Add Component Palette */}
      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        {/* Built-in Userspace Switching Fabric */}
        {fabricNodes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-[#22D3EE]">
                Userspace Fabric
              </h2>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                Drag / Click
              </span>
            </div>
            <div className="space-y-1.5">
              {fabricNodes.map((item) => {
                const Icon = getComponentIcon(item);
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) =>
                      startPaletteDrag(e, { kind: "catalog", component: item })
                    }
                    onClick={() => onAddComponent(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onAddComponent(item);
                      }
                    }}
                    className="w-full text-left group p-2.5 rounded-lg bg-white dark:bg-[#162032] hover:bg-slate-50 dark:hover:bg-[#1E2B42] border border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] dark:hover:border-[rgba(34,211,238,0.45)] cursor-grab active:cursor-grabbing transition-all flex items-start gap-2 shadow-2xs"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 mt-2 shrink-0" />
                    <div
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${getAccentClasses(
                        item.kind,
                        item.guestFamily
                      )}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {item.name}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] font-medium text-cyan-600 dark:text-[#22D3EE]">
                          <Plus className="w-3 h-3" /> Add
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {item.subtitle}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-800 dark:text-[#22D3EE] border border-cyan-400/20">
                          {item.defaultPorts === 1
                            ? "p1"
                            : `p1..p${item.defaultPorts}`}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          {item.defaultPorts === 1
                            ? "1 port (expandable)"
                            : `${item.defaultPorts} ports`}
                        </span>
                        {item.kind === "dhcp_server" && (
                          <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/12 text-indigo-700 dark:text-[#818CF8] border border-indigo-400/25">
                            Dual-Stack
                          </span>
                        )}
                        {item.kind === "nat_gateway" && (
                          <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-[#34D399] border border-emerald-400/25">
                            Zero-Root WAN
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Registered CoW Golden Base Templates */}
        {filteredTemplates.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-[#34D399] flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Registered Templates</span>
              </h2>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                CoW Instant
              </span>
            </div>
            <div className="space-y-1.5">
              {filteredTemplates.map((tpl) => {
                const fam = resolveFamilyFromProfileId(tpl.osProfileId);
                const nicPrefix = nicPrefixForFamily(
                  "vm",
                  fam,
                  tpl.osProfileId,
                  tpl.defaultNicModel
                );
                const isNative = (tpl.arch ?? "aarch64") === "aarch64";
                return (
                  <div
                    key={tpl.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) =>
                      startPaletteDrag(e, { kind: "template", template: tpl })
                    }
                    onClick={() => onAddFromTemplate(tpl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onAddFromTemplate(tpl);
                      }
                    }}
                    className="w-full text-left group p-2.5 rounded-lg bg-white dark:bg-[#162032] hover:bg-emerald-50/40 dark:hover:bg-[#1E2B42] border border-emerald-500/25 dark:border-emerald-400/25 dark:hover:border-[#34D399]/55 cursor-grab active:cursor-grabbing transition-all flex items-start gap-2 shadow-2xs"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 mt-2 shrink-0" />
                    <div
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${getAccentClasses(
                        "vm",
                        fam
                      )}`}
                    >
                      <Layers className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {tpl.name}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-[#34D399]">
                          <Plus className="w-3 h-3" /> Add
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {tpl.description || tpl.filename}
                      </p>
                      <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-[#34D399] border border-emerald-500/25">
                          {nicPrefix}0..1
                        </span>
                        <span
                          className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border ${
                            isNative
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-[#34D399] border-emerald-500/20"
                              : "bg-indigo-500/12 text-indigo-700 dark:text-[#818CF8] border-indigo-400/25"
                          }`}
                        >
                          {isNative ? "ARM64" : tpl.arch}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          {formatByteSize(tpl.actualSizeBytes)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Built-in Guest OS Profiles */}
        {guestNodes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Guest OS Profiles
              </h2>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                HVF • TCG
              </span>
            </div>
            <div className="space-y-1.5">
              {guestNodes.map((item) => {
                const Icon = getComponentIcon(item);
                const isNative = (item.arch ?? "aarch64") === "aarch64";
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) =>
                      startPaletteDrag(e, { kind: "catalog", component: item })
                    }
                    onClick={() => onAddComponent(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onAddComponent(item);
                      }
                    }}
                    className="w-full text-left group p-2.5 rounded-lg bg-white dark:bg-[#162032] hover:bg-slate-50 dark:hover:bg-[#1E2B42] border border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] dark:hover:border-[rgba(34,211,238,0.45)] cursor-grab active:cursor-grabbing transition-all flex items-start gap-2 shadow-2xs"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 mt-2 shrink-0" />
                    <div
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${getAccentClasses(
                        item.kind,
                        item.guestFamily
                      )}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {item.name}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] font-medium text-cyan-600 dark:text-[#22D3EE]">
                          <Plus className="w-3 h-3" /> Add
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {item.subtitle}
                      </p>
                      <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#090E18] text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-800">
                          {item.nicPrefix}0..{item.defaultPorts - 1}
                        </span>
                        <span
                          className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border ${
                            isNative
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-[#34D399] border-emerald-500/25"
                              : "bg-indigo-500/12 text-indigo-700 dark:text-[#818CF8] border-indigo-400/25"
                          }`}
                        >
                          {isNative ? "ARM64 HVF" : `${item.arch} TCG`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Base Template Store Footer (Clickable shortcut to Storage & OS Library Manager) */}
      <button
        type="button"
        onClick={onOpenStorageLibraryModal}
        title="Click to manage OS Library & External SSD Storage"
        className="w-full text-left p-3 border-t border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-100/60 hover:bg-slate-200/60 dark:bg-[#090E18]/65 dark:hover:bg-[#162032] transition-colors"
      >
        <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-200">
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
            <span>OS Library &amp; Storage</span>
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border border-emerald-500/25">
            {baseTemplates.length} Ready
          </span>
        </div>
        <p
          title={templatesDir}
          className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate"
        >
          {templatesDir}
        </p>
      </button>
    </aside>
  );
}
