import { useSyncExternalStore } from 'react';
import { streamStore, type RunSnapshot } from '../lib/streamStore';

export function useRunSnapshot(runId: string | null | undefined): RunSnapshot | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => (runId ? streamStore.getRunSnapshot(runId) : undefined),
    () => undefined,
  );
}

export function useRunHtml(runId: string | null | undefined): string | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => (runId ? streamStore.getHtml(runId) : undefined),
    () => undefined,
  );
}
