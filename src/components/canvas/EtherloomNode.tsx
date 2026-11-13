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
  GuestArch,
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
      accent:
        "bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE] border-cyan-400/30",
    };
  }
  if (data.kind === "l1_hub") {
    return {
      icon: Radio,
      tag: "L1 Hub",
      accent:
        "bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE] border-cyan-400/30",
    };
  }

  const prof = (data.osProfileId ?? "").toLowerCase();
  if (prof === "openwrt") {
    return {
      icon: Radio,
      tag: "OpenWrt",
      accent:
        "bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE] border-cyan-400/30",
    };
  }
  if (prof === "mikrotik-chr") {
    return {
      icon: Network,
      tag: "RouterOS CHR",
      accent:
        "bg-indigo-500/15 text-indigo-700 dark:text-[#818CF8] border-indigo-400/30",
    };
  }
  if (prof === "vyos") {
    return {
      icon: Network,
      tag: "VyOS",
      accent:
        "bg-indigo-500/15 text-indigo-700 dark:text-[#818CF8] border-indigo-400/30",
    };
  }
  if (prof === "opnsense") {
    return {
      icon: Shield,
      tag: "OPNsense",
      accent:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
    };
  }
  if (prof === "pfsense") {
    return {
      icon: Shield,
      tag: "pfSense CE",
      accent:
        "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-400/30",
    };
  }
  if (prof === "9front") {
    return {
      icon: Terminal,
      tag: "9front Plan 9",
      accent:
        "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-400/30",
    };
  }
  if (prof === "omnios") {
    return {
      icon: Server,
      tag: "OmniOS Illumos",
      accent:
        "bg-indigo-500/15 text-indigo-700 dark:text-[#818CF8] border-indigo-400/30",
    };
  }
  if (prof === "dragonflybsd") {
    return {
      icon: Server,
      tag: "DragonFly BSD",
      accent:
        "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-400/30",
    };
  }
  if (prof === "haiku") {
    return {
      icon: Monitor,
      tag: "Haiku OS",
      accent:
        "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-400/30",
    };
  }
  if (prof === "freedos") {
    return {
      icon: Terminal,
      tag: "FreeDOS mTCP",
      accent:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
    };
  }
  if (prof === "alpine-linux") {
    return {
      icon: Cpu,
      tag: "Alpine Linux",
      accent:
        "bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE] border-cyan-400/30",
    };
  }
  if (prof === "debian-linux") {
    return {
      icon: Server,
      tag: "Debian Linux",
      accent:
        "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-400/30",
    };
  }

  switch (data.guestFamily) {
    case "openbsd":
      return {
        icon: Shield,
        tag: "OpenBSD",
        accent:
          "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
      };
    case "freebsd":
      return {
        icon: Server,
        tag: "FreeBSD",
        accent:
          "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-400/30",
      };
    case "netbsd":
      return {
        icon: Server,
        tag: "NetBSD",
        accent:
          "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/30",
      };
    default:
      return {
        icon: Cpu,
        tag: "Linux",
        accent:
          "bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border-emerald-400/30",
      };
  }
}

function resolveArchAccelBadge(
  archRaw?: GuestArch | null,
  hostArchRaw?: string | null
) {
  const arch: GuestArch = archRaw ?? "aarch64";
  const hostArch = hostArchRaw ?? "aarch64";
  const isNativeHvf =
    (arch === "aarch64" && hostArch === "aarch64") ||
    (arch === "x86_64" && hostArch === "x86_64");
  const archShort =
    arch === "aarch64"
      ? "ARM64"
      : arch === "x86_64"
      ? "x86_64"
      : arch === "i386"
      ? "i386"
      : "RISC-V";
  return {
    label: `${archShort} • ${isNativeHvf ? "HVF" : "TCG"}`,
    isNativeHvf,
  };
}

/**
 * Ring-Jack Interface Handle styled directly after the circular ring terminals (`o`)
 * in the Etherloom emblem: hollow `#090E18` center + crisp 2.5px colored ring +
 * pulsing `#22D3EE` halo during active traffic.
 */
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

  const ringBorderClass =
    linkState === "cut"
      ? "!border-[#F43F5E] shadow-[0_0_8px_rgba(244,63,94,0.55)]"
      : linkState === "active"
      ? "!border-[#10B981] shadow-[0_0_10px_rgba(34,211,238,0.75)]"
      : linkState === "up"
      ? "!border-[#10B981] shadow-[0_0_6px_rgba(16,185,129,0.45)]"
      : "!border-[#64748B] hover:!border-[#22D3EE]";

  const nicPillAccent =
    linkState === "cut"
      ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30"
      : linkState === "active"
      ? "bg-cyan-500/12 text-cyan-800 dark:text-[#22D3EE] border-cyan-400/35"
      : linkState === "up"
      ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-500/25"
      : "bg-slate-100/90 dark:bg-[#090E18]/80 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/60";

  return (
    <div
      className={`relative flex items-center gap-1.5 py-1 min-w-0 ${
        isLeft ? "pl-3 pr-1 justify-start" : "pr-3 pl-1 justify-end text-right"
      }`}
      title={`${port.label} • MAC ${port.mac}${
        port.ipLabel ? ` • ${port.ipLabel}` : ""
      }${port.notes ? ` (${port.notes})` : ""}`}
    >
      {/* Pulsing Stream Cyan outer halo behind Ring-Jack when packets are flowing */}
      {linkState === "active" && (
        <span
          aria-hidden="true"
          style={{
            top: "50%",
            [isLeft ? "left" : "right"]: -7,
            transform: "translateY(-50%)",
          }}
          className="pointer-events-none absolute w-3.5 h-3.5 rounded-full bg-[#22D3EE]/55 animate-ping"
        />
      )}

      <Handle
        id={port.id}
        type="source"
        position={isLeft ? Position.Left : Position.Right}
        className={`!w-3.5 !h-3.5 !rounded-full !bg-white dark:!bg-[#090E18] !border-[2.5px] ${ringBorderClass} transition-transform hover:!scale-125`}
        style={{ top: "50%" }}
      />

      <div
        className={`flex flex-col min-w-0 ${
          isLeft ? "items-start" : "items-end"
        }`}
      >
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10.5px] font-medium border leading-none ${nicPillAccent}`}
        >
          <span>{port.label}</span>
        </span>
        {port.ipLabel && (
          <span className="mt-0.5 text-[9px] font-mono px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-800 dark:text-[#22D3EE] border border-cyan-400/25 truncate max-w-[108px]">
            {port.ipLabel}
          </span>
        )}
      </div>
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
  const archBadge = resolveArchAccelBadge(data.arch, data.hostArch);

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

  // Split ports evenly into Left and Right columns so ring-jacks sit cleanly along both node edges
  const midpoint = Math.ceil(data.ports.length / 2);
  const leftPorts = data.ports.slice(0, midpoint);
  const rightPorts = data.ports.slice(midpoint);
  const rowCount = Math.max(leftPorts.length, rightPorts.length, 1);

  const portLabelMap = new Map<string, string>(
    data.ports.map((p) => [p.id, p.label])
  );

  // 3px top accent strip colored by runtime class (#10B981 ARM64 HVF, #6366F1 x86/TCG, #22D3EE Switch/Hub)
  const topStripClass = !isVm
    ? "bg-gradient-to-r from-[#22D3EE] via-[#06B6D4] to-[#22D3EE]"
    : archBadge.isNativeHvf
    ? "bg-gradient-to-r from-[#10B981] via-[#34D399] to-[#10B981]"
    : "bg-gradient-to-r from-[#6366F1] via-[#818CF8] to-[#6366F1]";

  const renderStatusBadge = () => {
    if (!isVm) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-cyan-500/12 text-cyan-800 dark:text-[#22D3EE] border border-cyan-400/25">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE]" />
          Fabric
        </span>
      );
    }
    if (status === "booting") {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
          <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" />
          Booting
        </span>
      );
    }
    if (status === "running") {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-[#34D399] border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
          Running
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-[#090E18]/85 text-slate-500 dark:text-slate-400 border border-slate-200/80 dark:border-slate-700/60">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
        Stopped
      </span>
    );
  };

  return (
    <div
      className={`relative min-w-[260px] rounded-xl bg-white/95 dark:bg-[#162032]/95 dark:hover:bg-[#1E2B42]/95 backdrop-blur-md border transition-all ${
        selected
          ? "border-[#22D3EE] shadow-loom-cyan"
          : "border-slate-200/90 dark:border-[rgba(34,211,238,0.16)] hover:border-cyan-500/40 dark:hover:border-[rgba(34,211,238,0.42)] shadow-loom-card"
      }`}
    >
      {/* Sleek 3px Top Runtime Accent Strip */}
      <div className={`h-[3px] w-full rounded-t-[11px] ${topStripClass}`} />

      {/* Live Learned MAC Address Table Popover for L2 Ethernet Switches */}
      {isSwitch && (macPopoverOpen || macPinned) && (
        <div
          className="nodrag nopan absolute left-1/2 -translate-x-1/2 bottom-full mb-2.5 w-72 rounded-xl bg-white/98 dark:bg-[#111827]/96 backdrop-blur-xl border border-slate-200 dark:border-[rgba(34,211,238,0.28)] shadow-2xl p-3 z-50"
          onMouseEnter={() => setMacPopoverOpen(true)}
          onMouseLeave={() => setMacPopoverOpen(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <TableProperties className="w-3.5 h-3.5 text-[#22D3EE]" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                {data.label} — MAC Table
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE]">
                {macEntries.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Refresh MAC table"
                onClick={() => void loadMacTable()}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
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
                className="p-1 rounded hover:bg-rose-500/15 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {macEntries.length === 0 ? (
            <p className="py-3 text-[11px] text-center text-slate-500 dark:text-slate-400">
              No MAC addresses learned yet. Transmit frames across switch ports to
              populate 802.1D forwarding entries.
            </p>
          ) : (
            <div className="mt-2 max-h-44 overflow-y-auto">
              <table className="w-full text-left text-[10px] font-mono">
                <thead>
                  <tr className="text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                    <th className="pb-1 font-medium">MAC Address</th>
                    <th className="pb-1 font-medium">Port</th>
                    <th className="pb-1 font-medium text-right">Frames</th>
                    <th className="pb-1 font-medium text-right">TTL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {macEntries.map((row) => (
                    <tr
                      key={row.mac}
                      className="text-slate-700 dark:text-slate-200"
                    >
                      <td className="py-1">{row.mac}</td>
                      <td className="py-1">
                        <span className="px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-[#22D3EE]">
                          {portLabelMap.get(row.portId) ?? row.portId}
                        </span>
                      </td>
                      <td className="py-1 text-right">{row.framesSeen}</td>
                      <td className="py-1 text-right text-slate-400 dark:text-slate-500">
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
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${accent}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {data.label}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {tag}
              {data.notes ? ` • ${data.notes}` : ""}
            </div>
          </div>
        </div>

        {renderStatusBadge()}
      </div>

      {/* Explicit Left & Right Ring-Jack Interface Ports */}
      <div className="py-1.5 divide-y divide-slate-100/70 dark:divide-slate-800/60">
        {Array.from({ length: rowCount }, (_, rowIdx) => {
          const leftPort = leftPorts[rowIdx];
          const rightPort = rightPorts[rowIdx];
          return (
            <div
              key={rowIdx}
              className="grid grid-cols-2 items-center min-h-[28px]"
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

      {/* Patchbay Footer: Runtime Badge + Quick Actions */}
      <div className="px-2.5 py-1.5 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#090E18]/55 rounded-b-xl flex items-center justify-between gap-1.5">
        {isVm ? (
          <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 truncate">
            <span
              title={`Architecture: ${data.arch ?? "aarch64"} • NIC: ${
                data.nicModel ?? "virtio-net-pci"
              }`}
              className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-medium border shrink-0 ${
                archBadge.isNativeHvf
                  ? "bg-emerald-500/12 text-emerald-700 dark:text-[#34D399] border-emerald-500/30"
                  : "bg-indigo-500/15 text-indigo-700 dark:text-[#818CF8] border-indigo-500/30"
              }`}
            >
              {archBadge.label}
            </span>
            <span className="font-mono truncate">
              {data.vcpus ?? 2}c•{data.memoryMb ?? 512}M
            </span>
            {data.bootMediaPath && (
              <span
                title={`Installer attached: ${data.bootMediaPath}`}
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono font-medium shrink-0"
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
            className={`nodrag inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors border ${
              macPinned
                ? "bg-[#06B6D4] border-[#22D3EE] text-slate-950 font-semibold"
                : "bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400/25 text-cyan-700 dark:text-[#22D3EE]"
            }`}
            title="Hover or click to inspect live learned 802.1D MAC address table"
          >
            <TableProperties className="w-3 h-3" />
            <span>MAC Table</span>
          </button>
        ) : (
          <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
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
                    : `Boot ${data.label}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  data.onToggleRun?.(id);
                }}
                className={`p-1 rounded-md transition-colors ${
                  status === "running" || status === "booting"
                    ? "bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 dark:text-[#F43F5E]"
                    : "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-[#34D399]"
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
                className="p-1 rounded-md text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-cyan-500/15 dark:hover:text-[#22D3EE] transition-colors"
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
                className="p-1 rounded-md text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-indigo-500/15 dark:hover:text-[#818CF8] transition-colors"
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
            className="p-1 rounded-md text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-700/70 transition-colors"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
