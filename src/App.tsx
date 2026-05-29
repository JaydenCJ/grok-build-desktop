import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BookmarkPlus,
  Bot,
  ChevronDown,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Copy,
  CornerUpLeft,
  FileText,
  FolderDown,
  FolderGit2,
  FolderInput,
  FolderPlus,
  GitBranch,
  GitFork,
  Globe2,
  History,
  Layers3,
  Loader2,
  Moon,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Play,
  Sun,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { upsertPrompt } from "./lib/prompts";
import "./App.css";
import { cancelRun } from "./lib/grok";
import { streamStore } from "./lib/streamStore";
import { MessageList, type MessageRef } from "./components/MessageList";
import { Composer, type ComposerHandle } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { QueueDock } from "./components/QueueDock";
import { AgentOverlayDriver } from "./components/AgentOverlayDriver";
import { defaultTabName, makeTab, type Tab, type TabMessage } from "./lib/tabs";
import { DesktopPanel } from "./components/DesktopPanel";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { SettingsPage } from "./components/SettingsPage";
import { ToolsPage } from "./components/ToolsPage";
import { ContextMenu, type ContextMenuState, type ContextMenuItem } from "./components/ContextMenu";
import { useActiveRun } from "./hooks/useActiveRun";

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
type ActionPolicy = "review" | "plan" | "patch" | "autopilot";
type InspectorTab = "context" | "skills" | "mcp" | "agents" | "plugins" | "hooks" | "permissions" | "desktop";
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
  runId?: string;
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
  // History-organization (keyed by prompt/message id):
  historyPinned: "grok-desktop-history-pinned-v1",
  historyLabels: "grok-desktop-history-labels-v1",
  historyGroups: "grok-desktop-history-groups-v1",
  historyArchived: "grok-desktop-history-archived-v1",
  historyDeleted: "grok-desktop-history-deleted-v1",
};

// Small localStorage helpers for the history-organization maps/sets.
function loadIdSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}
function loadIdMap(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(key);
    const obj = raw ? (JSON.parse(raw) as unknown) : {};
    return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

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

const actionPolicies: Record<
  ActionPolicy,
  { label: string; detail: string; risk: "none" | "low" | "high" }
> = {
  review: {
    label: "Review only",
    detail: "Read, reason, propose. No file edits unless asked.",
    risk: "none",
  },
  plan: {
    label: "Plan",
    detail: "Grok presents a plan first and waits — runs with --permission-mode plan, no edits until you approve.",
    risk: "none",
  },
  patch: {
    label: "Patch ready",
    detail: "Produce exact changes and apply narrow safe edits with normal approvals.",
    risk: "low",
  },
  autopilot: {
    label: "Autopilot",
    detail: "Auto-approves every tool call (--always-approve). Grok can edit files and run commands without asking. Use only in a sandbox or disposable checkout.",
    risk: "high",
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
  { id: "desktop", label: "Desktop" },
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
type HistoryRow = HistoryPreview & { pinned: boolean; group: string | null; archived: boolean };

function recentPromptPreviews(messages: ChatMessage[]): HistoryPreview[] {
  const userMessages = messages.filter((message) => message.role === "user");
  const recent = userMessages.slice(-60).reverse();
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
  return (
    value === "review" ||
    value === "plan" ||
    value === "patch" ||
    value === "autopilot"
  );
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
  // The textarea lives inside Composer (uncontrolled ref). We hold a
  // ComposerHandle so starter cards / history clicks / drafts can seed it.
  const composerRef = useRef<ComposerHandle | null>(null);
  const setComposerValue = (value: string) => {
    composerRef.current?.setValue(value);
  };
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
  // Developer-utilities <details> (Browser / Chrome bridge / Absorb Repo).
  // Independent from `toolsOpen` so the inspector and the toolbelt don't both
  // pop open at once and stack on top of each other in the right column.
  const [toolbeltOpen, setToolbeltOpen] = useState(false);
  // ⌘K command palette — global, lives outside the panel-toggle group above.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Dedicated Settings page (Claude-Desktop-style modal). settingsSection
  // selects which left-nav panel is shown.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<"general" | "model" | "permissions" | "integrations" | "about">("general");
  // Dedicated Tools / MCP hub (community-tool integration).
  const [toolsPageOpen, setToolsPageOpen] = useState(false);
  // App-owned right-click menu (replaces the suppressed WebView menu).
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // History organization — pin / rename / group / archive / delete, persisted
  // by prompt id so the right-click actions survive restarts and have a
  // visible effect in the list (no decorative no-ops).
  const [pinnedPromptIds, setPinnedPromptIds] = useState<Set<string>>(() => loadIdSet(storageKeys.historyPinned));
  const [promptLabels, setPromptLabels] = useState<Record<string, string>>(() => loadIdMap(storageKeys.historyLabels));
  const [promptGroups, setPromptGroups] = useState<Record<string, string>>(() => loadIdMap(storageKeys.historyGroups));
  const [archivedPromptIds, setArchivedPromptIds] = useState<Set<string>>(() => loadIdSet(storageKeys.historyArchived));
  const [deletedPromptIds, setDeletedPromptIds] = useState<Set<string>>(() => loadIdSet(storageKeys.historyDeleted));
  const [showArchived, setShowArchived] = useState(false);
  // Inline editing for a history row: rename (custom label) or new-group entry.
  const [rowEdit, setRowEdit] = useState<{ id: string; mode: "rename" | "newgroup" } | null>(null);
  // Transient toast for actions without an obvious list change (copy/save).
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  useEffect(() => {
    if (!historyNote) return;
    const t = window.setTimeout(() => setHistoryNote(null), 1700);
    return () => window.clearTimeout(t);
  }, [historyNote]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyPinned, JSON.stringify([...pinnedPromptIds]));
  }, [pinnedPromptIds]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyLabels, JSON.stringify(promptLabels));
  }, [promptLabels]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyGroups, JSON.stringify(promptGroups));
  }, [promptGroups]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyArchived, JSON.stringify([...archivedPromptIds]));
  }, [archivedPromptIds]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyDeleted, JSON.stringify([...deletedPromptIds]));
  }, [deletedPromptIds]);
  // Sidebar collapse for ⌘B — defaults to expanded.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return window.localStorage.getItem("grok-desktop-sidebar-collapsed") === "1";
  });
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = window.localStorage.getItem(storageKeys.dockPosition);
    return isDockPosition(stored) ? stored : "right";
  });
  const [history, setHistory] = useState<ToolRun[]>(() => storedRunHistory());
  const [totalRuns, setTotalRuns] = useState<number>(() => {
    const stored = Number.parseInt(window.localStorage.getItem("grok-desktop-run-count-total") ?? "", 10);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return storedRunHistory().length;
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => storedMessages());
  // Multi-session tabs. The "active" tab's cwd and messages are mirrored back
  // into the existing flat state above so the rest of App.tsx (model picker,
  // mode dock, status bar, etc.) keeps working unchanged. Tabs are a thin
  // facade — see comment in lib/tabs.ts for the design rationale.
  const tabsStorageKey = "grok-desktop-tabs-v1";
  const tabsActiveKey = "grok-desktop-tabs-active-v1";
  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const raw = window.localStorage.getItem(tabsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Tab[];
      }
    } catch {
      // fall through
    }
    // First-run: synthesize one tab from the legacy single-session state.
    const initialCwd = window.localStorage.getItem(storageKeys.codingCwd) ?? "";
    return [makeTab(initialCwd, storedMessages() as unknown as TabMessage[], defaultTabName(initialCwd, 0))];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const stored = window.localStorage.getItem(tabsActiveKey);
    if (stored) return stored;
    // Use the first tab's id from initial setup above.
    try {
      const raw = window.localStorage.getItem(tabsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed[0]?.id) return parsed[0].id;
      }
    } catch {
      // fall through
    }
    return "";
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [busyRunner, setBusyRunner] = useState<Runner | "status" | null>(null);
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
    setTotalRuns((current) => {
      const next = current + 1;
      window.localStorage.setItem("grok-desktop-run-count-total", String(next));
      return next;
    });
  }

  function appendMessage(message: ChatMessage) {
    setMessages((current) => [...current, message].slice(-120));
  }

  function clearRunHistory() {
    setLastRun(null);
    setHistory([]);
    setMessages([]);
    setTerminalLines([]);
    setTotalRuns(0);
    window.localStorage.setItem("grok-desktop-run-count-total", "0");
    setSessionNotice("Cleared conversation, run history, and terminal.");
  }

  // ── Multi-session tabs ───────────────────────────────────────────────────
  // Tabs are a *facade* — the active tab's cwd/messages mirror to the flat
  // state above, so the rest of App.tsx is unaware. See lib/tabs.ts.
  function handleTabCreate() {
    // Persist current tab first.
    setTabs((current) => {
      const snapshotted = current.map((t) =>
        t.id === activeTabId
          ? { ...t, cwd: codingCwd, messages: messages as unknown as TabMessage[] }
          : t,
      );
      const next = makeTab("", [], defaultTabName("", snapshotted.length));
      return [...snapshotted, next];
    });
    // The new tab id is generated inside the setter; pull it out via a
    // microtask so the state update has committed.
    queueMicrotask(() => {
      setTabs((current) => {
        const newest = current[current.length - 1];
        if (newest) {
          setActiveTabId(newest.id);
          setCodingCwd(newest.cwd);
          setMessages(newest.messages as unknown as ChatMessage[]);
        }
        return current;
      });
      // "Clean slate" — Claude-Desktop-style. Wipe the composer draft, any
      // leftover banner / notice, and the last-run card. The user opened a
      // new session because they wanted a *fresh* surface.
      setDrafts({ standard: "", coding: "" });
      composerRef.current?.setValue("");
      setSessionNotice(null);
      setLastRun(null);
    });
  }
  // Persist tabs (and the active id) whenever the array changes. This is the
  // single source of truth across reloads; localStorage hydrates on next boot.
  useEffect(() => {
    try {
      window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
    } catch {
      // quota or serialization error — non-fatal; in-memory state survives.
    }
  }, [tabs]);
  useEffect(() => {
    if (activeTabId) window.localStorage.setItem(tabsActiveKey, activeTabId);
  }, [activeTabId]);

  // Whenever the global codingCwd or messages change, write them back into
  // the active tab. This keeps the tab "in sync" with the flat state without
  // requiring every existing setMessages/setCodingCwd call-site to know about
  // tabs.
  useEffect(() => {
    setTabs((current) =>
      current.map((t) =>
        t.id === activeTabId
          ? { ...t, cwd: codingCwd, messages: messages as unknown as TabMessage[] }
          : t,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codingCwd, messages]);

  function updatePrompt(value: string) {
    setComposerValue(value);
    setDrafts((current) => ({ ...current, [mode]: value }));
  }

  // Find a prompt's text by message id across the active conversation and all
  // stored sessions (history aggregates across sessions).
  function findPromptText(id: string): string | null {
    const inActive = messages.find((m) => m.id === id);
    if (inActive) return inActive.content;
    for (const t of tabs) {
      const hit = (t.messages as unknown as ChatMessage[]).find((m) => m.id === id);
      if (hit) return hit.content;
    }
    return null;
  }

  // ---- History row actions: all persisted, each with a visible effect ----
  function togglePinPrompt(id: string) {
    setPinnedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleArchivePrompt(id: string) {
    setArchivedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Archiving implies leaving the Pinned section.
    setPinnedPromptIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
  function deletePromptEntry(id: string) {
    setDeletedPromptIds((prev) => new Set(prev).add(id));
    setPinnedPromptIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setArchivedPromptIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setPromptLabels((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPromptGroups((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function setPromptGroupId(id: string, group: string | null) {
    setPromptGroups((prev) => {
      const next = { ...prev };
      if (group && group.trim()) next[id] = group.trim();
      else delete next[id];
      return next;
    });
  }
  function startRename(id: string) {
    setContextMenu(null);
    setRowEdit({ id, mode: "rename" });
  }
  function startNewGroup(id: string) {
    setContextMenu(null);
    setRowEdit({ id, mode: "newgroup" });
  }
  function commitRowEdit(value: string) {
    const edit = rowEdit;
    setRowEdit(null);
    if (!edit) return;
    const v = value.trim();
    if (edit.mode === "rename") {
      setPromptLabels((prev) => {
        const next = { ...prev };
        if (v) next[edit.id] = v;
        else delete next[edit.id];
        return next;
      });
    } else if (v) {
      setPromptGroupId(edit.id, v);
    }
  }
  function forkPrompt(id: string) {
    const text = findPromptText(id);
    handleTabCreate();
    if (text) updatePrompt(text);
    composerRef.current?.focus();
  }
  async function savePromptToLibrary(id: string) {
    const text = findPromptText(id);
    if (!text) return;
    const name = (promptLabels[id] ?? text.split("\n").find(Boolean) ?? "Saved prompt").slice(0, 60);
    try {
      await upsertPrompt({ name, body: text, category: "History" });
      setHistoryNote("Saved to Prompt Library");
    } catch {
      setHistoryNote("Couldn't save — Prompt Library unavailable");
    }
  }

  // Claude-class right-click menu for a history row. Section header, icons,
  // shortcut accelerators, two flyout submenus (Open with / Move to group).
  function openHistoryMenu(e: React.MouseEvent, item: HistoryPreview) {
    e.preventDefault();
    const id = item.id;
    const text = findPromptText(id) ?? item.title;
    const pinned = pinnedPromptIds.has(id);
    const archived = archivedPromptIds.has(id);
    const currentGroup = promptGroups[id] ?? null;
    const groupNames = Array.from(new Set(Object.values(promptGroups))).sort((a, b) => a.localeCompare(b));

    const groupSubmenu: ContextMenuItem[] = [
      { label: "New group…", icon: <FolderPlus size={15} />, onClick: () => startNewGroup(id) },
      ...(groupNames.length ? [{ label: "Move to", header: true } as ContextMenuItem] : []),
      ...groupNames.map((g) => ({
        label: currentGroup === g ? `${g}  ✓` : g,
        icon: <FolderInput size={15} />,
        onClick: () => setPromptGroupId(id, currentGroup === g ? null : g),
      })),
      ...(currentGroup
        ? [{ label: "Remove from group", separator: true, icon: <X size={15} />, onClick: () => setPromptGroupId(id, null) }]
        : []),
    ];

    const items: ContextMenuItem[] = [
      { label: item.title.length > 34 ? `${item.title.slice(0, 34)}…` : item.title, header: true },
      {
        label: "Open with",
        icon: <CornerUpLeft size={15} />,
        shortcut: "O",
        submenu: [
          { label: "Restore to composer", icon: <CornerUpLeft size={15} />, onClick: () => updatePrompt(text) },
          { label: "Open in new session", icon: <GitFork size={15} />, onClick: () => forkPrompt(id) },
        ],
      },
      {
        label: "Copy prompt",
        icon: <Copy size={15} />,
        shortcut: "⌘C",
        onClick: () => {
          void navigator.clipboard?.writeText(text);
          setHistoryNote("Copied");
        },
      },
      { label: "Save to Prompt Library", icon: <BookmarkPlus size={15} />, onClick: () => void savePromptToLibrary(id) },
      {
        label: pinned ? "Unpin" : "Pin to top",
        icon: pinned ? <PinOff size={15} /> : <Pin size={15} />,
        shortcut: "P",
        separator: true,
        onClick: () => togglePinPrompt(id),
      },
      { label: "Rename…", icon: <Pencil size={15} />, shortcut: "R", onClick: () => startRename(id) },
      { label: "Move to group", icon: <FolderInput size={15} />, shortcut: "G", submenu: groupSubmenu },
      {
        label: archived ? "Unarchive" : "Archive",
        icon: archived ? <ArchiveRestore size={15} /> : <Archive size={15} />,
        shortcut: "A",
        onClick: () => toggleArchivePrompt(id),
      },
      { label: "Delete", icon: <Trash2 size={15} />, shortcut: "⌫", danger: true, separator: true, onClick: () => deletePromptEntry(id) },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  // Right-click menu for the conversation area — real, clickable actions
  // (replaces the suppressed WebView menu). Selection-aware.
  function openConversationMenu(e: React.MouseEvent) {
    e.preventDefault();
    const selection = window.getSelection()?.toString().trim() ?? "";
    const items: ContextMenuItem[] = [];
    if (selection) {
      items.push({
        label: "Copy",
        onClick: () => void navigator.clipboard?.writeText(selection),
      });
    }
    items.push(
      {
        label: "New session",
        separator: selection.length > 0,
        onClick: () => {
          handleTabCreate();
          composerRef.current?.focus();
        },
      },
      {
        label: "Clear conversation",
        disabled: messages.length === 0,
        onClick: () => clearRunHistory(),
      },
      ...(grokIsRunning && activeRunId
        ? [{ label: "Stop current run", danger: true, onClick: () => void cancelRun(activeRunId) }]
        : []),
      { label: "Settings…", separator: true, onClick: () => setSettingsOpen(true) },
    );
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  function applyCodingPreset(preset: (typeof codingPresets)[number]) {
    setCodingWorkflow(preset.id);
    updatePrompt(preset.prompt);
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode || busyRunner !== null) return;
    setMode(nextMode);
    setComposerValue(drafts[nextMode] || defaultDrafts[nextMode]);
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

  function buildGrokArgs(): string[] {
    const args: string[] = ["--no-alt-screen", "--output-format", "streaming-json"];
    if (activeModel) args.push("--model", activeModel);
    if (effortLevel) args.push("--effort", effortLevel);
    if (reasoningEffort && reasoningEffort !== "off") {
      args.push("--reasoning-effort", reasoningEffort);
    }
    // Action policy → REAL grok permission behavior (was previously prompt-only).
    //   review   → no permission flag (the preamble asks Grok to stay read-only)
    //   plan     → --permission-mode plan  (Grok plans, doesn't edit, waits)
    //   patch    → respect the advanced permission-mode override, else default
    //   autopilot→ --always-approve  (auto-approves EVERY tool call — risky)
    if (actionPolicy === "plan") {
      args.push("--permission-mode", "plan");
    } else if (actionPolicy === "autopilot") {
      args.push("--always-approve");
    } else if (permissionMode && permissionMode !== "default") {
      args.push("--permission-mode", permissionMode);
    }
    if (bestOfN > 1) args.push("--best-of-n", String(bestOfN));
    if (experimentalMemory) args.push("--experimental-memory");
    if (!webSearchEnabled) args.push("--disable-web-search");
    if (!subagentsEnabled) args.push("--no-subagents");
    if (selfCheck) args.push("--check");
    args.push("--max-turns", "12");
    if (mode === "coding" && codingCwd.trim()) {
      args.push("--cwd", codingCwd.trim());
    }
    // Auto-continue the current cwd's session when the conversation already
    // has messages (the user is following up, not starting fresh). This is
    // what Claude Desktop / Codex do — there's only ever one composer, and
    // the second message in a conversation implicitly continues the first.
    if (messages.length > 0) {
      args.push("-c");
    }
    return args;
  }

  // Wraps the raw user prompt with a coding-session preamble in coding mode.
  // Chat mode passes through unchanged.
  function buildPromptWithPreamble(raw: string): string {
    if (mode !== "coding") return raw;
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
      "- Optimize for a senior programmer who wants high signal and minimal ceremony.",
      "- Start with a quick repository map before editing: entry points, likely files, commands, and risk boundaries.",
      "- Prefer exact file paths, exact commands, and concrete implementation details.",
      "- If changing code, keep edits narrow and make verification easy.",
      "- If the request is ambiguous, make the safest useful assumption and state it briefly.",
      "- Use Grok's tools, MCP servers, skills, plugins, hooks, and subagents when they clearly improve the result.",
      "- When web search is enabled, use it only for unstable/version-sensitive facts and cite sources in the response.",
      "- For hard implementation or debugging, reason privately, then return crisp evidence, changes, and verification.",
      "",
      "Task:",
      raw,
    ].join("\n");
  }

  function handleEnqueued(info: { runId: string; position: number; prompt: string; rawText?: string }) {
    const now = Date.now();
    const userMessageId = makeId("u");
    const assistantMessageId = makeId("a");
    appendMessage({
      id: userMessageId,
      role: "user",
      // Show what the user ACTUALLY typed, not the wrapped prompt. In coding
      // mode buildPromptWithPreamble prepends a long "Professional Coding
      // Session" preamble for grok's benefit — that belongs in the request,
      // not in the chat bubble. rawText is the clean original; fall back to
      // prompt only for callers that don't pass it.
      content: info.rawText ?? info.prompt,
      ts: now,
      meta: { workflow: mode === "coding" ? codingWorkflow : "chat" },
    });
    appendMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      ts: now,
      runId: info.runId,
      status: "streaming",
      meta: { model: activeModel, workflow: mode === "coding" ? codingWorkflow : "chat" },
    });
    setTotalRuns((current) => {
      const next = current + 1;
      window.localStorage.setItem("grok-desktop-run-count-total", String(next));
      return next;
    });
    if (info.position > 0) {
      console.log(`[grok-desktop] queued at position ${info.position}`);
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

  // Top-right "panels" menu — Preview / Context / Terminal / Tools, each opens
  // its panel (Claude-style). A ✓ marks the currently-open panel. Anchored
  // under the button.
  function openPanelMenu(e: React.MouseEvent) {
    e.preventDefault();
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      x: Math.round(b.right),
      y: Math.round(b.bottom + 6),
      items: [
        { label: "Preview", icon: <Globe2 size={15} />, shortcut: previewOpen ? "✓" : undefined, onClick: () => togglePanel("preview") },
        { label: "Context inspector", icon: <PanelRight size={15} />, shortcut: contextOpen ? "✓" : undefined, onClick: () => togglePanel("context") },
        { label: "Terminal", icon: <TerminalSquare size={15} />, shortcut: terminalOpen ? "✓" : undefined, onClick: () => togglePanel("terminal") },
        { label: "Tools & MCP", icon: <Wrench size={15} />, separator: true, onClick: () => setToolsPageOpen(true) },
      ],
    });
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
          setComposerValue(nextDrafts[restoredMode] ?? defaultDrafts[restoredMode]);
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

          const effectiveMessageCount = Math.max(restoredMessages.length, storedMessages().length);
          if (restoredHistory.length > 0 || restoredLastRun || effectiveMessageCount > 0) {
            const runWord = restoredHistory.length === 1 ? "run" : "runs";
            const messagePart =
              effectiveMessageCount > 0
                ? `, ${effectiveMessageCount} chat message${effectiveMessageCount === 1 ? "" : "s"}`
                : "";
            setSessionNotice(`Restored ${restoredHistory.length} recent ${runWord}${messagePart}.`);
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
    const timer = setTimeout(() => {
      window.localStorage.setItem(storageKeys.drafts, JSON.stringify(drafts));
    }, 250);
    return () => clearTimeout(timer);
  }, [drafts]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.chromeExtensionId, chromeExtensionId);
  }, [chromeExtensionId]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.themeMode, themeMode);
    window.localStorage.setItem(storageKeys.cleanLayoutTheme, "true");
    // CRITICAL: drive the `data-theme` attribute, not just the `theme-*`
    // className. The legacy palette (--app-bg, --panel, …) flips via the
    // `.app-shell.theme-light` class, but the v0.4.0 mono tokens
    // (--bg-0..5, --text-1..4, used by TabBar / CommandPalette / FilePicker /
    // TraceTimeline) flip via the `[data-theme="light"]` attribute selector.
    // Without this line the new components stay dark in light mode — that's
    // what produced the black block behind the tab strip.
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  // Persist sidebar-collapsed state so ⌘B is sticky across reloads.
  useEffect(() => {
    window.localStorage.setItem(
      "grok-desktop-sidebar-collapsed",
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);

  // ── Command palette catalogue ────────────────────────────────────────────
  // Every action here is reachable both through ⌘K and (where applicable) a
  // direct button in the UI. Keep them in sync — adding an action here is
  // the cheapest way to make a new feature discoverable.
  const paletteActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        id: "new-session",
        label: "New session",
        hint: "Empty messages, fresh cwd",
        shortcut: "⌘N",
        group: "Session",
        run: () => handleTabCreate(),
      },
      {
        id: "clear-conversation",
        label: "Clear current conversation",
        hint: "Wipes messages + run history",
        group: "Session",
        run: () => clearRunHistory(),
      },
      {
        id: "focus-composer",
        label: "Focus composer",
        shortcut: "/",
        group: "Navigation",
        run: () => composerRef.current?.focus(),
      },
      {
        id: "search-history",
        label: "Search recent prompts",
        shortcut: "⌘F",
        group: "Navigation",
        run: () => {
          historySearchInputRef.current?.focus();
          historySearchInputRef.current?.select();
        },
      },
      {
        id: "toggle-sidebar",
        label: sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
        shortcut: "⌘B",
        group: "View",
        run: () => setSidebarCollapsed((v) => !v),
      },
      {
        id: "open-tools",
        label: "Open Tools & MCP",
        group: "View",
        run: () => setToolsPageOpen(true),
      },
      {
        id: "toggle-inspector",
        label: toolsOpen ? "Close Context inspector" : "Open Context inspector (advanced)",
        group: "View",
        run: () => togglePanel("tools"),
      },
      {
        id: "toggle-preview",
        label: previewOpen ? "Close Preview" : "Open Preview",
        group: "View",
        run: () => togglePanel("preview"),
      },
      {
        id: "toggle-context",
        label: contextOpen ? "Close Context inspector" : "Open Context inspector",
        group: "View",
        run: () => togglePanel("context"),
      },
      {
        id: "toggle-terminal",
        label: terminalOpen ? "Close Terminal panel" : "Open Terminal panel",
        group: "View",
        run: () => togglePanel("terminal"),
      },
      {
        id: "toggle-theme",
        label: themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme",
        shortcut: "⌘⇧L",
        group: "Theme",
        run: () => setThemeMode(themeMode === "dark" ? "light" : "dark"),
      },
      {
        id: "open-desktop-bridge",
        label: "Open Desktop bridge",
        hint: "Mac app context queries",
        group: "View",
        run: () => {
          setToolsOpen(true);
          setInspectorTab("desktop");
        },
      },
      {
        id: "open-settings",
        label: "Open Settings",
        shortcut: "⌘,",
        group: "View",
        run: () => setSettingsOpen(true),
      },
      {
        id: "cancel-run",
        label: "Cancel current run",
        group: "Run",
        run: () => {
          // Read activeRunId via streamStore at action-fire time — the value
          // declared further down the component isn't in scope here yet, and
          // listing it as a dep would create a TDZ error during render.
          const snap = streamStore.getActiveRunSnapshot();
          if (snap?.id) void cancelRun(snap.id);
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarCollapsed, toolsOpen, terminalOpen, themeMode, previewOpen, contextOpen]);

  // Global keyboard router — only fires while the palette isn't already in a
  // text-input state. Each shortcut is also surfaced via the palette so users
  // can discover them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (meta && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      } else if (meta && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setThemeMode((t) => (t === "dark" ? "light" : "dark"));
      } else if (meta && e.key.toLowerCase() === "n" && !e.shiftKey) {
        // Don't steal the system "New Window" shortcut if the user is in a
        // textarea (composer). Only act when focus is elsewhere.
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag !== "textarea" && tag !== "input") {
          e.preventDefault();
          handleTabCreate();
        }
      } else if (e.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen]);

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
      setComposerValue("");
      window.localStorage.setItem(storageKeys.drafts, JSON.stringify(clearedDrafts));
    }
    window.localStorage.setItem(storageKeys.safeRuntimeDefaults, "true");
    window.localStorage.setItem(storageKeys.cleanComposer, "true");
  }, [drafts, lastRun, mode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.localStorage.setItem(storageKeys.runHistory, JSON.stringify(history));
    }, 300);
    return () => clearTimeout(timer);
  }, [history]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.localStorage.setItem(storageKeys.messages, JSON.stringify(messages));
    }, 300);
    return () => clearTimeout(timer);
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
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busyRunner, drafts, mode]);

  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    const onScroll = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 80;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const node = conversationScrollRef.current;
    if (!node) return;
    if (stickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  const [historyFilter, setHistoryFilter] = useState("");
  const historySearchInputRef = useRef<HTMLInputElement | null>(null);
  const recentPrompts = useMemo(() => {
    // Aggregate prompts across ALL sessions (not just the active tab) so that
    // creating a New Session never makes the history list look "wiped" — the
    // user's earlier conversations stay visible regardless of which tab is
    // open. Active tab uses live `messages`; others use their stored copy.
    const everyMessage = tabs
      .flatMap((t) =>
        (t.id === activeTabId
          ? (messages as unknown as TabMessage[])
          : t.messages) ?? [],
      )
      .slice()
      .sort((a, b) => ((a as { ts?: number }).ts ?? 0) - ((b as { ts?: number }).ts ?? 0));
    const base = recentPromptPreviews(everyMessage as unknown as ChatMessage[]);
    const rows: HistoryRow[] = base
      .filter((p) => !deletedPromptIds.has(p.id))
      .map((p) => ({
        ...p,
        title: promptLabels[p.id] ?? p.title,
        pinned: pinnedPromptIds.has(p.id),
        group: promptGroups[p.id] ?? null,
        archived: archivedPromptIds.has(p.id),
      }));
    if (!historyFilter.trim()) return rows;
    const needle = historyFilter.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.detail.toLowerCase().includes(needle) ||
        (r.group ?? "").toLowerCase().includes(needle),
    );
  }, [
    tabs,
    activeTabId,
    messages,
    historyFilter,
    pinnedPromptIds,
    promptLabels,
    promptGroups,
    deletedPromptIds,
    archivedPromptIds,
  ]);

  // Partition the (filtered) rows into Pinned / named groups / Recent /
  // Archived sections for a Claude-style organized list.
  const historyView = useMemo(() => {
    const live = recentPrompts.filter((r) => !r.archived);
    const archived = recentPrompts.filter((r) => r.archived);
    const pinned = live.filter((r) => r.pinned);
    const groupMap = new Map<string, HistoryRow[]>();
    const ungrouped: HistoryRow[] = [];
    for (const r of live) {
      if (r.pinned) continue;
      if (r.group) {
        const arr = groupMap.get(r.group) ?? [];
        arr.push(r);
        groupMap.set(r.group, arr);
      } else {
        ungrouped.push(r);
      }
    }
    const groups = Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { pinned, groups, ungrouped, archived };
  }, [recentPrompts]);

  // Make ⌘K Search actually search the user's WORK, not just commands: each
  // recent prompt becomes a searchable palette entry that restores it to the
  // composer. (Search previously only filtered the command list, so typing a
  // topic keyword found nothing — "search doesn't work".)
  const historyPaletteActions = useMemo<PaletteAction[]>(
    () =>
      recentPrompts.slice(0, 50).map((p) => ({
        id: `history-${p.id}`,
        label: p.title,
        hint: p.detail ? `History · ${p.detail}` : "History",
        group: "History",
        run: () => {
          const text = findPromptText(p.id);
          if (text) updatePrompt(text);
        },
      })),
    [recentPrompts],
  );
  const allPaletteActions = useMemo(
    () => [...paletteActions, ...historyPaletteActions],
    [paletteActions, historyPaletteActions],
  );

  // One history row — inline rename/new-group input when being edited,
  // otherwise a click-to-restore / right-click-for-actions button.
  function renderHistoryRow(item: HistoryRow) {
    if (rowEdit?.id === item.id) {
      return (
        <div className="history-rename" key={item.id}>
          <input
            autoFocus
            defaultValue={rowEdit.mode === "rename" ? item.title : ""}
            placeholder={rowEdit.mode === "rename" ? "Rename prompt" : "New group name"}
            aria-label={rowEdit.mode === "rename" ? "Rename prompt" : "New group name"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRowEdit(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRowEdit(null);
              }
            }}
            onBlur={(e) => commitRowEdit(e.currentTarget.value)}
          />
        </div>
      );
    }
    return (
      <button
        className={`history-row${item.pinned ? " pinned" : ""}`}
        key={item.id}
        onClick={() => {
          const text = findPromptText(item.id);
          if (text) updatePrompt(text);
        }}
        onContextMenu={(e) => openHistoryMenu(e, item)}
        title="Click to restore · right-click for actions"
        type="button"
      >
        <span className="history-row-main">
          <strong>
            {item.pinned ? <Pin size={11} className="pin-dot" /> : null}
            {item.title}
          </strong>
          <small>{item.detail}</small>
        </span>
        <time>{item.time || ""}</time>
      </button>
    );
  }

  // Project name shown in the minimal top bar (basename of the cwd).
  const repoName = useMemo(() => {
    const trimmed = codingCwd.trim().replace(/\/+$/, "");
    if (!trimmed) return "Pick a project";
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || trimmed;
  }, [codingCwd]);

  const modelOptions = useMemo(() => {
    const fromCli = availableModels.filter((value) => value && value !== "models" && value !== "available");
    const declared = Object.keys(grokModelPresets).filter((id) => id !== "custom");
    // Mode-aware model list.
    //   CODE mode  → lock to the Grok Build coding agent(s) the CLI actually
    //                reports. grok-4.3 et al. are chat/reasoning models that
    //                can't drive Grok Build's coding loop, so they must NOT be
    //                pickable here (that was the failing case).
    //   CHAT mode  → free choice: every preset (grok-4.3, grok-latest, …) so
    //                you can pick a reasoning model for product thinking.
    if (mode === "coding") {
      return fromCli.length > 0 ? fromCli : ["grok-build"];
    }
    // Chat: union of CLI-reported + declared presets, CLI ones first.
    const merged: string[] = [];
    for (const id of [...fromCli, ...declared]) {
      if (!merged.includes(id)) merged.push(id);
    }
    return merged;
  }, [availableModels, mode]);
  const modelIsVerified = availableModels.length === 0 || availableModels.includes(activeModel) || modelPreset === "custom";

  // Only auto-snap in CODE mode, where the list is intentionally restricted —
  // if a stale grok-4.3 selection lingers there, jump to the coding agent.
  // Chat mode leaves the user's pick alone.
  useEffect(() => {
    if (mode !== "coding") return;
    if (availableModels.length === 0) return; // CLI didn't report — leave as-is
    if (modelPreset === "custom") return;
    if (modelOptions.includes(modelPreset)) return;
    const fallback = modelOptions[0];
    if (!fallback) return;
    if (isGrokModelId(fallback)) changeModelPreset(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, availableModels, modelOptions, modelPreset]);

  const currentPolicy = actionPolicies[actionPolicy];
  const grokToolStatus = statusMap.grok;
  const isGrokReady = Boolean(grokStatus?.authenticated);
  const statusLabel = grokStatus?.authenticated
    ? "Connected"
    : grokStatus?.installed
      ? "Login needed"
      : "Connect needed";
  const workspacePath = codingCwd.trim() || "No project selected";
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
  const inspectOutput = useMemo(
    () =>
      [ecosystemRun?.output, ecosystemRun?.stderr]
        .filter((value) => value && value.trim())
        .join("\n"),
    [ecosystemRun?.output, ecosystemRun?.stderr],
  );
  const inspectSummary = useMemo(
    () => ({
      skillItems: grokInspectSection(inspectOutput, "Skills", 10),
      agentItems: grokInspectSection(inspectOutput, "Agents", 8),
      pluginItems: grokInspectSection(inspectOutput, "Plugins", 8),
      mcpItems: grokInspectSection(inspectOutput, "MCP Servers", 8),
      hookItems: grokInspectSection(inspectOutput, "Hooks", 8),
      permissionsSource: grokInspectLine(inspectOutput, /Source:\s*([^\n]+)/i, "not inspected"),
    }),
    [inspectOutput],
  );
  const { skillItems, agentItems, pluginItems, mcpItems, hookItems, permissionsSource } = inspectSummary;
  const activeRun = useActiveRun();
  const grokIsRunning = Boolean(activeRun && activeRun.state === "running");
  const activeRunId = activeRun?.id ?? null;

  const messageRefs: MessageRef[] = useMemo(
    () =>
      messages.map((m) =>
        m.role === "user"
          ? { runId: "", role: "user" as const, userText: m.content }
          : {
              // Live runs keep their real id; restored/legacy assistant
              // messages get a STABLE synthetic id (msg:<id>) so MessageItem
              // can key their worker-rendered markdown HTML and they don't all
              // collide on "". fallbackText still feeds the worker + the
              // plain-text fallback while parsing.
              runId: m.runId || `msg:${m.id}`,
              role: "assistant" as const,
              fallbackText: m.content,
            },
      ),
    [messages],
  );
  return (
    <main
      className={`app-shell theme-${themeMode}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
    >
      <CommandPalette
        open={paletteOpen}
        actions={allPaletteActions}
        onClose={() => setPaletteOpen(false)}
      />
      <SettingsPage
        open={settingsOpen}
        section={settingsSection}
        onSection={setSettingsSection}
        onClose={() => setSettingsOpen(false)}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        dockPosition={dockPosition}
        setDockPosition={(d) => {
          setDockPosition(d);
          window.localStorage.setItem(storageKeys.dockPosition, d);
        }}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        modelOptions={modelOptions.map((id) => ({
          value: id,
          label: grokModelPresets[id as GrokModelId]?.label ?? id,
        }))}
        modelPreset={modelPreset}
        onModelPreset={(id) => changeModelPreset(id as GrokModelId)}
        customModel={customModel}
        setCustomModel={setCustomModel}
        activeModel={activeModel}
        effortOptions={(Object.keys(effortLevels) as EffortLevel[]).map((k) => ({
          value: k,
          label: effortLevels[k].label,
        }))}
        effortLevel={effortLevel}
        setEffortLevel={(v) => setEffortLevel(v as EffortLevel)}
        reasoningOptions={(Object.keys(reasoningEfforts) as ReasoningEffort[]).map((k) => ({
          value: k,
          label: reasoningEfforts[k].label,
        }))}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={(v) => setReasoningEffort(v as ReasoningEffort)}
        bestOfN={bestOfN}
        setBestOfN={setBestOfN}
        experimentalMemory={experimentalMemory}
        setExperimentalMemory={setExperimentalMemory}
        actionPolicyOptions={(Object.keys(actionPolicies) as ActionPolicy[]).map((k) => ({
          value: k,
          label: actionPolicies[k].label,
          detail: actionPolicies[k].detail,
          risk: actionPolicies[k].risk,
        }))}
        actionPolicy={actionPolicy}
        setActionPolicy={(v) => setActionPolicy(v as ActionPolicy)}
        permissionOptions={(Object.keys(permissionModes) as PermissionMode[]).map((k) => ({
          value: k,
          label: permissionModes[k].label,
        }))}
        permissionMode={permissionMode}
        setPermissionMode={(v) => setPermissionMode(v as PermissionMode)}
        webSearchEnabled={webSearchEnabled}
        setWebSearchEnabled={setWebSearchEnabled}
        subagentsEnabled={subagentsEnabled}
        setSubagentsEnabled={setSubagentsEnabled}
        selfCheck={selfCheck}
        setSelfCheck={setSelfCheck}
        codingCwd={codingCwd}
        setCodingCwd={setCodingCwd}
        onPickFolder={() => void pickFolder()}
        chromeExtensionId={chromeExtensionId}
        setChromeExtensionId={setChromeExtensionId}
        telegramConfigured={false}
        chromeConnected={Boolean(chromeBridge?.connected)}
        appVersion="0.4.0"
        grokVersionLine={`Grok CLI ${grokStatus?.version ?? "unknown"}`}
      />
      <ToolsPage open={toolsPageOpen} onClose={() => setToolsPageOpen(false)} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <aside className="app-sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
            <h1>Grok Build Desktop</h1>
            <span>Grok Build for engineers</span>
          </div>
          {/* The chevron previously looked clickable but did nothing. Now it
              opens the ⌘K palette — the natural "what can I do?" affordance. */}
          <button
            className="brand-chevron"
            type="button"
            aria-label="Open command palette"
            title="Command palette (⌘K)"
            onClick={() => setPaletteOpen(true)}
          >
            <ChevronDown size={16} />
          </button>
        </div>

        <section className="nav-section primary-nav" aria-label="Primary navigation">
          <div className="nav-list">
            {primaryNavItems.map((item) => {
              // Each nav item maps to a single, deterministic action — no
              // "this kinda does X" semantics. If the action isn't obvious
              // from the label, the meta line below it explains.
              const handle = () => {
                if (item.label === "New Session") {
                  // CREATES a fresh tab (empty messages, clean cwd) and
                  // switches to it. handleTabCreate already wipes drafts,
                  // notices, and last-run card — Claude-Desktop-style
                  // "clean slate". Then put the cursor in the composer.
                  handleTabCreate();
                  composerRef.current?.focus();
                } else if (item.label === "Search") {
                  // Open the ⌘K command palette pre-focused. The host of
                  // visible "search-y" things (recent prompts, palette,
                  // files) is unified here.
                  setPaletteOpen(true);
                } else if (item.label === "Tools") {
                  // Dedicated Tools / MCP hub (community-tool integration).
                  setToolsPageOpen(true);
                } else if (item.label === "Settings") {
                  // Dedicated Settings page (Claude-Desktop-style modal).
                  setSettingsOpen(true);
                }
              };
              // The active highlight should follow what's *actually* open,
              // not hardcoded to "New Session". Otherwise every button looks
              // selected and the user can't tell which panel is current.
              const isActive =
                (item.label === "Tools" && toolsPageOpen) ||
                (item.label === "Settings" && settingsOpen) ||
                (item.label === "Search" && paletteOpen);
              return (
                <button
                  className={isActive ? "active" : ""}
                  key={item.label}
                  type="button"
                  onClick={handle}
                >
                  {item.label === "New Session" ? <Plus size={16} /> : item.label === "Search" ? <Search size={16} /> : item.label === "Tools" ? <Wrench size={16} /> : <Settings size={16} />}
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="nav-section history-nav">
          <div className="nav-head">
            <span>History</span>
            {/* Refresh icon — clears the filter input so the user sees the
                full recent-prompts list again. Was a decorative icon before. */}
            <button
              className="history-refresh"
              type="button"
              aria-label="Clear filter"
              title="Clear filter and show all recent prompts"
              onClick={() => {
                setHistoryFilter("");
                historySearchInputRef.current?.focus();
              }}
            >
              <History size={15} />
            </button>
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              ref={historySearchInputRef}
              aria-label="Search history"
              placeholder="Filter recent prompts..."
              onChange={(event) => setHistoryFilter(event.currentTarget.value)}
              value={historyFilter}
            />
          </label>
          <div className="history-list">
            {recentPrompts.length === 0 ? (
              // No fake "Try: …" placeholders. An empty state is honest and
              // less misleading than disabled-looking rows that look real.
              <div className="history-empty">
                {historyFilter.trim() ? (
                  <>
                    <span>No matches for</span>
                    <code>{historyFilter.trim()}</code>
                  </>
                ) : (
                  <span>Your prompts will show up here.</span>
                )}
              </div>
            ) : (
              <>
                {historyView.pinned.length > 0 ? (
                  <div className="history-group">
                    <div className="history-section-head">
                      <Pin size={12} /> Pinned
                    </div>
                    {historyView.pinned.map(renderHistoryRow)}
                  </div>
                ) : null}

                {historyView.groups.map(([name, rows]) => (
                  <div className="history-group" key={`hg-${name}`}>
                    <div className="history-section-head">
                      <FolderInput size={12} /> {name}
                    </div>
                    {rows.map(renderHistoryRow)}
                  </div>
                ))}

                {historyView.ungrouped.length > 0 ? (
                  <div className="history-group">
                    {historyView.pinned.length > 0 || historyView.groups.length > 0 ? (
                      <div className="history-section-head">
                        <History size={12} /> Recent
                      </div>
                    ) : null}
                    {historyView.ungrouped.map(renderHistoryRow)}
                  </div>
                ) : null}

                {historyView.archived.length > 0 ? (
                  <div className="history-group archived">
                    <button
                      type="button"
                      className="history-section-head toggle"
                      onClick={() => setShowArchived((v) => !v)}
                    >
                      <Archive size={12} /> Archived ({historyView.archived.length})
                      <ChevronDown size={13} className={`chev${showArchived || historyFilter.trim() ? " open" : ""}`} />
                    </button>
                    {showArchived || historyFilter.trim() ? historyView.archived.map(renderHistoryRow) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
          {historyNote ? <div className="history-toast">{historyNote}</div> : null}
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

        {/* Whole strip is the Settings affordance now — clicking anywhere
            (avatar, name, or gear) opens Settings. Previously only the tiny
            gear was clickable, which read as "broken". */}
        <button
          className="account-strip"
          type="button"
          aria-label="Open settings"
          title="Settings (⌘,)"
          onClick={() => setSettingsOpen(true)}
        >
          <div className={`avatar${isGrokReady ? " ready" : ""}`}>G</div>
          <div className="account-text">
            {/* Real data: active model + live grok connection status. */}
            <strong>{activeModel}</strong>
            <span>{isGrokReady ? "Connected · grok.com" : statusLabel}</span>
          </div>
          <span className="account-settings" aria-hidden="true">
            <Settings size={16} />
          </span>
        </button>
      </aside>

      <section className={`workspace dock-${dockPosition}`}>
        {/* Minimal, Claude-Desktop-style top bar. The old toolbar row (Repo
            input, model chip, Preview/Context/Terminal/Tools/Settings, status
            pill) is gone — those all live in the sidebar, ⌘K palette, the
            bottom status bar, and Settings now. What stays here is just the
            project chip (click → folder picker), a draggable spacer, a tiny
            connection dot, and the contextual Stop button while running. */}
        <header className="window-titlebar minimal" data-tauri-drag-region>
          <button
            className="repo-chip"
            onClick={pickFolder}
            type="button"
            disabled={folderPickerBusy}
            title={codingCwd ? codingCwd : "Pick a project folder"}
          >
            {folderPickerBusy ? <Loader2 className="spin" size={14} /> : <FolderGit2 size={14} />}
            <span>{repoName}</span>
          </button>
          <div className="titlebar-spacer" data-tauri-drag-region />
          <div className="titlebar-right">
            {grokIsRunning && activeRunId ? (
              <button
                className="primary-run"
                onClick={() => void cancelRun(activeRunId)}
                type="button"
                title="Stop the current run"
              >
                <X size={15} />
                <span>Stop</span>
              </button>
            ) : (
              <span
                className={`conn-dot ${isGrokReady ? "ready" : "blocked"}`}
                title={statusLabel}
                aria-label={statusLabel}
              />
            )}
            {/* Day / night theme toggle (also ⌘⇧L). */}
            <button
              className="titlebar-icon-btn"
              type="button"
              aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={themeMode === "dark" ? "Light theme (⌘⇧L)" : "Dark theme (⌘⇧L)"}
              onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            >
              {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {/* Panels menu — Preview / Context / Terminal / Tools, each opens
                its panel (Claude-Desktop-style). */}
            <button
              className={`detail-toggle${contextOpen || previewOpen || terminalOpen || toolsOpen ? " active" : ""}`}
              type="button"
              aria-label="Open panels menu"
              title="Panels — Preview, Context, Terminal, Tools"
              onClick={openPanelMenu}
            >
              <PanelRight size={16} />
            </button>
          </div>
        </header>

        <section className="workbench">
          <div className="conversation-panel" onContextMenu={openConversationMenu}>
            {/* Session tabs removed per request — Claude-Desktop-style single
                conversation. New Session starts fresh; earlier conversations
                stay reachable from the HISTORY sidebar (which aggregates
                across sessions). The tabs state machinery is retained purely
                as the per-session history store. */}
            <div className="conversation-scroll" ref={conversationScrollRef}>
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-head">
                    <div className="empty-state-avatar"><Bot size={22} /></div>
                    <h2 className="empty-state-title">How can Grok help today?</h2>
                    <p className="empty-state-subtitle">
                      Code with you across this repository · {activeModel}
                    </p>
                  </div>
                  <div className="starter-grid">
                    {[
                      {
                        title: "Review this repository",
                        body: "Surface the highest-impact risks and gaps you can verify in 30 seconds.",
                        prompt:
                          "Review this repository like a senior engineer. Surface the top 3 risks or gaps you can verify in under a minute, with one exact command per finding.",
                      },
                      {
                        title: "Explain this codebase",
                        body: "Give me a tight architecture tour so I can start contributing today.",
                        prompt:
                          "Give me a 5-bullet architecture tour of this repository: entry point, key modules, build/run command, test command, and one gotcha. Be concrete.",
                      },
                      {
                        title: "Add a failing test",
                        body: "Pick a real bug or gap and write a failing test that pins it down.",
                        prompt:
                          "Find one real bug, edge case, or gap in this repository. Write a failing test that pins it down. Tell me the file path and the exact command to run just that test.",
                      },
                      {
                        title: "Suggest the next change",
                        body: "What is the single most useful next code action right now?",
                        prompt:
                          "What is the single most useful next code action in this repository right now? Show the proposed diff and the verification command. Be specific.",
                      },
                    ].map((card) => (
                      <button
                        key={card.title}
                        className="starter-card"
                        onClick={() => updatePrompt(card.prompt)}
                        type="button"
                      >
                        <strong>{card.title}</strong>
                        <span>{card.body}</span>
                      </button>
                    ))}
                  </div>
                  <p className="empty-state-hint">
                    Press <kbd>↵</kbd> to send · <kbd>⇧↵</kbd> newline · <kbd>⌘1</kbd>/<kbd>⌘2</kbd> to switch modes
                  </p>
                </div>
              ) : (
                <MessageList messages={messageRefs} />
              )}
            </div>

            <AgentOverlayDriver />
            <QueueDock />
            <StatusBar />

            <div className="composer-row">
              {actionPolicy === "autopilot" ? (
                <div className="autopilot-warning" role="alert">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>Autopilot is on — Grok auto-approves every action.</strong>
                    <span>
                      It can edit files and run shell commands with{" "}
                      <code>--always-approve</code>, no confirmation. Only use this in a
                      sandbox or a disposable git checkout.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="autopilot-warning-dismiss"
                    onClick={() => setActionPolicy("patch")}
                    title="Switch back to Patch ready"
                  >
                    Switch to Patch
                  </button>
                </div>
              ) : null}
              <Composer
                ref={composerRef}
                cwd={codingCwd}
                argsBuilder={buildGrokArgs}
                promptWrapper={buildPromptWithPreamble}
                initialValue={drafts[mode] || defaultDrafts[mode]}
                placeholder={modeCopy[mode].placeholder}
                onTextChange={(text) => {
                  setDrafts((current) => ({ ...current, [mode]: text }));
                }}
                onEnqueued={handleEnqueued}
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
                  aria-label="Grok model"
                  className="model-select-footer"
                  title={modelIsVerified ? `Model: ${activeModel}` : `${activeModel} — not in grok CLI list, may fall back`}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isGrokModelId(value)) {
                      changeModelPreset(value);
                    } else {
                      setModelPreset("custom");
                      setCustomModel(value);
                    }
                  }}
                  value={modelPreset === "custom" ? "custom" : modelPreset}
                >
                  {modelOptions.map((id) => {
                    const verified = availableModels.length === 0 || availableModels.includes(id);
                    return (
                      <option key={id} value={id}>
                        {verified ? id : `${id} · not in CLI`}
                      </option>
                    );
                  })}
                  <option value="custom">Custom…</option>
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
                {/* Run config — moved here from the inspector so it's one
                    glance below the chat box (Claude-style). Labels are
                    self-describing since the footer has no separate captions. */}
                <select
                  aria-label="Agent effort"
                  className="run-select"
                  title="Agent effort — how hard Grok works per turn"
                  value={effortLevel}
                  onChange={(event) => setEffortLevel(event.currentTarget.value as EffortLevel)}
                >
                  {(Object.keys(effortLevels) as EffortLevel[]).map((k) => (
                    <option key={k} value={k}>{`Effort: ${effortLevels[k].label}`}</option>
                  ))}
                </select>
                <select
                  aria-label="Reasoning effort"
                  className="run-select"
                  title="Reasoning effort — extra thinking budget on hard paths"
                  value={reasoningEffort}
                  onChange={(event) => setReasoningEffort(event.currentTarget.value as ReasoningEffort)}
                >
                  {(Object.keys(reasoningEfforts) as ReasoningEffort[]).map((k) => (
                    <option key={k} value={k}>{`Reasoning: ${reasoningEfforts[k].label}`}</option>
                  ))}
                </select>
                <select
                  aria-label="Permission mode"
                  className="run-select"
                  title="Permission mode — maps to grok --permission-mode"
                  value={permissionMode}
                  onChange={(event) => setPermissionMode(event.currentTarget.value as PermissionMode)}
                >
                  {(Object.keys(permissionModes) as PermissionMode[]).map((k) => (
                    <option key={k} value={k}>{`Perm: ${permissionModes[k].label}`}</option>
                  ))}
                </select>
                <select
                  aria-label="Best-of-N"
                  className="run-select"
                  title="Best-of-N — run N ways in parallel, keep the best"
                  value={bestOfN}
                  onChange={(event) => setBestOfN(Number(event.currentTarget.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{`Best-of-${n}`}</option>
                  ))}
                </select>
                <span className="composer-hint" aria-hidden="true">
                  ↵ Send · ⇧↵ Newline · ⌘↵ Force
                </span>
                {grokIsRunning && activeRunId ? (
                  <button
                    className="mini-run"
                    onClick={() => void cancelRun(activeRunId)}
                    type="button"
                    title="Stop run"
                  >
                    <X size={16} />
                  </button>
                ) : null}
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
              <button
                aria-label="Toggle dock position"
                onClick={() => {
                  const next: DockPosition = dockPosition === "right" ? "bottom" : "right";
                  setDockPosition(next);
                  window.localStorage.setItem(storageKeys.dockPosition, next);
                }}
                title={`Move dock to ${dockPosition === "right" ? "bottom" : "right"}`}
                type="button"
              >
                <PanelRight size={16} />
              </button>
              <button
                aria-label="Close inspector"
                onClick={() => setToolsOpen(false)}
                title="Close (⌘B clears panels)"
                type="button"
              >
                <X size={16} />
              </button>
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

              {inspectorTab === "desktop" ? (
                <DesktopPanel
                  onInsertContext={(text) => {
                    // Append into the active mode's draft so it lands in
                    // Composer on next render.
                    const next = (drafts[mode] ?? "") + text;
                    setDrafts((current) => ({ ...current, [mode]: next }));
                    composerRef.current?.setValue(next);
                    setSessionNotice("Desktop context appended to your draft.");
                  }}
                />
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
          onToggle={(event) => setToolbeltOpen(event.currentTarget.open)}
          open={toolbeltOpen}
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
          {/* These chips looked like controls but were dead text. Now they're
              real buttons: project → folder picker, model → Model settings,
              policy → Permissions settings. */}
          <button
            type="button"
            className="status-cluster status-action"
            onClick={pickFolder}
            disabled={folderPickerBusy}
            title="Pick the project folder Grok runs in"
          >
            <FolderGit2 size={13} />
            <span className="status-cwd" title={workspacePath}>{workspacePath}</span>
          </button>
          <button
            type="button"
            className="status-cluster status-action"
            onClick={() => {
              setSettingsSection("model");
              setSettingsOpen(true);
            }}
            title="Change model & reasoning"
          >
            <Sparkles size={13} />
            <span>{activeModel}</span>
            {!modelIsVerified ? <span className="status-warn">unverified</span> : null}
          </button>
          <button
            type="button"
            className="status-cluster status-action"
            onClick={() => {
              setSettingsSection("permissions");
              setSettingsOpen(true);
            }}
            title="Change action policy & permissions"
          >
            <ShieldCheck size={13} />
            <span>{actionPolicies[actionPolicy].label}</span>
          </button>
          <div className="status-cluster">
            {/* Only report a "last run" once a real run has actually happened
                (totalRuns > 0). Otherwise a default/unavailable lastRun would
                falsely scream "Last run failed · 0.0s" on a fresh launch. */}
            {grokIsRunning ? (
              <Loader2 className="spin" size={13} />
            ) : lastRun && totalRuns > 0 ? (
              lastRun.ok ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />
            ) : (
              <Zap size={13} />
            )}
            <span>
              {grokIsRunning
                ? "Running"
                : lastRun && totalRuns > 0
                  ? `${lastRun.ok ? "Last run ok" : "Last run failed"} · ${(lastRun.duration_ms / 1000).toFixed(1)}s`
                  : isGrokReady
                    ? "Idle · ready"
                    : "Ready"}
            </span>
          </div>
          <div className="status-cluster status-right">
            <History size={13} />
            <span>{totalRuns} runs</span>
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
