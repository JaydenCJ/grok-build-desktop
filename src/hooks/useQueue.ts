import { useSyncExternalStore } from 'react';
import { streamStore } from '../lib/streamStore';

const emptyQueue = { active: null as string | null, items: [] };

export function useQueue() {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => streamStore.getQueueSnapshot(),
    () => emptyQueue,
  );
}
