import { useCallback, useEffect, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MessageItem } from './MessageItem';
import { useActiveRun } from '../hooks/useActiveRun';

export interface MessageRef {
  runId: string;
  role: 'user' | 'assistant';
  userText?: string;
  /** Stable message id — used to scroll/flash a specific message when the
   *  user clicks it in the HISTORY sidebar ("return to that task"). */
  id?: string;
  /**
   * Fallback content for assistant messages that have no live streamStore
   * snapshot — typically legacy messages loaded from session_state.json
   * before F shipped (no runId, no per-event events).
   */
  fallbackText?: string;
}

interface Props {
  messages: MessageRef[];
  /** When set (with a fresh nonce), scroll to the message with this id and
   *  flash it. The nonce lets the same id be re-focused on repeated clicks. */
  focusId?: string | null;
  focusNonce?: number;
}

export function MessageList({ messages, focusId, focusNonce }: Props) {
  const ref = useRef<VirtuosoHandle>(null);
  // The message currently flashing after a history-click jump.
  const [flashId, setFlashId] = useState<string | null>(null);
  // Whether the viewport is pinned to the bottom. We only auto-follow
  // streaming text while this is true, so a user who scrolls up to read
  // history is never yanked back down.
  const atBottomRef = useRef(true);
  const prevLenRef = useRef(messages.length);
  const active = useActiveRun();

  const scrollToLast = useCallback(
    (smooth = false) => {
      const lastIndex = messages.length - 1;
      if (lastIndex < 0) return;
      ref.current?.scrollToIndex({
        index: lastIndex,
        align: 'end',
        behavior: smooth ? 'smooth' : 'auto',
      });
    },
    [messages.length],
  );

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

  // The typewriter buffer reveals text AFTER the raw tokens have all arrived,
  // so the message keeps growing between token bursts with no snapshot change
  // to trigger the effect above. While a run is actively running, gently keep
  // the view pinned to the bottom (only if the user is already there).
  useEffect(() => {
    if (active?.state !== 'running') return;
    const id = window.setInterval(() => {
      if (atBottomRef.current) scrollToLast(false);
    }, 180);
    return () => window.clearInterval(id);
  }, [active?.state, scrollToLast]);

  // History-click jump: scroll the requested message into view (centered) and
  // flash it for ~1.3s so the user sees exactly which task they returned to.
  // Virtuoso virtualizes the list, so off-screen messages aren't in the DOM —
  // we must scroll by index, not querySelector. The nonce makes a repeat click
  // on the same message re-trigger this effect.
  useEffect(() => {
    if (!focusId) return;
    const idx = messages.findIndex((m) => m.id === focusId);
    if (idx < 0) return;
    atBottomRef.current = false; // don't fight the jump with bottom-follow
    ref.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' });
    setFlashId(focusId);
    const t = window.setTimeout(() => setFlashId(null), 1300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusNonce]);

  return (
    <Virtuoso
      ref={ref}
      data={messages}
      followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
      atBottomThreshold={140}
      atBottomStateChange={(bottom) => {
        atBottomRef.current = bottom;
      }}
      // No inline style prop for height: Virtuoso's scroller defaults already
      // include height 100% (applied via the CSSOM, so it works under the
      // strict no-'unsafe-inline' style-src), and the codebase stays free of
      // inline-style props (guarded in scripts/smoke_test.mjs).
      increaseViewportBy={{ top: 200, bottom: 600 }}
      itemContent={(_, msg) => {
        const flash = msg.id && msg.id === flashId ? ' message-flash' : '';
        if (msg.role === 'user') {
          return (
            <div className={`message message-user${flash}`} data-message-id={msg.id}>
              <pre className="message-body">{msg.userText}</pre>
            </div>
          );
        }
        return (
          <div className={`message message-assistant${flash}`} data-message-id={msg.id}>
            <MessageItem runId={msg.runId} fallbackText={msg.fallbackText} />
          </div>
        );
      }}
    />
  );
}
