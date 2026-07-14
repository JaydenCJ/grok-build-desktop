// Behavior tests for MessageList's scroll orchestration: jump-to-newest on
// append, streaming bottom-follow (only while the user is at the bottom),
// the 180ms typewriter pin while a run is active, and the history-click
// focus/flash jump. Virtuoso is replaced with a stub that records
// scrollToIndex calls and exposes the props MessageList wires up, so every
// assertion targets MessageList's own logic rather than layout in jsdom.
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList, type MessageRef } from '../MessageList';

interface VirtuosoStubProps {
  data: MessageRef[];
  itemContent: (index: number, item: MessageRef) => React.ReactNode;
  followOutput: (isAtBottom: boolean) => 'auto' | false;
  atBottomStateChange: (bottom: boolean) => void;
}

const ctl = vi.hoisted(() => ({
  scrollCalls: [] as Array<{ index: number; align?: string; behavior?: string }>,
  lastProps: null as unknown,
  active: undefined as Record<string, unknown> | undefined,
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  const Virtuoso = React.forwardRef(function VirtuosoStub(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    ctl.lastProps = props;
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: (opts: { index: number; align?: string; behavior?: string }) => {
        ctl.scrollCalls.push(opts);
      },
    }));
    const data = props.data as MessageRef[];
    const itemContent = props.itemContent as (i: number, item: MessageRef) => React.ReactNode;
    return React.createElement(
      'div',
      { 'data-testid': 'virtuoso' },
      data.map((d, i) => React.createElement('div', { key: i }, itemContent(i, d))),
    );
  });
  return { Virtuoso };
});

vi.mock('../MessageItem', async () => {
  const React = await import('react');
  return {
    MessageItem: (props: { runId: string; fallbackText?: string }) =>
      React.createElement(
        'div',
        { 'data-testid': 'assistant-item' },
        `${props.runId}|${props.fallbackText ?? ''}`,
      ),
  };
});

vi.mock('../../hooks/useActiveRun', () => ({
  useActiveRun: () => ctl.active,
}));

const props = () => ctl.lastProps as VirtuosoStubProps;

const user = (id: string, text: string): MessageRef => ({
  runId: `run-${id}`,
  role: 'user',
  userText: text,
  id,
});
const assistant = (id: string, runId: string, fallbackText?: string): MessageRef => ({
  runId,
  role: 'assistant',
  id,
  fallbackText,
});

const running = (over: Record<string, unknown> = {}) => ({
  state: 'running',
  textChars: 1,
  thoughtChars: 0,
  htmlVersion: 0,
  ...over,
});

const sleep = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(() => {
  ctl.scrollCalls.length = 0;
  ctl.lastProps = null;
  ctl.active = undefined;
});

describe('MessageList', () => {
  it('renders user prompts as <pre> bubbles and assistant rows through MessageItem', () => {
    render(
      <MessageList
        messages={[user('m1', 'hello world'), assistant('m2', 'run-9', 'legacy text')]}
      />,
    );

    const userBody = screen.getByText('hello world');
    expect(userBody).toHaveClass('message-body');
    expect(userBody.closest('.message')).toHaveClass('message-user');
    expect(userBody.closest('.message')).toHaveAttribute('data-message-id', 'm1');

    const assistantItem = screen.getByTestId('assistant-item');
    expect(assistantItem).toHaveTextContent('run-9|legacy text');
    expect(assistantItem.closest('.message')).toHaveClass('message-assistant');

    // followOutput auto-follows only while the viewport is at the bottom.
    expect(props().followOutput(true)).toBe('auto');
    expect(props().followOutput(false)).toBe(false);
  });

  it('jumps to the newest message on append, even after the user scrolled up', async () => {
    const first = [user('m1', 'one')];
    const view = render(<MessageList messages={first} />);
    await sleep(30); // let mount rAFs drain
    expect(ctl.scrollCalls).toHaveLength(0); // no jump without a NEW message

    // User scrolls up to read history…
    act(() => props().atBottomStateChange(false));
    // …then a new message arrives: always jump to the latest line.
    view.rerender(<MessageList messages={[...first, assistant('m2', 'run-2')]} />);
    await waitFor(() =>
      expect(ctl.scrollCalls).toContainEqual({ index: 1, align: 'end', behavior: 'auto' }),
    );
  });

  it('follows streaming growth only while pinned to the bottom, resuming via the run interval', async () => {
    ctl.active = running({ textChars: 5 });
    const messages = [user('m1', 'go'), assistant('m2', 'run-1')];
    const view = render(<MessageList messages={messages} />);

    // Mount + at-bottom: streamed growth keeps the last line in view.
    expect(ctl.scrollCalls).toContainEqual({ index: 1, align: 'end', behavior: 'auto' });

    // The user scrolls up: further growth must NOT yank them back down.
    act(() => props().atBottomStateChange(false));
    ctl.scrollCalls.length = 0;
    ctl.active = running({ textChars: 25 });
    view.rerender(<MessageList messages={messages} />);
    await sleep(250); // spans an interval tick (180ms) too
    expect(ctl.scrollCalls).toHaveLength(0);

    // Back at the bottom: the 180ms pin interval resumes following.
    act(() => props().atBottomStateChange(true));
    await waitFor(() => expect(ctl.scrollCalls.length).toBeGreaterThan(0), { timeout: 1500 });
    expect(ctl.scrollCalls[0]).toEqual({ index: 1, align: 'end', behavior: 'auto' });
  });

  it('does nothing while a run streams into an empty conversation', async () => {
    ctl.active = running();
    render(<MessageList messages={[]} />);
    await sleep(250);
    expect(ctl.scrollCalls).toHaveLength(0);
    expect(screen.getByTestId('virtuoso')).toBeEmptyDOMElement();
  });

  it('scrolls to and flashes a message on history-click, re-triggering per nonce', async () => {
    const messages = [user('m1', 'first'), assistant('m2', 'run-1', 'answer')];
    const view = render(<MessageList messages={messages} focusId="m2" focusNonce={1} />);

    expect(ctl.scrollCalls).toContainEqual({ index: 1, align: 'center', behavior: 'smooth' });
    const row = () => document.querySelector('[data-message-id="m2"]') as HTMLElement;
    expect(row()).toHaveClass('message-flash');

    // The flash clears after ~1.3s.
    await waitFor(() => expect(row()).not.toHaveClass('message-flash'), { timeout: 2500 });

    // A repeat click on the same message (new nonce) flashes again.
    ctl.scrollCalls.length = 0;
    view.rerender(<MessageList messages={messages} focusId="m2" focusNonce={2} />);
    expect(ctl.scrollCalls).toContainEqual({ index: 1, align: 'center', behavior: 'smooth' });
    expect(row()).toHaveClass('message-flash');
  });

  it('ignores a focus request for a message id that is not in the list', async () => {
    render(<MessageList messages={[user('m1', 'only')]} focusId="missing" focusNonce={1} />);
    await sleep(30);
    expect(ctl.scrollCalls).toHaveLength(0);
    expect(document.querySelector('.message-flash')).toBeNull();
  });
});
