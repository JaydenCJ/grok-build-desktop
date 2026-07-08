import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mockIPC } from '@tauri-apps/api/mocks';
import { useSessionPersistence } from '../useSessionPersistence';
import { storageKeys, tabsActiveKey, tabsStorageKey } from '../../app/constants';
import type { ChatMessage, SessionState } from '../../app/types';
import type { ToolRun } from '../../lib/grok';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'user', content: `msg ${id}`, ts: 1000, ...overrides };
}

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

/** Seed a stored tabs array whose active tab holds `messages`. */
function seedActiveTab(messages: ChatMessage[]) {
  window.localStorage.setItem(
    tabsStorageKey,
    JSON.stringify([{ id: 't1', name: 'repo', cwd: '', createdAt: 1, messages }]),
  );
  window.localStorage.setItem(tabsActiveKey, 't1');
}

describe('useSessionPersistence in the browser (no Tauri runtime)', () => {
  it('hydrates messages from the active tab store, not the stale flat key', () => {
    seedActiveTab([message('tab-msg')]);
    window.localStorage.setItem(storageKeys.messages, JSON.stringify([message('flat-stale')]));
    const { result } = render();
    expect(result.current.messages.map((m) => m.id)).toEqual(['tab-msg']);
  });

  it('recordRun updates lastRun, capped history, and the lifetime counter', () => {
    const { result } = render();
    act(() => {
      for (let i = 0; i < 8; i += 1) result.current.recordRun(toolRun({ command: `run-${i}` }));
    });
    expect(result.current.lastRun?.command).toBe('run-7');
    expect(result.current.history).toHaveLength(6);
    expect(result.current.history[0].command).toBe('run-7');
    expect(result.current.totalRuns).toBe(8);
    expect(window.localStorage.getItem('grok-desktop-run-count-total')).toBe('8');
  });

  it('appendMessage keeps only the newest 120 messages', () => {
    const { result } = render();
    act(() => {
      for (let i = 0; i < 125; i += 1) result.current.appendMessage(message(`m${i}`));
    });
    expect(result.current.messages).toHaveLength(120);
    expect(result.current.messages[0].id).toBe('m5');
  });

  it('mirrors mode and theme changes to localStorage and the DOM theme attribute', () => {
    const { result } = render();
    act(() => result.current.setMode('standard'));
    expect(window.localStorage.getItem(storageKeys.mode)).toBe('standard');
    act(() => result.current.setThemeMode('light'));
    expect(window.localStorage.getItem(storageKeys.themeMode)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('useSessionPersistence desktop restore guards', () => {
  it('a stale session_state.json must NOT clobber a non-empty tab-hydrated conversation', async () => {
    seedActiveTab([message('fresh-a'), message('fresh-b')]);
    window.localStorage.setItem(storageKeys.codingCwd, '/fresh/repo');
    const restored: SessionState = {
      mode: 'coding',
      codingCwd: '/stale/other',
      messages: [message('stale-1'), message('stale-2'), message('stale-3')],
    };
    mockIPC((cmd) => {
      if (cmd === 'load_session_state') return restored;
      return undefined;
    });

    const { result, setSessionNotice } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));

    // The debounced file is always staler than the synchronous localStorage
    // mirror — it may only fill in, never override.
    expect(result.current.messages.map((m) => m.id)).toEqual(['fresh-a', 'fresh-b']);
    expect(result.current.codingCwd).toBe('/fresh/repo');
    // The user still gets a restore notice (the file did contribute counts).
    expect(setSessionNotice).toHaveBeenCalledWith(expect.stringContaining('Restored'));
  });

  it('adopts the file conversation when nothing hydrated locally, coercing streaming to stopped', async () => {
    const restored: SessionState = {
      mode: 'standard',
      codingCwd: '/from/file',
      actionPolicy: 'review',
      themeMode: 'dark',
      messages: [
        message('u1'),
        message('a1', { role: 'assistant', content: 'partial reply', status: 'streaming' }),
      ],
      history: [toolRun()],
    };
    mockIPC((cmd) => (cmd === 'load_session_state' ? restored : undefined));

    const { result } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));

    expect(result.current.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
    // A restart can never resume a stream — restored streaming turns read as stopped.
    expect(result.current.messages[1].status).toBe('stopped');
    expect(result.current.codingCwd).toBe('/from/file');
    expect(result.current.mode).toBe('standard');
    expect(result.current.actionPolicy).toBe('review');
    expect(result.current.history).toHaveLength(1);
    expect(result.current.lastRun?.command).toBe('grok');
  });

  it('filters malformed restored history/messages through the type guards', async () => {
    const restored = {
      history: [toolRun(), { junk: true }, 'nope'],
      messages: [message('ok'), { id: 9, role: 'user' }],
    } as unknown as SessionState;
    mockIPC((cmd) => (cmd === 'load_session_state' ? restored : undefined));

    const { result } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.messages.map((m) => m.id)).toEqual(['ok']);
  });

  it('surfaces a restore failure instead of swallowing it', async () => {
    mockIPC((cmd) => {
      if (cmd === 'load_session_state') throw new Error('disk exploded');
      return undefined;
    });
    const { result, setSessionNotice } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));
    expect(setSessionNotice).toHaveBeenCalledWith(
      expect.stringContaining('Session restore failed: disk exploded'),
    );
  });

  it('clears the restored draft when a last run exists (prompt already sent)', async () => {
    const restored: SessionState = {
      mode: 'coding',
      drafts: { coding: 'previously sent prompt', standard: '' },
      lastRun: toolRun(),
    };
    mockIPC((cmd) => (cmd === 'load_session_state' ? restored : undefined));
    const { result, setComposerValue } = render();
    await waitFor(() => expect(result.current.sessionLoaded).toBe(true));
    expect(result.current.drafts.coding).toBe('');
    expect(setComposerValue).toHaveBeenCalledWith('');
  });
});
