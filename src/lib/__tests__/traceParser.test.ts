import { describe, expect, it } from 'vitest';
import { classifyEvent } from '../traceParser';

describe('classifyEvent', () => {
  it('ignores known text/thought/end types', () => {
    expect(classifyEvent({ type: 'thought', data: 'x' }).kind).toBe('ignore');
    expect(classifyEvent({ type: 'text', data: 'x' }).kind).toBe('ignore');
    expect(classifyEvent({ type: 'end', stopReason: 'ok' }).kind).toBe('ignore');
  });

  it('ignores non-object payloads', () => {
    expect(classifyEvent(null).kind).toBe('ignore');
    expect(classifyEvent('string').kind).toBe('ignore');
    expect(classifyEvent(42).kind).toBe('ignore');
    expect(classifyEvent([1, 2, 3]).kind).toBe('ignore');
  });

  it('creates a trace for tool_use events', () => {
    const r = classifyEvent({
      type: 'tool_use',
      id: 'tool_abc',
      name: 'Read',
      input: { file: 'foo.ts' },
    });
    expect(r.kind).toBe('create');
    if (r.kind !== 'create') return;
    expect(r.event.kind).toBe('tool');
    expect(r.event.label).toBe('Read');
    expect(r.event.status).toBe('running');
    expect(r.event.key).toBe('trace:tool_abc');
  });

  it('finishes a trace for tool_result events with matching id', () => {
    const r = classifyEvent({
      type: 'tool_result',
      tool_use_id: 'tool_abc',
      output: 'hello',
    });
    expect(r.kind).toBe('finish');
    if (r.kind !== 'finish') return;
    expect(r.key).toBe('trace:tool_abc');
    expect(r.status).toBe('done');
  });

  it('marks subagent events with kind:subagent', () => {
    const r = classifyEvent({
      type: 'subagent_start',
      id: 'sa_1',
      subagent: 'reviewer',
      input: 'Review this PR',
    });
    expect(r.kind).toBe('create');
    if (r.kind !== 'create') return;
    expect(r.event.kind).toBe('subagent');
    expect(r.event.label).toBe('reviewer');
  });

  it('classifies plan/task events', () => {
    const r = classifyEvent({
      type: 'task_start',
      id: 't_1',
      plan: 'Migrate database',
    });
    expect(r.kind).toBe('create');
    if (r.kind !== 'create') return;
    expect(r.event.kind).toBe('task');
  });

  it('marks error endings', () => {
    const r = classifyEvent({
      type: 'tool_error',
      tool_use_id: 'tool_abc',
      error: 'permission denied',
    });
    expect(r.kind).toBe('finish');
    if (r.kind !== 'finish') return;
    expect(r.status).toBe('error');
    expect(r.detail).toContain('permission denied');
  });

  it('falls back to ignore for unrecognized events', () => {
    // No tool-ish field, no subagent, no task, no start/end suffix.
    expect(classifyEvent({ type: 'random_unknown' }).kind).toBe('ignore');
  });

  it('uses synthetic key when no id field is present', () => {
    const r = classifyEvent({ type: 'tool_use', name: 'Edit' });
    expect(r.kind).toBe('create');
    if (r.kind !== 'create') return;
    expect(r.event.key).toMatch(/^trace:/);
  });

  it('pairs id-less tool_start/tool_end events by name', () => {
    const start = classifyEvent({ type: 'tool_start', name: 'bash' });
    const end = classifyEvent({ type: 'tool_end', name: 'bash' });
    expect(start.kind).toBe('create');
    expect(end.kind).toBe('finish');
    if (start.kind !== 'create' || end.kind !== 'finish') return;
    expect(end.key).toBe(start.event.key);
  });

  it('pairs id-less tool_use/tool_result events by name', () => {
    const start = classifyEvent({ type: 'tool_use', name: 'Read' });
    const end = classifyEvent({ type: 'tool_result', name: 'Read', output: 'ok' });
    expect(start.kind).toBe('create');
    expect(end.kind).toBe('finish');
    if (start.kind !== 'create' || end.kind !== 'finish') return;
    expect(end.key).toBe(start.event.key);
  });
});
