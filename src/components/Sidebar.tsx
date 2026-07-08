// The app sidebar: brand + command-palette chevron, primary navigation,
// the organized conversations list (pinned / groups / recent / archived)
// with its rename/menu machinery, tool health, and the account strip.
// Extracted from App.tsx unchanged; history state rides in as the grouped
// useHistoryOrganization result.
import {
  Archive,
  ArchiveRestore,
  BookmarkPlus,
  ChevronDown,
  ClipboardCheck,
  Copy,
  CornerUpLeft,
  FolderInput,
  FolderPlus,
  History,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { BrandGlyph } from "./BrandGlyph";
import type { ContextMenuItem, ContextMenuState } from "./ContextMenu";
import type { useHistoryOrganization } from "../hooks/useHistoryOrganization";
import type { HistoryPreview, HistoryRow, ToolStatus } from "../app/types";
import { primaryNavItems } from "../app/constants";
import { statusTone } from "../app/format";

export interface SidebarProps {
  history: ReturnType<typeof useHistoryOrganization>;
  sessionFirstPrompt: (id: string) => string | null;
  switchToSession: (id: string) => void;
  deleteSession: (id: string) => void;
  handleTabCreate: () => void;
  focusComposer: () => void;
  setContextMenu: (menu: ContextMenuState | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  toolsPageOpen: boolean;
  setToolsPageOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  busyRunner: string | null;
  refreshStatuses: () => void;
  runDoctor: () => void;
  grokToolStatus: ToolStatus | undefined;
  isGrokReady: boolean;
  activeModel: string;
  statusLabel: string;
}

export function Sidebar({
  history,
  sessionFirstPrompt,
  switchToSession,
  deleteSession,
  handleTabCreate,
  focusComposer,
  setContextMenu,
  paletteOpen,
  setPaletteOpen,
  toolsPageOpen,
  setToolsPageOpen,
  settingsOpen,
  setSettingsOpen,
  busyRunner,
  refreshStatuses,
  runDoctor,
  grokToolStatus,
  isGrokReady,
  activeModel,
  statusLabel,
}: SidebarProps) {
  const {
    pinnedPromptIds,
    promptGroups,
    archivedPromptIds,
    showArchived,
    setShowArchived,
    rowEdit,
    setRowEdit,
    historyNote,
    setHistoryNote,
    historyFilter,
    setHistoryFilter,
    historySearchInputRef,
    recentPrompts,
    historyView,
    togglePinPrompt,
    toggleArchivePrompt,
    setPromptGroupId,
    startRename,
    startNewGroup,
    commitRowEdit,
    savePromptToLibrary,
  } = history;

  // Claude-class right-click menu for a history row. Section header, icons,
  // shortcut accelerators, two flyout submenus (Open with / Move to group).
  function openHistoryMenu(e: React.MouseEvent, item: HistoryPreview) {
    e.preventDefault();
    const id = item.id; // tab/session id
    const text = sessionFirstPrompt(id) ?? item.title;
    const pinned = pinnedPromptIds.has(id);
    const archived = archivedPromptIds.has(id);
    const currentGroup = promptGroups[id] ?? null;
    const groupNames = Array.from(new Set(Object.values(promptGroups))).sort((a, b) => a.localeCompare(b));

    const groupSubmenu: ContextMenuItem[] = [
      { label: "New group…", icon: <FolderPlus size={15} />, onClick: () => startNewGroup(id) },
      ...(groupNames.length ? [{ label: "Move to", header: true } as ContextMenuItem] : []),
      ...groupNames.map((g) => ({
        label: currentGroup === g ? `${g}  ✓` : g,
        icon: <FolderInput size={15} />,
        onClick: () => setPromptGroupId(id, currentGroup === g ? null : g),
      })),
      ...(currentGroup
        ? [{ label: "Remove from group", separator: true, icon: <X size={15} />, onClick: () => setPromptGroupId(id, null) }]
        : []),
    ];

    const items: ContextMenuItem[] = [
      { label: item.title.length > 34 ? `${item.title.slice(0, 34)}…` : item.title, header: true },
      {
        label: "Open conversation",
        icon: <CornerUpLeft size={15} />,
        shortcut: "↵",
        onClick: () => switchToSession(id),
      },
      {
        label: "Copy first prompt",
        icon: <Copy size={15} />,
        shortcut: "⌘C",
        onClick: () => {
          void navigator.clipboard?.writeText(text);
          setHistoryNote("Copied");
        },
      },
      { label: "Save to Prompt Library", icon: <BookmarkPlus size={15} />, onClick: () => void savePromptToLibrary(id) },
      {
        label: pinned ? "Unpin" : "Pin to top",
        icon: pinned ? <PinOff size={15} /> : <Pin size={15} />,
        shortcut: "P",
        separator: true,
        onClick: () => togglePinPrompt(id),
      },
      { label: "Rename…", icon: <Pencil size={15} />, shortcut: "R", onClick: () => startRename(id) },
      { label: "Move to group", icon: <FolderInput size={15} />, shortcut: "G", submenu: groupSubmenu },
      {
        label: archived ? "Unarchive" : "Archive",
        icon: archived ? <ArchiveRestore size={15} /> : <Archive size={15} />,
        shortcut: "A",
        onClick: () => toggleArchivePrompt(id),
      },
      { label: "Delete conversation", icon: <Trash2 size={15} />, shortcut: "⌫", danger: true, separator: true, onClick: () => deleteSession(id) },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  // One history row — inline rename/new-group input when being edited,
  // otherwise a click-to-restore / right-click-for-actions button.
  function renderHistoryRow(item: HistoryRow) {
    if (rowEdit?.id === item.id) {
      return (
        <div className="history-rename" key={item.id}>
          <input
            // Callback ref instead of autoFocus: React's autoFocus doesn't
            // reliably grab focus in the production WebView when the input
            // appears via a state change (the composer kept focus, so typed
            // text went there instead of here). Focusing on mount is robust.
            ref={(el) => {
              if (el) {
                el.focus();
                el.select();
              }
            }}
            defaultValue={rowEdit.mode === "rename" ? item.title : ""}
            placeholder={rowEdit.mode === "rename" ? "Rename prompt" : "New group name"}
            aria-label={rowEdit.mode === "rename" ? "Rename prompt" : "New group name"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRowEdit(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRowEdit(null);
              }
            }}
            onBlur={(e) => commitRowEdit(e.currentTarget.value)}
          />
        </div>
      );
    }
    return (
      <button
        className={`history-row${item.pinned ? " pinned" : ""}${item.active ? " active" : ""}`}
        key={item.id}
        onClick={() => switchToSession(item.id)}
        onContextMenu={(e) => openHistoryMenu(e, item)}
        title="Open this conversation · right-click for actions"
        type="button"
        aria-current={item.active ? "true" : undefined}
      >
        <span className="history-row-main">
          <strong>
            {item.pinned ? <Pin size={11} className="pin-dot" /> : null}
            {item.title}
          </strong>
          <small>{item.detail}</small>
        </span>
        <time>{item.time || ""}</time>
      </button>
    );
  }

  return (
      <aside className="app-sidebar">
        <div className="brand">
          <div className="brand-mark"><BrandGlyph size={18} /></div>
          <div>
            <h1>Grok Build Desktop</h1>
            <span>Grok Build for engineers</span>
          </div>
          {/* The chevron previously looked clickable but did nothing. Now it
              opens the ⌘K palette — the natural "what can I do?" affordance. */}
          <button
            className="brand-chevron"
            type="button"
            aria-label="Open command palette"
            title="Command palette (⌘K)"
            onClick={() => setPaletteOpen(true)}
          >
            <ChevronDown size={16} />
          </button>
        </div>

        <section className="nav-section primary-nav" aria-label="Primary navigation">
          <div className="nav-list">
            {primaryNavItems.map((item) => {
              // Each nav item maps to a single, deterministic action — no
              // "this kinda does X" semantics. If the action isn't obvious
              // from the label, the meta line below it explains.
              const handle = () => {
                if (item.label === "New Session") {
                  // CREATES a fresh tab (empty messages, clean cwd) and
                  // switches to it. handleTabCreate already wipes drafts,
                  // notices, and last-run card — Claude-Desktop-style
                  // "clean slate". Then put the cursor in the composer.
                  handleTabCreate();
                  focusComposer();
                } else if (item.label === "Search") {
                  // Open the ⌘K command palette pre-focused. The host of
                  // visible "search-y" things (recent prompts, palette,
                  // files) is unified here.
                  setPaletteOpen(true);
                } else if (item.label === "Tools") {
                  // Dedicated Tools / MCP hub (community-tool integration).
                  setToolsPageOpen(true);
                } else if (item.label === "Settings") {
                  // Dedicated Settings page (Claude-Desktop-style modal).
                  setSettingsOpen(true);
                }
              };
              // The active highlight should follow what's *actually* open,
              // not hardcoded to "New Session". Otherwise every button looks
              // selected and the user can't tell which panel is current.
              const isActive =
                (item.label === "Tools" && toolsPageOpen) ||
                (item.label === "Settings" && settingsOpen) ||
                (item.label === "Search" && paletteOpen);
              return (
                <button
                  className={isActive ? "active" : ""}
                  key={item.label}
                  type="button"
                  onClick={handle}
                >
                  {item.label === "New Session" ? <Plus size={16} /> : item.label === "Search" ? <Search size={16} /> : item.label === "Tools" ? <Wrench size={16} /> : <Settings size={16} />}
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="nav-section history-nav">
          <div className="nav-head">
            <span>Conversations</span>
            {/* Refresh icon — clears the filter input so the user sees the
                full recent-prompts list again. Was a decorative icon before. */}
            <button
              className="history-refresh"
              type="button"
              aria-label="Clear filter"
              title="Clear filter and show all recent prompts"
              onClick={() => {
                setHistoryFilter("");
                historySearchInputRef.current?.focus();
              }}
            >
              <History size={15} />
            </button>
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              ref={historySearchInputRef}
              aria-label="Search history"
              placeholder="Search conversations..."
              onChange={(event) => setHistoryFilter(event.currentTarget.value)}
              value={historyFilter}
            />
          </label>
          <div className="history-list">
            {recentPrompts.length === 0 ? (
              // No fake "Try: …" placeholders. An empty state is honest and
              // less misleading than disabled-looking rows that look real.
              <div className="history-empty">
                {historyFilter.trim() ? (
                  <>
                    <span>No matches for</span>
                    <code>{historyFilter.trim()}</code>
                  </>
                ) : (
                  <span>Your conversations will show up here.</span>
                )}
              </div>
            ) : (
              <>
                {historyView.pinned.length > 0 ? (
                  <div className="history-group">
                    <div className="history-section-head">
                      <Pin size={12} /> Pinned
                    </div>
                    {historyView.pinned.map(renderHistoryRow)}
                  </div>
                ) : null}

                {historyView.groups.map(([name, rows]) => (
                  <div className="history-group" key={`hg-${name}`}>
                    <div className="history-section-head">
                      <FolderInput size={12} /> {name}
                    </div>
                    {rows.map(renderHistoryRow)}
                  </div>
                ))}

                {historyView.ungrouped.length > 0 ? (
                  <div className="history-group">
                    {historyView.pinned.length > 0 || historyView.groups.length > 0 ? (
                      <div className="history-section-head">
                        <History size={12} /> Recent
                      </div>
                    ) : null}
                    {historyView.ungrouped.map(renderHistoryRow)}
                  </div>
                ) : null}

                {historyView.archived.length > 0 ? (
                  <div className="history-group archived">
                    <button
                      type="button"
                      className="history-section-head toggle"
                      onClick={() => setShowArchived((v) => !v)}
                    >
                      <Archive size={12} /> Archived ({historyView.archived.length})
                      <ChevronDown size={13} className={`chev${showArchived || historyFilter.trim() ? " open" : ""}`} />
                    </button>
                    {showArchived || historyFilter.trim() ? historyView.archived.map(renderHistoryRow) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
          {historyNote ? <div className="history-toast">{historyNote}</div> : null}
        </section>

        <section className="sidebar-health" aria-label="Tool health">
          <div className="nav-head">
            <span>Health</span>
            <button
              aria-label="Refresh status"
              className="sidebar-icon"
              disabled={busyRunner !== null}
              onClick={refreshStatuses}
              type="button"
            >
              {busyRunner === "status" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            </button>
          </div>
          <div className={`health-pill ${statusTone(grokToolStatus)}`}>
            <Zap size={15} />
            <span>{grokToolStatus?.installed ? "Grok ready" : "Grok missing"}</span>
          </div>
          <button className="doctor-button" disabled={busyRunner !== null} onClick={runDoctor} type="button">
            {busyRunner === "doctor" ? <Loader2 className="spin" size={16} /> : <ClipboardCheck size={16} />}
            <span>Doctor</span>
          </button>
        </section>

        {/* Whole strip is the Settings affordance now — clicking anywhere
            (avatar, name, or gear) opens Settings. Previously only the tiny
            gear was clickable, which read as "broken". */}
        <button
          className="account-strip"
          type="button"
          aria-label="Open settings"
          title="Settings (⌘,)"
          onClick={() => setSettingsOpen(true)}
        >
          <div className={`avatar${isGrokReady ? " ready" : ""}`}><BrandGlyph size={17} /></div>
          <div className="account-text">
            {/* Real data: active model + live grok connection status. */}
            <strong>{activeModel}</strong>
            <span>{isGrokReady ? "Connected · grok.com" : statusLabel}</span>
          </div>
          <span className="account-settings" aria-hidden="true">
            <Settings size={16} />
          </span>
        </button>
      </aside>
  );
}
