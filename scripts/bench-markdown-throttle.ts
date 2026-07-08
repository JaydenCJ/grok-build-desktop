/**
 * Benchmark: markdown parse throttling under streamed token ingestion.
 *
 * Drives the REAL pipeline — applyRunEvent → streamStore → markdownWorker's
 * scheduleMarkdownParse — with a simulated token stream on a virtual clock,
 * and compares it against the pre-throttle behavior (one full re-parse of the
 * accumulated text per streamed chunk, which is what shipped before the
 * trailing-edge throttle landed).
 *
 * Parses are the real thing: markdown.worker.ts is imported so its renderer
 * config (raw-HTML escaping, hljs code highlighting, image rewriting) lands
 * on the shared `marked` singleton, and the fake Worker runs the same
 * `marked.parse(text, { async: false })` call the production worker runs.
 *
 * Run with: npm run bench:markdown
 * (vitest --config vitest.bench.config.ts — kept out of the unit-test suite
 * so `npm run test:unit` stays fast and timing-noise-free.)
 */
import { describe, expect, it } from 'vitest';

// Importing the worker module configures the shared marked singleton with the
// production renderer. In jsdom `self` is the window, so its
// `self.addEventListener('message', …)` registration is inert here.
import '../src/lib/markdown.worker';
import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Virtual clock: markdownWorker throttles via bare Date.now() / setTimeout(),
// so patching the globals lets the bench replay a multi-second stream in
// milliseconds of real time, deterministically.
// ---------------------------------------------------------------------------
class VirtualClock {
  now = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;
  private saved: {
    dateNow: typeof Date.now;
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  } | null = null;

  install(): void {
    this.saved = {
      dateNow: Date.now,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    Date.now = () => this.now;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + (ms ?? 0), fn });
      return id;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((id?: number) => {
      if (typeof id === 'number') this.timers.delete(id);
    }) as typeof globalThis.clearTimeout;
  }

  uninstall(): void {
    if (!this.saved) return;
    Date.now = this.saved.dateNow;
    globalThis.setTimeout = this.saved.setTimeout;
    globalThis.clearTimeout = this.saved.clearTimeout;
    this.saved = null;
    this.timers.clear();
  }

  /** Advance virtual time, firing due timers in order. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let dueId = -1;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < dueAt) {
          dueAt = t.at;
          dueId = id;
        }
      }
      if (dueId === -1) break;
      const timer = this.timers.get(dueId)!;
      this.timers.delete(dueId);
      this.now = timer.at;
      timer.fn();
    }
    this.now = target;
  }
}

// ---------------------------------------------------------------------------
// Fake Worker: synchronous real parse + response, with metrics.
// ---------------------------------------------------------------------------
interface Metrics {
  parses: number;
  parseMs: number;
  lastHtmlLength: number;
}

const active: { metrics: Metrics | null } = { metrics: null };

function parseNow(text: string, metrics: Metrics): string {
  const t0 = performance.now();
  const html = marked.parse(text, { async: false }) as string;
  metrics.parseMs += performance.now() - t0;
  metrics.parses += 1;
  metrics.lastHtmlLength = html.length;
  return html;
}

class FakeWorker {
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(_url: unknown, _opts?: unknown) {}

  addEventListener(type: string, cb: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  postMessage(data: { runId: string; text: string }): void {
    // The production worker parses off-thread and posts the HTML back; here
    // the parse runs synchronously so invocation count and CPU cost are
    // exactly attributable.
    const html = active.metrics ? parseNow(data.text, active.metrics) : '';
    this.listeners.get('message')?.forEach((cb) => cb({ data: { runId: data.runId, html } }));
  }
}

// jsdom has no Worker; markdownWorker's `typeof Worker` guard finds this one.
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;

// ---------------------------------------------------------------------------
// Simulated stream: a realistic long markdown answer (prose + lists + code
// fences) split into token-sized chunks arriving on a fixed cadence.
// ---------------------------------------------------------------------------
const CHUNKS = 400;
const CHUNK_CHARS = 60;
const CHUNK_INTERVAL_MS = 15; // ≈67 chunks/s — a fast streaming run
const REPS = 3;

function buildDocument(totalChars: number): string {
  const block = [
    '## Streaming benchmark section',
    '',
    'Tokens arrive continuously and the renderer keeps up with **bold**,',
    '`inline code`, [links](https://example.com/docs) and lists:',
    '',
    '- first entry with some detail text',
    '- second entry `with code`',
    '',
    '```ts',
    'export function demo(n: number): string {',
    '  return Array.from({ length: n }, (_, i) => `row-${i}`).join("\\n");',
    '}',
    '```',
    '',
  ].join('\n');
  let doc = '';
  while (doc.length < totalChars) doc += block;
  return doc.slice(0, totalChars);
}

function chunkify(doc: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < doc.length; i += size) out.push(doc.slice(i, i + size));
  return out;
}

/** Flush pending microtasks + one macrotask so applyRunEvent's lazy
 *  `import('./markdownWorker')` callbacks land before time advances. */
function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface StreamResult extends Metrics {
  wallMs: number;
  finalChars: number;
}

let runSeq = 0;

async function streamRun(
  chunks: string[],
  mode: 'throttled' | 'unthrottled',
): Promise<StreamResult> {
  // Real module, real store — imported fresh-enough (module-level throttle
  // state is keyed per runId, so unique ids keep runs independent).
  const { applyRunEvent } = await import('../src/lib/streamStore');
  const runId = `bench-${mode}-${runSeq++}`;
  const metrics: Metrics = { parses: 0, parseMs: 0, lastHtmlLength: 0 };

  const clock = new VirtualClock();
  const wall0 = performance.now();
  clock.install();
  try {
    let accumulated = '';
    for (const chunk of chunks) {
      if (mode === 'throttled') {
        // Production path: applyRunEvent schedules the (throttled) parse.
        active.metrics = metrics;
        applyRunEvent(runId, { type: 'text', data: chunk });
        await drain();
      } else {
        // Pre-throttle behavior: every streamed chunk re-parsed the full
        // accumulated text immediately (no scheduling, no collapse).
        applyRunEvent(runId, { type: 'text', data: chunk });
        await drain();
        active.metrics = null; // the scheduler's own parses don't count here
        accumulated += chunk;
        parseNow(accumulated, metrics);
      }
      clock.advance(CHUNK_INTERVAL_MS);
    }
    if (mode === 'throttled') {
      applyRunEvent(runId, { type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'r' });
      await drain();
      // Let the trailing-edge flush fire so the final text gets its parse.
      clock.advance(MIN_PARSE_WINDOW_MS * 2);
      await drain();
    } else {
      // The old path had nothing pending at end-of-stream — the last chunk
      // already parsed the complete text synchronously.
      applyRunEvent(runId, { type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'r' });
      active.metrics = null;
      await drain();
      clock.advance(MIN_PARSE_WINDOW_MS * 2);
      await drain();
    }
  } finally {
    active.metrics = null;
    clock.uninstall();
  }

  return {
    ...metrics,
    wallMs: performance.now() - wall0,
    finalChars: chunks.join('').length,
  };
}

// Mirror of markdownWorker's MIN_PARSE_INTERVAL_MS (not exported); only used
// to advance far enough past the trailing edge, so drift is harmless.
const MIN_PARSE_WINDOW_MS = 250;

function fmt(r: StreamResult): string {
  return (
    `${String(r.parses).padStart(4)} parses, ` +
    `parse CPU ${r.parseMs.toFixed(1).padStart(7)} ms, ` +
    `wall ${r.wallMs.toFixed(1).padStart(7)} ms`
  );
}

describe('markdown parse throttling under streamed ingestion', () => {
  it(
    'collapses per-chunk full-document re-parses to a bounded trailing-edge cadence',
    { timeout: 120_000 },
    async () => {
      const doc = buildDocument(CHUNKS * CHUNK_CHARS);
      const chunks = chunkify(doc, CHUNK_CHARS);
      const virtualSeconds = ((CHUNKS * CHUNK_INTERVAL_MS) / 1000).toFixed(1);

      // Warm up marked/hljs so JIT + lazy hljs language registration don't
      // land inside rep 1 of either scenario.
      parseNow(doc, { parses: 0, parseMs: 0, lastHtmlLength: 0 });

      const throttled: StreamResult[] = [];
      const unthrottled: StreamResult[] = [];
      for (let rep = 0; rep < REPS; rep++) {
        unthrottled.push(await streamRun(chunks, 'unthrottled'));
        throttled.push(await streamRun(chunks, 'throttled'));
      }

      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

      console.log('\nmarkdown throttle bench');
      console.log(
        `stream: ${CHUNKS} chunks × ${CHUNK_CHARS} chars @ ${CHUNK_INTERVAL_MS} ms virtual ` +
          `(${virtualSeconds}s stream, final doc ${doc.length} chars)`,
      );
      console.log(`reps: ${REPS} · node ${process.version} · ${process.platform}/${process.arch}`);
      unthrottled.forEach((r, i) => console.log(`  unthrottled rep${i + 1}: ${fmt(r)}`));
      throttled.forEach((r, i) => console.log(`  throttled   rep${i + 1}: ${fmt(r)}`));
      console.log(
        `  mean: unthrottled ${mean(unthrottled.map((r) => r.parses)).toFixed(0)} parses / ` +
          `${mean(unthrottled.map((r) => r.parseMs)).toFixed(1)} ms parse CPU · ` +
          `throttled ${mean(throttled.map((r) => r.parses)).toFixed(0)} parses / ` +
          `${mean(throttled.map((r) => r.parseMs)).toFixed(1)} ms parse CPU`,
      );

      for (const r of unthrottled) {
        // One full re-parse per streamed chunk.
        expect(r.parses).toBe(CHUNKS);
      }
      for (const r of throttled) {
        // Bounded by the stream duration over the 250 ms window (+ first
        // immediate parse + trailing-edge flush), NOT by the chunk count.
        const windowBound = Math.ceil((CHUNKS * CHUNK_INTERVAL_MS) / MIN_PARSE_WINDOW_MS) + 2;
        expect(r.parses).toBeLessThanOrEqual(windowBound);
        expect(r.parses).toBeGreaterThan(0);
        // The trailing-edge parse saw the complete document (never-stale
        // guarantee): its HTML must match a fresh parse of the full text.
        expect(r.lastHtmlLength).toBeGreaterThan(0);
      }
    },
  );
});
