import type { RunSnapshot } from './streamStore';

/**
 * The write-back step that keeps restored conversations intact: the live UI
 * renders assistant replies from streamStore (in-memory only), so once a
 * message's run settles its final text / terminal status / duration must be
 * copied into the message record that App.tsx persists. Pure function so the
 * mapping is unit-testable; App.tsx feeds it to setMessages inside a
 * streamStore.subscribe callback.
 *
 * Returns the SAME array reference when nothing changed, so the caller's
 * setState bails out instead of re-rendering on every store notification.
 */

export type FinalizedStatus = 'streaming' | 'done' | 'error' | 'stopped';

export interface FinalizableMessage {
  role: 'user' | 'assistant';
  content: string;
  status?: FinalizedStatus;
  runId?: string;
  meta?: {
    durationMs?: number;
    [key: string]: unknown;
  };
}

export function finalizeMessages<T extends FinalizableMessage>(
  current: T[],
  getSnapshot: (runId: string) => RunSnapshot | undefined,
): T[] {
  let changed = false;
  const next = current.map((message) => {
    if (message.role !== 'assistant' || !message.runId) return message;
    if (message.status && message.status !== 'streaming') return message;
    const snap = getSnapshot(message.runId);
    if (!snap) return message;
    const terminal =
      snap.state === 'done' || snap.state === 'failed' || snap.state === 'cancelled';
    if (!terminal) return message;
    const status: FinalizedStatus =
      snap.state === 'done' ? 'done' : snap.state === 'failed' ? 'error' : 'stopped';
    changed = true;
    return {
      ...message,
      content: snap.text,
      status,
      meta: {
        ...message.meta,
        durationMs:
          snap.endedAt && snap.startedAt
            ? snap.endedAt - snap.startedAt
            : message.meta?.durationMs,
      },
    };
  });
  return changed ? next : current;
}
