// Component tests for the ConfirmDialog guard behavior:
// focus lands on Cancel, Esc cancels, Tab / Shift+Tab are trapped inside the
// dialog (cycling Cancel ↔ Confirm, pulling strays back in), and the
// capture-phase listener stops dialog keys from ever reaching bubble-phase
// listeners like App's global keyboard router.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../ConfirmDialog';
import { isConfirmOpen, requestConfirm, resolveConfirm } from '../../lib/confirm';

afterEach(() => {
  // The confirm store is module-global — drain any pending request so a
  // failed test can't leak an open dialog into the next one.
  resolveConfirm(false);
  cleanup();
});

function openConfirm(overrides: Partial<Parameters<typeof requestConfirm>[0]> = {}) {
  return requestConfirm({
    title: 'Clear conversation?',
    message: 'This wipes messages and run history.',
    danger: true,
    ...overrides,
  });
}

describe('ConfirmDialog', () => {
  it('renders the pending request and focuses Cancel, not the destructive Confirm', async () => {
    render(<ConfirmDialog />);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    const result = openConfirm();
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear conversation?' });
    expect(dialog).toBeTruthy();
    expect(isConfirmOpen()).toBe(true);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    resolveConfirm(false);
    await expect(result).resolves.toBe(false);
  });

  it('Escape cancels: resolves false and closes the dialog', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    const result = openConfirm();
    await screen.findByRole('alertdialog');

    await user.keyboard('{Escape}');

    await expect(result).resolves.toBe(false);
    expect(isConfirmOpen()).toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('traps Tab: cycles Cancel → Confirm → Cancel instead of walking into the page', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">background control</button>
        <ConfirmDialog />
      </>,
    );
    const result = openConfirm();
    await screen.findByRole('alertdialog');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(confirm);
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(cancel);
    // Never the background button — the trap owns Tab entirely.
    await user.keyboard('{Tab}{Tab}{Tab}');
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'background control' }));

    resolveConfirm(false);
    await expect(result).resolves.toBe(false);
  });

  it('traps Shift+Tab the same way', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    const result = openConfirm();
    await screen.findByRole('alertdialog');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(confirm);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(cancel);

    resolveConfirm(false);
    await expect(result).resolves.toBe(false);
  });

  it('pulls focus back to Cancel when it escaped the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">background control</button>
        <ConfirmDialog />
      </>,
    );
    const result = openConfirm();
    await screen.findByRole('alertdialog');

    // Simulate focus having ended up outside the dialog (programmatic focus,
    // a stray mousedown, etc.) — the next Tab must recapture it.
    screen.getByRole('button', { name: 'background control' }).focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));

    resolveConfirm(false);
    await expect(result).resolves.toBe(false);
  });

  it('handles Escape and Tab in the capture phase so bubble-phase global routers never see them', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    const result = openConfirm();
    await screen.findByRole('alertdialog');

    const seen: string[] = [];
    const bubbleListener = (e: KeyboardEvent) => {
      seen.push(e.key);
    };
    // Same registration shape as App's global keyboard router (bubble phase).
    window.addEventListener('keydown', bubbleListener);
    try {
      await user.keyboard('{Tab}');
      await user.keyboard('{Escape}');
      expect(seen).not.toContain('Tab');
      expect(seen).not.toContain('Escape');
    } finally {
      window.removeEventListener('keydown', bubbleListener);
    }

    await expect(result).resolves.toBe(false);
  });

  it('confirm button resolves true; clicking the backdrop cancels', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);

    const accepted = openConfirm();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(accepted).resolves.toBe(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    const cancelled = openConfirm();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(dialog); // backdrop itself, not the inner card
    await expect(cancelled).resolves.toBe(false);
  });
});
