import { useEffect, useState } from 'react';
import { useActiveRun } from '../hooks/useActiveRun';
import { useElapsed } from '../hooks/useElapsed';
import { useQueue } from '../hooks/useQueue';
import { cancelPendingRuns, cancelRun, getQueue, resumePendingRuns } from '../lib/grok';
import { replaceQueue } from '../lib/streamStore';
import { t } from '../i18n';

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

interface Props {
  /** Called when a queue action (resume / cancel) fails, with a
   *  human-readable message. The host surfaces it (session notice) — an
   *  unhandled rejection here left the buttons looking like they worked while
   *  the queue stayed exactly as it was. */
  onError?: (message: string) => void;
}

export function QueueDock({ onError }: Props) {
  const [expanded, setExpanded] = useState(false);
  const queue = useQueue();
  const active = useActiveRun();
  const elapsed = useElapsed(active?.startedAt ?? null, active?.endedAt ?? null);
  const [resumeBannerVisible, setResumeBannerVisible] = useState(false);
  const [bannerCount, setBannerCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getQueue()
      .then((snap) => {
        if (cancelled) return;
        replaceQueue({ active: snap.active, items: snap.queue as never });
        const queuedItems = snap.queue.filter((r) => r.state === 'Queued');
        if (queuedItems.length > 0 && !snap.active) {
          setBannerCount(queuedItems.length);
          setResumeBannerVisible(true);
        }
      })
      .catch(() => {
        /* ignore: backend not ready yet */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const surfaceError = (err: unknown) => {
    onError?.(err instanceof Error ? err.message : String(err));
  };
  // On failure the banner stays up so the user can retry once the cause
  // (e.g. backend hiccup) is gone.
  const handleResume = async () => {
    try {
      await resumePendingRuns();
      setResumeBannerVisible(false);
    } catch (err) {
      surfaceError(err);
    }
  };
  const handleCancelAll = async () => {
    try {
      await cancelPendingRuns();
      setResumeBannerVisible(false);
    } catch (err) {
      surfaceError(err);
    }
  };

  // Only surface the dock when it has something to manage: queued tasks
  // waiting behind the active run, or a resume banner. A lone active run with
  // nothing queued shows its status in the StatusBar instead — no redundant
  // "▶ Running … expand" bar (keeps the conversation clean, Claude-style).
  if (queue.items.length === 0 && !resumeBannerVisible) return null;

  return (
    <div className="queue-dock">
      {resumeBannerVisible ? (
        <div className="queue-banner">
          <span>
            {t(bannerCount === 1 ? 'queue.bannerOne' : 'queue.bannerMany', { count: bannerCount })}
          </span>
          <button onClick={handleResume}>{t('queue.resumeAll')}</button>
          <button onClick={handleCancelAll}>{t('queue.cancelAll')}</button>
        </div>
      ) : null}

      <button
        type="button"
        className="queue-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {active ? (
          <span className="queue-active">
            {t('queue.running', { elapsed: elapsed != null ? formatElapsed(elapsed) : '0s' })}
          </span>
        ) : (
          <span className="queue-idle">{t('queue.idle')}</span>
        )}
        {queue.items.length > 0 ? (
          <span className="queue-count">
            {t('queue.queuedCount', { count: queue.items.length })}
          </span>
        ) : null}
        <span className="queue-expand">{expanded ? t('queue.collapse') : t('queue.expand')}</span>
      </button>

      {expanded && queue.items.length > 0 ? (
        <ul className="queue-list">
          {queue.items.map((item) => (
            <li key={item.id} className="queue-item">
              <span className="queue-item-state">⏸</span>
              <span className="queue-item-prompt">{item.prompt.slice(0, 80)}</span>
              <button
                onClick={() => void cancelRun(item.id).catch(surfaceError)}
                aria-label={t('queue.cancelQueuedRun')}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
