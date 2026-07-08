import { describe, expect, it } from 'vitest';
import { storageKeys, tabsActiveKey, tabsStorageKey } from '../constants';
import {
  loadIdMap,
  loadIdSet,
  readJsonStorage,
  storedActiveTabMessages,
  storedLastRun,
  storedMessages,
  storedRunHistory,
} from '../storage';
import type { ChatMessage } from '../types';
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

describe('readJsonStorage', () => {
  it('parses stored JSON and falls back on absence or corruption', () => {
    window.localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(readJsonStorage('k', {})).toEqual({ a: 1 });
    expect(readJsonStorage('missing', 'fallback')).toBe('fallback');
    window.localStorage.setItem('bad', '{not json');
    expect(readJsonStorage('bad', 42)).toBe(42);
  });
});

describe('loadIdSet / loadIdMap', () => {
  it('loads arrays as string sets and tolerates garbage', () => {
    window.localStorage.setItem('set', JSON.stringify(['a', 'b', 2]));
    expect(loadIdSet('set')).toEqual(new Set(['a', 'b', '2']));
    window.localStorage.setItem('set', '"not an array"');
    expect(loadIdSet('set')).toEqual(new Set());
    window.localStorage.setItem('set', '{{{');
    expect(loadIdSet('set')).toEqual(new Set());
    expect(loadIdSet('missing')).toEqual(new Set());
  });

  it('loads objects as maps and tolerates garbage', () => {
    window.localStorage.setItem('map', JSON.stringify({ a: 'x' }));
    expect(loadIdMap('map')).toEqual({ a: 'x' });
    window.localStorage.setItem('map', '[[[');
    expect(loadIdMap('map')).toEqual({});
    expect(loadIdMap('missing')).toEqual({});
  });
});

describe('storedRunHistory / storedLastRun', () => {
  it('filters non-ToolRun entries and caps history at 6', () => {
    const runs = Array.from({ length: 10 }, (_, i) => toolRun({ command: `run-${i}` }));
    window.localStorage.setItem(
      storageKeys.runHistory,
      JSON.stringify([...runs, { garbage: true }, null, 'x']),
    );
    const history = storedRunHistory();
    expect(history).toHaveLength(6);
    expect(history[0].command).toBe('run-0');
  });

  it('rejects a malformed last run', () => {
    window.localStorage.setItem(storageKeys.lastRun, JSON.stringify(toolRun()));
    expect(storedLastRun()?.command).toBe('grok');
    window.localStorage.setItem(storageKeys.lastRun, JSON.stringify({ ok: 'nope' }));
    expect(storedLastRun()).toBeNull();
  });
});

describe('storedMessages', () => {
  it('filters invalid entries and keeps only the newest 120', () => {
    const valid = Array.from({ length: 130 }, (_, i) => message(`m${i}`));
    window.localStorage.setItem(
      storageKeys.messages,
      JSON.stringify([{ id: 1, role: 'user' }, ...valid]),
    );
    const messages = storedMessages();
    expect(messages).toHaveLength(120);
    expect(messages[0].id).toBe('m10');
    expect(messages.at(-1)?.id).toBe('m129');
  });
});

describe('storedActiveTabMessages', () => {
  it('returns null when no tabs are stored (legacy first run)', () => {
    expect(storedActiveTabMessages()).toBeNull();
    window.localStorage.setItem(tabsStorageKey, JSON.stringify([]));
    expect(storedActiveTabMessages()).toBeNull();
    window.localStorage.setItem(tabsStorageKey, '{corrupt');
    expect(storedActiveTabMessages()).toBeNull();
  });

  it('returns the ACTIVE tab messages, not another tab or the flat key', () => {
    const tabs = [
      { id: 't1', name: 'a', cwd: '', createdAt: 1, messages: [message('one')] },
      { id: 't2', name: 'b', cwd: '', createdAt: 2, messages: [message('two'), message('three')] },
    ];
    window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
    window.localStorage.setItem(tabsActiveKey, 't2');
    // The stale flat key must be ignored when tabs exist.
    window.localStorage.setItem(storageKeys.messages, JSON.stringify([message('stale')]));
    expect(storedActiveTabMessages()?.map((m) => m.id)).toEqual(['two', 'three']);
  });

  it('falls back to the first tab when the active id is unknown', () => {
    const tabs = [{ id: 't1', name: 'a', cwd: '', createdAt: 1, messages: [message('one')] }];
    window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
    window.localStorage.setItem(tabsActiveKey, 'ghost');
    expect(storedActiveTabMessages()?.map((m) => m.id)).toEqual(['one']);
  });

  it('filters invalid messages inside the active tab', () => {
    const tabs = [
      {
        id: 't1',
        name: 'a',
        cwd: '',
        createdAt: 1,
        messages: [message('good'), { id: 42, role: 'user' }, 'junk'],
      },
    ];
    window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
    window.localStorage.setItem(tabsActiveKey, 't1');
    expect(storedActiveTabMessages()?.map((m) => m.id)).toEqual(['good']);
  });
});
