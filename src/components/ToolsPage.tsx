import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { t } from '../i18n';
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
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Focus trap: Tab/Shift+Tab cycle inside the card, Escape closes, focus
  // returns to the opener on close.
  useModalFocus(open, modalRef, { initialFocus: closeRef, onEscape: onClose });

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
  }, [open]);

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
      setNotice({ kind: 'ok', text: t('tools.installedSkill', { name: entry.name }) });
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
      setNotice({ kind: 'ok', text: t('tools.removedEntry', { name: entry.name }) });
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
        // A picker rejection (e.g. non-mac dev build) propagates to the outer
        // catch, which surfaces it as the same error notice.
        const folder = await pickExposedFolder(cwd);
        if (!folder) {
          setNotice({
            kind: 'err',
            text: t('tools.needsFolder', { name: entry.name }),
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
        setNotice({
          kind: 'ok',
          text: t('tools.addedEntry', {
            name: entry.name,
            envHint: entry.requiredEnv?.length ? t('tools.envHint') : '',
          }),
        });
      } else {
        setNotice({ kind: 'err', text: run?.stderr || run?.output || t('tools.addFailed') });
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
      if (run?.ok) setNotice({ kind: 'ok', text: t('tools.removedEntry', { name: entry.name }) });
      else setNotice({ kind: 'err', text: run?.stderr || t('tools.removeFailed') });
      await refresh();
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={t('tools.ariaLabel')} onClick={onClose}>
      <div className="tools-modal" ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="tools-head">
          <div>
            <h2>{t('tools.title')}</h2>
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
          <button ref={closeRef} type="button" className="settings-close" aria-label={t('common.close')} onClick={onClose}>
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
            {t('tools.tabMcp')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'skills'}
            className={`tools-tab${tab === 'skills' ? ' active' : ''}`}
            onClick={() => setTab('skills')}
          >
            {t('tools.tabSkills')}
          </button>
        </div>

        {notice ? <div className={`tools-notice ${notice.kind}`}>{notice.text}</div> : null}

        <input
          className="tools-search"
          placeholder={tab === 'mcp' ? t('tools.searchMcpPlaceholder') : t('tools.searchSkillsPlaceholder')}
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
                        <span className="tool-mcp-badge">{t('tools.installedBadge')}</span>
                        <button
                          type="button"
                          className="tool-mcp-remove"
                          disabled={busy !== null}
                          onClick={() => void handleRemoveSkill(entry)}
                        >
                          {busy === entry.slug ? t('common.busy') : t('common.remove')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="tool-mcp-add"
                        disabled={busy !== null}
                        onClick={() => void handleInstallSkill(entry)}
                      >
                        {busy === entry.slug ? t('tools.installing') : t('tools.install')}
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
                    {t('tools.needs', { keys: entry.requiredEnv.map((e) => e.key).join(', ') })}
                  </p>
                ) : null}
                {entry.argHint ? <p className="tool-mcp-hint">{entry.argHint}</p> : null}
                <code className="tool-mcp-cmd" title={previewAddCommand(entry)}>
                  {previewAddCommand(entry)}
                </code>
                <div className="tool-mcp-actions">
                  {connected ? (
                    <>
                      <span className="tool-mcp-badge">{t('tools.connectedBadge')}</span>
                      <button
                        type="button"
                        className="tool-mcp-remove"
                        disabled={busy !== null}
                        onClick={() => void handleRemove(entry)}
                      >
                        {busy === entry.id ? t('common.busy') : t('common.remove')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="tool-mcp-add"
                      disabled={busy !== null}
                      onClick={() => void handleAdd(entry)}
                    >
                      {busy === entry.id ? t('tools.adding') : t('tools.add')}
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
            {t('common.refresh')}
          </button>
        </div>
      </div>
    </div>
  );
}
