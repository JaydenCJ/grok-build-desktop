import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff } from '../retry';

const instantSleep = () => Promise.resolve();

describe('retryWithBackoff', () => {
  it('resolves on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(retryWithBackoff(fn, { attempts: 5, sleep: instantSleep, onRetry })).resolves.toBe(
      'ok',
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries failed attempts and resolves once fn succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValue('recovered');
    const onRetry = vi.fn();
    await expect(
      retryWithBackoff(fn, { attempts: 5, baseDelayMs: 10, sleep: instantSleep, onRetry }),
    ).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('doubles the delay per retry and caps it at maxDelayMs', async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await expect(
      retryWithBackoff(fn, {
        attempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 300,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('always');
    // 100, 200, then capped at 300 (never 400/800).
    expect(delays).toEqual([100, 200, 300, 300]);
  });

  it('rejects with the last error after exhausting attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('last'));
    await expect(retryWithBackoff(fn, { attempts: 3, sleep: instantSleep })).rejects.toThrow(
      'last',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('makes exactly one call when attempts is 1', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('no retry'));
    const onRetry = vi.fn();
    await expect(
      retryWithBackoff(fn, { attempts: 1, sleep: instantSleep, onRetry }),
    ).rejects.toThrow('no retry');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
