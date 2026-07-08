import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useSessionTabs } from '../useSessionTabs';
import { storageKeys, tabsActiveKey, tabsStorageKey } from '../../app/constants';
import type { ChatMessage, Mode } from '../../app/types';
import type { ToolRun } from '../../lib/grok';

function message(id: string, content = `msg ${id}`): ChatMessage {
  return { id, role: 'user', content, ts: 1000 };
}

/** Compose the flat session state the way App does, then hang tabs off it. */
function useHarness(initialMessages: ChatMessage[] = []) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [codingCwd, setCodingCwd] = useState('');
  const [drafts, setDrafts] = useState<Record<Mode, string>>({ standard: 's', coding: 'c' });
  const [lastRun, setLastRun] = useState<ToolRun | null>(null);
  const [notice, setNotice] = useState<string | null>('old notice');
  const tabsApi = useSessionTabs({
    messages,
    setMessages,
    codingCwd,
    setCodingCwd,
    setDrafts,
    setLastRun,
    setSessionNotice: setNotice,
    setComposerValue: () => {},
    focusComposer: () => {},
    closePalette: () => {},
    onConversationDeleted: harnessDeleted,
  });
  return { ...tabsApi, messages, setMessages, codingCwd, setCodingCwd, drafts, lastRun, notice };
}
let harnessDeleted: (id: string) => void = () => {};

function seedTabs() {
  const tabs = [
    { id: 't1', name: 'alpha', cwd: '/repo/alpha', createdAt: 1, messages: [message('a1')] },
    { id: 't2', name: 'beta', cwd: '/repo/beta', createdAt: 2, messages: [message('b1'), message('b2')] },
  ];
  window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
  window.localStorage.setItem(tabsActiveKey, 't1');
  return tabs;
}

describe('useSessionTabs boot', () => {
  it('hydrates stored tabs and the active id', () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1')]));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.current.activeTabId).toBe('t1');
  });

  it('adopts the synthesized first tab as active on a truly fresh install', () => {
    // Regression (found by the E2E run): with EMPTY localStorage the
    // activeTabId initializer ran before the first tab was persisted and came
    // up "" — no tab owned the conversation, so the mirror effect dropped the
    // first session's messages and New Session lost them for good.
    const { result } = renderHook(() => useHarness([]));
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);

    act(() => result.current.setMessages([message('first')]));
    // The conversation now lands in its owning tab (and thus in HISTORY).
    expect(result.current.tabs[0].messages.map((m) => m.id)).toEqual(['first']);
  });

  it('synthesizes a first tab from legacy single-session state', () => {
    window.localStorage.setItem(storageKeys.codingCwd, '/legacy/project');
    window.localStorage.setItem(storageKeys.messages, JSON.stringify([message('legacy')]));
    const { result } = renderHook(() => useHarness());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].cwd).toBe('/legacy/project');
    expect(result.current.tabs[0].messages.map((m) => m.id)).toEqual(['legacy']);
    expect(result.current.tabs[0].name).toBe('project');
  });
});

describe('switchToSession', () => {
  it('persists the current conversation into its tab and loads the target', () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1')]));
    // Simulate new chat activity in the active conversation.
    act(() => result.current.setMessages((cur) => [...cur, message('a2')]));

    act(() => result.current.switchToSession('t2'));
    expect(result.current.activeTabId).toBe('t2');
    expect(result.current.messages.map((m) => m.id)).toEqual(['b1', 'b2']);
    expect(result.current.codingCwd).toBe('/repo/beta');
    expect(result.current.notice).toBeNull();

    // Switching back restores the conversation INCLUDING the new message.
    act(() => result.current.switchToSession('t1'));
    expect(result.current.messages.map((m) => m.id)).toEqual(['a1', 'a2']);
  });

  it('ignores unknown ids and the already-active tab', () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1')]));
    act(() => result.current.switchToSession('ghost'));
    act(() => result.current.switchToSession('t1'));
    expect(result.current.activeTabId).toBe('t1');
    expect(result.current.messages.map((m) => m.id)).toEqual(['a1']);
  });
});

describe('handleTabCreate', () => {
  it('creates a fresh empty tab, switches to it, and wipes the surface', async () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1')]));
    await act(async () => {
      result.current.handleTabCreate();
      await Promise.resolve(); // let the queued microtask commit
    });
    expect(result.current.tabs).toHaveLength(3);
    const newest = result.current.tabs[2];
    expect(result.current.activeTabId).toBe(newest.id);
    expect(result.current.messages).toEqual([]);
    expect(result.current.codingCwd).toBe('');
    expect(result.current.drafts).toEqual({ standard: '', coding: '' });
    expect(result.current.notice).toBeNull();
    expect(result.current.lastRun).toBeNull();
  });

  it('reuses an already-empty active tab instead of stacking new empty rows', async () => {
    window.localStorage.setItem(
      tabsStorageKey,
      JSON.stringify([{ id: 't1', name: 'empty', cwd: '', createdAt: 1, messages: [] }]),
    );
    window.localStorage.setItem(tabsActiveKey, 't1');
    const { result } = renderHook(() => useHarness([]));
    await act(async () => {
      result.current.handleTabCreate();
      await Promise.resolve();
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe('t1');
  });
});

describe('deleteSession', () => {
  it('removes a background conversation and reports its id for metadata cleanup', () => {
    seedTabs();
    harnessDeleted = vi.fn();
    const { result } = renderHook(() => useHarness([message('a1')]));
    act(() => result.current.deleteSession('t2'));
    expect(result.current.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(result.current.activeTabId).toBe('t1');
    expect(harnessDeleted).toHaveBeenCalledWith('t2');
    harnessDeleted = () => {};
  });

  it('falls back to the newest remaining conversation when deleting the active one', () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1')]));
    act(() => result.current.deleteSession('t1'));
    expect(result.current.activeTabId).toBe('t2');
    expect(result.current.messages.map((m) => m.id)).toEqual(['b1', 'b2']);
    expect(result.current.codingCwd).toBe('/repo/beta');
  });

  it('resets to a single fresh empty conversation when the last one is deleted', () => {
    window.localStorage.setItem(
      tabsStorageKey,
      JSON.stringify([{ id: 't1', name: 'only', cwd: '/x', createdAt: 1, messages: [message('m')] }]),
    );
    window.localStorage.setItem(tabsActiveKey, 't1');
    const { result } = renderHook(() => useHarness([message('m')]));
    act(() => result.current.deleteSession('t1'));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).not.toBe('t1');
    expect(result.current.messages).toEqual([]);
    expect(result.current.codingCwd).toBe('');
  });
});

describe('persistence and helpers', () => {
  it('mirrors active-tab message changes into localStorage', () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1')]));
    act(() => result.current.setMessages((cur) => [...cur, message('a2')]));
    const stored = JSON.parse(window.localStorage.getItem(tabsStorageKey)!) as Array<{
      id: string;
      messages: ChatMessage[];
    }>;
    expect(stored.find((t) => t.id === 't1')!.messages.map((m) => m.id)).toEqual(['a1', 'a2']);
  });

  it('sessionFirstPrompt reads live messages for the active tab and stored ones otherwise', () => {
    seedTabs();
    const { result } = renderHook(() => useHarness([message('a1', 'first alpha prompt')]));
    expect(result.current.sessionFirstPrompt('t1')).toBe('first alpha prompt');
    expect(result.current.sessionFirstPrompt('t2')).toBe('msg b1');
    expect(result.current.sessionFirstPrompt('ghost')).toBeNull();
  });
});
