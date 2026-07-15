// Third slice of full-<App/> integration tests, covering shell flows the
// first two slices leave out: stop-failure and queue-action-failure notices,
// the conversation context menu's session actions (new session / clear /
// stop / copy selection), searching past WORK through the ⌘K palette, the
// status-bar shortcuts into Settings sections, the dock-position setting,
// the external-link → system-browser delegation, and the persisted
// sidebar-collapsed boot state.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtuosoMockContext } from 'react-virtuoso';
import App from '../App';
import { detachTauriListeners, streamStore } from '../lib/streamStore';
import { storageKeys } from '../app/constants';
import { t } from '../i18n';
import { installTauriAppMock, type CommandHandler, type TauriAppMock } from '../test/tauriAppMock';

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

function convo() {
  return within(document.querySelector('.conversation-panel') as HTMLElement);
}

async function bootApp(overrides: Record<string, CommandHandler> = {}): Promise<Ctx> {
  const ctx = setup(overrides);
  expect(await screen.findByText(t('emptyState.title'))).toBeInTheDocument();
  await waitFor(() => expect(ctx.tauri.commands()).toContain('get_grok_auth_status'));
  return ctx;
}

async function submitPrompt(ctx: Ctx, prompt: string): Promise<string> {
  const before = ctx.tauri.runIds.length;
  const textarea = composerTextarea();
  await ctx.user.clear(textarea);
  await ctx.user.type(textarea, prompt);
  await ctx.user.keyboard('{Enter}');
  await waitFor(() => expect(ctx.tauri.runIds.length).toBeGreaterThan(before));
  return ctx.tauri.runIds[ctx.tauri.runIds.length - 1]!;
}

describe('failure notices', () => {
  it('a rejected cancel_run surfaces as a Stop-failed session notice', async () => {
    const ctx = await bootApp({
      cancel_run: () => {
        throw new Error('queue locked');
      },
    });
    const runId = await submitPrompt(ctx, 'Never-ending task');
    await act(async () => {
      await ctx.tauri.emitQueue(runId, []);
      await ctx.tauri.emitRunState(runId, 'Running', { startedAt: Date.now() });
    });

    await ctx.user.click(await screen.findByRole('button', { name: t('titleBar.stop') }));
    await waitFor(() => {
      expect(document.querySelector('.session-toast')).toHaveTextContent(
        t('notices.stopFailed', { error: 'queue locked' }),
      );
    });
    // The run keeps streaming — nothing was cancelled.
    expect(screen.getByRole('button', { name: t('titleBar.stop') })).toBeInTheDocument();
  });

  it('a failed queue action (Cancel all) surfaces through the QueueDock onError notice', async () => {
    await bootApp({
      get_queue: () => ({
        active: null,
        queue: [{ id: 'q1', prompt: 'pending job', state: 'Queued', enqueuedAt: Date.now() }],
      }),
      cancel_pending_runs: () => {
        throw new Error('backend gone');
      },
    });

    // Last session left a pending task → the resume banner appears.
    expect(await screen.findByText(/pending task/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('queue.cancelAll') }));

    await waitFor(() => {
      expect(document.querySelector('.session-toast')).toHaveTextContent(
        t('notices.queueActionFailed', { error: 'backend gone' }),
      );
    });
    // Failure keeps the banner up for a retry.
    expect(screen.getByText(/pending task/)).toBeInTheDocument();
  });
});

describe('conversation context menu', () => {
  it('disables Clear conversation while empty and starts a fresh session from the menu', async () => {
    const ctx = await bootApp();
    const panel = document.querySelector('.conversation-panel') as HTMLElement;

    fireEvent.contextMenu(panel);
    const clear = await screen.findByRole('menuitem', { name: 'Clear conversation' });
    expect(clear).toBeDisabled();
    // No run is active → no Stop item.
    expect(screen.queryByRole('menuitem', { name: 'Stop current run' })).not.toBeInTheDocument();

    await ctx.user.click(screen.getByRole('menuitem', { name: 'New session' }));
    await waitFor(() => expect(composerTextarea()).toHaveFocus());
    expect(convo().getByText(t('emptyState.title'))).toBeInTheDocument();
  });

  it('offers Stop current run while streaming and cancels through it', async () => {
    const ctx = await bootApp();
    const runId = await submitPrompt(ctx, 'Slow analysis');
    await act(async () => {
      await ctx.tauri.emitQueue(runId, []);
      await ctx.tauri.emitRunState(runId, 'Running', { startedAt: Date.now() });
    });

    fireEvent.contextMenu(document.querySelector('.conversation-panel') as HTMLElement);
    // With messages present, Clear conversation is enabled now.
    expect(await screen.findByRole('menuitem', { name: 'Clear conversation' })).toBeEnabled();
    await ctx.user.click(screen.getByRole('menuitem', { name: 'Stop current run' }));
    await waitFor(() => {
      expect(ctx.tauri.calls.find((c) => c.cmd === 'cancel_run')?.args).toEqual({ runId });
    });
  });

  it('clears the conversation from the menu once it has messages', async () => {
    const ctx = await bootApp();
    await submitPrompt(ctx, 'Prune the changelog');
    await convo().findByText('Prune the changelog');

    fireEvent.contextMenu(document.querySelector('.conversation-panel') as HTMLElement);
    await ctx.user.click(await screen.findByRole('menuitem', { name: 'Clear conversation' }));

    expect(await convo().findByText(t('emptyState.title'))).toBeInTheDocument();
    expect(convo().queryByText('Prune the changelog')).not.toBeInTheDocument();
    // Destructive → an undo window opens.
    expect(screen.getByText(t('notices.cleared'))).toBeInTheDocument();
  });

  it('shows a Copy item for the current text selection and copies it', async () => {
    const ctx = await bootApp();
    await submitPrompt(ctx, 'Copy source text');
    const bubble = await convo().findByText('Copy source text');

    // Select the user bubble's text, then right-click.
    const range = document.createRange();
    range.selectNodeContents(bubble);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    fireEvent.contextMenu(document.querySelector('.conversation-panel') as HTMLElement);
    await ctx.user.click(await screen.findByRole('menuitem', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Copy source text'));
  });
});

describe('⌘K searches past work', () => {
  it('lists recent conversations as History actions and switches back through one', async () => {
    const ctx = await bootApp();
    const runId = await submitPrompt(ctx, 'Refactor the audio pipeline');
    await act(async () => {
      await ctx.tauri.streamReply(runId, ['Pipeline refactored.']);
    });

    // Start a clean session so the old conversation only lives in history.
    await ctx.user.click(screen.getByRole('button', { name: new RegExp(t('nav.newSession')) }));
    expect(await convo().findByText(t('emptyState.title'))).toBeInTheDocument();

    await ctx.user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: t('palette.ariaLabel') });
    await ctx.user.keyboard('audio pipeline');

    // The match is the history entry, grouped under History.
    const option = await screen.findByRole('option', {
      name: /Refactor the audio pipeline/,
    });
    expect(option).toHaveTextContent('History');
    await ctx.user.keyboard('{Enter}');

    expect(await convo().findByText('Refactor the audio pipeline')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('.message-assistant')).toHaveTextContent(
        'Pipeline refactored.',
      );
    });
  });
});

describe('deleting a conversation from the history sidebar', () => {
  it('removes the row with an undo toast that restores it', async () => {
    const ctx = await bootApp();
    const runId = await submitPrompt(ctx, 'Archive the release plan');
    await act(async () => {
      await ctx.tauri.streamReply(runId, ['Archived.']);
    });
    // Park the conversation in history behind a fresh session.
    await ctx.user.click(screen.getByRole('button', { name: new RegExp(t('nav.newSession')) }));
    await convo().findByText(t('emptyState.title'));

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Archive the release plan/ }));
    const menu = await screen.findByRole('menu');
    await ctx.user.click(within(menu).getByRole('menuitem', { name: /Delete conversation/ }));

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Archive the release plan/ }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(t('notices.conversationDeleted'))).toBeInTheDocument();

    await ctx.user.click(screen.getByRole('button', { name: t('common.undo') }));
    expect(
      await screen.findByRole('button', { name: /Archive the release plan/ }),
    ).toBeInTheDocument();
  });
});

describe('panels: context inspector and preview controls', () => {
  it('opens the Context inspector from the panels menu, re-docks it, and closes it', async () => {
    const { user } = await bootApp();

    // The drawer is a <details>: its content stays in the jsdom DOM either
    // way, so the open/closed state is the `open` attribute (like the
    // terminal dock).
    const drawer = () => document.querySelector('details.inspector-drawer');
    expect(drawer()).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: t('titleBar.panelsAria') }));
    await user.click(await screen.findByRole('menuitem', { name: /Context inspector/ }));
    await waitFor(() => expect(drawer()).toHaveAttribute('open'));
    const inspector = screen.getByRole('complementary', { name: t('inspector.ariaLabel') });

    // The dock toggle flips the workspace dock and persists the choice.
    const workspace = () => document.querySelector('section.workspace')!;
    expect(workspace().className).toContain('dock-right');
    await user.click(within(inspector).getByRole('button', { name: t('inspector.toggleDock') }));
    await waitFor(() => expect(workspace().className).toContain('dock-bottom'));
    expect(window.localStorage.getItem(storageKeys.dockPosition)).toBe('bottom');

    await user.click(within(inspector).getByRole('button', { name: t('inspector.close') }));
    await waitFor(() => expect(drawer()).not.toHaveAttribute('open'));
  });

  it('the preview panel refresh button re-probes the static preview', async () => {
    const { tauri, user } = await bootApp();

    await user.click(screen.getByRole('button', { name: t('titleBar.panelsAria') }));
    await user.click(await screen.findByRole('menuitem', { name: /Preview/ }));
    const panel = await screen.findByRole('complementary', { name: t('preview.ariaLabel') });

    const probes = () => tauri.commands().filter((c) => c === 'get_static_preview').length;
    const refresh = within(panel).getByRole('button', { name: t('preview.refresh') });
    // The open-triggered probe may still be in flight (button disabled while busy).
    await waitFor(() => expect(refresh).toBeEnabled());
    const before = probes();
    await user.click(refresh);
    await waitFor(() => expect(probes()).toBeGreaterThan(before));
  });

  it('opens the Tools & MCP page from the palette and closes it with Escape', async () => {
    const { user } = await bootApp();

    await user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: t('palette.ariaLabel') });
    await user.keyboard('Open Tools');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: t('tools.ariaLabel') })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t('tools.ariaLabel') })).not.toBeInTheDocument();
    });
  });
});

describe('status bar and settings wiring', () => {
  it('the model and policy chips open Settings on their sections', async () => {
    const { user } = await bootApp();

    await user.click(screen.getByTitle(t('workspace.changeModelTitle')));
    let dialog = await screen.findByRole('dialog', { name: t('settings.title') });
    expect(
      await within(dialog).findByRole('heading', { name: t('settings.nav.model') }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('settings.close') }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t('settings.title') })).not.toBeInTheDocument();
    });

    await user.click(screen.getByTitle(t('workspace.changePolicyTitle')));
    dialog = await screen.findByRole('dialog', { name: t('settings.title') });
    expect(
      await within(dialog).findByRole('heading', { name: t('settings.nav.permissions') }),
    ).toBeInTheDocument();
  });

  it('changing the dock position in Settings re-docks the workspace and persists', async () => {
    const { user } = await bootApp();
    const workspace = () => document.querySelector('section.workspace')!;
    expect(workspace().className).toContain('dock-right');

    await user.keyboard('{Meta>},{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: t('settings.title') });
    await user.selectOptions(within(dialog).getByLabelText(t('settings.dockPosition')), 'bottom');

    await waitFor(() => expect(workspace().className).toContain('dock-bottom'));
    expect(window.localStorage.getItem(storageKeys.dockPosition)).toBe('bottom');
  });
});

describe('external links open in the system browser', () => {
  it('routes http(s) anchors through the opener plugin instead of navigating the webview', async () => {
    const { tauri } = await bootApp({
      'plugin:opener|open_url': () => null,
    });

    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/docs';
    anchor.textContent = 'external docs';
    document.body.appendChild(anchor);
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(clickEvent);
    // The document-level handler consumed the click and delegated to Tauri.
    expect(clickEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(tauri.calls.find((c) => c.cmd === 'plugin:opener|open_url')?.args.url).toBe(
        'https://example.com/docs',
      );
    });
    anchor.remove();
  });

  it('leaves non-http anchors alone', async () => {
    const { tauri } = await bootApp({
      'plugin:opener|open_url': () => null,
    });

    const anchor = document.createElement('a');
    anchor.setAttribute('href', '#local-section');
    anchor.textContent = 'in-page anchor';
    document.body.appendChild(anchor);
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(tauri.calls.find((c) => c.cmd === 'plugin:opener|open_url')).toBeUndefined();
    anchor.remove();
  });
});

describe('persisted layout boot state', () => {
  it('boots with the sidebar collapsed when the flag was persisted', async () => {
    window.localStorage.setItem('grok-desktop-sidebar-collapsed', '1');
    const { view } = await bootApp();
    expect(view.container.querySelector('main.app-shell')!.className).toContain(
      'sidebar-collapsed',
    );
  });
});
