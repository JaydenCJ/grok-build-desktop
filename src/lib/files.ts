// Frontend wrapper around the Rust @file commands. Keep the surface area
// minimal so the Composer doesn't need to know about Tauri internals.
import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  path: string; // relative to cwd
  displayName: string;
  sizeBytes: number;
}

interface RawFileEntry {
  path: string;
  display_name: string;
  size_bytes: number;
}

function hasTauri(): boolean {
  // streamStore.ts and other call-sites already use this same check.
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function globFiles(cwd: string, query: string, limit = 25): Promise<FileEntry[]> {
  if (!hasTauri()) return [];
  const trimmed = cwd.trim();
  if (!trimmed) return [];
  try {
    const raw = await invoke<RawFileEntry[]>('glob_files', { cwd: trimmed, query, limit });
    return raw.map((e) => ({
      path: e.path,
      displayName: e.display_name,
      sizeBytes: e.size_bytes,
    }));
  } catch (err) {
    console.warn('[grok-desktop] glob_files failed', err);
    return [];
  }
}

export async function readFileSafe(
  cwd: string,
  path: string,
  maxBytes = 200_000,
): Promise<string | null> {
  if (!hasTauri()) return null;
  try {
    return (
      (await invoke<string | null>('read_file_safe', { cwd, path, maxBytes })) ?? null
    );
  } catch (err) {
    console.warn('[grok-desktop] read_file_safe failed', err);
    return null;
  }
}

/**
 * Parse `@path/to/file.ext` tokens out of a prompt body. A bare token ends at
 * whitespace; paths containing spaces can be quoted as `@"My Dir/file.md"`
 * (the FilePicker inserts that form automatically). Returns each unique path
 * once, in order of first appearance.
 */
export function extractFileMentions(text: string): string[] {
  const re = /(?:^|\s)@(?:"([^"]+)"|([^\s]+))/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1] ?? m[2];
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
