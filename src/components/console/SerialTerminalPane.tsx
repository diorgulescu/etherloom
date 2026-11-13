import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  ClipboardCopy,
  ClipboardPaste,
  Eraser,
  Play,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";
import {
  getConsoleSessionEndpoints,
  isTauriRuntime,
  sendSerialBreak,
  sendVmCtrlAltDel,
  writeSerialBytes,
} from "../../services/tauriBridge";
import type { GuestFamily, NodeRunStatus } from "../../types/studio";

interface SerialTerminalPaneProps {
  nodeId: string;
  hostname: string;
  guestFamily: GuestFamily | null;
  status: NodeRunStatus;
  visible: boolean;
  onBootVm: () => void;
}

export function serialDeviceNameForFamily(
  family: GuestFamily | null
): string {
  switch (family) {
    case "openbsd":
    case "netbsd":
      return "com0";
    case "freebsd":
      return "ttyu0";
    case "linux":
    default:
      return "ttyAMA0";
  }
}

export function SerialTerminalPane({
  nodeId,
  hostname,
  guestFamily,
  status,
  visible,
  onBootVm,
}: SerialTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const encoderRef = useRef(new TextEncoder());

  const [connState, setConnState] = useState<
    "standby" | "connecting" | "connected" | "disconnected"
  >("standby");
  const [socketPath, setSocketPath] = useState(
    `/tmp/etherloom/${nodeId}_serial.sock`
  );
  const [dims, setDims] = useState<{ cols: number; rows: number }>({
    cols: 80,
    rows: 24,
  });
  const [reconnectTick, setReconnectTick] = useState(0);
  const [actionFlash, setActionFlash] = useState<string | null>(null);

  const flashLabel = useCallback((msg: string) => {
    setActionFlash(msg);
    window.setTimeout(() => {
      setActionFlash((curr) => (curr === msg ? null : curr));
    }, 1800);
  }, []);

  const sendRawInput = useCallback(
    (bytes: Uint8Array) => {
      if (bytes.length === 0) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(bytes);
      } else if (isTauriRuntime()) {
        void writeSerialBytes(nodeId, bytes).catch(() => {});
      } else {
        // Browser preview local echo so developers can test xterm responsiveness
        termRef.current?.write(bytes);
      }
    },
    [nodeId]
  );

  // Initialize xterm.js + FitAddon once per VM tab
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      convertEol: false,
      macOptionIsMeta: true,
      allowProposedApi: true,
      windowOptions: {
        getWinSizeChars: true,
        getWinSizePixels: true,
      },
      fontFamily:
        '"SF Mono", "JetBrains Mono", Menlo, Monaco, "Cascadia Mono", monospace',
      fontSize: 12,
      lineHeight: 1.24,
      theme: {
        background: "#090E18",
        foreground: "#E2E8F0",
        cursor: "#22D3EE",
        cursorAccent: "#090E18",
        selectionBackground: "rgba(34, 211, 238, 0.22)",
        black: "#0D1321",
        red: "#F43F5E",
        green: "#10B981",
        yellow: "#F59E0B",
        blue: "#818CF8",
        magenta: "#C084FC",
        cyan: "#22D3EE",
        white: "#E2E8F0",
        brightBlack: "#475569",
        brightRed: "#FB7185",
        brightGreen: "#34D399",
        brightYellow: "#FBBF24",
        brightBlue: "#A5B4FC",
        brightMagenta: "#D8B4FE",
        brightCyan: "#67E8F9",
        brightWhite: "#F8FAFC",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // macOS Cmd+C / Cmd+V support without breaking Ctrl+C SIGINT in guest TUIs
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.type !== "keydown") return true;
      const isCmd = ev.metaKey && !ev.ctrlKey && !ev.altKey;
      if (isCmd && ev.key.toLowerCase() === "c" && term.hasSelection()) {
        const selected = term.getSelection();
        if (selected) {
          void navigator.clipboard.writeText(selected);
          flashLabel("Copied");
        }
        return false;
      }
      if (isCmd && ev.key.toLowerCase() === "v") {
        // Prevent double paste; read clipboard and stream raw UTF-8 bytes
        ev.preventDefault();
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              sendRawInput(encoderRef.current.encode(text));
              flashLabel("Pasted");
            }
          })
          .catch(() => {});
        return false;
      }
      return true;
    });

    const dataDisp = term.onData((str) => {
      sendRawInput(encoderRef.current.encode(str));
    });

    const binDisp = term.onBinary((bin) => {
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        buf[i] = bin.charCodeAt(i) & 0xff;
      }
      sendRawInput(buf);
    });

    const resizeDisp = term.onResize(({ cols, rows }) => {
      setDims({ cols, rows });
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    const safeFit = () => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      try {
        fitAddon.fit();
      } catch {
        // Ignore transient zero-height layout ticks
      }
    };

    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(safeFit);
    });
    ro.observe(container);
    window.requestAnimationFrame(safeFit);

    if (!isTauriRuntime()) {
      const dev = serialDeviceNameForFamily(guestFamily);
      term.writeln(
        `\x1b[38;5;39mEtherloom Serial Bridge\x1b[0m — ${hostname} (${dev}, 115200 8N1)`
      );
      term.writeln(
        "\x1b[90mLaunch inside Tauri (`npm run tauri dev`) to stream live QEMU PL011 UART sockets.\x1b[0m"
      );
      term.write(`\r\n${hostname}# `);
    }

    return () => {
      ro.disconnect();
      dataDisp.dispose();
      binDisp.dispose();
      resizeDisp.dispose();
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [flashLabel, guestFamily, hostname, nodeId, sendRawInput]);

  // Refit terminal whenever tab visibility changes
  useEffect(() => {
    if (!visible) return;
    const id = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        termRef.current?.focus();
      } catch {
        // Ignore
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [visible]);

  // Connect / reconnect WebSocket to Rust SerialNodeHub when VM is booting/running
  useEffect(() => {
    if (!isTauriRuntime()) {
      setConnState(status === "running" ? "connected" : "standby");
      return;
    }

    if (status === "stopped") {
      wsRef.current?.close();
      wsRef.current = null;
      setConnState("standby");
      return;
    }

    let cancelled = false;
    setConnState("connecting");

    void getConsoleSessionEndpoints(nodeId)
      .then((ep) => {
        if (cancelled) return;
        setSocketPath(ep.serialSocketPath);
        if (!ep.serialWsUrl) {
          setConnState("disconnected");
          return;
        }

        wsRef.current?.close();
        const ws = new WebSocket(ep.serialWsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          if (!cancelled) {
            setConnState("connected");
          }
        };
        ws.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            termRef.current?.write(new Uint8Array(ev.data));
          } else if (typeof ev.data === "string") {
            termRef.current?.write(ev.data);
          }
        };
        ws.onerror = () => {
          if (!cancelled) setConnState("disconnected");
        };
        ws.onclose = () => {
          if (!cancelled) {
            setConnState(status === "running" ? "disconnected" : "standby");
          }
        };
      })
      .catch(() => {
        if (!cancelled) setConnState("disconnected");
      });

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [nodeId, status, reconnectTick]);

  const handleCopySelection = async () => {
    const sel = termRef.current?.getSelection();
    if (!sel) {
      flashLabel("Select text first");
      return;
    }
    await navigator.clipboard.writeText(sel);
    flashLabel("Copied");
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        sendRawInput(encoderRef.current.encode(text));
        termRef.current?.focus();
        flashLabel("Pasted");
      }
    } catch {
      flashLabel("Clipboard blocked");
    }
  };

  const handleSendBreak = async () => {
    await sendSerialBreak(nodeId);
    flashLabel("Sent Serial Break");
    termRef.current?.focus();
  };

  const handleSendCtrlAltDel = async () => {
    try {
      await sendVmCtrlAltDel(nodeId);
      flashLabel("Sent Ctrl+Alt+Del");
    } catch {
      // Also send Ctrl+C / reboot attention if QMP unavailable
      flashLabel("QMP Standby");
    }
    termRef.current?.focus();
  };

  const serialDev = serialDeviceNameForFamily(guestFamily);

  return (
    <div
      className={`h-full w-full flex flex-col bg-[#090E18] rounded-lg border border-[rgba(34,211,238,0.16)] overflow-hidden ${
        visible ? "" : "hidden"
      }`}
    >
      {/* Compact Serial Action Strip */}
      <div className="h-7 px-2.5 bg-[#111827] border-b border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-2 min-w-0 font-mono text-slate-400">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              connState === "connected"
                ? "bg-[#10B981]"
                : connState === "connecting"
                ? "bg-[#F59E0B] animate-pulse"
                : "bg-slate-600"
            }`}
          />
          <span className="text-slate-100 font-medium">{serialDev}</span>
          <span className="hidden sm:inline truncate text-slate-500">
            unix:{socketPath}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#162032] text-[#22D3EE] border border-[rgba(34,211,238,0.18)]">
            {dims.cols}×{dims.rows}
          </span>
          {actionFlash && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-[#22D3EE]">
              {actionFlash}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {status === "stopped" && (
            <button
              type="button"
              onClick={onBootVm}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#10B981] hover:bg-[#34D399] text-slate-950 text-[10px] font-semibold mr-1"
            >
              <Play className="w-2.5 h-2.5 fill-current" />
              <span>Boot VM</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleCopySelection()}
            title="Copy selected terminal text (⌘C)"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#162032] text-slate-300 text-[10px]"
          >
            <ClipboardCopy className="w-3 h-3" />
            <span className="hidden md:inline">Copy</span>
          </button>

          <button
            type="button"
            onClick={() => void handlePasteClipboard()}
            title="Paste clipboard into serial console (⌘V)"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#162032] text-slate-300 text-[10px]"
          >
            <ClipboardPaste className="w-3 h-3" />
            <span className="hidden md:inline">Paste</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSendBreak()}
            disabled={status === "stopped"}
            title="Send UART Serial Break sequence"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-amber-500/20 text-[#F59E0B] disabled:opacity-35 text-[10px]"
          >
            <Zap className="w-3 h-3" />
            <span>Break</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSendCtrlAltDel()}
            disabled={status === "stopped"}
            title="Send hardware Ctrl+Alt+Del via QMP"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-rose-500/20 text-[#F43F5E] disabled:opacity-35 text-[10px]"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>Ctrl+Alt+Del</span>
          </button>

          <button
            type="button"
            onClick={() => termRef.current?.clear()}
            title="Clear scrollback buffer"
            className="p-1 rounded hover:bg-[#162032] text-slate-400 hover:text-slate-200"
          >
            <Eraser className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setReconnectTick((t) => t + 1)}
            title="Reconnect serial socket"
            className="p-1 rounded hover:bg-[#162032] text-slate-400 hover:text-slate-200"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Live xterm.js Canvas */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 w-full p-1.5 overflow-hidden"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
