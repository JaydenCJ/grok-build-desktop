import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Insert a divider ABOVE this item. */
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface Props {
  menu: ContextMenuState | null;
  onClose: () => void;
}

/**
 * A real, app-owned right-click menu (replaces the suppressed WebView menu).
 * Positioned at the cursor, clamped to the viewport, closes on click-outside,
 * Esc, scroll, or after an item runs.
 */
export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: menu?.x ?? 0, y: menu?.y ?? 0 });

  // Clamp into the viewport once measured.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - width - pad);
    const y = Math.min(menu.y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer so the opening contextmenu/click doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener('click', close, true);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close, true);
      window.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      // Don't let clicks inside bubble to the window-level close-on-click.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {item.separator ? <div className="ctx-sep" /> : null}
          <button
            type="button"
            role="menuitem"
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              // Run after close so focus/scroll side-effects settle.
              queueMicrotask(() => item.onClick());
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
