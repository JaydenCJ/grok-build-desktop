import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  /** Tag (e.g. "Session", "View", "Theme") for grouping. */
  group?: string;
  run: () => void | Promise<void>;
}

interface Props {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}

/**
 * ⌘K-style command palette. Filters across the host-supplied `actions` list
 * by substring (case-insensitive). The host owns the action catalogue — this
 * component just renders/picks. Keeps the palette decoupled from App.tsx's
 * many slices of state.
 *
 * Navigation:
 *   ↑/↓   move highlight
 *   ⏎     run highlighted action and close
 *   ⎋     close without running
 */
export function CommandPalette({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset query + focus when palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      // Wait a tick so the input is mounted before focusing.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const haystack = `${a.label} ${a.hint ?? ''} ${a.group ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [actions, query]);

  // Clamp the highlight whenever the filtered list shrinks.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered, highlight]);

  // Keep the highlighted row visible during arrow-key navigation — the list
  // scrolls (max-height 60vh) and routinely overflows once history entries
  // are appended, so without this keyboard users navigate blind past the
  // fold. Same pattern as FilePicker. block:'nearest' is a no-op for rows
  // already in view, so hover-driven highlight changes never cause jumps.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  if (!open) return null;

  const run = (action: PaletteAction) => {
    onClose();
    // Run on next tick so the unmount happens before any action that focuses
    // a textarea (e.g. "Focus composer") races with the palette teardown.
    queueMicrotask(() => {
      void action.run();
    });
  };

  return (
    <div
      className="palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div className="palette-shell" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search-row">
          <span className="palette-search-glyph" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            className="palette-search-input"
            value={query}
            placeholder="Type a command…"
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              // While an IME is composing (Chinese/Japanese/Korean), Enter
              // commits the candidate and arrows move it — they must NOT
              // navigate or select the palette. Without this, typing pinyin and
              // pressing Enter to confirm the characters fired a result early.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = filtered[highlight];
                if (pick) run(pick);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <span className="palette-search-kbd">esc</span>
        </div>
        <div className="palette-list" role="listbox" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">No commands match.</div>
          ) : (
            filtered.map((action, idx) => (
              <button
                key={action.id}
                type="button"
                role="option"
                aria-selected={idx === highlight}
                className={`palette-row${idx === highlight ? ' is-highlight' : ''}`}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => run(action)}
              >
                <span className="palette-row-label">{action.label}</span>
                {action.group ? (
                  <span className="palette-row-group">{action.group}</span>
                ) : null}
                {action.shortcut ? (
                  <span className="palette-row-shortcut">{action.shortcut}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
