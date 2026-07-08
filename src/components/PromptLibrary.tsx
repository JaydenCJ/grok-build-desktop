import { useEffect, useMemo, useState } from 'react';
import { deletePrompt, listPrompts, upsertPrompt, type Prompt } from '../lib/prompts';

interface Props {
  /** Called when the user picks a prompt to insert into the composer. */
  onInsert: (body: string) => void;
  /** Optional initial filter (e.g. "/" prefix from composer slash trigger). */
  filter?: string;
}

interface EditorState {
  id?: string;
  name: string;
  category: string;
  body: string;
}

const EMPTY_EDITOR: EditorState = { name: '', category: '', body: '' };

export function PromptLibrary({ onInsert, filter }: Props) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [query, setQuery] = useState(filter ?? '');

  useEffect(() => {
    let alive = true;
    listPrompts()
      .then((list) => {
        if (alive) {
          setPrompts(list);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (filter !== undefined) setQuery(filter);
  }, [filter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q),
    );
  }, [prompts, query]);

  const handleSave = async () => {
    if (!editor || !editor.name.trim() || !editor.body.trim()) return;
    const saved = await upsertPrompt({
      id: editor.id,
      name: editor.name.trim(),
      body: editor.body,
      category: editor.category.trim() || null,
    });
    setPrompts((prev) => {
      const without = prev.filter((p) => p.id !== saved.id);
      return [saved, ...without];
    });
    setEditor(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this prompt?')) return;
    const ok = await deletePrompt(id);
    if (ok) setPrompts((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="prompt-library">
      <header className="prompt-library-header">
        <input
          type="search"
          autoFocus
          placeholder="Search prompts…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="prompt-library-search"
        />
        <button
          className="prompt-library-add"
          onClick={() => setEditor({ ...EMPTY_EDITOR })}
          title="New prompt"
        >
          + New
        </button>
      </header>

      {loading ? (
        <div className="prompt-library-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="prompt-library-empty">
          {prompts.length === 0
            ? 'No prompts yet. Click + New to save your first.'
            : 'No matches.'}
        </div>
      ) : (
        <ul className="prompt-library-list">
          {filtered.map((p) => (
            <li key={p.id} className="prompt-library-item">
              <button
                className="prompt-library-pick"
                onClick={() => onInsert(p.body)}
                title="Insert into composer"
              >
                <div className="prompt-library-name">{p.name}</div>
                {p.category ? (
                  <div className="prompt-library-cat">{p.category}</div>
                ) : null}
                <div className="prompt-library-preview">
                  {p.body.slice(0, 80)}
                  {p.body.length > 80 ? '…' : ''}
                </div>
              </button>
              <div className="prompt-library-actions">
                <button
                  onClick={() =>
                    setEditor({
                      id: p.id,
                      name: p.name,
                      category: p.category ?? '',
                      body: p.body,
                    })
                  }
                  className="prompt-library-edit"
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="prompt-library-del"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor ? (
        <div
          className="prompt-library-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditor(null);
          }}
        >
          <div className="prompt-library-modal">
            <h3>{editor.id ? 'Edit prompt' : 'New prompt'}</h3>
            <label>
              Name
              <input
                autoFocus
                value={editor.name}
                onChange={(e) =>
                  setEditor({ ...editor, name: e.currentTarget.value })
                }
                placeholder="e.g. 'Review PR'"
              />
            </label>
            <label>
              Category <span className="prompt-library-hint">(optional)</span>
              <input
                value={editor.category}
                onChange={(e) =>
                  setEditor({ ...editor, category: e.currentTarget.value })
                }
                placeholder="e.g. 'reviews'"
              />
            </label>
            <label>
              Body
              <textarea
                rows={10}
                value={editor.body}
                onChange={(e) =>
                  setEditor({ ...editor, body: e.currentTarget.value })
                }
                placeholder="The full prompt text. Inserted into the composer as-is."
              />
            </label>
            <div className="prompt-library-modal-actions">
              <button
                className="prompt-library-cancel"
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button
                className="prompt-library-save"
                disabled={!editor.name.trim() || !editor.body.trim()}
                onClick={handleSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
