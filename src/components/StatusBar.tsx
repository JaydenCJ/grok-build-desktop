import { useActiveRun } from '../hooks/useActiveRun';
import { useElapsed } from '../hooks/useElapsed';
import { useQueue } from '../hooks/useQueue';
import { usePendingSubmitCount } from '../hooks/usePendingSubmit';
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
  return `${m}m ${Math.round(rem)}s`;
}

/**
 * Compact state suffix in the Claude-Code-style status bar.
 * Return null to omit the suffix entirely (matches Claude Code's minimal
 * `* 7m 48s · 2.1k tokens` mode when nothing interesting is happening).
 */
function stateSuffix(snap: RunSnapshot | undefined): string | null {
  if (!snap) return null;
  if (snap.state === 'done') return `done${snap.stopReason ? ' · ' + snap.stopReason : ''}`;
  if (snap.state === 'cancelled') return 'cancelled';
  if (snap.state === 'failed') return `failed${snap.error ? ': ' + snap.error : ''}`;
  // Spell out exactly what Grok is doing right now (the user asked to always
  // see the live phase, Claude/Codex-style):
  //   thought event  → reasoning privately       → "thinking…"
  //   text event     → emitting the answer        → "writing…"
  //   running, none   → spun up, nothing back yet  → "working…"
  if (snap.lastEventType === 'thought') return 'thinking…';
  if (snap.lastEventType === 'text') return 'writing…';
  if (snap.state === 'running' || snap.state === 'queued') return 'working…';
  return null;
}

/**
 * The Grok activity mark — a small angular star that pulses while a run is
 * in progress. Mirrors Claude Code's animated leading `*` but with Grok-style
 * branding (✦ ≈ angular six-point asterisk in the brand orange).
 */
function GrokMark({ pulsing }: { pulsing: boolean }) {
  return (
    <span
      aria-hidden
      className={`status-mark${pulsing ? ' status-mark-pulse' : ''}`}
    >
      ✦
    </span>
  );
}

export function StatusBar() {
  const active = useActiveRun();
  const queue = useQueue();
  const pending = usePendingSubmitCount();
  const elapsed = useElapsed(active?.startedAt ?? null, active?.endedAt ?? null);
  const chars = (active?.thoughtChars ?? 0) + (active?.textChars ?? 0);
  const queuedExtra = queue.items.length;

  // --- No active run ---
  if (!active) {
    if (pending > 0) {
      return (
        <div className="status-bar">
          <GrokMark pulsing />
          <span className="status-state">
            preparing run{pending > 1 ? ` (×${pending})` : ''}…
          </span>
          {queuedExtra > 0 ? (
            <>
              <span className="status-sep">·</span>
              <span className="status-queue">+{queuedExtra} queued</span>
            </>
          ) : null}
        </div>
      );
    }
    if (queuedExtra > 0) {
      return (
        <div className="status-bar">
          <GrokMark pulsing={false} />
          <span className="status-state">idle</span>
          <span className="status-sep">·</span>
          <span className="status-queue">+{queuedExtra} queued</span>
        </div>
      );
    }
    return (
      <div className="status-bar status-bar-idle">
        <GrokMark pulsing={false} />
        <span className="status-state">idle</span>
      </div>
    );
  }

  // --- Active run: Claude-Code-style `✦ {elapsed} · ≈{tokens} tokens [· state]` ---
  const isLive = active.state === 'running' || active.state === 'queued';
  const suffix = stateSuffix(active);
  return (
    <div className="status-bar">
      <GrokMark pulsing={isLive} />
      <span className="status-elapsed">
        {elapsed != null ? formatElapsed(elapsed) : '0.0s'}
      </span>
      <span className="status-sep">·</span>
      <span className="status-tokens">≈{formatTokens(chars)} tokens</span>
      {suffix ? (
        <>
          <span className="status-sep">·</span>
          <span className="status-state">{suffix}</span>
        </>
      ) : null}
      {queuedExtra > 0 ? (
        <>
          <span className="status-sep">·</span>
          <span className="status-queue">+{queuedExtra} queued</span>
        </>
      ) : null}
    </div>
  );
}
