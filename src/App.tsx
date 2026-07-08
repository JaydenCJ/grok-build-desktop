import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import "./App.css";
import { cancelRun, ensureStreamListenersAttached } from "./lib/grok";
import { hasTauriRuntime } from "./lib/runtime";
import { streamStore } from "./lib/streamStore";
import { MessageList, type MessageRef } from "./components/MessageList";
import { Composer, type ComposerHandle } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { QueueDock } from "./components/QueueDock";
import type { TabMessage } from "./lib/tabs";
import { DesktopPanel } from "./components/DesktopPanel";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { SettingsPage } from "./components/SettingsPage";
import { ToolsPage } from "./components/ToolsPage";
import { ContextMenu, type ContextMenuState, type ContextMenuItem } from "./components/ContextMenu";
import { useActiveRun } from "./hooks/useActiveRun";
import { useGrokRunners } from "./hooks/useGrokRunners";
import { useSessionPersistence } from "./hooks/useSessionPersistence";
import { useModelConfig } from "./hooks/useModelConfig";
import { useSessionTabs } from "./hooks/useSessionTabs";
import { useHistoryOrganization } from "./hooks/useHistoryOrganization";

import {
  isDockPosition,
  isGrokModelId,
  isInspectorTab,
  type ActionPolicy,
  type ChatMessageStatus,
  type DockPosition,
  type EffortLevel,
  type GrokModelId,
  type HistoryPreview,
  type HistoryRow,
  type InspectorTab,
  type Mode,
  type PermissionMode,
  type ReasoningEffort,
} from "./app/types";
import {
  actionPolicies,
  codingPresets,
  contextFiles,
  defaultDrafts,
  effortLevels,
  grokModelPresets,
  grokOptimizationRules,
  inspectorTabs,
  modeCopy,
  permissionModes,
  primaryNavItems,
  reasoningEfforts,
  storageKeys,
} from "./app/constants";
import {
  formatOutput,
  grokInspectCount,
  grokInspectLine,
  grokInspectSection,
  grokTrust,
  makeId,
  statusTone,
  terminalClass,
  terminalPrefix,
  terminalText,
} from "./app/format";
import { buildGrokArgs } from "./app/grokArgs";
import { BrandGlyph } from "./components/BrandGlyph";

function App() {
  // The textarea lives inside Composer (uncontrolled ref). We hold a
  // ComposerHandle so starter cards / history clicks / drafts can seed it.
  const composerRef = useRef<ComposerHandle | null>(null);
  const setComposerValue = (value: string) => {
    composerRef.current?.setValue(value);
  };
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // Session state (mode/drafts/cwd/theme/history/messages) + localStorage and
  // session_state.json persistence live in hooks/useSessionPersistence.ts.
  const {
    mode,
    setMode,
    drafts,
    setDrafts,
    codingCwd,
    setCodingCwd,
    shellCommand,
    setShellCommand,
    actionPolicy,
    setActionPolicy,
    codingWorkflow,
    setCodingWorkflow,
    themeMode,
    setThemeMode,
    lastRun,
    setLastRun,
    history,
    setHistory,
    totalRuns,
    setTotalRuns,
    messages,
    setMessages,
    recordRun,
    appendMessage,
  } = useSessionPersistence({ setComposerValue, setSessionNotice });
  // Multi-session tabs (persistence, create/switch/delete, active-tab mirror)
  // live in hooks/useSessionTabs.ts. removeConversationMeta and setContextMenu
  // are declared later; the callback only runs from event handlers, after
  // every hook has initialized.
  const {
    tabs,
    activeTabId,
    handleTabCreate,
    switchToSession,
    deleteSession,
    sessionFirstPrompt,
  } = useSessionTabs({
    messages,
    setMessages,
    codingCwd,
    setCodingCwd,
    setDrafts,
    setLastRun,
    setSessionNotice,
    setComposerValue,
    focusComposer: () => composerRef.current?.focus(),
    closePalette: () => setPaletteOpen(false),
    onConversationDeleted: (id) => {
      removeConversationMeta(id);
      setContextMenu(null);
    },
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Developer-utilities <details> (Browser / Absorb Repo).
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
  // History organization (pin/rename/group/archive metadata, filter, derived
  // row views) lives in hooks/useHistoryOrganization.ts.
  const {
    pinnedPromptIds,
    promptGroups,
    archivedPromptIds,
    showArchived,
    setShowArchived,
    rowEdit,
    setRowEdit,
    historyNote,
    setHistoryNote,
    historyFilter,
    setHistoryFilter,
    historySearchInputRef,
    recentPrompts,
    historyView,
    togglePinPrompt,
    toggleArchivePrompt,
    setPromptGroupId,
    startRename,
    startNewGroup,
    commitRowEdit,
    savePromptToLibrary,
    removeConversationMeta,
  } = useHistoryOrganization({
    tabs,
    activeTabId,
    messages,
    sessionFirstPrompt,
    closeContextMenu: () => setContextMenu(null),
  });
  // Sidebar collapse for ⌘B — defaults to expanded.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return window.localStorage.getItem("grok-desktop-sidebar-collapsed") === "1";
  });
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = window.localStorage.getItem(storageKeys.dockPosition);
    return isDockPosition(stored) ? stored : "right";
  });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    const stored = window.localStorage.getItem(storageKeys.inspectorTab);
    return isInspectorTab(stored) ? stored : "skills";
  });
  // Session notices (folder pick, restore/save failures, …) show as a
  // transient toast over the conversation — previously they rendered only
  // inside the collapsed Terminal dock, where nobody saw them. Auto-dismiss
  // like the history toast, with a longer window so errors are readable.
  useEffect(() => {
    if (!sessionNotice) return;
    const t = window.setTimeout(() => setSessionNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [sessionNotice]);

  // Stop a run, surfacing failures. A bare `void cancelRun(...)` swallowed
  // backend rejections (queue lock, run already gone, IPC error) as unhandled
  // promise rejections — Stop could silently do nothing while the run kept
  // streaming.
  function stopRun(runId: string) {
    cancelRun(runId).catch((error) => {
      setSessionNotice(`Stop failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // External-command runners + inspector data (statuses, preview, models,
  // MCP/plugins/sessions, shell/browser/absorb/doctor) live in
  // hooks/useGrokRunners.ts; recordRun below is hoisted, so passing it here
  // is safe.
  const {
    statuses,
    grokStatus,
    ecosystemRun,
    modelsRun,
    mcpRun,
    mcpDoctorRun,
    pluginsRun,
    sessionsRun,
    staticPreview,
    previewBusy,
    availableModels,
    busyRunner,
    contextBusy,
    terminalLines,
    setTerminalLines,
    browserTask,
    setBrowserTask,
    repoPath,
    setRepoPath,
    copyText,
    setCopyText,
    folderPickerBusy,
    refreshStatuses,
    refreshGrokAuthStatus,
    refreshStaticPreview,
    startGrokLogin,
    runShell,
    refreshGrokEcosystem,
    refreshGrokModels,
    refreshGrokMcp,
    doctorGrokMcp,
    refreshGrokPlugins,
    refreshGrokSessions,
    runBrowser,
    runAbsorbRepo,
    runDoctor,
    pickFolder,
  } = useGrokRunners({
    codingCwd,
    shellCommand,
    lastRun,
    recordRun,
    setLastRun,
    setCodingCwd,
    setSessionNotice,
    onPreviewAvailable: () => setPreviewOpen(true),
  });

  const statusMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  // Model + run-configuration state (preset, efforts, permission, toggles,
  // CLI-verified options, coding auto-snap) lives in hooks/useModelConfig.ts.
  const {
    modelPreset,
    setModelPreset,
    customModel,
    setCustomModel,
    effortLevel,
    setEffortLevel,
    reasoningEffort,
    setReasoningEffort,
    permissionMode,
    setPermissionMode,
    bestOfN,
    setBestOfN,
    experimentalMemory,
    setExperimentalMemory,
    webSearchEnabled,
    setWebSearchEnabled,
    subagentsEnabled,
    setSubagentsEnabled,
    selfCheck,
    setSelfCheck,
    activeModel,
    activeModelMeta,
    activeReasoningLabel,
    changeModelPreset,
    modelOptions,
    modelIsVerified,
  } = useModelConfig({ mode, availableModels });
  function clearRunHistory() {
    setLastRun(null);
    setHistory([]);
    setMessages([]);
    setTerminalLines([]);
    setTotalRuns(0);
    window.localStorage.setItem("grok-desktop-run-count-total", "0");
    setSessionNotice("Cleared conversation, run history, and terminal.");
  }

  // Write the streamed assistant text back into `messages` when a run reaches
  // a terminal state. Live rendering reads the in-memory streamStore snapshot
  // directly (MessageItem), but that store is not persisted — without this
  // write-back every persistence layer (localStorage, the tabs mirror,
  // session_state.json) stores assistant messages with content:"" and restored
  // conversations lose all replies after a restart.
  useEffect(() => {
    const finalizeEndedRuns = () => {
      setMessages((current) => {
        let changed = false;
        const next = current.map((message) => {
          if (message.role !== "assistant" || !message.runId || message.status !== "streaming") {
            return message;
          }
          const snap = streamStore.getRunSnapshot(message.runId);
          if (!snap || snap.state === "queued" || snap.state === "running") return message;
          changed = true;
          const status: ChatMessageStatus =
            snap.state === "done" ? "done" : snap.state === "cancelled" ? "stopped" : "error";
          return { ...message, content: snap.text || message.content, status };
        });
        return changed ? next : current;
      });
    };
    finalizeEndedRuns();
    return streamStore.subscribe(finalizeEndedRuns);
  }, []);

  function updatePrompt(value: string) {
    setComposerValue(value);
    setDrafts((current) => ({ ...current, [mode]: value }));
  }

  // Claude-class right-click menu for a history row. Section header, icons,
  // shortcut accelerators, two flyout submenus (Open with / Move to group).
  function openHistoryMenu(e: React.MouseEvent, item: HistoryPreview) {
    e.preventDefault();
    const id = item.id; // tab/session id
    const sessionTab = tabs.find((t) => t.id === id);
    const sessionMsgs =
      ((id === activeTabId ? (messages as unknown as TabMessage[]) : sessionTab?.messages) ?? []);
    const text = sessionMsgs.find((m) => m.role === "user")?.content ?? item.title;
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
        label: "Open conversation",
        icon: <CornerUpLeft size={15} />,
        shortcut: "↵",
        onClick: () => switchToSession(id),
      },
      {
        label: "Copy first prompt",
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
      { label: "Delete conversation", icon: <Trash2 size={15} />, shortcut: "⌫", danger: true, separator: true, onClick: () => deleteSession(id) },
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
        ? [{ label: "Stop current run", danger: true, onClick: () => stopRun(activeRunId) }]
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

  // buildGrokArgs/buildGrokRules are pure functions in app/grokArgs.ts; this
  // closure snapshots the current run config for the Composer's submit path.
  function buildRunArgs(): string[] {
    return buildGrokArgs({
      mode,
      activeModel,
      effortLevel,
      reasoningEffort,
      actionPolicy,
      permissionMode,
      bestOfN,
      experimentalMemory,
      webSearchEnabled,
      subagentsEnabled,
      selfCheck,
      codingCwd,
      continueConversation: messages.length > 0,
    });
  }

  function handleEnqueued(info: { runId: string; position: number; prompt: string; rawText?: string }) {
    const now = Date.now();
    const userMessageId = makeId("u");
    const assistantMessageId = makeId("a");
    appendMessage({
      id: userMessageId,
      role: "user",
      // Show what the user ACTUALLY typed, not the sent prompt. The Composer
      // appends expanded @-mention file contents for grok's benefit — that
      // belongs in the request, not in the chat bubble. rawText is the clean
      // original; fall back to prompt only for callers that don't pass it.
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
      ],
    });
  }

  // Subscribe to the run-event / run-state / queue Tauri events. Retries with
  // backoff inside ensureStreamListenersAttached; if every attempt fails the
  // app would look alive but never render a streamed reply, so tell the user
  // instead of logging into the void.
  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let cancelled = false;
    ensureStreamListenersAttached().catch((error) => {
      if (cancelled) return;
      setSessionNotice(
        `Live run updates unavailable: ${
          error instanceof Error ? error.message : String(error)
        }. Runs may not display output — restart the app to reconnect.`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Open external links in the system browser. Assistant markdown renders raw
  // <a href> tags; in a Tauri webview a plain click would navigate the app
  // window itself to the remote site, replacing the whole UI with no way back.
  // Delegate at document level (capture) so every injected anchor is covered.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      if (hasTauriRuntime()) {
        void openUrl(href).catch(() => {});
      } else {
        window.open(href, "_blank", "noopener");
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

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
          // The inspector drawer is gated on contextOpen (not toolsOpen) —
          // open it exclusively, then select the Desktop tab.
          setPreviewOpen(false);
          setTerminalOpen(false);
          setToolsOpen(false);
          setContextOpen(true);
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
          if (snap?.id) stopRun(snap.id);
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
      } else if (meta && e.key.toLowerCase() === "f" && !e.shiftKey) {
        // ⌘F — search recent conversations (advertised in the ⌘K palette).
        e.preventDefault();
        historySearchInputRef.current?.focus();
        historySearchInputRef.current?.select();
      } else if (e.key === "/" && !meta && !e.altKey) {
        // "/" — focus the composer (advertised in the ⌘K palette), but never
        // while the user is typing in another field.
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag !== "textarea" && tag !== "input") {
          e.preventDefault();
          composerRef.current?.focus();
        }
      } else if (e.key === "Escape") {
        // Esc closes whatever transient surface is open: palette first, then
        // any open dock panel (Preview / Context / Terminal / Tools). Without
        // this, Esc did nothing for the panels — they could only be closed by
        // toggling them off again.
        if (paletteOpen) {
          setPaletteOpen(false);
        } else if (previewOpen || contextOpen || terminalOpen || toolsOpen) {
          e.preventDefault();
          setPreviewOpen(false);
          setContextOpen(false);
          setTerminalOpen(false);
          setToolsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, previewOpen, contextOpen, terminalOpen, toolsOpen]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.dockPosition, dockPosition);
  }, [dockPosition]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.inspectorTab, inspectorTab);
  }, [inspectorTab]);

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
        run: () => switchToSession(p.id),
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
            // Callback ref instead of autoFocus: React's autoFocus doesn't
            // reliably grab focus in the production WebView when the input
            // appears via a state change (the composer kept focus, so typed
            // text went there instead of here). Focusing on mount is robust.
            ref={(el) => {
              if (el) {
                el.focus();
                el.select();
              }
            }}
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
        className={`history-row${item.pinned ? " pinned" : ""}${item.active ? " active" : ""}`}
        key={item.id}
        onClick={() => switchToSession(item.id)}
        onContextMenu={(e) => openHistoryMenu(e, item)}
        title="Open this conversation · right-click for actions"
        type="button"
        aria-current={item.active ? "true" : undefined}
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

  // Refresh the static preview when a streaming grok run finishes. The main
  // chat path (enqueue_run) never touches lastRun, so keying only on it left
  // the Preview panel stale after exactly the runs it exists to showcase
  // ("ask Grok to create index.html…"). Watch the running→not-running edge.
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !grokIsRunning) void refreshStaticPreview();
    wasRunningRef.current = grokIsRunning;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grokIsRunning]);

  const messageRefs: MessageRef[] = useMemo(
    () =>
      messages.map((m) =>
        m.role === "user"
          ? { runId: "", role: "user" as const, userText: m.content, id: m.id }
          : {
              // Live runs keep their real id; restored/legacy assistant
              // messages get a STABLE synthetic id (msg:<id>) so MessageItem
              // can key their worker-rendered markdown HTML and they don't all
              // collide on "". fallbackText still feeds the worker + the
              // plain-text fallback while parsing.
              runId: m.runId || `msg:${m.id}`,
              role: "assistant" as const,
              fallbackText: m.content,
              id: m.id,
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
        appVersion="0.4.0"
        grokVersionLine={`Grok CLI ${grokStatus?.version ?? "unknown"}`}
      />
      <ToolsPage open={toolsPageOpen} onClose={() => setToolsPageOpen(false)} cwd={codingCwd} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <aside className="app-sidebar">
        <div className="brand">
          <div className="brand-mark"><BrandGlyph size={18} /></div>
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
            <span>Conversations</span>
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
              placeholder="Search conversations..."
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
                  <span>Your conversations will show up here.</span>
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
          <div className={`avatar${isGrokReady ? " ready" : ""}`}><BrandGlyph size={17} /></div>
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
                onClick={() => stopRun(activeRunId)}
                type="button"
                title="Stop the current run"
              >
                <X size={15} />
                <span>Stop</span>
              </button>
            ) : (
              <span
                className={`conn-pill ${isGrokReady ? "ready" : "blocked"}`}
                title={isGrokReady ? "Connected to grok.com" : `Grok ${statusLabel.toLowerCase()}`}
                aria-label={isGrokReady ? "Grok connected" : "Grok not connected"}
              >
                <span className="conn-dot-mini" aria-hidden />
                {isGrokReady ? "Grok" : "Offline"}
              </span>
            )}
            {/* Day / night theme toggle (also ⌘⇧L). Bordered + full-contrast
                sun/moon so it reads as a control, not a stray dot. */}
            <button
              className="titlebar-icon-btn theme-toggle"
              type="button"
              aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={themeMode === "dark" ? "Switch to light mode (⌘⇧L)" : "Switch to dark mode (⌘⇧L)"}
              onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            >
              {themeMode === "dark" ? (
                <Sun size={17} strokeWidth={2.25} />
              ) : (
                <Moon size={17} strokeWidth={2.25} />
              )}
            </button>
            {/* Panels menu — Preview / Context / Terminal / Tools, each opens
                its panel (Claude-Desktop-style). */}
            <button
              className={`detail-toggle${contextOpen || previewOpen || terminalOpen || toolsOpen ? " active" : ""}`}
              type="button"
              aria-label="Open panels menu"
              title="Panels — Preview, Context, Terminal"
              onClick={openPanelMenu}
            >
              <PanelRight size={16} />
              <ChevronDown size={11} className="detail-caret" />
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
            {/* Scroll position is owned by MessageList's Virtuoso instance —
                this div only provides the flex sizing for it. */}
            <div className="conversation-scroll">
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

            {sessionNotice ? (
              <div className="session-toast" role="status">{sessionNotice}</div>
            ) : null}

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
                argsBuilder={buildRunArgs}
                initialValue={drafts[mode] || defaultDrafts[mode]}
                placeholder={modeCopy[mode].placeholder}
                onTextChange={(text) => {
                  setDrafts((current) => ({ ...current, [mode]: text }));
                }}
                onEnqueued={handleEnqueued}
                onError={(message) => setSessionNotice(`Send failed: ${message}`)}
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
                {/* Raw grok --permission-mode lives in Settings → Permissions
                    (advanced). The composer footer uses the friendlier "Action
                    policy" (Review/Plan/Patch/Autopilot) as the single
                    permission control, so the two no longer overlap. */}
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
                  ↵ Send · ⇧↵ Newline
                </span>
                {grokIsRunning && activeRunId ? (
                  <button
                    className="mini-run"
                    onClick={() => stopRun(activeRunId)}
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
                onClick={() => setContextOpen(false)}
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
            <small>Browser, Absorb Repo</small>
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
