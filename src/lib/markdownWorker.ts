import { streamStore } from './streamStore';

interface ParseResponse {
  runId: string;
  html: string;
}

let worker: Worker | null = null;
const latestByRun = new Map<string, string>();
const inflight = new Set<string>();
// Trailing-edge throttle bookkeeping. Every streamed text chunk used to
// trigger a full re-parse of the run's ENTIRE accumulated text (O(n²) work
// over a stream), even though the streaming view renders raw typewriter text
// and only uses the parsed HTML once the run settles. Mid-stream parses now
// collapse to at most ~4/second; the newest text is always parsed at the
// trailing edge, so the final HTML is never stale (this also covers runs
// that end via cancel/fail without an explicit final parse request).
const MIN_PARSE_INTERVAL_MS = 250;
const lastParseAt = new Map<string, number>();
const parseTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        parseTimers.forEach((t) => clearTimeout(t));
        parseTimers.clear();
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
  lastParseAt.set(runId, Date.now());
  w.postMessage({ runId, text });
}

/** Parse the newest parked text for a run once its throttle window closes. */
function flushParked(runId: string): void {
  parseTimers.delete(runId);
  if (inflight.has(runId)) return; // the message handler drains latestByRun
  const text = latestByRun.get(runId);
  if (text === undefined) return;
  latestByRun.delete(runId);
  postParse(runId, text);
}

export function scheduleMarkdownParse(runId: string, text: string): void {
  if (inflight.has(runId)) {
    latestByRun.set(runId, text);
    return;
  }
  const elapsed = Date.now() - (lastParseAt.get(runId) ?? 0);
  if (elapsed < MIN_PARSE_INTERVAL_MS) {
    latestByRun.set(runId, text);
    if (!parseTimers.has(runId)) {
      parseTimers.set(
        runId,
        setTimeout(() => flushParked(runId), MIN_PARSE_INTERVAL_MS - elapsed),
      );
    }
    return;
  }
  postParse(runId, text);
}
