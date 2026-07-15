// Supplements ToolsPage.test.tsx with the closed state, backdrop dismissal,
// tab switching, the footer refresh actions, skills search, and the error
// paths of the add / remove / install / uninstall flows.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsPage } from '../ToolsPage';
import { t } from '../../i18n';
import { installTauriAppMock, toolRun, type CommandHandler } from '../../test/tauriAppMock';

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
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ToolsPage visibility and dismissal', () => {
  it('renders nothing and probes nothing while closed', () => {
    const tauri = installTauriAppMock();
    render(<ToolsPage open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tauri.commands()).not.toContain('list_grok_mcp');
    expect(tauri.commands()).not.toContain('list_grok_skills');
  });

  it('closes on a backdrop click but not on a click inside the card', async () => {
    const { onClose, user } = setup();

    await user.click(screen.getByRole('heading', { name: t('tools.title') }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ToolsPage tabs and footer refresh', () => {
  it('re-checks the server list from the footer refresh button', async () => {
    const { tauri, user } = setup();
    await waitFor(() => expect(tauri.commands()).toContain('list_grok_mcp'));
    const before = tauri.commands().filter((c) => c === 'list_grok_mcp').length;

    await user.click(screen.getByRole('button', { name: t('common.refresh') }));
    await waitFor(() => {
      expect(tauri.commands().filter((c) => c === 'list_grok_mcp').length).toBe(before + 1);
    });
  });

  it('re-checks installed skills from the footer on the skills tab', async () => {
    const { tauri, user } = setup();
    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));
    const before = tauri.commands().filter((c) => c === 'list_grok_skills').length;

    await user.click(screen.getByRole('button', { name: t('common.refresh') }));
    await waitFor(() => {
      expect(tauri.commands().filter((c) => c === 'list_grok_skills').length).toBe(before + 1);
    });
  });

  it('switches to skills and back to the MCP catalog', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));
    expect(screen.getByRole('tab', { name: t('tools.tabSkills') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByPlaceholderText(t('tools.searchSkillsPlaceholder'))).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: t('tools.tabMcp') }));
    expect(screen.getByRole('tab', { name: t('tools.tabMcp') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByPlaceholderText(t('tools.searchMcpPlaceholder'))).toBeInTheDocument();
  });

  it('filters the skills catalog by search query', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));

    await user.type(
      screen.getByPlaceholderText(t('tools.searchSkillsPlaceholder')),
      'architecture',
    );
    expect(
      screen.getByText('Explain codebase', { selector: '.tool-mcp-name' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Code review', { selector: '.tool-mcp-name' }),
    ).not.toBeInTheDocument();
  });
});

describe('ToolsPage MCP error paths', () => {
  it('shows the remove failure stderr when removing a server fails', async () => {
    const { user } = setup({
      list_grok_mcp: () => toolRun('grok mcp list', 'memory: connected'),
      grok_mcp_remove: () => toolRun('grok mcp remove memory', '', false, 'remove blew up'),
    });
    const remove = await within(card('Memory')).findByRole('button', {
      name: t('common.remove'),
    });
    await user.click(remove);

    expect(await screen.findByText('remove blew up')).toBeInTheDocument();
  });

  it('falls back to the generic remove error without stderr', async () => {
    const { user } = setup({
      list_grok_mcp: () => toolRun('grok mcp list', 'memory: connected'),
      grok_mcp_remove: () => toolRun('grok mcp remove memory', '', false, ''),
    });
    const remove = await within(card('Memory')).findByRole('button', {
      name: t('common.remove'),
    });
    await user.click(remove);

    expect(await screen.findByText(t('tools.removeFailed'))).toBeInTheDocument();
  });

  it('surfaces a thrown remove error as a notice', async () => {
    const { user } = setup({
      list_grok_mcp: () => toolRun('grok mcp list', 'memory: connected'),
      grok_mcp_remove: () => {
        throw new Error('ipc dead');
      },
    });
    const remove = await within(card('Memory')).findByRole('button', {
      name: t('common.remove'),
    });
    await user.click(remove);

    expect(await screen.findByText('ipc dead')).toBeInTheDocument();
  });

  it('falls back to the generic add error when the CLI returns nothing', async () => {
    const { user } = setup({
      grok_mcp_add: () => toolRun('grok mcp add fetch', '', false, ''),
    });
    await user.click(within(card('Fetch')).getByRole('button', { name: t('tools.add') }));

    expect(await screen.findByText(t('tools.addFailed'))).toBeInTheDocument();
  });

  it('passes empty env pairs for servers that need env vars and hints at them', async () => {
    const { tauri, user } = setup();
    await user.click(within(card('GitHub')).getByRole('button', { name: t('tools.add') }));

    expect(
      await screen.findByText(
        t('tools.addedEntry', { name: 'GitHub', envHint: t('tools.envHint') }).trim(),
      ),
    ).toBeInTheDocument();
    const add = tauri.calls.find((c) => c.cmd === 'grok_mcp_add')!;
    expect(add.args.envPairs).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN=']);
  });

  it('surfaces folder-picker crashes when adding a directory-scoped server', async () => {
    const { tauri, user } = setup({
      pick_project_folder: () => {
        throw new Error('picker exploded');
      },
    });
    await user.click(within(card('Filesystem')).getByRole('button', { name: t('tools.add') }));

    expect(await screen.findByText('picker exploded')).toBeInTheDocument();
    expect(tauri.calls.find((c) => c.cmd === 'grok_mcp_add')).toBeUndefined();
  });
});

describe('ToolsPage skills error paths', () => {
  it('reports skill install failures and keeps the card uninstalled', async () => {
    const { user } = setup({
      install_grok_skill: () => {
        throw new Error('disk full');
      },
    });
    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));
    await user.click(within(card('Code review')).getByRole('button', { name: t('tools.install') }));

    expect(await screen.findByText('disk full')).toBeInTheDocument();
    expect(
      within(card('Code review')).queryByText(t('tools.installedBadge')),
    ).not.toBeInTheDocument();
  });

  it('reports skill remove failures', async () => {
    const { user } = setup({
      list_grok_skills: () => ['code-review'],
      remove_grok_skill: () => {
        throw new Error('skill locked');
      },
    });
    await user.click(screen.getByRole('tab', { name: t('tools.tabSkills') }));
    const remove = await within(card('Code review')).findByRole('button', {
      name: t('common.remove'),
    });
    await user.click(remove);

    expect(await screen.findByText('skill locked')).toBeInTheDocument();
  });
});
