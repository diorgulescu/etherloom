import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  CheckSquare,
  ChevronRight,
  Copy,
  GraduationCap,
  Lightbulb,
  PanelRightClose,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  Terminal,
} from "lucide-react";
import type { AcademyLabDetail } from "../../types/studio";
import type { EtherloomFlowNode } from "../canvas/EtherloomNode";
import type { EtherloomWireEdgeType } from "../canvas/EtherloomWireEdge";
import { SignalWaveformIcon } from "../brand";

interface LabGuideDrawerProps {
  lab: AcademyLabDetail;
  nodes: EtherloomFlowNode[];
  edges: EtherloomWireEdgeType[];
  activeStepIndex: number;
  resetting: boolean;
  onSelectStep: (index: number) => void;
  onResetLab: () => void;
  onOpenAcademyBrowser: () => void;
  onSendCommandToSerial: (nodeId: string, command: string) => void;
  onToggleWireCapture: (edgeId: string) => void;
  onOpenTcpflowy: () => void;
  onCloseDrawer: () => void;
}

type ParsedBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "hr" }
  | { kind: "diagram"; content: string }
  | {
      kind: "code";
      lang: string;
      nodeId: string | null;
      title: string | null;
      content: string;
      blockId: string;
    }
  | { kind: "details"; summary: string; body: string }
  | { kind: "task"; taskIndex: number; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "paragraph"; text: string };

function parseCodeFenceInfo(info: string): {
  lang: string;
  nodeId: string | null;
  title: string | null;
} {
  const trimmed = info.trim();
  const firstSpace = trimmed.indexOf(" ");
  const lang = (
    firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)
  ).toLowerCase();
  const attrPart = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1);

  const nodeMatch = attrPart.match(/node=([^\s"]+)/);
  const titleMatch = attrPart.match(/title="([^"]+)"/);

  return {
    lang: lang || "text",
    nodeId: nodeMatch ? nodeMatch[1] : null,
    title: titleMatch ? titleMatch[1] : null,
  };
}

function parseGuideMarkdown(md: string): {
  blocks: ParsedBlock[];
  totalTasks: number;
} {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;
  let taskCounter = 0;
  let codeCounter = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code or diagram block
    if (trimmed.startsWith("```")) {
      const info = trimmed.slice(3);
      const { lang, nodeId, title } = parseCodeFenceInfo(info);
      i += 1;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing ```
      if (lang === "diagram") {
        blocks.push({ kind: "diagram", content: buf.join("\n") });
      } else {
        codeCounter += 1;
        blocks.push({
          kind: "code",
          lang,
          nodeId,
          title,
          content: buf.join("\n"),
          blockId: `code-${codeCounter}`,
        });
      }
      continue;
    }

    // Expandable <details><summary>...</summary>...</details>
    if (trimmed.startsWith("<details")) {
      i += 1;
      let summary = "Hint / Why does this happen?";
      const bodyLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("</details>")) {
        const l = lines[i].trim();
        const sumMatch = l.match(/^<summary>(.*)<\/summary>$/i);
        if (sumMatch) {
          summary = sumMatch[1].trim();
        } else if (l) {
          bodyLines.push(lines[i]);
        }
        i += 1;
      }
      if (i < lines.length) i += 1; // consume </details>
      blocks.push({
        kind: "details",
        summary,
        body: bodyLines.join("\n").trim(),
      });
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      blocks.push({ kind: "heading", level: 3, text: trimmed.slice(4).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ kind: "heading", level: 2, text: trimmed.slice(3).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ kind: "heading", level: 1, text: trimmed.slice(2).trim() });
      i += 1;
      continue;
    }

    // Interactive Task Checkbox: `- [ ] ...` or `- [x] ...`
    const taskMatch = trimmed.match(/^-\s*\[[ xX]\]\s+(.*)$/);
    if (taskMatch) {
      blocks.push({
        kind: "task",
        taskIndex: taskCounter,
        text: taskMatch[1],
      });
      taskCounter += 1;
      i += 1;
      continue;
    }

    // Unordered list
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const items: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith("- ") || lines[i].trim().startsWith("* ")) &&
        !/^-\s*\[[ xX]\]/.test(lines[i].trim())
      ) {
        items.push(lines[i].trim().slice(2).trim());
        i += 1;
      }
      blocks.push({ kind: "bullet", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ordered", items });
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("<details") &&
      !/^---+$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("- ") &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return { blocks, totalTasks: taskCounter };
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length >= 2) {
      return (
        <code
          key={idx}
          className="font-mono text-[11px] px-1 py-0.5 rounded bg-slate-200/75 dark:bg-[#090E18] dark:border dark:border-[rgba(34,211,238,0.16)] text-indigo-700 dark:text-[#22D3EE]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length >= 4) {
      return (
        <strong
          key={idx}
          className="font-semibold text-slate-900 dark:text-slate-100"
        >
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length >= 2) {
      return <em key={idx}>{tok.slice(1, -1)}</em>;
    }
    return <span key={idx}>{tok}</span>;
  });
}

export function LabGuideDrawer({
  lab,
  nodes,
  edges,
  activeStepIndex,
  resetting,
  onSelectStep,
  onResetLab,
  onOpenAcademyBrowser,
  onSendCommandToSerial,
  onToggleWireCapture,
  onOpenTcpflowy,
  onCloseDrawer,
}: LabGuideDrawerProps) {
  const storageKey = `etherloom:lab-tasks:${lab.summary.id}`;
  const [checkedTasks, setCheckedTasks] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setCheckedTasks(raw ? (JSON.parse(raw) as Record<number, boolean>) : {});
    } catch {
      setCheckedTasks({});
    }
  }, [storageKey]);

  const toggleTask = useCallback(
    (taskIndex: number) => {
      setCheckedTasks((prev) => {
        const next = { ...prev, [taskIndex]: !prev[taskIndex] };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore storage quota errors
        }
        return next;
      });
    },
    [storageKey]
  );

  const handleResetAll = () => {
    setCheckedTasks({});
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    onResetLab();
  };

  const { blocks, totalTasks } = useMemo(
    () => parseGuideMarkdown(lab.guideMarkdown),
    [lab.guideMarkdown]
  );

  const completedCount = useMemo(
    () => Object.values(checkedTasks).filter(Boolean).length,
    [checkedTasks]
  );

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  const edgeMap = useMemo(
    () => new Map(edges.map((e) => [e.id, e])),
    [edges]
  );

  const activeStep = lab.steps[activeStepIndex] ?? null;

  const handleCopy = (id: string, content: string) => {
    void navigator.clipboard?.writeText(content);
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((curr) => (curr === id ? null : curr));
    }, 1500);
  };

  const handleSendSerial = (id: string, nodeId: string, content: string) => {
    onSendCommandToSerial(nodeId, content);
    setSentId(id);
    window.setTimeout(() => {
      setSentId((curr) => (curr === id ? null : curr));
    }, 1500);
  };

  const progressPct =
    totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  return (
    <aside className="w-[430px] xl:w-[465px] shrink-0 border-l border-slate-200/90 dark:border-[rgba(34,211,238,0.14)] bg-white dark:bg-[#111827] flex flex-col min-h-0 z-10">
      {/* Drawer Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-gradient-to-r from-indigo-500/[0.08] via-cyan-500/[0.04] to-transparent space-y-2 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-[#6366F1] dark:text-[#818CF8] shrink-0" />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-600 dark:text-[#22D3EE]">
                Lab {String(lab.summary.number).padStart(2, "0")} •{" "}
                {lab.summary.difficulty}
              </span>
            </div>
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug mt-0.5">
              {lab.summary.title}
            </h2>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenAcademyBrowser}
              title="Browse all Academy Guided Labs"
              className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200/80 dark:bg-[#162032] dark:hover:bg-[#1E2B42] dark:border dark:border-[rgba(34,211,238,0.16)] text-slate-700 dark:text-slate-200"
            >
              All Labs
            </button>
            <button
              type="button"
              disabled={resetting}
              onClick={handleResetAll}
              title="Wipe overlays & captures and restore clean lab blueprint"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 text-amber-800 dark:text-amber-200 border border-[#F59E0B]/30 disabled:opacity-50"
            >
              <RotateCcw
                className={`w-3 h-3 ${resetting ? "animate-spin" : ""}`}
              />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={onCloseDrawer}
              title="Collapse Lab Guide Drawer"
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-[#1E2B42]"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Task Progress Bar */}
        {totalTasks > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-slate-500 dark:text-slate-400">
                Lab Checkpoints
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-[#34D399]">
                {completedCount}/{totalTasks} ({progressPct}%)
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-[#090E18] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#22D3EE] via-[#6366F1] to-[#10B981] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Interactive Step Selector & Canvas Wire Highlight Controls */}
      {lab.steps.length > 0 && (
        <div className="px-3.5 py-2 border-b border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] bg-slate-50/80 dark:bg-[#0D1321]/85 space-y-2 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {lab.steps.map((step, idx) => {
              const active = idx === activeStepIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onSelectStep(idx)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap border transition-colors ${
                    active
                      ? "bg-[#6366F1] border-[#818CF8] text-white shadow-2xs"
                      : "bg-white dark:bg-[#162032] border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-600 dark:text-slate-400 hover:border-[#22D3EE]/45"
                  }`}
                >
                  Step {idx + 1}
                </button>
              );
            })}
          </div>

          {activeStep && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#22D3EE] shrink-0" />
                <span className="truncate">{activeStep.title}</span>
              </div>

              {activeStep.highlightLinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeStep.highlightLinks.map((linkId) => {
                    const edge = edgeMap.get(linkId);
                    if (!edge) return null;
                    const recording = Boolean(edge.data?.capturingPcap);
                    return (
                      <button
                        key={linkId}
                        type="button"
                        onClick={() => onToggleWireCapture(linkId)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-mono font-medium border transition-colors ${
                          recording
                            ? "bg-[#F43F5E] border-rose-400 text-white"
                            : "bg-[#6366F1]/12 hover:bg-[#6366F1]/22 border-[#6366F1]/35 text-indigo-700 dark:text-[#818CF8]"
                        }`}
                      >
                        <Radio
                          className={`w-2.5 h-2.5 ${
                            recording ? "animate-pulse" : ""
                          }`}
                        />
                        <span>
                          {recording ? `Stop ${linkId}` : `Tap ${linkId}`}
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={onOpenTcpflowy}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-[#22D3EE]/12 hover:bg-[#22D3EE]/22 border border-[#22D3EE]/35 text-cyan-700 dark:text-[#22D3EE]"
                  >
                    <SignalWaveformIcon className="w-3 h-2.5" />
                    <span>Open tcpflowy</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrollable Rich Markdown Lesson Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
        {blocks.map((block, idx) => {
          switch (block.kind) {
            case "heading":
              if (block.level === 1) {
                return (
                  <h3
                    key={idx}
                    className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 pt-1"
                  >
                    <BookOpen className="w-4 h-4 text-[#22D3EE] shrink-0" />
                    <span>{renderInlineMarkdown(block.text)}</span>
                  </h3>
                );
              }
              if (block.level === 2) {
                return (
                  <h4
                    key={idx}
                    className="text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-[#818CF8] pt-2 border-t border-slate-200/70 dark:border-[rgba(34,211,238,0.14)]"
                  >
                    {renderInlineMarkdown(block.text)}
                  </h4>
                );
              }
              return (
                <h5
                  key={idx}
                  className="text-xs font-semibold text-slate-900 dark:text-slate-100 pt-1"
                >
                  {renderInlineMarkdown(block.text)}
                </h5>
              );

            case "hr":
              return (
                <hr
                  key={idx}
                  className="border-slate-200/80 dark:border-[rgba(34,211,238,0.14)] my-1"
                />
              );

            case "diagram":
              return (
                <div
                  key={idx}
                  className="rounded-xl bg-[#090E18] border border-[rgba(34,211,238,0.18)] p-3 overflow-x-auto shadow-inner"
                >
                  <pre className="font-mono text-[10px] leading-[1.35] text-[#22D3EE]">
                    {block.content}
                  </pre>
                </div>
              );

            case "code": {
              const targetNode = block.nodeId
                ? nodeMap.get(block.nodeId) ?? null
                : null;
              const hostLabel =
                targetNode?.data.label ??
                block.nodeId?.replace(/^node-/, "") ??
                null;
              const isCopied = copiedId === block.blockId;
              const isSent = sentId === block.blockId;

              return (
                <div
                  key={idx}
                  className="rounded-xl overflow-hidden border border-slate-300/90 dark:border-[rgba(34,211,238,0.20)] bg-[#090E18] shadow-xs"
                >
                  <div className="px-2.5 py-1.5 bg-[#111827] border-b border-[rgba(34,211,238,0.14)] flex items-center justify-between gap-2">
                    <span className="text-[10.5px] font-mono text-slate-300 truncate">
                      {block.title ?? block.lang}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(block.blockId, block.content)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[#162032] hover:bg-[#1E2B42] border border-[rgba(34,211,238,0.16)] text-slate-200 transition-colors"
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-[#34D399]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{isCopied ? "Copied" : "Copy"}</span>
                      </button>

                      {block.nodeId && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSendSerial(
                              block.blockId,
                              block.nodeId!,
                              block.content
                            )
                          }
                          title={`Write commands directly to ${hostLabel}'s guest serial console`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#10B981] hover:bg-emerald-400 text-[#090E18] transition-colors"
                        >
                          {isSent ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Terminal className="w-3 h-3" />
                          )}
                          <span>
                            {isSent
                              ? `Sent → ${hostLabel}`
                              : `Send to ${hostLabel} Serial`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  <pre className="p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-100 overflow-x-auto">
                    {block.content}
                  </pre>
                </div>
              );
            }

            case "details":
              return (
                <details
                  key={idx}
                  className="group rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.07] dark:bg-[#F59E0B]/[0.08] px-3 py-2"
                >
                  <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-900 dark:text-amber-200 select-none">
                    <ChevronRight className="w-3.5 h-3.5 text-[#F59E0B] transition-transform group-open:rotate-90 shrink-0" />
                    <Lightbulb className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                    <span>{block.summary}</span>
                  </summary>
                  <div className="mt-2 pl-5 text-[11.5px] text-amber-950/90 dark:text-amber-100/90 space-y-1.5 leading-relaxed">
                    {block.body.split("\n\n").map((p, pIdx) => (
                      <p key={pIdx}>{renderInlineMarkdown(p)}</p>
                    ))}
                  </div>
                </details>
              );

            case "task": {
              const checked = Boolean(checkedTasks[block.taskIndex]);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleTask(block.taskIndex)}
                  className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl border transition-all ${
                    checked
                      ? "bg-[#10B981]/10 border-[#10B981]/35 text-emerald-900 dark:text-[#34D399]"
                      : "bg-slate-50 hover:bg-slate-100/90 dark:bg-[#162032] dark:hover:bg-[#1E2B42] border-slate-200 dark:border-[rgba(34,211,238,0.16)] text-slate-800 dark:text-slate-200"
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  )}
                  <span
                    className={`text-xs font-medium ${
                      checked ? "line-through opacity-80" : ""
                    }`}
                  >
                    {renderInlineMarkdown(block.text)}
                  </span>
                </button>
              );
            }

            case "bullet":
              return (
                <ul key={idx} className="list-disc pl-5 space-y-1">
                  {block.items.map((it, itIdx) => (
                    <li key={itIdx}>{renderInlineMarkdown(it)}</li>
                  ))}
                </ul>
              );

            case "ordered":
              return (
                <ol key={idx} className="list-decimal pl-5 space-y-1.5">
                  {block.items.map((it, itIdx) => (
                    <li key={itIdx}>{renderInlineMarkdown(it)}</li>
                  ))}
                </ol>
              );

            case "paragraph":
            default:
              return <p key={idx}>{renderInlineMarkdown(block.text)}</p>;
          }
        })}
      </div>
    </aside>
  );
}
