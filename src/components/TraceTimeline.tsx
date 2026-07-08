import { useState } from 'react';
import { useTraces } from '../hooks/useTraces';
import type { TraceEvent, TraceKind, TraceStatus } from '../lib/traceParser';
import { t } from '../i18n';

interface Props {
  runId: string;
}

/**
 * Renders the tool / subagent / task trace cards for one run. Sits inside
 * MessageItem, between the thought line and the assistant text. Each card
 * shows the tool name, status, and a one-line detail snippet; click to
 * expand the raw event for the dev drawer.
 *
 * Renders nothing if the run has no traces (most chat-only runs).
 */
export function TraceTimeline({ runId }: Props) {
  const traces = useTraces(runId);
  if (traces.length === 0) return null;
  return (
    <div className="trace-timeline" aria-label={t('message.traceAriaLabel')}>
      {traces.map((t) => (
        <TraceCard key={t.key} trace={t} />
      ))}
    </div>
  );
}

function TraceCard({ trace }: { trace: TraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const duration = trace.endedAt
    ? formatDuration(trace.endedAt - trace.startedAt)
    : null;
  return (
    <div className={`trace-card trace-${trace.kind} trace-status-${trace.status}`}>
      <button
        type="button"
        className="trace-card-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="trace-icon" aria-hidden>
          {iconFor(trace.kind, trace.status)}
        </span>
        <span className="trace-label">{trace.label}</span>
        <span className="trace-meta">
          {trace.status === 'running' ? (
            <span className="trace-pulse">…</span>
          ) : (
            duration
          )}
        </span>
      </button>
      {trace.detail ? <div className="trace-detail">{trace.detail}</div> : null}
      {expanded && trace.raw ? (
        <pre className="trace-raw">{JSON.stringify(trace.raw, null, 2)}</pre>
      ) : null}
    </div>
  );
}

function iconFor(kind: TraceKind, status: TraceStatus): string {
  if (status === 'error') return '✗';
  if (status === 'done') return '✓';
  // running
  if (kind === 'subagent') return '⤳';
  if (kind === 'task') return '◐';
  return '⚙';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}
