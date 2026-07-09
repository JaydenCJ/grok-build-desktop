import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Globe2, PanelRight, TerminalSquare } from 'lucide-react';
import './App.css';
import { cancelRun, ensureStreamListenersAttached } from './lib/grok';
import { hasTauriRuntime } from './lib/runtime';
import { streamStore } from './lib/streamStore';
import { MessageList, type MessageRef } from './components/MessageList';
import type { ComposerHandle } from './components/Composer';
import { StatusBar } from './components/StatusBar';
import { QueueDock } from './components/QueueDock';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { ToolsPage } from './components/ToolsPage';
import { ContextMenu, type ContextMenuState, type ContextMenuItem } from './components/ContextMenu';
import { InspectorDrawer } from './components/InspectorDrawer';
import { Sidebar } from './components/Sidebar';
import { EmptyState } from './components/EmptyState';
import { PreviewPanel } from './components/PreviewPanel';
import { TerminalDock } from './components/TerminalDock';
import { Toolbelt } from './components/Toolbelt';
import { WorkspaceStatusBar } from './components/WorkspaceStatusBar';
import { TitleBar } from './components/TitleBar';
import { ComposerSection } from './components/ComposerSection';
import { SettingsHost } from './components/SettingsHost';
import { useActiveRun } from './hooks/useActiveRun';
import { useGrokRunners } from './hooks/useGrokRunners';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useModelConfig } from './hooks/useModelConfig';
import { useSessionTabs } from './hooks/useSessionTabs';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useHistoryOrganization } from './hooks/useHistoryOrganization';

import {
  isDockPosition,
  isInspectorTab,
  type ChatMessageStatus,
  type DockPosition,
  type InspectorTab,
  type Mode,
} from './app/types';
import { codingPresets, defaultDrafts, storageKeys } from './app/constants';
import { t } from './i18n';
import { formatOutput, makeId } from './app/format';
import { buildGrokArgs } from './app/grokArgs';

function App() {
  // The textarea lives inside Composer (uncontrolled ref). We hold a
  // ComposerHandle so starter cards / history clicks / drafts can seed it.
  const composerRef = useRef<ComposerHandle | null>(null);
  const setComposerValue = useCallback((value: string) => {
    composerRef.current?.setValue(value);
  }, []);
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
  const { tabs, activeTabId, handleTabCreate, switchToSession, deleteSession, sessionFirstPrompt } =
    useSessionTabs({
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
  const [settingsSection, setSettingsSection] = useState<
    'general' | 'model' | 'permissions' | 'integrations' | 'about'
  >('general');
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
    return window.localStorage.getItem('grok-desktop-sidebar-collapsed') === '1';
  });
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = window.localStorage.getItem(storageKeys.dockPosition);
    return isDockPosition(stored) ? stored : 'right';
  });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    const stored = window.localStorage.getItem(storageKeys.inspectorTab);
    return isInspectorTab(stored) ? stored : 'skills';
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
      setSessionNotice(
        t('notices.stopFailed', { error: error instanceof Error ? error.message : String(error) }),
      );
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
    effortLevel,
    reasoningEffort,
    permissionMode,
    bestOfN,
    experimentalMemory,
    webSearchEnabled,
    subagentsEnabled,
    selfCheck,
    activeModel,
    modelIsVerified,
  } = modelConfig;
  function clearRunHistory() {
    setLastRun(null);
    setHistory([]);
    setMessages([]);
    setTerminalLines([]);
    setTotalRuns(0);
    window.localStorage.setItem('grok-desktop-run-count-total', '0');
    setSessionNotice(t('notices.cleared'));
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
          if (message.role !== 'assistant' || !message.runId || message.status !== 'streaming') {
            return message;
          }
          const snap = streamStore.getRunSnapshot(message.runId);
          if (!snap || snap.state === 'queued' || snap.state === 'running') return message;
          changed = true;
          const status: ChatMessageStatus =
            snap.state === 'done' ? 'done' : snap.state === 'cancelled' ? 'stopped' : 'error';
          return { ...message, content: snap.text || message.content, status };
        });
        return changed ? next : current;
      });
    };
    finalizeEndedRuns();
    return streamStore.subscribe(finalizeEndedRuns);
  }, [setMessages]);

  function updatePrompt(value: string) {
    setComposerValue(value);
    setDrafts((current) => ({ ...current, [mode]: value }));
  }
  // Right-click menu for the conversation area — real, clickable actions
  // (replaces the suppressed WebView menu). Selection-aware.
  function openConversationMenu(e: React.MouseEvent) {
    e.preventDefault();
    const selection = window.getSelection()?.toString().trim() ?? '';
    const items: ContextMenuItem[] = [];
    if (selection) {
      items.push({
        label: 'Copy',
        onClick: () => void navigator.clipboard?.writeText(selection),
      });
    }
    items.push(
      {
        label: 'New session',
        separator: selection.length > 0,
        onClick: () => {
          handleTabCreate();
          composerRef.current?.focus();
        },
      },
      {
        label: 'Clear conversation',
        disabled: messages.length === 0,
        onClick: () => clearRunHistory(),
      },
      ...(grokIsRunning && activeRunId
        ? [{ label: 'Stop current run', danger: true, onClick: () => stopRun(activeRunId) }]
        : []),
      { label: 'Settings…', separator: true, onClick: () => setSettingsOpen(true) },
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

  function handleEnqueued(info: {
    runId: string;
    position: number;
    prompt: string;
    rawText?: string;
  }) {
    const now = Date.now();
    const userMessageId = makeId('u');
    const assistantMessageId = makeId('a');
    appendMessage({
      id: userMessageId,
      role: 'user',
      // Show what the user ACTUALLY typed, not the sent prompt. The Composer
      // appends expanded @-mention file contents for grok's benefit — that
      // belongs in the request, not in the chat bubble. rawText is the clean
      // original; fall back to prompt only for callers that don't pass it.
      content: info.rawText ?? info.prompt,
      ts: now,
      meta: { workflow: mode === 'coding' ? codingWorkflow : 'chat' },
    });
    appendMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      ts: now,
      runId: info.runId,
      status: 'streaming',
      meta: { model: activeModel, workflow: mode === 'coding' ? codingWorkflow : 'chat' },
    });
    setTotalRuns((current) => {
      const next = current + 1;
      window.localStorage.setItem('grok-desktop-run-count-total', String(next));
      return next;
    });
    if (info.position > 0) {
      console.log(`[grok-desktop] queued at position ${info.position}`);
    }
  }

  function togglePanel(target: 'preview' | 'context' | 'terminal' | 'tools') {
    const next = !(target === 'preview'
      ? previewOpen
      : target === 'context'
        ? contextOpen
        : target === 'terminal'
          ? terminalOpen
          : toolsOpen);
    setPreviewOpen(target === 'preview' ? next : false);
    setContextOpen(target === 'context' ? next : false);
    setTerminalOpen(target === 'terminal' ? next : false);
    setToolsOpen(target === 'tools' ? next : false);
    if (next && target === 'preview') void refreshStaticPreview();
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
        {
          label: 'Preview',
          icon: <Globe2 size={15} />,
          shortcut: previewOpen ? '✓' : undefined,
          onClick: () => togglePanel('preview'),
        },
        {
          label: 'Context inspector',
          icon: <PanelRight size={15} />,
          shortcut: contextOpen ? '✓' : undefined,
          onClick: () => togglePanel('context'),
        },
        {
          label: 'Terminal',
          icon: <TerminalSquare size={15} />,
          shortcut: terminalOpen ? '✓' : undefined,
          onClick: () => togglePanel('terminal'),
        },
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
        t('notices.liveUpdatesUnavailable', {
          error: error instanceof Error ? error.message : String(error),
        }),
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
      const anchor = target?.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      if (hasTauriRuntime()) {
        void openUrl(href).catch(() => {});
      } else {
        window.open(href, '_blank', 'noopener');
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Persist sidebar-collapsed state so ⌘B is sticky across reloads.
  useEffect(() => {
    window.localStorage.setItem('grok-desktop-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);
  // ⌘K palette catalogue + global keyboard shortcuts live in
  // hooks/useAppShortcuts.ts.
  const { paletteActions } = useAppShortcuts({
    paletteOpen,
    setPaletteOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    previewOpen,
    setPreviewOpen,
    contextOpen,
    setContextOpen,
    terminalOpen,
    setTerminalOpen,
    toolsOpen,
    setToolsOpen,
    setToolsPageOpen,
    setSettingsOpen,
    setInspectorTab,
    themeMode,
    setThemeMode,
    togglePanel,
    handleTabCreate,
    clearRunHistory,
    focusComposer: () => composerRef.current?.focus(),
    focusHistorySearch: () => {
      historySearchInputRef.current?.focus();
      historySearchInputRef.current?.select();
    },
    stopRun,
    switchMode,
    busyRunner,
    drafts,
    mode,
  });
  useEffect(() => {
    window.localStorage.setItem(storageKeys.dockPosition, dockPosition);
  }, [dockPosition]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.inspectorTab, inspectorTab);
  }, [inspectorTab]);

  // Make ⌘K Search actually search the user's WORK, not just commands: each
  // recent prompt becomes a searchable palette entry that restores it to the
  // composer. (Search previously only filtered the command list, so typing a
  // topic keyword found nothing — "search doesn't work".)
  const historyPaletteActions = useMemo<PaletteAction[]>(
    () =>
      recentPrompts.slice(0, 50).map((p) => ({
        id: `history-${p.id}`,
        label: p.title,
        hint: p.detail ? `History · ${p.detail}` : 'History',
        group: 'History',
        run: () => switchToSession(p.id),
      })),
    [recentPrompts, switchToSession],
  );
  const allPaletteActions = useMemo(
    () => [...paletteActions, ...historyPaletteActions],
    [paletteActions, historyPaletteActions],
  );
  // Project name shown in the minimal top bar (basename of the cwd).
  const repoName = useMemo(() => {
    const trimmed = codingCwd.trim().replace(/\/+$/, '');
    if (!trimmed) return 'Pick a project';
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }, [codingCwd]);

  const grokToolStatus = statusMap.grok;
  const isGrokReady = Boolean(grokStatus?.authenticated);
  const statusLabel = grokStatus?.authenticated
    ? 'Connected'
    : grokStatus?.installed
      ? 'Login needed'
      : 'Connect needed';
  const workspacePath = codingCwd.trim() || 'No project selected';
  const terminalDisplay =
    terminalLines.length > 0
      ? terminalLines
      : formatOutput(lastRun)
          .split('\n')
          .slice(0, 80)
          .map((line) => `[out] ${line}`);
  const activeRun = useActiveRun();
  const grokIsRunning = Boolean(activeRun && activeRun.state === 'running');
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
        m.role === 'user'
          ? { runId: '', role: 'user' as const, userText: m.content, id: m.id }
          : {
              // Live runs keep their real id; restored/legacy assistant
              // messages get a STABLE synthetic id (msg:<id>) so MessageItem
              // can key their worker-rendered markdown HTML and they don't all
              // collide on "". fallbackText still feeds the worker + the
              // plain-text fallback while parsing.
              runId: m.runId || `msg:${m.id}`,
              role: 'assistant' as const,
              fallbackText: m.content,
              id: m.id,
            },
      ),
    [messages],
  );
  return (
    <main className={`app-shell theme-${themeMode}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <CommandPalette
        open={paletteOpen}
        actions={allPaletteActions}
        onClose={() => setPaletteOpen(false)}
      />
      <SettingsHost
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
        modelConfig={modelConfig}
        actionPolicy={actionPolicy}
        setActionPolicy={setActionPolicy}
        codingCwd={codingCwd}
        setCodingCwd={setCodingCwd}
        onPickFolder={() => void pickFolder()}
        grokVersionLine={`Grok CLI ${grokStatus?.version ?? 'unknown'}`}
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
        <TitleBar
          codingCwd={codingCwd}
          repoName={repoName}
          folderPickerBusy={folderPickerBusy}
          pickFolder={pickFolder}
          grokIsRunning={grokIsRunning}
          activeRunId={activeRunId}
          stopRun={stopRun}
          isGrokReady={isGrokReady}
          statusLabel={statusLabel}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          anyPanelOpen={contextOpen || previewOpen || terminalOpen || toolsOpen}
          openPanelMenu={openPanelMenu}
        />
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
              <div className="session-toast" role="status">
                {sessionNotice}
              </div>
            ) : null}

            <QueueDock
              onError={(message) =>
                setSessionNotice(t('notices.queueActionFailed', { error: message }))
              }
            />
            <StatusBar />

            <ComposerSection
              composerRef={composerRef}
              codingCwd={codingCwd}
              buildRunArgs={buildRunArgs}
              drafts={drafts}
              mode={mode}
              setDrafts={setDrafts}
              switchMode={switchMode}
              handleEnqueued={handleEnqueued}
              setSessionNotice={setSessionNotice}
              modelConfig={modelConfig}
              availableModels={availableModels}
              actionPolicy={actionPolicy}
              setActionPolicy={setActionPolicy}
              codingWorkflow={codingWorkflow}
              applyCodingPreset={applyCodingPreset}
              grokIsRunning={grokIsRunning}
              activeRunId={activeRunId}
              stopRun={stopRun}
            />
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
            onOpenPanel={() => togglePanel('context')}
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
              const next = (drafts[mode] ?? '') + text;
              setDrafts((current) => ({ ...current, [mode]: next }));
              composerRef.current?.setValue(next);
              setSessionNotice(t('notices.desktopContextAppended'));
            }}
          />
        </section>

        <TerminalDock
          open={terminalOpen}
          onOpenPanel={() => togglePanel('terminal')}
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
        <Toolbelt open={toolbeltOpen} onToggle={setToolbeltOpen} runners={runners} />
        <WorkspaceStatusBar
          workspacePath={workspacePath}
          folderPickerBusy={folderPickerBusy}
          pickFolder={pickFolder}
          activeModel={activeModel}
          modelIsVerified={modelIsVerified}
          actionPolicy={actionPolicy}
          openModelSettings={() => {
            setSettingsSection('model');
            setSettingsOpen(true);
          }}
          openPermissionSettings={() => {
            setSettingsSection('permissions');
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
