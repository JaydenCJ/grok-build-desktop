import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Insert a divider ABOVE this item. */
  separator?: boolean;
  /** Render as a non-interactive section label (e.g. the target's name). */
  header?: boolean;
  /** Right-aligned accelerator hint (e.g. "P", "R", "⌫"). Single letters also
   *  work as live keyboard accelerators while the menu is open. */
  shortcut?: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Nested flyout menu. */
  submenu?: ContextMenuItem[];
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
 * Claude-Desktop-class: section headers, leading icons, right-aligned shortcut
 * hints (which double as live keyboard accelerators), and hover flyout
 * submenus. Positioned at the cursor, clamped to the viewport, closes on
 * click-outside, Esc, scroll, or after an item runs.
 */
export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);

  // Position at the cursor, clamped into the viewport once measured. Written
  // through the CSSOM (element.style) instead of a React style prop: the
  // shipped CSP is `style-src 'self'` with no 'unsafe-inline', and while CSP
  // only blocks style ATTRIBUTES parsed from markup (CSSOM writes are exempt
  // by spec), keeping the tree free of style props keeps that invariant
  // grep-able. Runs in a layout effect, so it lands before first paint.
  useLayoutEffect(() => {
    if (!menu) return;
    setOpenSub(null);
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - width - pad);
    const y = Math.min(menu.y, window.innerHeight - height - pad);
    el.style.left = `${Math.max(pad, x)}px`;
    el.style.top = `${Math.max(pad, y)}px`;
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    // Close on a click/right-click OUTSIDE the menu. This is a CAPTURE-phase
    // listener so it fires BEFORE React's delegated onClick — if it also fired
    // for clicks INSIDE the menu, the menu would unmount before the item's
    // onClick ran and the action would silently never fire. That race passed
    // in the dev preview but broke EVERY menu item in the production WebView.
    // stopPropagation on the menu can't help (it's bubble-phase). So: skip
    // in-menu clicks and let the item's own onClick close + run the action.
    const closeIfOutside = (ev: Event) => {
      const target = ev.target as Node | null;
      if (target && ref.current && ref.current.contains(target)) return;
      onClose();
    };
    const run = (item: ContextMenuItem) => {
      if (item.disabled || !item.onClick) return;
      onClose();
      queueMicrotask(() => item.onClick?.());
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Live accelerators: a letter shortcut, or Delete/Backspace → "⌫"/"D".
      const key =
        e.key.length === 1
          ? e.key.toLowerCase()
          : e.key === 'Delete' || e.key === 'Backspace'
            ? 'del'
            : '';
      if (!key) return;
      const hit = menu.items.find((it) => {
        if (it.header || it.disabled || !it.shortcut) return false;
        const s = it.shortcut.toLowerCase();
        if (key === 'del') return s === '⌫' || s === 'del' || s === 'd';
        return s === key;
      });
      if (hit && (hit.onClick || hit.submenu)) {
        e.preventDefault();
        e.stopPropagation();
        if (hit.submenu) {
          setOpenSub(menu.items.indexOf(hit));
        } else {
          run(hit);
        }
      }
    };
    // Defer so the opening contextmenu/click doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener('click', closeIfOutside, true);
      window.addEventListener('contextmenu', closeIfOutside, true);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close, true);
      window.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', closeIfOutside, true);
      window.removeEventListener('contextmenu', closeIfOutside, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const run = (item: ContextMenuItem) => {
    if (item.disabled || !item.onClick) return;
    onClose();
    queueMicrotask(() => item.onClick?.());
  };

  const renderLeaf = (item: ContextMenuItem, key: string) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      className={`ctx-item${item.danger ? ' danger' : ''}`}
      disabled={item.disabled}
      onClick={() => run(item)}
    >
      {item.icon ? <span className="ctx-icon">{item.icon}</span> : null}
      <span className="ctx-label">{item.label}</span>
      {item.shortcut ? <span className="ctx-shortcut">{item.shortcut}</span> : null}
    </button>
  );

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => setOpenSub(null)}
    >
      {menu.items.map((item, i) => (
        <div
          key={`${item.label}-${i}`}
          className="ctx-row"
          onMouseEnter={() => setOpenSub(item.submenu && !item.disabled ? i : null)}
        >
          {item.separator ? <div className="ctx-sep" /> : null}
          {item.header ? (
            <div className="ctx-header">{item.label}</div>
          ) : item.submenu ? (
            <>
              <div
                role="menuitem"
                tabIndex={0}
                aria-haspopup="menu"
                aria-expanded={openSub === i}
                className={`ctx-item has-sub${openSub === i ? ' open' : ''}${item.disabled ? ' is-disabled' : ''}`}
              >
                {item.icon ? <span className="ctx-icon">{item.icon}</span> : null}
                <span className="ctx-label">{item.label}</span>
                {item.shortcut ? <span className="ctx-shortcut">{item.shortcut}</span> : null}
                <span className="ctx-chevron" aria-hidden>
                  ›
                </span>
              </div>
              {openSub === i ? (
                <div className="ctx-menu ctx-submenu" role="menu">
                  {item.submenu.map((sub, j) =>
                    sub.header ? (
                      <div key={`sub-h-${j}`} className="ctx-header">
                        {sub.label}
                      </div>
                    ) : sub.separator ? (
                      <div key={`sub-s-${j}`}>
                        <div className="ctx-sep" />
                        {renderLeaf(sub, `sub-${j}`)}
                      </div>
                    ) : (
                      renderLeaf(sub, `sub-${j}`)
                    ),
                  )}
                </div>
              ) : null}
            </>
          ) : (
            renderLeaf(item, `leaf-${i}`)
          )}
        </div>
      ))}
    </div>
  );
}
