// Lightweight multi-session tab model.
//
// Each tab owns its (cwd, displayName, messages). The rest of the UI state
// (mode, draft text, model selection, action policy, etc.) is global — tabs
// are *workspaces*, not full preference clones. That keeps the refactor
// surgical: App.tsx's 80+ pieces of state stay flat; only `codingCwd` and
// `messages` are now derived from the active tab.

/**
 * Minimal shape of a chat message; the canonical type is defined in App.tsx.
 * Re-exporting it from there created a circular dep, so we describe just the
 * fields tabs.ts actually touches (none — we pass messages through opaquely).
 */
export interface TabMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  [k: string]: unknown;
}

export interface Tab {
  id: string; // uuid (v7-style timestamped)
  name: string; // user-editable, defaults to basename(cwd) or "Session N"
  cwd: string;
  messages: TabMessage[];
  createdAt: number;
}

let counter = 0;
export function makeTabId(): string {
  // Prefix with timestamp so sort-by-id is sort-by-creation.
  return `tab_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

export function defaultTabName(cwd: string, index = 0): string {
  const trimmed = cwd.trim();
  if (!trimmed) return `Session ${index + 1}`;
  const parts = trimmed.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || `Session ${index + 1}`;
}

export function makeTab(cwd: string, messages: TabMessage[] = [], name?: string): Tab {
  return {
    id: makeTabId(),
    name: name ?? defaultTabName(cwd),
    cwd,
    messages,
    createdAt: Date.now(),
  };
}
