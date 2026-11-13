import { useCallback, useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import {
  AppWindow,
  ClipboardCopy,
  ClipboardPaste,
  Info,
  Maximize,
  Monitor,
  Play,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  focusCocoaVmWindow,
  getConsoleSessionEndpoints,
  isTauriRuntime,
  sendVmCtrlAltDel,
} from "../../services/tauriBridge";
import type {
  GuestFamily,
  NodeRunStatus,
  VmDisplayMode,
} from "../../types/studio";

interface VncScreenPaneProps {
  nodeId: string;
  hostname: string;
  guestFamily: GuestFamily | null;
  displayMode: VmDisplayMode;
  status: NodeRunStatus;
  visible: boolean;
  onBootVm: () => void;
  onSwitchDisplayMode: (nextMode: VmDisplayMode) => void;
}

function resolveSerialSetupHint(family: GuestFamily | null): {
  title: string;
  command: string;
  note: string;
} {
  switch (family) {
    case "openbsd":
      return {
        title: "OpenBSD Post-Install Serial Console (com0)",
        command:
          'echo "stty com0 115200\nset tty com0" >> /etc/boot.conf',
        note: 'Or answer "yes" to "Change the default console to com0?" during install76.img setup.',
      };
    case "freebsd":
      return {
        title: "FreeBSD Dual EFI + Serial Console (ttyu0)",
        command:
          'sysrc -f /boot/loader.conf boot_multicons="YES" boot_serial="YES" console="efi,comconsole"',
        note: "Enables simultaneous UEFI framebuffer and ultra-fast copy/paste serial console.",
      };
    case "netbsd":
      return {
        title: "NetBSD Serial Console (com0 / tty00)",
        command: "consdev com0",
        note: "Select com0 during sysinst bootblocks setup or enable tty00 in /etc/ttys.",
      };
    case "linux":
    default:
      return {
        title: "Linux ARM64 PL011 Serial Console (ttyAMA0)",
        command: "console=ttyAMA0,115200",
        note: "Most ARM64 Linux images enable ttyAMA0 out-of-the-box alongside ramfb.",
      };
  }
}

export function VncScreenPane({
  nodeId,
  hostname,
  guestFamily,
  displayMode,
  status,
  visible,
  onBootVm,
  onSwitchDisplayMode,
}: VncScreenPaneProps) {
  const screenHostRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);

  const [rfbState, setRfbState] = useState<
    "standby" | "connecting" | "connected" | "disconnected"
  >("standby");
  const [vncPort, setVncPort] = useState<number | null>(null);
  const [scaleToFit, setScaleToFit] = useState(true);
  const [reconnectTick, setReconnectTick] = useState(0);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setFlashMsg(msg);
    window.setTimeout(() => {
      setFlashMsg((c) => (c === msg ? null : c));
    }, 2000);
  }, []);

  // Keep scaleViewport synced live
  useEffect(() => {
    if (rfbRef.current) {
      rfbRef.current.scaleViewport = scaleToFit;
    }
  }, [scaleToFit]);

  // Refocus canvas when tab becomes visible
  useEffect(() => {
    if (visible && rfbState === "connected") {
      rfbRef.current?.focus();
    }
  }, [visible, rfbState]);

  // Connect @novnc/novnc RFB over local Rust WebSocket bridge when VM is running in VNC mode
  useEffect(() => {
    const tearDown = () => {
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {
          // Ignore disconnect errors on unmounted socket
        }
        rfbRef.current = null;
      }
      if (screenHostRef.current) {
        screenHostRef.current.innerHTML = "";
      }
    };

    if (
      !isTauriRuntime() ||
      status === "stopped" ||
      displayMode !== "vnc"
    ) {
      tearDown();
      setRfbState("standby");
      setVncPort(null);
      return;
    }

    let cancelled = false;
    setRfbState("connecting");

    const connectAttempt = async () => {
      try {
        const ep = await getConsoleSessionEndpoints(nodeId);
        if (cancelled) return;
        setVncPort(ep.vncTcpPort);

        if (!ep.vncWsUrl || !screenHostRef.current) {
          setRfbState("disconnected");
          return;
        }

        tearDown();
        const rfb = new RFB(screenHostRef.current, ep.vncWsUrl, {
          shared: true,
          wsProtocols: ["binary"],
        });
        rfb.scaleViewport = scaleToFit;
        rfb.focusOnClick = true;
        rfb.clipViewport = false;
        rfb.background = "#090E18";

        rfb.addEventListener("connect", () => {
          if (!cancelled) {
            setRfbState("connected");
          }
        });

        rfb.addEventListener("disconnect", () => {
          if (!cancelled) {
            setRfbState(status === "running" ? "disconnected" : "standby");
          }
        });

        rfbRef.current = rfb;
      } catch {
        if (!cancelled) {
          setRfbState("disconnected");
        }
      }
    };

    void connectAttempt();

    return () => {
      cancelled = true;
      tearDown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, status, displayMode, reconnectTick]);

  const handleSendCtrlAltDel = async () => {
    if (rfbRef.current && rfbState === "connected") {
      rfbRef.current.sendCtrlAltDel();
      flash("Sent Ctrl+Alt+Del");
      return;
    }
    try {
      await sendVmCtrlAltDel(nodeId);
      flash("Sent Ctrl+Alt+Del (QMP)");
    } catch {
      flash("VM not ready");
    }
  };

  const handlePasteText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && rfbRef.current && rfbState === "connected") {
        rfbRef.current.clipboardPasteFrom(text);
        flash("Sent clipboard");
      }
    } catch {
      flash("Clipboard blocked");
    }
  };

  const handleFocusCocoa = async () => {
    try {
      await focusCocoaVmWindow(nodeId);
      flash("Focused QEMU Cocoa Window");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not focus window");
    }
  };

  const hint = resolveSerialSetupHint(guestFamily);

  return (
    <div
      className={`h-full w-full flex flex-col bg-[#090E18] rounded-lg border border-[rgba(34,211,238,0.16)] overflow-hidden ${
        visible ? "" : "hidden"
      }`}
    >
      {/* Top Graphical Toolbar */}
      <div className="h-7 px-2.5 bg-[#111827] border-b border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-2 min-w-0 font-mono text-zinc-400">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              rfbState === "connected" ||
              (displayMode === "cocoa" && status === "running")
                ? "bg-emerald-500"
                : rfbState === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-zinc-600"
            }`}
          />
          <span className="text-zinc-200 font-medium">
            {displayMode === "vnc" ? "ramfb • noVNC" : "ramfb • macOS Cocoa"}
          </span>
          {vncPort && displayMode === "vnc" && (
            <span className="hidden sm:inline text-zinc-500">
              127.0.0.1:{vncPort}
            </span>
          )}
          {flashMsg && (
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-sans">
              {flashMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {displayMode === "vnc" && (
            <>
              <button
                type="button"
                onClick={() => setScaleToFit((v) => !v)}
                title="Toggle Scale Viewport to Fit"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  scaleToFit
                    ? "bg-sky-500/20 text-sky-300"
                    : "hover:bg-zinc-800 text-zinc-400"
                }`}
              >
                <Maximize className="w-3 h-3" />
                <span className="hidden md:inline">Fit</span>
              </button>

              <button
                type="button"
                disabled={rfbState !== "connected"}
                onClick={() => void handlePasteText()}
                title="Send host clipboard text to VNC session"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 text-[10px]"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span className="hidden md:inline">Paste</span>
              </button>
            </>
          )}

          <button
            type="button"
            disabled={status === "stopped"}
            onClick={() => void handleSendCtrlAltDel()}
            title="Send Ctrl+Alt+Del to UEFI / Guest OS"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-rose-500/20 text-rose-300 disabled:opacity-35 text-[10px]"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>Ctrl+Alt+Del</span>
          </button>

          {displayMode === "vnc" && (
            <button
              type="button"
              onClick={() => setReconnectTick((t) => t + 1)}
              title="Reconnect VNC WebSocket"
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Subtle Helpful Post-Install Serial Console Hint Banner */}
      {!hintDismissed && (
        <div className="px-2.5 py-1.5 bg-sky-950/55 border-b border-sky-500/20 flex items-center justify-between gap-2 text-[11px] text-sky-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate">
              <strong>{hint.title}:</strong>{" "}
              <code className="px-1.5 py-0.5 rounded bg-zinc-900/90 text-emerald-300 font-mono text-[10px]">
                {hint.command}
              </code>{" "}
              <span className="text-sky-300/80 hidden xl:inline">
                — {hint.note}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(hint.command);
                flash("Copied serial config snippet");
              }}
              title="Copy serial console configuration command"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-[10px]"
            >
              <ClipboardCopy className="w-2.5 h-2.5" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              onClick={() => setHintDismissed(true)}
              title="Dismiss hint"
              className="p-0.5 rounded hover:bg-sky-500/20 text-sky-300"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Main Graphical Viewport */}
      <div className="relative flex-1 min-h-0 w-full bg-[#090E18] flex items-center justify-center overflow-hidden">
        {displayMode === "vnc" && (
          <div
            ref={screenHostRef}
            className={`w-full h-full ${
              rfbState === "connected" ? "block" : "hidden"
            }`}
          />
        )}

        {/* Standby / Cocoa / Disconnected States */}
        {displayMode === "cocoa" ? (
          <div className="max-w-md text-center p-4 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center mx-auto">
              <AppWindow className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-zinc-100">
                Native macOS Cocoa Display Mode ({hostname})
              </h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                This VM is configured with{" "}
                <code className="font-mono text-zinc-300">-display cocoa</code>{" "}
                for a standalone native macOS window.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {status === "running" ? (
                <button
                  type="button"
                  onClick={() => void handleFocusCocoa()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                >
                  <AppWindow className="w-3.5 h-3.5" />
                  <span>Focus macOS QEMU Window</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onBootVm}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Boot {hostname} (Cocoa Window)</span>
                </button>
              )}

              {status === "stopped" && (
                <button
                  type="button"
                  onClick={() => onSwitchDisplayMode("vnc")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900 text-zinc-300 text-xs"
                >
                  <Monitor className="w-3.5 h-3.5 text-sky-400" />
                  <span>Switch to Embedded VNC</span>
                </button>
              )}
            </div>
          </div>
        ) : rfbState !== "connected" ? (
          <div className="max-w-md text-center p-4 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center mx-auto">
              <Monitor className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-zinc-100">
                {status === "stopped"
                  ? `UEFI Graphical Screen Standby (${hostname})`
                  : rfbState === "connecting"
                  ? `Connecting to ${hostname} UEFI Framebuffer…`
                  : isTauriRuntime()
                  ? "VNC Framebuffer Stream Disconnected"
                  : `UEFI Framebuffer Preview (${hostname})`}
              </h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {status === "stopped"
                  ? "Boot the VM to interact with the EDK2 UEFI boot menu and complete FreeBSD, OpenBSD, NetBSD, or Linux ISO/IMG installations directly inside this tab."
                  : !isTauriRuntime()
                  ? "Run inside Tauri (`npm run tauri dev`) to stream live QEMU ramfb VNC frames."
                  : "Click Reconnect if QEMU is still initializing its UEFI framebuffer."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {status === "stopped" ? (
                <>
                  <button
                    type="button"
                    onClick={onBootVm}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Boot {hostname}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchDisplayMode("cocoa")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900 text-zinc-300 text-xs"
                  >
                    <AppWindow className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Use Native Cocoa Window</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setReconnectTick((t) => t + 1)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reconnect VNC Stream</span>
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
