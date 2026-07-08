import { streamStore } from './streamStore';

interface ParseResponse {
  runId: string;
  html: string;
}

let worker: Worker | null = null;
const latestByRun = new Map<string, string>();
const inflight = new Set<string>();

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (e: MessageEvent<ParseResponse>) => {
        const { runId, html } = e.data;
        streamStore.setHtml(runId, html);
        inflight.delete(runId);
        if (latestByRun.has(runId)) {
          const next = latestByRun.get(runId)!;
          latestByRun.delete(runId);
          postParse(runId, next);
        }
      });
      worker.addEventListener('error', (err) => {
        console.warn('markdown.worker error, disabling worker fast path', err);
        worker = null;
        // Drop the bookkeeping for the dead worker. Without this, any run
        // whose parse was in flight stayed in `inflight` forever, so every
        // later scheduleMarkdownParse for it parked in `latestByRun` and was
        // never posted — markdown rendering for that run deadlocked even
        // after a fresh worker spun up.
        inflight.clear();
        latestByRun.clear();
      });
    } catch (err) {
      console.warn('failed to construct markdown worker', err);
      worker = null;
    }
  }
  return worker;
}

function postParse(runId: string, text: string): void {
  const w = ensureWorker();
  if (!w) return; // Worker unavailable; MessageItem renders raw text fallback.
  inflight.add(runId);
  w.postMessage({ runId, text });
}

export function scheduleMarkdownParse(runId: string, text: string): void {
  if (inflight.has(runId)) {
    latestByRun.set(runId, text);
    return;
  }
  postParse(runId, text);
}
