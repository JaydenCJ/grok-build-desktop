// App-level keyboard-routing guard tests: while a confirmation dialog is
// pending, the global shortcuts (⌘K command palette, ⌘, settings, ⌘N new
// tab) must be inert — otherwise a focused action list opens UNDER the
// dialog's backdrop with Enter still wired to it, or the session the pending
// confirmation is about to act on gets swapped away.
//
// The whole App is mounted against a mocked Tauri IPC bridge so the real
// keyboard router (the window "keydown" listener in App.tsx) is under test,
// not a re-implementation of it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { clearMocks, mockConvertFileSrc, mockIPC } from '@tauri-apps/api/mocks';
import App from '../App';
import { requestConfirm, resolveConfirm } from '../lib/confirm';

function mockTauriBridge() {
  mockConvertFileSrc('linux');
  mockIPC((cmd) => {
    switch (cmd) {
      case 'load_session_state':
        return null;
      case 'get_queue':
        return { active: null, queue: [] };
      case 'list_prompts':
        return [];
      case 'get_tool_statuses':
        return [];
      case 'get_grok_auth_status':
        return { installed: false, authenticated: false, detail: '' };
      case 'get_static_preview':
        return null;
      default:
        // Tauri plugin plumbing (plugin:event|listen etc.) and anything the
        // mount path invokes fire-and-forget: succeed with an empty value.
        return null;
    }
  });
}

async function fireShortcut(key: string) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }),
  );
  // Flush the resulting state updates.
  await Promise.resolve();
}

describe('global shortcut guards while a confirm dialog is pending', () => {
  beforeEach(() => {
    // jsdom lacks scrollIntoView (used by the palette's keyboard scrolling).
    Element.prototype.scrollIntoView = vi.fn();
    mockTauriBridge();
  });

  afterEach(() => {
    resolveConfirm(false);
    cleanup();
    clearMocks();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('⌘K opens the command palette when no confirm is pending (control case)', async () => {
    render(<App />);
    await fireShortcut('k');
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('⌘K is swallowed while a confirm is pending', async () => {
    render(<App />);
    const pending = requestConfirm({ title: 'Clear conversation?', message: 'Sure?' });
    await screen.findByRole('alertdialog', { name: 'Clear conversation?' });

    await fireShortcut('k');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();

    // Once resolved, the shortcut works again — the guard is scoped to the
    // pending confirm, not a permanent latch.
    resolveConfirm(false);
    await pending;
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await fireShortcut('k');
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('⌘, (settings) is swallowed while a confirm is pending', async () => {
    render(<App />);
    const pending = requestConfirm({ title: 'Clear conversation?', message: 'Sure?' });
    await screen.findByRole('alertdialog');

    await fireShortcut(',');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();

    // Control case: once the confirm resolves, the same shortcut opens
    // Settings — proving the assertion above tested the guard, not a broken
    // selector.
    resolveConfirm(false);
    await pending;
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await fireShortcut(',');
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });

  it('⌘N (new conversation) works normally but is swallowed while a confirm is pending', async () => {
    render(<App />);
    const tabCount = () =>
      (JSON.parse(window.localStorage.getItem('grok-desktop-tabs-v1') ?? '[]') as unknown[])
        .length;

    // Control case: ⌘N creates a conversation (persisted tab list grows).
    await fireShortcut('n');
    await waitFor(() => expect(tabCount()).toBe(2));

    const pending = requestConfirm({ title: 'Clear conversation?', message: 'Sure?' });
    await screen.findByRole('alertdialog');

    await fireShortcut('n');
    // Give any (wrong) tab-creation state update a chance to land.
    await new Promise((r) => setTimeout(r, 20));
    expect(tabCount()).toBe(2);

    resolveConfirm(false);
    await pending;
  });
});
