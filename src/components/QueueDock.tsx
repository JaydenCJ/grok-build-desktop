import { useEffect, useState } from 'react';
import { useActiveRun } from '../hooks/useActiveRun';
import { useElapsed } from '../hooks/useElapsed';
import { useQueue } from '../hooks/useQueue';
import { cancelPendingRuns, cancelRun, getQueue, resumePendingRuns } from '../lib/grok';
import { replaceQueue } from '../lib/streamStore';

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

export function QueueDock() {
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
      .catch(() => {/* ignore: backend not ready yet */});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResume = async () => {
    await resumePendingRuns();
    setResumeBannerVisible(false);
  };
  const handleCancelAll = async () => {
    await cancelPendingRuns();
    setResumeBannerVisible(false);
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
          <span>↻ Last session had {bannerCount} pending task{bannerCount === 1 ? '' : 's'}</span>
          <button onClick={handleResume}>Resume all</button>
          <button onClick={handleCancelAll}>Cancel all</button>
        </div>
      ) : null}

      <div className="queue-summary" onClick={() => setExpanded((v) => !v)}>
        {active ? (
          <span className="queue-active">▶ Running {elapsed != null ? formatElapsed(elapsed) : '0s'}</span>
        ) : (
          <span className="queue-idle">▶ Idle</span>
        )}
        {queue.items.length > 0 ? (
          <span className="queue-count">+ {queue.items.length} queued</span>
        ) : null}
        <span className="queue-expand">{expanded ? '⤒ collapse' : '⤓ expand'}</span>
      </div>

      {expanded && queue.items.length > 0 ? (
        <ul className="queue-list">
          {queue.items.map((item) => (
            <li key={item.id} className="queue-item">
              <span className="queue-item-state">⏸</span>
              <span className="queue-item-prompt">{item.prompt.slice(0, 80)}</span>
              <button onClick={() => cancelRun(item.id)} aria-label="Cancel this queued run">✕</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
