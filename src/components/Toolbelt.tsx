// Developer utilities <details>: the browser-use task runner and the
// absorb-repo tool. Extracted from App.tsx unchanged; state rides in as the
// grouped useGrokRunners result.
import { FolderDown, Globe2, Loader2, Play, Wrench } from "lucide-react";
import type { useGrokRunners } from "../hooks/useGrokRunners";
import { t } from "../i18n";

export interface ToolbeltProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  runners: ReturnType<typeof useGrokRunners>;
}

export function Toolbelt({ open, onToggle, runners }: ToolbeltProps) {
  const {
    busyRunner,
    browserTask,
    setBrowserTask,
    repoPath,
    setRepoPath,
    copyText,
    setCopyText,
    runBrowser,
    runAbsorbRepo,
  } = runners;
  return (
        <details
          className="toolbelt"
          aria-label={t('toolbelt.ariaLabel')}
          onToggle={(event) => onToggle(event.currentTarget.open)}
          open={open}
        >
          <summary>
            <span><Wrench size={16} /> {t('toolbelt.title')}</span>
            <small>{t('toolbelt.subtitle')}</small>
          </summary>
          <div className="toolbelt-grid">
          <div className="tool-card">
            <div className="tool-title">
              <Globe2 size={17} />
              <span>{t('toolbelt.browser')}</span>
            </div>
            <input
              aria-label={t('toolbelt.browserTask')}
              onChange={(event) => setBrowserTask(event.currentTarget.value)}
              value={browserTask}
            />
            <button disabled={busyRunner !== null || browserTask.trim().length === 0} onClick={runBrowser} type="button">
              {busyRunner === "browser" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {t('common.run')}
            </button>
          </div>

          <div className="tool-card">
            <div className="tool-title">
              <FolderDown size={17} />
              <span>{t('toolbelt.absorbRepo')}</span>
            </div>
            <input
              aria-label={t('toolbelt.repoPath')}
              onChange={(event) => setRepoPath(event.currentTarget.value)}
              placeholder={t('toolbelt.repoPathPlaceholder')}
              value={repoPath}
            />
            <label className="checkline">
              <input
                checked={copyText}
                onChange={(event) => setCopyText(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>{t('toolbelt.copyText')}</span>
            </label>
            <button disabled={busyRunner !== null || repoPath.trim().length === 0} onClick={runAbsorbRepo} type="button">
              {busyRunner === "absorb" ? <Loader2 className="spin" size={16} /> : <Wrench size={16} />}
              {t('toolbelt.absorb')}
            </button>
          </div>
          </div>
        </details>
  );
}
