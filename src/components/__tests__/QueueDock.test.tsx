import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { QueueDock } from '../QueueDock';
import { streamStore } from '../../lib/streamStore';

beforeEach(() => {
  streamStore.__reset();
});

function queueItem(id: string, prompt: string, state = 'Queued') {
  return { id, prompt, cwd: '/repo', state, enqueuedAt: 1 };
}

describe('QueueDock', () => {
  it('renders nothing when there is nothing to manage', async () => {
    mockIPC((cmd) => (cmd === 'get_queue' ? { active: null, queue: [] } : undefined));
    const { container } = render(<QueueDock />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('offers to resume orphaned queued runs from the last session', async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === 'get_queue') {
        return { active: null, queue: [queueItem('q1', 'first task'), queueItem('q2', 'second task')] };
      }
      if (cmd === 'resume_pending_runs') return 2;
      return undefined;
    });
    const user = userEvent.setup();
    render(<QueueDock />);

    const banner = await screen.findByText(/Last session had 2 pending tasks/);
    expect(banner).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume all' }));
    await waitFor(() => expect(calls).toContain('resume_pending_runs'));
    expect(screen.queryByText(/Last session had/)).not.toBeInTheDocument();
  });

  it('cancels all pending runs from the banner', async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === 'get_queue') return { active: null, queue: [queueItem('q1', 'only task')] };
      if (cmd === 'cancel_pending_runs') return 1;
      return undefined;
    });
    const user = userEvent.setup();
    render(<QueueDock />);
    await screen.findByText(/Last session had 1 pending task\b/);
    await user.click(screen.getByRole('button', { name: 'Cancel all' }));
    await waitFor(() => expect(calls).toContain('cancel_pending_runs'));
    expect(screen.queryByText(/Last session had/)).not.toBeInTheDocument();
  });

  it('expands to list queued prompts and cancels a single item', async () => {
    const cancelled: unknown[] = [];
    mockIPC((cmd, payload) => {
      // A run is active with one task queued behind it — no resume banner.
      if (cmd === 'get_queue') {
        return { active: 'r-active', queue: [queueItem('q9', 'refactor the parser')] };
      }
      if (cmd === 'cancel_run') {
        cancelled.push(payload);
        return true;
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<QueueDock />);

    const summary = await screen.findByRole('button', { name: /expand/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('+ 1 queued')).toBeInTheDocument();

    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('refactor the parser')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel this queued run' }));
    await waitFor(() => expect(cancelled).toEqual([{ runId: 'q9' }]));
  });
});
