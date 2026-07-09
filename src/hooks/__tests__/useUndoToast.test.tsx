// The undo-window machinery behind destructive actions: toast lifecycle,
// undo-vs-expire exclusivity, and finalization of a superseded toast.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { UNDO_TOAST_TIMEOUT_MS, useUndoToast } from '../useUndoToast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeToast(text = 'Deleted.') {
  return { text, undo: vi.fn(), onExpire: vi.fn() };
}

describe('useUndoToast', () => {
  it('shows the toast until the window lapses, then runs onExpire', () => {
    const { result } = renderHook(() => useUndoToast());
    const toast = makeToast();
    act(() => result.current.showUndoToast(toast));
    expect(result.current.undoToast?.text).toBe('Deleted.');

    act(() => vi.advanceTimersByTime(UNDO_TOAST_TIMEOUT_MS + 1));
    expect(result.current.undoToast).toBeNull();
    expect(toast.onExpire).toHaveBeenCalledTimes(1);
    expect(toast.undo).not.toHaveBeenCalled();
  });

  it('undoNow runs undo, clears the toast, and suppresses onExpire', () => {
    const { result } = renderHook(() => useUndoToast());
    const toast = makeToast();
    act(() => result.current.showUndoToast(toast));
    act(() => result.current.undoNow());
    expect(result.current.undoToast).toBeNull();
    expect(toast.undo).toHaveBeenCalledTimes(1);

    // The timer must not finalize an action that was undone.
    act(() => vi.advanceTimersByTime(UNDO_TOAST_TIMEOUT_MS + 1));
    expect(toast.onExpire).not.toHaveBeenCalled();
  });

  it('a new toast finalizes the previous pending one first', () => {
    const { result } = renderHook(() => useUndoToast());
    const first = makeToast('first');
    const second = makeToast('second');
    act(() => result.current.showUndoToast(first));
    act(() => result.current.showUndoToast(second));
    expect(first.onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.undoToast?.text).toBe('second');

    // Undoing now applies to the second action only.
    act(() => result.current.undoNow());
    expect(second.undo).toHaveBeenCalledTimes(1);
    expect(first.undo).not.toHaveBeenCalled();
  });

  it('undoNow after expiry is a no-op', () => {
    const { result } = renderHook(() => useUndoToast());
    const toast = makeToast();
    act(() => result.current.showUndoToast(toast));
    act(() => vi.advanceTimersByTime(UNDO_TOAST_TIMEOUT_MS + 1));
    act(() => result.current.undoNow());
    expect(toast.undo).not.toHaveBeenCalled();
    expect(toast.onExpire).toHaveBeenCalledTimes(1);
  });
});
