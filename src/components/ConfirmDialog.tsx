import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getPendingConfirm, resolveConfirm, subscribeConfirm } from '../lib/confirm';

/**
 * Host for the requestConfirm() store — mount once at the App root. Renders
 * the pending confirmation as a settings-overlay style modal (the pattern
 * Settings / Tools / Prompt Library already use) instead of window.confirm,
 * which WKWebView silently answers with false.
 */
export function ConfirmDialog() {
  const pending = useSyncExternalStore(subscribeConfirm, getPendingConfirm, getPendingConfirm);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const acceptRef = useRef<HTMLButtonElement | null>(null);

  // Focus lands on Cancel — destructive actions shouldn't be one stray
  // Enter away. Esc cancels; Tab / Shift+Tab are trapped to cycle between
  // Cancel and Confirm so the keyboard can't walk out of the modal into the
  // background UI. The listener is capture-phase so the App's global
  // keyboard router (Esc closes panels, "/" focuses composer) never sees
  // keys meant for the dialog.
  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resolveConfirm(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        // Only two focusables — Tab and Shift+Tab both mean "the other one".
        // If focus somehow ended up outside the dialog, pull it back to
        // Cancel (the safe default).
        const next =
          document.activeElement === cancelRef.current ? acceptRef.current : cancelRef.current;
        next?.focus();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      className="settings-overlay confirm-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label={pending.title}
      onClick={() => resolveConfirm(false)}
    >
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{pending.title}</h3>
        <p>{pending.message}</p>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-cancel"
            onClick={() => resolveConfirm(false)}
          >
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={acceptRef}
            type="button"
            className={`confirm-accept${pending.danger ? ' is-danger' : ''}`}
            onClick={() => resolveConfirm(true)}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
