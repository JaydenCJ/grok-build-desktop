import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type WorkerHandler = (event: { data: { runId: string; html: string } }) => void;

/**
 * Minimal stand-in for the browser Worker (jsdom ships none). Captures posted
 * messages and lets tests emit `message` / `error` events back at the module.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static failConstruction = false;
  posted: Array<{ runId: string; text: string }> = [];
  private handlers = new Map<string, WorkerHandler[]>();

  constructor() {
    if (FakeWorker.failConstruction) throw new Error('worker construction refused');
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, cb: WorkerHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }

  postMessage(msg: { runId: string; text: string }): void {
    this.posted.push(msg);
  }

  emit(type: 'message' | 'error', event: unknown): void {
    for (const cb of this.handlers.get(type) ?? []) cb(event as Parameters<WorkerHandler>[0]);
  }
}

// The module keeps a singleton worker plus per-run queues, so every test gets
// a fresh copy via resetModules + dynamic import.
async function loadModule() {
  const [{ scheduleMarkdownParse }, { streamStore }] = await Promise.all([
    import('../markdownWorker'),
    import('../streamStore'),
  ]);
  return { scheduleMarkdownParse, streamStore };
}

beforeEach(() => {
  vi.resetModules();
  FakeWorker.instances = [];
  FakeWorker.failConstruction = false;
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('scheduleMarkdownParse', () => {
  it('spins up one worker and posts the parse request', async () => {
    const { scheduleMarkdownParse } = await loadModule();
    scheduleMarkdownParse('r1', '# hi');
    scheduleMarkdownParse('r2', '## other run');

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]!.posted).toEqual([
      { runId: 'r1', text: '# hi' },
      { runId: 'r2', text: '## other run' },
    ]);
  });

  it('stores worker HTML into the stream store on response', async () => {
    const { scheduleMarkdownParse, streamStore } = await loadModule();
    scheduleMarkdownParse('r1', '# hi');

    FakeWorker.instances[0]!.emit('message', { data: { runId: 'r1', html: '<h1>hi</h1>' } });
    expect(streamStore.getHtml('r1')).toBe('<h1>hi</h1>');
  });

  it('coalesces updates while a parse is in flight and re-posts only the latest', async () => {
    const { scheduleMarkdownParse, streamStore } = await loadModule();
    scheduleMarkdownParse('r1', 'v1');
    scheduleMarkdownParse('r1', 'v2');
    scheduleMarkdownParse('r1', 'v3');

    const w = FakeWorker.instances[0]!;
    expect(w.posted).toEqual([{ runId: 'r1', text: 'v1' }]);

    w.emit('message', { data: { runId: 'r1', html: '<p>v1</p>' } });
    expect(streamStore.getHtml('r1')).toBe('<p>v1</p>');
    expect(w.posted).toEqual([
      { runId: 'r1', text: 'v1' },
      { runId: 'r1', text: 'v3' },
    ]);

    w.emit('message', { data: { runId: 'r1', html: '<p>v3</p>' } });
    expect(streamStore.getHtml('r1')).toBe('<p>v3</p>');
    expect(w.posted).toHaveLength(2);
  });

  it('rebuilds the worker after an error and re-drives stashed texts', async () => {
    const { scheduleMarkdownParse } = await loadModule();
    scheduleMarkdownParse('r1', 'v1');
    scheduleMarkdownParse('r1', 'v2'); // stashed behind the in-flight v1

    FakeWorker.instances[0]!.emit('error', new Event('error'));

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1]!.posted).toEqual([{ runId: 'r1', text: 'v2' }]);

    // The cleared in-flight mark means new requests post immediately again.
    FakeWorker.instances[1]!.emit('message', { data: { runId: 'r1', html: '<p>v2</p>' } });
    scheduleMarkdownParse('r1', 'v3');
    expect(FakeWorker.instances[1]!.posted).toEqual([
      { runId: 'r1', text: 'v2' },
      { runId: 'r1', text: 'v3' },
    ]);
  });

  it('degrades to a no-op when the worker cannot be constructed', async () => {
    FakeWorker.failConstruction = true;
    const { scheduleMarkdownParse, streamStore } = await loadModule();

    expect(() => scheduleMarkdownParse('r1', '# hi')).not.toThrow();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(streamStore.getHtml('r1')).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'failed to construct markdown worker',
      expect.any(Error),
    );
  });

  it('degrades to a no-op when Worker does not exist at all', async () => {
    vi.stubGlobal('Worker', undefined);
    const { scheduleMarkdownParse, streamStore } = await loadModule();

    expect(() => scheduleMarkdownParse('r1', '# hi')).not.toThrow();
    expect(streamStore.getHtml('r1')).toBeUndefined();
  });
});
