import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
  stream: "stdout" | "stderr" | "system";
  line: string;
  done: boolean;
  ok: boolean | null;
  exitCode: number | null;
  durationMs: number | null;
  cwd: string;
  command: string;
};

export type CallGrokOptions = {
  mode: "standard" | "coding";
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
};

function createRunId() {
  return `grok-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function callGrokCLI(prompt: string, options: CallGrokOptions) {
  const runId = createRunId();
  options.onRunId?.(runId);
  const unlisten = await listen<GrokStreamEvent>("grok-desktop://grok-stream", (event) => {
    if (event.payload.runId === runId) {
      options.onEvent?.(event.payload);
    }
  });

  try {
    return await invoke<ToolRun>("run_grok_streaming_task", {
      prompt,
      mode: options.mode,
      cwd: options.cwd || null,
      model: options.model || null,
      effort: options.effort || null,
      reasoningEffort: options.reasoningEffort || null,
      permissionMode: options.permissionMode || null,
      bestOfN: options.bestOfN || null,
      experimentalMemory: options.experimentalMemory ?? false,
      webSearchEnabled: options.webSearchEnabled ?? false,
      subagentsEnabled: options.subagentsEnabled ?? false,
      selfCheck: options.selfCheck ?? false,
      runId,
    });
  } finally {
    unlisten();
  }
}

export async function cancelGrokCLI(runId: string) {
  return invoke<boolean>("cancel_grok_run", { runId });
}
