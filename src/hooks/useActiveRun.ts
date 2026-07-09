import { useSyncExternalStore } from 'react';
import { streamStore, type RunSnapshot } from '../lib/streamStore';

export function useActiveRun(): RunSnapshot | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => streamStore.getActiveRunSnapshot(),
    () => undefined,
  );
}

/**
 * "Is anything running or queued?" as a primitive selector. Subscribing to
 * whole run snapshots re-renders on EVERY streamed token (patchRun makes a new
 * snapshot object per event); a boolean lets useSyncExternalStore bail when
 * nothing actually changed. Use this when a component only needs the flag —
 * e.g. the Composer, where per-token re-renders risk dropping IME input.
 */
export function useHasInflight(): boolean {
  return useSyncExternalStore(
    streamStore.subscribe,
    () =>
      streamStore.getActiveRunSnapshot()?.state === 'running' ||
      streamStore.getQueueSnapshot().items.length > 0,
    () => false,
  );
}
