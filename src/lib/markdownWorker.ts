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
        // The dead worker will never pump the queues: clear the in-flight
        // marks (otherwise those runIds are stuck raw forever) and re-drive
        // any stashed texts through a fresh worker. postParse returns
        // harmlessly if construction keeps failing.
        inflight.clear();
        const pending = Array.from(latestByRun.entries());
        latestByRun.clear();
        for (const [id, text] of pending) postParse(id, text);
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
