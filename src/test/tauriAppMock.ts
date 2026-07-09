// Reusable Tauri IPC mock for component tests that render whole app surfaces
// (App, ToolsPage, …) under jsdom. Ports the canned command surface of the
// e2e harness (e2e/tauri-mock.js) onto @tauri-apps/api/mocks so production
// code paths — invoke() plus the run/queue event channels — behave as if the
// bundle were running inside the Tauri shell.
//
// Unlike the e2e mock, enqueue_run does NOT simulate a streamed run on
// timers: tests drive the stream deterministically through the emit helpers
// (emitRunState / emitRunEvent / emitQueue / streamReply), so every assertion
// happens at a known point of the run lifecycle.
//
// setup.ts calls clearMocks() after each test; call installTauriAppMock()
// again in beforeEach (and detach stream listeners) before every render.
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';

export type CommandHandler = (args: Record<string, unknown>) => unknown;

export interface RecordedCall {
  cmd: string;
  args: Record<string, unknown>;
}

export interface TauriAppMock {
  /** Every non-event command invoked, in order. */
  calls: RecordedCall[];
  /** Command names only (convenience for `toContain` assertions). */
  commands: () => string[];
  /** Commands the mock did not recognize — assert empty, like the e2e run. */
  unknownCommands: string[];
  /** Run ids handed out by enqueue_run, in order. */
  runIds: string[];
  /** Emit grok-desktop://run-state-changed. */
  emitRunState: (
    runId: string,
    state: 'Queued' | 'Running' | 'Done' | 'Cancelled' | 'Failed',
    extra?: { startedAt?: number; endedAt?: number; error?: string },
  ) => Promise<void>;
  /** Emit grok-desktop://run-event. */
  emitRunEvent: (runId: string, event: Record<string, unknown>) => Promise<void>;
  /** Emit grok-desktop://queue-changed. */
  emitQueue: (active: string | null, queue?: unknown[]) => Promise<void>;
  /** Play a full streamed run: Running → text chunks → end → Done → empty queue. */
  streamReply: (runId: string, chunks: string[]) => Promise<void>;
}

/** ToolRun shape the Rust commands return (same fixture as the e2e mock). */
export function toolRun(command: string, output: string, ok = true, stderr = '') {
  return {
    ok,
    command,
    cwd: '/mock/project',
    exit_code: ok ? 0 : 1,
    duration_ms: 12,
    timed_out: false,
    output,
    stderr,
  };
}

export const mockAuthStatus = {
  installed: true,
  authenticated: true,
  apiKeyPresent: true,
  cachedLoginPresent: true,
  configPresent: true,
  version: 'mock-1.0.0',
  detail: 'mocked',
  loginCommand: 'grok login',
  deviceLoginCommand: 'grok login --device-auth',
  installCommand: '',
  npmInstallCommand: '',
  authPath: '~/.grok/auth',
  configPath: '~/.grok/config.toml',
};

/**
 * Install the mock IPC layer. `overrides` replace or extend the canned
 * handlers per command name (return value = invoke result; throw = rejection).
 */
export function installTauriAppMock(overrides: Record<string, CommandHandler> = {}): TauriAppMock {
  const calls: RecordedCall[] = [];
  const unknownCommands: string[] = [];
  const runIds: string[] = [];
  let runCounter = 0;

  const handlers: Record<string, CommandHandler> = {
    load_session_state: () => null,
    save_session_state: () => null,
    get_tool_statuses: () => [
      { id: 'grok', label: 'Grok Build', command: 'grok', installed: true, detail: 'mocked' },
    ],
    get_grok_auth_status: () => mockAuthStatus,
    get_static_preview: () => ({
      available: false,
      root: '/mock/project',
      entryPath: '',
      previewUrl: '',
      files: [],
      detail: 'No index.html in the mock project.',
      updatedAt: Date.now(),
    }),
    list_grok_models: () =>
      toolRun('grok models', 'Available models:\n- grok-build\n- grok-4-fast-reasoning\n'),
    get_queue: () => ({ active: null, queue: [] }),
    enqueue_run: () => {
      runCounter += 1;
      const runId = `test-run-${runCounter}`;
      runIds.push(runId);
      return { runId, position: 0 };
    },
    cancel_run: () => true,
    clear_queue: () => 0,
    resume_pending_runs: () => 0,
    cancel_pending_runs: () => 0,
    pick_project_folder: () => '/mock/project',
    list_prompts: () => [],
    list_grok_mcp: () => toolRun('grok mcp list', 'No MCP servers configured.'),
    doctor_grok_mcp: () => toolRun('grok mcp doctor', 'All servers healthy.'),
    grok_mcp_add: (args) => toolRun(`grok mcp add ${String(args.name)}`, 'Added.'),
    grok_mcp_remove: (args) => toolRun(`grok mcp remove ${String(args.name)}`, 'Removed.'),
    list_grok_skills: () => [],
    install_grok_skill: () => null,
    remove_grok_skill: () => null,
    list_grok_plugins: () => toolRun('grok plugin list', 'No plugins installed.'),
    list_grok_sessions: () => toolRun('grok sessions list', 'No sessions.'),
    inspect_grok_environment: () => toolRun('grok inspect', 'grok CLI mock environment'),
    run_shell_command: (args) => toolRun('zsh -lc', `ran: ${String(args.command)}`),
    run_doctor: () => toolRun('doctor', 'All checks passed.'),
    start_grok_login: () => toolRun('grok login', 'Login window opened.'),
    run_browser_task: () => toolRun('browser-use', 'Browser task done.'),
    run_absorb_repo: () => toolRun('absorb-repo', 'Repository absorbed.'),
    glob_files: () => [],
    read_file_safe: () => null,
    desktop_list_apps: () => [
      {
        name: 'Safari',
        bundle_id: 'com.apple.Safari',
        running: true,
        capabilities: ['safari_url'],
      },
      { name: 'Finder', bundle_id: 'com.apple.finder', running: false, capabilities: [] },
    ],
    desktop_query: (args) => `mock:${String(args.action)}`,
    desktop_activate: () => null,
    ...overrides,
  };

  mockIPC(
    (cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      const handler = handlers[cmd];
      if (!handler) {
        unknownCommands.push(cmd);
        return null;
      }
      calls.push({ cmd, args });
      return handler(args);
    },
    { shouldMockEvents: true },
  );

  const emitRunState: TauriAppMock['emitRunState'] = (runId, state, extra = {}) =>
    emit('grok-desktop://run-state-changed', { runId, state, ...extra });
  const emitRunEvent: TauriAppMock['emitRunEvent'] = (runId, event) =>
    emit('grok-desktop://run-event', { runId, event });
  const emitQueue: TauriAppMock['emitQueue'] = (active, queue = []) =>
    emit('grok-desktop://queue-changed', { active, queue });

  return {
    calls,
    commands: () => calls.map((c) => c.cmd),
    unknownCommands,
    runIds,
    emitRunState,
    emitRunEvent,
    emitQueue,
    streamReply: async (runId, chunks) => {
      await emitQueue(runId, []);
      await emitRunState(runId, 'Running', { startedAt: Date.now() });
      for (const chunk of chunks) {
        await emitRunEvent(runId, { type: 'text', data: chunk });
      }
      await emitRunEvent(runId, {
        type: 'end',
        stopReason: 'EndTurn',
        sessionId: 's-1',
        requestId: 'q-1',
      });
      await emitRunState(runId, 'Done', { endedAt: Date.now() });
      await emitQueue(null, []);
    },
  };
}
