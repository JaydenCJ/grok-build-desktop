import { memo, useEffect } from 'react';
import { useRunHtml, useRunSnapshot } from '../hooks/useRunSnapshot';
import { useSmoothText } from '../hooks/useSmoothText';
import { scheduleMarkdownParse } from '../lib/markdownWorker';
import { TraceTimeline } from './TraceTimeline';

interface Props {
  runId: string;
  fallbackText?: string;
}

function MessageItemImpl({ runId, fallbackText }: Props) {
  const snap = useRunSnapshot(runId);
  const html = useRunHtml(runId);
  const smooth = useSmoothText(runId);

  // Restored/legacy assistant messages (loaded from storage after a restart)
  // have stored text but no live run snapshot. Render them through the SAME
  // off-thread markdown worker so code blocks and formatting survive a restart
  // instead of showing raw ``` text. Falls back to plain text if the worker is
  // unavailable. Keyed by the message's stable synthetic runId (msg:<id>).
  useEffect(() => {
    if (!snap && runId && fallbackText && html === undefined) {
      scheduleMarkdownParse(runId, fallbackText);
    }
  }, [snap, runId, fallbackText, html]);

  if (!snap) {
    if (html) {
      return <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />;
    }
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
