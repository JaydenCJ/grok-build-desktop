// Sidebar behaviors the main Sidebar suite leaves out: the group submenu
// (new group, move to an existing group, remove from group), rename edit
// cancel/blur-commit, Save to Prompt Library (success + failure), the
// filter-clear refresh button, the brand chevron / account strip / primary
// nav wiring, and the tool-health pill for a missing grok install.
import { beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Sidebar } from '../Sidebar';
import { ContextMenu, type ContextMenuState } from '../ContextMenu';
import { useSessionTabs } from '../../hooks/useSessionTabs';
import { useHistoryOrganization } from '../../hooks/useHistoryOrganization';
import { storageKeys, tabsActiveKey, tabsStorageKey } from '../../app/constants';
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

function Harness({ grokInstalled = true }: { grokInstalled?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([message('m100', 'fix the login flake')]);
  const [codingCwd, setCodingCwd] = useState('/a');
  const [, setDrafts] = useState<Record<Mode, string>>({ standard: '', coding: '' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolsPageOpen, setToolsPageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    closePalette: () => setPaletteOpen(false),
    onConversationDeleted: () => setContextMenu(null),
  });
  const historyApi = useHistoryOrganization({
    tabs: tabsApi.tabs,
    activeTabId: tabsApi.activeTabId,
    messages,
    sessionFirstPrompt: tabsApi.sessionFirstPrompt,
    closeContextMenu: () => setContextMenu(null),
  });
  return (
    <>
      <div data-testid="flags">
        {`palette:${paletteOpen} tools:${toolsPageOpen} settings:${settingsOpen}`}
      </div>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <Sidebar
        history={historyApi}
        sessionFirstPrompt={tabsApi.sessionFirstPrompt}
        switchToSession={tabsApi.switchToSession}
        deleteSession={() => {}}
        handleTabCreate={tabsApi.handleTabCreate}
        focusComposer={() => {}}
        setContextMenu={setContextMenu}
        paletteOpen={paletteOpen}
        setPaletteOpen={setPaletteOpen}
        toolsPageOpen={toolsPageOpen}
        setToolsPageOpen={setToolsPageOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        busyRunner={null}
        refreshStatuses={() => {}}
        runDoctor={() => {}}
        grokToolStatus={{
          id: 'grok',
          label: 'Grok Build',
          command: 'grok',
          installed: grokInstalled,
          detail: '',
        }}
        isGrokReady={grokInstalled}
        activeModel="grok-build"
        statusLabel="Connected"
      />
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  seedTabs();
});

function historyRow(title: string) {
  return screen.getByRole('button', { name: new RegExp(title) });
}

/** Open the row's context menu and hover "Move to group" to reveal the flyout. */
async function openGroupSubmenu(rowTitle: string) {
  fireEvent.contextMenu(historyRow(rowTitle));
  const menu = await screen.findByRole('menu');
  const parent = within(menu).getByRole('menuitem', { name: /Move to group/ });
  fireEvent.mouseEnter(parent.closest('.ctx-row')!);
  // "New group…" is always the flyout's first item — use it as the ready signal.
  await screen.findByRole('menuitem', { name: /New group…/ });
  return menu;
}

describe('group management from the row submenu', () => {
  it('creates a new group inline and files the conversation under it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openGroupSubmenu('write release notes');
    await user.click(await screen.findByRole('menuitem', { name: /New group…/ }));

    const input = await screen.findByLabelText('New group name');
    await user.type(input, 'Q3 launches{Enter}');

    // A named group section appears with the row inside it.
    const head = await screen.findByText('Q3 launches');
    const group = head.closest('.history-group') as HTMLElement;
    expect(within(group).getByText('write release notes')).toBeInTheDocument();
    // Persisted so it survives restarts.
    expect(
      JSON.parse(window.localStorage.getItem(storageKeys.historyGroups) ?? '{}'),
    ).toMatchObject({ t2: 'Q3 launches' });
  });

  it('an empty new-group name commits nothing', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openGroupSubmenu('write release notes');
    await user.click(await screen.findByRole('menuitem', { name: /New group…/ }));
    const input = await screen.findByLabelText('New group name');
    await user.type(input, '   {Enter}');

    // Editor closed, row back in the plain list, no group section created.
    expect(screen.queryByLabelText('New group name')).not.toBeInTheDocument();
    expect(screen.getByText('write release notes')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(storageKeys.historyGroups) ?? '{}')).toEqual({});
  });

  it('moves a row into an existing group and removes it again', async () => {
    // Two seeded groups so the alphabetical "Move to" listing has work to do.
    window.localStorage.setItem(
      storageKeys.historyGroups,
      JSON.stringify({ t1: 'Ops', t2: 'Zebra' }),
    );
    const user = userEvent.setup();
    render(<Harness />);

    await openGroupSubmenu('write release notes');
    // Existing groups are listed under a "Move to" section header.
    await screen.findByText('Move to');
    await user.click(screen.getByRole('menuitem', { name: 'Ops' }));

    await waitFor(() => {
      const group = screen.getByText('Ops').closest('.history-group') as HTMLElement;
      expect(within(group).getByText('write release notes')).toBeInTheDocument();
    });

    // Now remove it from the group again.
    await openGroupSubmenu('write release notes');
    await user.click(await screen.findByRole('menuitem', { name: /Remove from group/ }));
    await waitFor(() => {
      const group = screen.getByText('Ops').closest('.history-group') as HTMLElement;
      expect(within(group).queryByText('write release notes')).not.toBeInTheDocument();
    });
    // A "Recent" section separates the ungrouped row from the group.
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('clicking the checked current group toggles the row back out of it', async () => {
    window.localStorage.setItem(storageKeys.historyGroups, JSON.stringify({ t2: 'Ops' }));
    const user = userEvent.setup();
    render(<Harness />);

    await openGroupSubmenu('write release notes');
    // The row's current group renders with a check suffix; clicking it clears.
    await user.click(await screen.findByRole('menuitem', { name: /Ops\s+✓/ }));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(storageKeys.historyGroups)!)).toEqual({}),
    );
  });
});

describe('rename edit lifecycle', () => {
  it('Escape cancels a rename without committing the typed text', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    fireEvent.contextMenu(historyRow('write release notes'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Rename…/ }));

    const input = await screen.findByLabelText('Rename prompt');
    await user.clear(input);
    await user.type(input, 'half-typed junk{Escape}');

    expect(screen.queryByLabelText('Rename prompt')).not.toBeInTheDocument();
    expect(screen.getByText('write release notes')).toBeInTheDocument();
    expect(screen.queryByText('half-typed junk')).not.toBeInTheDocument();
  });

  it('blurring the rename input commits the new title', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    fireEvent.contextMenu(historyRow('write release notes'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Rename…/ }));

    const input = await screen.findByLabelText('Rename prompt');
    await user.clear(input);
    await user.type(input, 'Release notes v2');
    fireEvent.blur(input);

    expect(await screen.findByText('Release notes v2')).toBeInTheDocument();
    expect(screen.queryByText('write release notes')).not.toBeInTheDocument();
  });
});

describe('Save to Prompt Library', () => {
  it('saves the first prompt and confirms with a toast', async () => {
    mockIPC((cmd) => {
      if (cmd === 'upsert_prompt') {
        return {
          id: 'p1',
          name: 'fix the login flake',
          category: 'History',
          body: 'fix the login flake',
          created_at: 1,
          updated_at: 1,
        };
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<Harness />);

    fireEvent.contextMenu(historyRow('fix the login flake'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Save to Prompt Library/ }));
    expect(await screen.findByText('Saved to Prompt Library')).toBeInTheDocument();
  });

  it('reports the failure toast when the library backend is unavailable', async () => {
    // No Tauri mock installed → the invoke rejects → the catch path runs.
    const user = userEvent.setup();
    render(<Harness />);

    fireEvent.contextMenu(historyRow('fix the login flake'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Save to Prompt Library/ }));
    expect(
      await screen.findByText("Couldn't save — Prompt Library unavailable"),
    ).toBeInTheDocument();
  });
});

describe('filter refresh, brand chevron, nav, account strip, health', () => {
  it('the refresh icon clears the filter and refocuses the search box', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const search = screen.getByLabelText('Search history');
    await user.type(search, 'release');
    expect(screen.queryByText('fix the login flake')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByText('fix the login flake')).toBeInTheDocument();
    expect(screen.getByText('write release notes')).toBeInTheDocument();
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
  });

  it('the brand chevron opens the ⌘K palette and marks Search active', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('button', { name: /^Search/ })).not.toHaveClass('active');
    await user.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(screen.getByTestId('flags')).toHaveTextContent('palette:true');
    expect(screen.getByRole('button', { name: /^Search/ })).toHaveClass('active');
  });

  it('the Tools nav item opens the tools page and highlights itself', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const tools = screen.getByRole('button', { name: /^Tools/ });
    expect(tools).not.toHaveClass('active');
    await user.click(tools);
    expect(screen.getByTestId('flags')).toHaveTextContent('tools:true');
    expect(screen.getByRole('button', { name: /^Tools/ })).toHaveClass('active');
  });

  it('the whole account strip opens Settings, as does the Settings nav item', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByTestId('flags')).toHaveTextContent('settings:true');
    expect(screen.getByRole('button', { name: /^Settings/ })).toHaveClass('active');
  });

  it('the Search and Settings nav items open the palette and settings directly', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /^Search/ }));
    expect(screen.getByTestId('flags')).toHaveTextContent('palette:true');

    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(screen.getByTestId('flags')).toHaveTextContent('settings:true');
  });

  it('reports a missing grok install in the health pill', () => {
    render(<Harness grokInstalled={false} />);
    expect(screen.getByText('Grok missing')).toBeInTheDocument();
    expect(screen.queryByText('Grok ready')).not.toBeInTheDocument();
  });
});
