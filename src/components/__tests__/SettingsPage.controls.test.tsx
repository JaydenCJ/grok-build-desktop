// Complements SettingsPage.test.tsx: drives every remaining control so each
// select/input/toggle demonstrably reaches its setter — model preset & custom
// id, effort/reasoning selects, the memory toggle, Best-of-N lower clamp,
// permission selects/toggles (incl. the unknown-policy branch), and the
// workspace folder input.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage, type SettingsPageProps } from '../SettingsPage';
import { t } from '../../i18n';

function makeProps(overrides: Partial<SettingsPageProps> = {}): SettingsPageProps {
  return {
    open: true,
    section: 'model',
    onSection: vi.fn(),
    onClose: vi.fn(),
    themeMode: 'dark',
    setThemeMode: vi.fn(),
    dockPosition: 'right',
    setDockPosition: vi.fn(),
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    modelOptions: [
      { value: 'grok-build', label: 'grok-build' },
      { value: 'custom', label: 'Custom' },
    ],
    modelPreset: 'grok-build',
    onModelPreset: vi.fn(),
    customModel: '',
    setCustomModel: vi.fn(),
    activeModel: 'grok-build',
    effortOptions: [
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    effortLevel: 'medium',
    setEffortLevel: vi.fn(),
    reasoningOptions: [
      { value: 'off', label: 'Auto' },
      { value: 'high', label: 'High reasoning' },
    ],
    reasoningEffort: 'off',
    setReasoningEffort: vi.fn(),
    bestOfN: 3,
    setBestOfN: vi.fn(),
    experimentalMemory: false,
    setExperimentalMemory: vi.fn(),
    actionPolicyOptions: [
      { value: 'review', label: 'Review only', detail: 'Read only.', risk: 'none' },
      {
        value: 'autopilot',
        label: 'Autopilot',
        detail: 'Auto-approves every tool call.',
        risk: 'high',
      },
    ],
    actionPolicy: 'review',
    setActionPolicy: vi.fn(),
    permissionOptions: [
      { value: 'default', label: 'Default' },
      { value: 'plan', label: 'Plan' },
    ],
    permissionMode: 'default',
    setPermissionMode: vi.fn(),
    webSearchEnabled: false,
    setWebSearchEnabled: vi.fn(),
    subagentsEnabled: false,
    setSubagentsEnabled: vi.fn(),
    selfCheck: false,
    setSelfCheck: vi.fn(),
    codingCwd: '/repo',
    setCodingCwd: vi.fn(),
    onPickFolder: vi.fn(),
    appVersion: '0.4.0',
    grokVersionLine: 'Grok CLI 1.0',
    ...overrides,
  };
}

describe('SettingsPage controls', () => {
  it('general: the Dark theme segment drives setThemeMode', async () => {
    const user = userEvent.setup();
    const props = makeProps({ section: 'general', themeMode: 'light' });
    render(<SettingsPage {...props} />);
    await user.click(screen.getByRole('button', { name: t('common.dark') }));
    expect(props.setThemeMode).toHaveBeenCalledWith('dark');
  });

  it('model: preset, effort and reasoning selects plus the memory toggle hit their setters', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SettingsPage {...props} />);

    await user.selectOptions(screen.getByLabelText(t('settings.model')), 'custom');
    expect(props.onModelPreset).toHaveBeenCalledWith('custom');

    await user.selectOptions(screen.getByLabelText(t('settings.effort')), 'high');
    expect(props.setEffortLevel).toHaveBeenCalledWith('high');

    await user.selectOptions(screen.getByLabelText(t('settings.reasoningEffort')), 'high');
    expect(props.setReasoningEffort).toHaveBeenCalledWith('high');

    const memory = screen.getByRole('switch', { name: t('settings.memoryToggle') });
    expect(memory).toHaveAttribute('aria-checked', 'false');
    await user.click(memory);
    expect(props.setExperimentalMemory).toHaveBeenCalledWith(true);
  });

  it('model: edits the custom model id when the custom preset is active', async () => {
    const user = userEvent.setup();
    const props = makeProps({ modelPreset: 'custom', customModel: 'my-model' });
    render(<SettingsPage {...props} />);

    const input = screen.getByLabelText(t('settings.customModelId'));
    expect(input).toHaveValue('my-model');
    await user.type(input, 'x');
    expect(props.setCustomModel).toHaveBeenCalledWith('my-modelx');
  });

  it('model: clamps Best-of-N into 1..5 (empty / 0 → 1, 9 → 5)', () => {
    const props = makeProps();
    render(<SettingsPage {...props} />);

    // The input is controlled, so drive raw change events for the edge values.
    const bestOf = screen.getByLabelText(t('settings.bestOfN'));
    fireEvent.change(bestOf, { target: { value: '' } }); // Number('') is falsy → 1
    expect(props.setBestOfN).toHaveBeenLastCalledWith(1);
    fireEvent.change(bestOf, { target: { value: '0' } });
    expect(props.setBestOfN).toHaveBeenLastCalledWith(1);
    fireEvent.change(bestOf, { target: { value: '9' } });
    expect(props.setBestOfN).toHaveBeenLastCalledWith(5);
  });

  it('permissions: policy and mode selects, subagents and self-check toggles', async () => {
    const user = userEvent.setup();
    const props = makeProps({ section: 'permissions' });
    render(<SettingsPage {...props} />);

    // The current (risk-none) policy detail renders without the warning glyph.
    const detail = document.querySelector('.set-policy-detail') as HTMLElement;
    expect(detail).toHaveClass('risk-none');
    expect(detail.textContent).toContain('Read only.');
    expect(detail.textContent).not.toContain('⚠');

    await user.selectOptions(screen.getByLabelText(t('settings.actionPolicy')), 'autopilot');
    expect(props.setActionPolicy).toHaveBeenCalledWith('autopilot');

    await user.selectOptions(screen.getByLabelText(t('settings.permissionMode')), 'plan');
    expect(props.setPermissionMode).toHaveBeenCalledWith('plan');

    await user.click(screen.getByRole('switch', { name: t('settings.subagents') }));
    expect(props.setSubagentsEnabled).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('switch', { name: t('settings.selfCheck') }));
    expect(props.setSelfCheck).toHaveBeenCalledWith(true);
  });

  it('permissions: renders no policy detail for an unknown policy value', () => {
    render(<SettingsPage {...makeProps({ section: 'permissions', actionPolicy: 'mystery' })} />);
    expect(document.querySelector('.set-policy-detail')).toBeNull();
  });

  it('workspace: typing in the project folder input reaches setCodingCwd', async () => {
    const user = userEvent.setup();
    const props = makeProps({ section: 'integrations' });
    render(<SettingsPage {...props} />);

    await user.type(screen.getByLabelText(t('settings.projectFolder')), 'x');
    expect(props.setCodingCwd).toHaveBeenCalledWith('/repox');
  });
});
