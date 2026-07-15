// Behavior tests for the InspectorDrawer beyond the ARIA tab contract
// (covered in InspectorDrawer.test.tsx): parsing of grok inspect output into
// per-tab summaries, every tab body's refresh/doctor buttons, the context
// tab's run-config controls and auth actions, the permissions tab's policy
// select + command history, the dock/close controls, the <details> toggle
// wiring, and the Desktop tab render.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorDrawer, type InspectorDrawerProps } from '../InspectorDrawer';
import type { useGrokRunners } from '../../hooks/useGrokRunners';
import type { useModelConfig } from '../../hooks/useModelConfig';
import { installTauriAppMock, toolRun } from '../../test/tauriAppMock';
import type { ToolRun } from '../../lib/grok';

const inspectOutput = [
  'Project trusted: yes',
  'Skills (2)',
  '- alpha skill',
  '- beta skill',
  '',
  'Agents (1)',
  '- planner agent',
  '',
  'Plugins (1)',
  '- linter plugin',
  '',
  'MCP Servers (2)',
  '- browser server',
  '- files server',
  '',
  'Hooks (1)',
  '- pre-commit hook',
  '',
  'Permissions (1)',
  'Source: /repo/.grok/settings.json',
].join('\n');

function makeRunners(overrides: Record<string, unknown> = {}) {
  return {
    busyRunner: null,
    contextBusy: null,
    grokStatus: { installed: true },
    ecosystemRun: toolRun('grok inspect', inspectOutput),
    modelsRun: null,
    mcpRun: null,
    mcpDoctorRun: null,
    pluginsRun: null,
    sessionsRun: null,
    refreshGrokAuthStatus: vi.fn(),
    refreshGrokModels: vi.fn(),
    refreshGrokEcosystem: vi.fn(),
    refreshGrokMcp: vi.fn(),
    doctorGrokMcp: vi.fn(),
    refreshGrokPlugins: vi.fn(),
    refreshGrokSessions: vi.fn(),
    startGrokLogin: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useGrokRunners>;
}

function makeModelConfig(overrides: Record<string, unknown> = {}) {
  return {
    modelPreset: 'grok-build',
    customModel: '',
    setCustomModel: vi.fn(),
    effortLevel: 'high',
    setEffortLevel: vi.fn(),
    reasoningEffort: 'off',
    setReasoningEffort: vi.fn(),
    permissionMode: 'default',
    setPermissionMode: vi.fn(),
    bestOfN: 1,
    setBestOfN: vi.fn(),
    experimentalMemory: false,
    setExperimentalMemory: vi.fn(),
    webSearchEnabled: false,
    setWebSearchEnabled: vi.fn(),
    subagentsEnabled: false,
    setSubagentsEnabled: vi.fn(),
    selfCheck: false,
    setSelfCheck: vi.fn(),
    activeModel: 'grok-build',
    activeModelMeta: { label: 'grok-build', detail: 'stub detail' },
    activeReasoningLabel: 'Auto',
    changeModelPreset: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useModelConfig>;
}

function renderDrawer(overrides: Partial<InspectorDrawerProps> = {}) {
  const props: InspectorDrawerProps = {
    open: true,
    onOpenPanel: vi.fn(),
    onClose: vi.fn(),
    inspectorTab: 'context',
    setInspectorTab: vi.fn(),
    dockPosition: 'right',
    onDockPositionChange: vi.fn(),
    runners: makeRunners(),
    modelConfig: makeModelConfig(),
    actionPolicy: 'patch',
    setActionPolicy: vi.fn(),
    history: [],
    lastRun: null,
    setLastRun: vi.fn(),
    clearRunHistory: vi.fn(),
    workspacePath: '/repo/project',
    onInsertDesktopContext: vi.fn(),
    ...overrides,
  };
  const utils = render(<InspectorDrawer {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('InspectorDrawer summary and shell controls', () => {
  it('summarizes inspect counts in the drawer summary line', () => {
    renderDrawer();
    expect(screen.getByText('2 skills · 2 MCP · 1 agents')).toBeInTheDocument();
  });

  it('toggles the dock position from right to bottom and back', async () => {
    const user = userEvent.setup();
    const { props, unmount } = renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Toggle dock position' }));
    expect(props.onDockPositionChange).toHaveBeenCalledWith('bottom');
    unmount();

    const { props: bottomProps } = renderDrawer({ dockPosition: 'bottom' });
    await user.click(screen.getByRole('button', { name: 'Toggle dock position' }));
    expect(bottomProps.onDockPositionChange).toHaveBeenCalledWith('right');
  });

  it('closes via the close button', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('reconciles the <details> toggle with the host open state in both directions', () => {
    const { props, container, unmount } = renderDrawer({ open: false });
    const details = container.querySelector('details')!;
    // User expands the collapsed drawer natively.
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(props.onOpenPanel).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    unmount();

    const { props: openProps, container: openContainer } = renderDrawer({ open: true });
    const openDetails = openContainer.querySelector('details')!;
    openDetails.open = false;
    fireEvent(openDetails, new Event('toggle'));
    expect(openProps.onClose).toHaveBeenCalledTimes(1);
    expect(openProps.onOpenPanel).not.toHaveBeenCalled();
  });
});

describe('InspectorDrawer context tab', () => {
  it('routes every run-config select and toggle to its setter', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer();
    const config = props.modelConfig;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Grok model preset' }), [
      'grok-4.3',
    ]);
    expect(config.changeModelPreset).toHaveBeenCalledWith('grok-4.3');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent effort' }), ['max']);
    expect(config.setEffortLevel).toHaveBeenCalledWith('max');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Reasoning effort' }), ['high']);
    expect(config.setReasoningEffort).toHaveBeenCalledWith('high');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Best of N' }), ['4']);
    expect(config.setBestOfN).toHaveBeenCalledWith(4);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Permission mode' }), ['plan']);
    expect(config.setPermissionMode).toHaveBeenCalledWith('plan');

    await user.click(screen.getByRole('checkbox', { name: 'Memory' }));
    expect(config.setExperimentalMemory).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('checkbox', { name: 'Web' }));
    expect(config.setWebSearchEnabled).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('checkbox', { name: 'Subagents' }));
    expect(config.setSubagentsEnabled).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('checkbox', { name: 'Check' }));
    expect(config.setSelfCheck).toHaveBeenCalledWith(true);
  });

  it('shows the custom model input only for the custom preset', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDrawer();
    expect(screen.queryByRole('textbox', { name: 'Custom Grok model ID' })).not.toBeInTheDocument();
    unmount();

    const { props } = renderDrawer({ modelConfig: makeModelConfig({ modelPreset: 'custom' }) });
    const input = screen.getByRole('textbox', { name: 'Custom Grok model ID' });
    await user.type(input, 'g');
    expect(props.modelConfig.setCustomModel).toHaveBeenCalledWith('g');
  });

  it('wires the auth actions: connect, device login, and status refresh', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({
      runners: makeRunners({ modelsRun: toolRun('grok models', 'model list output') }),
    });
    const runners = props.runners;

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(runners.startGrokLogin).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Device' }));
    expect(runners.startGrokLogin).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(runners.refreshGrokAuthStatus).toHaveBeenCalledTimes(1);

    // The last models run renders as mini output.
    expect(screen.getByText('model list output')).toBeInTheDocument();
  });

  it('disables device login when the CLI is not installed', () => {
    renderDrawer({ runners: makeRunners({ grokStatus: { installed: false } }) });
    expect(screen.getByRole('button', { name: 'Device' })).toBeDisabled();
  });

  it('shows repo trust, workspace path, metric counts, and triggers inspect', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer();

    expect(screen.getByText('yes')).toBeInTheDocument(); // Project trusted: yes
    expect(screen.getByText('/repo/project')).toBeInTheDocument();
    const metrics = document.querySelector('.metric-grid')!;
    expect(within(metrics as HTMLElement).getByText('Skills').previousSibling).toHaveTextContent(
      '2',
    );
    expect(within(metrics as HTMLElement).getByText('Agents').previousSibling).toHaveTextContent(
      '1',
    );

    await user.click(screen.getByRole('button', { name: 'Inspect Grok' }));
    expect(props.runners.refreshGrokEcosystem).toHaveBeenCalledTimes(1);
  });
});

describe('InspectorDrawer capability tabs', () => {
  it('skills: lists parsed skills and refreshes the ecosystem', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({ inspectorTab: 'skills' });
    expect(screen.getByText('alpha skill')).toBeInTheDocument();
    expect(screen.getByText('beta skill')).toBeInTheDocument();
    expect(screen.getByText('2 discovered')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh Skills' }));
    expect(props.runners.refreshGrokEcosystem).toHaveBeenCalledTimes(1);
  });

  it('skills: falls back to the load hint without inspect data', () => {
    renderDrawer({ inspectorTab: 'skills', runners: makeRunners({ ecosystemRun: null }) });
    expect(screen.getByText('Run Inspect Grok to load available skills.')).toBeInTheDocument();
    expect(screen.getByText('0 discovered')).toBeInTheDocument();
  });

  it('mcp: lists servers, runs list + doctor, and renders their outputs', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({
      inspectorTab: 'mcp',
      runners: makeRunners({
        mcpRun: toolRun('grok mcp list', 'two servers configured'),
        mcpDoctorRun: toolRun('grok mcp doctor', 'all servers healthy'),
      }),
    });
    expect(screen.getByText('browser server')).toBeInTheDocument();
    expect(screen.getByText('files server')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'List MCP' }));
    expect(props.runners.refreshGrokMcp).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Doctor' }));
    expect(props.runners.doctorGrokMcp).toHaveBeenCalledTimes(1);

    expect(screen.getByText('two servers configured')).toBeInTheDocument();
    expect(screen.getByText('all servers healthy')).toBeInTheDocument();
  });

  it('agents: lists agents and fetches sessions', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({
      inspectorTab: 'agents',
      runners: makeRunners({ sessionsRun: toolRun('grok sessions list', 'three sessions') }),
    });
    expect(screen.getByText('planner agent')).toBeInTheDocument();
    expect(screen.getByText('1 available')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(props.runners.refreshGrokSessions).toHaveBeenCalledTimes(1);
    expect(screen.getByText('three sessions')).toBeInTheDocument();
  });

  it('plugins: lists plugins and triggers the plugin list runner', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({ inspectorTab: 'plugins' });
    expect(screen.getByText('linter plugin')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'List Plugins' }));
    expect(props.runners.refreshGrokPlugins).toHaveBeenCalledTimes(1);
  });

  it('hooks: lists hooks parsed from the inspect output', () => {
    renderDrawer({ inspectorTab: 'hooks' });
    expect(screen.getByText('pre-commit hook')).toBeInTheDocument();
    expect(screen.getByText('1 loaded')).toBeInTheDocument();
  });

  it('desktop: renders the desktop bridge panel', async () => {
    installTauriAppMock();
    renderDrawer({ inspectorTab: 'desktop' });
    // DesktopPanel loads the whitelisted app list through the Tauri mock.
    expect(await screen.findByText('Safari')).toBeInTheDocument();
  });
});

describe('InspectorDrawer permissions tab', () => {
  const runA: ToolRun = toolRun('grok inspect', 'ok output');
  const runB: ToolRun = toolRun('grok mcp list', '', false, 'boom');

  it('changes the approval policy and shows the parsed permissions source', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({ inspectorTab: 'permissions' });
    expect(screen.getByText('/repo/.grok/settings.json')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Approval policy' }), ['review']);
    expect(props.setActionPolicy).toHaveBeenCalledWith('review');
    // The current policy detail is displayed.
    expect(
      screen.getByText('Produce exact changes and apply narrow safe edits with normal approvals.'),
    ).toBeInTheDocument();
  });

  it('renders command history rows, re-selects a run, and clears history', async () => {
    const user = userEvent.setup();
    const { props } = renderDrawer({
      inspectorTab: 'permissions',
      history: [runA, runB],
    });

    const rows = screen
      .getAllByRole('button')
      .filter((el) => el.textContent?.includes('grok mcp list'));
    expect(rows).toHaveLength(1);
    await user.click(rows[0]!);
    expect(props.setLastRun).toHaveBeenCalledWith(runB);

    await user.click(screen.getByRole('button', { name: 'Clear run history' }));
    expect(props.clearRunHistory).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last run when history is empty, and disables clear with no runs', () => {
    const { unmount } = renderDrawer({
      inspectorTab: 'permissions',
      history: [],
      lastRun: runA,
    });
    expect(screen.getByText('grok inspect')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear run history' })).toBeEnabled();
    unmount();

    renderDrawer({ inspectorTab: 'permissions', history: [], lastRun: null });
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear run history' })).toBeDisabled();
  });
});
