import { useCallback, useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Cpu,
  Disc,
  Loader2,
  Monitor,
  Network,
  Play,
  Radio,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Square,
  TableProperties,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  fabricClearSwitchMacTable,
  fabricGetSwitchMacTable,
} from "../../services/tauriBridge";
import type {
  MacTableEntry,
  NodePort,
  PortLinkState,
  TopologyNodeData,
} from "../../types/studio";

export type EtherloomFlowNode = Node<TopologyNodeData, "etherloomNode">;

function resolveHeaderBadge(data: TopologyNodeData) {
  if (data.kind === "l2_switch") {
    return {
      icon: Network,
      tag: "L2 Switch",
      accent: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    };
  }
  if (data.kind === "l1_hub") {
    return {
      icon: Radio,
      tag: "L1 Hub",
      accent: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30",
    };
  }
  switch (data.guestFamily) {
    case "openbsd":
      return {
        icon: Shield,
        tag: "OpenBSD",
        accent:
          "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
      };
    case "freebsd":
      return {
        icon: Server,
        tag: "FreeBSD",
        accent:
          "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
      };
    case "netbsd":
      return {
        icon: Server,
        tag: "NetBSD",
        accent:
          "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
      };
    default:
      return {
        icon: Cpu,
        tag: "Linux",
        accent:
          "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
      };
  }
}

function PortStatusLed({ state }: { state: PortLinkState }) {
  if (state === "active") {
    return (
      <span className="relative inline-flex w-2 h-2 shrink-0" title="Traffic active">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
        <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" />
      </span>
    );
  }
  if (state === "up") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_5px_rgba(16,185,129,0.55)]"
        title="Link Up"
      />
    );
  }
  if (state === "cut") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-rose-500 shrink-0 shadow-[0_0_5px_rgba(244,63,94,0.55)]"
        title="Cable Cut (Admin Down)"
      />
    );
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-slate-300 dark:bg-zinc-600 shrink-0"
      title="Unplugged"
    />
  );
}

function PortHandleCell({
  port,
  side,
  linkState,
}: {
  port: NodePort;
  side: "left" | "right";
  linkState: PortLinkState;
}) {
  const isLeft = side === "left";
  const handleColor =
    linkState === "cut"
      ? "!bg-rose-500"
      : linkState === "up" || linkState === "active"
      ? "!bg-emerald-500"
      : "!bg-sky-500 hover:!bg-sky-400";

  return (
    <div
      className={`relative flex items-center gap-1.5 py-1 min-w-0 ${
        isLeft ? "pl-2.5 pr-1 justify-start" : "pr-2.5 pl-1 justify-end text-right"
      }`}
      title={`${port.label} • MAC ${port.mac}${
        port.ipLabel ? ` • ${port.ipLabel}` : ""
      }${port.notes ? ` (${port.notes})` : ""}`}
    >
      <Handle
        id={port.id}
        type="source"
        position={isLeft ? Position.Left : Position.Right}
        className={`!w-3 !h-3 ${handleColor} !border-2 !border-white dark:!border-zinc-900 transition-transform hover:!scale-125`}
        style={{ top: "50%" }}
      />

      {isLeft ? (
        <div className="flex flex-col items-start min-w-0">
          <div className="inline-flex items-center gap-1.5">
            <PortStatusLed state={linkState} />
            <span className="text-[11px] font-mono font-medium text-slate-800 dark:text-zinc-200 leading-none">
              {port.label}
            </span>
          </div>
          {port.ipLabel && (
            <span className="mt-0.5 text-[9px] font-mono px-1 py-0.2 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/25 truncate max-w-[105px]">
              {port.ipLabel}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-end min-w-0">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-medium text-slate-800 dark:text-zinc-200 leading-none">
              {port.label}
            </span>
            <PortStatusLed state={linkState} />
          </div>
          {port.ipLabel && (
            <span className="mt-0.5 text-[9px] font-mono px-1 py-0.2 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/25 truncate max-w-[105px]">
              {port.ipLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function EtherloomNode({
  id,
  data,
  selected,
}: NodeProps<EtherloomFlowNode>) {
  const { icon: Icon, tag, accent } = resolveHeaderBadge(data);
  const status = data.status ?? "stopped";
  const isVm = data.kind === "vm";
  const isSwitch = data.kind === "l2_switch";

  const [macPopoverOpen, setMacPopoverOpen] = useState(false);
  const [macPinned, setMacPinned] = useState(false);
  const [macEntries, setMacEntries] = useState<MacTableEntry[]>([]);
  const [macLoading, setMacLoading] = useState(false);

  const loadMacTable = useCallback(async () => {
    if (!isSwitch) return;
    setMacLoading(true);
    try {
      const rows = await fabricGetSwitchMacTable(id);
      setMacEntries(rows);
    } catch {
      setMacEntries([]);
    } finally {
      setMacLoading(false);
    }
  }, [id, isSwitch]);

  useEffect(() => {
    if (!isSwitch || (!macPopoverOpen && !macPinned)) return;
    void loadMacTable();
    const timer = window.setInterval(() => {
      void loadMacTable();
    }, 1250);
    return () => window.clearInterval(timer);
  }, [isSwitch, macPopoverOpen, macPinned, loadMacTable]);

  // Split ports evenly into Left and Right columns so handles sit cleanly along both node edges
  const midpoint = Math.ceil(data.ports.length / 2);
  const leftPorts = data.ports.slice(0, midpoint);
  const rightPorts = data.ports.slice(midpoint);
  const rowCount = Math.max(leftPorts.length, rightPorts.length, 1);

  const portLabelMap = new Map<string, string>(
    data.ports.map((p) => [p.id, p.label])
  );

  const renderStatusBadge = () => {
    if (!isVm) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-700 dark:text-sky-300">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          Always-On
        </span>
      );
    }
    if (status === "booting") {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-500" />
          Booting
        </span>
      );
    }
    if (status === "running") {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Running
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-zinc-500" />
        Stopped
      </span>
    );
  };

  return (
    <div
      className={`relative min-w-[238px] rounded-xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border transition-all shadow-md ${
        selected
          ? "border-sky-500 ring-2 ring-sky-500/30"
          : "border-slate-200/90 dark:border-zinc-700/90 hover:border-slate-300 dark:hover:border-zinc-600"
      }`}
    >
      {/* Live Learned MAC Address Table Popover for L2 Ethernet Switches */}
      {isSwitch && (macPopoverOpen || macPinned) && (
        <div
          className="nodrag nopan absolute left-1/2 -translate-x-1/2 bottom-full mb-2.5 w-72 rounded-xl bg-white/98 dark:bg-zinc-900/98 backdrop-blur-xl border border-slate-200 dark:border-zinc-700 shadow-xl p-3 z-50"
          onMouseEnter={() => setMacPopoverOpen(true)}
          onMouseLeave={() => setMacPopoverOpen(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <TableProperties className="w-3.5 h-3.5 text-sky-500" />
              <span className="text-xs font-semibold text-slate-800 dark:text-zinc-100">
                {data.label} — MAC Table
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                {macEntries.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Refresh MAC table"
                onClick={() => void loadMacTable()}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400"
              >
                <RefreshCw
                  className={`w-3 h-3 ${macLoading ? "animate-spin" : ""}`}
                />
              </button>
              <button
                type="button"
                title="Flush learned MAC addresses"
                onClick={() => {
                  void fabricClearSwitchMacTable(id).then(() => loadMacTable());
                }}
                className="p-1 rounded hover:bg-rose-500/15 text-slate-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {macEntries.length === 0 ? (
            <p className="py-3 text-[11px] text-center text-slate-500 dark:text-zinc-400">
              No MAC addresses learned yet. Transmit frames across switch ports to
              populate 802.1D forwarding entries.
            </p>
          ) : (
            <div className="mt-2 max-h-44 overflow-y-auto">
              <table className="w-full text-left text-[10px] font-mono">
                <thead>
                  <tr className="text-slate-400 dark:text-zinc-500 border-b border-slate-100 dark:border-zinc-800">
                    <th className="pb-1 font-medium">MAC Address</th>
                    <th className="pb-1 font-medium">Port</th>
                    <th className="pb-1 font-medium text-right">Frames</th>
                    <th className="pb-1 font-medium text-right">TTL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/70">
                  {macEntries.map((row) => (
                    <tr
                      key={row.mac}
                      className="text-slate-700 dark:text-zinc-200"
                    >
                      <td className="py-1">{row.mac}</td>
                      <td className="py-1">
                        <span className="px-1 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                          {portLabelMap.get(row.portId) ?? row.portId}
                        </span>
                      </td>
                      <td className="py-1 text-right">{row.framesSeen}</td>
                      <td className="py-1 text-right text-slate-400 dark:text-zinc-500">
                        {Math.ceil(row.ttlRemainingMs / 1000)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Card Header: OS/Device Badge, Hostname, Running State */}
      <div className="px-3 py-2 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${accent}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
              {data.label}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-zinc-400 truncate">
              {tag}
              {data.notes ? ` • ${data.notes}` : ""}
            </div>
          </div>
        </div>

        {renderStatusBadge()}
      </div>

      {/* Explicit Left & Right Interface Ports with Per-Port Connection Handles */}
      <div className="py-1.5 divide-y divide-slate-100/70 dark:divide-zinc-800/50">
        {Array.from({ length: rowCount }, (_, rowIdx) => {
          const leftPort = leftPorts[rowIdx];
          const rightPort = rightPorts[rowIdx];
          return (
            <div
              key={rowIdx}
              className="grid grid-cols-2 items-center min-h-[26px]"
            >
              <div>
                {leftPort && (
                  <PortHandleCell
                    port={leftPort}
                    side="left"
                    linkState={data.portStates?.[leftPort.id] ?? "unplugged"}
                  />
                )}
              </div>
              <div>
                {rightPort && (
                  <PortHandleCell
                    port={rightPort}
                    side="right"
                    linkState={data.portStates?.[rightPort.id] ?? "unplugged"}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Action Bar & Resource / MAC Table Footer */}
      <div className="px-2.5 py-1.5 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/40 rounded-b-xl flex items-center justify-between gap-1.5">
        {isVm ? (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-zinc-400 truncate">
            <span>
              {data.vcpus ?? 2}c • {data.memoryMb ?? 512}M
            </span>
            {data.bootMediaPath && (
              <span
                title={`Installer attached: ${data.bootMediaPath}`}
                className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
              >
                <Disc className="w-2.5 h-2.5" />
                ISO
              </span>
            )}
          </div>
        ) : isSwitch ? (
          <button
            type="button"
            onMouseEnter={() => setMacPopoverOpen(true)}
            onMouseLeave={() => setMacPopoverOpen(false)}
            onClick={(e) => {
              e.stopPropagation();
              setMacPinned((v) => !v);
            }}
            className={`nodrag inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              macPinned
                ? "bg-sky-600 text-white"
                : "bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300"
            }`}
            title="Hover or click to inspect live learned 802.1D MAC address table"
          >
            <TableProperties className="w-3 h-3" />
            <span>MAC Table</span>
          </button>
        ) : (
          <span className="text-[10px] text-slate-500 dark:text-zinc-400">
            Repeater ({data.ports.length}p)
          </span>
        )}

        {/* Quick Action Buttons (`nodrag`) */}
        <div className="nodrag flex items-center gap-1 shrink-0">
          {isVm && (
            <>
              <button
                type="button"
                title={
                  status === "running" || status === "booting"
                    ? `Stop ${data.label}`
                    : `Boot ${data.label} (-accel hvf)`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  data.onToggleRun?.(id);
                }}
                className={`p-1 rounded-md transition-colors ${
                  status === "running" || status === "booting"
                    ? "bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 dark:text-rose-400"
                    : "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
                }`}
              >
                {status === "running" || status === "booting" ? (
                  <Square className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current" />
                )}
              </button>

              <button
                type="button"
                title={`Open Serial Console (${data.label})`}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onOpenConsole?.(id, "serial");
                }}
                className="p-1 rounded-md text-slate-600 hover:bg-slate-200/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <Terminal className="w-3 h-3" />
              </button>

              <button
                type="button"
                title={`Open UEFI Display / VNC (${data.label})`}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onOpenConsole?.(id, "display");
                }}
                className="p-1 rounded-md text-slate-600 hover:bg-slate-200/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <Monitor className="w-3 h-3" />
              </button>
            </>
          )}

          <button
            type="button"
            title={`Configure ${data.label}`}
            onClick={(e) => {
              e.stopPropagation();
              data.onOpenSettings?.(id);
            }}
            className="p-1 rounded-md text-slate-600 hover:bg-slate-200/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
