import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TraceTimeline } from '../TraceTimeline';
import { streamStore } from '../../lib/streamStore';
import type { TraceEvent } from '../../lib/traceParser';

beforeEach(() => {
  streamStore.__reset();
});

function makeTrace(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    key: 'tool:1',
    kind: 'tool',
    label: 'Read',
    status: 'running',
    startedAt: 1_000,
    endedAt: null,
    ...overrides,
  };
}

function seed(traces: TraceEvent[], runId = 'r1') {
  streamStore.patchRun(runId, { traces });
}

describe('TraceTimeline', () => {
  it('renders nothing for a run without traces', () => {
    const { container } = render(<TraceTimeline runId="r-empty" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a running tool card with a pulse instead of a duration', () => {
    seed([makeTrace()]);
    render(<TraceTimeline runId="r1" />);

    expect(screen.getByLabelText('Tool and subagent activity')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('⚙')).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('shows kind-specific icons for running subagents and tasks', () => {
    seed([
      makeTrace({ key: 'sub:1', kind: 'subagent', label: 'explorer' }),
      makeTrace({ key: 'task:1', kind: 'task', label: 'lint' }),
    ]);
    render(<TraceTimeline runId="r1" />);
    expect(screen.getByText('⤳')).toBeInTheDocument();
    expect(screen.getByText('◐')).toBeInTheDocument();
  });

  it('formats sub-second, second, and minute durations on finished cards', () => {
    seed([
      makeTrace({ key: 'a', status: 'done', startedAt: 0, endedAt: 500 }),
      makeTrace({ key: 'b', status: 'done', startedAt: 0, endedAt: 1_500 }),
      makeTrace({ key: 'c', status: 'done', startedAt: 0, endedAt: 125_000 }),
    ]);
    render(<TraceTimeline runId="r1" />);

    expect(screen.getByText('500ms')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
    expect(screen.getByText('2m05s')).toBeInTheDocument();
    expect(screen.getAllByText('✓')).toHaveLength(3);
  });

  it('marks failed traces with an error icon regardless of kind', () => {
    seed([makeTrace({ kind: 'subagent', status: 'error', endedAt: 2_000 })]);
    render(<TraceTimeline runId="r1" />);
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  it('renders the detail snippet when present', () => {
    seed([makeTrace({ detail: 'src/lib/files.ts' })]);
    render(<TraceTimeline runId="r1" />);
    expect(screen.getByText('src/lib/files.ts')).toBeInTheDocument();
  });

  it('toggles the raw event JSON when the card head is clicked', async () => {
    seed([makeTrace({ raw: { tool: 'Read', input: { path: 'a.ts' } } })]);
    const user = userEvent.setup();
    render(<TraceTimeline runId="r1" />);

    const head = screen.getByRole('button');
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/"tool": "Read"/)).not.toBeInTheDocument();

    await user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/"tool": "Read"/)).toBeInTheDocument();

    await user.click(head);
    expect(screen.queryByText(/"tool": "Read"/)).not.toBeInTheDocument();
  });

  it('keeps the head expandable but hides raw JSON when the trace has none', async () => {
    seed([makeTrace()]);
    const user = userEvent.setup();
    const { container } = render(<TraceTimeline runId="r1" />);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('pre.trace-raw')).toBeNull();
  });
});
