// Injected via addInitScript BEFORE any app script runs. Installs a minimal
// window.__TAURI_INTERNALS__ so the production bundle boots as if inside the
// Tauri shell: invoke() resolves with canned data and the three run/queue
// event channels are emittable. enqueue_run simulates a full streamed grok
// run (Running → text → end → Done) so the chat pipeline can be asserted
// end-to-end without a real backend.
(() => {
  let nextCallbackId = 1;
  /** transformCallback id → function */
  const callbacks = new Map();
  /** event name → Set of callback ids (from plugin:event|listen) */
  const eventListeners = new Map();
  /** Commands the mock did not recognize (asserted empty by the test). */
  const unknownCommands = [];

  function emit(event, payload) {
    const ids = eventListeners.get(event);
    if (!ids) return;
    for (const id of ids) {
      const cb = callbacks.get(id);
      if (cb) cb({ event, id, payload });
    }
  }

  function toolRun(command, output) {
    return {
      ok: true,
      command,
      cwd: '/mock/project',
      exit_code: 0,
      duration_ms: 12,
      timed_out: false,
      output,
      stderr: '',
    };
  }

  let runCounter = 0;
  function simulateRun(runId) {
    const chunks = ['Hello from ', 'mock grok. ', 'All systems streaming.'];
    let t = 30;
    emitLater(t, 'grok-desktop://run-state-changed', {
      runId,
      state: 'Running',
      startedAt: Date.now(),
    });
    for (const chunk of chunks) {
      t += 40;
      emitLater(t, 'grok-desktop://run-event', {
        runId,
        event: { type: 'text', data: chunk },
      });
    }
    t += 40;
    emitLater(t, 'grok-desktop://run-event', {
      runId,
      event: { type: 'end', stopReason: 'EndTurn', sessionId: 's-1', requestId: 'q-1' },
    });
    emitLater(t + 20, 'grok-desktop://run-state-changed', {
      runId,
      state: 'Done',
      endedAt: Date.now(),
    });
    emitLater(t + 30, 'grok-desktop://queue-changed', { active: null, queue: [] });
  }
  function emitLater(delay, event, payload) {
    setTimeout(() => emit(event, payload), delay);
  }

  const handlers = {
    'plugin:event|listen': (args) => {
      const set = eventListeners.get(args.event) ?? new Set();
      set.add(args.handler);
      eventListeners.set(args.event, set);
      return args.handler;
    },
    'plugin:event|unlisten': (args) => {
      const set = eventListeners.get(args.event);
      if (set) set.delete(args.eventId);
      return null;
    },
    load_session_state: () => null,
    save_session_state: () => null,
    get_tool_statuses: () => [
      { id: 'grok', label: 'Grok Build', command: 'grok', installed: true, detail: 'mocked' },
    ],
    get_grok_auth_status: () => ({
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
    }),
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
      const runId = `e2e-run-${runCounter}`;
      simulateRun(runId);
      return { runId, position: 0 };
    },
    cancel_run: () => true,
    clear_queue: () => 0,
    resume_pending_runs: () => 0,
    cancel_pending_runs: () => 0,
    pick_project_folder: () => '/mock/project',
    list_prompts: () => [],
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback(callback) {
      const id = nextCallbackId++;
      callbacks.set(id, callback);
      return id;
    },
    async invoke(cmd, args = {}) {
      const handler = handlers[cmd];
      if (!handler) {
        unknownCommands.push(cmd);
        return null;
      }
      return handler(args);
    },
  };
  window.__E2E_UNKNOWN_COMMANDS__ = unknownCommands;
})();
