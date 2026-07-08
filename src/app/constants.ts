// Shared app-level constants: UI copy, presets, storage keys.
import type {
  ActionPolicy,
  EffortLevel,
  GrokModelId,
  InspectorTab,
  Mode,
  ModeMeta,
  PermissionMode,
  ReasoningEffort,
  ToolStatus,
} from "./types";

export const modeCopy = {
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

export const storageKeys = {
  mode: "grok-desktop-mode",
  drafts: "grok-desktop-mode-drafts",
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


export const defaultDrafts: Record<Mode, string> = {
  standard: modeCopy.standard.defaultPrompt,
  coding: modeCopy.coding.defaultPrompt,
};

export const codingPresets = [
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

export const actionPolicies: Record<
  ActionPolicy,
  { label: string; detail: string; risk: "none" | "low" | "high" }
> = {
  review: {
    label: "Review only",
    detail: "Read, reason, propose. No file edits unless asked.",
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

export const effortLevels: Record<EffortLevel, { label: string; detail: string }> = {
  low: { label: "Low", detail: "Fast triage and small answers" },
  medium: { label: "Medium", detail: "Balanced repo reasoning" },
  high: { label: "High", detail: "Default coding depth" },
  xhigh: { label: "XHigh", detail: "Deep plans and refactors" },
  max: { label: "Max", detail: "Most thorough Grok pass" },
};

export const reasoningEfforts: Record<ReasoningEffort, { label: string; detail: string }> = {
  off: { label: "Auto", detail: "Let Grok choose reasoning depth" },
  low: { label: "Low", detail: "Fast reasoning pass" },
  medium: { label: "Medium", detail: "Balanced reasoning" },
  high: { label: "High", detail: "Harder code paths" },
  xhigh: { label: "XHigh", detail: "Architecture and debugging" },
  max: { label: "Max", detail: "Maximum reasoning budget" },
};

export const grokModelPresets: Record<GrokModelId, { label: string; detail: string; defaultReasoning: ReasoningEffort }> = {
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

export const permissionModes: Record<PermissionMode, { label: string; detail: string }> = {
  default: { label: "Default", detail: "Use Grok CLI configured prompts and approvals" },
  acceptEdits: { label: "Accept edits", detail: "Prefer quick edit approval for trusted changes" },
  auto: { label: "Auto", detail: "Let Grok proceed through low-risk tool steps" },
  dontAsk: { label: "Don't ask", detail: "Reduce prompts while keeping Grok Desktop safety context visible" },
  plan: { label: "Plan", detail: "Plan-first behavior for larger or uncertain work" },
};

export const inspectorTabs: { id: InspectorTab; label: string }[] = [
  { id: "context", label: "Context" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
  { id: "plugins", label: "Plugins" },
  { id: "hooks", label: "Hooks" },
  { id: "permissions", label: "Perms" },
  { id: "desktop", label: "Desktop" },
];

export const defaultStatuses: ToolStatus[] = [
  {
    id: "grok",
    label: "Grok Build",
    command: "grok",
    installed: false,
    detail: "Not checked",
  },
];

export const primaryNavItems = [
  { label: "New Session", meta: "Start fresh" },
  { label: "Search", meta: "Find work" },
  { label: "Tools", meta: "Skills and MCP" },
  { label: "Settings", meta: "Preferences" },
];

export const contextFiles = [
  "README.md",
  "src/App.tsx",
  "src/lib/grok.ts",
  "src-tauri/src/lib.rs",
  "src-tauri/Cargo.toml",
];

export const grokOptimizationRules = [
  "Default to grok-build for agentic repository work",
  "Use reasoning effort only when the selected model benefits from it",
  "Keep web search available for version-sensitive docs",
  "Expose Best-of-N, Memory, and Subagents as explicit engine controls",
  "Send repo path, workflow, approvals, ecosystem, and verification contract",
];

// Multi-session tab storage. Hoisted to module scope so boot-time hydration
// helpers below can read the same keys the App component persists to.
export const tabsStorageKey = "grok-desktop-tabs-v1";
export const tabsActiveKey = "grok-desktop-tabs-active-v1";
