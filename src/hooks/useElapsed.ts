import { useEffect, useState } from 'react';

/**
 * Returns elapsed milliseconds since `startedAt` (wall clock), ticking every 200ms.
 * Returns null if startedAt is null. Stops ticking when `endedAt` is non-null.
 */
export function useElapsed(startedAt: number | null, endedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const handle = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(handle);
  }, [startedAt, endedAt]);
  if (!startedAt) return null;
  return (endedAt ?? now) - startedAt;
}
