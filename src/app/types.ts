// Shared app-level types and runtime type guards.
import type { ToolRun } from "../lib/grok";

export type Mode = "standard" | "coding";
export type Runner =
  | "grok"
  | "shell"
  | "browser"
  | "absorb"
  | "doctor"
  | "inspect"
  | "models"
  | "mcp"
  | "mcp-doctor"
  | "plugins"
  | "sessions";
export type ActionPolicy = "review" | "patch" | "autopilot";
export type InspectorTab = "context" | "skills" | "mcp" | "agents" | "plugins" | "hooks" | "permissions" | "desktop";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";
export type PermissionMode = "default" | "acceptEdits" | "auto" | "dontAsk" | "plan";
export type ThemeMode = "dark" | "light";
export type DockPosition = "right" | "bottom";
export type GrokModelId =
  | "grok-build"
  | "grok-build-0.1"
  | "grok-4.3"
  | "grok-4.3-latest"
  | "grok-latest"
  | "grok-4-fast-reasoning"
  | "grok-4-fast-non-reasoning"
  | "custom";

export type ToolStatus = {
  id: string;
  label: string;
  command: string;
  installed: boolean;
  detail: string;
};

export type ModeMeta = {
  title: string;
  subtitle: string;
  shortcut: string;
  placeholder: string;
  defaultPrompt: string;
};

export type StaticPreviewFile = {
  name: string;
  path: string;
  kind: string;
  size: number;
};

export type StaticPreview = {
  available: boolean;
  root: string;
  entryPath: string;
  /** grokpreview:// URL served by the backend with its own CSP. */
  previewUrl: string;
  files: StaticPreviewFile[];
  detail: string;
  updatedAt: number;
};

export type GrokAuthStatus = {
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

export type ChatMessageStatus = "streaming" | "done" | "error" | "stopped";

export type ChatMessage = {
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

export type SessionState = {
  mode?: Mode;
  drafts?: Partial<Record<Mode, string>>;
  codingCwd?: string;
  shellCommand?: string;
  actionPolicy?: ActionPolicy;
  codingWorkflow?: string;
  themeMode?: ThemeMode;
  lastRun?: ToolRun | null;
  history?: ToolRun[];
  messages?: ChatMessage[];
};

export type HistoryPreview = { id: string; title: string; detail: string; time: string };
export type HistoryRow = HistoryPreview & {
  pinned: boolean;
  group: string | null;
  archived: boolean;
  /** Last-activity timestamp (newest conversation sorts first). */
  lastTs: number;
  /** True when this is the conversation currently open. */
  active: boolean;
};

export function isMode(value: unknown): value is Mode {
  return value === "coding" || value === "standard";
}

export function isActionPolicy(value: unknown): value is ActionPolicy {
  return value === "review" || value === "patch" || value === "autopilot";
}

export function isInspectorTab(value: unknown): value is InspectorTab {
  return (
    value === "context" ||
    value === "skills" ||
    value === "mcp" ||
    value === "agents" ||
    value === "plugins" ||
    value === "hooks" ||
    value === "permissions" ||
    value === "desktop"
  );
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "off" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

export function isGrokModelId(value: unknown): value is GrokModelId {
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

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "default" || value === "acceptEdits" || value === "auto" || value === "dontAsk" || value === "plan";
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

export function isDockPosition(value: unknown): value is DockPosition {
  return value === "right" || value === "bottom";
}

export function isToolRun(value: unknown): value is ToolRun {
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

export function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.ts === "number"
  );
}
