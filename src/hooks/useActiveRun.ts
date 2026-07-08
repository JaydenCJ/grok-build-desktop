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
 * Narrow selector for hosts that only need to know WHICH run is active and
 * WHETHER it is running — not every streamed token. The full snapshot object
 * is replaced on each text/thought/html patch, so subscribing to it from a
 * large component (App is ~4k lines) re-rendered the whole tree many times
 * per second during a run. This returns a primitive `"<id>:<state>"` key
 * (uuid ids contain no ':'), so useSyncExternalStore bails out unless the
 * active run or its state actually changes.
 */
export function useActiveRunKey(): string {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => {
      const snap = streamStore.getActiveRunSnapshot();
      return snap ? `${snap.id}:${snap.state}` : '';
    },
    () => '',
  );
}
