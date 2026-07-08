import { describe, it, expect, beforeEach } from 'vitest';
import { streamStore, applyRunEvent, applyStateChange, replaceQueue } from '../streamStore';

beforeEach(() => streamStore.__reset());

describe('streamStore', () => {
  it('appends text on text event and tracks chars', () => {
    applyRunEvent('r1', { type: 'text', data: 'hello' });
    applyRunEvent('r1', { type: 'text', data: ' world' });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.text).toBe('hello world');
    expect(snap?.textChars).toBe(11);
    expect(snap?.lastEventType).toBe('text');
  });

  it('counts thought chars separately', () => {
    applyRunEvent('r1', { type: 'thought', data: 'thinking' });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.thoughtChars).toBe(8);
    expect(snap?.text).toBe('');
    expect(snap?.lastEventType).toBe('thought');
  });

  it('end event marks done and records stopReason', () => {
    applyRunEvent('r1', { type: 'text', data: 'hi' });
    applyRunEvent('r1', { type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'r' });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.state).toBe('done');
    expect(snap?.stopReason).toBe('EndTurn');
  });

  it('applyStateChange overwrites state and timestamps', () => {
    applyStateChange('r1', { state: 'Running', startedAt: 100 });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.state).toBe('running');
    expect(snap?.startedAt).toBe(100);
  });

  it('replaceQueue overwrites queue snapshot', () => {
    replaceQueue({ active: 'r1', items: [{ id: 'r2', prompt: 'p', state: 'Queued', enqueuedAt: 1 } as any] });
    expect(streamStore.getQueueSnapshot().active).toBe('r1');
    expect(streamStore.getQueueSnapshot().items.length).toBe(1);
  });

  it('subscriber notified on event', () => {
    let calls = 0;
    const unsub = streamStore.subscribe(() => calls++);
    applyRunEvent('r1', { type: 'text', data: 'a' });
    expect(calls).toBeGreaterThan(0);
    unsub();
  });
});

describe('streamStore evictSettled', () => {
  const CAP = 200;

  it('keeps settled runs up to the cap', () => {
    for (let i = 0; i < CAP; i++) {
      streamStore.patchRun(`r${i}`, { state: 'done' });
    }
    expect(streamStore.getRunSnapshot('r0')).toBeDefined();
    expect(streamStore.getRunSnapshot(`r${CAP - 1}`)).toBeDefined();
  });

  it('evicts the OLDEST settled runs once the cap is exceeded', () => {
    for (let i = 0; i <= CAP + 1; i++) {
      streamStore.patchRun(`r${i}`, { state: 'done' });
    }
    // Two over the cap → the two oldest are gone, newest survive.
    expect(streamStore.getRunSnapshot('r0')).toBeUndefined();
    expect(streamStore.getRunSnapshot('r1')).toBeUndefined();
    expect(streamStore.getRunSnapshot('r2')).toBeDefined();
    expect(streamStore.getRunSnapshot(`r${CAP + 1}`)).toBeDefined();
  });

  it('never evicts running or queued runs, even when they are oldest', () => {
    streamStore.patchRun('live-running', { state: 'running' });
    streamStore.patchRun('live-queued', { state: 'queued' });
    for (let i = 0; i < CAP + 3; i++) {
      streamStore.patchRun(`r${i}`, { state: 'done' });
    }
    expect(streamStore.getRunSnapshot('live-running')?.state).toBe('running');
    expect(streamStore.getRunSnapshot('live-queued')?.state).toBe('queued');
    // The oldest SETTLED runs were evicted in their place.
    expect(streamStore.getRunSnapshot('r0')).toBeUndefined();
    expect(streamStore.getRunSnapshot(`r${CAP + 2}`)).toBeDefined();
  });

  it('drops the rendered html together with an evicted snapshot', () => {
    streamStore.patchRun('r0', { state: 'done' });
    streamStore.setHtml('r0', '<p>rendered</p>');
    expect(streamStore.getHtml('r0')).toBe('<p>rendered</p>');
    for (let i = 1; i <= CAP + 1; i++) {
      streamStore.patchRun(`r${i}`, { state: 'done' });
    }
    expect(streamStore.getRunSnapshot('r0')).toBeUndefined();
    expect(streamStore.getHtml('r0')).toBeUndefined();
  });
});
