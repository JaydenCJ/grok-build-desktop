// Regression tests for the useSmoothText rAF loop. The original
// implementation rescheduled a frame unconditionally inside tick, so every
// mounted message (including long-finished ones kept alive by Virtuoso
// overscan) burned a requestAnimationFrame callback at ~60fps forever. The
// hook must schedule zero frames while caught up and stop the loop once the
// typewriter drains.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSmoothText } from '../useSmoothText';
import { streamStore, applyRunEvent } from '../../lib/streamStore';

let frameQueue: Map<number, FrameRequestCallback>;
let nextFrameId: number;

/** Run queued rAF callbacks (each may queue the next) until idle. */
function flushFrames(max = 2000): number {
  let frames = 0;
  while (frameQueue.size > 0 && frames < max) {
    const [id, cb] = frameQueue.entries().next().value as [number, FrameRequestCallback];
    frameQueue.delete(id);
    act(() => cb(frames));
    frames++;
  }
  return frames;
}

beforeEach(() => {
  streamStore.__reset();
  frameQueue = new Map();
  nextFrameId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameQueue.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSmoothText', () => {
  it('schedules no frames for a message that mounts with its text complete', () => {
    applyRunEvent('r1', { type: 'text', data: 'already finished message' });
    applyRunEvent('r1', { type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'q' });

    const { result } = renderHook(() => useSmoothText('r1'));

    // Mount reveals existing text instantly — and, critically, goes idle.
    expect(result.current.text).toBe('already finished message');
    expect(result.current.caretVisible).toBe(false);
    expect(frameQueue.size).toBe(0);
  });

  it('drains streamed text over frames, then stops scheduling entirely', () => {
    const { result } = renderHook(() => useSmoothText('r1'));
    expect(frameQueue.size).toBe(0); // empty run: idle from the start

    act(() => {
      applyRunEvent('r1', { type: 'text', data: 'hello world' });
    });
    // New text restarts the loop…
    expect(frameQueue.size).toBeGreaterThan(0);

    const frames = flushFrames();
    // …which reveals everything and then goes idle (no perpetual rAF churn).
    expect(frames).toBeGreaterThan(0);
    expect(result.current.text).toBe('hello world');
    expect(result.current.caretVisible).toBe(false);
    expect(frameQueue.size).toBe(0);

    // A run ending while already caught up must not wake the loop either.
    act(() => {
      applyRunEvent('r1', { type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'q' });
    });
    expect(frameQueue.size).toBe(0);
  });
});
