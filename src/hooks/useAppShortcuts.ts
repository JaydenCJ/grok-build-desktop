// The command-palette catalogue and global keyboard shortcuts (⌘K palette,
// ⌘B sidebar, ⌘, settings, ⌘⇧L theme, ⌘N new session, ⌘F history search,
// "/" composer focus, Esc panel dismissal, ⌘1/⌘2 mode switch). Extracted
// from App.tsx unchanged; DOM focus targets arrive as callbacks.
import { useEffect, useMemo, useRef } from 'react';
import type { PaletteAction } from '../components/CommandPalette';
import { streamStore } from '../lib/streamStore';
import type { InspectorTab, Mode, ThemeMode } from '../app/types';
import { t } from '../i18n';

export interface AppShortcutsDeps {
  paletteOpen: boolean;
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
  contextOpen: boolean;
  setContextOpen: (open: boolean) => void;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
  setToolsPageOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  themeMode: ThemeMode;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  togglePanel: (target: 'preview' | 'context' | 'terminal' | 'tools') => void;
  handleTabCreate: () => void;
  clearRunHistory: () => void;
  focusComposer: () => void;
  focusHistorySearch: () => void;
  stopRun: (runId: string) => void;
  switchMode: (mode: Mode) => void;
  busyRunner: string | null;
  drafts: Record<Mode, string>;
  mode: Mode;
}

export function useAppShortcuts(deps: AppShortcutsDeps) {
  const {
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
    focusComposer,
    focusHistorySearch,
    stopRun,
    switchMode,
    busyRunner,
    drafts,
    mode,
  } = deps;

  // Always-fresh mirror of clearRunHistory. The palette catalogue below is
  // memoized on a narrow dep list, so its action closures go stale — running
  // "Clear current conversation" from ⌘K would snapshot the FIRST render's
  // (empty) messages for its undo, and undo would restore nothing. The other
  // stale-prone actions already guard themselves (handleTabCreate via
  // sessionStateRef, cancel-run via streamStore).
  const clearRunHistoryRef = useRef(clearRunHistory);
  clearRunHistoryRef.current = clearRunHistory;

  // ── Command palette catalogue ────────────────────────────────────────────
  // Every action here is reachable both through ⌘K and (where applicable) a
  // direct button in the UI. Keep them in sync — adding an action here is
  // the cheapest way to make a new feature discoverable.
  const paletteActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        id: 'new-session',
        label: t('palette.action.newSession'),
        hint: t('palette.action.newSessionHint'),
        shortcut: '⌘N',
        group: t('palette.group.session'),
        run: () => handleTabCreate(),
      },
      {
        id: 'clear-conversation',
        label: t('palette.action.clearConversation'),
        hint: t('palette.action.clearConversationHint'),
        group: t('palette.group.session'),
        run: () => clearRunHistoryRef.current(),
      },
      {
        id: 'focus-composer',
        label: t('palette.action.focusComposer'),
        shortcut: '/',
        group: t('palette.group.navigation'),
        run: () => focusComposer(),
      },
      {
        id: 'search-history',
        label: t('palette.action.searchHistory'),
        shortcut: '⌘F',
        group: t('palette.group.navigation'),
        run: () => focusHistorySearch(),
      },
      {
        id: 'toggle-sidebar',
        label: sidebarCollapsed
          ? t('palette.action.expandSidebar')
          : t('palette.action.collapseSidebar'),
        shortcut: '⌘B',
        group: t('palette.group.view'),
        run: () => setSidebarCollapsed((v) => !v),
      },
      {
        id: 'open-tools',
        label: t('palette.action.openTools'),
        group: t('palette.group.view'),
        run: () => setToolsPageOpen(true),
      },
      {
        id: 'toggle-preview',
        label: previewOpen ? t('palette.action.closePreview') : t('palette.action.openPreview'),
        group: t('palette.group.view'),
        run: () => togglePanel('preview'),
      },
      {
        id: 'toggle-context',
        label: contextOpen ? t('palette.action.closeContext') : t('palette.action.openContext'),
        group: t('palette.group.view'),
        run: () => togglePanel('context'),
      },
      {
        id: 'toggle-terminal',
        label: terminalOpen ? t('palette.action.closeTerminal') : t('palette.action.openTerminal'),
        group: t('palette.group.view'),
        run: () => togglePanel('terminal'),
      },
      {
        id: 'toggle-theme',
        label: themeMode === 'dark' ? t('titleBar.toLight') : t('titleBar.toDark'),
        shortcut: '⌘⇧L',
        group: t('palette.group.theme'),
        run: () => setThemeMode(themeMode === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'open-desktop-bridge',
        label: t('palette.action.openDesktopBridge'),
        hint: t('palette.action.openDesktopBridgeHint'),
        group: t('palette.group.view'),
        run: () => {
          // The inspector drawer is gated on contextOpen (not toolsOpen) —
          // open it exclusively, then select the Desktop tab.
          setPreviewOpen(false);
          setTerminalOpen(false);
          setToolsOpen(false);
          setContextOpen(true);
          setInspectorTab('desktop');
        },
      },
      {
        id: 'open-settings',
        label: t('palette.action.openSettings'),
        shortcut: '⌘,',
        group: t('palette.group.view'),
        run: () => setSettingsOpen(true),
      },
      {
        id: 'cancel-run',
        label: t('palette.action.cancelRun'),
        group: t('palette.group.run'),
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
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      } else if (meta && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setThemeMode((t) => (t === 'dark' ? 'light' : 'dark'));
      } else if (meta && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        // Don't steal the system "New Window" shortcut if the user is in a
        // textarea (composer). Only act when focus is elsewhere.
        const tag = (document.activeElement?.tagName ?? '').toLowerCase();
        if (tag !== 'textarea' && tag !== 'input') {
          e.preventDefault();
          handleTabCreate();
        }
      } else if (meta && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        // ⌘F — search recent conversations (advertised in the ⌘K palette).
        e.preventDefault();
        focusHistorySearch();
      } else if (e.key === '/' && !meta && !e.altKey) {
        // "/" — focus the composer (advertised in the ⌘K palette), but never
        // while the user is typing in another field.
        const tag = (document.activeElement?.tagName ?? '').toLowerCase();
        if (tag !== 'textarea' && tag !== 'input') {
          e.preventDefault();
          focusComposer();
        }
      } else if (e.key === 'Escape') {
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, previewOpen, contextOpen, terminalOpen, toolsOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || busyRunner !== null) return;
      if (event.key === '1') {
        event.preventDefault();
        switchMode('standard');
      }
      if (event.key === '2') {
        event.preventDefault();
        switchMode('coding');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busyRunner, drafts, mode, switchMode]);

  return { paletteActions };
}
