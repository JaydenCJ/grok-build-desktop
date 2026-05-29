import { memo } from 'react';
import { useRunHtml, useRunSnapshot } from '../hooks/useRunSnapshot';
import { useSmoothText } from '../hooks/useSmoothText';
import { TraceTimeline } from './TraceTimeline';

interface Props {
  runId: string;
  fallbackText?: string;
}

function MessageItemImpl({ runId, fallbackText }: Props) {
  const snap = useRunSnapshot(runId);
  const html = useRunHtml(runId);
  const smooth = useSmoothText(runId);
  if (!snap) {
    if (fallbackText) return <pre className="message-body">{fallbackText}</pre>;
    return null;
  }

  const ended =
    snap.state === 'done' || snap.state === 'failed' || snap.state === 'cancelled';

  // While the run is streaming, render the typewriter-paced raw text (smooth,
  // Claude-like cadence). Once it settles, swap to the fully-parsed markdown
  // HTML (code blocks, formatting). TraceTimeline (tool/subagent cards) shows
  // above the body in both phases.
  return (
    <>
      <TraceTimeline runId={runId} />
      {ended && html ? (
        <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="message-body streaming-raw">
          {smooth.text || fallbackText || ''}
          {smooth.caretVisible ? <span className="stream-caret">▋</span> : null}
        </pre>
      )}
    </>
  );
}

export const MessageItem = memo(MessageItemImpl);
