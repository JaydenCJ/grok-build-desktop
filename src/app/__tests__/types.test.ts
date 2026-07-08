import { describe, expect, it } from 'vitest';
import {
  isActionPolicy,
  isChatMessage,
  isDockPosition,
  isEffortLevel,
  isGrokModelId,
  isInspectorTab,
  isMode,
  isPermissionMode,
  isReasoningEffort,
  isThemeMode,
  isToolRun,
} from '../types';

describe('simple union guards', () => {
  it('isMode', () => {
    expect(isMode('coding')).toBe(true);
    expect(isMode('standard')).toBe(true);
    expect(isMode('chat')).toBe(false);
    expect(isMode(null)).toBe(false);
  });

  it('isActionPolicy', () => {
    for (const v of ['review', 'patch', 'autopilot']) expect(isActionPolicy(v)).toBe(true);
    expect(isActionPolicy('plan')).toBe(false);
  });

  it('isInspectorTab accepts every tab, including the late-added desktop tab', () => {
    for (const v of ['context', 'skills', 'mcp', 'agents', 'plugins', 'hooks', 'permissions', 'desktop']) {
      expect(isInspectorTab(v)).toBe(true);
    }
    expect(isInspectorTab('overview')).toBe(false);
  });

  it('isEffortLevel and isReasoningEffort', () => {
    for (const v of ['low', 'medium', 'high', 'xhigh', 'max']) expect(isEffortLevel(v)).toBe(true);
    expect(isEffortLevel('off')).toBe(false);
    for (const v of ['off', 'low', 'medium', 'high', 'xhigh', 'max']) expect(isReasoningEffort(v)).toBe(true);
    expect(isReasoningEffort('none')).toBe(false);
  });

  it('isGrokModelId', () => {
    expect(isGrokModelId('grok-build')).toBe(true);
    expect(isGrokModelId('custom')).toBe(true);
    expect(isGrokModelId('grok-5')).toBe(false);
  });

  it('isPermissionMode / isThemeMode / isDockPosition', () => {
    for (const v of ['default', 'acceptEdits', 'auto', 'dontAsk', 'plan']) expect(isPermissionMode(v)).toBe(true);
    expect(isPermissionMode('always')).toBe(false);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('auto')).toBe(false);
    expect(isDockPosition('right')).toBe(true);
    expect(isDockPosition('bottom')).toBe(true);
    expect(isDockPosition('left')).toBe(false);
  });
});

describe('isToolRun', () => {
  const base = {
    ok: true,
    command: 'grok',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 1,
    timed_out: false,
    output: '',
    stderr: '',
  };

  it('accepts a well-formed run, including a null exit code', () => {
    expect(isToolRun(base)).toBe(true);
    expect(isToolRun({ ...base, exit_code: null })).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isToolRun(null)).toBe(false);
    expect(isToolRun('run')).toBe(false);
    expect(isToolRun({ ...base, ok: 'yes' })).toBe(false);
    expect(isToolRun({ ...base, exit_code: '0' })).toBe(false);
    const { stderr: _stderr, ...missingField } = base;
    expect(isToolRun(missingField)).toBe(false);
  });
});

describe('isChatMessage', () => {
  it('accepts user and assistant messages', () => {
    expect(isChatMessage({ id: 'a', role: 'user', content: 'hi', ts: 1 })).toBe(true);
    expect(isChatMessage({ id: 'b', role: 'assistant', content: '', ts: 2, status: 'done' })).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(isChatMessage(null)).toBe(false);
    expect(isChatMessage({ id: 1, role: 'user', content: 'x', ts: 1 })).toBe(false);
    expect(isChatMessage({ id: 'a', role: 'system', content: 'x', ts: 1 })).toBe(false);
    expect(isChatMessage({ id: 'a', role: 'user', content: 'x', ts: 'now' })).toBe(false);
    expect(isChatMessage({ id: 'a', role: 'user', ts: 1 })).toBe(false);
  });
});
