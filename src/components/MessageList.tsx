import { useEffect, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MessageItem } from './MessageItem';
import { useActiveRun } from '../hooks/useActiveRun';

export interface MessageRef {
  runId: string;
  role: 'user' | 'assistant';
  userText?: string;
  /**
   * Fallback content for assistant messages that have no live streamStore
   * snapshot — typically legacy messages loaded from session_state.json
   * before F shipped (no runId, no per-event events).
   */
  fallbackText?: string;
}

interface Props {
  messages: MessageRef[];
}

export function MessageList({ messages }: Props) {
  const ref = useRef<VirtuosoHandle>(null);
  // Whether the viewport is pinned to the bottom. We only auto-follow
  // streaming text while this is true, so a user who scrolls up to read
  // history is never yanked back down.
  const atBottomRef = useRef(true);
  const prevLenRef = useRef(messages.length);
  const active = useActiveRun();

  const scrollToLast = (smooth = false) => {
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) return;
    ref.current?.scrollToIndex({
      index: lastIndex,
      align: 'end',
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  // A NEW message arrived (user pressed Enter, or the assistant placeholder
  // was appended) → ALWAYS jump to the latest line, even if the user had
  // scrolled up. This is the "send → jump to newest" behavior.
  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      atBottomRef.current = true;
      // rAF so Virtuoso has the new item measured before we scroll.
      requestAnimationFrame(() => scrollToLast(false));
    }
    prevLenRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // The active run is STREAMING — its text/thought/html grows on the same
  // (last) message. Virtuoso's followOutput only fires on new items, not on
  // an item growing, so we pin to the bottom ourselves while at-bottom.
  useEffect(() => {
    if (!active) return;
    if (atBottomRef.current) scrollToLast(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.textChars, active?.thoughtChars, active?.htmlVersion, active?.state]);

  return (
    <Virtuoso
      ref={ref}
      data={messages}
      followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
      atBottomThreshold={140}
      atBottomStateChange={(bottom) => {
        atBottomRef.current = bottom;
      }}
      style={{ height: '100%' }}
      increaseViewportBy={{ top: 200, bottom: 600 }}
      itemContent={(_, msg) => {
        if (msg.role === 'user') {
          return (
            <div className="message message-user">
              <pre className="message-body">{msg.userText}</pre>
            </div>
          );
        }
        return (
          <div className="message message-assistant">
            <MessageItem runId={msg.runId} fallbackText={msg.fallbackText} />
          </div>
        );
      }}
    />
  );
}
