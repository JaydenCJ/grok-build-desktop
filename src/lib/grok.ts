// src/lib/grok.ts — wrappers around the enqueue/cancel run-queue commands
import { invoke } from '@tauri-apps/api/core';
import { retryWithBackoff } from './retry';
import { attachTauriListeners } from './streamStore';

/** Result shape of the ToolRun-producing Tauri commands (shell, inspect, mcp, …). */
export type ToolRun = {
  ok: boolean;
  command: string;
  cwd: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  output: string;
  stderr: string;
};

/**
 * Attach the run-event / run-state / queue Tauri listeners, retrying with
 * exponential backoff (500ms → 8s, 5 attempts). Without a working
 * subscription every streamed reply renders as dead silence, so a transient
 * startup failure must not be terminal. Rejects only once all attempts are
 * exhausted — callers surface that to the user.
 */
export async function ensureStreamListenersAttached(): Promise<void> {
  await retryWithBackoff(() => attachTauriListeners(), {
    attempts: 5,
    baseDelayMs: 500,
    onRetry: (error, attempt, delayMs) => {
      console.warn(
        `[grok-desktop] stream listener attach failed (attempt ${attempt}, retrying in ${delayMs}ms)`,
        error,
      );
    },
  });
}

export async function enqueueRun(opts: {
  prompt: string;
  cwd: string;
  args: string[];
}): Promise<{ runId: string; position: number }> {
  return invoke('enqueue_run', opts);
}

export async function cancelRun(runId: string): Promise<boolean> {
  return invoke('cancel_run', { runId });
}

export async function getQueue(): Promise<{
  active: string | null;
  queue: Array<{ id: string; prompt: string; cwd: string; state: string; enqueuedAt: number }>;
}> {
  return invoke('get_queue');
}

export async function clearQueue(): Promise<number> {
  return invoke('clear_queue');
}

export async function resumePendingRuns(): Promise<number> {
  return invoke('resume_pending_runs');
}

export async function cancelPendingRuns(): Promise<number> {
  return invoke('cancel_pending_runs');
}
