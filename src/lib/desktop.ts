// Frontend wrapper around the Mac desktop bridge (Rust src/desktop.rs).
// Stays in lock-step with the allowlist on the Rust side — if the user
// triggers an action the Rust side doesn't recognize, we surface the error
// instead of silently failing.
import { invoke } from '@tauri-apps/api/core';

export interface DesktopApp {
  name: string;
  bundleId: string;
  running: boolean;
  capabilities: string[];
}

interface RawDesktopApp {
  name: string;
  bundle_id: string;
  running: boolean;
  capabilities: string[];
}

function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function listDesktopApps(): Promise<DesktopApp[]> {
  if (!hasTauri()) return [];
  try {
    const raw = await invoke<RawDesktopApp[]>('desktop_list_apps');
    return raw.map((a) => ({
      name: a.name,
      bundleId: a.bundle_id,
      running: a.running,
      capabilities: a.capabilities,
    }));
  } catch (err) {
    console.warn('[grok-desktop] desktop_list_apps failed', err);
    return [];
  }
}

export async function desktopQuery(action: string): Promise<string> {
  if (!hasTauri()) throw new Error('Tauri runtime unavailable');
  return invoke<string>('desktop_query', { action });
}

export async function desktopActivate(app: string): Promise<void> {
  if (!hasTauri()) throw new Error('Tauri runtime unavailable');
  await invoke('desktop_activate', { app });
}

export const CAPABILITY_LABELS: Record<string, { label: string; hint: string }> = {
  safari_url: { label: 'Read Safari URL', hint: 'Current tab in the frontmost window' },
  safari_title: { label: 'Read Safari title', hint: 'Current tab title' },
  finder_selection: { label: 'Read Finder selection', hint: 'POSIX paths of selected items' },
  finder_front_path: { label: 'Read Finder cwd', hint: 'Path of the frontmost Finder window' },
  iterm_active_dir: { label: 'Read iTerm cwd', hint: 'Working dir of current pane' },
  mail_unread_count: { label: 'Mail unread count', hint: 'Inbox unread count' },
};
