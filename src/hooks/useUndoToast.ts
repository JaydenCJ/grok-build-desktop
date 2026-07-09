// Undo window for destructive actions (conversation delete, history clear).
// Shows a transient toast with an Undo button; if the user doesn't undo
// within the window, the optional `onExpire` finalizer runs (e.g. dropping a
// deleted conversation's pin/group metadata). Replacing a pending toast
// finalizes the previous one first, so two rapid deletes can't lose the
// first one's cleanup.
import { useCallback, useEffect, useRef, useState } from 'react';

export const UNDO_TOAST_TIMEOUT_MS = 8000;

export interface UndoToastState {
  /** Toast body copy (already localized). */
  text: string;
  /** Reverses the destructive action. */
  undo: () => void;
  /** Finalizer run when the window lapses without an undo. */
  onExpire?: () => void;
}

export function useUndoToast() {
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  // The pending toast also lives in a ref so show/undo/expire stay stable
  // callbacks and the timeout effect can't race a stale closure.
  const pendingRef = useRef<UndoToastState | null>(null);

  const showUndoToast = useCallback((toast: UndoToastState) => {
    // A new destructive action supersedes the previous window — finalize it.
    pendingRef.current?.onExpire?.();
    pendingRef.current = toast;
    setUndoToast(toast);
  }, []);

  const undoNow = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setUndoToast(null);
    pending?.undo();
  }, []);

  const expireNow = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setUndoToast(null);
    pending?.onExpire?.();
  }, []);

  useEffect(() => {
    if (!undoToast) return;
    const timer = window.setTimeout(expireNow, UNDO_TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [undoToast, expireNow]);

  return { undoToast, showUndoToast, undoNow, expireNow };
}
