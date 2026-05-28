import { useSyncExternalStore } from 'react';
import { streamStore } from '../lib/streamStore';
import type { TraceEvent } from '../lib/traceParser';

const EMPTY: readonly TraceEvent[] = Object.freeze([]) as readonly TraceEvent[];

/**
 * Subscribe to the trace cards of a single run. Returns an empty array if the
 * run is unknown or has no traces yet. Uses `useSyncExternalStore` so React
 * tears the right amount on each patch.
 */
export function useTraces(runId: string | undefined): readonly TraceEvent[] {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => {
      if (!runId) return EMPTY;
      return streamStore.getRunSnapshot(runId)?.traces ?? EMPTY;
    },
    () => EMPTY,
  );
}
