// The stream-listener bootstrap must survive transient IPC failures: a
// single failed attach at startup would leave the app permanently deaf to
// run events (streamed replies render as dead silence). ensureStream-
// ListenersAttached wraps attachTauriListeners in retryWithBackoff.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../streamStore', () => ({
  attachTauriListeners: vi.fn(),
}));

import { ensureStreamListenersAttached } from '../grok';
import { attachTauriListeners } from '../streamStore';

const attachMock = vi.mocked(attachTauriListeners);

beforeEach(() => {
  vi.useFakeTimers();
  attachMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ensureStreamListenersAttached', () => {
  it('resolves immediately when the first attach succeeds', async () => {
    attachMock.mockResolvedValue(undefined);
    await expect(ensureStreamListenersAttached()).resolves.toBeUndefined();
    expect(attachMock).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff and recovers from transient failures', async () => {
    attachMock
      .mockRejectedValueOnce(new Error('ipc not ready'))
      .mockRejectedValueOnce(new Error('still not ready'))
      .mockResolvedValue(undefined);
    const pending = ensureStreamListenersAttached();
    // Two backoff sleeps (500ms, 1000ms) stand between failure and recovery.
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBeUndefined();
    expect(attachMock).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('rejects only after exhausting all five attempts', async () => {
    attachMock.mockRejectedValue(new Error('ipc gone'));
    const pending = ensureStreamListenersAttached();
    const guarded = pending.catch((e) => e);
    // 500 + 1000 + 2000 + 4000 covers every scheduled backoff delay.
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000 + 4000);
    await expect(guarded).resolves.toBeInstanceOf(Error);
    expect(attachMock).toHaveBeenCalledTimes(5);
  });
});
