import { useSyncExternalStore } from 'react';
import { getPendingSubmitCount, subscribePendingSubmit } from '../lib/streamStore';

/**
 * Number of `enqueue_run` calls that are in flight but haven't yet received
 * a run-state-changed event from the Rust queue. Used by StatusBar to render
 * a "preparing run…" state so the user has visual feedback in the gap
 * between pressing Enter and the first Tauri event arriving.
 */
export function usePendingSubmitCount(): number {
  return useSyncExternalStore(subscribePendingSubmit, getPendingSubmitCount, () => 0);
}
