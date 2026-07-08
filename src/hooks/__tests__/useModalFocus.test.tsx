import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useModalFocus } from '../useModalFocus';

/** Minimal dialog harness mirroring how SettingsPage/ToolsPage use the hook. */
function Harness({ onEscape }: { onEscape?: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useModalFocus(open, containerRef, {
    initialFocus: firstRef,
    onEscape: () => {
      onEscape?.();
      setOpen(false);
    },
  });
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Demo" ref={containerRef} tabIndex={-1}>
          <button type="button" ref={firstRef}>
            First
          </button>
          <input aria-label="Middle" />
          <button type="button" onClick={() => setOpen(false)}>
            Last
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe('useModalFocus', () => {
  it('moves focus to the initial element when the dialog opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('Tab cycles forward and wraps from the last element to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    await user.tab();
    expect(screen.getByLabelText('Middle')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab(); // wrap: last → first
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('Shift+Tab wraps from the first element back to the last', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab({ shift: true }); // wrap: first → last
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByLabelText('Middle')).toHaveFocus();
  });

  it('Escape invokes onEscape and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('restores focus to the trigger when the dialog closes by other means', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Last' })); // closes
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
