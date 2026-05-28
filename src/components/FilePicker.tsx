import { useEffect, useMemo, useRef, useState } from 'react';
import { globFiles, type FileEntry } from '../lib/files';

interface Props {
  cwd: string;
  query: string;
  onSelect: (entry: FileEntry) => void;
  onCancel: () => void;
}

/**
 * Inline file picker shown when the user types `@` in the Composer. The list
 * is fuzzy-matched against the current cwd via the Rust `glob_files` command
 * (gitignore-aware). Keyboard nav:
 *   ↑/↓  move highlight
 *   ⏎    insert highlighted path
 *   ⎋    dismiss
 * Tab / mouse click also work.
 *
 * The picker is "uncontrolled" — the host (Composer) owns the query string
 * extracted from the textarea, and pushes it down via the `query` prop.
 */
export function FilePicker({ cwd, query, onSelect, onCancel }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Debounced fetch — 80ms is enough to avoid thrashing during fast typing,
  // imperceptible to the eye.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const result = await globFiles(cwd, query, 25);
      if (cancelled) return;
      setEntries(result);
      setHighlight(0);
      setLoading(false);
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [cwd, query]);

  // Forward keyboard events from the Composer textarea. We listen at window
  // level because the textarea keeps focus while the picker is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(0, entries.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (entries.length === 0) return;
        e.preventDefault();
        const pick = entries[highlight] ?? entries[0];
        if (pick) onSelect(pick);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [entries, highlight, onSelect, onCancel]);

  // Keep the highlighted row visible when arrow-nav scrolls past viewport.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const formattedQuery = useMemo(() => query.trim(), [query]);

  return (
    <div className="file-picker" role="listbox" aria-label="File reference">
      <div className="file-picker-head">
        <span className="file-picker-title">
          {formattedQuery ? `@${formattedQuery}` : 'Type to search files in cwd'}
        </span>
        <span className="file-picker-meta">
          {loading ? '…' : `${entries.length} match${entries.length === 1 ? '' : 'es'}`}
        </span>
      </div>
      <div className="file-picker-list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="file-picker-empty">
            {loading ? 'Scanning…' : 'No files matched. ⎋ to dismiss.'}
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div
              key={entry.path}
              role="option"
              aria-selected={idx === highlight}
              className={`file-picker-row${idx === highlight ? ' is-highlight' : ''}`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => {
                // mousedown not click — click fires after textarea blur, by
                // which point the picker may already have unmounted.
                e.preventDefault();
                onSelect(entry);
              }}
            >
              <span className="file-picker-name">{entry.displayName}</span>
              <span className="file-picker-path">{entry.path}</span>
            </div>
          ))
        )}
      </div>
      <p className="file-picker-hint">↑↓ navigate · ⏎/Tab insert · ⎋ dismiss</p>
    </div>
  );
}
