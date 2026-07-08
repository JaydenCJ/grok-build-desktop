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
  const ended = snap?.state === 'done' || snap?.state === 'failed' || snap?.state === 'cancelled';

  const [shown, setShown] = useState(full.length);
  // Refs so a tick reads the latest values without stale closures. shownRef
  // mirrors `shown` so the loop can decide OUTSIDE the setState updater
  // whether another frame is needed — an unconditional reschedule kept every
  // mounted message (incl. long-finished ones held by Virtuoso overscan)
  // burning a rAF callback at ~60fps forever.
  const shownRef = useRef(shown);
  const fullLenRef = useRef(full.length);
  fullLenRef.current = full.length;
  const endedRef = useRef(ended);
  endedRef.current = ended;

  useEffect(() => {
    // Text shrank (new run reused the component) → clamp down immediately.
    if (shownRef.current > full.length) {
      shownRef.current = full.length;
      setShown(full.length);
      return;
    }
    // Already caught up → schedule nothing. The deps below restart the loop
    // when a new token arrives or the run ends (tail drain).
    if (shownRef.current >= full.length) return;
    let raf = 0;
    const tick = () => {
      const target = fullLenRef.current;
      const cur = shownRef.current;
      const remaining = target - cur;
      // Two cadences, both gentle:
      //  • While the run is live: a calm ~1-3 chars/frame (≈60-180 cps). On a
      //    big burst (best-of-n, a fast model) we deliberately cap at 3 so the
      //    text never "dumps" — the caret just trails and catches up, which
      //    reads as natural live typing instead of a wall of text appearing.
      //  • Once the run has ended: drain whatever's left over ~0.3-0.5s so the
      //    tail still types out smoothly rather than snapping in all at once,
      //    but the reader isn't kept waiting.
      const step = endedRef.current
        ? Math.min(Math.max(4, Math.ceil(remaining / 20)), 120)
        : Math.min(Math.max(1, Math.ceil(remaining / 60)), 3);
      const next = Math.min(cur + step, target);
      shownRef.current = next;
      setShown(next);
      // Stop when caught up; idle messages schedule zero frames.
      if (next < target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [full.length, ended]);

  const text = full.slice(0, shown);
  // Caret shows whenever we're still revealing — including the brief post-end
  // tail drain — so the typewriter reads as one continuous motion.
  const caretVisible = shown < full.length;
  return { text, caretVisible };
}
