// Behavior tests for the external-command runner hook: mount bootstrap,
// each runner's happy/error path, busy flags, the folder picker, and the
// web-preview fallbacks when no Tauri runtime is present.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGrokRunners, type GrokRunnerDeps } from '../useGrokRunners';
import { installTauriAppMock, toolRun, type CommandHandler } from '../../test/tauriAppMock';
import { defaultStatuses } from '../../app/constants';
import { t } from '../../i18n';

function makeDeps(overrides: Partial<GrokRunnerDeps> = {}): GrokRunnerDeps {
  return {
    codingCwd: '/mock/project',
    shellCommand: 'echo hello',
    lastRun: null,
    recordRun: vi.fn(),
    setLastRun: vi.fn(),
    setCodingCwd: vi.fn(),
    setSessionNotice: vi.fn(),
    onPreviewAvailable: vi.fn(),
    ...overrides,
  };
}

/** Render the hook inside the mocked Tauri shell. */
function setup(
  mockOverrides: Record<string, CommandHandler> = {},
  depOverrides: Partial<GrokRunnerDeps> = {},
) {
  const tauri = installTauriAppMock(mockOverrides);
  const deps = makeDeps(depOverrides);
  const view = renderHook((props: GrokRunnerDeps) => useGrokRunners(props), {
    initialProps: deps,
  });
  return { tauri, deps, ...view };
}

/** Render the hook with NO Tauri runtime (vite web preview). */
function setupWeb(depOverrides: Partial<GrokRunnerDeps> = {}) {
  // clearMocks() leaves the emptied __TAURI_INTERNALS__ object behind, which
  // hasTauriRuntime() reads as "Tauri present" — remove it so the web
  // fallbacks actually run.
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const deps = makeDeps(depOverrides);
  const view = renderHook((props: GrokRunnerDeps) => useGrokRunners(props), {
    initialProps: deps,
  });
  return { deps, ...view };
}

const boom = (msg: string) => () => {
  throw new Error(msg);
};

describe('mount bootstrap (Tauri)', () => {
  it('probes statuses, auth, preview, and models on mount', async () => {
    const { tauri, result } = setup();

    await waitFor(() => expect(result.current.statuses).toHaveLength(1));
    expect(result.current.statuses[0]).toMatchObject({ id: 'grok', installed: true });
    await waitFor(() => expect(result.current.grokStatus?.authenticated).toBe(true));
    await waitFor(() =>
      expect(result.current.availableModels).toEqual(['grok-build', 'grok-4-fast-reasoning']),
    );
    await waitFor(() => expect(result.current.staticPreview?.available).toBe(false));

    const cmds = tauri.commands();
    for (const cmd of [
      'get_tool_statuses',
      'get_grok_auth_status',
      'get_static_preview',
      'list_grok_models',
    ]) {
      expect(cmds).toContain(cmd);
    }
  });

  it('reports bootstrap failures per surface without crashing', async () => {
    const { deps, result } = setup({
      get_tool_statuses: boom('statuses down'),
      get_grok_auth_status: boom('auth down'),
      get_static_preview: boom('preview down'),
      list_grok_models: boom('models down'),
    });

    await waitFor(() => expect(result.current.grokStatus?.detail).toBe('auth down'));
    expect(result.current.grokStatus?.installed).toBe(false);
    await waitFor(() => expect(result.current.staticPreview?.detail).toBe('preview down'));
    expect(result.current.staticPreview?.available).toBe(false);
    await waitFor(() => expect(result.current.modelsRun?.stderr).toBe('models down'));
    expect(result.current.modelsRun?.ok).toBe(false);
    expect(result.current.availableModels).toEqual([]);
    await waitFor(() =>
      expect(deps.setLastRun).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          command: 'get_tool_statuses',
          stderr: 'statuses down',
        }),
      ),
    );
  });

  it('re-probes the static preview after a new run lands (debounced)', async () => {
    const { tauri, deps, rerender, result } = setup();
    const previews = () => tauri.commands().filter((c) => c === 'get_static_preview').length;

    // Mount refresh + the 250ms debounce kick from the [cwd, lastRun] effect.
    await waitFor(() => expect(previews()).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    const before = previews();

    rerender({ ...deps, lastRun: toolRun('zsh -lc', 'done') });
    await waitFor(() => expect(previews()).toBe(before + 1), { timeout: 2000 });
    expect(result.current.previewBusy).toBe(false);
  });
});

describe('shell runner', () => {
  it('runs the shell command in the coding cwd and records the run', async () => {
    const { tauri, deps, result } = setup();
    await act(async () => {
      await result.current.runShell();
    });

    const call = tauri.calls.find((c) => c.cmd === 'run_shell_command')!;
    expect(call.args).toMatchObject({ command: 'echo hello', cwd: '/mock/project' });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, output: 'ran: echo hello' }),
    );
    expect(result.current.busyRunner).toBeNull();
  });

  it('records a failed run when the shell invoke rejects', async () => {
    const { deps, result } = setup({ run_shell_command: boom('shell exploded') });
    await act(async () => {
      await result.current.runShell();
    });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, command: 'zsh -lc', stderr: 'shell exploded' }),
    );
    expect(result.current.busyRunner).toBeNull();
  });

  it('marks the shell runner busy while the command is in flight', async () => {
    let release!: (run: unknown) => void;
    const { result } = setup({
      run_shell_command: () => new Promise((resolve) => (release = resolve)),
    });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.runShell();
    });
    expect(result.current.busyRunner).toBe('shell');

    await act(async () => {
      release(toolRun('zsh -lc', 'late'));
      await pending;
    });
    expect(result.current.busyRunner).toBeNull();
  });
});

describe('grok login', () => {
  it('streams sys lines, records the run, and opens an available preview', async () => {
    const preview = {
      available: true,
      root: '/mock/project',
      entryPath: 'index.html',
      previewUrl: 'http://preview.local/',
      files: ['index.html'],
      detail: '',
      updatedAt: 1,
    };
    const { tauri, deps, result } = setup({ get_static_preview: () => preview });

    await act(async () => {
      await result.current.startGrokLogin();
    });

    expect(result.current.terminalLines[0]).toContain('Grok setup');
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ output: 'Login window opened.' }),
    );
    expect(deps.onPreviewAvailable).toHaveBeenCalled();
    const call = tauri.calls.find((c) => c.cmd === 'start_grok_login')!;
    expect(call.args).toMatchObject({ deviceAuth: false, cwd: '/mock/project' });
    // Auth status re-probed after the login run (mount + post-login).
    const authProbes = tauri.commands().filter((c) => c === 'get_grok_auth_status').length;
    expect(authProbes).toBeGreaterThanOrEqual(2);
  });

  it('logs device-auth failures to the terminal and records them', async () => {
    const { deps, result } = setup({ start_grok_login: boom('login refused') });

    await act(async () => {
      await result.current.startGrokLogin(true);
    });

    expect(result.current.terminalLines[0]).toContain('device login');
    expect(result.current.terminalLines).toContain('[err] login refused');
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        command: 'grok login --device-auth',
        stderr: 'login refused',
      }),
    );
    expect(deps.onPreviewAvailable).not.toHaveBeenCalled();
  });
});

describe('inspector list runners', () => {
  const listRunners = [
    { fn: 'refreshGrokMcp', cmd: 'list_grok_mcp', field: 'mcpRun', command: 'grok mcp list' },
    {
      fn: 'doctorGrokMcp',
      cmd: 'doctor_grok_mcp',
      field: 'mcpDoctorRun',
      command: 'grok mcp doctor',
    },
    {
      fn: 'refreshGrokPlugins',
      cmd: 'list_grok_plugins',
      field: 'pluginsRun',
      command: 'grok plugin list',
    },
    {
      fn: 'refreshGrokSessions',
      cmd: 'list_grok_sessions',
      field: 'sessionsRun',
      command: 'grok sessions list',
    },
  ] as const;

  it.each(listRunners)('$fn stores and records the run', async ({ fn, cmd, field }) => {
    const { tauri, deps, result } = setup();
    await act(async () => {
      await result.current[fn]();
    });

    const run = result.current[field];
    expect(run?.ok).toBe(true);
    expect(deps.recordRun).toHaveBeenCalledWith(run);
    expect(tauri.calls.find((c) => c.cmd === cmd)?.args).toMatchObject({ cwd: '/mock/project' });
    expect(result.current.busyRunner).toBeNull();
  });

  it.each(listRunners)(
    '$fn surfaces invoke failures as a failed run',
    async ({ fn, cmd, field, command }) => {
      const { deps, result } = setup({ [cmd]: boom('cli busted') });
      await act(async () => {
        await result.current[fn]();
      });

      const run = result.current[field];
      expect(run).toMatchObject({ ok: false, command, stderr: 'cli busted', cwd: '/mock/project' });
      expect(deps.recordRun).toHaveBeenCalledWith(run);
      expect(result.current.busyRunner).toBeNull();
    },
  );
});

describe('ecosystem and models', () => {
  it('refreshGrokEcosystem stores the inspect run', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.refreshGrokEcosystem();
    });
    expect(result.current.ecosystemRun?.output).toBe('grok CLI mock environment');
    expect(result.current.contextBusy).toBeNull();
  });

  it('refreshGrokEcosystem records failures', async () => {
    const { result } = setup({ inspect_grok_environment: boom('inspect died') });
    await act(async () => {
      await result.current.refreshGrokEcosystem();
    });
    expect(result.current.ecosystemRun).toMatchObject({
      ok: false,
      command: 'grok inspect',
      stderr: 'inspect died',
    });
    expect(result.current.contextBusy).toBeNull();
  });

  it('refreshGrokModels failure keeps the model list empty', async () => {
    const { result } = setup({ list_grok_models: boom('models died') });
    await act(async () => {
      await result.current.refreshGrokModels();
    });
    expect(result.current.modelsRun).toMatchObject({ ok: false, stderr: 'models died' });
    expect(result.current.availableModels).toEqual([]);
  });

  it('refreshGrokModels keeps previous models when output has none', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.availableModels.length).toBeGreaterThan(0));

    // Re-mock so the next refresh returns unparsable output — the previously
    // parsed model list must survive.
    installTauriAppMock({
      list_grok_models: () => toolRun('grok models', 'nothing to see'),
    });
    await act(async () => {
      await result.current.refreshGrokModels();
    });
    expect(result.current.modelsRun?.output).toBe('nothing to see');
    expect(result.current.availableModels).toEqual(['grok-build', 'grok-4-fast-reasoning']);
  });
});

describe('browser, absorb, doctor runners', () => {
  it('runBrowser sends the edited task with a 10-step cap', async () => {
    const { tauri, deps, result } = setup();
    act(() => {
      result.current.setBrowserTask('Visit example.org');
    });
    await act(async () => {
      await result.current.runBrowser();
    });

    const call = tauri.calls.find((c) => c.cmd === 'run_browser_task')!;
    expect(call.args).toMatchObject({ task: 'Visit example.org', maxSteps: 10 });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ output: 'Browser task done.' }),
    );
  });

  it('runBrowser records failures', async () => {
    const { deps, result } = setup({ run_browser_task: boom('no browser') });
    await act(async () => {
      await result.current.runBrowser();
    });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, command: 'browser-use', stderr: 'no browser' }),
    );
  });

  it('runAbsorbRepo forwards repoPath and copyText', async () => {
    const { tauri, deps, result } = setup();
    act(() => {
      result.current.setRepoPath('/repo/x');
      result.current.setCopyText(false);
    });
    await act(async () => {
      await result.current.runAbsorbRepo();
    });

    const call = tauri.calls.find((c) => c.cmd === 'run_absorb_repo')!;
    expect(call.args).toMatchObject({ repoPath: '/repo/x', copyText: false });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ output: 'Repository absorbed.' }),
    );
  });

  it('runAbsorbRepo records failures', async () => {
    const { deps, result } = setup({ run_absorb_repo: boom('clone failed') });
    await act(async () => {
      await result.current.runAbsorbRepo();
    });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, command: 'absorb-repo', stderr: 'clone failed' }),
    );
  });

  it('runDoctor records the health check', async () => {
    const { deps, result } = setup();
    await act(async () => {
      await result.current.runDoctor();
    });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, output: 'All checks passed.' }),
    );
  });

  it('runDoctor records failures', async () => {
    const { deps, result } = setup({ run_doctor: boom('doctor sick') });
    await act(async () => {
      await result.current.runDoctor();
    });
    expect(deps.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, command: 'doctor', stderr: 'doctor sick' }),
    );
  });
});

describe('folder picker', () => {
  it('sets the coding cwd and posts a notice when a folder is picked', async () => {
    const { tauri, deps, result } = setup();
    await act(async () => {
      await result.current.pickFolder();
    });

    expect(tauri.calls.find((c) => c.cmd === 'pick_project_folder')?.args).toMatchObject({
      initial: '/mock/project',
    });
    expect(deps.setCodingCwd).toHaveBeenCalledWith('/mock/project');
    expect(deps.setSessionNotice).toHaveBeenCalledWith(
      t('notices.repoSet', { path: '/mock/project' }),
    );
    expect(result.current.folderPickerBusy).toBe(false);
  });

  it('does nothing when the picker is cancelled', async () => {
    const { deps, result } = setup({ pick_project_folder: () => null });
    await act(async () => {
      await result.current.pickFolder();
    });
    expect(deps.setCodingCwd).not.toHaveBeenCalled();
    expect(deps.setSessionNotice).not.toHaveBeenCalled();
    expect(result.current.folderPickerBusy).toBe(false);
  });

  it('reports picker failures via the session notice', async () => {
    const { deps, result } = setup({ pick_project_folder: boom('no dialog') });
    await act(async () => {
      await result.current.pickFolder();
    });
    expect(deps.setSessionNotice).toHaveBeenCalledWith(
      t('notices.folderPickerFailed', { error: 'no dialog' }),
    );
    expect(deps.setCodingCwd).not.toHaveBeenCalled();
    expect(result.current.folderPickerBusy).toBe(false);
  });

  it('flags busy while the picker dialog is open', async () => {
    let release!: (folder: string | null) => void;
    const { result } = setup({
      pick_project_folder: () => new Promise((resolve) => (release = resolve)),
    });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.pickFolder();
    });
    expect(result.current.folderPickerBusy).toBe(true);

    await act(async () => {
      release(null);
      await pending;
    });
    expect(result.current.folderPickerBusy).toBe(false);
  });

  it('asks for the desktop app when no runtime is present', async () => {
    const { deps, result } = setupWeb();
    await act(async () => {
      await result.current.pickFolder();
    });
    expect(deps.setSessionNotice).toHaveBeenCalledWith(t('notices.folderPickerUnavailable'));
    expect(deps.setCodingCwd).not.toHaveBeenCalled();
  });
});

describe('web preview fallbacks (no Tauri runtime)', () => {
  it('falls back to canned data on mount', async () => {
    const { deps, result } = setupWeb();

    await waitFor(() => expect(result.current.statuses).toEqual(defaultStatuses));
    expect(deps.setLastRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, command: 'web preview' }),
    );
    await waitFor(() =>
      expect(result.current.grokStatus?.detail).toContain('Tauri desktop window'),
    );
    expect(result.current.grokStatus?.installed).toBe(false);
    await waitFor(() =>
      expect(result.current.staticPreview?.detail).toContain('installed Grok Desktop app'),
    );
    await waitFor(() => expect(result.current.modelsRun?.ok).toBe(false));
    expect(result.current.modelsRun?.command).toBe('grok models');
  });

  it('every runner degrades to a native-unavailable run', async () => {
    const { deps, result } = setupWeb();

    await act(async () => {
      await result.current.runShell();
      await result.current.runBrowser();
      await result.current.runAbsorbRepo();
      await result.current.runDoctor();
      await result.current.refreshGrokMcp();
      await result.current.doctorGrokMcp();
      await result.current.refreshGrokPlugins();
      await result.current.refreshGrokSessions();
      await result.current.refreshGrokEcosystem();
      await result.current.refreshGrokModels();
      await result.current.startGrokLogin(); // last — it writes the terminal
    });

    const recorded = (deps.recordRun as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { command: string }).command,
    );
    expect(recorded).toEqual(
      expect.arrayContaining(['zsh -lc', 'absorb-repo', 'doctor', 'grok login']),
    );
    // runBrowser routes through setLastRun in the web build.
    expect(deps.setLastRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, command: 'browser-use' }),
    );
    expect(result.current.mcpRun).toMatchObject({ ok: false, command: 'grok mcp list' });
    expect(result.current.mcpDoctorRun?.command).toBe('grok mcp doctor');
    expect(result.current.pluginsRun?.command).toBe('grok plugin list');
    expect(result.current.sessionsRun?.command).toBe('grok sessions list');
    expect(result.current.ecosystemRun?.command).toBe('grok inspect');
    expect(result.current.modelsRun?.command).toBe('grok models');
    expect(result.current.terminalLines.some((line) => line.startsWith('[err]'))).toBe(true);
    expect(result.current.busyRunner).toBeNull();
  });
});
