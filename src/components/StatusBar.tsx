import { useActiveRun } from '../hooks/useActiveRun';
import { useElapsed } from '../hooks/useElapsed';
import { useQueue } from '../hooks/useQueue';
import type { RunSnapshot } from '../lib/streamStore';

function formatTokens(chars: number): string {
  const tokens = Math.round(chars / 4);
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

function stateText(snap: RunSnapshot | undefined): string {
  if (!snap) return 'idle';
  if (snap.state === 'done') return `done${snap.stopReason ? ' · ' + snap.stopReason : ''}`;
  if (snap.state === 'cancelled') return 'cancelled';
  if (snap.state === 'failed') return `failed${snap.error ? ': ' + snap.error : ''}`;
  if (snap.state === 'queued') return 'waiting...';
  if (snap.lastEventType === 'thought') return 'thinking...';
  if (snap.lastEventType === 'text') return 'writing...';
  return 'running...';
}

export function StatusBar() {
  const active = useActiveRun();
  const queue = useQueue();
  const elapsed = useElapsed(active?.startedAt ?? null, active?.endedAt ?? null);
  const chars = (active?.thoughtChars ?? 0) + (active?.textChars ?? 0);
  const queuedExtra = queue.items.length;
  if (!active) {
    if (queuedExtra > 0) {
      return (
        <div className="status-bar">
          <span className="status-state">idle</span>
          <span className="status-sep">·</span>
          <span className="status-queue">+{queuedExtra} queued</span>
        </div>
      );
    }
    return <div className="status-bar status-bar-idle">idle</div>;
  }
  return (
    <div className="status-bar">
      <span className="status-elapsed">{elapsed != null ? formatElapsed(elapsed) : '0.0s'}</span>
      <span className="status-sep">·</span>
      <span className="status-tokens">≈{formatTokens(chars)} tokens</span>
      <span className="status-sep">·</span>
      <span className="status-state">{stateText(active)}</span>
      {queuedExtra > 0 ? (
        <>
          <span className="status-sep">·</span>
          <span className="status-queue">+{queuedExtra} queued</span>
        </>
      ) : null}
    </div>
  );
}
