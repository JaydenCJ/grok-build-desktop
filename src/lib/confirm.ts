/**
 * In-app confirmation dialog store. window.confirm() is a no-op on macOS —
 * wry's WKWebView never implemented the confirm delegate, so it always
 * returns false and every "are you sure?" guard silently blocks its action.
 * Callers await requestConfirm(); the <ConfirmDialog /> host mounted at the
 * App root renders the pending request and resolves it. Same module-level
 * store + listener pattern as pendingSubmit in streamStore.ts.
 */

export interface ConfirmRequest {
  /** Short heading, e.g. "Delete conversation?" */
  title: string;
  /** One-or-two sentence body explaining what is about to happen. */
  message: string;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red). */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

let pending: PendingConfirm | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((cb) => cb());
}

/**
 * Show the confirmation dialog and resolve true (confirm) / false (cancel).
 * A second request while one is open cancels the first — matches how a
 * second window.confirm would have replaced the first anyway, and keeps the
 * store single-slot.
 */
export function requestConfirm(req: ConfirmRequest): Promise<boolean> {
  pending?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { ...req, resolve };
    notify();
  });
}

export function getPendingConfirm(): ConfirmRequest | null {
  return pending;
}

/** True while a confirmation dialog is on screen (modal-guard checks). */
export function isConfirmOpen(): boolean {
  return pending !== null;
}

export function resolveConfirm(ok: boolean): void {
  const current = pending;
  if (!current) return;
  pending = null;
  notify();
  current.resolve(ok);
}

export function subscribeConfirm(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
