import { memo } from 'react';
import { useRunHtml, useRunSnapshot } from '../hooks/useRunSnapshot';

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

  if (html) {
    return <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className="message-body streaming-raw">{snap.text || fallbackText || ''}</pre>;
}

export const MessageItem = memo(MessageItemImpl);
