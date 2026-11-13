import { useMemo, useState, type DragEvent } from "react";
import {
  Cpu,
  Disc,
  GripVertical,
  HardDrive,
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
}

function resolveFamilyFromProfileId(profileId: string): GuestFamily {
  const lower = profileId.toLowerCase();
  if (lower.includes("openbsd")) return "openbsd";
  if (lower.includes("freebsd")) return "freebsd";
  if (lower.includes("netbsd")) return "netbsd";
  return "linux";
}

function getComponentIcon(item: CatalogComponent) {
  if (item.kind === "l2_switch") return Network;
  if (item.kind === "l1_hub") return Radio;
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
  if (kind === "l2_switch") {
    return "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25";
  }
  if (kind === "l1_hub") {
    return "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/25";
  }
  switch (guestFamily) {
    case "openbsd":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25";
    case "freebsd":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25";
    case "netbsd":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25";
    default:
      return "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25";
  }
}

export function LeftSidebar({
  catalog,
  baseTemplates,
  templatesDir,
  onAddComponent,
  onAddFromTemplate,
  onOpenCustomVmWizard,
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
    <aside className="w-72 shrink-0 border-r border-slate-200/80 dark:border-zinc-800/90 bg-slate-50/90 dark:bg-zinc-900/60 backdrop-blur-sm flex flex-col h-full select-none">
      {/* Search Box + Custom VM / ISO Installer Wizard CTA */}
      <div className="p-3 space-y-2.5 border-b border-slate-200/70 dark:border-zinc-800/80">
        <button
          type="button"
          onClick={onOpenCustomVmWizard}
          className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5"
        >
          <Disc className="w-3.5 h-3.5 shrink-0" />
          <span>New Custom VM / Install OS</span>
        </button>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter switches, templates, OS…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-950/80 border border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>
      </div>

      {/* Scrollable Drag-and-Drop / Click-to-Add Component Palette */}
      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        {/* Built-in Userspace Switching Fabric */}
        {fabricNodes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Userspace Fabric
              </h2>
              <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                Drag or Click
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
                    className="w-full text-left group p-2.5 rounded-lg bg-white dark:bg-zinc-900/90 hover:bg-slate-100/90 dark:hover:bg-zinc-800/90 border border-slate-200/80 dark:border-zinc-800 cursor-grab active:cursor-grabbing transition-all flex items-start gap-2 shadow-2xs"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-zinc-600 mt-2 shrink-0" />
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
                        <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100 truncate">
                          {item.name}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                          <Plus className="w-3 h-3" /> Add
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                        {item.subtitle}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                          p1..p{item.defaultPorts}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                          {item.defaultPorts} ports
                        </span>
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
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Registered Templates</span>
              </h2>
              <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                CoW Instant
              </span>
            </div>
            <div className="space-y-1.5">
              {filteredTemplates.map((tpl) => {
                const fam = resolveFamilyFromProfileId(tpl.osProfileId);
                const nicPrefix = nicPrefixForFamily("vm", fam);
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
                    className="w-full text-left group p-2.5 rounded-lg bg-white dark:bg-zinc-900/90 hover:bg-emerald-50/50 dark:hover:bg-zinc-800/90 border border-emerald-500/25 dark:border-emerald-500/25 cursor-grab active:cursor-grabbing transition-all flex items-start gap-2 shadow-2xs"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-zinc-600 mt-2 shrink-0" />
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
                        <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100 truncate">
                          {tpl.name}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Plus className="w-3 h-3" /> Add
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                        {tpl.description || tpl.filename}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                          {nicPrefix}0..1
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                          {formatByteSize(tpl.actualSizeBytes)} RO
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
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Guest OS Profiles
              </h2>
              <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                HVF + UEFI
              </span>
            </div>
            <div className="space-y-1.5">
              {guestNodes.map((item) => {
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
                    className="w-full text-left group p-2.5 rounded-lg bg-white dark:bg-zinc-900/90 hover:bg-slate-100/90 dark:hover:bg-zinc-800/90 border border-slate-200/80 dark:border-zinc-800 cursor-grab active:cursor-grabbing transition-all flex items-start gap-2 shadow-2xs"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-zinc-600 mt-2 shrink-0" />
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
                        <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100 truncate">
                          {item.name}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                          <Plus className="w-3 h-3" /> Add
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                        {item.subtitle}
                      </p>
                      <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                          {item.nicPrefix}0..{item.defaultPorts - 1}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                          {item.defaultVcpus} vCPU • {item.defaultMemoryMb} MB
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

      {/* Base Template Store Footer */}
      <div className="p-3 border-t border-slate-200/80 dark:border-zinc-800/90 bg-slate-100/60 dark:bg-zinc-950/40">
        <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-zinc-300">
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span>CoW Base Templates</span>
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
            {baseTemplates.length}
          </span>
        </div>
        <p
          title={templatesDir}
          className="mt-1 text-[10px] font-mono text-slate-500 dark:text-zinc-400 truncate"
        >
          {templatesDir}
        </p>
      </div>
    </aside>
  );
}
