import { useSyncExternalStore } from 'react';
import { streamStore, type RunSnapshot } from '../lib/streamStore';

export function useActiveRun(): RunSnapshot | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => streamStore.getActiveRunSnapshot(),
    () => undefined,
  );
}
