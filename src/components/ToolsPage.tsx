import { useEffect, useMemo, useState } from 'react';
import {
  MCP_CATALOG,
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  previewAddCommand,
  type McpCatalogEntry,
  type ToolRun,
} from '../lib/mcp';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Tools = the MCP (Model Context Protocol) integration hub. This is where you
 * connect community tools — filesystem, GitHub, Postgres, browser automation,
 * search, etc. — so Grok can call them. Each catalog entry maps to a
 * `grok mcp add` invocation; "Connected" reflects `grok mcp list`.
 */
export function ToolsPage({ open, onClose }: Props) {
  const [listOutput, setListOutput] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [query, setQuery] = useState('');

  const refresh = async () => {
    const run = await listMcpServers();
    if (run) setListOutput(`${run.output}\n${run.stderr}`.trim());
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Which catalog ids already appear in `grok mcp list` output.
  const connectedIds = useMemo(() => {
    const lower = listOutput.toLowerCase();
    return new Set(MCP_CATALOG.filter((e) => lower.includes(e.id.toLowerCase())).map((e) => e.id));
  }, [listOutput]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MCP_CATALOG;
    return MCP_CATALOG.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.category.includes(q),
    );
  }, [query]);

  if (!open) return null;

  const handleAdd = async (entry: McpCatalogEntry) => {
    setBusy(entry.id);
    setNotice(null);
    try {
      const run: ToolRun | null = await addMcpServer({
        name: entry.id,
        command: entry.command,
        args: entry.args,
        envPairs: entry.requiredEnv?.map((e) => `${e.key}=`),
      });
      if (run?.ok) {
        setNotice({ kind: 'ok', text: `Added "${entry.name}". ${entry.requiredEnv?.length ? 'Set its API key/env in ~/.grok/config.toml, then restart Grok.' : ''}` });
      } else {
        setNotice({ kind: 'err', text: run?.stderr || run?.output || 'grok mcp add failed' });
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (entry: McpCatalogEntry) => {
    setBusy(entry.id);
    setNotice(null);
    try {
      const run = await removeMcpServer(entry.id);
      if (run?.ok) setNotice({ kind: 'ok', text: `Removed "${entry.name}".` });
      else setNotice({ kind: 'err', text: run?.stderr || 'grok mcp remove failed' });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Tools" onClick={onClose}>
      <div className="tools-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tools-head">
          <div>
            <h2>Tools &amp; MCP</h2>
            <p>
              Connect community tools through the Model Context Protocol so Grok can use them —
              files, GitHub, databases, the web, and more. Each tool maps to a{' '}
              <code>grok mcp add</code> entry in <code>~/.grok/config.toml</code>.
            </p>
          </div>
          <button type="button" className="settings-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {notice ? <div className={`tools-notice ${notice.kind}`}>{notice.text}</div> : null}

        <input
          className="tools-search"
          placeholder="Search tools (github, postgres, search…)"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />

        <div className="tools-grid">
          {filtered.map((entry) => {
            const connected = connectedIds.has(entry.id);
            return (
              <div key={entry.id} className={`tool-mcp-card${connected ? ' is-connected' : ''}`}>
                <div className="tool-mcp-top">
                  <span className="tool-mcp-name">{entry.name}</span>
                  <span className={`tool-mcp-cat cat-${entry.category}`}>{entry.category}</span>
                </div>
                <p className="tool-mcp-desc">{entry.description}</p>
                {entry.requiredEnv?.length ? (
                  <p className="tool-mcp-env">
                    Needs: {entry.requiredEnv.map((e) => e.key).join(', ')}
                  </p>
                ) : null}
                {entry.argHint ? <p className="tool-mcp-hint">{entry.argHint}</p> : null}
                <code className="tool-mcp-cmd" title={previewAddCommand(entry)}>
                  {previewAddCommand(entry)}
                </code>
                <div className="tool-mcp-actions">
                  {connected ? (
                    <>
                      <span className="tool-mcp-badge">✓ Connected</span>
                      <button
                        type="button"
                        className="tool-mcp-remove"
                        disabled={busy !== null}
                        onClick={() => void handleRemove(entry)}
                      >
                        {busy === entry.id ? '…' : 'Remove'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="tool-mcp-add"
                      disabled={busy !== null}
                      onClick={() => void handleAdd(entry)}
                    >
                      {busy === entry.id ? 'Adding…' : 'Add'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="tools-foot">
          <span>
            Want a server not listed here? Any MCP server works — run{' '}
            <code>grok mcp add &lt;name&gt; --command … --args …</code> in a terminal.
          </span>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
