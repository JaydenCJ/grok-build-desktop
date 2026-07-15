// Complements streamStore.test.ts with the parts a plain event-fold test
// misses: the html cache + versioning, active-run lookup, trace (raw event)
// classification, the pending-submit counter, and the Tauri listener
// lifecycle — attach, de-dupe, partial-failure rollback, retry, detach, and
// the permanent no-runtime latch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import {
  applyRunEvent,
  applyStateChange,
  attachTauriListeners,
  detachTauriListeners,
  getPendingSubmitCount,
  notePendingSubmitEnd,
  notePendingSubmitStart,
  replaceQueue,
  streamStore,
  subscribePendingSubmit,
} from '../streamStore';
import { installTauriAppMock } from '../../test/tauriAppMock';

beforeEach(() => {
  streamStore.__reset();
});

// Runs before setup.ts's clearMocks(), so stale unlisten fns still reach the
// mock they were registered against instead of leaking into the next test.
afterEach(() => {
  detachTauriListeners();
});

describe('html cache and active run', () => {
  it('setHtml caches html and bumps the version of an existing run', () => {
    applyStateChange('r1', { state: 'Running', startedAt: 5 });
    expect(streamStore.getRunSnapshot('r1')?.htmlVersion).toBe(0);

    streamStore.setHtml('r1', '<p>one</p>');
    expect(streamStore.getHtml('r1')).toBe('<p>one</p>');
    expect(streamStore.getRunSnapshot('r1')?.htmlVersion).toBe(1);

    streamStore.setHtml('r1', '<p>two</p>');
    expect(streamStore.getHtml('r1')).toBe('<p>two</p>');
    expect(streamStore.getRunSnapshot('r1')?.htmlVersion).toBe(2);
  });

  it('setHtml for an unknown run stores html without inventing a snapshot', () => {
    streamStore.setHtml('ghost', '<p>g</p>');
    expect(streamStore.getHtml('ghost')).toBe('<p>g</p>');
    expect(streamStore.getRunSnapshot('ghost')).toBeUndefined();
  });

  it('setHtml notifies subscribers', () => {
    let calls = 0;
    const unsub = streamStore.subscribe(() => calls++);
    streamStore.setHtml('r1', '<p>x</p>');
    expect(calls).toBe(1);
    unsub();
  });

  it('getActiveRunSnapshot follows the queue active id', () => {
    expect(streamStore.getActiveRunSnapshot()).toBeUndefined();

    applyStateChange('r1', { state: 'Running' });
    replaceQueue({ active: 'r1', items: [] });
    expect(streamStore.getActiveRunSnapshot()?.id).toBe('r1');

    replaceQueue({ active: null, items: [] });
    expect(streamStore.getActiveRunSnapshot()).toBeUndefined();
  });
});

describe('trace events from raw payloads', () => {
  const start = { type: 'tool_use', id: 'tu-1', name: 'bash', input: { cmd: 'ls' } };

  it('creates a running tool trace card from an unknown typed event', () => {
    applyRunEvent('r1', { type: 'tool_use' }, start);
    const traces = streamStore.getRunSnapshot('r1')?.traces ?? [];
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      key: 'trace:tu-1',
      kind: 'tool',
      label: 'bash',
      status: 'running',
      endedAt: null,
    });
    expect(traces[0]!.detail).toContain('"cmd":"ls"');
  });

  it('ignores duplicate creates for the same trace key', () => {
    applyRunEvent('r1', { type: 'tool_use' }, start);
    applyRunEvent('r1', { type: 'tool_use' }, start);
    expect(streamStore.getRunSnapshot('r1')?.traces).toHaveLength(1);
  });

  it('finishes a running trace with the tool result as detail', () => {
    applyRunEvent('r1', { type: 'tool_use' }, start);
    applyRunEvent(
      'r1',
      { type: 'tool_result' },
      { type: 'tool_result', tool_use_id: 'tu-1', output: '3 files' },
    );
    const trace = streamStore.getRunSnapshot('r1')!.traces[0]!;
    expect(trace.status).toBe('done');
    expect(trace.detail).toBe('3 files');
    expect(trace.endedAt).toEqual(expect.any(Number));
  });

  it('marks error results as failed traces', () => {
    applyRunEvent('r1', { type: 'tool_use' }, start);
    applyRunEvent(
      'r1',
      { type: 'tool_error' },
      { type: 'tool_error', tool_use_id: 'tu-1', error: 'exit 1' },
    );
    const trace = streamStore.getRunSnapshot('r1')!.traces[0]!;
    expect(trace.status).toBe('error');
    expect(trace.detail).toBe('exit 1');
  });

  it('drops finish events whose key never started', () => {
    applyRunEvent('r1', { type: 'tool_use' }, start);
    applyRunEvent(
      'r1',
      { type: 'tool_result' },
      { type: 'tool_result', tool_use_id: 'ghost', output: 'nope' },
    );
    const trace = streamStore.getRunSnapshot('r1')!.traces[0]!;
    expect(trace.status).toBe('running');
    expect(trace.endedAt).toBeNull();
  });

  it('ignores unclassifiable raw payloads and unknown events without raw', () => {
    applyRunEvent('rX', { type: 'mystery' }, { type: 'mystery' });
    expect(streamStore.getRunSnapshot('rX')).toBeUndefined();

    applyRunEvent('rX', { type: 'mystery' });
    expect(streamStore.getRunSnapshot('rX')).toBeUndefined();
  });
});

describe('pending submit counter', () => {
  it('tracks starts/ends and notifies subscribers with the new count', () => {
    const seen: number[] = [];
    const unsub = subscribePendingSubmit(() => seen.push(getPendingSubmitCount()));

    notePendingSubmitStart();
    notePendingSubmitStart();
    notePendingSubmitEnd();
    notePendingSubmitEnd();
    expect(seen).toEqual([1, 2, 1, 0]);

    unsub();
    notePendingSubmitStart();
    expect(seen).toEqual([1, 2, 1, 0]); // unsubscribed — no more callbacks
    notePendingSubmitEnd(); // rebalance the module-level counter
    expect(getPendingSubmitCount()).toBe(0);
  });

  it('never drops the count below zero', () => {
    expect(getPendingSubmitCount()).toBe(0);
    notePendingSubmitEnd();
    expect(getPendingSubmitCount()).toBe(0);
  });
});

describe('attachTauriListeners', () => {
  it('wires run, state, and queue events into the store', async () => {
    const tauri = installTauriAppMock();
    await attachTauriListeners();

    await tauri.emitRunEvent('r1', { type: 'text', data: 'hello' });
    expect(streamStore.getRunSnapshot('r1')?.text).toBe('hello');

    await tauri.emitRunState('r1', 'Failed', { endedAt: 9, error: 'crashed' });
    expect(streamStore.getRunSnapshot('r1')).toMatchObject({
      state: 'failed',
      error: 'crashed',
      endedAt: 9,
    });

    await tauri.emitQueue('r1', [{ id: 'r1', prompt: 'p', state: 'Running', enqueuedAt: 1 }]);
    expect(streamStore.getQueueSnapshot()).toEqual({
      active: 'r1',
      items: [{ id: 'r1', prompt: 'p', state: 'Running', enqueuedAt: 1 }],
    });
  });

  it('does not stack duplicate handlers on repeated sequential attach', async () => {
    const tauri = installTauriAppMock();
    await attachTauriListeners();
    await attachTauriListeners();

    await tauri.emitRunEvent('r1', { type: 'text', data: 'once' });
    // Doubled handlers would fold the chunk twice ("onceonce").
    expect(streamStore.getRunSnapshot('r1')?.text).toBe('once');
  });

  it('de-dupes parallel attach calls (StrictMode double-mount)', async () => {
    const tauri = installTauriAppMock();
    const first = attachTauriListeners();
    const second = attachTauriListeners();
    await Promise.all([first, second]);

    await tauri.emitRunEvent('r1', { type: 'text', data: 'once' });
    expect(streamStore.getRunSnapshot('r1')?.text).toBe('once');
  });

  it('detachTauriListeners stops event delivery', async () => {
    const tauri = installTauriAppMock();
    await attachTauriListeners();
    await tauri.emitRunEvent('r1', { type: 'text', data: 'a' });

    detachTauriListeners();
    await tauri.emitRunEvent('r1', { type: 'text', data: 'b' });
    expect(streamStore.getRunSnapshot('r1')?.text).toBe('a');
  });

  it('rolls back partially-attached listeners when a later listen fails', async () => {
    let listens = 0;
    const unlistened: string[] = [];
    mockIPC((cmd, payload) => {
      if (cmd === 'plugin:event|listen') {
        listens += 1;
        if (listens >= 2) throw new Error('listen 2 refused');
        return listens;
      }
      if (cmd === 'plugin:event|unlisten') {
        unlistened.push(String((payload as { event: string }).event));
      }
      return null;
    });

    await expect(attachTauriListeners()).rejects.toThrow('listen 2 refused');
    // The one listener that DID attach was detached again.
    expect(unlistened).toEqual(['grok-desktop://run-event']);
  });

  it('a transient failure does not latch — the next attach works', async () => {
    mockIPC((cmd) => {
      if (cmd.startsWith('plugin:event|')) throw new Error('ipc down');
      return null;
    });
    await expect(attachTauriListeners()).rejects.toThrow('ipc down');

    const tauri = installTauriAppMock();
    await attachTauriListeners();
    await tauri.emitRunEvent('r2', { type: 'text', data: 'recovered' });
    expect(streamStore.getRunSnapshot('r2')?.text).toBe('recovered');
  });

  it('latches permanently when there is no Tauri runtime at all', async () => {
    // clearMocks() leaves an emptied __TAURI_INTERNALS__ object behind, which
    // hasTauriRuntime() would read as "Tauri present" — remove it entirely.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.resetModules();
    const fresh = await import('../streamStore');

    await expect(fresh.attachTauriListeners()).resolves.toBeUndefined();

    // Even after a runtime appears, the latched module never listens again.
    const tauri = installTauriAppMock();
    await expect(fresh.attachTauriListeners()).resolves.toBeUndefined();
    await tauri.emitRunEvent('rL', { type: 'text', data: 'x' });
    expect(fresh.streamStore.getRunSnapshot('rL')).toBeUndefined();
  });
});
