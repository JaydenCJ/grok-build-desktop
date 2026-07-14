// Behavior tests for ComposerSection: the autopilot risk banner, every
// footer select (mode / model incl. custom + unverified labels / workflow /
// action policy / effort / reasoning / best-of-N), the inline Stop button,
// and the draft-persistence + error wiring into the embedded Composer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { ComposerSection, type ComposerSectionProps } from '../ComposerSection';
import type { ComposerHandle } from '../Composer';
import type { useModelConfig } from '../../hooks/useModelConfig';
import { codingPresets, defaultDrafts } from '../../app/constants';
import { streamStore } from '../../lib/streamStore';

beforeEach(() => {
  streamStore.__reset();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

function makeModelConfig(overrides: Record<string, unknown> = {}) {
  return {
    modelPreset: 'grok-build',
    setModelPreset: vi.fn(),
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
    activeModel: 'grok-build',
    changeModelPreset: vi.fn(),
    modelOptions: ['grok-build', 'grok-4.3'],
    modelIsVerified: true,
    ...overrides,
  } as unknown as ReturnType<typeof useModelConfig>;
}

function renderSection(overrides: Partial<ComposerSectionProps> = {}) {
  const props: ComposerSectionProps = {
    composerRef: createRef<ComposerHandle>(),
    codingCwd: '/repo',
    buildRunArgs: () => ['--output-format', 'streaming-json'],
    drafts: { standard: '', coding: '' },
    mode: 'coding',
    setDrafts: vi.fn(),
    switchMode: vi.fn(),
    handleEnqueued: vi.fn(),
    setSessionNotice: vi.fn(),
    modelConfig: makeModelConfig(),
    availableModels: [],
    actionPolicy: 'patch',
    setActionPolicy: vi.fn(),
    codingWorkflow: 'analyze',
    applyCodingPreset: vi.fn(),
    grokIsRunning: false,
    activeRunId: null,
    stopRun: vi.fn(),
    ...overrides,
  };
  const utils = render(<ComposerSection {...props} />);
  return { ...utils, props };
}

describe('ComposerSection autopilot banner', () => {
  it('is absent under the patch policy', () => {
    mockIPC(() => undefined);
    renderSection();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns under autopilot and the dismiss button drops back to patch', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection({ actionPolicy: 'autopilot' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Autopilot is on — Grok auto-approves every action.');
    await user.click(screen.getByRole('button', { name: 'Switch to Patch' }));
    expect(props.setActionPolicy).toHaveBeenCalledWith('patch');
  });
});

describe('ComposerSection footer selects', () => {
  it('switches interaction mode', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Interaction mode' }), [
      'standard',
    ]);
    expect(props.switchMode).toHaveBeenCalledWith('standard');
  });

  it('routes a known model id through changeModelPreset', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grok model' }), ['grok-4.3']);
    const config = props.modelConfig;
    expect(config.changeModelPreset).toHaveBeenCalledWith('grok-4.3');
    expect(config.setModelPreset).not.toHaveBeenCalled();
  });

  it('routes the Custom… placeholder option through changeModelPreset', async () => {
    // 'custom' IS part of the GrokModelId union, so it flows through the
    // preset changer like any other preset id.
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grok model' }), ['custom']);
    const config = props.modelConfig;
    expect(config.changeModelPreset).toHaveBeenCalledWith('custom');
    expect(config.setModelPreset).not.toHaveBeenCalled();
  });

  it('treats a CLI-only model id as a custom model', async () => {
    // Ids reported by the grok CLI that are not preset ids take the
    // custom-model path: preset flips to custom and the raw id is kept.
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection({
      modelConfig: makeModelConfig({ modelOptions: ['grok-build', 'grok-exp-42'] }),
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grok model' }), ['grok-exp-42']);
    const config = props.modelConfig;
    expect(config.setModelPreset).toHaveBeenCalledWith('custom');
    expect(config.setCustomModel).toHaveBeenCalledWith('grok-exp-42');
    expect(config.changeModelPreset).not.toHaveBeenCalled();
  });

  it('marks models missing from the CLI list and flags an unverified active model', () => {
    mockIPC(() => undefined);
    renderSection({
      availableModels: ['grok-build'],
      modelConfig: makeModelConfig({ modelIsVerified: false, activeModel: 'grok-4.3' }),
    });
    const select = screen.getByRole('combobox', { name: 'Grok model' });
    expect(screen.getByRole('option', { name: 'grok-4.3 · not in CLI' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'grok-build' })).toBeInTheDocument();
    expect(select).toHaveAttribute('title', 'grok-4.3 — not in grok CLI list, may fall back');
  });

  it('applies the matching coding preset from the workflow select', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Coding workflow' }), ['review']);
    const expected = codingPresets.find((p) => p.id === 'review')!;
    expect(props.applyCodingPreset).toHaveBeenCalledWith(expected);
  });

  it('changes action policy, effort, reasoning and best-of-N through their setters', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection();
    const config = props.modelConfig;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Action policy' }), [
      'autopilot',
    ]);
    expect(props.setActionPolicy).toHaveBeenCalledWith('autopilot');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent effort' }), ['max']);
    expect(config.setEffortLevel).toHaveBeenCalledWith('max');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Reasoning effort' }), ['high']);
    expect(config.setReasoningEffort).toHaveBeenCalledWith('high');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Best-of-N' }), ['3']);
    expect(config.setBestOfN).toHaveBeenCalledWith(3);
  });
});

describe('ComposerSection stop button', () => {
  it('is hidden while idle and stops the active run when running', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { unmount } = renderSection();
    expect(screen.queryByTitle('Stop run')).not.toBeInTheDocument();
    unmount();

    const { props } = renderSection({ grokIsRunning: true, activeRunId: 'run-42' });
    await user.click(screen.getByTitle('Stop run'));
    expect(props.stopRun).toHaveBeenCalledWith('run-42');
  });
});

describe('ComposerSection composer wiring', () => {
  it('seeds the composer from the mode draft, falling back to the default draft', () => {
    mockIPC(() => undefined);
    const { unmount } = renderSection({
      drafts: { standard: '', coding: 'my saved draft' },
    });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my saved draft');
    unmount();

    renderSection();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(defaultDrafts.coding);
  });

  it('persists composer text into the drafts map for the current mode on blur', async () => {
    mockIPC(() => undefined);
    const user = userEvent.setup();
    const { props } = renderSection();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    await user.clear(textarea);
    await user.type(textarea, 'half-typed thought');
    await user.tab(); // blur → Composer flushes the draft

    const setDrafts = props.setDrafts as ReturnType<typeof vi.fn>;
    expect(setDrafts).toHaveBeenCalled();
    const updater = setDrafts.mock.calls.at(-1)![0] as (
      current: Record<string, string>,
    ) => Record<string, string>;
    expect(updater({ standard: 'keep me', coding: 'stale' })).toEqual({
      standard: 'keep me',
      coding: 'half-typed thought',
    });
  });

  it('surfaces enqueue failures as a session notice', async () => {
    mockIPC((cmd) => {
      if (cmd === 'enqueue_run') throw new Error('backend not ready');
      return undefined;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { props } = renderSection();

    // The seeded default draft is a valid prompt — just send it.
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(props.setSessionNotice).toHaveBeenCalledTimes(1));
    expect(props.setSessionNotice).toHaveBeenCalledWith(
      expect.stringMatching(/^Send failed: .*backend not ready/),
    );
    expect(props.handleEnqueued).not.toHaveBeenCalled();
  });

  it('reports successful enqueues upward', async () => {
    mockIPC((cmd) => (cmd === 'enqueue_run' ? { runId: 'r-ok', position: 2 } : undefined));
    const user = userEvent.setup();
    const { props } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(props.handleEnqueued).toHaveBeenCalledTimes(1));
    expect(props.handleEnqueued).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r-ok', position: 2, prompt: defaultDrafts.coding }),
    );
  });
});
