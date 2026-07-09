import { useEffect, useMemo, useRef, useState } from 'react';
import { globFiles, type FileEntry } from '../lib/files';
import { t } from '../i18n';

interface Props {
  cwd: string;
  query: string;
  onSelect: (entry: FileEntry) => void;
  onCancel: () => void;
  /** DOM id for the listbox, referenced by the host textarea's aria-controls. */
  listboxId?: string;
  /** Reports the highlighted option's id (or null) so the host textarea can
   *  expose it as aria-activedescendant (combobox pattern). */
  onActiveDescendant?: (id: string | null) => void;
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
export function FilePicker({
  cwd,
  query,
  onSelect,
  onCancel,
  listboxId = 'file-picker-listbox',
  onActiveDescendant,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Latest callback in a ref so the reporting effects don't retrigger when a
  // host passes a fresh closure each render.
  const onActiveDescendantRef = useRef(onActiveDescendant);
  onActiveDescendantRef.current = onActiveDescendant;
  // The window keydown listener reads these refs instead of closing over
  // state/props. Re-subscribing on every entries/highlight change left a
  // frame where a keypress hit a stale listener still closed over the old
  // (possibly empty) list — Enter/Tab would dismiss instead of insert.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Debounced fetch — 80ms is enough to avoid thrashing during fast typing,
  // imperceptible to the eye.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      let result: FileEntry[] = [];
      let failure: string | null = null;
      try {
        result = await globFiles(cwd, query, 25);
      } catch (err) {
        // A failed listing is NOT "no matches" — rendering the empty-state
        // copy here sent users hunting for typos when the cwd was the problem.
        failure = err instanceof Error ? err.message : String(err);
      }
      if (cancelled) return;
      setEntries(result);
      setError(failure);
      setHighlight(0);
      setLoading(false);
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [cwd, query]);

  // Forward keyboard events from the Composer textarea. We listen at window
  // level because the textarea keeps focus while the picker is open. The
  // listener is attached exactly once and reads the mirrored refs so it can
  // never observe a stale entries/highlight snapshot.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(0, entriesRef.current.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const current = entriesRef.current;
        if (current.length === 0) {
          // Nothing to insert — dismiss instead of letting the keypress fall
          // through as a stray newline the Composer's mention guard blocks
          // from submitting.
          onCancelRef.current();
          return;
        }
        const pick = current[highlightRef.current] ?? current[0];
        if (pick) onSelectRef.current(pick);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Keep the highlighted row visible when arrow-nav scrolls past viewport.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  // Combobox wiring: tell the host which option id is highlighted (null when
  // the list is empty), and clear it when the picker unmounts.
  useEffect(() => {
    onActiveDescendantRef.current?.(entries.length > 0 ? `${listboxId}-opt-${highlight}` : null);
  }, [entries, highlight, listboxId]);
  useEffect(() => {
    return () => onActiveDescendantRef.current?.(null);
  }, []);

  const formattedQuery = useMemo(() => query.trim(), [query]);

  return (
    <div
      className="file-picker"
      id={listboxId}
      role="listbox"
      aria-label={t('filePicker.ariaLabel')}
    >
      <div className="file-picker-head">
        <span className="file-picker-title">
          {formattedQuery ? `@${formattedQuery}` : t('filePicker.emptyQuery')}
        </span>
        <span className="file-picker-meta">
          {loading
            ? t('common.busy')
            : error
              ? t('filePicker.errorMeta')
              : t(entries.length === 1 ? 'filePicker.matchOne' : 'filePicker.matchMany', {
                  count: entries.length,
                })}
        </span>
      </div>
      <div className="file-picker-list" ref={listRef}>
        {!loading && error ? (
          <div className="file-picker-error" role="alert">
            {t('filePicker.error', { error })}
          </div>
        ) : entries.length === 0 ? (
          <div className="file-picker-empty">
            {loading ? t('filePicker.scanning') : t('filePicker.noFiles')}
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div
              key={entry.path}
              id={`${listboxId}-opt-${idx}`}
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
      <p className="file-picker-hint">{t('filePicker.hint')}</p>
    </div>
  );
}
