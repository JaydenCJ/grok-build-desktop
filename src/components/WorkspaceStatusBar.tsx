// The bottom workspace status bar: clickable project/model/policy chips,
// the live run status, and the runs counter + clear action. Extracted from
// App.tsx unchanged.
import {
  CheckCircle2,
  CircleAlert,
  FolderGit2,
  History,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ToolRun } from '../lib/grok';
import type { ActionPolicy } from '../app/types';
import { actionPolicies } from '../app/constants';
import { t } from '../i18n';

export interface WorkspaceStatusBarProps {
  workspacePath: string;
  folderPickerBusy: boolean;
  pickFolder: () => void;
  activeModel: string;
  modelIsVerified: boolean;
  actionPolicy: ActionPolicy;
  openModelSettings: () => void;
  openPermissionSettings: () => void;
  grokIsRunning: boolean;
  lastRun: ToolRun | null;
  totalRuns: number;
  isGrokReady: boolean;
  messagesCount: number;
  historyCount: number;
  clearRunHistory: () => void;
}

export function WorkspaceStatusBar({
  workspacePath,
  folderPickerBusy,
  pickFolder,
  activeModel,
  modelIsVerified,
  actionPolicy,
  openModelSettings,
  openPermissionSettings,
  grokIsRunning,
  lastRun,
  totalRuns,
  isGrokReady,
  messagesCount,
  historyCount,
  clearRunHistory,
}: WorkspaceStatusBarProps) {
  return (
    <footer className="workspace-statusbar" aria-label={t('workspace.ariaLabel')}>
      {/* These chips looked like controls but were dead text. Now they're
              real buttons: project → folder picker, model → Model settings,
              policy → Permissions settings. */}
      <button
        type="button"
        className="status-cluster status-action"
        onClick={pickFolder}
        disabled={folderPickerBusy}
        title={t('workspace.pickFolderTitle')}
      >
        <FolderGit2 size={13} />
        <span className="status-cwd" title={workspacePath}>
          {workspacePath}
        </span>
      </button>
      <button
        type="button"
        className="status-cluster status-action"
        onClick={openModelSettings}
        title={t('workspace.changeModelTitle')}
      >
        <Sparkles size={13} />
        <span>{activeModel}</span>
        {!modelIsVerified ? <span className="status-warn">{t('workspace.unverified')}</span> : null}
      </button>
      <button
        type="button"
        className="status-cluster status-action"
        onClick={openPermissionSettings}
        title={t('workspace.changePolicyTitle')}
      >
        <ShieldCheck size={13} />
        <span>{actionPolicies[actionPolicy].label}</span>
      </button>
      <div className="status-cluster">
        {/* Only report a "last run" once a real run has actually happened
                (totalRuns > 0). Otherwise a default/unavailable lastRun would
                falsely scream "Last run failed · 0.0s" on a fresh launch. */}
        {grokIsRunning ? (
          <Loader2 className="spin" size={13} />
        ) : lastRun && totalRuns > 0 ? (
          lastRun.ok ? (
            <CheckCircle2 size={13} />
          ) : (
            <CircleAlert size={13} />
          )
        ) : (
          <Zap size={13} />
        )}
        <span>
          {grokIsRunning
            ? t('common.running')
            : lastRun && totalRuns > 0
              ? t('workspace.lastRun', {
                  status: lastRun.ok ? t('workspace.lastRunOk') : t('workspace.lastRunFailed'),
                  seconds: (lastRun.duration_ms / 1000).toFixed(1),
                })
              : isGrokReady
                ? t('workspace.idleReady')
                : t('workspace.ready')}
        </span>
      </div>
      <div className="status-cluster status-right">
        <History size={13} />
        <span>{t('workspace.runsCount', { count: totalRuns })}</span>
        <button
          className="status-clear"
          disabled={messagesCount === 0 && historyCount === 0}
          onClick={clearRunHistory}
          type="button"
          title={t('workspace.clearTitle')}
        >
          <Trash2 size={12} />
          <span>{t('workspace.clear')}</span>
        </button>
      </div>
    </footer>
  );
}
