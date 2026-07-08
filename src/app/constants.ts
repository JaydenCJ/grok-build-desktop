// Shared app-level constants: UI copy, presets, storage keys.
import { t } from "../i18n";
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

// The `defaultPrompt` bodies are model-facing prompt text (seeded into the
// composer), not UI chrome — they stay hardcoded by design.
export const modeCopy = {
  standard: {
    title: t("mode.standard.title"),
    subtitle: t("mode.standard.subtitle"),
    shortcut: "⌘1",
    placeholder: t("mode.standard.placeholder"),
    defaultPrompt: "Answer clearly, keep the response practical, and suggest when this should move into Coding Mode.",
  },
  coding: {
    title: t("mode.coding.title"),
    subtitle: t("mode.coding.subtitle"),
    shortcut: "⌘2",
    placeholder: t("mode.coding.placeholder"),
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

// Preset `prompt` bodies are model-facing prompt text — hardcoded by design.
export const codingPresets = [
  {
    id: "analyze",
    label: t("preset.analyze"),
    description: t("preset.analyzeDesc"),
    prompt:
      "Analyze this project as a senior engineer. Summarize the architecture, identify the most important correctness and maintainability risks, and recommend the smallest high-leverage next steps. Do not edit files yet.",
  },
  {
    id: "implement",
    label: t("preset.implement"),
    description: t("preset.implementDesc"),
    prompt:
      "Find one focused improvement in this project, explain why it matters, make the smallest safe code change, and include verification commands.",
  },
  {
    id: "review",
    label: t("preset.review"),
    description: t("preset.reviewDesc"),
    prompt:
      "Review the current repository or recent changes like a strict senior reviewer. Lead with bugs, regressions, missing tests, security risks, and maintainability issues. Include file paths and concrete fixes.",
  },
  {
    id: "debug",
    label: t("preset.debug"),
    description: t("preset.debugDesc"),
    prompt:
      "Investigate the reported issue. Read relevant files first, separate evidence from hypothesis, identify the root cause, then propose or apply the smallest fix with verification.",
  },
  {
    id: "tests",
    label: t("preset.tests"),
    description: t("preset.testsDesc"),
    prompt:
      "Inspect the test setup, identify the most valuable missing or failing test, add or propose the smallest useful test change, and include commands to run it.",
  },
  {
    id: "refactor",
    label: t("preset.refactor"),
    description: t("preset.refactorDesc"),
    prompt:
      "Inspect the current code for a small refactor that improves maintainability without changing behavior. Keep the change narrow and include verification steps.",
  },
];

export const actionPolicies: Record<
  ActionPolicy,
  { label: string; detail: string; risk: "none" | "low" | "high" }
> = {
  review: {
    label: t("policy.review"),
    detail: t("policy.reviewDetail"),
    risk: "none",
  },
  patch: {
    label: t("policy.patch"),
    detail: t("policy.patchDetail"),
    risk: "low",
  },
  autopilot: {
    label: t("policy.autopilot"),
    detail: t("policy.autopilotDetail"),
    risk: "high",
  },
};

export const effortLevels: Record<EffortLevel, { label: string; detail: string }> = {
  low: { label: t("effort.low"), detail: t("effort.lowDetail") },
  medium: { label: t("effort.medium"), detail: t("effort.mediumDetail") },
  high: { label: t("effort.high"), detail: t("effort.highDetail") },
  xhigh: { label: t("effort.xhigh"), detail: t("effort.xhighDetail") },
  max: { label: t("effort.max"), detail: t("effort.maxDetail") },
};

export const reasoningEfforts: Record<ReasoningEffort, { label: string; detail: string }> = {
  off: { label: t("reasoning.off"), detail: t("reasoning.offDetail") },
  low: { label: t("effort.low"), detail: t("reasoning.lowDetail") },
  medium: { label: t("effort.medium"), detail: t("reasoning.mediumDetail") },
  high: { label: t("effort.high"), detail: t("reasoning.highDetail") },
  xhigh: { label: t("effort.xhigh"), detail: t("reasoning.xhighDetail") },
  max: { label: t("effort.max"), detail: t("reasoning.maxDetail") },
};

export const grokModelPresets: Record<GrokModelId, { label: string; detail: string; defaultReasoning: ReasoningEffort }> = {
  // Preset labels are literal model ids (not translatable copy); the details
  // are UI copy and live in the i18n catalog.
  "grok-build": {
    label: "grok-build",
    detail: t("model.grokBuildDetail"),
    defaultReasoning: "off",
  },
  "grok-build-0.1": {
    label: "grok-build-0.1",
    detail: t("model.grokBuildPinnedDetail"),
    defaultReasoning: "off",
  },
  "grok-4.3": {
    label: "grok-4.3",
    detail: t("model.grok43Detail"),
    defaultReasoning: "high",
  },
  "grok-4.3-latest": {
    label: "grok-4.3-latest",
    detail: t("model.grok43LatestDetail"),
    defaultReasoning: "high",
  },
  "grok-latest": {
    label: "grok-latest",
    detail: t("model.grokLatestDetail"),
    defaultReasoning: "medium",
  },
  "grok-4-fast-reasoning": {
    label: "grok-4-fast-reasoning",
    detail: t("model.grokFastReasoningDetail"),
    defaultReasoning: "medium",
  },
  "grok-4-fast-non-reasoning": {
    label: "grok-4-fast-non-reasoning",
    detail: t("model.grokFastNonReasoningDetail"),
    defaultReasoning: "off",
  },
  custom: {
    label: t("model.custom"),
    detail: t("model.customDetail"),
    defaultReasoning: "off",
  },
};

export const permissionModes: Record<PermissionMode, { label: string; detail: string }> = {
  default: { label: t("permission.default"), detail: t("permission.defaultDetail") },
  acceptEdits: { label: t("permission.acceptEdits"), detail: t("permission.acceptEditsDetail") },
  auto: { label: t("permission.auto"), detail: t("permission.autoDetail") },
  dontAsk: { label: t("permission.dontAsk"), detail: t("permission.dontAskDetail") },
  plan: { label: t("permission.plan"), detail: t("permission.planDetail") },
};

export const inspectorTabs: { id: InspectorTab; label: string }[] = [
  { id: "context", label: t("inspectorTab.context") },
  { id: "skills", label: t("inspectorTab.skills") },
  { id: "mcp", label: t("inspectorTab.mcp") },
  { id: "agents", label: t("inspectorTab.agents") },
  { id: "plugins", label: t("inspectorTab.plugins") },
  { id: "hooks", label: t("inspectorTab.hooks") },
  { id: "permissions", label: t("inspectorTab.permissions") },
  { id: "desktop", label: t("inspectorTab.desktop") },
];

export const defaultStatuses: ToolStatus[] = [
  {
    id: "grok",
    label: t("toolStatus.grokBuild"),
    command: "grok",
    installed: false,
    detail: t("toolStatus.notChecked"),
  },
];

export const primaryNavItems = [
  { id: "new-session", label: t("nav.newSession"), meta: t("nav.newSessionMeta") },
  { id: "search", label: t("nav.search"), meta: t("nav.searchMeta") },
  { id: "tools", label: t("nav.tools"), meta: t("nav.toolsMeta") },
  { id: "settings", label: t("nav.settings"), meta: t("nav.settingsMeta") },
] as const;

export const contextFiles = [
  "README.md",
  "src/App.tsx",
  "src/lib/grok.ts",
  "src-tauri/src/lib.rs",
  "src-tauri/Cargo.toml",
];

export const grokOptimizationRules = [
  t("rules.defaultModel"),
  t("rules.reasoningEffort"),
  t("rules.webSearch"),
  t("rules.engineControls"),
  t("rules.verificationContract"),
];

// Multi-session tab storage. Hoisted to module scope so boot-time hydration
// helpers below can read the same keys the App component persists to.
export const tabsStorageKey = "grok-desktop-tabs-v1";
export const tabsActiveKey = "grok-desktop-tabs-active-v1";
