import { useEffect, useRef } from 'react';

/** Everything the trap considers tabbable inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  /** Element to focus when the dialog opens (falls back to the container). */
  initialFocus?: { current: HTMLElement | null };
  /** Close callback — bound to Escape while the dialog is open. */
  onEscape?: () => void;
}

/**
 * Focus management for aria-modal dialogs (SettingsPage, ToolsPage,
 * CommandPalette). aria-modal promises the background is inert, so this hook
 * has to make it true:
 *
 *  - on open, focus moves into the dialog (initialFocus, else the container);
 *  - Tab / Shift+Tab cycle within the dialog, wrapping at either end;
 *  - Escape invokes onEscape (skipped mid-IME-composition so committing a
 *    CJK candidate never closes the dialog);
 *  - on close, focus returns to whatever was focused before opening.
 */
export function useModalFocus(
  open: boolean,
  containerRef: { current: HTMLElement | null },
  options: Options = {},
) {
  // Keep the latest options in a ref so inline callbacks/refs don't retrigger
  // the effect (which would steal focus back to initialFocus on every render).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = optionsRef.current.initialFocus?.current ?? containerRef.current;
    target?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore keys that are part of an IME composition (Enter/Escape commit
      // or cancel the candidate — they must not reach the dialog).
      if (e.isComposing || e.keyCode === 229) return;

      if (e.key === 'Escape') {
        const onEscape = optionsRef.current.onEscape;
        if (onEscape) {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
        return;
      }

      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;

      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true',
      );
      if (focusables.length === 0) {
        // Nothing tabbable — keep focus parked on the container.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && container.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase: the trap must win over app-level shortcut listeners and
    // work no matter which element inside the dialog holds focus.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
    // containerRef is a stable useRef box — only `open` transitions matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
