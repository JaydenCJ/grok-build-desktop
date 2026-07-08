// The collapsible terminal dock: shell-command input, run button, dock
// position dots, and the log view. Extracted from App.tsx unchanged.
import { Loader2, Play, SquareTerminal, TerminalSquare } from 'lucide-react';
import type { DockPosition } from '../app/types';
import { terminalClass, terminalPrefix, terminalText } from '../app/format';
import { t } from '../i18n';

export interface TerminalDockProps {
  open: boolean;
  onOpenPanel: () => void;
  onClose: () => void;
  dockPosition: DockPosition;
  setDockPosition: (position: DockPosition) => void;
  busyRunner: string | null;
  shellCommand: string;
  setShellCommand: (command: string) => void;
  runShell: () => void;
  sessionNotice: string | null;
  terminalDisplay: string[];
}

export function TerminalDock({
  open,
  onOpenPanel,
  onClose,
  dockPosition,
  setDockPosition,
  busyRunner,
  shellCommand,
  setShellCommand,
  runShell,
  sessionNotice,
  terminalDisplay,
}: TerminalDockProps) {
  return (
    <details
      className="terminal-dock"
      onToggle={(event) => {
        if (event.currentTarget.open && !open) onOpenPanel();
        else if (!event.currentTarget.open && open) onClose();
      }}
      open={open}
    >
      <summary className="terminal-summary">
        <span>
          <SquareTerminal size={16} />
          <strong>{t('terminal.title')}</strong>
          <small className={busyRunner ? 'running' : ''}>
            {busyRunner ? t('common.running') : t('common.idle')}
          </small>
        </span>
        <span>
          <button
            aria-label={t('terminal.dockRight')}
            className={dockPosition === 'right' ? 'dock-dot active' : 'dock-dot'}
            onClick={(event) => {
              event.preventDefault();
              setDockPosition('right');
            }}
            type="button"
          >
            {t('common.right')}
          </button>
          <button
            aria-label={t('terminal.dockBottom')}
            className={dockPosition === 'bottom' ? 'dock-dot active' : 'dock-dot'}
            onClick={(event) => {
              event.preventDefault();
              setDockPosition('bottom');
            }}
            type="button"
          >
            {t('common.bottom')}
          </button>
          <small>{t('terminal.linesCount', { count: terminalDisplay.length })}</small>
        </span>
      </summary>
      <div className="terminal-head">
        <div>
          <SquareTerminal size={17} />
          <strong>{t('terminal.title')}</strong>
          <span className={busyRunner ? 'running' : ''}>
            {busyRunner ? t('common.running') : t('common.idle')}
          </span>
        </div>
        <div className="terminal-actions">
          <label>
            <TerminalSquare size={15} />
            <input
              aria-label={t('terminal.shellCommand')}
              onChange={(event) => setShellCommand(event.currentTarget.value)}
              value={shellCommand}
            />
          </label>
          <button
            disabled={busyRunner !== null || shellCommand.trim().length === 0}
            onClick={runShell}
            type="button"
          >
            {busyRunner === 'shell' ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            {t('common.run')}
          </button>
        </div>
      </div>
      {sessionNotice ? <p className="session-note">{sessionNotice}</p> : null}
      <div className="terminal-view" role="log" aria-live="polite">
        {terminalDisplay.map((line, index) => (
          <div className={terminalClass(line)} key={`${line}-${index}`}>
            <span className="terminal-prefix">{terminalPrefix(line)}</span>
            <span>{terminalText(line)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
