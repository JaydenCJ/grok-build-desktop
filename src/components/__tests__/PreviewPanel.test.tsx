import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewPanel } from '../PreviewPanel';
import type { StaticPreview } from '../../app/types';

function preview(overrides: Partial<StaticPreview> = {}): StaticPreview {
  return {
    available: true,
    root: '/repo/site',
    entryPath: '/repo/site/index.html',
    previewUrl: 'grokpreview://localhost/index.html?token=abc',
    files: [
      { name: 'index.html', path: '/repo/site/index.html', kind: 'html', size: 2048 },
      { name: 'app.js', path: '/repo/site/app.js', kind: 'js', size: 100 },
    ],
    detail: '',
    updatedAt: 1,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof PreviewPanel>[0]> = {}) {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  const utils = render(
    <PreviewPanel
      open
      onClose={onClose}
      staticPreview={preview()}
      previewBusy={false}
      onRefresh={onRefresh}
      {...props}
    />,
  );
  return { ...utils, onClose, onRefresh };
}

describe('PreviewPanel', () => {
  it('renders the iframe against the custom-protocol URL with a strict sandbox', () => {
    const { container } = renderPanel();
    const iframe = container.querySelector('iframe')!;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('src')).toBe('grokpreview://localhost/index.html?token=abc');
    // The sandbox must keep the preview an opaque origin: scripts are allowed
    // but same-origin (which would expose Tauri IPC) must never be.
    expect(iframe.getAttribute('sandbox')).toBe('allow-forms allow-popups allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(screen.getByText('index.html', { selector: '.preview-head span' })).toBeInTheDocument();
  });

  it('shows the empty state with the backend detail when no preview exists', () => {
    const { container } = renderPanel({
      staticPreview: preview({ available: false, previewUrl: '', detail: 'No index.html found.' }),
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('No static preview yet')).toBeInTheDocument();
    expect(screen.getByText('No index.html found.')).toBeInTheDocument();
  });

  it('never renders an iframe when available is set but the URL is missing', () => {
    const { container } = renderPanel({ staticPreview: preview({ previewUrl: '' }) });
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('lists project files with sizes and caps the strip at six entries', () => {
    const files = Array.from({ length: 9 }, (_, i) => ({
      name: `f${i}.html`,
      path: `/p/f${i}.html`,
      kind: 'html',
      size: 1024,
    }));
    const { container } = renderPanel({ staticPreview: preview({ files }) });
    expect(container.querySelectorAll('.preview-files > span')).toHaveLength(6);
    expect(screen.getByText('f0.html')).toBeInTheDocument();
  });

  it('wires refresh and close, disabling refresh while busy', async () => {
    const user = userEvent.setup();
    const { onClose, onRefresh } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    renderPanel({ previewBusy: true });
    const busyButtons = screen.getAllByRole('button', { name: 'Refresh preview' });
    expect(busyButtons[busyButtons.length - 1]).toBeDisabled();
  });
});
