// Behavior tests for useAppShortcuts: the ⌘K palette catalogue (labels track
// state, run callbacks route to the right dependency, the clear-conversation
// action never goes stale) and the two global keydown routers (⌘K/⌘B/⌘,/⌘⇧L/
// ⌘N/⌘F//"/"/Esc and ⌘1/⌘2 mode switching, including the guards that keep
// shortcuts from firing while typing or while a runner is busy).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { useAppShortcuts, type AppShortcutsDeps } from '../useAppShortcuts';
import { replaceQueue, streamStore } from '../../lib/streamStore';
import { t } from '../../i18n';

function makeDeps(overrides: Partial<AppShortcutsDeps> = {}): AppShortcutsDeps {
  return {
    paletteOpen: false,
    setPaletteOpen: vi.fn(),
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    previewOpen: false,
    setPreviewOpen: vi.fn(),
    contextOpen: false,
    setContextOpen: vi.fn(),
    terminalOpen: false,
    setTerminalOpen: vi.fn(),
    toolsOpen: false,
    setToolsOpen: vi.fn(),
    setToolsPageOpen: vi.fn(),
    setSettingsOpen: vi.fn(),
    setInspectorTab: vi.fn(),
    themeMode: 'dark',
    setThemeMode: vi.fn(),
    togglePanel: vi.fn(),
    handleTabCreate: vi.fn(),
    clearRunHistory: vi.fn(),
    focusComposer: vi.fn(),
    focusHistorySearch: vi.fn(),
    stopRun: vi.fn(),
    switchMode: vi.fn(),
    busyRunner: null,
    drafts: { standard: '', coding: '' },
    mode: 'coding',
    ...overrides,
  };
}

function renderShortcuts(overrides: Partial<AppShortcutsDeps> = {}) {
  const deps = makeDeps(overrides);
  const view = renderHook((p: AppShortcutsDeps) => useAppShortcuts(p), {
    initialProps: deps,
  });
  const action = (id: string) => {
    const found = view.result.current.paletteActions.find((a) => a.id === id);
    if (!found) throw new Error(`no palette action ${id}`);
    return found;
  };
  return { deps, action, ...view };
}

beforeEach(() => {
  streamStore.__reset();
});

describe('palette catalogue', () => {
  it('labels flip with the state they describe', () => {
    const { action, deps, rerender } = renderShortcuts();
    expect(action('toggle-sidebar').label).toBe(t('palette.action.collapseSidebar'));
    expect(action('toggle-preview').label).toBe(t('palette.action.openPreview'));
    expect(action('toggle-theme').label).toBe(t('titleBar.toLight'));

    rerender({ ...deps, sidebarCollapsed: true, previewOpen: true, themeMode: 'light' });
    expect(action('toggle-sidebar').label).toBe(t('palette.action.expandSidebar'));
    expect(action('toggle-preview').label).toBe(t('palette.action.closePreview'));
    expect(action('toggle-theme').label).toBe(t('titleBar.toDark'));
  });

  it('routes every run callback to the matching dependency', () => {
    const { action, deps } = renderShortcuts();

    action('new-session').run();
    expect(deps.handleTabCreate).toHaveBeenCalledTimes(1);

    action('focus-composer').run();
    expect(deps.focusComposer).toHaveBeenCalledTimes(1);

    action('search-history').run();
    expect(deps.focusHistorySearch).toHaveBeenCalledTimes(1);

    action('open-tools').run();
    expect(deps.setToolsPageOpen).toHaveBeenCalledWith(true);

    action('open-settings').run();
    expect(deps.setSettingsOpen).toHaveBeenCalledWith(true);

    action('toggle-preview').run();
    expect(deps.togglePanel).toHaveBeenCalledWith('preview');
    action('toggle-context').run();
    expect(deps.togglePanel).toHaveBeenCalledWith('context');
    action('toggle-terminal').run();
    expect(deps.togglePanel).toHaveBeenCalledWith('terminal');

    // Sidebar toggle passes a functional updater.
    action('toggle-sidebar').run();
    const updater = (deps.setSidebarCollapsed as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      v: boolean,
    ) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);

    // Theme action computes the next theme from the memoized snapshot.
    action('toggle-theme').run();
    expect(deps.setThemeMode).toHaveBeenCalledWith('light');
  });

  it('open-desktop-bridge opens the inspector exclusively on the Desktop tab', () => {
    const { action, deps } = renderShortcuts();
    action('open-desktop-bridge').run();
    expect(deps.setPreviewOpen).toHaveBeenCalledWith(false);
    expect(deps.setTerminalOpen).toHaveBeenCalledWith(false);
    expect(deps.setToolsOpen).toHaveBeenCalledWith(false);
    expect(deps.setContextOpen).toHaveBeenCalledWith(true);
    expect(deps.setInspectorTab).toHaveBeenCalledWith('desktop');
  });

  it('cancel-run stops the active run read from the streamStore at fire time', () => {
    const { action, deps } = renderShortcuts();

    // No active run → nothing to stop.
    action('cancel-run').run();
    expect(deps.stopRun).not.toHaveBeenCalled();

    // An active run appears AFTER the catalogue was memoized — the action must
    // still find it (it reads the store, not a stale closure).
    streamStore.patchRun('run-77', { state: 'running' });
    replaceQueue({ active: 'run-77', items: [] });
    action('cancel-run').run();
    expect(deps.stopRun).toHaveBeenCalledWith('run-77');
  });

  it('clear-conversation always calls the LATEST clearRunHistory (stale-closure guard)', () => {
    const first = vi.fn();
    const { deps, rerender, action } = renderShortcuts({ clearRunHistory: first });
    // Rerender with a new closure but none of the memo deps changed — the
    // catalogue object is the same, yet the action must use the new function.
    const second = vi.fn();
    rerender({ ...deps, clearRunHistory: second });
    action('clear-conversation').run();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('global keyboard router', () => {
  it('⌘K toggles the palette and ⌘B toggles the sidebar', () => {
    const { deps } = renderShortcuts();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const paletteUpdater = (deps.setPaletteOpen as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      v: boolean,
    ) => boolean;
    expect(paletteUpdater(false)).toBe(true);
    expect(paletteUpdater(true)).toBe(false);

    // Ctrl works as the meta modifier too (Windows/Linux).
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    const sidebarUpdater = (deps.setSidebarCollapsed as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as (v: boolean) => boolean;
    expect(sidebarUpdater(false)).toBe(true);
  });

  it('⌘, opens settings and ⌘⇧L flips the theme', () => {
    const { deps } = renderShortcuts();

    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(deps.setSettingsOpen).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: 'l', metaKey: true, shiftKey: true });
    const themeUpdater = (deps.setThemeMode as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
      v: string,
    ) => string;
    expect(themeUpdater('dark')).toBe('light');
    expect(themeUpdater('light')).toBe('dark');
  });

  it('⌘N creates a session only while focus is outside text inputs', () => {
    const { deps } = renderShortcuts();

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(deps.handleTabCreate).not.toHaveBeenCalled();

    textarea.blur();
    textarea.remove();
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(deps.handleTabCreate).toHaveBeenCalledTimes(1);

    // ⇧⌘N is someone else's shortcut — never ours.
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true });
    expect(deps.handleTabCreate).toHaveBeenCalledTimes(1);
  });

  it('⌘F focuses history search; "/" focuses the composer unless typing', () => {
    const { deps } = renderShortcuts();

    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(deps.focusHistorySearch).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { key: '/' });
    expect(deps.focusComposer).not.toHaveBeenCalled();

    input.blur();
    input.remove();
    fireEvent.keyDown(window, { key: '/' });
    expect(deps.focusComposer).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the palette first, then any open dock panel, else does nothing', () => {
    // Palette open: only the palette closes.
    const paletteCase = renderShortcuts({ paletteOpen: true, previewOpen: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(paletteCase.deps.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(paletteCase.deps.setPreviewOpen).not.toHaveBeenCalled();
    paletteCase.unmount();

    // Panels open, palette closed: every panel closes and the key is consumed.
    const panelCase = renderShortcuts({ terminalOpen: true, contextOpen: true });
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(consumed);
    expect(consumed.defaultPrevented).toBe(true);
    expect(panelCase.deps.setPreviewOpen).toHaveBeenCalledWith(false);
    expect(panelCase.deps.setContextOpen).toHaveBeenCalledWith(false);
    expect(panelCase.deps.setTerminalOpen).toHaveBeenCalledWith(false);
    expect(panelCase.deps.setToolsOpen).toHaveBeenCalledWith(false);
    panelCase.unmount();

    // Nothing open: Escape is left alone for whoever else wants it.
    const idleCase = renderShortcuts();
    const untouched = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);
    expect(idleCase.deps.setPaletteOpen).not.toHaveBeenCalled();
  });

  it('⌘1/⌘2 switch modes, but not while a runner is busy', () => {
    const { deps, rerender } = renderShortcuts();

    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(deps.switchMode).toHaveBeenCalledWith('standard');
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(deps.switchMode).toHaveBeenCalledWith('coding');

    (deps.switchMode as ReturnType<typeof vi.fn>).mockClear();
    rerender({ ...deps, busyRunner: 'doctor' });
    fireEvent.keyDown(window, { key: '1', metaKey: true });
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(deps.switchMode).not.toHaveBeenCalled();
  });
});
