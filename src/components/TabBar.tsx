import { useState } from 'react';
import { requestConfirm } from '../lib/confirm';
import type { Tab } from '../lib/tabs';

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

/**
 * Horizontal tab strip above the conversation. Each tab represents an
 * independent session (its own cwd + message history). Single-tab mode hides
 * the close button so a fresh user isn't confused by "X to delete my chat".
 */
export function TabBar({ tabs, activeId, onSelect, onCreate, onClose, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="tab-bar" role="tablist" aria-label="Sessions">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isEditing = editingId === tab.id;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`tab-item${isActive ? ' is-active' : ''}`}
            onClick={() => !isEditing && onSelect(tab.id)}
            onDoubleClick={() => {
              setEditingId(tab.id);
              setDraft(tab.name);
            }}
            title={tab.cwd || 'No cwd set'}
          >
            {isEditing ? (
              <input
                className="tab-rename"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.currentTarget.value)}
                onBlur={() => {
                  const next = draft.trim();
                  if (next && next !== tab.name) onRename(tab.id, next);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
              />
            ) : (
              <>
                <span className="tab-dot" aria-hidden />
                <span className="tab-name">{tab.name}</span>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    className="tab-close"
                    aria-label={`Close ${tab.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      // In-app confirm — window.confirm always returns false
                      // inside WKWebView, so tabs with messages could never
                      // actually be closed.
                      if (tab.messages.length === 0) {
                        onClose(tab.id);
                        return;
                      }
                      void requestConfirm({
                        title: 'Close session?',
                        message: `Close "${tab.name}"? This clears ${tab.messages.length} message${tab.messages.length === 1 ? '' : 's'} for this session.`,
                        confirmLabel: 'Close session',
                        danger: true,
                      }).then((ok) => {
                        if (ok) onClose(tab.id);
                      });
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="tab-add"
        onClick={onCreate}
        title="New session"
        aria-label="New session"
      >
        +
      </button>
    </div>
  );
}
