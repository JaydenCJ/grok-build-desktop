// Second slice of full-<App/> integration tests: keyboard shortcuts, the
// composer footer (mode / workflow presets), the folder picker, the terminal
// dock's shell runner, sidebar health actions, and the inspector drawer
// (context runners + the Mac desktop bridge).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtuosoMockContext } from 'react-virtuoso';
import App from '../App';
import { detachTauriListeners, streamStore } from '../lib/streamStore';
import { codingPresets, defaultDrafts } from '../app/constants';
import { t } from '../i18n';
import { installTauriAppMock, type CommandHandler, type TauriAppMock } from '../test/tauriAppMock';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  if (typeof window.ResizeObserver === 'undefined') {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  }
  Element.prototype.scrollIntoView = vi.fn();
});

function setup(overrides: Record<string, CommandHandler> = {}) {
  const tauri: TauriAppMock = installTauriAppMock(overrides);
  detachTauriListeners();
  streamStore.__reset();
  const user = userEvent.setup();
  const view = render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 64 }}>
      <App />
    </VirtuosoMockContext.Provider>,
  );
  return { tauri, user, view };
}
type Ctx = ReturnType<typeof setup>;

function composerTextarea(): HTMLTextAreaElement {
  return document.querySelector('.composer textarea') as HTMLTextAreaElement;
}

async function bootApp(overrides: Record<string, CommandHandler> = {}): Promise<Ctx> {
  const ctx = setup(overrides);
  expect(await screen.findByText(t('emptyState.title'))).toBeInTheDocument();
  await waitFor(() => expect(ctx.tauri.commands()).toContain('get_grok_auth_status'));
  return ctx;
}

describe('keyboard shortcuts', () => {
  it('focuses the composer with "/" and the history search with ⌘F', async () => {
    const { user } = await bootApp();

    await user.keyboard('/');
    expect(composerTextarea()).toHaveFocus();

    // "/" while typing in a field must NOT steal focus — it's a character.
    await user.type(composerTextarea(), 'path/to');
    expect(composerTextarea().value).toContain('path/to');

    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Meta>}f{/Meta}');
    expect(screen.getByPlaceholderText(t('sidebar.searchPlaceholder'))).toHaveFocus();
  });

  it('opens Settings with ⌘, and switches modes with ⌘1/⌘2', async () => {
    const { user } = await bootApp();

    await user.keyboard('{Meta>},{/Meta}');
    expect(await screen.findByRole('dialog', { name: t('settings.title') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('settings.close') }));

    // Mode switch seeds the other mode's default draft into the composer.
    const modeSelect = screen.getByLabelText(
      t('composerSection.interactionMode'),
    ) as HTMLSelectElement;
    expect(modeSelect.value).toBe('coding');
    await user.keyboard('{Meta>}1{/Meta}');
    await waitFor(() => expect(modeSelect.value).toBe('standard'));
    expect(composerTextarea().value).toBe(defaultDrafts.standard);
    await user.keyboard('{Meta>}2{/Meta}');
    await waitFor(() => expect(modeSelect.value).toBe('coding'));
  });
});

describe('composer footer', () => {
  it('applies a coding workflow preset to the composer', async () => {
    const { user } = await bootApp();
    const workflowSelect = screen.getByLabelText(t('composerSection.codingWorkflow'));

    const preset = codingPresets.find((p) => p.id === 'tests')!;
    await user.selectOptions(workflowSelect, 'tests');
    expect(composerTextarea().value).toBe(preset.prompt);
  });

  it('switches mode from the footer select and preserves drafts', async () => {
    const { user } = await bootApp();
    const modeSelect = screen.getByLabelText(t('composerSection.interactionMode'));

    await user.selectOptions(modeSelect, 'standard');
    expect(composerTextarea().value).toBe(defaultDrafts.standard);
    await user.selectOptions(modeSelect, 'coding');
    expect(composerTextarea().value).toBe(defaultDrafts.coding);
  });
});

describe('project folder picker', () => {
  it('picks a folder from the title-bar chip and updates the workspace', async () => {
    const { tauri, user } = await bootApp();

    await user.click(screen.getByRole('button', { name: 'Pick a project' }));
    await waitFor(() => expect(tauri.commands()).toContain('pick_project_folder'));

    // Notice (in the conversation toast — it mirrors into the terminal dock
    // too) + repo chip now show the picked directory.
    await waitFor(() => {
      expect(document.querySelector('.session-toast')).toHaveTextContent(
        t('notices.repoSet', { path: '/mock/project' }),
      );
    });
    expect(await screen.findByRole('button', { name: 'project' })).toBeInTheDocument();
  });
});

describe('terminal dock and sidebar health', () => {
  it('runs the shell command from the terminal dock and shows its output', async () => {
    const { tauri, user } = await bootApp();

    await user.click(screen.getByRole('button', { name: t('titleBar.panelsAria') }));
    await user.click(await screen.findByRole('menuitem', { name: /Terminal/ }));

    // Scope to the dock — the Toolbelt's browser card has a "Run" button too.
    const dock = within(document.querySelector('details.terminal-dock') as HTMLElement);
    await user.click(dock.getByRole('button', { name: t('common.run') }));
    await waitFor(() => {
      expect(tauri.calls.find((c) => c.cmd === 'run_shell_command')).toBeDefined();
    });
    const shellCall = tauri.calls.find((c) => c.cmd === 'run_shell_command')!;
    expect(String(shellCall.args.command)).toContain('git status');
    // The ToolRun output lands in the terminal log view.
    expect(await screen.findByText(/ran: pwd/)).toBeInTheDocument();
  });

  it('re-probes tool statuses and runs the doctor from the sidebar', async () => {
    const { tauri, user } = await bootApp();

    const before = tauri.commands().filter((c) => c === 'get_tool_statuses').length;
    await user.click(screen.getByRole('button', { name: t('sidebar.refreshStatus') }));
    await waitFor(() => {
      expect(tauri.commands().filter((c) => c === 'get_tool_statuses').length).toBeGreaterThan(
        before,
      );
    });

    await user.click(screen.getByRole('button', { name: new RegExp(t('common.doctor')) }));
    await waitFor(() => expect(tauri.commands()).toContain('run_doctor'));
  });
});

describe('inspector drawer', () => {
  async function openInspector(user: Ctx['user']) {
    await user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: t('palette.ariaLabel') });
    await user.keyboard('open context');
    await user.keyboard('{Enter}');
    return await screen.findByRole('complementary', { name: t('inspector.ariaLabel') });
  }

  it('runs Inspect Grok from the context tab', async () => {
    const { tauri, user } = await bootApp();
    const inspector = await openInspector(user);

    await user.click(within(inspector).getByRole('tab', { name: t('inspectorTab.context') }));
    await user.click(within(inspector).getByRole('button', { name: t('inspector.inspectGrok') }));
    await waitFor(() => expect(tauri.commands()).toContain('inspect_grok_environment'));
  });

  it('lists MCP servers and runs the MCP doctor from the MCP tab', async () => {
    const { tauri, user } = await bootApp();
    const inspector = await openInspector(user);

    await user.click(within(inspector).getByRole('tab', { name: t('inspectorTab.mcp') }));
    await user.click(within(inspector).getByRole('button', { name: t('inspector.listMcp') }));
    await waitFor(() => expect(tauri.commands()).toContain('list_grok_mcp'));
    await user.click(within(inspector).getByRole('button', { name: t('common.doctor') }));
    await waitFor(() => expect(tauri.commands()).toContain('doctor_grok_mcp'));
  });

  it('pulls desktop context from the Mac bridge into the composer draft', async () => {
    const { tauri, user } = await bootApp();

    // The palette's dedicated action opens the drawer on the Desktop tab.
    await user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: t('palette.ariaLabel') });
    await user.keyboard('desktop bridge');
    await user.keyboard('{Enter}');

    const inspector = await screen.findByRole('complementary', {
      name: t('inspector.ariaLabel'),
    });
    // Safari is running (mock) and exposes one read-only query.
    expect(await within(inspector).findByText('Safari')).toBeInTheDocument();
    expect(within(inspector).getByText(t('desktop.notRunning'))).toBeInTheDocument();

    await user.click(within(inspector).getByRole('button', { name: 'Read Safari URL' }));
    await waitFor(() => {
      expect(tauri.calls.find((c) => c.cmd === 'desktop_query')?.args.action).toBe('safari_url');
    });
    // The result lands in the draft with its provenance header.
    await waitFor(() => {
      expect(composerTextarea().value).toContain('[Desktop context — Safari · Read Safari URL]');
      expect(composerTextarea().value).toContain('mock:safari_url');
    });
    expect(document.querySelector('.session-toast')).toHaveTextContent(
      t('notices.desktopContextAppended'),
    );

    await user.click(within(inspector).getByRole('button', { name: t('desktop.bringToFront') }));
    await waitFor(() => {
      expect(tauri.calls.find((c) => c.cmd === 'desktop_activate')?.args.app).toBe('Safari');
    });
  });

  it('lists plugins and sessions, and starts a Grok login', async () => {
    const { tauri, user } = await bootApp();
    const inspector = await openInspector(user);

    await user.click(within(inspector).getByRole('tab', { name: t('inspectorTab.plugins') }));
    await user.click(within(inspector).getByRole('button', { name: t('inspector.listPlugins') }));
    await waitFor(() => expect(tauri.commands()).toContain('list_grok_plugins'));

    await user.click(within(inspector).getByRole('tab', { name: t('inspectorTab.agents') }));
    await user.click(within(inspector).getByRole('button', { name: t('inspector.sessions') }));
    await waitFor(() => expect(tauri.commands()).toContain('list_grok_sessions'));

    await user.click(within(inspector).getByRole('tab', { name: t('inspectorTab.context') }));
    await user.click(within(inspector).getByRole('button', { name: t('inspector.connect') }));
    await waitFor(() => {
      const login = tauri.calls.find((c) => c.cmd === 'start_grok_login');
      expect(login?.args.deviceAuth).toBe(false);
    });
  });
});

describe('developer toolbelt', () => {
  it('runs the browser task and absorbs a repository', async () => {
    const { tauri, user } = await bootApp();
    const belt = within(document.querySelector('details.toolbelt') as HTMLElement);

    await user.click(belt.getByRole('button', { name: t('common.run') }));
    await waitFor(() => {
      const call = tauri.calls.find((c) => c.cmd === 'run_browser_task');
      expect(String(call?.args.task)).toContain('example.com');
    });

    await user.type(belt.getByLabelText(t('toolbelt.repoPath')), '/some/repo');
    await user.click(belt.getByRole('button', { name: t('toolbelt.absorb') }));
    await waitFor(() => {
      const call = tauri.calls.find((c) => c.cmd === 'run_absorb_repo');
      expect(call?.args.repoPath).toBe('/some/repo');
      expect(call?.args.copyText).toBe(true);
    });
  });
});

describe('conversation context menu and preview panel', () => {
  it('opens Settings from the conversation right-click menu', async () => {
    const { user } = await bootApp();

    const panel = document.querySelector('.conversation-panel') as HTMLElement;
    await user.pointer({ keys: '[MouseRight]', target: panel });
    await user.click(await screen.findByRole('menuitem', { name: 'Settings…' }));
    expect(await screen.findByRole('dialog', { name: t('settings.title') })).toBeInTheDocument();
  });

  it('opens the preview panel from the panels menu and refreshes it', async () => {
    const { tauri, user } = await bootApp();

    const before = tauri.commands().filter((c) => c === 'get_static_preview').length;
    await user.click(screen.getByRole('button', { name: t('titleBar.panelsAria') }));
    await user.click(await screen.findByRole('menuitem', { name: /Preview/ }));

    const panel = await screen.findByRole('complementary', { name: t('preview.ariaLabel') });
    expect(within(panel).getByText(t('preview.emptyTitle'))).toBeInTheDocument();
    expect(within(panel).getByText('No index.html in the mock project.')).toBeInTheDocument();
    await waitFor(() => {
      expect(tauri.commands().filter((c) => c === 'get_static_preview').length).toBeGreaterThan(
        before,
      );
    });

    await user.click(within(panel).getByRole('button', { name: t('preview.close') }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: t('preview.ariaLabel') }),
      ).not.toBeInTheDocument();
    });
  });
});
