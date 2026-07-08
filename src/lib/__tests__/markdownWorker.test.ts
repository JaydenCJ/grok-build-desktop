import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Posted {
  runId: string;
  text: string;
}

/**
 * Stand-in for the real markdown.worker.ts Worker: records postMessage
 * payloads and lets tests dispatch 'message' / 'error' events back at the
 * scheduler, so the throttle + self-heal logic runs against a deterministic
 * worker.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: Posted[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(_url: unknown, _opts?: unknown) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  postMessage(data: Posted): void {
    this.posted.push(data);
  }

  emit(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach((cb) => cb(event));
  }

  respond(runId: string, html: string): void {
    this.emit('message', { data: { runId, html } });
  }
}

// markdownWorker keeps module-level state (worker handle, throttle maps), so
// every test gets a fresh module registry. streamStore must come from the
// same registry — a static import would be a DIFFERENT instance than the one
// the freshly imported markdownWorker writes into.
let scheduleMarkdownParse: (runId: string, text: string) => void;
let store: typeof import('../streamStore');

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.useFakeTimers();
  // Anchor the fake clock well past epoch so the very first parse of a run
  // (no throttle stamp → treated as stamp 0) is always "outside the window".
  vi.setSystemTime(1_000_000);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  store = await import('../streamStore');
  ({ scheduleMarkdownParse } = await import('../markdownWorker'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('markdownWorker throttle', () => {
  it('posts the first parse for a run immediately', () => {
    scheduleMarkdownParse('r1', 'hello');
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted).toEqual([{ runId: 'r1', text: 'hello' }]);
  });

  it('parks chunks while a parse is in flight and drains only the newest', () => {
    scheduleMarkdownParse('r1', 'a');
    scheduleMarkdownParse('r1', 'ab');
    scheduleMarkdownParse('r1', 'abc');
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted).toHaveLength(1);

    worker.respond('r1', '<p>a</p>');
    // The response landed in the store…
    expect(store.streamStore.getHtml('r1')).toBe('<p>a</p>');
    // …and exactly one follow-up parse was posted, for the NEWEST text.
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toEqual({ runId: 'r1', text: 'abc' });
  });

  it('defers a chunk inside the throttle window to the trailing edge', () => {
    store.applyStateChange('r1', { state: 'Running' });
    scheduleMarkdownParse('r1', 'a');
    const worker = FakeWorker.instances[0]!;
    worker.respond('r1', '<p>a</p>');

    // 100ms after the last parse: inside the 250ms window → parked, not posted.
    vi.advanceTimersByTime(100);
    scheduleMarkdownParse('r1', 'ab');
    expect(worker.posted).toHaveLength(1);

    // Window closes → the parked text is parsed exactly once.
    vi.advanceTimersByTime(150);
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toEqual({ runId: 'r1', text: 'ab' });
  });

  it('drops the throttle stamp once the run settles with nothing parked', () => {
    store.applyStateChange('r1', { state: 'Running' });
    scheduleMarkdownParse('r1', 'partial');
    const worker = FakeWorker.instances[0]!;

    // The run reaches a terminal state, then its final parse response lands.
    store.applyStateChange('r1', { state: 'Done', endedAt: 123 });
    worker.respond('r1', '<p>partial</p>');

    // A fresh parse for the same run id (e.g. a re-render after eviction)
    // posts immediately — no stale stamp keeps throttling a finished run.
    scheduleMarkdownParse('r1', 'final');
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toEqual({ runId: 'r1', text: 'final' });
  });
});

describe('markdownWorker error self-heal', () => {
  it('recovers with a fresh worker after a crash, without deadlocking inflight runs', () => {
    scheduleMarkdownParse('r1', 'a');
    scheduleMarkdownParse('r1', 'ab'); // parked behind the inflight parse
    const first = FakeWorker.instances[0]!;
    expect(first.posted).toHaveLength(1);

    first.emit('error', new Error('boom'));

    // The next schedule spins up a NEW worker and posts immediately — the
    // crashed parse's inflight/parked bookkeeping must not park it forever.
    scheduleMarkdownParse('r1', 'abc');
    expect(FakeWorker.instances).toHaveLength(2);
    const second = FakeWorker.instances[1]!;
    expect(second.posted).toEqual([{ runId: 'r1', text: 'abc' }]);

    // And the new worker's responses flow into the store as usual.
    second.respond('r1', '<p>abc</p>');
    expect(store.streamStore.getHtml('r1')).toBe('<p>abc</p>');
  });

  it('cancels pending trailing-edge flushes when the worker dies', () => {
    store.applyStateChange('r1', { state: 'Running' });
    scheduleMarkdownParse('r1', 'a');
    const first = FakeWorker.instances[0]!;
    first.respond('r1', '<p>a</p>');

    vi.advanceTimersByTime(100);
    scheduleMarkdownParse('r1', 'ab'); // parked with a flush timer
    first.emit('error', new Error('boom'));

    // The parked flush was cleared with the dead worker — advancing time
    // must not resurrect a parse against a worker that no longer exists.
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(first.posted).toHaveLength(1);
  });
});
