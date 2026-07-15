// Second slice of useSessionPersistence tests, focused on the paths the main
// suite leaves out: boot-time localStorage migrations (legacy shell command,
// run counter fallback, theme migration gate, the one-time composer clean),
// and the debounced session_state.json save — both the happy path and the
// save-failure notice.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mockIPC } from '@tauri-apps/api/mocks';
import { useSessionPersistence } from '../useSessionPersistence';
import { storageKeys } from '../../app/constants';
import type { SessionState } from '../../app/types';
import type { ToolRun } from '../../lib/grok';

function toolRun(overrides: Partial<ToolRun> = {}): ToolRun {
  return {
    ok: true,
    command: 'grok',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 5,
    timed_out: false,
    output: 'ok',
    stderr: '',
    ...overrides,
  };
}

function render() {
  const setComposerValue = vi.fn();
  const setSessionNotice = vi.fn();
  const hook = renderHook(() => useSessionPersistence({ setComposerValue, setSessionNotice }));
  return { ...hook, setComposerValue, setSessionNotice };
}

describe('boot-time migrations and hydration fallbacks', () => {
  it('replaces both legacy default shell commands with the safe default', () => {
    window.localStorage.setItem(storageKeys.shellCommand, 'pwd && git status --short && ls');
    expect(render().result.current.shellCommand).toBe(
      'pwd; git status --short 2>/dev/null || true; ls',
    );
  });

  it('keeps a user-customized shell command as-is', () => {
    window.localStorage.setItem(storageKeys.shellCommand, 'make lint && make test');
    expect(render().result.current.shellCommand).toBe('make lint && make test');
  });

  it('hydrates mode and action policy from storage, rejecting junk values', () => {
    window.localStorage.setItem(storageKeys.mode, 'standard');
    window.localStorage.setItem(storageKeys.actionPolicy, 'autopilot');
    const good = render();
    expect(good.result.current.mode).toBe('standard');
    expect(good.result.current.actionPolicy).toBe('autopilot');
    good.unmount();

    window.localStorage.setItem(storageKeys.mode, 'yolo');
    window.localStorage.setItem(storageKeys.actionPolicy, 'yolo');
    const bad = render();
    expect(bad.result.current.mode).toBe('coding');
    expect(bad.result.current.actionPolicy).toBe('patch');
  });

  it('falls back to the stored run-history length when the lifetime counter is missing or invalid', () => {
    window.localStorage.setItem(
      storageKeys.runHistory,
      JSON.stringify([toolRun({ command: 'a' }), toolRun({ command: 'b' })]),
    );
    // Missing counter → history length.
    expect(render().result.current.totalRuns).toBe(2);
    // Negative (invalid) counter → history length again.
    window.localStorage.setItem('grok-desktop-run-count-total', '-4');
    expect(render().result.current.totalRuns).toBe(2);
    // A real counter wins over the (shorter) capped history.
    window.localStorage.setItem('grok-desktop-run-count-total', '11');
    expect(render().result.current.totalRuns).toBe(11);
  });

  it('falls back to the default drafts when the stored drafts JSON is corrupt', () => {
    window.localStorage.setItem(storageKeys.drafts, '{not json at all');
    const { result } = render();
    expect(result.current.drafts.coding).toContain('Inspect the current repository');
    expect(result.current.drafts.standard).toContain('Answer clearly');
  });

  it('ignores a stored light theme until the clean-layout migration flag is set', () => {
    window.localStorage.setItem(storageKeys.themeMode, 'light');
    const unmigrated = render();
    expect(unmigrated.result.current.themeMode).toBe('dark');
    unmigrated.unmount();

    window.localStorage.setItem(storageKeys.themeMode, 'light');
    window.localStorage.setItem(storageKeys.cleanLayoutTheme, 'true');
    expect(render().result.current.themeMode).toBe('light');
  });

  it('one-time composer clean: wipes the active-mode draft when a last run exists', () => {
    window.localStorage.setItem(storageKeys.lastRun, JSON.stringify(toolRun()));
    window.localStorage.setItem(
      storageKeys.drafts,
      JSON.stringify({ coding: 'stale sent prompt', standard: 'keep me' }),
    );
    const { result, setComposerValue } = render();

    expect(result.current.drafts.coding).toBe('');
    expect(result.current.drafts.standard).toBe('keep me');
    expect(setComposerValue).toHaveBeenCalledWith('');
    // The migration is stamped so it never re-runs.
    expect(window.localStorage.getItem(storageKeys.cleanComposer)).toBe('true');
    expect(window.localStorage.getItem(storageKeys.safeRuntimeDefaults)).toBe('true');
    expect(JSON.parse(window.localStorage.getItem(storageKeys.drafts)!).coding).toBe('');
  });

  it('composer clean does not run again once the flag is stamped', () => {
    window.localStorage.setItem(storageKeys.lastRun, JSON.stringify(toolRun()));
    window.localStorage.setItem(storageKeys.cleanComposer, 'true');
    window.localStorage.setItem(
      storageKeys.drafts,
      JSON.stringify({ coding: 'draft in progress', standard: '' }),
    );
    const { result, setComposerValue } = render();
    expect(result.current.drafts.coding).toBe('draft in progress');
    expect(setComposerValue).not.toHaveBeenCalledWith('');
  });
});

describe('debounced session_state.json save (Tauri runtime)', () => {
  it('saves the full session state after changes settle', async () => {
    const saved: SessionState[] = [];
    mockIPC((cmd, payload) => {
      if (cmd === 'load_session_state') return null;
      if (cmd === 'save_session_state') {
        saved.push((payload as { state: SessionState }).state);
        return null;
      }
      return undefined;
    });

    const { result } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));

    act(() => {
      result.current.setCodingCwd('/deb/ounce');
      result.current.setShellCommand('make verify');
      result.current.setCodingWorkflow('review');
    });

    await waitFor(() => {
      const last = saved[saved.length - 1];
      expect(last?.codingCwd).toBe('/deb/ounce');
    });
    const last = saved[saved.length - 1]!;
    // The snapshot carries the whole persisted surface, not just the change.
    expect(last.shellCommand).toBe('make verify');
    expect(last.codingWorkflow).toBe('review');
    expect(last.mode).toBe('coding');
    expect(last.themeMode).toBe('dark');
    expect(Array.isArray(last.history)).toBe(true);
    expect(Array.isArray(last.messages)).toBe(true);
  });

  it('surfaces a save failure as a session notice instead of swallowing it', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_session_state') return null;
      if (cmd === 'save_session_state') throw new Error('disk full');
      return undefined;
    });

    const { result, setSessionNotice } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));
    act(() => result.current.setCodingCwd('/anywhere'));

    await waitFor(() =>
      expect(setSessionNotice).toHaveBeenCalledWith(
        expect.stringContaining('Session save failed: disk full'),
      ),
    );
  });

  it('applies shellCommand and codingWorkflow from the restored file', async () => {
    const restored: SessionState = {
      shellCommand: 'cargo check --workspace',
      codingWorkflow: 'debug',
    };
    mockIPC((cmd) => (cmd === 'load_session_state' ? restored : undefined));

    const { result } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));
    expect(result.current.shellCommand).toBe('cargo check --workspace');
    expect(result.current.codingWorkflow).toBe('debug');
  });

  it('a restore resolving after unmount must not fire notices or state updates', async () => {
    let loadResolve: (v: SessionState) => void = () => {};
    mockIPC((cmd) => {
      if (cmd === 'load_session_state') {
        return new Promise((resolve) => {
          loadResolve = resolve;
        });
      }
      return undefined;
    });

    const { unmount, setSessionNotice } = render();
    unmount();
    act(() => loadResolve({ history: [toolRun()], messages: [] }));
    // Drain the microtask queue so the (cancelled) continuation runs.
    await act(async () => {
      await Promise.resolve();
    });
    expect(setSessionNotice).not.toHaveBeenCalled();
  });

  it('does not write session_state.json before the restore finished', async () => {
    let loadResolve: (v: null) => void = () => {};
    const saveCalls: string[] = [];
    mockIPC((cmd) => {
      if (cmd === 'load_session_state') {
        return new Promise((resolve) => {
          loadResolve = resolve;
        });
      }
      if (cmd === 'save_session_state') {
        saveCalls.push(cmd);
        return null;
      }
      return undefined;
    });

    const { result } = render();
    act(() => result.current.setCodingCwd('/early/change'));
    // Give any (wrong) debounce a chance to fire while the load is pending.
    await new Promise((r) => setTimeout(r, 400));
    expect(saveCalls).toHaveLength(0);

    act(() => loadResolve(null));
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));
    await waitFor(() => expect(saveCalls.length).toBeGreaterThan(0));
  });
});
