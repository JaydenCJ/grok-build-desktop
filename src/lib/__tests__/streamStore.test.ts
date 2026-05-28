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
