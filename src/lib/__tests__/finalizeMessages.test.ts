import { describe, it, expect } from 'vitest';
import { finalizeMessages, type FinalizableMessage } from '../finalizeMessages';
import type { RunSnapshot } from '../streamStore';

function makeSnapshot(overrides: Partial<RunSnapshot>): RunSnapshot {
  return {
    id: 'r1',
    state: 'done',
    startedAt: 1000,
    endedAt: 4500,
    thoughtChars: 0,
    textChars: 0,
    lastEventType: 'end',
    text: 'final answer',
    htmlVersion: 0,
    stopReason: 'EndTurn',
    error: null,
    traces: [],
    ...overrides,
  };
}

function lookup(snapshots: Record<string, RunSnapshot>) {
  return (runId: string) => snapshots[runId];
}

describe('finalizeMessages', () => {
  it('writes final text, done status, and duration back for a done run', () => {
    const messages: FinalizableMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: '', status: 'streaming', runId: 'r1' },
    ];
    const next = finalizeMessages(messages, lookup({ r1: makeSnapshot({}) }));
    expect(next).not.toBe(messages);
    expect(next[1]).toMatchObject({
      content: 'final answer',
      status: 'done',
      meta: { durationMs: 3500 },
    });
    // The user message is untouched.
    expect(next[0]).toBe(messages[0]);
  });

  it('maps failed → error and cancelled → stopped', () => {
    const messages: FinalizableMessage[] = [
      { role: 'assistant', content: '', status: 'streaming', runId: 'rf' },
      { role: 'assistant', content: '', status: 'streaming', runId: 'rc' },
    ];
    const next = finalizeMessages(
      messages,
      lookup({
        rf: makeSnapshot({ id: 'rf', state: 'failed', text: 'partial' }),
        rc: makeSnapshot({ id: 'rc', state: 'cancelled', text: '' }),
      }),
    );
    expect(next[0]?.status).toBe('error');
    expect(next[0]?.content).toBe('partial');
    expect(next[1]?.status).toBe('stopped');
  });

  it('returns the same array reference when nothing changed', () => {
    const messages: FinalizableMessage[] = [
      { role: 'user', content: 'q' },
      // Still running — not terminal yet.
      { role: 'assistant', content: '', status: 'streaming', runId: 'r1' },
      // No runId at all (restored legacy message).
      { role: 'assistant', content: 'old' },
    ];
    const next = finalizeMessages(
      messages,
      lookup({ r1: makeSnapshot({ state: 'running' }) }),
    );
    expect(next).toBe(messages);
  });

  it('skips messages that already carry a terminal status', () => {
    const messages: FinalizableMessage[] = [
      {
        role: 'assistant',
        content: 'already finalized',
        status: 'done',
        runId: 'r1',
        meta: { durationMs: 42 },
      },
    ];
    const next = finalizeMessages(
      messages,
      lookup({ r1: makeSnapshot({ text: 'newer text' }) }),
    );
    expect(next).toBe(messages);
    expect(next[0]?.content).toBe('already finalized');
    expect(next[0]?.meta?.durationMs).toBe(42);
  });

  it('leaves a streaming message alone when its snapshot is missing (evicted)', () => {
    const messages: FinalizableMessage[] = [
      { role: 'assistant', content: '', status: 'streaming', runId: 'gone' },
    ];
    expect(finalizeMessages(messages, lookup({}))).toBe(messages);
  });

  it('keeps a previous durationMs when the snapshot has no timestamps', () => {
    const messages: FinalizableMessage[] = [
      {
        role: 'assistant',
        content: '',
        status: 'streaming',
        runId: 'r1',
        meta: { durationMs: 77, model: 'grok-build' },
      },
    ];
    const next = finalizeMessages(
      messages,
      lookup({ r1: makeSnapshot({ startedAt: null, endedAt: null }) }),
    );
    expect(next[0]?.meta?.durationMs).toBe(77);
    // Other meta fields survive the merge.
    expect(next[0]?.meta?.model).toBe('grok-build');
  });
});
