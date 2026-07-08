// The collapsible terminal dock: shell-command input, run button, dock
// position dots, and the log view. Extracted from App.tsx unchanged.
import { Loader2, Play, SquareTerminal, TerminalSquare } from "lucide-react";
import type { DockPosition } from "../app/types";
import { terminalClass, terminalPrefix, terminalText } from "../app/format";

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
              <strong>Terminal</strong>
              <small className={busyRunner ? "running" : ""}>{busyRunner ? "Running" : "Idle"}</small>
            </span>
            <span>
              <button
                aria-label="Dock terminal right"
                className={dockPosition === "right" ? "dock-dot active" : "dock-dot"}
                onClick={(event) => {
                  event.preventDefault();
                  setDockPosition("right");
                }}
                type="button"
              >
                Right
              </button>
              <button
                aria-label="Dock terminal bottom"
                className={dockPosition === "bottom" ? "dock-dot active" : "dock-dot"}
                onClick={(event) => {
                  event.preventDefault();
                  setDockPosition("bottom");
                }}
                type="button"
              >
                Bottom
              </button>
              <small>{terminalDisplay.length} lines</small>
            </span>
          </summary>
          <div className="terminal-head">
            <div>
              <SquareTerminal size={17} />
              <strong>Terminal</strong>
              <span className={busyRunner ? "running" : ""}>{busyRunner ? "Running" : "Idle"}</span>
            </div>
            <div className="terminal-actions">
              <label>
                <TerminalSquare size={15} />
                <input
                  aria-label="Shell command"
                  onChange={(event) => setShellCommand(event.currentTarget.value)}
                  value={shellCommand}
                />
              </label>
              <button
                disabled={busyRunner !== null || shellCommand.trim().length === 0}
                onClick={runShell}
                type="button"
              >
                {busyRunner === "shell" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                Run
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
