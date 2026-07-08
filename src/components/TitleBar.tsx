// The minimal Claude-Desktop-style window title bar: project chip (folder
// picker), draggable spacer, Stop button / connection pill, theme toggle,
// and the panels menu trigger. Extracted from App.tsx unchanged.
import {
  ChevronDown,
  FolderGit2,
  Loader2,
  Moon,
  PanelRight,
  Sun,
  X,
} from "lucide-react";
import type { ThemeMode } from "../app/types";

export interface TitleBarProps {
  codingCwd: string;
  repoName: string;
  folderPickerBusy: boolean;
  pickFolder: () => void;
  grokIsRunning: boolean;
  activeRunId: string | null;
  stopRun: (runId: string) => void;
  isGrokReady: boolean;
  statusLabel: string;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  anyPanelOpen: boolean;
  openPanelMenu: (e: React.MouseEvent) => void;
}

export function TitleBar({
  codingCwd,
  repoName,
  folderPickerBusy,
  pickFolder,
  grokIsRunning,
  activeRunId,
  stopRun,
  isGrokReady,
  statusLabel,
  themeMode,
  setThemeMode,
  anyPanelOpen,
  openPanelMenu,
}: TitleBarProps) {
  return (
        <header className="window-titlebar minimal" data-tauri-drag-region>
          <button
            className="repo-chip"
            onClick={pickFolder}
            type="button"
            disabled={folderPickerBusy}
            title={codingCwd ? codingCwd : "Pick a project folder"}
          >
            {folderPickerBusy ? <Loader2 className="spin" size={14} /> : <FolderGit2 size={14} />}
            <span>{repoName}</span>
          </button>
          <div className="titlebar-spacer" data-tauri-drag-region />
          <div className="titlebar-right">
            {grokIsRunning && activeRunId ? (
              <button
                className="primary-run"
                onClick={() => stopRun(activeRunId)}
                type="button"
                title="Stop the current run"
              >
                <X size={15} />
                <span>Stop</span>
              </button>
            ) : (
              <span
                className={`conn-pill ${isGrokReady ? "ready" : "blocked"}`}
                title={isGrokReady ? "Connected to grok.com" : `Grok ${statusLabel.toLowerCase()}`}
                aria-label={isGrokReady ? "Grok connected" : "Grok not connected"}
              >
                <span className="conn-dot-mini" aria-hidden />
                {isGrokReady ? "Grok" : "Offline"}
              </span>
            )}
            {/* Day / night theme toggle (also ⌘⇧L). Bordered + full-contrast
                sun/moon so it reads as a control, not a stray dot. */}
            <button
              className="titlebar-icon-btn theme-toggle"
              type="button"
              aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={themeMode === "dark" ? "Switch to light mode (⌘⇧L)" : "Switch to dark mode (⌘⇧L)"}
              onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            >
              {themeMode === "dark" ? (
                <Sun size={17} strokeWidth={2.25} />
              ) : (
                <Moon size={17} strokeWidth={2.25} />
              )}
            </button>
            {/* Panels menu — Preview / Context / Terminal / Tools, each opens
                its panel (Claude-Desktop-style). */}
            <button
              className={`detail-toggle${anyPanelOpen ? " active" : ""}`}
              type="button"
              aria-label="Open panels menu"
              title="Panels — Preview, Context, Terminal"
              onClick={openPanelMenu}
            >
              <PanelRight size={16} />
              <ChevronDown size={11} className="detail-caret" />
            </button>
          </div>
        </header>
  );
}
