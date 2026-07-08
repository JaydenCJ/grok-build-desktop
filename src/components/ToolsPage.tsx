import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FOLDER_PLACEHOLDER,
  MCP_CATALOG,
  addMcpServer,
  listMcpServers,
  pickExposedFolder,
  removeMcpServer,
  previewAddCommand,
  type McpCatalogEntry,
  type ToolRun,
} from '../lib/mcp';
import {
  SKILL_CATALOG,
  installSkill,
  listInstalledSkills,
  removeSkill,
  type SkillCatalogEntry,
} from '../lib/skills';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Currently selected project folder — starting point for the folder picker. */
  cwd?: string;
}

/**
 * Tools = the MCP (Model Context Protocol) integration hub. This is where you
 * connect community tools — filesystem, GitHub, Postgres, browser automation,
 * search, etc. — so Grok can call them. Each catalog entry maps to a
 * `grok mcp add` invocation; "Connected" reflects `grok mcp list`.
 */
export function ToolsPage({ open, onClose, cwd }: Props) {
  const [tab, setTab] = useState<'mcp' | 'skills'>('mcp');
  const [listOutput, setListOutput] = useState<string>('');
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // aria-modal promises the background is inert, so focus must actually move
  // into the dialog on open — and return to the invoker on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  const refresh = async () => {
    const run = await listMcpServers();
    // Match against stdout only — stderr warnings mentioning e.g. "fetch"
    // must not flip catalog cards to Connected.
    if (run) setListOutput(run.output);
  };
  const refreshSkills = async () => {
    setInstalledSkills(new Set(await listInstalledSkills()));
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    void refreshSkills();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Which catalog ids already appear in `grok mcp list` output. Match ids as
  // whole tokens, not substrings — the catalog has both 'git' and 'github',
  // so a plain includes() marked Git "Connected" whenever GitHub was (and the
  // only offered action, Remove, then targeted a server that never existed).
  const connectedIds = useMemo(() => {
    const lower = listOutput.toLowerCase();
    return new Set(
      MCP_CATALOG.filter((e) => {
        const escaped = e.id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`).test(lower);
      }).map((e) => e.id),
    );
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

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SKILL_CATALOG;
    return SKILL_CATALOG.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.category.includes(q),
    );
  }, [query]);

  const handleInstallSkill = async (entry: SkillCatalogEntry) => {
    setBusy(entry.slug);
    setNotice(null);
    try {
      await installSkill(entry);
      setNotice({ kind: 'ok', text: `Installed "${entry.name}". Grok will pick it up on its next run.` });
      await refreshSkills();
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveSkill = async (entry: SkillCatalogEntry) => {
    setBusy(entry.slug);
    setNotice(null);
    try {
      await removeSkill(entry.slug);
      setNotice({ kind: 'ok', text: `Removed "${entry.name}".` });
      await refreshSkills();
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const handleAdd = async (entry: McpCatalogEntry) => {
    setBusy(entry.id);
    setNotice(null);
    try {
      // Never install a directory-scoped server (filesystem, git) pointed at
      // the placeholder — that would silently expose the whole home folder.
      // Make the user pick the directory explicitly, defaulting to the
      // currently selected project.
      let args = entry.args;
      if (args.includes(FOLDER_PLACEHOLDER)) {
        let folder: string | null = null;
        try {
          folder = await pickExposedFolder(cwd);
        } catch (e) {
          setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
          return;
        }
        if (!folder) {
          setNotice({
            kind: 'err',
            text: `"${entry.name}" needs a folder to expose — pick one to finish adding it.`,
          });
          return;
        }
        args = args.map((a) => (a === FOLDER_PLACEHOLDER ? folder : a));
      }
      const run: ToolRun | null = await addMcpServer({
        name: entry.id,
        command: entry.command,
        args,
        envPairs: entry.requiredEnv?.map((e) => `${e.key}=`),
      });
      if (run?.ok) {
        setNotice({ kind: 'ok', text: `Added "${entry.name}". ${entry.requiredEnv?.length ? 'Set its API key/env in ~/.grok/config.toml, then restart Grok.' : ''}` });
      } else {
        setNotice({ kind: 'err', text: run?.stderr || run?.output || 'grok mcp add failed' });
      }
      await refresh();
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
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
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Tools" onClick={onClose}>
      <div className="tools-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tools-head">
          <div>
            <h2>Tools &amp; Skills</h2>
            <p>
              {tab === 'mcp' ? (
                <>
                  Connect community tools through the Model Context Protocol so Grok can use them —
                  files, GitHub, databases, the web, and more. Each maps to a{' '}
                  <code>grok mcp add</code> entry in <code>~/.grok/config.toml</code>.
                </>
              ) : (
                <>
                  Install reusable coding skills Grok can invoke by name. Each writes a{' '}
                  <code>SKILL.md</code> into <code>~/.grok/skills</code>; Grok discovers it on its
                  next run.
                </>
              )}
            </p>
          </div>
          <button ref={closeRef} type="button" className="settings-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="tools-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mcp'}
            className={`tools-tab${tab === 'mcp' ? ' active' : ''}`}
            onClick={() => setTab('mcp')}
          >
            MCP servers
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'skills'}
            className={`tools-tab${tab === 'skills' ? ' active' : ''}`}
            onClick={() => setTab('skills')}
          >
            Skills
          </button>
        </div>

        {notice ? <div className={`tools-notice ${notice.kind}`}>{notice.text}</div> : null}

        <input
          className="tools-search"
          placeholder={tab === 'mcp' ? 'Search tools (github, postgres, search…)' : 'Search skills (review, tests, debug…)'}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />

        {tab === 'skills' ? (
          <div className="tools-grid">
            {filteredSkills.map((entry) => {
              const installed = installedSkills.has(entry.slug);
              return (
                <div key={entry.slug} className={`tool-mcp-card${installed ? ' is-connected' : ''}`}>
                  <div className="tool-mcp-top">
                    <span className="tool-mcp-name">{entry.name}</span>
                    <span className={`tool-mcp-cat cat-${entry.category}`}>{entry.category}</span>
                  </div>
                  <p className="tool-mcp-desc">{entry.description}</p>
                  <code className="tool-mcp-cmd" title={`~/.grok/skills/${entry.slug}/SKILL.md`}>
                    ~/.grok/skills/{entry.slug}
                  </code>
                  <div className="tool-mcp-actions">
                    {installed ? (
                      <>
                        <span className="tool-mcp-badge">✓ Installed</span>
                        <button
                          type="button"
                          className="tool-mcp-remove"
                          disabled={busy !== null}
                          onClick={() => void handleRemoveSkill(entry)}
                        >
                          {busy === entry.slug ? '…' : 'Remove'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="tool-mcp-add"
                        disabled={busy !== null}
                        onClick={() => void handleInstallSkill(entry)}
                      >
                        {busy === entry.slug ? 'Installing…' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
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
        )}

        <div className="tools-foot">
          {tab === 'mcp' ? (
            <span>
              Want a server not listed here? Any MCP server works — run{' '}
              <code>grok mcp add &lt;name&gt; --command … --args …</code> in a terminal.
            </span>
          ) : (
            <span>
              Write your own anytime: add a folder with a <code>SKILL.md</code> under{' '}
              <code>~/.grok/skills</code>.
            </span>
          )}
          <button type="button" onClick={() => void (tab === 'mcp' ? refresh() : refreshSkills())}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
