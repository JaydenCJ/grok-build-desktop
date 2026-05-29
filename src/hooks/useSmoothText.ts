import { useEffect, useRef, useState } from 'react';
import { useRunSnapshot } from './useRunSnapshot';

/**
 * Typewriter buffer for streaming text. grok delivers tokens in fast bursts,
 * so rendering the raw accumulated text makes it lurch out in chunks. This
 * hook reveals the accumulated text at a steady, natural cadence (Claude-like)
 * — a single rAF loop advances a "shown" cursor toward the full length, a few
 * characters per frame, with mild catch-up so it never lags a whole paragraph
 * behind. When the run ends it snaps to the full text immediately (no
 * artificially withheld tail).
 */
export function useSmoothText(runId: string | null | undefined): {
  text: string;
  caretVisible: boolean;
} {
  const snap = useRunSnapshot(runId);
  const full = snap?.text ?? '';
  const ended =
    snap?.state === 'done' || snap?.state === 'failed' || snap?.state === 'cancelled';

  const [shown, setShown] = useState(full.length);
  // Refs so the single rAF loop reads the latest values without restarting.
  const fullLenRef = useRef(full.length);
  fullLenRef.current = full.length;
  const endedRef = useRef(ended);
  endedRef.current = ended;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((cur) => {
        const target = fullLenRef.current;
        // Run ended → reveal everything at once. Also, if the cursor somehow
        // sits ahead (text shrank / new run), clamp down.
        if (endedRef.current) return target;
        if (cur > target) return target;
        if (cur >= target) return cur; // idle: no re-render (React bails)
        const remaining = target - cur;
        // ~2-3 chars/frame (≈120-180 cps) with proportional catch-up so a big
        // burst doesn't dump instantly but we never fall far behind.
        const step = Math.min(Math.max(1, Math.ceil(remaining / 10)), 3);
        return cur + step;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const text = full.slice(0, shown);
  // Show a blinking caret while we're actively revealing (not ended, more to go).
  const caretVisible = !ended && shown < full.length;
  return { text, caretVisible };
}
