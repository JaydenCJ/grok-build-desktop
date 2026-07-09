// Bounded retry with exponential backoff for async setup work that must not
// fail silently (e.g. attaching Tauri event listeners at startup).

export interface RetryOptions {
  /** Total attempts including the first call. Default 5. */
  attempts?: number;
  /** Delay before the second attempt; doubles per retry. Default 500ms. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff delay. Default 8000ms. */
  maxDelayMs?: number;
  /** Called after each failed attempt that will be retried. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` until it resolves, retrying up to `attempts` times with
 * exponential backoff (base, 2*base, 4*base, … capped at `maxDelayMs`).
 * Rejects with the last error once all attempts are exhausted.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 5);
  const base = options.baseDelayMs ?? 500;
  const cap = options.maxDelayMs ?? 8000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = Math.min(cap, base * 2 ** (attempt - 1));
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
