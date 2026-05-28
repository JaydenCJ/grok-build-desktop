import { memo } from 'react';
import { useRunHtml, useRunSnapshot } from '../hooks/useRunSnapshot';
import { TraceTimeline } from './TraceTimeline';

interface Props {
  runId: string;
  fallbackText?: string;
}

function MessageItemImpl({ runId, fallbackText }: Props) {
  const snap = useRunSnapshot(runId);
  const html = useRunHtml(runId);
  if (!snap) {
    if (fallbackText) return <pre className="message-body">{fallbackText}</pre>;
    return null;
  }

  // TraceTimeline is rendered above the body so the user sees subagent / tool
  // activity while the model is still streaming text. It renders nothing if
  // the run has no traces (e.g. a pure chat reply with no tool use).
  return (
    <>
      <TraceTimeline runId={runId} />
      {html ? (
        <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="message-body streaming-raw">{snap.text || fallbackText || ''}</pre>
      )}
    </>
  );
}

export const MessageItem = memo(MessageItemImpl);
