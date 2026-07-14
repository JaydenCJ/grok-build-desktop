// Behavior tests for the app entry point (src/main.tsx): bootstrap render
// through the cached React root, the WebView context-menu suppression, and
// the AppErrorBoundary crash screen (reset-session / reload actions).
//
// The real <App/> is replaced with a tiny controllable stub so the entry can
// be imported repeatedly (vi.resetModules) without booting the whole shell.
import { act, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appControl = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('../App', async () => {
  const React = await import('react');
  return {
    default: function MockApp() {
      if (appControl.shouldThrow) throw new Error('boom: corrupted settings');
      return React.createElement('div', { 'data-testid': 'mock-app' }, 'mock app content');
    },
  };
});

type RootLike = { unmount: () => void };
type RootCacheWindow = Window & { __GROK_DESKTOP_ROOT__?: { main?: RootLike } };

const cacheWindow = () => window as unknown as RootCacheWindow;

function container(): HTMLElement {
  return document.getElementById('root') as HTMLElement;
}

async function importEntry() {
  await act(async () => {
    await import('../main');
  });
}

describe('main entry', () => {
  beforeEach(() => {
    appControl.shouldThrow = false;
    const el = document.createElement('div');
    el.id = 'root';
    document.body.appendChild(el);
  });

  afterEach(async () => {
    const root = cacheWindow().__GROK_DESKTOP_ROOT__?.main;
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    delete cacheWindow().__GROK_DESKTOP_ROOT__;
    document.getElementById('root')?.remove();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('renders the app into #root and reuses the cached root on HMR re-imports', async () => {
    await importEntry();
    expect(within(container()).getByTestId('mock-app')).toHaveTextContent('mock app content');

    const firstRoot = cacheWindow().__GROK_DESKTOP_ROOT__?.main;
    expect(firstRoot).toBeTruthy();

    // Simulate a dev-server HMR re-execution of the entry module: the window
    // cache must hand back the SAME root (no duplicate createRoot warning,
    // no second app instance in the DOM).
    vi.resetModules();
    await importEntry();
    expect(cacheWindow().__GROK_DESKTOP_ROOT__?.main).toBe(firstRoot);
    expect(within(container()).getAllByTestId('mock-app')).toHaveLength(1);
  });

  it('suppresses the native context menu everywhere except editable fields', async () => {
    await importEntry();

    const plain = document.createElement('div');
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    document.body.append(plain, input, textarea);

    const onPlain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plain.dispatchEvent(onPlain);
    expect(onPlain.defaultPrevented).toBe(true);

    const onInput = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    input.dispatchEvent(onInput);
    expect(onInput.defaultPrevented).toBe(false);

    const onTextarea = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    textarea.dispatchEvent(onTextarea);
    expect(onTextarea.defaultPrevented).toBe(false);

    plain.remove();
    input.remove();
    textarea.remove();
  });

  it('catches a render crash and resets only grok-desktop-* localStorage keys', async () => {
    // Silence React's error-boundary logging and componentDidCatch output.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appControl.shouldThrow = true;

    window.localStorage.setItem('grok-desktop-session', 'corrupted');
    window.localStorage.setItem('grok-desktop-theme', 'dark');
    window.localStorage.setItem('unrelated-key', 'keep-me');

    await importEntry();

    const scope = within(container());
    expect(scope.getByText('Grok Desktop hit a rendering error')).toBeInTheDocument();
    // The crash stack is surfaced so a bug report is actionable.
    expect(scope.getByText(/boom: corrupted settings/)).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith(
      '[grok-desktop] render error:',
      expect.any(Error),
      expect.anything(),
    );

    fireEvent.click(scope.getByRole('button', { name: 'Reset session and reload' }));

    expect(window.localStorage.getItem('grok-desktop-session')).toBeNull();
    expect(window.localStorage.getItem('grok-desktop-theme')).toBeNull();
    expect(window.localStorage.getItem('unrelated-key')).toBe('keep-me');
  });

  it('still reloads when clearing localStorage fails, and logs the failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appControl.shouldThrow = true;
    window.localStorage.setItem('grok-desktop-session', 'corrupted');

    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    try {
      await importEntry();
      const scope = within(container());

      fireEvent.click(scope.getByRole('button', { name: 'Reset session and reload' }));
      expect(errorSpy).toHaveBeenCalledWith('[grok-desktop] reset failed:', expect.any(Error));

      // The plain Reload button must not throw either (jsdom stubs navigation).
      fireEvent.click(scope.getByRole('button', { name: 'Reload' }));
    } finally {
      removeSpy.mockRestore();
    }
    expect(window.localStorage.getItem('grok-desktop-session')).toBe('corrupted');
  });
});
