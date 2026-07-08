import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Composer } from '../Composer';
import { streamStore, getPendingSubmitCount } from '../../lib/streamStore';

// jsdom provides requestAnimationFrame, but keep the focus-restore rAF
// deterministic regardless of environment quirks.
beforeEach(() => {
  streamStore.__reset();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onEnqueued = vi.fn();
  const onError = vi.fn();
  const utils = render(
    <Composer
      cwd=""
      argsBuilder={() => ['--output-format', 'streaming-json']}
      onEnqueued={onEnqueued}
      onError={onError}
      {...overrides}
    />,
  );
  const textarea = screen.getByPlaceholderText('Ask Grok…') as HTMLTextAreaElement;
  return { ...utils, onEnqueued, onError, textarea };
}

describe('Composer submit', () => {
  it('enqueues the typed prompt with the built args plus -p, then clears the box', async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      if (cmd === 'enqueue_run') return { runId: 'r1', position: 0 };
      return undefined;
    });
    const user = userEvent.setup();
    const { onEnqueued, onError, textarea } = renderComposer({ cwd: '/repo' });

    await user.type(textarea, 'fix the bug');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onEnqueued).toHaveBeenCalledTimes(1));
    expect(onEnqueued).toHaveBeenCalledWith({
      runId: 'r1',
      position: 0,
      prompt: 'fix the bug',
      rawText: 'fix the bug',
    });
    const enqueue = calls.find((c) => c.cmd === 'enqueue_run')!;
    expect(enqueue.payload).toMatchObject({
      prompt: 'fix the bug',
      cwd: '/repo',
      args: ['--output-format', 'streaming-json', '-p', 'fix the bug'],
    });
    expect(textarea.value).toBe('');
    expect(onError).not.toHaveBeenCalled();
    expect(getPendingSubmitCount()).toBe(0);
  });

  it('submits on Enter but inserts a newline on Shift+Enter', async () => {
    mockIPC((cmd) => (cmd === 'enqueue_run' ? { runId: 'r2', position: 0 } : undefined));
    const user = userEvent.setup();
    const { onEnqueued, textarea } = renderComposer();

    await user.type(textarea, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onEnqueued).not.toHaveBeenCalled();
    expect(textarea.value).toBe('line one\n');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(onEnqueued).toHaveBeenCalledTimes(1));
    expect(onEnqueued.mock.calls[0][0].prompt).toBe('line one');
  });

  it('does nothing for a blank prompt', async () => {
    const invokeSpy = vi.fn();
    mockIPC(invokeSpy);
    const user = userEvent.setup();
    const { onEnqueued, textarea } = renderComposer();
    await user.type(textarea, '   ');
    await user.keyboard('{Enter}');
    expect(onEnqueued).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalledWith('enqueue_run', expect.anything());
  });

  it('surfaces an enqueue failure via onError and keeps the prompt for retry', async () => {
    mockIPC((cmd) => {
      if (cmd === 'enqueue_run') throw new Error('backend not ready');
      return undefined;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { onEnqueued, onError, textarea } = renderComposer();

    await user.type(textarea, 'important prompt');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toContain('backend not ready');
    expect(onEnqueued).not.toHaveBeenCalled();
    // The user must be able to retry without retyping.
    expect(textarea.value).toBe('important prompt');
    // The pending-submit counter must unwind even on failure.
    expect(getPendingSubmitCount()).toBe(0);
  });

  it('seeds the initial value once on mount', () => {
    renderComposer({ initialValue: 'restored draft' });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('restored draft');
  });

  it('persists the draft via onTextChange on blur, not on each keystroke', async () => {
    const onTextChange = vi.fn();
    const user = userEvent.setup();
    const { textarea } = renderComposer({ onTextChange });
    await user.type(textarea, 'draft text');
    expect(onTextChange).not.toHaveBeenCalled();
    await user.tab(); // blur
    expect(onTextChange).toHaveBeenCalledWith('draft text');
  });
});
