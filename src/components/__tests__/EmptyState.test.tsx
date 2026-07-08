import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('shows the heading and the active model', () => {
    render(<EmptyState activeModel="grok-build" onPickStarter={() => {}} />);
    expect(screen.getByText('How can Grok help today?')).toBeInTheDocument();
    expect(screen.getByText(/grok-build/)).toBeInTheDocument();
  });

  it('clicking a starter card hands its full prompt to the composer', async () => {
    const onPickStarter = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState activeModel="grok-build" onPickStarter={onPickStarter} />);
    await user.click(screen.getByRole('button', { name: /Review this repository/ }));
    expect(onPickStarter).toHaveBeenCalledTimes(1);
    expect(onPickStarter.mock.calls[0][0]).toContain('Review this repository like a senior engineer');
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });
});
