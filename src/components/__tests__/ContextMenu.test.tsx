// Behavior tests for the app-owned right-click menu: positioning, close
// triggers (Escape / outside click / scroll / resize), close-then-run item
// dispatch, focus management, keyboard navigation, accelerators, and hover
// flyout submenus.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from '../ContextMenu';

/** Render the menu and wait past the deferred (setTimeout 0) window-listener
 *  attachment so Escape/outside-click/accelerators are live. */
async function openMenu(items: ContextMenuItem[], pos: { x?: number; y?: number } = {}) {
  const onClose = vi.fn();
  const menu: ContextMenuState = { x: pos.x ?? 40, y: pos.y ?? 40, items };
  const view = render(<ContextMenu menu={menu} onClose={onClose} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
  return { onClose, view, menu };
}

const menuEl = () => document.querySelector('.ctx-menu') as HTMLElement;

const flushMicrotasks = () =>
  act(async () => {
    await Promise.resolve();
  });

describe('ContextMenu', () => {
  it('renders nothing when no menu state is set', () => {
    const { container } = render(<ContextMenu menu={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clamps the position into the viewport (far-off coordinates land inside)', async () => {
    await openMenu([{ label: 'Solo', onClick: vi.fn() }], { x: 5000, y: -100 });
    // jsdom viewport is 1024x768 and measured size is 0x0, pad is 8.
    expect(menuEl().style.left).toBe('1016px');
    expect(menuEl().style.top).toBe('8px');
  });

  it('renders headers, separators, shortcuts and danger styling', async () => {
    await openMenu([
      { label: 'session.ts', header: true },
      { label: 'Pin', onClick: vi.fn(), shortcut: 'P' },
      { label: 'Delete', onClick: vi.fn(), shortcut: '⌫', danger: true, separator: true },
    ]);
    expect(screen.getByText('session.ts')).toHaveClass('ctx-header');
    expect(screen.getByText('P')).toHaveClass('ctx-shortcut');
    expect(document.querySelectorAll('.ctx-sep')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveClass('danger');
    // Headers are not interactive menu items.
    expect(screen.queryByRole('menuitem', { name: 'session.ts' })).not.toBeInTheDocument();
  });

  it('clicking an item closes the menu FIRST, then runs the action on a microtask', async () => {
    const order: string[] = [];
    const action = vi.fn(() => order.push('action'));
    const { onClose } = await openMenu([{ label: 'Rename', onClick: action }]);
    onClose.mockImplementation(() => order.push('close'));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await flushMicrotasks();

    expect(order).toEqual(['close', 'action']);
    // The window capture listener must NOT also fire for in-menu clicks
    // (that race broke every menu item in the production WebView).
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks on disabled items', async () => {
    const action = vi.fn();
    const { onClose } = await openMenu([{ label: 'Nope', onClick: action, disabled: true }]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nope' }));
    await flushMicrotasks();
    expect(action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { onClose } = await openMenu([{ label: 'A', onClick: vi.fn() }]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click or right-click OUTSIDE, but not on in-menu mouse-down areas', async () => {
    const { onClose } = await openMenu([
      { label: 'head', header: true },
      { label: 'A', onClick: vi.fn() },
    ]);
    // Click on a non-interactive part INSIDE the menu: stays open.
    fireEvent.click(screen.getByText('head'));
    expect(onClose).not.toHaveBeenCalled();

    // Right-click INSIDE the menu is swallowed (no nested native menu) and
    // does not close it either.
    const notCancelled = fireEvent.contextMenu(menuEl());
    expect(notCancelled).toBe(false); // defaultPrevented by the menu root
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on scroll and on resize', async () => {
    const { onClose } = await openMenu([{ label: 'A', onClick: vi.fn() }]);
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event('resize'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves focus into the menu on open and hands it back on close', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();

    const onClose = vi.fn();
    const view = render(
      <ContextMenu
        menu={{ x: 10, y: 10, items: [{ label: 'A', onClick: vi.fn() }] }}
        onClose={onClose}
      />,
    );
    expect(menuEl()).toHaveFocus();

    view.rerender(<ContextMenu menu={null} onClose={onClose} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('supports arrow-key navigation (skipping disabled), submenu open/close from the keyboard', async () => {
    const sub1 = vi.fn();
    await openMenu([
      { label: 'Session', header: true },
      { label: 'Alpha', onClick: vi.fn(), shortcut: 'A' },
      { label: 'Beta', onClick: vi.fn(), disabled: true, shortcut: 'B' },
      {
        label: 'More',
        submenu: [
          { label: 'Subhead', header: true },
          { label: 'Sub1', onClick: sub1 },
          { label: 'Sub2', onClick: vi.fn(), separator: true },
        ],
      },
      { label: 'Delete', onClick: vi.fn(), shortcut: '⌫', danger: true, separator: true },
    ]);

    const alpha = screen.getByRole('menuitem', { name: /Alpha/ });
    const more = screen.getByRole('menuitem', { name: /More/ });
    const del = screen.getByRole('menuitem', { name: /Delete/ });

    // First ArrowDown lands on the first enabled item; disabled Beta is skipped.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(more).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(del).toHaveFocus();
    // Wraps around the ends in both directions.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(del).toHaveFocus();

    // Enter on the submenu parent opens the flyout and focuses its first item.
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(more).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const sub1El = screen.getByRole('menuitem', { name: 'Sub1' });
    await waitFor(() => expect(sub1El).toHaveFocus());
    // Submenu header + separator variants render inside the flyout.
    expect(screen.getByText('Subhead')).toHaveClass('ctx-header');
    expect(document.querySelectorAll('.ctx-sep')).toHaveLength(2);

    // ArrowLeft closes the flyout and returns focus to the parent row.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menuitem', { name: 'Sub1' })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    expect(sub1).not.toHaveBeenCalled();
  });

  it('runs items from letter and Delete-key accelerators; disabled shortcuts stay dead', async () => {
    const alpha = vi.fn();
    const beta = vi.fn();
    const del = vi.fn();
    const { onClose } = await openMenu([
      { label: 'Alpha', onClick: alpha, shortcut: 'A' },
      { label: 'Beta', onClick: beta, disabled: true, shortcut: 'B' },
      { label: 'Delete', onClick: del, shortcut: '⌫' },
    ]);

    // Unmatched key: nothing happens.
    fireEvent.keyDown(window, { key: 'z' });
    // Disabled item's shortcut: nothing happens.
    fireEvent.keyDown(window, { key: 'b' });
    await flushMicrotasks();
    expect(beta).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'a' });
    await flushMicrotasks();
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Delete' });
    await flushMicrotasks();
    expect(del).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('an accelerator on a submenu parent opens the flyout instead of running', async () => {
    await openMenu([
      { label: 'Move to', shortcut: 'M', submenu: [{ label: 'Project X', onClick: vi.fn() }] },
    ]);
    fireEvent.keyDown(window, { key: 'm' });
    const item = screen.getByRole('menuitem', { name: 'Project X' });
    await waitFor(() => expect(item).toHaveFocus());
  });

  it('opens the flyout on hover and closes it when the pointer moves on / leaves', async () => {
    const user = userEvent.setup();
    await openMenu([
      { label: 'Alpha', onClick: vi.fn() },
      { label: 'More', submenu: [{ label: 'Sub1', onClick: vi.fn() }] },
      { label: 'Locked', disabled: true, submenu: [{ label: 'Hidden', onClick: vi.fn() }] },
    ]);

    const moreRow = screen.getByRole('menuitem', { name: /More/ }).closest('.ctx-row')!;
    await user.hover(moreRow as HTMLElement);
    expect(screen.getByRole('menuitem', { name: 'Sub1' })).toBeInTheDocument();

    // Hovering a plain item closes the open flyout.
    await user.hover(screen.getByRole('menuitem', { name: 'Alpha' }));
    expect(screen.queryByRole('menuitem', { name: 'Sub1' })).not.toBeInTheDocument();

    // A disabled parent never opens its flyout.
    const lockedRow = screen.getByRole('menuitem', { name: /Locked/ }).closest('.ctx-row')!;
    await user.hover(lockedRow as HTMLElement);
    expect(screen.queryByRole('menuitem', { name: 'Hidden' })).not.toBeInTheDocument();

    // Leaving the whole menu closes any open flyout.
    await user.hover(moreRow as HTMLElement);
    expect(screen.getByRole('menuitem', { name: 'Sub1' })).toBeInTheDocument();
    await user.unhover(menuEl());
    expect(screen.queryByRole('menuitem', { name: 'Sub1' })).not.toBeInTheDocument();
  });
});
