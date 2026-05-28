import { useState } from 'react';
import { useActiveRun } from '../hooks/useActiveRun';
import { useQueue } from '../hooks/useQueue';

interface Props {
  /**
   * Called when the user submits a guidance message while a run is in
   * flight. The host (App.tsx) decides what to do with it — typically
   * enqueueing it as the next run with `--continue` so the new run picks
   * up the previous session's full context.
   */
  onSubmit: (guidance: string) => void;
  /**
   * Optional initial text (e.g. a draft the user started earlier).
   */
  initialValue?: string;
}

/**
 * Codex-style "guide while it runs" banner. Renders ONLY while a run is
 * actively streaming. The user can type a short follow-up instruction —
 * "actually, focus on the SQL query" or "skip the long-form explanation"
 * — and submit it. The host enqueues it as the next run with --continue,
 * so the model picks up where the current run left off and integrates the
 * guidance.
 */
export function GuideBanner({ onSubmit, initialValue }: Props) {
  const active = useActiveRun();
  const queue = useQueue();
  const [draft, setDraft] = useState(initialValue ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Hide entirely when nothing is running or queued.
  const inflight =
    Boolean(active && (active.state === 'running' || active.state === 'queued')) ||
    queue.items.length > 0;
  if (!inflight) return null;

  const submit = async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await Promise.resolve(onSubmit(text));
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  const queuedExtra = queue.items.length;

  return (
    <div className="guide-banner" role="region" aria-label="Guide current run">
      <div className="guide-banner-head">
        <span className="guide-banner-icon" aria-hidden>
          ✦
        </span>
        <span className="guide-banner-title">
          Guide the current run
          {queuedExtra > 0 ? <span className="guide-banner-meta"> · {queuedExtra} queued ahead</span> : null}
        </span>
      </div>
      <div className="guide-banner-row">
        <textarea
          className="guide-banner-input"
          placeholder="Steer the model mid-run — e.g. 'focus on the SQL query' or 'keep it under 200 words'"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          disabled={submitting}
        />
        <button
          type="button"
          className="guide-banner-send"
          onClick={() => void submit()}
          disabled={!draft.trim() || submitting}
          title="Send guidance (⌘↵)"
        >
          {submitting ? '…' : '引导'}
        </button>
      </div>
      <p className="guide-banner-hint">
        ⌘↵ to send · the guidance starts as soon as the current run finishes and continues the session.
      </p>
    </div>
  );
}
