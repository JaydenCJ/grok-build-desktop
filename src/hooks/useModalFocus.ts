import { useEffect } from 'react';

/**
 * Focus management for aria-modal dialogs (SettingsPage, ToolsPage).
 * aria-modal promises the background is inert, so focus must actually move
 * into the dialog on open — and return to the invoker on close.
 */
export function useModalFocus(open: boolean, initialRef: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    initialRef.current?.focus();
    return () => previous?.focus();
    // initialRef is a stable useRef box — only `open` transitions matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
