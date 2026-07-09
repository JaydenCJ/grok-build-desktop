// Integration test of the conversations sidebar: real useSessionTabs +
// useHistoryOrganization state behind the real Sidebar and ContextMenu
// components, exercising the flows a user actually performs — switch,
// pin, rename, archive, delete, filter.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../Sidebar';
import { ContextMenu, type ContextMenuState } from '../ContextMenu';
import { UndoToast } from '../UndoToast';
import { useSessionTabs } from '../../hooks/useSessionTabs';
import { useHistoryOrganization } from '../../hooks/useHistoryOrganization';
import { useUndoToast } from '../../hooks/useUndoToast';
import { tabsActiveKey, tabsStorageKey } from '../../app/constants';
import type { ChatMessage, Mode } from '../../app/types';

function message(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, ts: Number(id.replace(/\D/g, '')) || 1 };
}

function seedTabs() {
  window.localStorage.setItem(
    tabsStorageKey,
    JSON.stringify([
      {
        id: 't1',
        name: 'alpha',
        cwd: '/a',
        createdAt: 1,
        messages: [message('m100', 'fix the login flake')],
      },
      {
        id: 't2',
        name: 'beta',
        cwd: '/b',
        createdAt: 2,
        messages: [message('m200', 'write release notes')],
      },
    ]),
  );
  window.localStorage.setItem(tabsActiveKey, 't1');
}

function Harness() {
  const [messages, setMessages] = useState<ChatMessage[]>([message('m100', 'fix the login flake')]);
  const [codingCwd, setCodingCwd] = useState('/a');
  const [, setDrafts] = useState<Record<Mode, string>>({ standard: '', coding: '' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const { undoToast, showUndoToast, undoNow } = useUndoToast();
  const tabsApi = useSessionTabs({
    messages,
    setMessages,
    codingCwd,
    setCodingCwd,
    setDrafts,
    setLastRun: () => {},
    setSessionNotice: () => {},
    setComposerValue: () => {},
    focusComposer: () => {},
    closePalette: () => {},
    onConversationDeleted: () => setContextMenu(null),
  });
  const historyApi = useHistoryOrganization({
    tabs: tabsApi.tabs,
    activeTabId: tabsApi.activeTabId,
    messages,
    sessionFirstPrompt: tabsApi.sessionFirstPrompt,
    closeContextMenu: () => setContextMenu(null),
  });
  // Mirrors App.deleteConversation: delete now, drop metadata only when the
  // undo window lapses.
  const deleteConversation = (id: string) => {
    const undo = tabsApi.deleteSession(id);
    if (!undo) return;
    showUndoToast({
      text: 'Conversation deleted.',
      undo,
      onExpire: () => historyApi.removeConversationMeta(id),
    });
  };
  return (
    <>
      <div data-testid="active-conversation">{messages.map((m) => m.id).join('|')}</div>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <UndoToast toast={undoToast} onUndo={undoNow} />
      <Sidebar
        history={historyApi}
        sessionFirstPrompt={tabsApi.sessionFirstPrompt}
        switchToSession={tabsApi.switchToSession}
        deleteSession={deleteConversation}
        handleTabCreate={tabsApi.handleTabCreate}
        focusComposer={() => {}}
        setContextMenu={setContextMenu}
        paletteOpen={false}
        setPaletteOpen={() => {}}
        toolsPageOpen={false}
        setToolsPageOpen={() => {}}
        settingsOpen={false}
        setSettingsOpen={() => {}}
        busyRunner={null}
        refreshStatuses={() => {}}
        runDoctor={() => {}}
        grokToolStatus={{
          id: 'grok',
          label: 'Grok Build',
          command: 'grok',
          installed: true,
          detail: '',
        }}
        isGrokReady
        activeModel="grok-build"
        statusLabel="Connected"
      />
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  seedTabs();
  vi.spyOn(window, 'getComputedStyle');
});

function historyRow(title: RegExp | string) {
  return screen.getByRole('button', {
    name: new RegExp(typeof title === 'string' ? title : title.source),
  });
}

describe('Sidebar conversations list', () => {
  it('lists every conversation and marks the open one active', () => {
    render(<Harness />);
    expect(historyRow('fix the login flake')).toHaveAttribute('aria-current', 'true');
    expect(historyRow('write release notes')).not.toHaveAttribute('aria-current');
  });

  it('clicking a row switches to that whole conversation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(historyRow('write release notes'));
    expect(screen.getByTestId('active-conversation')).toHaveTextContent('m200');
    expect(historyRow('write release notes')).toHaveAttribute('aria-current', 'true');
  });

  it('filters conversations from the search box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Search history'), 'release');
    expect(screen.queryByText('fix the login flake')).not.toBeInTheDocument();
    expect(screen.getByText('write release notes')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search history'));
    expect(screen.getByText('fix the login flake')).toBeInTheDocument();
  });

  it('shows an honest empty state for a no-match filter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Search history'), 'zzz-nothing');
    expect(screen.getByText('No matches for')).toBeInTheDocument();
    expect(screen.getByText('zzz-nothing')).toBeInTheDocument();
  });
});

describe('Sidebar right-click actions', () => {
  it('deletes a conversation via the context menu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(historyRow('write release notes'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Delete conversation/ }));
    await waitFor(() => expect(screen.queryByText('write release notes')).not.toBeInTheDocument());
    expect(screen.getByText('fix the login flake')).toBeInTheDocument();
  });

  it('pins a conversation into the Pinned section', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    fireEvent.contextMenu(historyRow('write release notes'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Pin to top/ }));
    await screen.findByText('Pinned');
    const pinnedGroup = screen.getByText('Pinned').closest('.history-group')!;
    expect(within(pinnedGroup as HTMLElement).getByText('write release notes')).toBeInTheDocument();
  });

  it('renames a conversation inline', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(historyRow('fix the login flake'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Rename…/ }));
    const input = await screen.findByLabelText('Rename prompt');
    await user.clear(input);
    await user.type(input, 'Login flake hunt{Enter}');
    expect(await screen.findByText('Login flake hunt')).toBeInTheDocument();
    expect(screen.queryByText('fix the login flake')).not.toBeInTheDocument();
  });

  it('archives a conversation into the collapsed Archived section', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(historyRow('write release notes'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /^Archive/ }));
    const archivedToggle = await screen.findByRole('button', { name: /Archived \(1\)/ });
    // Collapsed by default; expanding reveals the archived row.
    expect(screen.queryByText('write release notes')).not.toBeInTheDocument();
    await user.click(archivedToggle);
    expect(screen.getByText('write release notes')).toBeInTheDocument();
  });

  it('copying the first prompt surfaces the transient toast', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(historyRow('fix the login flake'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Copy first prompt/ }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});

describe('Sidebar keyboard access to row actions', () => {
  it('Shift+F10 on a focused row opens the same management menu', async () => {
    render(<Harness />);
    const row = historyRow('write release notes');
    expect(row).toHaveAttribute('aria-haspopup', 'menu');
    row.focus();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Delete conversation/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Rename…/ })).toBeInTheDocument();
  });

  it('the ContextMenu key opens the menu and Escape returns focus to the row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const row = historyRow('write release notes');
    row.focus();
    fireEvent.keyDown(row, { key: 'ContextMenu' });
    const menu = await screen.findByRole('menu');
    // Focus moves into the menu so arrows/Escape work without a Tab stop.
    expect(menu.contains(document.activeElement)).toBe(true);
    // Wait for the deferred window listeners (attached in a 0ms timeout).
    await new Promise((r) => setTimeout(r, 10));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(row);
  });

  it('arrow keys walk the menu and Enter activates the focused item', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const row = historyRow('write release notes');
    row.focus();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    await screen.findByRole('menu');
    // Wait for the deferred window listeners (attached in a 0ms timeout).
    await new Promise((r) => setTimeout(r, 10));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('Open conversation');
    await user.keyboard('{ArrowUp}');
    // Wraps to the last item.
    expect(document.activeElement).toHaveTextContent('Delete conversation');
    await user.keyboard('{ArrowDown}{Enter}');
    // Enter ran "Open conversation" — the whole conversation loads.
    await waitFor(() =>
      expect(screen.getByTestId('active-conversation')).toHaveTextContent('m200'),
    );
  });

  it('single-letter accelerators still work from the keyboard-opened menu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    const row = historyRow('write release notes');
    row.focus();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    await screen.findByRole('menu');
    await new Promise((r) => setTimeout(r, 10));
    await user.keyboard('p');
    await screen.findByText('Pinned');
  });
});

describe('destructive actions offer undo', () => {
  it('deleting a conversation shows an undo toast that restores it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(historyRow('write release notes'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Delete conversation/ }));
    await waitFor(() => expect(screen.queryByText('write release notes')).not.toBeInTheDocument());

    expect(screen.getByText('Conversation deleted.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('write release notes')).toBeInTheDocument();
    expect(screen.queryByText('Conversation deleted.')).not.toBeInTheDocument();
  });

  it('undo restores a pinned conversation into the Pinned section', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.contextMenu(historyRow('write release notes'));
    let menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Pin to top/ }));
    await screen.findByText('Pinned');

    fireEvent.contextMenu(historyRow('write release notes'));
    menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Delete conversation/ }));
    await waitFor(() => expect(screen.queryByText('write release notes')).not.toBeInTheDocument());

    // Metadata cleanup is deferred to the undo window, so undo restores the
    // row still pinned.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText('write release notes');
    const pinnedGroup = screen.getByText('Pinned').closest('.history-group')!;
    expect(within(pinnedGroup as HTMLElement).getByText('write release notes')).toBeInTheDocument();
  });
});

describe('Sidebar primary navigation', () => {
  it('New Session creates a fresh conversation row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /New Session/ }));
    await screen.findByText('New conversation');
    // Both original conversations survive as history rows.
    expect(screen.getByText('fix the login flake')).toBeInTheDocument();
    expect(screen.getByText('write release notes')).toBeInTheDocument();
    expect(screen.getByTestId('active-conversation')).toHaveTextContent('');
  });

  it('surfaces tool health from the grok status', () => {
    render(<Harness />);
    expect(screen.getByText('Grok ready')).toBeInTheDocument();
  });
});
