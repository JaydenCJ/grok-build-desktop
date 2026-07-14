// Behavior tests for the Composer's uncovered surfaces: the imperative
// handle, @-mention insertion (mouse + keyboard, quoted whitespace paths),
// prompt expansion of @mentions into fenced context blocks (readable and
// unreadable files), the IME composition submit guard, caret-driven mention
// refresh, blur dismissal of the picker, and the inflight placeholder/label.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Composer, type ComposerHandle } from '../Composer';
import { streamStore } from '../../lib/streamStore';

beforeEach(() => {
  streamStore.__reset();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

const globEntries = [
  { path: 'src/app.ts', display_name: 'app.ts', size_bytes: 10 },
  { path: 'My Dir/notes.md', display_name: 'notes.md', size_bytes: 20 },
];

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onEnqueued = vi.fn();
  const onError = vi.fn();
  const handle = createRef<ComposerHandle>();
  const utils = render(
    <Composer
      ref={handle}
      cwd="/repo"
      argsBuilder={() => ['--output-format', 'streaming-json']}
      onEnqueued={onEnqueued}
      onError={onError}
      {...overrides}
    />,
  );
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { ...utils, onEnqueued, onError, handle, textarea };
}

describe('Composer imperative handle', () => {
  it('exposes setValue / getValue / focus on the forwarded ref', () => {
    mockIPC(() => undefined);
    const { handle, textarea } = renderComposer();

    expect(handle.current).not.toBeNull();
    act(() => handle.current!.setValue('seeded from history'));
    expect(textarea.value).toBe('seeded from history');
    expect(handle.current!.getValue()).toBe('seeded from history');

    expect(textarea).not.toHaveFocus();
    act(() => handle.current!.focus());
    expect(textarea).toHaveFocus();
  });

  it('persists the in-flight draft through onTextChange on unmount', () => {
    mockIPC(() => undefined);
    const onTextChange = vi.fn();
    const { handle, unmount } = renderComposer({ onTextChange });
    act(() => handle.current!.setValue('draft to keep'));
    unmount();
    expect(onTextChange).toHaveBeenCalledWith('draft to keep');
  });

  it('does not call onTextChange on unmount when the box is empty', () => {
    mockIPC(() => undefined);
    const onTextChange = vi.fn();
    const { unmount } = renderComposer({ onTextChange });
    unmount();
    expect(onTextChange).not.toHaveBeenCalled();
  });
});

describe('Composer @-mention insertion', () => {
  it('Enter while the picker is open inserts the highlighted path instead of submitting', async () => {
    const enqueue = vi.fn();
    mockIPC((cmd) => {
      if (cmd === 'glob_files') return globEntries;
      if (cmd === 'enqueue_run') {
        enqueue();
        return { runId: 'r1', position: 0 };
      }
      return undefined;
    });
    const user = userEvent.setup();
    const { onEnqueued, textarea } = renderComposer();

    await user.type(textarea, '@app');
    expect(await screen.findByText('app.ts')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(textarea.value).toBe('@src/app.ts '));
    // Nothing was submitted — the picker owned the Enter.
    expect(enqueue).not.toHaveBeenCalled();
    expect(onEnqueued).not.toHaveBeenCalled();
    // Picker is dismissed and the caret sits after the inserted mention.
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(textarea.selectionStart).toBe('@src/app.ts '.length);
  });

  it('quotes paths containing whitespace when inserted via mousedown', async () => {
    mockIPC((cmd) => (cmd === 'glob_files' ? globEntries : undefined));
    const user = userEvent.setup();
    const { textarea } = renderComposer();

    await user.type(textarea, '@notes');
    const row = await screen.findByText('notes.md');
    fireEvent.mouseDown(row);

    await waitFor(() => expect(textarea.value).toBe('@"My Dir/notes.md" '));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the picker when caret movement (Home) leaves the @token', async () => {
    mockIPC((cmd) => (cmd === 'glob_files' ? globEntries : undefined));
    const user = userEvent.setup();
    const { textarea } = renderComposer();

    await user.type(textarea, '@app');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    // Move the caret to position 0 — no longer inside an unfinished mention.
    textarea.setSelectionRange(0, 0);
    fireEvent.keyUp(textarea, { key: 'Home' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('closes the picker shortly after the textarea blurs', async () => {
    mockIPC((cmd) => (cmd === 'glob_files' ? globEntries : undefined));
    const user = userEvent.setup();
    const { textarea } = renderComposer();

    await user.type(textarea, '@app');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    fireEvent.blur(textarea);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});

describe('Composer mention expansion on submit', () => {
  it('appends referenced file contents as fenced blocks and flags unreadable files', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    mockIPC((cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      if (cmd === 'read_file_safe') {
        return args.path === 'src/app.ts' ? 'const x = 1;' : null;
      }
      if (cmd === 'enqueue_run') {
        payloads.push(args);
        return { runId: 'r-expanded', position: 0 };
      }
      return undefined;
    });
    const user = userEvent.setup();
    const { onEnqueued, handle } = renderComposer();

    const raw = 'explain @src/app.ts and @Makefile please';
    act(() => handle.current!.setValue(raw));
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onEnqueued).toHaveBeenCalledTimes(1));
    const { prompt, rawText } = onEnqueued.mock.calls[0][0];
    expect(rawText).toBe(raw);
    // The original prompt stays verbatim at the top…
    expect(prompt.startsWith(raw)).toBe(true);
    // …with a context section listing each mention.
    expect(prompt).toContain('Referenced files (from @ mentions):');
    expect(prompt).toContain('### @src/app.ts\n```ts\nconst x = 1;\n```');
    expect(prompt).toContain('### @Makefile\n_(file unreadable, too large, or binary — skipped)_');
    // The expanded prompt is what actually gets enqueued (and passed via -p).
    expect(payloads[0].prompt).toBe(prompt);
    expect((payloads[0].args as string[]).slice(-2)).toEqual(['-p', prompt]);
  });

  it('skips expansion entirely when no cwd is set', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const readSpy = vi.fn();
    mockIPC((cmd, payload) => {
      if (cmd === 'read_file_safe') {
        readSpy();
        return 'never used';
      }
      if (cmd === 'enqueue_run') {
        payloads.push((payload ?? {}) as Record<string, unknown>);
        return { runId: 'r-plain', position: 0 };
      }
      return undefined;
    });
    const user = userEvent.setup();
    const { onEnqueued, handle } = renderComposer({ cwd: '   ' });

    act(() => handle.current!.setValue('look at @src/app.ts'));
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onEnqueued).toHaveBeenCalledTimes(1));
    expect(onEnqueued.mock.calls[0][0].prompt).toBe('look at @src/app.ts');
    expect(payloads[0].prompt).toBe('look at @src/app.ts');
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe('Composer IME composition guard', () => {
  it('never submits on Enter while a composition is active, then submits after compositionend', async () => {
    const enqueue = vi.fn(() => ({ runId: 'r-ime', position: 0 }));
    mockIPC((cmd) => (cmd === 'enqueue_run' ? enqueue() : undefined));
    const { onEnqueued, textarea } = renderComposer();

    fireEvent.input(textarea, { target: { value: '你好世界' } });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(textarea.value).toBe('你好世界');

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onEnqueued).toHaveBeenCalledTimes(1));
    expect(onEnqueued.mock.calls[0][0].prompt).toBe('你好世界');
  });

  it('treats keyCode 229 as mid-composition even without composition events', () => {
    const enqueue = vi.fn();
    mockIPC((cmd) => (cmd === 'enqueue_run' ? enqueue() : undefined));
    const { textarea } = renderComposer();

    fireEvent.input(textarea, { target: { value: 'かな' } });
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(textarea.value).toBe('かな');
  });
});

describe('Composer inflight affordances', () => {
  it('shows the queue-another placeholder and Enqueue label while work is inflight', () => {
    mockIPC(() => undefined);
    streamStore.setQueue({
      active: null,
      items: [{ id: 'q1', prompt: 'earlier prompt', state: 'Queued', enqueuedAt: Date.now() }],
    });
    renderComposer();
    expect(screen.getByPlaceholderText('Queue another prompt…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enqueue' })).toBeInTheDocument();
  });
});
