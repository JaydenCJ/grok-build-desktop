import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useModelConfig, type ModelConfigDeps } from '../useModelConfig';
import { storageKeys } from '../../app/constants';

function render(initial: Partial<ModelConfigDeps> = {}) {
  return renderHook((props: ModelConfigDeps) => useModelConfig(props), {
    initialProps: {
      mode: 'coding',
      availableModels: [],
      ...initial,
    } as ModelConfigDeps,
  });
}

describe('useModelConfig defaults and persistence', () => {
  it('starts from safe defaults with empty storage', () => {
    const { result } = render();
    expect(result.current.modelPreset).toBe('grok-build');
    expect(result.current.activeModel).toBe('grok-build');
    expect(result.current.effortLevel).toBe('medium');
    expect(result.current.reasoningEffort).toBe('off');
    expect(result.current.bestOfN).toBe(1);
    expect(result.current.webSearchEnabled).toBe(false);
    expect(result.current.subagentsEnabled).toBe(false);
  });

  it('restores persisted values (effort/web/subagents only after the safe-defaults migration)', () => {
    window.localStorage.setItem(storageKeys.safeRuntimeDefaults, 'true');
    window.localStorage.setItem(storageKeys.modelPreset, 'grok-latest');
    window.localStorage.setItem(storageKeys.effortLevel, 'xhigh');
    window.localStorage.setItem(storageKeys.reasoningEffort, 'high');
    window.localStorage.setItem(storageKeys.permissionMode, 'plan');
    window.localStorage.setItem(storageKeys.bestOfN, '3');
    window.localStorage.setItem(storageKeys.webSearchEnabled, 'true');
    const { result } = render({ mode: 'standard' });
    expect(result.current.modelPreset).toBe('grok-latest');
    expect(result.current.effortLevel).toBe('xhigh');
    expect(result.current.reasoningEffort).toBe('high');
    expect(result.current.permissionMode).toBe('plan');
    expect(result.current.bestOfN).toBe(3);
    expect(result.current.webSearchEnabled).toBe(true);
  });

  it('ignores persisted effort/web-search toggles before the migration flag exists', () => {
    window.localStorage.setItem(storageKeys.effortLevel, 'xhigh');
    window.localStorage.setItem(storageKeys.webSearchEnabled, 'true');
    const { result } = render();
    expect(result.current.effortLevel).toBe('medium');
    expect(result.current.webSearchEnabled).toBe(false);
  });

  it('rejects invalid persisted values', () => {
    window.localStorage.setItem(storageKeys.modelPreset, 'gpt-4');
    window.localStorage.setItem(storageKeys.bestOfN, '99');
    const { result } = render();
    expect(result.current.modelPreset).toBe('grok-build');
    expect(result.current.bestOfN).toBe(1);
  });

  it('mirrors changes back to localStorage', () => {
    const { result } = render();
    act(() => result.current.setEffortLevel('high'));
    expect(window.localStorage.getItem(storageKeys.effortLevel)).toBe('high');
    act(() => result.current.setSelfCheck(true));
    expect(window.localStorage.getItem(storageKeys.selfCheck)).toBe('true');
  });
});

describe('active model derivation', () => {
  it('uses the trimmed custom id when the preset is custom, falling back to grok-build', () => {
    const { result } = render({ mode: 'standard' });
    act(() => result.current.setModelPreset('custom'));
    act(() => result.current.setCustomModel('  my-model  '));
    expect(result.current.activeModel).toBe('my-model');
    act(() => result.current.setCustomModel('   '));
    expect(result.current.activeModel).toBe('grok-build');
  });

  it('changeModelPreset snaps reasoning to the preset default', () => {
    const { result } = render({ mode: 'standard' });
    act(() => result.current.changeModelPreset('grok-4.3'));
    expect(result.current.reasoningEffort).toBe('high');
    act(() => result.current.changeModelPreset('grok-build'));
    expect(result.current.reasoningEffort).toBe('off');
  });
});

describe('CLI-verified model options', () => {
  it('offers ONLY the CLI-reported models when the CLI reported any', () => {
    const { result } = render({ availableModels: ['grok-build', 'grok-9-preview'] });
    expect(result.current.modelOptions).toEqual(['grok-build', 'grok-9-preview']);
  });

  it('falls back to grok-build in coding mode and the declared presets in chat', () => {
    const coding = render({ mode: 'coding', availableModels: [] });
    expect(coding.result.current.modelOptions).toEqual(['grok-build']);
    const chat = render({ mode: 'standard', availableModels: [] });
    expect(chat.result.current.modelOptions).toContain('grok-4.3');
    expect(chat.result.current.modelOptions).not.toContain('custom');
  });

  it('filters CLI noise tokens out of the options', () => {
    const { result } = render({ availableModels: ['models', 'available', 'grok-build'] });
    expect(result.current.modelOptions).toEqual(['grok-build']);
  });

  it('flags an unverified active model', () => {
    window.localStorage.setItem(storageKeys.modelPreset, 'grok-4.3');
    const { result } = render({ mode: 'standard', availableModels: ['grok-build'] });
    expect(result.current.modelIsVerified).toBe(false);
  });
});

describe('coding-mode auto-snap', () => {
  it('snaps a stale preset to the first CLI model when it is a known preset id', () => {
    window.localStorage.setItem(storageKeys.modelPreset, 'grok-4.3');
    const { result } = render({ mode: 'coding', availableModels: ['grok-build'] });
    expect(result.current.modelPreset).toBe('grok-build');
    // Auto-snap goes through changeModelPreset, so reasoning follows too.
    expect(result.current.reasoningEffort).toBe('off');
  });

  it('routes unknown CLI ids through the custom preset so --model matches the dropdown', () => {
    window.localStorage.setItem(storageKeys.modelPreset, 'grok-4.3');
    const { result } = render({ mode: 'coding', availableModels: ['grok-9-new'] });
    expect(result.current.modelPreset).toBe('custom');
    expect(result.current.customModel).toBe('grok-9-new');
    expect(result.current.activeModel).toBe('grok-9-new');
  });

  it('leaves the selection alone in chat mode, with an unreporting CLI, or for custom', () => {
    window.localStorage.setItem(storageKeys.modelPreset, 'grok-4.3');
    const chat = render({ mode: 'standard', availableModels: ['grok-build'] });
    expect(chat.result.current.modelPreset).toBe('grok-4.3');

    window.localStorage.setItem(storageKeys.modelPreset, 'grok-4.3');
    const silent = render({ mode: 'coding', availableModels: [] });
    expect(silent.result.current.modelPreset).toBe('grok-4.3');

    window.localStorage.setItem(storageKeys.modelPreset, 'custom');
    window.localStorage.setItem(storageKeys.customModel, 'my-model');
    const custom = render({ mode: 'coding', availableModels: ['grok-build'] });
    expect(custom.result.current.modelPreset).toBe('custom');
    expect(custom.result.current.activeModel).toBe('my-model');
  });
});
