import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { classifyEvent, type TraceEvent } from './traceParser';
import { hasTauriRuntime } from './runtime';

export type GrokEvent =
  | { type: 'thought'; data: string }
  | { type: 'text'; data: string }
  | { type: 'end'; stopReason: string; sessionId: string; requestId: string }
  | { type: string; [k: string]: unknown };

export type RunState = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

export interface RunSnapshot {
  id: string;
  state: RunState;
  startedAt: number | null;
  endedAt: number | null;
  thoughtChars: number;
  textChars: number;
  lastEventType: 'thought' | 'text' | 'end' | null;
  text: string;
  htmlVersion: number;
  stopReason: string | null;
  error: string | null;
  /** Tool / subagent / task trace cards, in order of first appearance. */
  traces: TraceEvent[];
}

export interface QueuedRunMeta {
  id: string;
  prompt: string;
  cwd?: string;
  state: 'Queued' | 'Running' | 'Done' | 'Cancelled' | 'Failed';
  enqueuedAt: number;
}

interface QueueSnapshot {
  active: string | null;
  items: QueuedRunMeta[];
}

type Listener = () => void;

class StreamStore {
  private runs = new Map<string, RunSnapshot>();
  private html = new Map<string, string>();
  private queue: QueueSnapshot = { active: null, items: [] };
  private listeners = new Set<Listener>();

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private notify() {
    this.listeners.forEach((l) => l());
  }

  getRunSnapshot = (id: string): RunSnapshot | undefined => this.runs.get(id);
  getHtml = (id: string): string | undefined => this.html.get(id);
  getQueueSnapshot = (): QueueSnapshot => this.queue;
  getActiveRunSnapshot = (): RunSnapshot | undefined =>
    this.queue.active ? this.runs.get(this.queue.active) : undefined;

  patchRun = (id: string, patch: Partial<RunSnapshot>): void => {
    const cur = this.runs.get(id) ?? this.makeEmpty(id);
    this.runs.set(id, { ...cur, ...patch });
    this.notify();
  };

  setHtml = (id: string, html: string): void => {
    this.html.set(id, html);
    const cur = this.runs.get(id);
    if (cur) {
      this.runs.set(id, { ...cur, htmlVersion: cur.htmlVersion + 1 });
    }
    this.notify();
  };

  setQueue = (q: QueueSnapshot): void => {
    this.queue = q;
    this.notify();
  };

  private makeEmpty(id: string): RunSnapshot {
    return {
      id, state: 'queued',
      startedAt: null, endedAt: null,
      thoughtChars: 0, textChars: 0,
      lastEventType: null, text: '',
      htmlVersion: 0,
      stopReason: null, error: null,
      traces: [],
    };
  }

  /** Test helper. */
  __reset = (): void => {
    this.runs.clear();
    this.html.clear();
    this.queue = { active: null, items: [] };
    this.listeners.clear();
  };
}

export const streamStore = new StreamStore();

export function applyRunEvent(runId: string, event: GrokEvent, raw?: unknown): void {
  const cur = streamStore.getRunSnapshot(runId);
  if (event.type === 'thought') {
    const data = (event as any).data as string;
    streamStore.patchRun(runId, {
      thoughtChars: (cur?.thoughtChars ?? 0) + data.length,
      lastEventType: 'thought',
      state: cur?.state === 'queued' ? 'running' : cur?.state ?? 'running',
    });
  } else if (event.type === 'text') {
    const data = (event as any).data as string;
    const nextText = (cur?.text ?? '') + data;
    streamStore.patchRun(runId, {
      text: nextText,
      textChars: (cur?.textChars ?? 0) + data.length,
      lastEventType: 'text',
      state: cur?.state === 'queued' ? 'running' : cur?.state ?? 'running',
    });
    // Lazy-import to keep the worker out of unit-test bundles (vitest jsdom).
    import('./markdownWorker').then(({ scheduleMarkdownParse }) => {
      scheduleMarkdownParse(runId, nextText);
    }).catch(() => {/* worker unavailable; MessageItem will render raw text */});
  } else if (event.type === 'end') {
    // Also schedule a final parse so the post-stream HTML matches the last text.
    if (cur?.text) {
      import('./markdownWorker').then(({ scheduleMarkdownParse }) => {
        scheduleMarkdownParse(runId, cur.text);
      }).catch(() => {});
    }
    const e = event as Extract<GrokEvent, { type: 'end' }>;
    streamStore.patchRun(runId, {
      state: 'done',
      lastEventType: 'end',
      stopReason: e.stopReason,
      endedAt: Date.now(),
    });
  } else if (raw) {
    // Unknown typed event — try to classify as a trace (tool/subagent/task).
    const result = classifyEvent(raw);
    if (result.kind === 'create') {
      const existing = cur?.traces ?? [];
      // Avoid duplicates if the same key is emitted twice (e.g. updates).
      if (!existing.some((t) => t.key === result.event.key)) {
        streamStore.patchRun(runId, { traces: [...existing, result.event] });
      }
    } else if (result.kind === 'finish') {
      const existing = cur?.traces ?? [];
      const idx = existing.findIndex((t) => t.key === result.key);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = {
          ...updated[idx]!,
          status: result.status,
          endedAt: Date.now(),
          detail: result.detail ?? updated[idx]!.detail,
        };
        streamStore.patchRun(runId, { traces: updated });
      }
    }
  }
  // Unknown events without raw payload: ignore (forward-compat).
}

export function applyStateChange(
  runId: string,
  payload: { state: 'Queued' | 'Running' | 'Done' | 'Cancelled' | 'Failed'; startedAt?: number | null; endedAt?: number | null; error?: string | null }
): void {
  streamStore.patchRun(runId, {
    state: payload.state.toLowerCase() as RunState,
    startedAt: payload.startedAt ?? streamStore.getRunSnapshot(runId)?.startedAt ?? null,
    endedAt: payload.endedAt ?? streamStore.getRunSnapshot(runId)?.endedAt ?? null,
    error: payload.error ?? streamStore.getRunSnapshot(runId)?.error ?? null,
  });
}

export function replaceQueue(q: QueueSnapshot): void {
  streamStore.setQueue(q);
}

/**
 * Counter of pending `enqueue_run` invocations. The Composer increments this
 * before calling invoke() and decrements after the run-id is returned (or
 * the call fails). StatusBar reads it via a hook to render "preparing…" in
 * the gap between Enter and the first run-state-changed event.
 */
let pendingSubmitCount = 0;
const pendingSubmitListeners = new Set<() => void>();

export function getPendingSubmitCount(): number {
  return pendingSubmitCount;
}
export function subscribePendingSubmit(cb: () => void): () => void {
  pendingSubmitListeners.add(cb);
  return () => pendingSubmitListeners.delete(cb);
}
export function notePendingSubmitStart(): void {
  pendingSubmitCount += 1;
  pendingSubmitListeners.forEach((cb) => cb());
}
export function notePendingSubmitEnd(): void {
  pendingSubmitCount = Math.max(0, pendingSubmitCount - 1);
  pendingSubmitListeners.forEach((cb) => cb());
}

let unlistenFns: UnlistenFn[] = [];
let attachInflight: Promise<void> | null = null;
let attachUnavailable = false;

export async function attachTauriListeners(): Promise<void> {
  if (unlistenFns.length > 0 || attachUnavailable) return;
  if (!hasTauriRuntime()) {
    // Running in vite browser preview without the Tauri shell: skip silently.
    attachUnavailable = true;
    return;
  }
  // De-dupe parallel callers and StrictMode double-mounts.
  if (attachInflight) return attachInflight;
  attachInflight = (async () => {
    try {
      const u1 = await listen<{ runId: string; event: GrokEvent; raw?: unknown }>(
        'grok-desktop://run-event',
        (e) => applyRunEvent(e.payload.runId, e.payload.event, e.payload.raw),
      );
      const u2 = await listen<{
        runId: string;
        state: string;
        startedAt?: number;
        endedAt?: number;
        error?: string;
      }>('grok-desktop://run-state-changed', (e) =>
        applyStateChange(e.payload.runId, e.payload as any),
      );
      const u3 = await listen<{ active: string | null; queue: QueuedRunMeta[] }>(
        'grok-desktop://queue-changed',
        (e) => replaceQueue({ active: e.payload.active, items: e.payload.queue }),
      );
      unlistenFns = [u1, u2, u3];
    } catch (err) {
      // First failure latches "unavailable" so we don't keep spamming the console.
      attachUnavailable = true;
      throw err;
    } finally {
      attachInflight = null;
    }
  })();
  return attachInflight;
}

export function detachTauriListeners(): void {
  unlistenFns.forEach((fn) => fn());
  unlistenFns = [];
}
