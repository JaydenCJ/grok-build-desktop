// localStorage hydration helpers shared by App boot and its hooks.
import { isChatMessage, isToolRun, type ChatMessage } from './types';
import { storageKeys, tabsActiveKey, tabsStorageKey } from './constants';

export function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Small localStorage helpers for the history-organization maps/sets.
export function loadIdSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}
export function loadIdMap(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(key);
    const obj = raw ? (JSON.parse(raw) as unknown) : {};
    return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function storedRunHistory() {
  return readJsonStorage<unknown[]>(storageKeys.runHistory, []).filter(isToolRun).slice(0, 6);
}

export function storedLastRun() {
  const run = readJsonStorage<unknown | null>(storageKeys.lastRun, null);
  return isToolRun(run) ? run : null;
}

export function storedMessages() {
  return readJsonStorage<unknown[]>(storageKeys.messages, []).filter(isChatMessage).slice(-120);
}

/**
 * Boot hydration: read the active tab's messages from the tabs store. The tabs
 * store persists immediately on every change while the flat
 * `grok-desktop-messages-v1` key is written on a 300ms debounce with no flush
 * on quit — so after a quick tab-switch-and-quit the flat key can hold ANOTHER
 * conversation's messages. Making tabs authoritative at boot prevents the
 * mount-time tab-mirror effect from merging two conversations. Returns null
 * when no tabs are stored (legacy/first run) so callers can fall back to the
 * flat key.
 */
export function storedActiveTabMessages(): ChatMessage[] | null {
  try {
    const raw = window.localStorage.getItem(tabsStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const activeId = window.localStorage.getItem(tabsActiveKey);
    const active = parsed.find((t) => t && t.id === activeId) ?? parsed[0];
    if (!active || !Array.isArray(active.messages)) return null;
    return (active.messages as unknown[]).filter(isChatMessage).slice(-120);
  } catch {
    return null;
  }
}
