// Interaction tests for the Tools / MCP hub: catalog rendering, whole-token
// "Connected" detection, add/remove flows (including the folder-picker guard
// for directory-scoped servers), the skills tab, search, and closing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsPage } from '../ToolsPage';
import { t } from '../../i18n';
import { toolRun, installTauriAppMock, type CommandHandler } from '../../test/tauriAppMock';

function setup(overrides: Record<string, CommandHandler> = {}) {
  const tauri = installTauriAppMock(overrides);
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<ToolsPage open cwd="/mock/project" onClose={onClose} />);
  return { tauri, onClose, user };
}

function card(name: string): HTMLElement {
  const title = screen.getByText(name, { selector: '.tool-mcp-name' });
  return title.closest('.tool-mcp-card') as HTMLElement;
}

beforeEach(() => {
  // The modal focus trap focuses the close button; jsdom supports that, but
  // catalogue cards may scroll their notice into view.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ToolsPage MCP catalog', () => {
  it('marks servers Connected only on whole-token matches of grok mcp list', async () => {
    setup({
      // Output mentions "github" — the "git" card must NOT light up too.
      list_grok_mcp: () => toolRun('grok mcp list', 'github: npx @modelcontextprotocol/…'),
    });

    await waitFor(() => {
      expect(within(card('GitHub')).getByText(t('tools.connectedBadge'))).toBeInTheDocument();
    });
    expect(within(card('GitHub')).getByRole('button', { name: t('common.remove') })).toBeEnabled();
    expect(within(card('Git')).queryByText(t('tools.connectedBadge'))).not.toBeInTheDocument();
    expect(within(card('Git')).getByRole('button', { name: t('tools.add') })).toBeInTheDocument();
  });

  it('adds a plain server and reports success', async () => {
    const { tauri, user } = setup();
    await user.click(within(card('Fetch')).getByRole('button', { name: t('tools.add') }));

    expect(
      await screen.findByText(t('tools.addedEntry', { name: 'Fetch', envHint: '' }).trim()),
    ).toBeInTheDocument();
    const add = tauri.calls.find((c) => c.cmd === 'grok_mcp_add')!;
    expect(add.args.name).toBe('fetch');
    expect(add.args.command).toBe('npx');
    // The list refreshes after the add.
    expect(tauri.commands().filter((c) => c === 'list_grok_mcp').length).toBeGreaterThanOrEqual(2);
  });

  it('routes directory-scoped servers through the folder picker', async () => {
    const { tauri, user } = setup({
      pick_project_folder: () => '/exposed/dir',
    });
    await user.click(within(card('Filesystem')).getByRole('button', { name: t('tools.add') }));

    await waitFor(() => {
      const add = tauri.calls.find((c) => c.cmd === 'grok_mcp_add');
      expect(add).toBeDefined();
      expect(add!.args.args).toContain('/exposed/dir');
      expect(add!.args.args).not.toContain('$HOME');
    });
    const pick = tauri.calls.find((c) => c.cmd === 'pick_project_folder')!;
    expect(pick.args.initial).toBe('/mock/project');
  });

  it('refuses to install a directory-scoped server without a folder', async () => {
    const { tauri, user } = setup({
      pick_project_folder: () => null,
    });
    await user.click(within(card('Filesystem')).getByRole('button', { name: t('tools.add') }));

    expect(
      await screen.findByText(t('tools.needsFolder', { name: 'Filesystem' })),
    ).toBeInTheDocument();
    expect(tauri.calls.find((c) => c.cmd === 'grok_mcp_add')).toBeUndefined();
  });

  it('surfaces stderr when the add command fails', async () => {
    const { user } = setup({
      grok_mcp_add: () => toolRun('grok mcp add fetch', '', false, 'config locked'),
    });
    await user.click(within(card('Fetch')).getByRole('button', { name: t('tools.add') }));
    expect(await screen.findByText('config locked')).toBeInTheDocument();
  });

  it('removes a connected server', async () => {
    const { tauri, user } = setup({
      list_grok_mcp: () => toolRun('grok mcp list', 'memory: connected'),
    });
    const remove = await within(card('Memory')).findByRole('button', {
      name: t('common.remove'),
    });
    await user.click(remove);

    expect(
      await screen.findByText(t('tools.removedEntry', { name: 'Memory' })),
    ).toBeInTheDocument();
    expect(tauri.calls.find((c) => c.cmd === 'grok_mcp_remove')?.args.name).toBe('memory');
  });

  it('filters the catalog by search query', async () => {
    const { user } = setup();
    await user.type(screen.getByPlaceholderText(t('tools.searchMcpPlaceholder')), 'postgres');
    expect(screen.getByText('PostgreSQL', { selector: '.tool-mcp-name' })).toBeInTheDocument();
    expect(screen.queryByText('GitHub', { selector: '.tool-mcp-name' })).not.toBeInTheDocument();
  });
});

describe('ToolsPage skills tab', () => {
  it('installs a skill and shows it as installed after the refresh', async () => {
    let installed: string[] = [];
    const { tauri, user } = setup({
      list_grok_skills: () => installed,
      install_grok_skill: (args) => {
        installed = [String(args.slug)];
        return null;
      },
    });

    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));
    await user.click(within(card('Code review')).getByRole('button', { name: t('tools.install') }));

    expect(
      await screen.findByText(t('tools.installedSkill', { name: 'Code review' })),
    ).toBeInTheDocument();
    await within(card('Code review')).findByText(t('tools.installedBadge'));

    const install = tauri.calls.find((c) => c.cmd === 'install_grok_skill')!;
    expect(install.args.slug).toBe('code-review');
    expect(String(install.args.body)).toContain('name: code-review');
  });

  it('removes an installed skill', async () => {
    const { tauri, user } = setup({
      list_grok_skills: () => ['write-tests'],
    });
    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));
    const remove = await within(card('Write tests')).findByRole('button', {
      name: t('common.remove'),
    });
    await user.click(remove);

    expect(
      await screen.findByText(t('tools.removedEntry', { name: 'Write tests' })),
    ).toBeInTheDocument();
    expect(tauri.calls.find((c) => c.cmd === 'remove_grok_skill')?.args.slug).toBe('write-tests');
  });
});

describe('ToolsPage dismissal', () => {
  it('closes on Escape and on the close button', async () => {
    const { onClose, user } = setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: t('common.close') }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
