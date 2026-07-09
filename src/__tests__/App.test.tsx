// Integration tests for the full <App/> shell under jsdom, with the Tauri IPC
// surface mocked (src/test/tauriAppMock.ts mirrors the e2e harness). These
// exercise the real user flows end-to-end through the production components:
// boot render, composer submit → queued run → streamed reply, stop, session
// tabs, sidebar/history, the ⌘K palette, settings, panels, and undo.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtuosoMockContext } from 'react-virtuoso';
import App from '../App';
import { detachTauriListeners, streamStore } from '../lib/streamStore';
import { storageKeys } from '../app/constants';
import { t } from '../i18n';
import { installTauriAppMock, type CommandHandler, type TauriAppMock } from '../test/tauriAppMock';

// jsdom lacks layout APIs the app calls: Virtuoso needs ResizeObserver, the
// palette / file picker keep their highlight visible via scrollIntoView.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  if (typeof window.ResizeObserver === 'undefined') {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  }
  Element.prototype.scrollIntoView = vi.fn();
});

function setup(overrides: Record<string, CommandHandler> = {}) {
  // Fresh mock first, THEN drop listeners registered against the previous
  // test's mock (the unlisten invokes land harmlessly in the new one).
  const tauri: TauriAppMock = installTauriAppMock(overrides);
  detachTauriListeners();
  streamStore.__reset();
  const user = userEvent.setup();
  const view = render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 64 }}>
      <App />
    </VirtuosoMockContext.Provider>,
  );
  return { tauri, user, view };
}
type Ctx = ReturnType<typeof setup>;

function composerTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(t('mode.coding.placeholder')) as HTMLTextAreaElement;
}

/** Queries scoped to the conversation panel — the sidebar HISTORY rows repeat
 *  the first prompt as the conversation title, so unscoped text queries would
 *  match twice. */
function convo() {
  return within(document.querySelector('.conversation-panel') as HTMLElement);
}

async function bootApp(overrides: Record<string, CommandHandler> = {}): Promise<Ctx> {
  const ctx = setup(overrides);
  expect(await screen.findByText(t('emptyState.title'))).toBeInTheDocument();
  // Wait for the runner bootstrap so later assertions aren't racing it.
  await waitFor(() => expect(ctx.tauri.commands()).toContain('get_grok_auth_status'));
  return ctx;
}

/** Type a prompt and press Enter; returns the run id handed out by the mock. */
async function submitPrompt(ctx: Ctx, prompt: string): Promise<string> {
  const before = ctx.tauri.runIds.length;
  const textarea = composerTextarea();
  await ctx.user.clear(textarea);
  await ctx.user.type(textarea, prompt);
  await ctx.user.keyboard('{Enter}');
  await waitFor(() => expect(ctx.tauri.runIds.length).toBeGreaterThan(before));
  return ctx.tauri.runIds[ctx.tauri.runIds.length - 1]!;
}

describe('App boot', () => {
  it('renders the shell and bootstraps through the Tauri IPC surface', async () => {
    const { tauri } = await bootApp();

    // Empty state + composer + idle status bar.
    expect(screen.getByText(t('emptyState.title'))).toBeInTheDocument();
    expect(composerTextarea()).toBeInTheDocument();
    expect(screen.getByText(t('statusBar.idle'))).toBeInTheDocument();

    // Sidebar brand + connected pill (auth status came from the mock).
    expect(screen.getByText(t('sidebar.brandTitle'))).toBeInTheDocument();
    expect(await screen.findByText(t('sidebar.connected'))).toBeInTheDocument();
    expect(await screen.findByLabelText(t('titleBar.connectedAria'))).toBeInTheDocument();

    // Boot invokes the same command surface the e2e harness documents.
    await waitFor(() => {
      for (const cmd of [
        'load_session_state',
        'get_tool_statuses',
        'get_grok_auth_status',
        'get_static_preview',
        'list_grok_models',
        'get_queue',
      ]) {
        expect(tauri.commands()).toContain(cmd);
      }
    });
    expect(tauri.unknownCommands).toEqual([]);
  });

  it('seeds the composer from an empty-state starter card', async () => {
    const { user } = await bootApp();
    await user.click(
      screen.getByRole('button', { name: new RegExp(t('emptyState.explainTitle')) }),
    );
    expect(composerTextarea().value).toMatch(/architecture tour/);
  });
});

describe('composer submit → queued run → streamed reply', () => {
  it('enqueues the prompt and renders the streamed reply to completion', async () => {
    const ctx = await bootApp();
    const { tauri } = ctx;

    const runId = await submitPrompt(ctx, 'Say hello please');

    // enqueue_run got the prompt and the built CLI args.
    const enqueue = tauri.calls.find((c) => c.cmd === 'enqueue_run')!;
    expect(enqueue.args.prompt).toBe('Say hello please');
    expect(enqueue.args.args).toContain('-p');
    // The user bubble shows what was typed; the composer cleared.
    expect(await convo().findByText('Say hello please')).toBeInTheDocument();
    expect(composerTextarea().value).toBe('');

    // Backend picks the run up: queue active + Running state.
    await act(async () => {
      await tauri.emitQueue(runId, []);
      await tauri.emitRunState(runId, 'Running', { startedAt: Date.now() });
    });
    expect(await screen.findByText(t('statusBar.working'))).toBeInTheDocument();

    // Streamed text chunks…
    await act(async () => {
      await tauri.emitRunEvent(runId, { type: 'text', data: 'Hello from mock grok. ' });
      await tauri.emitRunEvent(runId, { type: 'text', data: 'All systems streaming.' });
    });
    expect(await screen.findByText(t('statusBar.writing'))).toBeInTheDocument();

    // …then the end of the stream.
    await act(async () => {
      await tauri.emitRunEvent(runId, {
        type: 'end',
        stopReason: 'EndTurn',
        sessionId: 's-1',
        requestId: 'q-1',
      });
      await tauri.emitRunState(runId, 'Done', { endedAt: Date.now() });
    });
    // The typewriter drains the buffered tail, then the full reply is visible.
    await waitFor(() => {
      expect(document.querySelector('.message-assistant')).toHaveTextContent(
        'Hello from mock grok. All systems streaming.',
      );
    });
    expect(
      screen.getByText(t('statusBar.doneWithReason', { reason: 'EndTurn' })),
    ).toBeInTheDocument();

    // Queue empties → status returns to idle.
    await act(async () => {
      await tauri.emitQueue(null, []);
    });
    expect(await screen.findByText(t('statusBar.idle'))).toBeInTheDocument();

    // The finalize write-back persisted the streamed text into messages.
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(storageKeys.messages) ?? '[]',
      ) as Array<{
        role: string;
        content: string;
        status?: string;
      }>;
      const assistant = stored.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('Hello from mock grok. All systems streaming.');
      expect(assistant?.status).toBe('done');
    });
    expect(tauri.unknownCommands).toEqual([]);
  });

  it('stops a running run from the title bar and marks the message stopped', async () => {
    const ctx = await bootApp();
    const { tauri, user } = ctx;
    const runId = await submitPrompt(ctx, 'Long running task');

    await act(async () => {
      await tauri.emitQueue(runId, []);
      await tauri.emitRunState(runId, 'Running', { startedAt: Date.now() });
      await tauri.emitRunEvent(runId, { type: 'text', data: 'partial output' });
    });

    await user.click(await screen.findByRole('button', { name: t('titleBar.stop') }));
    await waitFor(() => {
      const cancel = tauri.calls.find((c) => c.cmd === 'cancel_run');
      expect(cancel?.args).toEqual({ runId });
    });

    await act(async () => {
      await tauri.emitRunState(runId, 'Cancelled', { endedAt: Date.now() });
      await tauri.emitQueue(null, []);
    });
    expect(await screen.findByText(t('message.stopped'))).toBeInTheDocument();
  });

  it('surfaces an enqueue failure as a session notice and keeps the draft', async () => {
    const ctx = await bootApp({
      enqueue_run: () => {
        throw new Error('backend not ready');
      },
    });
    const textarea = composerTextarea();
    await ctx.user.clear(textarea);
    await ctx.user.type(textarea, 'Doomed prompt');
    await ctx.user.keyboard('{Enter}');

    // Scoped to the conversation panel — the same notice also mirrors into
    // the (closed) terminal dock.
    expect(
      await convo().findByText(t('composerSection.sendFailed', { message: 'backend not ready' })),
    ).toBeInTheDocument();
    // The prompt is still there for a retry.
    expect(composerTextarea().value).toBe('Doomed prompt');
  });
});

describe('session tabs and history', () => {
  it('creates a fresh session and switches back through the history row', async () => {
    const ctx = await bootApp();
    const { tauri, user } = ctx;

    const runId = await submitPrompt(ctx, 'Fix the login flake');
    await act(async () => {
      await tauri.streamReply(runId, ['Login flake fixed.']);
    });
    await waitFor(() => {
      expect(document.querySelector('.message-assistant')).toHaveTextContent('Login flake fixed.');
    });

    // New Session → clean slate in the conversation panel.
    await user.click(screen.getByRole('button', { name: new RegExp(t('nav.newSession')) }));
    expect(await convo().findByText(t('emptyState.title'))).toBeInTheDocument();
    expect(convo().queryByText('Fix the login flake')).not.toBeInTheDocument();

    // The old conversation shows up in HISTORY; clicking it restores it.
    const row = await screen.findByRole('button', { name: /Fix the login flake/ });
    await user.click(row);
    expect(await convo().findByText('Fix the login flake')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.message-assistant')).toHaveTextContent('Login flake fixed.');
    });
  });

  it('clears the conversation with an undo window that restores it', async () => {
    const ctx = await bootApp();
    const { tauri, user } = ctx;

    const runId = await submitPrompt(ctx, 'Document the parser');
    await act(async () => {
      await tauri.streamReply(runId, ['Parser documented.']);
    });
    await convo().findByText('Document the parser');

    // ⌘K → "Clear current conversation".
    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByRole('dialog', { name: t('palette.ariaLabel') });
    expect(palette).toBeInTheDocument();
    await user.keyboard('clear current');
    await user.keyboard('{Enter}');

    expect(await convo().findByText(t('emptyState.title'))).toBeInTheDocument();
    expect(convo().queryByText('Document the parser')).not.toBeInTheDocument();
    expect(screen.getByText(t('notices.cleared'))).toBeInTheDocument();

    // Undo brings the conversation back.
    await user.click(screen.getByRole('button', { name: t('common.undo') }));
    expect(await convo().findByText('Document the parser')).toBeInTheDocument();
  });
});

describe('command palette, settings, panels, shortcuts', () => {
  it('opens Settings from the palette and closes it again', async () => {
    const { user } = await bootApp();

    await user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: t('palette.ariaLabel') });
    await user.keyboard('open settings');
    await user.keyboard('{Enter}');

    // Settings modal is up; switch to the model section, then close.
    const dialog = await screen.findByRole('dialog', { name: t('settings.title') });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('settings.nav.model') }));
    expect(
      await within(dialog).findByRole('heading', { name: t('settings.nav.model') }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('settings.close') }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t('settings.title') })).not.toBeInTheDocument();
    });
  });

  it('opens the Terminal panel from the panels menu and closes it with Escape', async () => {
    const { user } = await bootApp();

    // The dock is a <details>; its children stay in the jsdom DOM either way,
    // so the open/closed state is the `open` attribute.
    const dock = () => document.querySelector('details.terminal-dock');
    expect(dock()).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: t('titleBar.panelsAria') }));
    await user.click(await screen.findByRole('menuitem', { name: /Terminal/ }));
    await waitFor(() => expect(dock()).toHaveAttribute('open'));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(dock()).not.toHaveAttribute('open'));
  });

  it('toggles the sidebar with ⌘B and the theme with ⌘⇧L', async () => {
    const { view, user } = await bootApp();
    const shell = view.container.querySelector('main.app-shell')!;

    expect(shell.className).not.toContain('sidebar-collapsed');
    await user.keyboard('{Meta>}b{/Meta}');
    await waitFor(() => expect(shell.className).toContain('sidebar-collapsed'));
    expect(window.localStorage.getItem('grok-desktop-sidebar-collapsed')).toBe('1');
    await user.keyboard('{Meta>}b{/Meta}');
    await waitFor(() => expect(shell.className).not.toContain('sidebar-collapsed'));

    expect(shell.className).toContain('theme-dark');
    await user.keyboard('{Meta>}{Shift>}L{/Shift}{/Meta}');
    await waitFor(() => expect(shell.className).toContain('theme-light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
