import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHistoryOrganization } from '../useHistoryOrganization';
import { storageKeys } from '../../app/constants';
import type { Tab } from '../../lib/tabs';
import type { ChatMessage } from '../../app/types';

function message(id: string, content: string, ts: number, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, role, content, ts };
}

const tabs: Tab[] = [
  {
    id: 't1',
    name: 'alpha',
    cwd: '/a',
    createdAt: 1,
    messages: [message('m1', 'fix the flaky login test\nplease', 100)],
  },
  {
    id: 't2',
    name: 'beta',
    cwd: '/b',
    createdAt: 2,
    messages: [
      message('m2', 'write release notes', 300),
      message('m3', 'sure — drafting them', 350, 'assistant'),
      message('m4', 'shorter please', 400),
    ],
  },
  { id: 't3', name: 'empty', cwd: '', createdAt: 3, messages: [] },
];

function render(activeMessages: ChatMessage[] = tabs[0].messages as ChatMessage[]) {
  const closeContextMenu = vi.fn();
  const hook = renderHook(() =>
    useHistoryOrganization({
      tabs,
      activeTabId: 't1',
      messages: activeMessages,
      sessionFirstPrompt: (id) =>
        (tabs.find((t) => t.id === id)?.messages.find((m) => m.role === 'user')?.content as string) ?? null,
      closeContextMenu,
    }),
  );
  return { ...hook, closeContextMenu };
}

describe('recentPrompts derivation', () => {
  it('lists one row per conversation, newest activity first, titled by the first user line', () => {
    const { result } = render();
    const rows = result.current.recentPrompts;
    // t2 has the newest activity (ts 400); the empty t3 falls back to its
    // createdAt (3) and sorts last.
    expect(rows.map((r) => r.id)).toEqual(['t2', 't1', 't3']);
    expect(rows.find((r) => r.id === 't1')!.title).toBe('fix the flaky login test');
    expect(rows.find((r) => r.id === 't2')!.detail).toBe('2 messages');
    expect(rows.find((r) => r.id === 't3')!.title).toBe('New conversation');
    expect(rows.find((r) => r.id === 't3')!.detail).toBe('empty');
    expect(rows.find((r) => r.id === 't1')!.active).toBe(true);
  });

  it('filters rows by title, detail, and group', () => {
    const { result } = render();
    act(() => result.current.setHistoryFilter('release'));
    expect(result.current.recentPrompts.map((r) => r.id)).toEqual(['t2']);
    act(() => result.current.setHistoryFilter('no-match-xyz'));
    expect(result.current.recentPrompts).toEqual([]);
  });
});

describe('pin / archive / group organization', () => {
  it('partitions rows into pinned, groups, ungrouped, and archived sections', () => {
    const { result } = render();
    act(() => result.current.togglePinPrompt('t2'));
    act(() => result.current.setPromptGroupId('t1', 'Work'));
    act(() => result.current.toggleArchivePrompt('t3'));

    const view = result.current.historyView;
    expect(view.pinned.map((r) => r.id)).toEqual(['t2']);
    expect(view.groups).toEqual([['Work', expect.any(Array)]]);
    expect(view.groups[0][1].map((r) => r.id)).toEqual(['t1']);
    expect(view.ungrouped).toEqual([]);
    expect(view.archived.map((r) => r.id)).toEqual(['t3']);

    // Persisted so restarts keep the layout.
    expect(JSON.parse(window.localStorage.getItem(storageKeys.historyPinned)!)).toEqual(['t2']);
    expect(JSON.parse(window.localStorage.getItem(storageKeys.historyGroups)!)).toEqual({ t1: 'Work' });
    expect(JSON.parse(window.localStorage.getItem(storageKeys.historyArchived)!)).toEqual(['t3']);
  });

  it('archiving a pinned conversation unpins it', () => {
    const { result } = render();
    act(() => result.current.togglePinPrompt('t2'));
    act(() => result.current.toggleArchivePrompt('t2'));
    expect(result.current.pinnedPromptIds.has('t2')).toBe(false);
    expect(result.current.archivedPromptIds.has('t2')).toBe(true);
  });

  it('toggles are reversible', () => {
    const { result } = render();
    act(() => result.current.togglePinPrompt('t1'));
    act(() => result.current.togglePinPrompt('t1'));
    expect(result.current.pinnedPromptIds.size).toBe(0);
  });
});

describe('rename and new-group row edits', () => {
  it('startRename → commitRowEdit sets a custom label used as the row title', () => {
    const { result, closeContextMenu } = render();
    act(() => result.current.startRename('t1'));
    expect(closeContextMenu).toHaveBeenCalled();
    expect(result.current.rowEdit).toEqual({ id: 't1', mode: 'rename' });
    act(() => result.current.commitRowEdit('Login flake hunt'));
    expect(result.current.rowEdit).toBeNull();
    expect(result.current.recentPrompts.find((r) => r.id === 't1')!.title).toBe('Login flake hunt');
  });

  it('an empty rename clears the custom label back to the derived title', () => {
    const { result } = render();
    act(() => result.current.startRename('t1'));
    act(() => result.current.commitRowEdit('Custom'));
    act(() => result.current.startRename('t1'));
    act(() => result.current.commitRowEdit('   '));
    expect(result.current.recentPrompts.find((r) => r.id === 't1')!.title).toBe(
      'fix the flaky login test',
    );
  });

  it('startNewGroup → commitRowEdit files the conversation under the new group', () => {
    const { result } = render();
    act(() => result.current.startNewGroup('t2'));
    act(() => result.current.commitRowEdit('Docs'));
    expect(result.current.promptGroups.t2).toBe('Docs');
  });
});

describe('metadata cleanup and library save', () => {
  it('removeConversationMeta forgets every trace of a deleted conversation', () => {
    const { result } = render();
    act(() => {
      result.current.togglePinPrompt('t1');
      result.current.setPromptGroupId('t1', 'Work');
      result.current.toggleArchivePrompt('t1');
    });
    act(() => result.current.removeConversationMeta('t1'));
    expect(result.current.pinnedPromptIds.has('t1')).toBe(false);
    expect(result.current.archivedPromptIds.has('t1')).toBe(false);
    expect(result.current.promptGroups.t1).toBeUndefined();
  });

  it('savePromptToLibrary reports failure when the prompt store is unavailable', async () => {
    // No Tauri runtime in jsdom → upsertPrompt rejects → user-visible note.
    const { result } = render();
    await act(async () => {
      await result.current.savePromptToLibrary('t1');
    });
    expect(result.current.historyNote).toBe("Couldn't save — Prompt Library unavailable");
  });
});
