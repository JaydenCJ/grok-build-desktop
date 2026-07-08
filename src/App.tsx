import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ChevronDown,
  FolderGit2,
  Globe2,
  Loader2,
  Moon,
  PanelRight,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import "./App.css";
import { cancelRun, ensureStreamListenersAttached } from "./lib/grok";
import { hasTauriRuntime } from "./lib/runtime";
import { streamStore } from "./lib/streamStore";
import { MessageList, type MessageRef } from "./components/MessageList";
import { Composer, type ComposerHandle } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { QueueDock } from "./components/QueueDock";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { SettingsPage } from "./components/SettingsPage";
import { ToolsPage } from "./components/ToolsPage";
import { ContextMenu, type ContextMenuState, type ContextMenuItem } from "./components/ContextMenu";
import { InspectorDrawer } from "./components/InspectorDrawer";
import { Sidebar } from "./components/Sidebar";
import { EmptyState } from "./components/EmptyState";
import { PreviewPanel } from "./components/PreviewPanel";
import { TerminalDock } from "./components/TerminalDock";
import { Toolbelt } from "./components/Toolbelt";
import { WorkspaceStatusBar } from "./components/WorkspaceStatusBar";
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
  type InspectorTab,
  type Mode,
  type PermissionMode,
  type ReasoningEffort,
} from "./app/types";
import {
  actionPolicies,
  codingPresets,
  defaultDrafts,
  effortLevels,
  grokModelPresets,
  modeCopy,
  permissionModes,
  reasoningEfforts,
  storageKeys,
} from "./app/constants";
import {
  formatOutput,
  makeId,
} from "./app/format";
import { buildGrokArgs } from "./app/grokArgs";

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
  // row views) lives in hooks/useHistoryOrganization.ts; the Sidebar consumes
  // the whole API object, App only needs these three.
  const historyApi = useHistoryOrganization({
    tabs,
    activeTabId,
    messages,
    sessionFirstPrompt,
    closeContextMenu: () => setContextMenu(null),
  });
  const { recentPrompts, historySearchInputRef, removeConversationMeta } = historyApi;
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
  const runners = useGrokRunners({
    codingCwd,
    shellCommand,
    lastRun,
    recordRun,
    setLastRun,
    setCodingCwd,
    setSessionNotice,
    onPreviewAvailable: () => setPreviewOpen(true),
  });
  const {
    statuses,
    grokStatus,
    staticPreview,
    previewBusy,
    availableModels,
    busyRunner,
    terminalLines,
    setTerminalLines,
    folderPickerBusy,
    refreshStatuses,
    refreshStaticPreview,
    runShell,
    runDoctor,
    pickFolder,
  } = runners;

  const statusMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  // Model + run-configuration state (preset, efforts, permission, toggles,
  // CLI-verified options, coding auto-snap) lives in hooks/useModelConfig.ts.
  const modelConfig = useModelConfig({ mode, availableModels });
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
    changeModelPreset,
    modelOptions,
    modelIsVerified,
  } = modelConfig;
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
  // Project name shown in the minimal top bar (basename of the cwd).
  const repoName = useMemo(() => {
    const trimmed = codingCwd.trim().replace(/\/+$/, "");
    if (!trimmed) return "Pick a project";
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || trimmed;
  }, [codingCwd]);

  const grokToolStatus = statusMap.grok;
  const isGrokReady = Boolean(grokStatus?.authenticated);
  const statusLabel = grokStatus?.authenticated
    ? "Connected"
    : grokStatus?.installed
      ? "Login needed"
      : "Connect needed";
  const workspacePath = codingCwd.trim() || "No project selected";
  const terminalDisplay = terminalLines.length > 0
    ? terminalLines
    : formatOutput(lastRun)
        .split("\n")
        .slice(0, 80)
        .map((line) => `[out] ${line}`);
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
      <Sidebar
        history={historyApi}
        sessionFirstPrompt={sessionFirstPrompt}
        switchToSession={switchToSession}
        deleteSession={deleteSession}
        handleTabCreate={handleTabCreate}
        focusComposer={() => composerRef.current?.focus()}
        setContextMenu={setContextMenu}
        paletteOpen={paletteOpen}
        setPaletteOpen={setPaletteOpen}
        toolsPageOpen={toolsPageOpen}
        setToolsPageOpen={setToolsPageOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        busyRunner={busyRunner}
        refreshStatuses={refreshStatuses}
        runDoctor={runDoctor}
        grokToolStatus={grokToolStatus}
        isGrokReady={isGrokReady}
        activeModel={activeModel}
        statusLabel={statusLabel}
      />
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
                <EmptyState
                  activeModel={activeModel}
                  onPickStarter={(prompt) => updatePrompt(prompt)}
                />
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

          <PreviewPanel
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            staticPreview={staticPreview}
            previewBusy={previewBusy}
            onRefresh={() => refreshStaticPreview()}
          />
          <InspectorDrawer
            open={contextOpen}
            onOpenPanel={() => togglePanel("context")}
            onClose={() => setContextOpen(false)}
            inspectorTab={inspectorTab}
            setInspectorTab={setInspectorTab}
            dockPosition={dockPosition}
            onDockPositionChange={(next) => {
              setDockPosition(next);
              window.localStorage.setItem(storageKeys.dockPosition, next);
            }}
            runners={runners}
            modelConfig={modelConfig}
            actionPolicy={actionPolicy}
            setActionPolicy={setActionPolicy}
            history={history}
            lastRun={lastRun}
            setLastRun={setLastRun}
            clearRunHistory={clearRunHistory}
            workspacePath={workspacePath}
            onInsertDesktopContext={(text) => {
              // Append into the active mode's draft so it lands in Composer
              // on next render.
              const next = (drafts[mode] ?? "") + text;
              setDrafts((current) => ({ ...current, [mode]: next }));
              composerRef.current?.setValue(next);
              setSessionNotice("Desktop context appended to your draft.");
            }}
          />
        </section>

        <TerminalDock
          open={terminalOpen}
          onOpenPanel={() => togglePanel("terminal")}
          onClose={() => setTerminalOpen(false)}
          dockPosition={dockPosition}
          setDockPosition={setDockPosition}
          busyRunner={busyRunner}
          shellCommand={shellCommand}
          setShellCommand={setShellCommand}
          runShell={runShell}
          sessionNotice={sessionNotice}
          terminalDisplay={terminalDisplay}
        />
        <Toolbelt
          open={toolbeltOpen}
          onToggle={setToolbeltOpen}
          runners={runners}
        />
        <WorkspaceStatusBar
          workspacePath={workspacePath}
          folderPickerBusy={folderPickerBusy}
          pickFolder={pickFolder}
          activeModel={activeModel}
          modelIsVerified={modelIsVerified}
          actionPolicy={actionPolicy}
          openModelSettings={() => {
            setSettingsSection("model");
            setSettingsOpen(true);
          }}
          openPermissionSettings={() => {
            setSettingsSection("permissions");
            setSettingsOpen(true);
          }}
          grokIsRunning={grokIsRunning}
          lastRun={lastRun}
          totalRuns={totalRuns}
          isGrokReady={isGrokReady}
          messagesCount={messages.length}
          historyCount={history.length}
          clearRunHistory={clearRunHistory}
        />
      </section>
    </main>
  );
}

export default App;
