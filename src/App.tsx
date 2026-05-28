import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bot,
  ChevronDown,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileText,
  FolderDown,
  FolderGit2,
  GitBranch,
  Globe2,
  History,
  Layers3,
  Loader2,
  Moon,
  MoreHorizontal,
  PanelRight,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Sun,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import "./App.css";
import { callGrokCLI, cancelGrokCLI, type GrokStreamEvent } from "./lib/grok";

type Mode = "standard" | "coding";
type Runner =
  | "grok"
  | "shell"
  | "browser"
  | "absorb"
  | "doctor"
  | "chrome"
  | "inspect"
  | "models"
  | "mcp"
  | "mcp-doctor"
  | "plugins"
  | "sessions";
type ActionPolicy = "review" | "patch" | "autopilot";
type InspectorTab = "context" | "skills" | "mcp" | "agents" | "plugins" | "hooks" | "permissions";
type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";
type PermissionMode = "default" | "acceptEdits" | "auto" | "dontAsk" | "plan";
type ThemeMode = "dark" | "light";
type DockPosition = "right" | "bottom";
type GrokModelId =
  | "grok-build"
  | "grok-build-0.1"
  | "grok-4.3"
  | "grok-4.3-latest"
  | "grok-latest"
  | "grok-4-fast-reasoning"
  | "grok-4-fast-non-reasoning"
  | "custom";

type ToolStatus = {
  id: string;
  label: string;
  command: string;
  installed: boolean;
  detail: string;
};

type ModeMeta = {
  title: string;
  subtitle: string;
  shortcut: string;
  placeholder: string;
  defaultPrompt: string;
};

type ToolRun = {
  ok: boolean;
  command: string;
  cwd: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  output: string;
  stderr: string;
};

type ChromeSnapshot = {
  title: string;
  url: string;
  description: string;
  selectedText: string;
  textSample: string;
  headings: { level: string; text: string }[];
  updatedAt?: number;
};

type ChromeTabState = {
  id: number;
  title: string;
  url: string;
  status: "watching" | "controlling" | string;
  task: string;
  updatedAt?: number;
  snapshot?: ChromeSnapshot | null;
};

type ChromeBridgeState = {
  ok: boolean;
  connected: boolean;
  hostName: string;
  extensionId?: string | null;
  updatedAt?: number | null;
  statePath: string;
  tabs: ChromeTabState[];
  settings: {
    focusGuard: boolean;
    visibleMotion: boolean;
    controlledTabsOnly: boolean;
  };
  lastError?: string | null;
};

type StaticPreviewFile = {
  name: string;
  path: string;
  kind: string;
  size: number;
};

type StaticPreview = {
  available: boolean;
  root: string;
  entryPath: string;
  html: string;
  files: StaticPreviewFile[];
  detail: string;
  updatedAt: number;
};

type GrokAuthStatus = {
  installed: boolean;
  authenticated: boolean;
  apiKeyPresent: boolean;
  cachedLoginPresent: boolean;
  configPresent: boolean;
  version: string;
  detail: string;
  loginCommand: string;
  deviceLoginCommand: string;
  installCommand: string;
  npmInstallCommand: string;
  authPath: string;
  configPath: string;
};

type ChatMessageStatus = "streaming" | "done" | "error" | "stopped";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  status?: ChatMessageStatus;
  meta?: {
    model?: string;
    durationMs?: number;
    exitCode?: number | null;
    workflow?: string;
  };
};

type SessionState = {
  mode?: Mode;
  drafts?: Partial<Record<Mode, string>>;
  codingCwd?: string;
  shellCommand?: string;
  actionPolicy?: ActionPolicy;
  codingWorkflow?: string;
  chromeExtensionId?: string;
  themeMode?: ThemeMode;
  lastRun?: ToolRun | null;
  history?: ToolRun[];
  messages?: ChatMessage[];
};

const modeCopy = {
  standard: {
    title: "Grok Chat",
    subtitle: "quick questions and product thinking",
    shortcut: "⌘1",
    placeholder: "Ask Grok for product thinking, research, or an engineering explanation...",
    defaultPrompt: "Answer clearly, keep the response practical, and suggest when this should move into Coding Mode.",
  },
  coding: {
    title: "Grok Code",
    subtitle: "repository, terminal, reviews, implementation",
    shortcut: "⌘2",
    placeholder: "Review this repo, implement a narrow fix, debug a test, refactor a module...",
    defaultPrompt: "Inspect the current repository like a senior engineer. Identify the most useful next code action and include exact commands to verify it.",
  },
} satisfies Record<Mode, ModeMeta>;

const storageKeys = {
  mode: "grok-desktop-mode",
  drafts: "grok-desktop-mode-drafts",
  chromeExtensionId: "grok-desktop-chrome-extension-id",
  codingCwd: "grok-desktop-coding-cwd",
  shellCommand: "grok-desktop-shell-command",
  actionPolicy: "grok-desktop-action-policy",
  codingWorkflow: "grok-desktop-coding-workflow",
  lastRun: "grok-desktop-last-run",
  runHistory: "grok-desktop-run-history",
  messages: "grok-desktop-messages-v1",
  themeMode: "grok-desktop-theme-mode",
  cleanLayoutTheme: "grok-desktop-clean-layout-theme-v1",
  cleanComposer: "grok-desktop-clean-composer-v3",
  dockPosition: "grok-desktop-dock-position",
  inspectorTab: "grok-desktop-inspector-tab",
  modelPreset: "grok-desktop-model-preset",
  customModel: "grok-desktop-custom-model",
  effortLevel: "grok-desktop-effort-level",
  reasoningEffort: "grok-desktop-reasoning-effort",
  permissionMode: "grok-desktop-permission-mode",
  bestOfN: "grok-desktop-best-of-n",
  experimentalMemory: "grok-desktop-experimental-memory",
  webSearchEnabled: "grok-desktop-web-search-enabled",
  subagentsEnabled: "grok-desktop-subagents-enabled",
  selfCheck: "grok-desktop-self-check",
  safeRuntimeDefaults: "grok-desktop-safe-runtime-defaults-v3",
};

const defaultDrafts: Record<Mode, string> = {
  standard: modeCopy.standard.defaultPrompt,
  coding: modeCopy.coding.defaultPrompt,
};

const codingPresets = [
  {
    id: "analyze",
    label: "Analyze",
    description: "Architecture, risks, next moves",
    prompt:
      "Analyze this project as a senior engineer. Summarize the architecture, identify the most important correctness and maintainability risks, and recommend the smallest high-leverage next steps. Do not edit files yet.",
  },
  {
    id: "implement",
    label: "Implement",
    description: "Small focused code change",
    prompt:
      "Find one focused improvement in this project, explain why it matters, make the smallest safe code change, and include verification commands.",
  },
  {
    id: "review",
    label: "Review",
    description: "Bug-first code review",
    prompt:
      "Review the current repository or recent changes like a strict senior reviewer. Lead with bugs, regressions, missing tests, security risks, and maintainability issues. Include file paths and concrete fixes.",
  },
  {
    id: "debug",
    label: "Debug",
    description: "Root cause and fix",
    prompt:
      "Investigate the reported issue. Read relevant files first, separate evidence from hypothesis, identify the root cause, then propose or apply the smallest fix with verification.",
  },
  {
    id: "tests",
    label: "Tests",
    description: "Coverage and verification",
    prompt:
      "Inspect the test setup, identify the most valuable missing or failing test, add or propose the smallest useful test change, and include commands to run it.",
  },
  {
    id: "refactor",
    label: "Refactor",
    description: "Behavior-preserving cleanup",
    prompt:
      "Inspect the current code for a small refactor that improves maintainability without changing behavior. Keep the change narrow and include verification steps.",
  },
];

const actionPolicies: Record<ActionPolicy, { label: string; detail: string }> = {
  review: {
    label: "Review only",
    detail: "Read, reason, propose. No file edits unless asked.",
  },
  patch: {
    label: "Patch ready",
    detail: "Produce exact changes and apply narrow safe edits.",
  },
  autopilot: {
    label: "Autopilot",
    detail: "Use tools and verification aggressively, still avoid destructive work.",
  },
};

const effortLevels: Record<EffortLevel, { label: string; detail: string }> = {
  low: { label: "Low", detail: "Fast triage and small answers" },
  medium: { label: "Medium", detail: "Balanced repo reasoning" },
  high: { label: "High", detail: "Default coding depth" },
  xhigh: { label: "XHigh", detail: "Deep plans and refactors" },
  max: { label: "Max", detail: "Most thorough Grok pass" },
};

const reasoningEfforts: Record<ReasoningEffort, { label: string; detail: string }> = {
  off: { label: "Auto", detail: "Let Grok choose reasoning depth" },
  low: { label: "Low", detail: "Fast reasoning pass" },
  medium: { label: "Medium", detail: "Balanced reasoning" },
  high: { label: "High", detail: "Harder code paths" },
  xhigh: { label: "XHigh", detail: "Architecture and debugging" },
  max: { label: "Max", detail: "Maximum reasoning budget" },
};

const grokModelPresets: Record<GrokModelId, { label: string; detail: string; defaultReasoning: ReasoningEffort }> = {
  "grok-build": {
    label: "grok-build",
    detail: "Recommended Grok Build CLI coding agent",
    defaultReasoning: "off",
  },
  "grok-build-0.1": {
    label: "grok-build-0.1",
    detail: "Pinned Grok Build API model",
    defaultReasoning: "off",
  },
  "grok-4.3": {
    label: "grok-4.3",
    detail: "Flagship reasoning model for complex implementation",
    defaultReasoning: "high",
  },
  "grok-4.3-latest": {
    label: "grok-4.3-latest",
    detail: "Latest Grok 4.3 alias when the CLI supports it",
    defaultReasoning: "high",
  },
  "grok-latest": {
    label: "grok-latest",
    detail: "Follow the current xAI default alias",
    defaultReasoning: "medium",
  },
  "grok-4-fast-reasoning": {
    label: "grok-4-fast-reasoning",
    detail: "Fast reasoning for iterative coding loops",
    defaultReasoning: "medium",
  },
  "grok-4-fast-non-reasoning": {
    label: "grok-4-fast-non-reasoning",
    detail: "Fast edits and simple command work",
    defaultReasoning: "off",
  },
  custom: {
    label: "Custom",
    detail: "Use any model ID accepted by your Grok CLI",
    defaultReasoning: "off",
  },
};

const permissionModes: Record<PermissionMode, { label: string; detail: string }> = {
  default: { label: "Default", detail: "Use Grok CLI configured prompts and approvals" },
  acceptEdits: { label: "Accept edits", detail: "Prefer quick edit approval for trusted changes" },
  auto: { label: "Auto", detail: "Let Grok proceed through low-risk tool steps" },
  dontAsk: { label: "Don't ask", detail: "Reduce prompts while keeping Grok Desktop safety context visible" },
  plan: { label: "Plan", detail: "Plan-first behavior for larger or uncertain work" },
};

const inspectorTabs: { id: InspectorTab; label: string }[] = [
  { id: "context", label: "Context" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
  { id: "plugins", label: "Plugins" },
  { id: "hooks", label: "Hooks" },
  { id: "permissions", label: "Perms" },
];

const defaultStatuses: ToolStatus[] = [
  {
    id: "grok",
    label: "Grok Build",
    command: "grok",
    installed: false,
    detail: "Not checked",
  },
];

const primaryNavItems = [
  { label: "New Session", meta: "Start fresh" },
  { label: "Search", meta: "Find work" },
  { label: "Tools", meta: "Skills and MCP" },
  { label: "Settings", meta: "Preferences" },
];

type HistoryPreview = { id: string; title: string; detail: string; time: string };

function recentPromptPreviews(messages: ChatMessage[]): HistoryPreview[] {
  const userMessages = messages.filter((message) => message.role === "user");
  const recent = userMessages.slice(-5).reverse();
  return recent.map((message) => {
    const firstLine = message.content.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
    const title = firstLine.length > 56 ? `${firstLine.slice(0, 56)}…` : firstLine || "Untitled prompt";
    const detail = message.meta?.workflow ?? "task";
    return {
      id: message.id,
      title,
      detail,
      time: timeLabel(message.ts),
    };
  });
}

const placeholderHistory: HistoryPreview[] = [
  { id: "p1", title: "Try: review this repository for risks", detail: "review", time: "" },
  { id: "p2", title: "Try: add a failing test for the bug", detail: "tests", time: "" },
  { id: "p3", title: "Try: implement a small focused fix", detail: "implement", time: "" },
];

const contextFiles = [
  "README.md",
  "src/App.tsx",
  "src/lib/grok.ts",
  "src-tauri/src/lib.rs",
  "src-tauri/Cargo.toml",
];

const grokOptimizationRules = [
  "Default to grok-build for agentic repository work",
  "Use reasoning effort only when the selected model benefits from it",
  "Keep web search available for version-sensitive docs",
  "Expose Best-of-N, Memory, and Subagents as explicit engine controls",
  "Send repo path, workflow, approvals, ecosystem, and verification contract",
];

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function isMode(value: unknown): value is Mode {
  return value === "coding" || value === "standard";
}

function isActionPolicy(value: unknown): value is ActionPolicy {
  return value === "review" || value === "patch" || value === "autopilot";
}

function isInspectorTab(value: unknown): value is InspectorTab {
  return (
    value === "context" ||
    value === "skills" ||
    value === "mcp" ||
    value === "agents" ||
    value === "plugins" ||
    value === "hooks" ||
    value === "permissions"
  );
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "off" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

function isGrokModelId(value: unknown): value is GrokModelId {
  return (
    value === "grok-build" ||
    value === "grok-build-0.1" ||
    value === "grok-4.3" ||
    value === "grok-4.3-latest" ||
    value === "grok-latest" ||
    value === "grok-4-fast-reasoning" ||
    value === "grok-4-fast-non-reasoning" ||
    value === "custom"
  );
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "default" || value === "acceptEdits" || value === "auto" || value === "dontAsk" || value === "plan";
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

function isDockPosition(value: unknown): value is DockPosition {
  return value === "right" || value === "bottom";
}

function isToolRun(value: unknown): value is ToolRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<ToolRun>;
  return (
    typeof run.ok === "boolean" &&
    typeof run.command === "string" &&
    typeof run.cwd === "string" &&
    (typeof run.exit_code === "number" || run.exit_code === null) &&
    typeof run.duration_ms === "number" &&
    typeof run.timed_out === "boolean" &&
    typeof run.output === "string" &&
    typeof run.stderr === "string"
  );
}

function storedRunHistory() {
  return readJsonStorage<unknown[]>(storageKeys.runHistory, [])
    .filter(isToolRun)
    .slice(0, 6);
}

function storedLastRun() {
  const run = readJsonStorage<unknown | null>(storageKeys.lastRun, null);
  return isToolRun(run) ? run : null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.ts === "number"
  );
}

function storedMessages() {
  return readJsonStorage<unknown[]>(storageKeys.messages, [])
    .filter(isChatMessage)
    .slice(-120);
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseAvailableModels(output: string): string[] {
  if (!output.trim()) return [];
  const lines = output.split("\n");
  const start = lines.findIndex((line) => /available models/i.test(line));
  if (start < 0) return [];
  const models = new Set<string>();
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*[\*\-•]\s*([\w./:@-]+)/);
    if (!match) {
      if (models.size > 0) break;
      continue;
    }
    models.add(match[1]);
  }
  return Array.from(models);
}

function timeLabel(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function nativeUnavailable(command: string): ToolRun {
  return {
    ok: false,
    command,
    cwd: "",
    exit_code: null,
    duration_ms: 0,
    timed_out: false,
    output: "",
    stderr:
      "Native commands are available in the Tauri desktop window. Run npm run tauri:dev.",
  };
}

function formatOutput(run: ToolRun | null, terminalOutput = "") {
  if (terminalOutput.trim()) return terminalOutput;
  if (!run) return "No run yet.";
  const output = run.output.trim();
  const stderr = run.stderr.trim();

  if (!output && !stderr) return "Command finished without output.";
  if (run.ok && output) return output;
  if (!output) return stderr;
  if (!stderr) return output;
  return `${output}\n\nstderr:\n${stderr}`;
}

function compactRunPreview(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

function formatBridgeAge(timestamp?: number | null) {
  if (!timestamp) return "not connected";
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function snapshotLead(tab: ChromeTabState) {
  const firstHeading = tab.snapshot?.headings?.find((heading) => heading.text)?.text;
  return firstHeading || tab.snapshot?.description || tab.snapshot?.textSample || tab.url;
}

function formatGrokEvent(event: GrokStreamEvent) {
  const prefix =
    event.stream === "stderr"
      ? "err"
      : event.stream === "system"
        ? "sys"
        : "out";
  return `[${prefix}] ${event.line}`;
}

function terminalClass(line: string) {
  if (line.startsWith("[err]")) return "terminal-line terminal-error";
  if (line.startsWith("[sys]")) return "terminal-line terminal-system";
  if (
    line.includes("```") ||
    line.includes("diff --git") ||
    line.includes("@@") ||
    /^\[out\]\s{2,}/.test(line) ||
    /^\[out\]\s[+\-]/.test(line)
  ) {
    return "terminal-line terminal-code";
  }
  return "terminal-line";
}

function terminalText(line: string) {
  return line.replace(/^\[(out|err|sys)\]\s?/, "");
}

function terminalPrefix(line: string) {
  const match = line.match(/^\[(out|err|sys)\]/);
  return match?.[1] ?? "out";
}

function statusTone(status?: ToolStatus) {
  if (!status) return "idle";
  return status.installed ? "ready" : "missing";
}

function grokInspectCount(output: string, label: string) {
  const match = output.match(new RegExp(`${label} \\((\\d+)\\)`));
  return match?.[1] ?? "0";
}

function grokInspectSection(output: string, label: string, limit = 8) {
  const lines = output.split("\n");
  const headings = [
    "Skills",
    "Agents",
    "Plugins",
    "Marketplaces",
    "MCP Servers",
    "Hooks",
    "Config Sources",
    "Permissions",
  ];
  const start = lines.findIndex((line) => line.trim().startsWith(`${label} (`));
  if (start < 0) return [];

  const items: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      if (items.length > 0) break;
      continue;
    }

    if (headings.some((heading) => trimmed.startsWith(`${heading} (`))) break;

    const item = trimmed
      .replace(/^[-•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/\s+/g, " ");
    if (item) items.push(item);
    if (items.length >= limit) break;
  }

  return items;
}

function grokInspectLine(output: string, pattern: RegExp, fallback = "unknown") {
  return output.match(pattern)?.[1]?.trim() ?? fallback;
}

function grokTrust(output: string) {
  const match = output.match(/Project trusted:\s*(yes|no)/i);
  return match?.[1] ?? "unknown";
}

function App() {
  const [mode, setMode] = useState<Mode>(() => {
    const stored = window.localStorage.getItem(storageKeys.mode);
    return stored === "coding" || stored === "standard" ? stored : "coding";
  });
  const [drafts, setDrafts] = useState<Record<Mode, string>>(() => {
    try {
      return {
        ...defaultDrafts,
        ...JSON.parse(window.localStorage.getItem(storageKeys.drafts) ?? "{}"),
      };
    } catch {
      return defaultDrafts;
    }
  });
  const [prompt, setPrompt] = useState(() => {
    const stored = window.localStorage.getItem(storageKeys.mode);
    const initialMode = stored === "coding" || stored === "standard" ? stored : "coding";
    try {
      const storedDrafts = JSON.parse(window.localStorage.getItem(storageKeys.drafts) ?? "{}");
      return storedDrafts[initialMode] ?? defaultDrafts[initialMode];
    } catch {
      return defaultDrafts[initialMode];
    }
  });
  const [browserTask, setBrowserTask] = useState(
    "Open https://example.com and report the main heading.",
  );
  const [codingCwd, setCodingCwd] = useState(
    () => window.localStorage.getItem(storageKeys.codingCwd) ?? "",
  );
  const [shellCommand, setShellCommand] = useState(
    () => {
      const stored = window.localStorage.getItem(storageKeys.shellCommand);
      return stored &&
        stored !== "pwd && git status --short && ls" &&
        stored !== "pwd; git status --short || true; ls"
        ? stored
        : "pwd; git status --short 2>/dev/null || true; ls";
    },
  );
  const [actionPolicy, setActionPolicy] = useState<ActionPolicy>(() => {
    const stored = window.localStorage.getItem(storageKeys.actionPolicy);
    return stored === "review" || stored === "patch" || stored === "autopilot"
      ? stored
      : "patch";
  });
  const [codingWorkflow, setCodingWorkflow] = useState(
    () => window.localStorage.getItem(storageKeys.codingWorkflow) ?? "analyze",
  );
  const [repoPath, setRepoPath] = useState("");
  const [copyText, setCopyText] = useState(true);
  const [chromeBridge, setChromeBridge] = useState<ChromeBridgeState | null>(null);
  const [grokStatus, setGrokStatus] = useState<GrokAuthStatus | null>(null);
  const [chromeExtensionId, setChromeExtensionId] = useState(
    () => window.localStorage.getItem(storageKeys.chromeExtensionId) ?? "",
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem(storageKeys.themeMode);
    const cleanLayoutMigrated = window.localStorage.getItem(storageKeys.cleanLayoutTheme) === "true";
    if (!cleanLayoutMigrated) return "dark";
    return isThemeMode(stored) ? stored : "dark";
  });
  const [statuses, setStatuses] = useState<ToolStatus[]>([]);
  const [lastRun, setLastRun] = useState<ToolRun | null>(() => storedLastRun());
  const [ecosystemRun, setEcosystemRun] = useState<ToolRun | null>(null);
  const [modelsRun, setModelsRun] = useState<ToolRun | null>(null);
  const [mcpRun, setMcpRun] = useState<ToolRun | null>(null);
  const [mcpDoctorRun, setMcpDoctorRun] = useState<ToolRun | null>(null);
  const [pluginsRun, setPluginsRun] = useState<ToolRun | null>(null);
  const [sessionsRun, setSessionsRun] = useState<ToolRun | null>(null);
  const [staticPreview, setStaticPreview] = useState<StaticPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = window.localStorage.getItem(storageKeys.dockPosition);
    return isDockPosition(stored) ? stored : "right";
  });
  const [history, setHistory] = useState<ToolRun[]>(() => storedRunHistory());
  const [messages, setMessages] = useState<ChatMessage[]>(() => storedMessages());
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [busyRunner, setBusyRunner] = useState<Runner | "status" | null>(null);
  const [activeGrokRunId, setActiveGrokRunId] = useState<string | null>(null);
  const [contextBusy, setContextBusy] = useState<"models" | "inspect" | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    const stored = window.localStorage.getItem(storageKeys.inspectorTab);
    return isInspectorTab(stored) ? stored : "skills";
  });
  const [modelPreset, setModelPreset] = useState<GrokModelId>(() => {
    const stored = window.localStorage.getItem(storageKeys.modelPreset);
    return isGrokModelId(stored) ? stored : "grok-build";
  });
  const [customModel, setCustomModel] = useState(
    () => window.localStorage.getItem(storageKeys.customModel) ?? "",
  );
  const safeRuntimeDefaultsMigrated =
    window.localStorage.getItem(storageKeys.safeRuntimeDefaults) === "true";
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(() => {
    const stored = window.localStorage.getItem(storageKeys.effortLevel);
    return safeRuntimeDefaultsMigrated && isEffortLevel(stored) ? stored : "medium";
  });
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(() => {
    const stored = window.localStorage.getItem(storageKeys.reasoningEffort);
    return isReasoningEffort(stored) ? stored : grokModelPresets["grok-build"].defaultReasoning;
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const stored = window.localStorage.getItem(storageKeys.permissionMode);
    return isPermissionMode(stored) ? stored : "default";
  });
  const [bestOfN, setBestOfN] = useState(() => {
    const value = Number(window.localStorage.getItem(storageKeys.bestOfN) ?? "1");
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1;
  });
  const [experimentalMemory, setExperimentalMemory] = useState(
    () => window.localStorage.getItem(storageKeys.experimentalMemory) === "true",
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    () => safeRuntimeDefaultsMigrated && window.localStorage.getItem(storageKeys.webSearchEnabled) === "true",
  );
  const [subagentsEnabled, setSubagentsEnabled] = useState(
    () => safeRuntimeDefaultsMigrated && window.localStorage.getItem(storageKeys.subagentsEnabled) === "true",
  );
  const [selfCheck, setSelfCheck] = useState(
    () => window.localStorage.getItem(storageKeys.selfCheck) === "true",
  );
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const statusMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.id, status])),
    [statuses],
  );
  const activeModel = modelPreset === "custom" ? customModel.trim() || "grok-build" : modelPreset;
  const activeModelMeta = grokModelPresets[modelPreset];
  const activeReasoningLabel =
    reasoningEffort === "off" ? "auto" : reasoningEfforts[reasoningEffort].label;

  function changeModelPreset(nextModel: GrokModelId) {
    setModelPreset(nextModel);
    setReasoningEffort(grokModelPresets[nextModel].defaultReasoning);
  }

  function recordRun(run: ToolRun) {
    setLastRun(run);
    setHistory((current) => [run, ...current].slice(0, 6));
  }

  function appendMessage(message: ChatMessage) {
    setMessages((current) => [...current, message].slice(-120));
  }

  function updateMessage(id: string, mutate: (message: ChatMessage) => ChatMessage) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? mutate(message) : message)),
    );
  }

  function clearRunHistory() {
    setLastRun(null);
    setHistory([]);
    setMessages([]);
    setTerminalLines([]);
    setSessionNotice("Cleared conversation, run history, and terminal.");
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    setDrafts((current) => ({ ...current, [mode]: value }));
  }

  function applyCodingPreset(preset: (typeof codingPresets)[number]) {
    setCodingWorkflow(preset.id);
    updatePrompt(preset.prompt);
  }

  function buildGrokTaskPrompt() {
    if (mode !== "coding") return prompt;

    const workflow = codingPresets.find((preset) => preset.id === codingWorkflow);
    const policy = actionPolicies[actionPolicy];
    return [
      "Grok Desktop Professional Coding Session",
      "",
      `Workflow: ${workflow?.label ?? "Custom"} - ${workflow?.description ?? "User-defined task"}`,
      `Action policy: ${policy.label} - ${policy.detail}`,
      `Model engine: ${activeModel} - ${activeModelMeta.detail}`,
      `Grok effort: ${effortLevels[effortLevel].label} - ${effortLevels[effortLevel].detail}`,
      `Reasoning effort: ${activeReasoningLabel} - ${reasoningEfforts[reasoningEffort].detail}`,
      `Permission mode: ${permissionModes[permissionMode].label} - ${permissionModes[permissionMode].detail}`,
      `Best-of-N: ${bestOfN}`,
      `Experimental memory: ${experimentalMemory ? "enabled" : "off"}`,
      `Web search: ${webSearchEnabled ? "enabled for current docs and version-sensitive facts" : "disabled"}`,
      `Subagents: ${subagentsEnabled ? "enabled" : "disabled"}`,
      `Self-check: ${selfCheck ? "enabled with grok --check" : "disabled"}`,
      `Project path from UI: ${codingCwd.trim() || "default Grok Desktop project root"}`,
      `Grok ecosystem: ${grokInspectCount(ecosystemRun?.output ?? "", "Skills")} skills, ${grokInspectCount(ecosystemRun?.output ?? "", "MCP Servers")} MCP servers, ${grokInspectCount(ecosystemRun?.output ?? "", "Agents")} agents, ${grokInspectCount(ecosystemRun?.output ?? "", "Plugins")} plugins discovered by grok inspect.`,
      "",
      "Professional expectations:",
      "- If the user asks for a simple, short, one-sentence, read-only, or exact-format answer, obey that request directly and skip repository mapping, long reports, and section templates.",
      "- Optimize for a senior programmer who wants high signal and minimal ceremony.",
      "- For repository implementation, review, debugging, or architecture tasks, start with a quick repository map before editing: entry points, likely files, commands, and risk boundaries.",
      "- Prefer exact file paths, exact commands, and concrete implementation details.",
      "- If the user includes this repository's GitHub URL, prefer the selected local working directory over fetching the remote repository unless they explicitly ask for remote state.",
      "- If changing code, keep edits narrow and make verification easy.",
      "- If the request is ambiguous, make the safest useful assumption and state it briefly.",
      "- Use Grok's tools, MCP servers, skills, plugins, hooks, and subagents only when they clearly improve the result; do not start unrelated MCP workflows for ordinary repository analysis.",
      "- When web search is enabled, use it only for unstable/version-sensitive facts and cite sources in the response.",
      "- For hard implementation or debugging, reason privately, then return crisp evidence, changes, and verification.",
      "- For normal coding tasks, use this report format: 1. Summary 2. Files / Evidence 3. Changes or Recommendation 4. Verification commands 5. Next step. For simple tasks, do not use it.",
      "",
      "Task:",
      prompt,
    ].join("\n");
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode || busyRunner !== null) return;
    setMode(nextMode);
    setPrompt(drafts[nextMode] || defaultDrafts[nextMode]);
  }

  async function refreshStatuses() {
    setBusyRunner("status");
    try {
      if (!hasTauriRuntime()) {
        setStatuses(defaultStatuses);
        setLastRun(nativeUnavailable("web preview"));
        return;
      }
      setStatuses(await invoke<ToolStatus[]>("get_tool_statuses"));
    } catch (error) {
      setLastRun({
        ok: false,
        command: "get_tool_statuses",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokAuthStatus() {
    try {
      if (!hasTauriRuntime()) {
        setGrokStatus({
          installed: false,
          authenticated: false,
          apiKeyPresent: false,
          cachedLoginPresent: false,
          configPresent: false,
          version: "",
          detail: "Grok status is available in the Tauri desktop window.",
          loginCommand: "grok login",
          deviceLoginCommand: "grok login --device-auth",
          installCommand: "curl -fsSL https://x.ai/cli/install.sh | bash",
          npmInstallCommand: "npm install -g @xai-official/grok",
          authPath: "~/.grok/auth",
          configPath: "~/.grok/config.toml",
        });
        return;
      }
      setGrokStatus(await invoke<GrokAuthStatus>("get_grok_auth_status"));
    } catch (error) {
      setGrokStatus({
        installed: false,
        authenticated: false,
        apiKeyPresent: false,
        cachedLoginPresent: false,
        configPresent: false,
        version: "",
        detail: error instanceof Error ? error.message : String(error),
        loginCommand: "grok login",
        deviceLoginCommand: "grok login --device-auth",
        installCommand: "curl -fsSL https://x.ai/cli/install.sh | bash",
        npmInstallCommand: "npm install -g @xai-official/grok",
        authPath: "~/.grok/auth",
        configPath: "~/.grok/config.toml",
      });
    }
  }

  async function refreshStaticPreview(openWhenAvailable = false) {
    setPreviewBusy(true);
    try {
      if (!hasTauriRuntime()) {
        setStaticPreview({
          available: false,
          root: codingCwd,
          entryPath: "",
          html: "",
          files: [],
          detail: "Preview is available in the installed Grok Desktop app.",
          updatedAt: Date.now(),
        });
        return;
      }
      const preview = await invoke<StaticPreview>("get_static_preview", { cwd: codingCwd });
      setStaticPreview(preview);
      if (openWhenAvailable && preview.available) {
        setPreviewOpen(true);
      }
    } catch (error) {
      setStaticPreview({
        available: false,
        root: codingCwd,
        entryPath: "",
        html: "",
        files: [],
        detail: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function startGrokLogin(deviceAuth = false) {
    setBusyRunner("grok");
    setTerminalLines([
      `[sys] Opening Terminal for ${deviceAuth ? "device login" : "Grok setup"}.`,
      "[sys] If Grok is missing, Terminal will ask before running the official installer.",
      "[sys] Complete the official authorization, then return here and refresh status.",
    ]);
    try {
      if (!hasTauriRuntime()) {
        const unavailable = nativeUnavailable("grok login");
        setTerminalLines((current) => [...current, `[err] ${unavailable.stderr}`]);
        recordRun(unavailable);
        return;
      }
      const run = await invoke<ToolRun>("start_grok_login", {
        deviceAuth,
        cwd: codingCwd,
      });
      recordRun(run);
      await refreshStaticPreview(true);
      await refreshGrokAuthStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalLines((current) => [...current, `[err] ${message}`]);
      recordRun({
        ok: false,
        command: deviceAuth ? "grok login --device-auth" : "grok login",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: message,
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function cancelGrok() {
    if (!activeGrokRunId) return;
    setTerminalLines((current) => [...current, "[sys] Stopping Grok run..."].slice(-500));
    setMessages((current) =>
      current.map((message) =>
        message.role === "assistant" && message.status === "streaming"
          ? { ...message, status: "stopped" as ChatMessageStatus }
          : message,
      ),
    );
    try {
      const cancelled = await cancelGrokCLI(activeGrokRunId);
      if (!cancelled) {
        setTerminalLines((current) => [...current, "[sys] Grok run already finished or was not registered."].slice(-500));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalLines((current) => [...current, `[err] ${message}`].slice(-500));
    }
  }

  async function runGrok() {
    const userPrompt = prompt.trim();
    if (!userPrompt) return;
    const taskPrompt = buildGrokTaskPrompt();
    updatePrompt("");
    const reasoningFlag = reasoningEffort === "off" ? "" : ` --reasoning-effort ${reasoningEffort}`;
    const permissionFlag = permissionMode === "default" ? "" : ` --permission-mode ${permissionMode}`;
    const bestOfNFlag = bestOfN > 1 ? ` --best-of-n ${bestOfN}` : "";
    const memoryFlag = experimentalMemory ? " --experimental-memory" : "";
    const webFlag = webSearchEnabled ? "" : " --disable-web-search";
    const subagentsFlag = subagentsEnabled ? "" : " --no-subagents";
    const checkFlag = selfCheck ? " --check" : "";
    const maxTurnsFlag = " --max-turns 12";

    const userMessageId = makeId("u");
    const assistantMessageId = makeId("a");
    const now = Date.now();
    appendMessage({
      id: userMessageId,
      role: "user",
      content: userPrompt,
      ts: now,
      meta: { workflow: mode === "coding" ? codingWorkflow : "chat" },
    });
    appendMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      ts: now,
      status: "streaming",
      meta: { model: activeModel, workflow: mode === "coding" ? codingWorkflow : "chat" },
    });

    setBusyRunner("grok");
    setActiveGrokRunId(null);
    setTerminalLines([
      "[sys] Preparing Grok Build CLI.",
      `[sys] Working directory: ${codingCwd.trim() || "project root"}`,
      `[sys] Command mode: grok --model ${activeModel} --effort ${effortLevel}${permissionFlag}${reasoningFlag}${bestOfNFlag}${memoryFlag}${webFlag}${subagentsFlag}${checkFlag}${maxTurnsFlag} -p <prompt>`,
    ]);

    function failAssistant(message: string) {
      updateMessage(assistantMessageId, (current) => ({
        ...current,
        content: current.content || message,
        status: "error",
      }));
    }

    try {
      if (!hasTauriRuntime()) {
        const unavailable = nativeUnavailable("grok -p");
        setTerminalLines((current) => [...current, `[err] ${unavailable.stderr}`]);
        failAssistant(unavailable.stderr);
        recordRun(unavailable);
        return;
      }

      if (grokStatus && (!grokStatus.installed || !grokStatus.authenticated)) {
        const message = !grokStatus.installed
          ? "Grok CLI is not installed yet. Click Connect Grok to install and log in."
          : "Grok CLI is not authenticated. Click Connect Grok or set GROK_CODE_XAI_API_KEY / XAI_API_KEY.";
        setTerminalLines((current) => [...current, `[err] ${message}`]);
        failAssistant(message);
        recordRun({
          ok: false,
          command: "grok -p",
          cwd: codingCwd,
          exit_code: null,
          duration_ms: 0,
          timed_out: false,
          output: "",
          stderr: message,
        });
        return;
      }

      const run = await callGrokCLI(taskPrompt, {
        mode,
        cwd: codingCwd,
        model: activeModel,
        effort: effortLevel,
        reasoningEffort,
        permissionMode,
        bestOfN,
        experimentalMemory,
        webSearchEnabled,
        subagentsEnabled,
        selfCheck,
        onRunId: setActiveGrokRunId,
        onEvent: (event) => {
          setTerminalLines((current) => [...current, formatGrokEvent(event)].slice(-500));
          if (event.stream === "stdout") {
            const incoming = event.line;
            updateMessage(assistantMessageId, (current) => ({
              ...current,
              content: current.content ? `${current.content}\n${incoming}` : incoming,
            }));
          }
        },
      });
      recordRun(run);
      const finalText =
        compactRunPreview(run.output || "").trim() ||
        (run.ok ? "Command finished without output." : compactRunPreview(run.stderr || "")) ||
        "Grok run did not produce output.";
      updateMessage(assistantMessageId, (current) => ({
        ...current,
        content: finalText,
        status: run.ok ? "done" : run.timed_out ? "stopped" : "error",
        meta: {
          ...current.meta,
          durationMs: run.duration_ms,
          exitCode: run.exit_code,
        },
      }));
      await refreshGrokAuthStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalLines((current) => [...current, `[err] ${message}`]);
      failAssistant(message);
      recordRun({
        ok: false,
        command: "grok -p",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: message,
      });
    } finally {
      setActiveGrokRunId(null);
      setBusyRunner(null);
    }
  }

  async function runShell() {
    setBusyRunner("shell");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("zsh -lc"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("run_shell_command", {
          command: shellCommand,
          cwd: codingCwd,
        }),
      );
    } catch (error) {
      recordRun({
        ok: false,
        command: "zsh -lc",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokEcosystem() {
    setContextBusy("inspect");
    try {
      if (!hasTauriRuntime()) {
        setEcosystemRun(nativeUnavailable("grok inspect"));
        return;
      }
      setEcosystemRun(
        await invoke<ToolRun>("inspect_grok_environment", {
          cwd: codingCwd,
        }),
      );
    } catch (error) {
      setEcosystemRun({
        ok: false,
        command: "grok inspect",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContextBusy(null);
    }
  }

  async function refreshGrokModels() {
    setContextBusy("models");
    try {
      if (!hasTauriRuntime()) {
        setModelsRun(nativeUnavailable("grok models"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_models");
      setModelsRun(run);
      const parsed = parseAvailableModels(run.output);
      if (parsed.length > 0) setAvailableModels(parsed);
    } catch (error) {
      setModelsRun({
        ok: false,
        command: "grok models",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContextBusy(null);
    }
  }

  async function pickFolder() {
    if (!hasTauriRuntime()) {
      setSessionNotice("Folder picker is only available in the Tauri desktop window.");
      return;
    }
    setFolderPickerBusy(true);
    try {
      const next = await invoke<string | null>("pick_project_folder", {
        initial: codingCwd || null,
      });
      if (next) {
        setCodingCwd(next);
        setSessionNotice(`Repo set to ${next}.`);
      }
    } catch (error) {
      setSessionNotice(
        `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setFolderPickerBusy(false);
    }
  }

  function togglePanel(target: "preview" | "context" | "terminal" | "tools") {
    const next = !(target === "preview"
      ? previewOpen
      : target === "context"
        ? contextOpen
        : target === "terminal"
          ? terminalOpen
          : toolsOpen);
    setPreviewOpen(target === "preview" ? next : false);
    setContextOpen(target === "context" ? next : false);
    setTerminalOpen(target === "terminal" ? next : false);
    setToolsOpen(target === "tools" ? next : false);
    if (next && target === "preview") void refreshStaticPreview();
  }

  async function refreshGrokMcp() {
    setBusyRunner("mcp");
    try {
      if (!hasTauriRuntime()) {
        setMcpRun(nativeUnavailable("grok mcp list"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_mcp", { cwd: codingCwd });
      setMcpRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok mcp list",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setMcpRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function doctorGrokMcp() {
    setBusyRunner("mcp-doctor");
    try {
      if (!hasTauriRuntime()) {
        setMcpDoctorRun(nativeUnavailable("grok mcp doctor"));
        return;
      }
      const run = await invoke<ToolRun>("doctor_grok_mcp", { cwd: codingCwd });
      setMcpDoctorRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok mcp doctor",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setMcpDoctorRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokPlugins() {
    setBusyRunner("plugins");
    try {
      if (!hasTauriRuntime()) {
        setPluginsRun(nativeUnavailable("grok plugin list"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_plugins", { cwd: codingCwd });
      setPluginsRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok plugin list",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setPluginsRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokSessions() {
    setBusyRunner("sessions");
    try {
      if (!hasTauriRuntime()) {
        setSessionsRun(nativeUnavailable("grok sessions list"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_sessions", { cwd: codingCwd });
      setSessionsRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok sessions list",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setSessionsRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function runBrowser() {
    setBusyRunner("browser");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        setLastRun(nativeUnavailable("browser-use"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("run_browser_task", {
          task: browserTask,
          maxSteps: 10,
        }),
      );
    } catch (error) {
      recordRun({
        ok: false,
        command: "browser-use",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function runAbsorbRepo() {
    setBusyRunner("absorb");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("absorb-repo"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("run_absorb_repo", {
          repoPath,
          copyText,
        }),
      );
    } catch (error) {
      recordRun({
        ok: false,
        command: "absorb-repo",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function runDoctor() {
    setBusyRunner("doctor");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("doctor"));
        return;
      }
      recordRun(await invoke<ToolRun>("run_doctor"));
    } catch (error) {
      recordRun({
        ok: false,
        command: "doctor",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshChromeBridge() {
    try {
      if (!hasTauriRuntime()) {
        setChromeBridge({
          ok: false,
          connected: false,
          hostName: "com.grok.desktop.native",
          statePath: "",
          tabs: [],
          settings: {
            focusGuard: true,
            visibleMotion: true,
            controlledTabsOnly: true,
          },
          lastError: "Chrome bridge state is available in the Tauri desktop window.",
        });
        return;
      }
      setChromeBridge(await invoke<ChromeBridgeState>("get_chrome_bridge_state"));
    } catch (error) {
      setChromeBridge({
        ok: false,
        connected: false,
        hostName: "com.grok.desktop.native",
        statePath: "",
        tabs: [],
        settings: {
          focusGuard: true,
          visibleMotion: true,
          controlledTabsOnly: true,
        },
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function installChromeBridge() {
    setBusyRunner("chrome");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("install-chrome-native-host"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("install_chrome_native_host", {
          extensionId: chromeExtensionId.trim(),
        }),
      );
      await refreshChromeBridge();
    } catch (error) {
      recordRun({
        ok: false,
        command: "install-chrome-native-host",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadDesktopSession() {
      if (!hasTauriRuntime()) {
        setSessionLoaded(true);
        return;
      }

      try {
        const restored = await invoke<SessionState | null>("load_session_state");
        if (cancelled) return;

        if (restored) {
          const restoredDrafts = {
            ...defaultDrafts,
            ...(restored.drafts ?? {}),
          };
          const restoredMode = isMode(restored.mode) ? restored.mode : mode;
          const restoredHistory = Array.isArray(restored.history)
            ? restored.history.filter(isToolRun).slice(0, 6)
            : [];
          const restoredLastRun = isToolRun(restored.lastRun)
            ? restored.lastRun
            : restoredHistory[0] ?? null;
          const shouldClearRestoredPrompt = Boolean(restoredLastRun);
          const nextDrafts = shouldClearRestoredPrompt
            ? { ...restoredDrafts, [restoredMode]: "" }
            : restoredDrafts;

          setDrafts(nextDrafts);
          setMode(restoredMode);
          setPrompt(nextDrafts[restoredMode] ?? defaultDrafts[restoredMode]);
          if (typeof restored.codingCwd === "string") setCodingCwd(restored.codingCwd);
          if (typeof restored.shellCommand === "string") setShellCommand(restored.shellCommand);
          if (isActionPolicy(restored.actionPolicy)) setActionPolicy(restored.actionPolicy);
          if (typeof restored.codingWorkflow === "string") {
            setCodingWorkflow(restored.codingWorkflow);
          }
          if (typeof restored.chromeExtensionId === "string") {
            setChromeExtensionId(restored.chromeExtensionId);
          }
          if (isThemeMode(restored.themeMode)) {
            setThemeMode(restored.themeMode);
          }
          setHistory(restoredHistory);
          setLastRun(restoredLastRun);

          const restoredMessages = Array.isArray(restored.messages)
            ? restored.messages.filter(isChatMessage).slice(-120)
            : [];
          if (restoredMessages.length > 0) {
            const cleaned = restoredMessages.map((message) =>
              message.role === "assistant" && message.status === "streaming"
                ? { ...message, status: "stopped" as ChatMessageStatus }
                : message,
            );
            setMessages(cleaned);
          }

          if (restoredHistory.length > 0 || restoredLastRun || restoredMessages.length > 0) {
            setSessionNotice(
              `Restored ${restoredHistory.length} recent runs and ${restoredMessages.length} chat messages.`,
            );
          }
        }
      } catch (error) {
        if (!cancelled) {
          setSessionNotice(
            `Session restore failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        if (!cancelled) setSessionLoaded(true);
      }
    }

    loadDesktopSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshStatuses();
    refreshChromeBridge();
    refreshGrokAuthStatus();
    refreshStaticPreview();
    refreshGrokModels();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.mode, mode);
  }, [mode]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.drafts, JSON.stringify(drafts));
  }, [drafts]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.chromeExtensionId, chromeExtensionId);
  }, [chromeExtensionId]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.themeMode, themeMode);
    window.localStorage.setItem(storageKeys.cleanLayoutTheme, "true");
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.codingCwd, codingCwd);
  }, [codingCwd]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStaticPreview();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [codingCwd, lastRun?.duration_ms]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.shellCommand, shellCommand);
  }, [shellCommand]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.actionPolicy, actionPolicy);
  }, [actionPolicy]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.codingWorkflow, codingWorkflow);
  }, [codingWorkflow]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.dockPosition, dockPosition);
  }, [dockPosition]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.inspectorTab, inspectorTab);
  }, [inspectorTab]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.modelPreset, modelPreset);
  }, [modelPreset]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.customModel, customModel);
  }, [customModel]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.effortLevel, effortLevel);
  }, [effortLevel]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.reasoningEffort, reasoningEffort);
  }, [reasoningEffort]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.permissionMode, permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.bestOfN, String(bestOfN));
  }, [bestOfN]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.experimentalMemory, String(experimentalMemory));
  }, [experimentalMemory]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.webSearchEnabled, String(webSearchEnabled));
  }, [webSearchEnabled]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.subagentsEnabled, String(subagentsEnabled));
  }, [subagentsEnabled]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.selfCheck, String(selfCheck));
  }, [selfCheck]);

  useEffect(() => {
    const cleanComposerMigrated = window.localStorage.getItem(storageKeys.cleanComposer) === "true";
    if (!cleanComposerMigrated && lastRun) {
      const clearedDrafts = { ...drafts, [mode]: "" };
      setDrafts(clearedDrafts);
      setPrompt("");
      window.localStorage.setItem(storageKeys.drafts, JSON.stringify(clearedDrafts));
    }
    window.localStorage.setItem(storageKeys.safeRuntimeDefaults, "true");
    window.localStorage.setItem(storageKeys.cleanComposer, "true");
  }, [drafts, lastRun, mode]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.runHistory, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.messages, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (lastRun) {
      window.localStorage.setItem(storageKeys.lastRun, JSON.stringify(lastRun));
    } else {
      window.localStorage.removeItem(storageKeys.lastRun);
    }
  }, [lastRun]);

  useEffect(() => {
    if (!sessionLoaded || !hasTauriRuntime()) return;

    const timer = window.setTimeout(() => {
      const state: SessionState = {
        mode,
        drafts,
        codingCwd,
        shellCommand,
        actionPolicy,
        codingWorkflow,
        chromeExtensionId,
        themeMode,
        lastRun,
        history,
        messages,
      };

      invoke<void>("save_session_state", { state }).catch((error) => {
        setSessionNotice(
          `Session save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    actionPolicy,
    chromeExtensionId,
    codingCwd,
    codingWorkflow,
    drafts,
    history,
    lastRun,
    messages,
    mode,
    sessionLoaded,
    shellCommand,
    themeMode,
  ]);

  useEffect(() => {
    const timer = window.setInterval(refreshChromeBridge, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || busyRunner !== null) return;
      if (event.key === "1") {
        event.preventDefault();
        switchMode("standard");
      }
      if (event.key === "2") {
        event.preventDefault();
        switchMode("coding");
      }
      if (event.key === "Enter" && mode === "coding" && prompt.trim()) {
        event.preventDefault();
        runGrok();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busyRunner, drafts, mode]);

  const conversationScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  const [historyFilter, setHistoryFilter] = useState("");
  const recentPrompts = useMemo(() => {
    const all = recentPromptPreviews(messages);
    if (!historyFilter.trim()) return all;
    const needle = historyFilter.trim().toLowerCase();
    return all.filter((item) => item.title.toLowerCase().includes(needle) || item.detail.toLowerCase().includes(needle));
  }, [messages, historyFilter]);

  const modelOptions = useMemo(() => {
    const fromCli = availableModels.filter((value) => value && value !== "models" && value !== "available");
    const declared = Object.keys(grokModelPresets).filter((id) => id !== "custom");
    const merged: string[] = [];
    for (const id of fromCli.length > 0 ? fromCli : declared) {
      if (!merged.includes(id)) merged.push(id);
    }
    if (fromCli.length > 0) {
      for (const id of declared) {
        if (!merged.includes(id)) merged.push(id);
      }
    }
    return merged;
  }, [availableModels]);
  const modelIsVerified = availableModels.length === 0 || availableModels.includes(activeModel) || modelPreset === "custom";

  const currentPolicy = actionPolicies[actionPolicy];
  const grokToolStatus = statusMap.grok;
  const isGrokReady = Boolean(grokStatus?.authenticated);
  const statusLabel = grokStatus?.authenticated
    ? "Connected"
    : grokStatus?.installed
      ? "Login needed"
      : "Connect needed";
  const workspacePath = codingCwd.trim() || "/Users/you/Projects/grok-desktop";
  const visibleRuns = history.length > 0 ? history : lastRun ? [lastRun] : [];
  const previewFiles = staticPreview?.files ?? [];
  const previewReady = Boolean(staticPreview?.available && staticPreview.html.trim());
  const previewEntry = staticPreview?.entryPath
    ? staticPreview.entryPath.split("/").pop() || "index.html"
    : "index.html";
  const terminalDisplay = terminalLines.length > 0
    ? terminalLines
    : formatOutput(lastRun)
        .split("\n")
        .slice(0, 80)
        .map((line) => `[out] ${line}`);
  const inspectOutput = [ecosystemRun?.output, ecosystemRun?.stderr]
    .filter((value) => value && value.trim())
    .join("\n");
  const skillItems = grokInspectSection(inspectOutput, "Skills", 10);
  const agentItems = grokInspectSection(inspectOutput, "Agents", 8);
  const pluginItems = grokInspectSection(inspectOutput, "Plugins", 8);
  const mcpItems = grokInspectSection(inspectOutput, "MCP Servers", 8);
  const hookItems = grokInspectSection(inspectOutput, "Hooks", 8);
  const permissionsSource = grokInspectLine(inspectOutput, /Source:\s*([^\n]+)/i, "not inspected");
  const grokVersion = grokInspectLine(inspectOutput, /Version:\s*([^\n]+)/i, grokStatus?.version || "unknown");
  const assistantPreview =
    busyRunner === "grok"
      ? "Working through the repository. Streaming details are in Terminal."
      : lastRun
        ? compactRunPreview(lastRun.ok ? lastRun.output : lastRun.stderr || lastRun.output) ||
          (lastRun.ok ? "Command finished without output." : "Grok run did not complete.")
        : "Ready to review, implement, test, and verify this repository with Grok.";
  const grokIsRunning = busyRunner === "grok";
  const grokRunBlocked =
    prompt.trim().length === 0 ||
    (mode === "coding" && grokStatus !== null && !grokStatus.authenticated);
  const grokControlDisabled = grokIsRunning
    ? activeGrokRunId === null
    : busyRunner !== null || grokRunBlocked;
  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (grokIsRunning) {
      void cancelGrok();
      return;
    }
    if (!grokControlDisabled) {
      void runGrok();
    }
  }
  return (
    <main className={`app-shell theme-${themeMode}`}>
      <aside className="app-sidebar">
        <div className="mac-lights" aria-hidden="true">
          <span className="red" />
          <span className="yellow" />
          <span className="green" />
        </div>

        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
            <h1>Grok Desktop</h1>
            <span>Grok desktop for engineers</span>
          </div>
          <ChevronDown size={16} />
        </div>

        <section className="nav-section primary-nav" aria-label="Primary navigation">
          <div className="nav-list">
            {primaryNavItems.map((item, index) => (
              <button className={index === 0 ? "active" : ""} key={item.label} type="button">
                {item.label === "New Session" ? <Plus size={16} /> : item.label === "Search" ? <Search size={16} /> : item.label === "Tools" ? <Wrench size={16} /> : <Settings size={16} />}
                <span>{item.label}</span>
                <small>{item.meta}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="nav-section history-nav">
          <div className="nav-head">
            <span>History</span>
            <History size={15} />
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              aria-label="Search history"
              placeholder="Filter recent prompts..."
              onChange={(event) => setHistoryFilter(event.currentTarget.value)}
              value={historyFilter}
            />
          </label>
          <div className="history-list">
            {(recentPrompts.length > 0 ? recentPrompts : placeholderHistory).map((item, index) => {
              const isPlaceholder = recentPrompts.length === 0;
              return (
                <button
                  className={!isPlaceholder && index === 0 ? "active" : ""}
                  disabled={isPlaceholder}
                  key={item.id}
                  onClick={() => {
                    if (isPlaceholder) return;
                    const target = messages.find((message) => message.id === item.id);
                    if (target) updatePrompt(target.content);
                  }}
                  title={isPlaceholder ? "Sample prompt" : "Restore this prompt to the composer"}
                  type="button"
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <time>{item.time || ""}</time>
                </button>
              );
            })}
          </div>
        </section>

        <section className="sidebar-health" aria-label="Tool health">
          <div className="nav-head">
            <span>Health</span>
            <button
              aria-label="Refresh status"
              className="sidebar-icon"
              disabled={busyRunner !== null}
              onClick={refreshStatuses}
              type="button"
            >
              {busyRunner === "status" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            </button>
          </div>
          <div className={`health-pill ${statusTone(grokToolStatus)}`}>
            <Zap size={15} />
            <span>{grokToolStatus?.installed ? "Grok ready" : "Grok missing"}</span>
          </div>
          <button className="doctor-button" disabled={busyRunner !== null} onClick={runDoctor} type="button">
            {busyRunner === "doctor" ? <Loader2 className="spin" size={16} /> : <ClipboardCheck size={16} />}
            <span>Doctor</span>
          </button>
        </section>

        <div className="account-strip">
          <div className="avatar">GD</div>
          <div>
            <strong>Grok Developer</strong>
            <span>Local workspace</span>
          </div>
          <Settings size={16} />
        </div>
      </aside>

      <section className={`workspace dock-${dockPosition}`}>
        <header className="window-titlebar">
          <div className="repo-controls">
            <label className="repo-picker">
              <FolderGit2 size={16} />
              <span>Repo</span>
              <input
                aria-label="Project path"
                onChange={(event) => setCodingCwd(event.currentTarget.value)}
                value={codingCwd}
                placeholder="Click the folder button to pick a project"
              />
              <button
                aria-label="Pick project folder"
                className="repo-pick-button"
                disabled={folderPickerBusy}
                onClick={pickFolder}
                title="Open folder picker"
                type="button"
              >
                {folderPickerBusy ? <Loader2 className="spin" size={15} /> : <FolderDown size={15} />}
              </button>
            </label>
            <label className="model-chip" title={modelIsVerified ? "Grok model" : "Model not in grok CLI list — may fall back to default"}>
              <Sparkles size={15} />
              <select
                aria-label="Grok model"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (isGrokModelId(value)) {
                    changeModelPreset(value);
                  } else {
                    setModelPreset("custom");
                    setCustomModel(value);
                    setReasoningEffort(grokModelPresets.custom.defaultReasoning);
                  }
                }}
                value={modelPreset === "custom" ? "custom" : modelPreset}
              >
                {modelOptions.map((id) => {
                  const verified = availableModels.length === 0 || availableModels.includes(id);
                  return (
                    <option key={id} value={id}>
                      {id}
                      {verified ? "" : " (not in CLI)"}
                    </option>
                  );
                })}
                <option value="custom">Custom...</option>
              </select>
              {!modelIsVerified ? <CircleAlert size={13} /> : null}
            </label>
          </div>
          <div className="title-center">
            <span>Grok Code</span>
            <small>{grokVersion}</small>
          </div>
          <div className="top-actions">
            <button
              aria-pressed={previewOpen}
              className={`panel-toggle ${previewOpen ? "active" : ""}`}
              onClick={() => togglePanel("preview")}
              type="button"
            >
              <Globe2 size={15} />
              <span>Preview</span>
            </button>
            <button
              aria-pressed={contextOpen}
              className={`panel-toggle ${contextOpen ? "active" : ""}`}
              onClick={() => togglePanel("context")}
              type="button"
            >
              <PanelRight size={15} />
              <span>Context</span>
            </button>
            <button
              aria-pressed={terminalOpen}
              className={`panel-toggle ${terminalOpen ? "active" : ""}`}
              onClick={() => togglePanel("terminal")}
              type="button"
            >
              <SquareTerminal size={15} />
              <span>Terminal</span>
            </button>
            <button
              aria-pressed={toolsOpen}
              className={`panel-toggle ${toolsOpen ? "active" : ""}`}
              onClick={() => togglePanel("tools")}
              type="button"
            >
              <Wrench size={15} />
              <span>Tools</span>
            </button>
            <label className="dock-select">
              <PanelRight size={14} />
              <select
                aria-label="Dock position"
                onChange={(event) => setDockPosition(event.currentTarget.value as DockPosition)}
                value={dockPosition}
              >
                <option value="right">Right</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <div className="theme-switch" aria-label="Theme">
              <button
                aria-pressed={themeMode === "dark"}
                className={themeMode === "dark" ? "active" : ""}
                onClick={() => setThemeMode("dark")}
                type="button"
              >
                <Moon size={14} />
                <span>Dark</span>
              </button>
              <button
                aria-pressed={themeMode === "light"}
                className={themeMode === "light" ? "active" : ""}
                onClick={() => setThemeMode("light")}
                type="button"
              >
                <Sun size={14} />
                <span>Light</span>
              </button>
            </div>
            <span className={`connection-pill ${isGrokReady ? "ready" : "blocked"}`}>
              {isGrokReady ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
              {statusLabel}
            </span>
            <button
              className="primary-run"
              disabled={grokControlDisabled}
              onClick={grokIsRunning ? cancelGrok : runGrok}
              type="button"
            >
              {grokIsRunning ? <X size={17} /> : <Play size={17} />}
              <span>{grokIsRunning ? "Stop" : mode === "coding" ? "Run Grok" : "Ask Grok"}</span>
            </button>
          </div>
        </header>

        <section className="workbench">
          <div className="conversation-panel">
            <div className="conversation-scroll" ref={conversationScrollRef}>
              {messages.length === 0 ? (
                <article className="message assistant-message">
                  <div className="message-avatar grok-avatar">
                    <Bot size={18} />
                  </div>
                  <div className="message-body">
                    <div className="message-meta">
                      <strong>Grok Code <span>({activeModel})</span></strong>
                      <time>ready</time>
                    </div>
                    <p>{assistantPreview}</p>
                    <div className="empty-hints">
                      <span>Try Analyze, Implement, Review, Debug, Tests, or Refactor from the composer.</span>
                      <span>Press Enter to send · Shift+Enter for newline · ⌘1/⌘2 to switch · ⌘Enter to run.</span>
                    </div>
                  </div>
                </article>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === "user";
                  const showSpinner = message.status === "streaming";
                  return (
                    <article
                      className={`message ${isUser ? "user-message" : "assistant-message"} ${message.status ? `status-${message.status}` : ""}`}
                      key={message.id}
                    >
                      <div className={`message-avatar ${isUser ? "user-avatar" : "grok-avatar"}`}>
                        {isUser ? <span>You</span> : <Bot size={18} />}
                      </div>
                      <div className="message-body">
                        <div className="message-meta">
                          <strong>
                            {isUser ? "You" : "Grok"}
                            {!isUser && message.meta?.model ? <span>({message.meta.model})</span> : null}
                            {!isUser && message.meta?.workflow ? <small className="message-workflow">{message.meta.workflow}</small> : null}
                          </strong>
                          <time>
                            {showSpinner ? (
                              <Loader2 className="spin" size={13} />
                            ) : message.meta?.durationMs ? (
                              `${(message.meta.durationMs / 1000).toFixed(1)}s`
                            ) : (
                              timeLabel(message.ts)
                            )}
                          </time>
                        </div>
                        <p>{message.content || (showSpinner ? "Working..." : "(no output)")}</p>
                        {message.role === "assistant" && message.status === "error" ? (
                          <div className="message-error">Run failed{message.meta?.exitCode != null ? ` (exit ${message.meta.exitCode})` : ""}.</div>
                        ) : null}
                        {message.role === "assistant" && message.status === "stopped" ? (
                          <div className="message-error">Stopped by user.</div>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="composer">
              <textarea
                id="main-prompt"
                onKeyDown={handlePromptKeyDown}
                onChange={(event) => updatePrompt(event.currentTarget.value)}
                placeholder={modeCopy[mode].placeholder}
                rows={1}
                value={prompt}
                autoFocus
              />
              <div className="composer-footer">
                <select
                  aria-label="Interaction mode"
                  className="mode-select"
                  onChange={(event) => switchMode(event.currentTarget.value as Mode)}
                  value={mode}
                >
                  {(Object.keys(modeCopy) as Mode[]).map((item) => (
                    <option key={item} value={item}>
                      {modeCopy[item].title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Coding workflow"
                  className="workflow-select"
                  onChange={(event) => {
                    const preset = codingPresets.find((item) => item.id === event.currentTarget.value);
                    if (preset) applyCodingPreset(preset);
                  }}
                  value={codingWorkflow}
                >
                  {codingPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Action policy"
                  onChange={(event) => setActionPolicy(event.currentTarget.value as ActionPolicy)}
                  value={actionPolicy}
                >
                  {(Object.keys(actionPolicies) as ActionPolicy[]).map((policy) => (
                    <option key={policy} value={policy}>
                      {actionPolicies[policy].label}
                    </option>
                  ))}
                </select>
                <span className="composer-hint" aria-hidden="true">
                  ↵ Send · ⇧↵ Newline · ⌘↵ Force
                </span>
                <button
                  className="mini-run"
                  disabled={grokControlDisabled}
                  onClick={grokIsRunning ? cancelGrok : runGrok}
                  type="button"
                  title={grokIsRunning ? "Stop run" : "Send to Grok (Enter)"}
                >
                  {grokIsRunning ? <X size={16} /> : <Play size={16} />}
                </button>
              </div>
            </div>
          </div>

          <aside
            aria-hidden={!previewOpen}
            className={`preview-panel preview-drawer ${previewOpen ? "open" : ""}`}
            aria-label="Generated preview"
          >
            <div className="preview-head">
              <div>
                <Globe2 size={16} />
                <strong>Preview</strong>
                <span>{previewReady ? previewEntry : "waiting for index.html"}</span>
              </div>
              <div className="preview-actions">
                <button
                  aria-label="Refresh preview"
                  disabled={previewBusy}
                  onClick={() => refreshStaticPreview()}
                  type="button"
                >
                  {previewBusy ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                </button>
                <button aria-label="Close preview" onClick={() => setPreviewOpen(false)} type="button">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="preview-frame-wrap">
              {previewReady ? (
                <iframe
                  sandbox="allow-forms allow-popups allow-scripts"
                  srcDoc={staticPreview?.html}
                  title="Generated static site preview"
                />
              ) : (
                <div className="preview-empty">
                  <FileText size={22} />
                  <strong>No static preview yet</strong>
                  <span>{staticPreview?.detail ?? "Ask Grok to create index.html, then the result appears here."}</span>
                </div>
              )}
            </div>
            <div className="preview-files">
              {previewFiles.length > 0 ? (
                previewFiles.slice(0, 6).map((file) => (
                  <span key={file.path}>
                    <FileText size={13} />
                    <span>{file.name}</span>
                    <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                  </span>
                ))
              ) : (
                <span>
                  <FileText size={13} />
                  <span>No files in project root</span>
                </span>
              )}
            </div>
          </aside>

          <details
            className="inspector-drawer"
            onToggle={(event) => {
              if (event.currentTarget.open && !contextOpen) togglePanel("context");
              else if (!event.currentTarget.open && contextOpen) setContextOpen(false);
            }}
            open={contextOpen}
          >
            <summary>
              <span><PanelRight size={16} /> Context and tools</span>
              <small>
                {grokInspectCount(inspectOutput, "Skills")} skills · {grokInspectCount(inspectOutput, "MCP Servers")} MCP · {grokInspectCount(inspectOutput, "Agents")} agents
              </small>
            </summary>
          <aside className="inspector" aria-label="Grok context">
            <div className="inspector-tabs" role="tablist" aria-label="Grok capability inspector">
              {inspectorTabs.map((tab) => (
                <button
                  aria-pressed={inspectorTab === tab.id}
                  className={inspectorTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setInspectorTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
              <button aria-label="Panel options" type="button"><PanelRight size={16} /></button>
              <button aria-label="Close inspector" type="button"><X size={16} /></button>
            </div>

            <div className="inspector-body">
              {inspectorTab === "context" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Model</span>
                      <button disabled={contextBusy !== null} onClick={refreshGrokModels} type="button">
                        {contextBusy === "models" ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
                      </button>
                    </div>
                    <div className="model-select">
                      <Sparkles size={16} />
                      <strong>{activeModel}</strong>
                      <ShieldCheck size={15} />
                    </div>
                    <p>{activeModelMeta.detail}. Grok Desktop tunes the CLI with model, agent effort, reasoning effort, permissions, memory, web search, subagents, repo path, and ecosystem context.</p>
                    <div className="engine-grid">
                      <label>
                        <span>Model</span>
                        <select
                          aria-label="Grok model preset"
                          onChange={(event) => changeModelPreset(event.currentTarget.value as GrokModelId)}
                          value={modelPreset}
                        >
                          {(Object.keys(grokModelPresets) as GrokModelId[]).map((model) => (
                            <option key={model} value={model}>
                              {grokModelPresets[model].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Agent effort</span>
                        <select
                          aria-label="Agent effort"
                          onChange={(event) => setEffortLevel(event.currentTarget.value as EffortLevel)}
                          value={effortLevel}
                        >
                          {(Object.keys(effortLevels) as EffortLevel[]).map((effort) => (
                            <option key={effort} value={effort}>
                              {effortLevels[effort].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Reasoning</span>
                        <select
                          aria-label="Reasoning effort"
                          onChange={(event) => setReasoningEffort(event.currentTarget.value as ReasoningEffort)}
                          value={reasoningEffort}
                        >
                          {(Object.keys(reasoningEfforts) as ReasoningEffort[]).map((effort) => (
                            <option key={effort} value={effort}>
                              {reasoningEfforts[effort].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Best-of-N</span>
                        <select
                          aria-label="Best of N"
                          onChange={(event) => setBestOfN(Number(event.currentTarget.value))}
                          value={bestOfN}
                        >
                          {[1, 2, 3, 4, 5].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Permission</span>
                        <select
                          aria-label="Permission mode"
                          onChange={(event) => setPermissionMode(event.currentTarget.value as PermissionMode)}
                          value={permissionMode}
                        >
                          {(Object.keys(permissionModes) as PermissionMode[]).map((permission) => (
                            <option key={permission} value={permission}>
                              {permissionModes[permission].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {modelPreset === "custom" ? (
                        <label className="engine-wide">
                          <span>Custom ID</span>
                          <input
                            aria-label="Custom Grok model ID"
                            onChange={(event) => setCustomModel(event.currentTarget.value)}
                            placeholder="grok-build"
                            value={customModel}
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="toggle-row">
                      <label>
                        <input
                          checked={experimentalMemory}
                          onChange={(event) => setExperimentalMemory(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Memory</span>
                      </label>
                      <label>
                        <input
                          checked={webSearchEnabled}
                          onChange={(event) => setWebSearchEnabled(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Web</span>
                      </label>
                      <label>
                        <input
                          checked={subagentsEnabled}
                          onChange={(event) => setSubagentsEnabled(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Subagents</span>
                      </label>
                      <label>
                        <input
                          checked={selfCheck}
                          onChange={(event) => setSelfCheck(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Check</span>
                      </label>
                    </div>
                    <div className="auth-actions">
                      <button disabled={busyRunner !== null} onClick={() => startGrokLogin(false)} type="button">
                        <Zap size={15} />
                        Connect
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busyRunner !== null || !grokStatus?.installed}
                        onClick={() => startGrokLogin(true)}
                        type="button"
                      >
                        <TerminalSquare size={15} />
                        Device
                      </button>
                      <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshGrokAuthStatus} type="button">
                        <RefreshCcw size={15} />
                        Refresh
                      </button>
                    </div>
                    {modelsRun ? <pre className="mini-output">{formatOutput(modelsRun)}</pre> : null}
                  </section>

                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Repo</span>
                      <code>{grokTrust(inspectOutput)}</code>
                    </div>
                    <div className="repo-readout">
                      <FolderGit2 size={16} />
                      <span>{workspacePath}</span>
                      <MoreHorizontal size={16} />
                    </div>
                    <div className="branch-readout">
                      <GitBranch size={15} />
                      <span>main</span>
                      <small>local workspace</small>
                    </div>
                    <div className="metric-grid">
                      <div>
                        <strong>{grokInspectCount(inspectOutput, "Skills")}</strong>
                        <span>Skills</span>
                      </div>
                      <div>
                        <strong>{grokInspectCount(inspectOutput, "MCP Servers")}</strong>
                        <span>MCP</span>
                      </div>
                      <div>
                        <strong>{grokInspectCount(inspectOutput, "Agents")}</strong>
                        <span>Agents</span>
                      </div>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={contextBusy !== null}
                      onClick={refreshGrokEcosystem}
                      type="button"
                    >
                      {contextBusy === "inspect" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      Inspect Grok
                    </button>
                  </section>

                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Context Files</span>
                      <code>{contextFiles.length}</code>
                    </div>
                    <div className="file-list">
                      {contextFiles.map((file) => (
                        <span key={file}>
                          <FileText size={14} />
                          {file}
                        </span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "skills" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Skills</span>
                      <code>{grokInspectCount(inspectOutput, "Skills")} discovered</code>
                    </div>
                    <p>Grok inspect reads Claude-compatible skill sources and plugin skills, then Grok Desktop adds the best matches to the coding prompt.</p>
                    <button
                      className="secondary-button"
                      disabled={contextBusy !== null}
                      onClick={refreshGrokEcosystem}
                      type="button"
                    >
                      {contextBusy === "inspect" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      Refresh Skills
                    </button>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(skillItems.length ? skillItems : ["Run Inspect Grok to load available skills."]).map((item) => (
                        <span key={item}><Sparkles size={14} /> {item}</span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "mcp" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>MCP</span>
                      <code>{grokInspectCount(inspectOutput, "MCP Servers")} discovered</code>
                    </div>
                    <p>Shows servers discovered by Grok inspect and the active managed list from `grok mcp list`.</p>
                    <div className="auth-actions">
                      <button disabled={busyRunner !== null} onClick={refreshGrokMcp} type="button">
                        {busyRunner === "mcp" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                        List MCP
                      </button>
                      <button className="secondary-button" disabled={busyRunner !== null} onClick={doctorGrokMcp} type="button">
                        {busyRunner === "mcp-doctor" ? <Loader2 className="spin" size={15} /> : <ClipboardCheck size={15} />}
                        Doctor
                      </button>
                    </div>
                  </section>
                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Discovered Servers</span>
                      <code>{mcpItems.length}</code>
                    </div>
                    <div className="capability-list">
                      {(mcpItems.length ? mcpItems : ["No inspect data yet."]).map((item) => (
                        <span key={item}><Wrench size={14} /> {item}</span>
                      ))}
                    </div>
                    {mcpRun ? <pre className="mini-output">{formatOutput(mcpRun)}</pre> : null}
                    {mcpDoctorRun ? <pre className="mini-output">{formatOutput(mcpDoctorRun)}</pre> : null}
                  </section>
                </>
              ) : null}

              {inspectorTab === "agents" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Agents</span>
                      <code>{grokInspectCount(inspectOutput, "Agents")} available</code>
                    </div>
                    <p>Agent metadata helps route repo analysis, review, debugging, browser, and design tasks to the right Grok sub-capability.</p>
                    <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshGrokSessions} type="button">
                      {busyRunner === "sessions" ? <Loader2 className="spin" size={15} /> : <History size={15} />}
                      Sessions
                    </button>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(agentItems.length ? agentItems : ["Run Inspect Grok to load agents."]).map((item) => (
                        <span key={item}><Bot size={14} /> {item}</span>
                      ))}
                    </div>
                    {sessionsRun ? <pre className="mini-output">{formatOutput(sessionsRun)}</pre> : null}
                  </section>
                </>
              ) : null}

              {inspectorTab === "plugins" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Plugins</span>
                      <code>{grokInspectCount(inspectOutput, "Plugins")} discovered</code>
                    </div>
                    <p>Grok Desktop separates discovered plugins from the active managed list so developers can see what Grok can use versus what it owns.</p>
                    <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshGrokPlugins} type="button">
                      {busyRunner === "plugins" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      List Plugins
                    </button>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(pluginItems.length ? pluginItems : ["Run Inspect Grok to load plugins."]).map((item) => (
                        <span key={item}><Layers3 size={14} /> {item}</span>
                      ))}
                    </div>
                    {pluginsRun ? <pre className="mini-output">{formatOutput(pluginsRun)}</pre> : null}
                  </section>
                </>
              ) : null}

              {inspectorTab === "hooks" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Hooks</span>
                      <code>{grokInspectCount(inspectOutput, "Hooks")} loaded</code>
                    </div>
                    <p>Hooks are surfaced as first-class context because they change how Grok behaves before and after tool work.</p>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(hookItems.length ? hookItems : ["Run Inspect Grok to load hooks."]).map((item) => (
                        <span key={item}><Zap size={14} /> {item}</span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "permissions" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Approvals</span>
                      <code>{permissionsSource}</code>
                    </div>
                    <div className="approval-select">
                      <ShieldCheck size={16} />
                      <select
                        aria-label="Approval policy"
                        onChange={(event) => setActionPolicy(event.currentTarget.value as ActionPolicy)}
                        value={actionPolicy}
                      >
                        {(Object.keys(actionPolicies) as ActionPolicy[]).map((policy) => (
                          <option key={policy} value={policy}>
                            {actionPolicies[policy].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p>{currentPolicy.detail}</p>
                  </section>
                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Grok Optimization</span>
                      <code>{effortLevels[effortLevel].label}</code>
                    </div>
                    <div className="safety-list">
                      {grokOptimizationRules.map((rule) => (
                        <span key={rule}><ShieldCheck size={14} /> {rule}</span>
                      ))}
                      <span><ShieldCheck size={14} /> Model: {activeModel}</span>
                      <span><ShieldCheck size={14} /> Permission mode: {permissionModes[permissionMode].label}</span>
                      <span><ShieldCheck size={14} /> Reasoning: {activeReasoningLabel}</span>
                      <span><ShieldCheck size={14} /> Web search: {webSearchEnabled ? "enabled" : "disabled"}</span>
                      <span><ShieldCheck size={14} /> Subagents: {subagentsEnabled ? "enabled" : "disabled"}</span>
                      <span><ShieldCheck size={14} /> Self-check: {selfCheck ? "enabled" : "off"}</span>
                    </div>
                  </section>
                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Command History</span>
                      <button
                        aria-label="Clear run history"
                        disabled={history.length === 0 && !lastRun}
                        onClick={clearRunHistory}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="command-history">
                      {visibleRuns.length > 0 ? (
                        visibleRuns.slice(0, 5).map((run, index) => (
                          <button key={`${run.command}-${index}`} onClick={() => setLastRun(run)} type="button">
                            {run.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                            <span>{run.command}</span>
                            <small>{run.exit_code ?? "n/a"}</small>
                          </button>
                        ))
                      ) : (
                        <p>No runs yet.</p>
                      )}
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          </aside>
          </details>
        </section>

        <details
          className="terminal-dock"
          onToggle={(event) => {
            if (event.currentTarget.open && !terminalOpen) togglePanel("terminal");
            else if (!event.currentTarget.open && terminalOpen) setTerminalOpen(false);
          }}
          open={terminalOpen}
        >
          <summary className="terminal-summary">
            <span>
              <SquareTerminal size={16} />
              <strong>Terminal</strong>
              <small className={busyRunner ? "running" : ""}>{busyRunner ? "Running" : "Idle"}</small>
            </span>
            <span>
              <button
                aria-label="Dock terminal right"
                className={dockPosition === "right" ? "dock-dot active" : "dock-dot"}
                onClick={(event) => {
                  event.preventDefault();
                  setDockPosition("right");
                }}
                type="button"
              >
                Right
              </button>
              <button
                aria-label="Dock terminal bottom"
                className={dockPosition === "bottom" ? "dock-dot active" : "dock-dot"}
                onClick={(event) => {
                  event.preventDefault();
                  setDockPosition("bottom");
                }}
                type="button"
              >
                Bottom
              </button>
              <small>{terminalDisplay.length} lines</small>
            </span>
          </summary>
          <div className="terminal-head">
            <div>
              <SquareTerminal size={17} />
              <strong>Terminal</strong>
              <span className={busyRunner ? "running" : ""}>{busyRunner ? "Running" : "Idle"}</span>
            </div>
            <div className="terminal-actions">
              <label>
                <TerminalSquare size={15} />
                <input
                  aria-label="Shell command"
                  onChange={(event) => setShellCommand(event.currentTarget.value)}
                  value={shellCommand}
                />
              </label>
              <button
                disabled={busyRunner !== null || shellCommand.trim().length === 0}
                onClick={runShell}
                type="button"
              >
                {busyRunner === "shell" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                Run
              </button>
            </div>
          </div>
          {sessionNotice ? <p className="session-note">{sessionNotice}</p> : null}
          <div className="terminal-view" role="log" aria-live="polite">
            {terminalDisplay.map((line, index) => (
              <div className={terminalClass(line)} key={`${line}-${index}`}>
                <span className="terminal-prefix">{terminalPrefix(line)}</span>
                <span>{terminalText(line)}</span>
              </div>
            ))}
          </div>
        </details>

        <details
          className="toolbelt"
          aria-label="Developer tools"
          onToggle={(event) => {
            if (event.currentTarget.open && !toolsOpen) togglePanel("tools");
            else if (!event.currentTarget.open && toolsOpen) setToolsOpen(false);
          }}
          open={toolsOpen}
        >
          <summary>
            <span><Wrench size={16} /> Developer utilities</span>
            <small>Browser, Chrome bridge, Absorb Repo</small>
          </summary>
          <div className="toolbelt-grid">
          <div className="tool-card">
            <div className="tool-title">
              <Globe2 size={17} />
              <span>Browser</span>
            </div>
            <input
              aria-label="Browser task"
              onChange={(event) => setBrowserTask(event.currentTarget.value)}
              value={browserTask}
            />
            <button disabled={busyRunner !== null || browserTask.trim().length === 0} onClick={runBrowser} type="button">
              {busyRunner === "browser" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Run
            </button>
          </div>

          <div className="tool-card">
            <div className="tool-title">
              <ClipboardCheck size={17} />
              <span>Chrome Agent</span>
            </div>
            <span className={`bridge-pill ${chromeBridge?.connected ? "connected" : "offline"}`}>
              {chromeBridge?.connected ? "bridge live" : "bridge offline"}
            </span>
            <input
              aria-label="Chrome extension ID"
              onChange={(event) => setChromeExtensionId(event.currentTarget.value)}
              placeholder="Chrome extension ID"
              value={chromeExtensionId}
            />
            <button
              disabled={busyRunner !== null || chromeExtensionId.trim().length === 0}
              onClick={installChromeBridge}
              type="button"
            >
              {busyRunner === "chrome" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Install
            </button>
            <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshChromeBridge} type="button">
              <RefreshCcw size={16} />
              Refresh
            </button>
            <small>{(chromeBridge?.tabs ?? []).length} tabs · {formatBridgeAge(chromeBridge?.updatedAt)}</small>
            {(chromeBridge?.tabs ?? []).slice(0, 2).map((tab) => (
              <span className="tab-chip" key={tab.id}>{tab.title || snapshotLead(tab)}</span>
            ))}
          </div>

          <div className="tool-card">
            <div className="tool-title">
              <FolderDown size={17} />
              <span>Absorb Repo</span>
            </div>
            <input
              aria-label="Repository path"
              onChange={(event) => setRepoPath(event.currentTarget.value)}
              placeholder="/path/to/repo"
              value={repoPath}
            />
            <label className="checkline">
              <input
                checked={copyText}
                onChange={(event) => setCopyText(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>copy text</span>
            </label>
            <button disabled={busyRunner !== null || repoPath.trim().length === 0} onClick={runAbsorbRepo} type="button">
              {busyRunner === "absorb" ? <Loader2 className="spin" size={16} /> : <Wrench size={16} />}
              Absorb
            </button>
          </div>
          </div>
        </details>

        <footer className="workspace-statusbar" aria-label="Workspace status">
          <div className="status-cluster">
            <FolderGit2 size={13} />
            <span className="status-cwd" title={workspacePath}>{workspacePath}</span>
          </div>
          <div className="status-cluster">
            <Sparkles size={13} />
            <span>{activeModel}</span>
            {!modelIsVerified ? <span className="status-warn">unverified</span> : null}
          </div>
          <div className="status-cluster">
            <ShieldCheck size={13} />
            <span>{actionPolicies[actionPolicy].label}</span>
          </div>
          <div className="status-cluster">
            {grokIsRunning ? <Loader2 className="spin" size={13} /> : lastRun?.ok ? <CheckCircle2 size={13} /> : lastRun ? <CircleAlert size={13} /> : <Zap size={13} />}
            <span>
              {grokIsRunning
                ? "Running"
                : lastRun
                  ? `${lastRun.ok ? "Last run ok" : "Last run failed"} · ${(lastRun.duration_ms / 1000).toFixed(1)}s`
                  : isGrokReady
                    ? "Idle · ready"
                    : statusLabel}
            </span>
          </div>
          <div className="status-cluster status-right">
            <History size={13} />
            <span>{history.length} runs</span>
            <button
              className="status-clear"
              disabled={messages.length === 0 && history.length === 0}
              onClick={clearRunHistory}
              type="button"
              title="Clear conversation, run history, and terminal"
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

export default App;
