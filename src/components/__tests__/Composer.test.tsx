import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('Composer @-mention combobox semantics', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('is a plain multiline textbox while no mention is active', () => {
    mockIPC(() => undefined);
    const { textarea } = renderComposer({ cwd: '/repo' });
    expect(textarea).not.toHaveAttribute('role');
    expect(textarea).not.toHaveAttribute('aria-expanded');
    expect(textarea).not.toHaveAttribute('aria-controls');
    expect(textarea).not.toHaveAttribute('aria-activedescendant');
  });

  it('becomes an expanded combobox over the file listbox while the picker is open', async () => {
    mockIPC((cmd) =>
      cmd === 'glob_files'
        ? [
            { path: 'src/a.ts', display_name: 'a.ts', size_bytes: 10 },
            { path: 'src/b.ts', display_name: 'b.ts', size_bytes: 20 },
          ]
        : undefined,
    );
    const user = userEvent.setup();
    const { textarea } = renderComposer({ cwd: '/repo' });

    await user.type(textarea, '@src');
    expect(await screen.findByText('a.ts')).toBeInTheDocument();

    const listbox = screen.getByRole('listbox');
    expect(textarea).toHaveAttribute('role', 'combobox');
    expect(textarea).toHaveAttribute('aria-expanded', 'true');
    expect(textarea).toHaveAttribute('aria-autocomplete', 'list');
    expect(textarea).toHaveAttribute('aria-controls', listbox.id);
    // The active descendant points at the highlighted option id…
    const options = screen.getAllByRole('option');
    await waitFor(() => expect(textarea).toHaveAttribute('aria-activedescendant', options[0]!.id));
    // …and tracks arrow-key navigation.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(textarea).toHaveAttribute('aria-activedescendant', options[1]!.id));

    // Dismissing the picker returns the textarea to a plain textbox.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(textarea).not.toHaveAttribute('role');
    expect(textarea).not.toHaveAttribute('aria-activedescendant');
  });
});
