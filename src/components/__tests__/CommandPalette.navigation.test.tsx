// Behavior tests for the ⌘K CommandPalette: open/close lifecycle, substring
// filtering across label/hint/group, keyboard navigation (↑/↓/⏎/⎋), IME
// guards, highlight clamping when the action list shrinks, and the
// backdrop-vs-shell click contract.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type PaletteAction } from '../CommandPalette';

beforeEach(() => {
  // jsdom has no scrollIntoView; the palette calls it to keep the highlighted
  // row visible.
  Element.prototype.scrollIntoView = vi.fn();
});

function makeActions() {
  const runs = {
    newSession: vi.fn(),
    openSettings: vi.fn(),
    toggleTheme: vi.fn(),
  };
  const actions: PaletteAction[] = [
    { id: 'new-session', label: 'New session', group: 'Session', run: runs.newSession },
    {
      id: 'open-settings',
      label: 'Open Settings',
      hint: 'preferences',
      shortcut: '⌘,',
      run: runs.openSettings,
    },
    { id: 'toggle-theme', label: 'Toggle theme', group: 'Theme', run: runs.toggleTheme },
  ];
  return { actions, runs };
}

function renderPalette(overrides: { open?: boolean; actions?: PaletteAction[] } = {}) {
  const { actions, runs } = makeActions();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette
      open={overrides.open ?? true}
      actions={overrides.actions ?? actions}
      onClose={onClose}
    />,
  );
  return { ...utils, actions, runs, onClose };
}

/** The queueMicrotask inside run() needs one microtask turn to fire. */
const flushMicrotasks = () => Promise.resolve();

describe('CommandPalette open/close lifecycle', () => {
  it('renders nothing while closed', () => {
    renderPalette({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as an aria-modal dialog with focus in the search input', () => {
    renderPalette();
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByPlaceholderText('Type a command…')).toHaveFocus();
    // All actions listed, with group and shortcut adornments.
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('Session')).toBeInTheDocument();
    expect(screen.getByText('⌘,')).toBeInTheDocument();
  });

  it('resets the query and highlight when reopened', async () => {
    const { actions, onClose, rerender } = renderPalette();
    const user = userEvent.setup();
    await user.keyboard('theme');
    expect(screen.getAllByRole('option')).toHaveLength(1);

    rerender(<CommandPalette open={false} actions={actions} onClose={onClose} />);
    rerender(<CommandPalette open actions={actions} onClose={onClose} />);

    expect(screen.getByPlaceholderText('Type a command…')).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /New session/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('closes on Escape and on backdrop click, but not on clicks inside the shell', async () => {
    const { onClose } = renderPalette();
    const user = userEvent.setup();

    // Click inside the shell (the search input) — stopPropagation keeps it open.
    await user.click(screen.getByPlaceholderText('Type a command…'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('CommandPalette filtering', () => {
  it('filters by label, hint and group (case-insensitive) and shows an empty state', async () => {
    renderPalette();
    const user = userEvent.setup();

    await user.keyboard('THEME');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Toggle theme/ })).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Type a command…'));
    await user.keyboard('preferences'); // matches the hint only
    expect(screen.getByRole('option', { name: /Open Settings/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.clear(screen.getByPlaceholderText('Type a command…'));
    await user.keyboard('zzz-no-such-command');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('No commands match.')).toBeInTheDocument();
  });
});

describe('CommandPalette keyboard navigation', () => {
  it('moves the highlight with arrows, clamps at both ends, and Enter runs the pick', async () => {
    const { runs, onClose } = renderPalette();
    const user = userEvent.setup();

    // Down twice → third row; a third Down must clamp at the last row.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('option', { name: /Toggle theme/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Up moves back; Up at the top clamps at 0.
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('option', { name: /New session/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(runs.openSettings).toHaveBeenCalledTimes(1);
    expect(runs.newSession).not.toHaveBeenCalled();
    expect(runs.toggleTheme).not.toHaveBeenCalled();
  });

  it('does nothing on Enter when no command matches', async () => {
    const { runs, onClose } = renderPalette();
    const user = userEvent.setup();
    await user.keyboard('zzz{Enter}');
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();
    expect(runs.newSession).not.toHaveBeenCalled();
    expect(runs.openSettings).not.toHaveBeenCalled();
    expect(runs.toggleTheme).not.toHaveBeenCalled();
  });

  it('ignores Enter and arrows while an IME composition is in flight', async () => {
    const { runs, onClose } = renderPalette();
    const input = screen.getByPlaceholderText('Type a command…');

    // keyCode 229 is the mid-composition signal some browsers emit.
    fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 229 });
    expect(screen.getByRole('option', { name: /New session/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();
    expect(runs.newSession).not.toHaveBeenCalled();
  });

  it('clamps the highlight when the action list shrinks under it', async () => {
    const { actions, runs, onClose, rerender } = renderPalette();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}{ArrowDown}'); // highlight = index 2

    // Host removes the last action (e.g. context-dependent command goes away).
    rerender(<CommandPalette open actions={actions.slice(0, 2)} onClose={onClose} />);
    expect(screen.getByRole('option', { name: /Open Settings/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Enter}');
    await flushMicrotasks();
    expect(runs.openSettings).toHaveBeenCalledTimes(1);
    expect(runs.toggleTheme).not.toHaveBeenCalled();
  });
});

describe('CommandPalette mouse interaction', () => {
  it('hovering highlights a row and clicking runs it then closes', async () => {
    const { runs, onClose } = renderPalette();
    const user = userEvent.setup();

    const themeRow = screen.getByRole('option', { name: /Toggle theme/ });
    await user.hover(themeRow);
    expect(themeRow).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /New session/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    await user.click(themeRow);
    expect(onClose).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(runs.toggleTheme).toHaveBeenCalledTimes(1);
  });
});
