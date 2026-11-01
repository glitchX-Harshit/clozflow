"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Terminal,
  Globe,
  ExternalLink,
  Brain,
  FileText,
  FileDiff as FileDiffIcon,
  FilePen,
  FilePlus2,
  FolderSearch,
  ListChecks,
  Copy,
  CheckCheck,
  Bot,
  Plug,
  Wrench,
  PenLine,
} from "lucide-react";

/* ═══════════════ Rust constants (transcript.rs:92-166) ═══════════════ */
const TOOL_LABEL_LINE_HEIGHT = 18;
const TOOL_GROUP_HEADER_HEIGHT = 26;
const TOOL_TREE_ROW_HEIGHT = 32;
const CHIPS_TOP_PAD = 2;
const ACTIVITY_TRUNK_X = 12.5;
const ACTIVITY_BEND_RADIUS = 6;
const ACTIVITY_BRANCH_END_X = 28;
const ACTIVITY_ICON_LEFT = 32;
const ACTIVITY_ICON_SIZE = 16;
const ACTIVITY_GUTTER_WIDTH = 48;
const ACTIVITY_TEXT_GAP = 8;
const OUTPUT_LINE_HEIGHT = 18;
const OUTPUT_DETAIL_MAX_LINES = 24;
const DIFF_DETAIL_MAX_LINES = 600;
const TOOL_FOLD_MS = 140;
const ROW_STAGGER_MS = 65;
const FIRST_ROW_DELAY_MS = 90;
const SHIMMER_DURATION_MS = 3400;
const FOLD_CLS = "duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)]";

/* ═══════════════ view.rs ports ═══════════════ */
function singleLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

/** proto/src/agent.rs:300 ToolCall (decoded shape) */
function nodeToCall(node: TraceNode): any {
  if (node.type === "reasoning") return { kind: "thought", name: "Thought process" };
  if (node.command || node.type === "terminal" || node.type === "command")
    return { kind: "exec", command: node.command ?? node.primary ?? "" };
  if (node.diffRows)
    return {
      kind: "patch",
      path: node.diffFile ?? (typeof node.secondary === "string" ? node.secondary : undefined),
    };
  const a = (typeof node.args === "object" && node.args ? node.args : {}) as any;
  const path = a.path ?? a.file ?? (typeof node.secondary === "string" ? node.secondary : undefined);
  const kindMap: Record<string, string> = {
    exec: "exec",
    execute_command: "exec",
    run: "exec",
    read: "read",
    read_file: "read",
    write: "write",
    write_file: "write",
    edit: "edit",
    edit_file: "edit",
    patch: "patch",
    apply_patch: "patch",
    search: "search",
    search_web: "search",
    glob: "glob",
    fetch: "fetch",
    webfetch: "fetch",
    web: "web",
    websearch: "web",
    todo: "todo",
    mcp: "mcp",
    agent: "agent",
    task: "agent",
  };
  const kind = node.toolName ? kindMap[node.toolName] ?? "tool" : "tool";
  return { kind, name: node.toolName ?? node.primary ?? node.type, path, ...a };
}

/** view.rs:493 tool_chip_content — label + one-line detail */
function toolChipContent(call: any): [string, string] {
  if (!call) return ["Tool", ""];
  switch (call.kind) {
    case "exec":
      return ["Run", singleLine(call.command ?? "")];
    case "read":
      return ["Read", singleLine(call.path ?? "")];
    case "write":
      return ["Write", singleLine(call.path ?? "")];
    case "edit":
      return ["Edit", singleLine(call.path ?? "")];
    case "patch":
      return ["Patch", singleLine(call.path ?? "workspace")];
    case "search":
      return ["Search", singleLine(call.path ? `${call.pattern ?? ""} in ${call.path}` : call.pattern ?? "")];
    case "glob":
      return ["Glob", singleLine(call.pattern ?? call.path ?? "")];
    case "fetch":
      return ["Fetch", singleLine(call.url ?? call.path ?? "")];
    case "web":
      return ["Web", singleLine(call.query ?? "")];
    case "mcp":
      return ["MCP", singleLine(call.label ?? call.name ?? "")];
    case "agent":
      return ["Agent", singleLine(call.detail ?? call.description ?? "")];
    case "thought":
      return ["Thought process", ""];
    default: {
      const name = call.name ?? "Tool";
      if (name === "Agent" || name.startsWith("Agent: "))
        return ["Agent", singleLine(name.replace(/^Agent:\s*/, ""))];
      if (name === "Thought process") return ["Thought process", ""];
      return ["Tool", singleLine(name)];
    }
  }
}

/** view.rs:539 tool_group_summary */
function toolGroupSummary(tools: { call: any; is_error: boolean }[]): string {
  let commands = 0,
    reads = 0,
    searches = 0,
    fetches = 0,
    failed = 0;
  const edited: string[] = [];
  for (const { call, is_error } of tools) {
    if (is_error) failed++;
    switch (call?.kind) {
      case "exec":
        commands++;
        break;
      case "write":
      case "edit":
        if (call.path && !edited.includes(call.path)) edited.push(call.path);
        break;
      case "patch": {
        const p = call.path ?? "patch";
        if (!edited.includes(p)) edited.push(p);
        break;
      }
      case "read":
        reads++;
        break;
      case "search":
      case "glob":
      case "web":
        searches++;
        break;
      case "fetch":
        fetches++;
        break;
    }
  }
  const segments: string[] = [];
  if (commands > 0) segments.push(`ran ${plural(commands, "command", "commands")}`);
  if (edited.length > 0) segments.push(`edited ${plural(edited.length, "file", "files")}`);
  if (reads > 0) segments.push(`read ${plural(reads, "file", "files")}`);
  if (searches > 0) segments.push(`searched ${plural(searches, "time", "times")}`);
  if (fetches > 0) segments.push(`fetched ${plural(fetches, "page", "pages")}`);
  if (failed > 0) segments.push(`${failed} failed`);
  return segments.join(" · ");
}

/** transcript.rs:9031 tool_icon_path → rail-tip glyphs (all muted). */
function railIcon(call: any, label: string) {
  const cls = "size-4 shrink-0 text-muted-foreground";
  if (label === "Thought process") return <Brain className={cls} aria-hidden="true" />;
  switch (call?.kind) {
    case "exec":
      return <Terminal className={cls} aria-hidden="true" />;
    case "read":
      return <FileText className={cls} aria-hidden="true" />;
    case "patch":
      return <FileDiffIcon className={cls} aria-hidden="true" />;
    case "write":
      return <FilePlus2 className={cls} aria-hidden="true" />;
    case "edit":
      return <FilePen className={cls} aria-hidden="true" />;
    case "search":
      return <Search className={cls} aria-hidden="true" />;
    case "glob":
      return <FolderSearch className={cls} aria-hidden="true" />;
    case "fetch":
    case "web":
      return <Globe className={cls} aria-hidden="true" />;
    case "todo":
      return <ListChecks className={cls} aria-hidden="true" />;
    case "mcp":
      return <Plug className={cls} aria-hidden="true" />;
    case "agent":
      return <Bot className={cls} aria-hidden="true" />;
    default:
      return <Wrench className={cls} aria-hidden="true" />;
  }
}

/** transcript.rs:9702 activity_rail — trunk + elbow + branch, icon at tip.
 *  ONE SVG owns the whole ribbon (Rust unions the contours into a single
 *  paint for the same reason): mixing CSS hairline divs with SVG strokes
 *  puts adjacent segments on different pixel grids (div box at 12.5 paints
 *  12.5–13.5, a stroke centered on 12.5 paints 12.0–13.0) and every junction
 *  shows a half-pixel step. All segments here share one coordinate space. */
function ActivityRail({
  hasPredecessor,
  continues,
  failed,
}: {
  hasPredecessor: boolean;
  continues: boolean;
  failed: boolean;
}) {
  const stroke = failed
    ? "stroke-rose-300 dark:stroke-rose-800"
    : "stroke-neutral-300 dark:stroke-neutral-700";
  const branchY = TOOL_TREE_ROW_HEIGHT / 2; // 16
  const bendY = branchY - ACTIVITY_BEND_RADIUS; // 10
  return (
    <svg
      aria-hidden="true"
      width={ACTIVITY_BRANCH_END_X}
      height={TOOL_TREE_ROW_HEIGHT}
      className="pointer-events-none absolute inset-y-0 left-0 h-full flex-none overflow-visible"
    >
      <line
        x1={ACTIVITY_TRUNK_X}
        y1={hasPredecessor ? 0 : -10}
        x2={ACTIVITY_TRUNK_X}
        y2={bendY}
        strokeWidth={1}
        className={stroke}
      />
      <path
        d={`M${ACTIVITY_TRUNK_X} ${bendY} Q${ACTIVITY_TRUNK_X} ${branchY} ${ACTIVITY_TRUNK_X + ACTIVITY_BEND_RADIUS} ${branchY} H${ACTIVITY_BRANCH_END_X}`}
        fill="none"
        strokeWidth={1}
        className={stroke}
      />
      {continues && (
        <line
          x1={ACTIVITY_TRUNK_X}
          y1={bendY}
          x2={ACTIVITY_TRUNK_X}
          y2="100%"
          strokeWidth={1}
          className={stroke}
        />
      )}
    </svg>
  );
}

/** transcript.rs:428 thought inline markdown → styled runs (record, not surface).
 *  Small variant — thinking is a trace, not the reply. */
function thoughtInline(text: string): React.ReactNode {
  return renderInline(text, true);
}

/* ═══════════════ Types (public API) ═══════════════ */
export type TraceNodeType = "reasoning" | "step" | "search" | "tool" | "terminal" | "diffs" | (string & {});
export type DetailLine = { text: string; tone?: "add" | "del" | "ctx" | "muted" | "error" };
export interface ToolDefinition<TArgs = any, TResult = any> {
  name: string;
  label?: string | ((args: TArgs) => string);
  icon?: any;
  iconClassName?: string;
  formatChip?: (args: TArgs, result?: TResult) => string;
  monoChip?: boolean;
  renderCustomContent?: (props: {
    args?: TArgs;
    result?: TResult;
    node: TraceNode<TArgs, TResult>;
  }) => React.ReactNode;
}
export type TraceNode<TArgs = any, TResult = any> = {
  id?: string;
  type: TraceNodeType;
  toolName?: string;
  sentences?: string[];
  durationSeconds?: number;
  primary?: string;
  secondary?: string;
  mono?: boolean;
  icon?: any;
  iconClassName?: string;
  status?: "pending" | "running" | "completed" | "failed";
  args?: TArgs;
  result?: TResult;
  command?: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  add?: number;
  del?: number;
  diffRows?: DiffRow[];
  diffFile?: string;
  codeSnippet?: string;
  /** Code the agent READ — rendered as a syntax-highlighted excerpt block
   *  (line numbers start at `lineStart`, 600px scroll cap). */
  code?: string;
  lineStart?: number;
  lineEnd?: number;
  lang?: string;
  details?: DetailLine[];
  sources?: { name: string; url?: string }[];
  renderContent?: () => React.ReactNode;
};
export type AgentPhase = { trace: TraceNode[]; message?: string };
export type DiffRow = {
  old?: number | null;
  cur?: number | null;
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
};

export const DEFAULT_TOOL_REGISTRY: Record<string, ToolDefinition> = {
  exec: { name: "exec", label: "Run", icon: Terminal },
  execute_command: { name: "execute_command", label: "Run", icon: Terminal },
  read: { name: "read", label: "Read", icon: FileText },
  read_file: { name: "read_file", label: "Read", icon: FileText },
  write: { name: "write", label: "Write", icon: FilePlus2 },
  write_file: { name: "write_file", label: "Write", icon: FilePlus2 },
  edit: { name: "edit", label: "Edit", icon: FilePen },
  edit_file: { name: "edit_file", label: "Edit", icon: FilePen },
  patch: { name: "patch", label: "Patch", icon: FileDiffIcon },
  search: { name: "search", label: "Search", icon: Search },
  search_web: { name: "search_web", label: "Search", icon: Search },
  glob: { name: "glob", label: "Glob", icon: FolderSearch },
  fetch: { name: "fetch", label: "Fetch", icon: Globe },
  web: { name: "web", label: "Web", icon: Globe },
  todo: { name: "todo", label: "Todo", icon: ListChecks },
  mcp: { name: "mcp", label: "MCP", icon: Plug },
  agent: { name: "agent", label: "Agent", icon: Bot },
  task: { name: "task", label: "Agent", icon: Bot },
};

/* ═══════════════ detail bodies (transcript.rs:9063 detail_body) ═══════════════ */
function MoreLinesRow({ count }: { count: number }) {
  return (
    <div className="flex items-center text-[12px] text-muted-foreground" style={{ height: OUTPUT_LINE_HEIGHT }}>
      … {count} more lines
    </div>
  );
}

/** transcript.rs:9148 ToolDetail::Output — verbatim mono lines, faint */
function OutputDetail({ lines: raw }: { lines: string[] }) {
  const lines = [...raw];
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const truncatedBy = Math.max(0, lines.length - OUTPUT_DETAIL_MAX_LINES);
  const shown = lines.slice(0, OUTPUT_DETAIL_MAX_LINES);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col overflow-x-auto py-[6px] font-mono text-[12px] text-muted-foreground select-text">
      {shown.map((line, i) => (
        <div
          key={i}
          className="whitespace-pre"
          style={{ height: OUTPUT_LINE_HEIGHT, lineHeight: `${OUTPUT_LINE_HEIGHT}px` }}
        >
          {line || " "}
        </div>
      ))}
      {truncatedBy > 0 && <MoreLinesRow count={truncatedBy} />}
    </div>
  );
}

/** transcript.rs:884 call_block — the full invocation (what was asked) */
function callBlockLines(node: TraceNode, call: any): string[] {
  const args = (typeof node.args === "object" && node.args ? node.args : {}) as any;
  let text: string;
  switch (call?.kind) {
    case "exec":
      text = call.command ?? "";
      break;
    case "read":
      text = call.path ?? "";
      break;
    case "write":
      text = args.content ? `${call.path}\n${args.content}` : call.path ?? "";
      break;
    case "edit":
      text = call.path ?? "";
      break;
    case "patch":
      text = call.path ?? "workspace";
      break;
    case "search":
      text = call.path ? `${call.pattern ?? ""} in ${call.path}` : call.pattern ?? "";
      break;
    case "glob":
      text = call.pattern ?? "";
      break;
    case "fetch":
      text = args.prompt ? `${call.url ?? ""}\n${args.prompt}` : call.url ?? "";
      break;
    case "web":
      text = call.query ?? "";
      break;
    case "mcp":
    case "tool":
      text = node.toolName ? `${JSON.stringify(args, null, 2)}` : "";
      break;
    default:
      text = node.secondary ?? "";
  }
  return text.split("\n").filter((l) => l.length);
}

/* ═══════════════ exports kept for API compat ═══════════════ */
export function PixelDotsLoader({ className }: { className?: string }) {
  const delays = Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3),
      c = i % 3;
    return (c + Math.abs(r - 1)) * 90;
  });
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 grid-cols-[repeat(3,3px)] items-center gap-[1.5px]", className)}
    >
      {delays.map((delay, i) => (
        <span
          key={i}
          className="size-[3px] rounded-full bg-foreground/80 motion-reduce:animate-none"
          style={{ opacity: 0.2, animation: `agent-pixel-on 650ms cubic-bezier(0.23,1,0.32,1) ${delay}ms infinite` }}
        />
      ))}
    </span>
  );
}

/* ═══════════════ Syntax highlighting (read excerpts) ═══════════════ */
const TOKEN_RE =
  /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|for|of|in|while|do|break|continue|new|class|extends|implements|interface|type|enum|import|export|from|as|default|async|await|try|catch|finally|throw|switch|case|typeof|instanceof|void|delete|public|private|protected|readonly|static|get|set|super|this|null|undefined|true|false|fn|struct|impl|pub|use|mut|match|def|self|None|Some|Ok|Err)\b|(\b\d+(?:\.\d+)?\b)|(\b[A-Z][A-Za-z0-9_]*\b)|([a-zA-Z_$][\w$]*(?=\s*\())/gm;

const TOKEN_CLS: Record<number, string> = {
  1: "italic text-muted-foreground/50", // comment
  2: "text-emerald-600 dark:text-emerald-400", // string
  3: "text-violet-600 dark:text-violet-400", // keyword
  4: "text-amber-600 dark:text-amber-400", // number
  5: "text-sky-600 dark:text-sky-300", // type
  6: "text-blue-600 dark:text-blue-400", // function call
};

/** Tiny single-pass tokenizer — strings/comments/keywords/numbers/types/calls.
 *  Not a parser: good enough for read excerpts, zero dependencies. */
export function highlightCode(code: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const group = m.slice(1).findIndex((g) => g !== undefined) + 1;
    out.push(
      <span key={key++} className={TOKEN_CLS[group]}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) TOKEN_RE.lastIndex++;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/** transcript.rs read-chip upgrade: the excerpt the agent actually read.
 *  Line numbers restart at `lineStart` (the real range), the body scrolls
 *  past a 300px cap. */
export function CodeBlock({ code, lineStart = 1, lang, className }: {
  code: string;
  lineStart?: number;
  lang?: string;
  className?: string;
}) {
  void lang; // tokenizer is language-agnostic
  const lines = code.replace(/\n+$/, "").split("\n");
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/70 bg-card font-mono text-[12px] select-text", className)}>
      <div className="max-h-[300px] overflow-auto py-1" style={{ lineHeight: `${OUTPUT_LINE_HEIGHT}px` }}>
        {lines.map((line, i) => (
          <div key={i} className="flex items-start hover:bg-muted/40">
            <span className="w-11 shrink-0 select-none pr-2.5 text-right text-[10.5px] tabular-nums text-muted-foreground/50">
              {lineStart + i}
            </span>
            <pre className="min-w-0 flex-1 whitespace-pre pr-3 text-foreground/90">{highlightCode(line)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TerminalCommand({
  command,
  output,
  exitCode = 0,
  durationMs,
  isRunning = false,
  className,
}: {
  command: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  isRunning?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const lines = (output ?? "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const truncatedBy = Math.max(0, lines.length - OUTPUT_DETAIL_MAX_LINES);
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card font-mono text-[12px] select-text",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-2.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-foreground/90">{command}</span>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-2 text-[11px]">
          {durationMs !== undefined && (
            <span className="tabular-nums text-muted-foreground">{durationMs}ms</span>
          )}
          {isRunning ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
              running
            </span>
          ) : exitCode === 0 ? (
            <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
              exit 0
            </span>
          ) : (
            <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 font-medium tabular-nums text-rose-600 dark:text-rose-400">
              exit {exitCode}
            </span>
          )}
          <button
            type="button"
            aria-label="Copy command"
            onClick={() => {
              navigator.clipboard.writeText(output ? `$ ${command}\n\n${output}` : `$ ${command}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
          >
            {copied ? <CheckCheck className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </button>
        </div>
      </div>
      {lines.length > 0 && (
        <div className="overflow-x-auto px-2.5 py-[6px] text-[12px] text-muted-foreground">
          <pre className="font-mono whitespace-pre">
            {lines.slice(0, OUTPUT_DETAIL_MAX_LINES).map((l, i) => (
              <div key={i} style={{ height: OUTPUT_LINE_HEIGHT, lineHeight: `${OUTPUT_LINE_HEIGHT}px` }}>
                {l || " "}
              </div>
            ))}
            {truncatedBy > 0 && <MoreLinesRow count={truncatedBy} />}
          </pre>
        </div>
      )}
    </div>
  );
}

export function FileDiff({ file, rows = [], className }: { file: string; rows: DiffRow[]; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const added = rows.filter((r) => r.type === "add").length;
  const removed = rows.filter((r) => r.type === "del").length;
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card font-mono text-[11.5px] select-text",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-2.5 py-1 text-[12px]">
        <span className="truncate text-foreground/90">{file}</span>
        <div className="ml-2 flex shrink-0 items-center gap-2">
          <span className="flex gap-1.5 font-semibold tabular-nums">
            {added > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>}
            {removed > 0 && <span className="text-rose-600 dark:text-rose-400">−{removed}</span>}
          </span>
          <button
            type="button"
            aria-label="Copy diff"
            onClick={() => {
              navigator.clipboard.writeText(
                rows.map((r) => `${r.type === "add" ? "+" : r.type === "del" ? "-" : " "} ${r.text}`).join("\n")
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
          >
            {copied ? <CheckCheck className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </button>
        </div>
      </div>
      <div className="relative flex flex-col overflow-x-auto py-1" style={{ lineHeight: `${OUTPUT_LINE_HEIGHT}px` }}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-[70px] top-0 z-[1] w-px bg-border/60"
        />
        {rows.slice(0, DIFF_DETAIL_MAX_LINES).map((r, i) =>
          r.type === "hunk" ? (
            <div key={i} className="px-3 text-[11px] text-muted-foreground/70">
              {r.text}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "relative grid grid-cols-[34px_34px_20px_1fr] items-stretch",
                r.type === "add" && "bg-emerald-500/10 dark:bg-emerald-500/15",
                r.type === "del" && "bg-rose-500/10 dark:bg-rose-500/15"
              )}
            >
              {r.type === "add" && (
                <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-[3px] bg-emerald-500" />
              )}
              {r.type === "del" && (
                <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-[3px] bg-rose-500" />
              )}
              <span
                className={cn(
                  "pr-2 text-right text-[10.5px] tabular-nums select-none",
                  r.type === "del" ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground/60"
                )}
              >
                {r.old ?? ""}
              </span>
              <span
                className={cn(
                  "pr-2 text-right text-[10.5px] tabular-nums select-none",
                  r.type === "add" ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/60"
                )}
              >
                {r.cur ?? ""}
              </span>
              <span
                className={cn(
                  "text-center text-[11px] font-bold select-none",
                  r.type === "add" && "text-emerald-600 dark:text-emerald-400",
                  r.type === "del" && "text-rose-600 dark:text-rose-400"
                )}
              >
                {r.type === "add" ? "+" : r.type === "del" ? "−" : ""}
              </span>
              <code
                className={cn(
                  "pr-3 pl-1 whitespace-pre",
                  r.type === "ctx" ? "text-muted-foreground" : "text-foreground/90"
                )}
              >
                {r.text}
              </code>
            </div>
          )
        )}
        {rows.length > DIFF_DETAIL_MAX_LINES && (
          <div className="px-3 text-muted-foreground">… {rows.length - DIFF_DETAIL_MAX_LINES} more lines</div>
        )}
      </div>
    </div>
  );
}

export function StreamingText({
  text,
  speed = 18,
  chunkSize = 2,
  className,
  onComplete,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  text: string;
  speed?: number;
  chunkSize?: number;
  onComplete?: () => void;
}) {
  const [shown, setShown] = React.useState("");
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;
  React.useEffect(() => {
    let i = 0;
    setShown(text.slice(0, chunkSize));
    const id = setInterval(() => {
      i += chunkSize;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        onCompleteRef.current?.();
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, chunkSize]);
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "font-sans text-[14px] leading-[22px] text-foreground/90 select-text text-pretty",
        className
      )}
      {...props}
    >
      <Markdown text={shown} />
    </div>
  );
}

/* ═══════════════ Markdown (crates/ui/src/markdown/render.rs port) ═══════════════ */
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, small = false): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, code, bold, italic, strike, link] = m;
    if (code)
      out.push(
        <code
          key={key++}
          className={cn(
            "rounded-sm bg-muted px-1 py-px font-mono",
            small ? "text-[11px]" : "text-[12.5px]",
            small ? "text-muted-foreground" : "text-foreground/90"
          )}
        >
          {code.slice(1, -1)}
        </code>
      );
    else if (bold)
      out.push(
        <strong key={key++} className={cn("font-semibold", small ? "text-foreground/80" : "text-foreground")}>
          {bold.slice(2, -2)}
        </strong>
      );
    else if (italic) out.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    else if (strike)
      out.push(
        <s key={key++} className="opacity-70">
          {strike.slice(2, -2)}
        </s>
      );
    else if (link) {
      const lm = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (lm)
        out.push(
          <a
            key={key++}
            href={lm[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground/70"
          >
            {lm[1]}
          </a>
        );
    }
    last = m.index + m[0].length;
    if (m[0].length === 0) INLINE_RE.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type MdBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(src: string): MdBlock[] {
  const lines = src.split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ kind: "p", text: para.join("\n") });
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```[^`]*$/);
    if (fence) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join("\n") });
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flush();
      const ordered = Boolean(ol);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={cn("flex flex-col gap-3 font-sans text-[14px] leading-[22px] text-foreground/90", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const cls =
              b.level <= 1
                ? "text-[18px] leading-[26px] font-semibold text-foreground"
                : b.level === 2
                  ? "text-[16px] leading-[24px] font-semibold text-foreground"
                  : "text-[14.5px] leading-[22px] font-semibold text-foreground";
            return (
              <p key={i} className={cls}>
                {renderInline(b.text)}
              </p>
            );
          }
          case "code":
            return <CodeBlock key={i} code={b.text} className="bg-muted/30" />;
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3 text-muted-foreground">
                {renderInline(b.text)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={i} className="flex flex-col gap-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden="true" className="select-none text-muted-foreground">•</span>
                    <span className="min-w-0">{renderInline(it)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="flex flex-col gap-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="select-none tabular-nums text-muted-foreground">{j + 1}.</span>
                    <span className="min-w-0">{renderInline(it)}</span>
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-line text-pretty">
                {renderInline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

/* ═══════════════ Thought chip (rides the group like any tool) ═══════════════ */
const THOUGHT_MAX_H = 184;
const THOUGHT_FADE = 18;

export function NestedReasoningBlock({
  sentences,
  delays,
  isActive,
  isFinished,
  durationSeconds = 4.2,
  onFinished,
  first,
  last,
}: {
  sentences: string[];
  delays?: number[];
  isActive: boolean;
  isFinished: boolean;
  durationSeconds?: number;
  onFinished?: () => void;
  first: boolean;
  last: boolean;
}) {
  const [revealed, setRevealed] = React.useState(isFinished ? sentences.length : 1);
  const [manualOpen, setManualOpen] = React.useState(true);
  const [fade, setFade] = React.useState({ top: false, bottom: true });
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const onFinishedRef = React.useRef(onFinished);
  onFinishedRef.current = onFinished;

  const contentRef = React.useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = React.useState(0);
  React.useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setContentH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    if (!isActive || isFinished) return;
    const cadence = delays || sentences.map(() => 1400 + Math.floor(Math.random() * 250));
    let cumulative = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    cadence.forEach((delay, idx) => {
      cumulative += delay;
      timers.push(setTimeout(() => setRevealed(idx + 1), cumulative));
    });
    timers.push(setTimeout(() => onFinishedRef.current?.(), cumulative + 400));
    return () => timers.forEach(clearTimeout);
  }, [isActive, isFinished, delays, JSON.stringify(sentences)]);

  const [liveSecs, setLiveSecs] = React.useState(0);
  React.useEffect(() => {
    if (!isActive || isFinished) return;
    const start = Date.now();
    const t = setInterval(() => setLiveSecs((Date.now() - start) / 1000), 100);
    return () => clearInterval(t);
  }, [isActive, isFinished]);

  const shownSecs = isFinished ? (liveSecs > 0 ? liveSecs : durationSeconds) : liveSecs;
  const open = manualOpen;
  const count = isFinished ? sentences.length : Math.max(1, revealed);
  const capped = contentH > THOUGHT_MAX_H;
  const scrollable = manualOpen;

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!scrollable || !el) return;
    el.scrollTop = el.scrollHeight;
    setFade({ top: true, bottom: false });
  }, [scrollable]);

  const translate = scrollable ? 0 : capped ? THOUGHT_MAX_H - THOUGHT_FADE - contentH : 0;
  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${scrollable && fade.top ? THOUGHT_FADE : 0}px, #000 calc(100% - ${scrollable && fade.bottom ? THOUGHT_FADE : 0}px), transparent 100%)`
    : "none";

  return (
    <ToolChipRow
      first={first}
      last={last}
      failed={false}
      label="Thought process"
      labelSuffix={
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60 ml-1.5 inline-block">
          {shownSecs.toFixed(1)}s
        </span>
      }
      icon={<Brain className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      isActive={isActive}
      expandable
      open={open}
      onToggle={() => setManualOpen((v) => !v)}
      bodyPadLeft={ACTIVITY_ICON_LEFT + ACTIVITY_ICON_SIZE}
      body={
        <div className="py-1 pl-3">
          <div
            ref={viewportRef}
            onScroll={
              scrollable
                ? () => {
                    const el = viewportRef.current;
                    if (!el) return;
                    setFade({
                      top: el.scrollTop > 1,
                      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
                    });
                  }
                : undefined
            }
            className={cn(
              "overflow-hidden pr-1",
              scrollable && "overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            )}
            style={{
              height: capped ? THOUGHT_MAX_H : undefined,
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
          >
            <div
              ref={contentRef}
              className="flex flex-col gap-1 transition-transform duration-300 will-change-transform"
              style={{ transform: `translateY(${translate}px)` }}
            >
              {sentences.slice(0, count).map((line, i) => (
                <p
                  key={i}
                  className="m-0 text-[12.5px] leading-[20px] tracking-normal text-muted-foreground text-pretty"
                  style={{ animation: "agent-fade 250ms cubic-bezier(0.23,1,0.32,1) both" }}
                >
                  {thoughtInline(line)}
                </p>
              ))}
            </div>
          </div>
        </div>
      }
    />
  );
}

/* ═══════════════ The rail chip row (tool_chip + expandable card) ═══════════════ */
function ToolChipRow({
  first,
  last,
  failed,
  label,
  labelSuffix,
  icon,
  detail,
  fileBadgeName,
  monoDetail,
  isActive,
  expandable,
  open,
  onToggle,
  body,
  extraTrail,
  index,
  bodyPadLeft = ACTIVITY_GUTTER_WIDTH + ACTIVITY_TEXT_GAP,
  commandPill,
}: {
  first: boolean;
  last: boolean;
  failed: boolean;
  label: string;
  labelSuffix?: React.ReactNode;
  icon: React.ReactNode;
  detail?: string;
  fileBadgeName?: string;
  monoDetail?: boolean;
  isActive?: boolean;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  body?: React.ReactNode;
  extraTrail?: React.ReactNode;
  index?: number;
  bodyPadLeft?: number;
  commandPill?: string;
}) {
  const failedCls = failed ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
  return (
    <div
      className="relative flex w-full flex-col"
      style={{
        animation: "agent-row-in 360ms cubic-bezier(0.16,1,0.3,1) both",
        animationDelay: `${FIRST_ROW_DELAY_MS + (index ?? 0) * ROW_STAGGER_MS}ms`,
      }}
    >
      <ActivityRail hasPredecessor={!first} continues={!last || !!open} failed={failed} />
      <span
        className={cn("absolute z-[1] flex items-center justify-center", failed && "text-rose-600 dark:text-rose-400")}
        style={{
          left: ACTIVITY_ICON_LEFT,
          top: TOOL_TREE_ROW_HEIGHT / 2 - ACTIVITY_ICON_SIZE / 2,
          width: ACTIVITY_ICON_SIZE,
          height: ACTIVITY_ICON_SIZE,
        }}
      >
        {isActive ? (
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground/70"
          />
        ) : (
          icon
        )}
      </span>
      <div
        className="min-w-0 flex-1 flex flex-col"
        style={{ marginLeft: ACTIVITY_GUTTER_WIDTH + ACTIVITY_TEXT_GAP }}
      >
        <button
          type="button"
          disabled={!expandable && !onToggle}
          aria-expanded={expandable ? open : undefined}
          onClick={onToggle}
          className={cn(
            "group/chip flex w-full items-center gap-2 text-left",
            (expandable || onToggle) && "cursor-pointer active:scale-[0.995]",
            !(expandable || onToggle) && "cursor-default"
          )}
          style={{ height: TOOL_TREE_ROW_HEIGHT }}
        >
          <span
            className={cn(
              "flex h-[18px] shrink-0 items-center text-[12px] font-medium leading-[18px] tracking-tight transition-colors",
              failedCls,
              (expandable || onToggle) && !failed && "group-hover/chip:text-foreground"
            )}
          >
            {label}
            {labelSuffix && <span className="ml-1.5">{labelSuffix}</span>}
          </span>
          {fileBadgeName ? (
            <span className="flex h-[22px] min-w-0 max-w-[55%] shrink items-center gap-1.5 overflow-hidden rounded-[5px] bg-muted/70 pr-1.5 pl-px text-[12px] text-foreground/85 transition-colors group-hover/chip:bg-muted">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-background">
                <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="truncate">{fileBadgeName}</span>
            </span>
          ) : commandPill ? (
            <span className="inline-flex h-[22px] min-w-0 max-w-[55%] shrink items-center overflow-hidden rounded-[5px] bg-muted/70 px-2 font-mono text-[11.5px] text-foreground/85 transition-colors group-hover/chip:bg-muted">
              <span className="truncate">{commandPill}</span>
            </span>
          ) : detail ? (
            <span
              className={cn(
                "min-w-0 max-w-[55%] shrink truncate text-[12px] leading-[18px] text-foreground/85",
                monoDetail && "font-mono"
              )}
            >
              {detail}
            </span>
          ) : null}
          {extraTrail}
          {expandable && (
            <span className="flex size-[18px] shrink-0 items-center justify-center text-muted-foreground/80 opacity-60 transition-opacity duration-150 group-hover/chip:opacity-100">
              {open ? (
                <ChevronDown className="size-3" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3" aria-hidden="true" />
              )}
            </span>
          )}
        </button>
      </div>
      {expandable && (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity]",
            FOLD_CLS,
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div style={{ paddingLeft: bodyPadLeft }}>
              <div className="h-px" />
              <div className="flex min-w-0 flex-col">{body}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════ TracePillRow — one node → one rail chip ═══════════════ */
function TracePillRow({
  node,
  isActive,
  isFinished,
  toolRegistry = DEFAULT_TOOL_REGISTRY,
  first,
  last,
  index,
}: {
  node: TraceNode;
  isActive: boolean;
  isFinished: boolean;
  toolRegistry?: Record<string, ToolDefinition>;
  first: boolean;
  last: boolean;
  index: number;
}) {
  const [open, setOpen] = React.useState(false);
  const def = node.toolName ? toolRegistry[node.toolName] : undefined;
  const call = nodeToCall(node);
  const [label, chipDetail] = toolChipContent(call);
  const isCmd = Boolean(node.command || node.type === "terminal" || node.type === "command");
  const failed = node.status === "failed" || (node.exitCode !== undefined && node.exitCode > 0);
  const filePath: string | undefined =
    call.kind === "read" || call.kind === "write" || call.kind === "edit" || call.kind === "patch"
      ? call.path
      : undefined;
  const detailText =
    node.secondary ?? (isCmd ? undefined : chipDetail || (typeof node.args === "string" ? node.args : undefined));
  const commandPill = isCmd && node.command ? singleLine(node.command.split("\n")[0] ?? "") : undefined;
  const invocationLines = callBlockLines(node, call);
  const custom = node.renderContent
    ? node.renderContent()
    : def?.renderCustomContent
      ? def.renderCustomContent({ args: node.args, result: node.result, node })
      : null;
  const hasBody = Boolean(
    custom ||
      (isCmd && (node.command || node.output)) ||
      node.diffRows ||
      node.code ||
      node.codeSnippet ||
      node.details?.length ||
      node.sources?.length ||
      invocationLines.length
  );

  const icon =
    node.icon && (React.isValidElement(node.icon) || typeof node.icon === "function") ? (
      React.isValidElement(node.icon) ? (
        node.icon
      ) : (
        React.createElement(node.icon, { className: "size-4 shrink-0 text-muted-foreground", "aria-hidden": true })
      )
    ) : def?.icon && typeof def.icon === "function" ? (
      React.createElement(def.icon, { className: "size-4 shrink-0 text-muted-foreground", "aria-hidden": true })
    ) : (
      railIcon(call, label)
    );

  return (
    <ToolChipRow
      first={first}
      last={last}
      failed={failed}
      index={index}
      label={node.primary || label}
      icon={icon}
      detail={filePath || commandPill ? undefined : detailText}
      fileBadgeName={filePath ? basename(filePath) : undefined}
      commandPill={commandPill}
      monoDetail={node.mono ?? (isCmd || def?.monoChip)}
      isActive={isActive}
      expandable={hasBody}
      open={open}
      onToggle={hasBody ? () => setOpen((v) => !v) : undefined}
      extraTrail={
        node.add !== undefined || node.del !== undefined ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium tabular-nums">
            {node.add ? <span className="text-emerald-600 dark:text-emerald-400">+{node.add}</span> : null}
            {node.del ? <span className="text-rose-600 dark:text-rose-400">−{node.del}</span> : null}
          </span>
        ) : undefined
      }
      body={
        <>
          {custom}
          {!custom && node.code && !isCmd && (
            <div className="py-1">
              <CodeBlock code={node.code} lineStart={node.lineStart ?? 1} lang={node.lang} />
            </div>
          )}
          {!custom && !node.diffRows && !node.code && invocationLines.length > 0 && !isCmd && (
            <OutputDetail lines={invocationLines} />
          )}
          {!custom && isCmd && node.command && (
            <div className="py-1">
              <TerminalCommand
                command={node.command}
                output={node.output}
                exitCode={node.exitCode ?? 0}
                durationMs={node.durationMs}
                isRunning={isActive}
              />
            </div>
          )}
          {node.diffRows && (
            <div className="py-1">
              <FileDiff
                file={node.diffFile || (typeof node.secondary === "string" ? node.secondary : "patch")}
                rows={node.diffRows}
              />
            </div>
          )}
          {!isCmd && !node.diffRows && !node.code && node.codeSnippet && <OutputDetail lines={node.codeSnippet.split("\n")} />}
          {!isCmd && !node.diffRows && node.details && node.details.length > 0 && (
            <div className="flex flex-col py-[6px] font-mono text-[12px]">
              {node.details.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    "whitespace-pre",
                    line.tone === "add" && "text-emerald-600 dark:text-emerald-400",
                    line.tone === "del" && "text-rose-600 dark:text-rose-400",
                    line.tone === "error" && "font-medium text-rose-600 dark:text-rose-400",
                    (!line.tone || line.tone === "muted" || line.tone === "ctx") && "text-muted-foreground"
                  )}
                  style={{ minHeight: OUTPUT_LINE_HEIGHT, lineHeight: `${OUTPUT_LINE_HEIGHT}px` }}
                >
                  {line.text}
                </div>
              ))}
            </div>
          )}
          {node.sources && node.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 py-1">
              {node.sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  <Globe className="size-2.5 opacity-70" aria-hidden="true" />
                  <span>{src.name}</span>
                  <ExternalLink className="size-2.5 opacity-50" aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
        </>
      }
    />
  );
}

/* ═══════════════ ThinkingState — group header + rail tree ═══════════════ */
export interface ThinkingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  nodes?: TraceNode[];
  tools?: Record<string, ToolDefinition>;
  autoPlay?: boolean;
  defaultExpanded?: boolean;
  workingLabel?: string;
  onSettled?: () => void;
}

export const ThinkingState = React.forwardRef<HTMLDivElement, ThinkingStateProps>(
  (
    {
      nodes = [],
      tools = DEFAULT_TOOL_REGISTRY,
      autoPlay = true,
      defaultExpanded,
      workingLabel,
      onSettled,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const total = nodes.length;
    const [activeIndex, setActiveIndex] = React.useState(autoPlay ? 0 : total);
    const [isWorking, setIsWorking] = React.useState(autoPlay);
    const [manualExpanded, setManualExpanded] = React.useState<boolean | null>(defaultExpanded ?? null);
    const startTimeRef = React.useRef(Date.now());
    const isWorkingRef = React.useRef(isWorking);
    isWorkingRef.current = isWorking;
    const onSettledRef = React.useRef(onSettled);
    onSettledRef.current = onSettled;

    React.useEffect(() => {
      if (!autoPlay) return;
      startTimeRef.current = Date.now();
    }, [autoPlay]);

    const advanceStep = React.useCallback(() => {
      setActiveIndex((prev) => {
        const next = prev + 1;
        if (next >= total) setIsWorking(false);
        return next;
      });
    }, [total]);

    React.useEffect(() => {
      if (!autoPlay || !isWorking || activeIndex >= total) return;
      if (nodes[activeIndex]?.type === "reasoning") return;
      const delay = ["tool", "terminal"].includes(nodes[activeIndex]?.type ?? "")
        ? 2200
        : nodes[activeIndex]?.type === "search"
          ? 2400
          : 1700;
      const timer = setTimeout(advanceStep, delay);
      return () => clearTimeout(timer);
    }, [activeIndex, autoPlay, isWorking, total, nodes, advanceStep]);

    React.useEffect(() => {
      if (!isWorking && autoPlay) onSettledRef.current?.();
    }, [isWorking, autoPlay]);

    const revealedCount = Math.min(activeIndex + 1, total);
    const summary = React.useMemo(
      () =>
        toolGroupSummary(
          nodes
            .slice(0, revealedCount)
            .map((n) => ({ call: nodeToCall(n), is_error: n.status === "failed" || (n.exitCode ?? 0) > 0 }))
        ),
      [nodes, revealedCount]
    );

    const activeType = nodes[Math.min(activeIndex, total - 1)]?.type;
    const hasThought = nodes.some((n) => n.type === "reasoning");
    const title =
      workingLabel ??
      (summary ||
        (isWorking
          ? activeType === "reasoning"
            ? "Thinking…"
            : "Working…"
          : hasThought
            ? "Thought it through"
            : "Worked"));

    const expanded = manualExpanded !== null ? manualExpanded : true;

    return (
      <div
        ref={ref}
        className={cn("flex w-full flex-col font-sans text-foreground select-none", className)}
        style={style}
        {...props}
      >
        <style>{`
          @keyframes agent-pixel-on { 0%,100%{opacity:.15;transform:scale(.9)} 50%{opacity:.95;transform:scale(1.1)} }
          @keyframes agent-fade { from{opacity:0;transform:translateY(2px)} to{opacity:1;transform:translateY(0)} }
          @keyframes agent-row-in { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
          @keyframes agent-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        `}</style>

        {/* ── group header ── */}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setManualExpanded((prev) => !(prev !== null ? prev : true))}
          className={cn(
            "group flex w-full cursor-pointer items-center gap-1.5 pr-1 text-left text-[12px] leading-[18px]",
            "text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-xs"
          )}
          style={{ height: TOOL_GROUP_HEADER_HEIGHT }}
        >
          <span className="relative h-[18px] w-[22px] shrink-0">
            <ChevronDown
              aria-hidden="true"
              className={cn("absolute size-3.5 text-muted-foreground transition-transform ease-out", FOLD_CLS)}
              style={{ left: ACTIVITY_TRUNK_X - 7, top: 2, transform: `rotate(${expanded ? 0 : -90}deg)` }}
            />
          </span>
          <span className="min-w-0 truncate">
            {isWorking ? (
              <span
                className="bg-clip-text font-medium text-transparent motion-reduce:animate-none"
                style={{
                  backgroundImage:
                    "linear-gradient(100deg, var(--color-muted-foreground) 42%, var(--color-foreground) 50%, var(--color-muted-foreground) 58%)",
                  backgroundSize: "220% 100%",
                  animation: `agent-shimmer ${SHIMMER_DURATION_MS}ms linear infinite`,
                }}
              >
                {title}
              </span>
            ) : (
              <span className="font-normal">{title}</span>
            )}
          </span>
        </button>

        {/* ── collapsible tree ── */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] ease-out",
            FOLD_CLS,
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col" style={{ paddingTop: CHIPS_TOP_PAD }}>
              {nodes.slice(0, Math.min(activeIndex + 1, total)).map((node, idx) => {
                const isNodeActive = idx === activeIndex && isWorking;
                const isNodeFinished = idx < activeIndex || !isWorking;
                if (node.type === "reasoning" && node.sentences) {
                  return (
                    <NestedReasoningBlock
                      key={node.id ?? idx}
                      sentences={node.sentences}
                      durationSeconds={node.durationSeconds}
                      isActive={isNodeActive}
                      isFinished={isNodeFinished}
                      onFinished={advanceStep}
                      first={idx === 0}
                      last={idx === total - 1}
                    />
                  );
                }
                return (
                  <TracePillRow
                    key={node.id ?? idx}
                    node={node}
                    isActive={isNodeActive}
                    isFinished={isNodeFinished}
                    toolRegistry={tools}
                    first={idx === 0}
                    last={idx === total - 1}
                    index={idx}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
ThinkingState.displayName = "ThinkingState";

/* ═══════════════ AgentWorkflow (multi-phase) ═══════════════ */
export function AgentWorkflow({
  phases = [],
  tools,
  workingLabel,
  onComplete,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  phases: AgentPhase[];
  tools?: Record<string, ToolDefinition>;
  workingLabel?: string;
  onComplete?: () => void;
}) {
  const [currentPhase, setCurrentPhase] = React.useState(0);
  const [phaseStatus, setPhaseStatus] = React.useState<"trace" | "message">("trace");
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;

  const traceSettled = React.useCallback(
    (idx: number) => {
      if (idx !== currentPhase) return;
      if (phases[idx]?.message) setPhaseStatus("message");
      else if (idx < phases.length - 1) {
        setCurrentPhase((p) => p + 1);
        setPhaseStatus("trace");
      } else onCompleteRef.current?.();
    },
    [currentPhase, phases]
  );

  const messageDone = React.useCallback(
    (idx: number) => {
      if (idx !== currentPhase) return;
      if (idx < phases.length - 1) {
        setCurrentPhase((p) => p + 1);
        setPhaseStatus("trace");
      } else onCompleteRef.current?.();
    },
    [currentPhase, phases]
  );

  return (
    <div className={cn("flex w-full flex-col gap-4", className)} {...props}>
      {phases.map((phase, idx) => {
        if (idx > currentPhase) return null;
        const isCurrent = idx === currentPhase;
        const play = isCurrent && phaseStatus === "trace";
        const traceDone = !isCurrent || phaseStatus === "message";
        return (
          <div key={idx} className="flex flex-col gap-1">
            <ThinkingState
              nodes={phase.trace}
              tools={tools}
              autoPlay={play}
              workingLabel={workingLabel}
              onSettled={() => traceSettled(idx)}
            />
            {traceDone && phase.message && (
              <div className="pt-0" style={{ animation: "agent-fade 300ms ease-out both" }}>
                {isCurrent && phaseStatus === "message" ? (
                  <StreamingText text={phase.message} speed={18} chunkSize={2} onComplete={() => messageDone(idx)} />
                ) : (
                  <Markdown text={phase.message} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
