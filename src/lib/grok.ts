// src/lib/grok.ts — F task 11: real wrappers around the new enqueue/cancel commands
import { invoke } from '@tauri-apps/api/core';
import { attachTauriListeners } from './streamStore';

// --- Type re-exports kept for App.tsx compatibility ---
// These are stub types matching the legacy shape. They will be removed when
// App.tsx is rewritten in Task 21.
// NOTE: fields kept required so App.tsx local ToolRun (also required) stays assignable.
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

export type GrokStreamEvent = {
  runId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  done: boolean;
  ok: boolean | null;
  exitCode: number | null;
  durationMs: number | null;
  cwd: string;
  command: string;
};

export type CallGrokOptions = {
  mode?: 'standard' | 'coding';
  cwd?: string;
  model?: string;
  effort?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  bestOfN?: number;
  experimentalMemory?: boolean;
  webSearchEnabled?: boolean;
  subagentsEnabled?: boolean;
  selfCheck?: boolean;
  onRunId?: (runId: string) => void;
  onEvent?: (event: GrokStreamEvent) => void;
  [k: string]: unknown;
};

// --- Throwing stubs for legacy call-sites (FIXME(F-task21) markers in App.tsx) ---
export async function callGrokCLI(_prompt: string, _options?: CallGrokOptions): Promise<ToolRun> {
  throw new Error('legacy callGrokCLI removed; use enqueueRun (wiring in Task 21)');
}

export async function cancelGrokCLI(_runId?: string): Promise<boolean> {
  throw new Error('legacy cancelGrokCLI removed; use cancelRun (wiring in Task 21)');
}

// --- New API ---

export async function ensureStreamListenersAttached(): Promise<void> {
  await attachTauriListeners();
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
