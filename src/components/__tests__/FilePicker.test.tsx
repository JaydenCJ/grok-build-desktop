import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockIPC } from '@tauri-apps/api/mocks';
import { FilePicker } from '../FilePicker';
import type { FileEntry } from '../../lib/files';

// jsdom has no scrollIntoView; the picker calls it to keep the highlighted
// row visible during arrow-key navigation.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const RAW_ENTRIES = [
  { path: 'src/a.ts', display_name: 'a.ts', size_bytes: 10 },
  { path: 'src/b.ts', display_name: 'b.ts', size_bytes: 20 },
  { path: 'docs/notes.md', display_name: 'notes.md', size_bytes: 30 },
];

function mockGlob(entries = RAW_ENTRIES) {
  const calls: unknown[] = [];
  mockIPC((cmd, payload) => {
    if (cmd === 'glob_files') {
      calls.push(payload);
      return entries;
    }
    return undefined;
  });
  return calls;
}

function renderPicker(overrides: Partial<Parameters<typeof FilePicker>[0]> = {}) {
  const onSelect = vi.fn<(entry: FileEntry) => void>();
  const onCancel = vi.fn();
  render(
    <FilePicker cwd="/repo" query="src" onSelect={onSelect} onCancel={onCancel} {...overrides} />,
  );
  return { onSelect, onCancel };
}

describe('FilePicker', () => {
  it('debounce-fetches matches for the query and renders them with a count', async () => {
    const calls = mockGlob();
    renderPicker();

    expect(await screen.findByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByText('3 matches')).toBeInTheDocument();
    expect(screen.getByText('@src')).toBeInTheDocument();
    expect(calls).toEqual([{ cwd: '/repo', query: 'src', limit: 25 }]);
    // First row starts highlighted.
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the empty-query prompt and singular match label', async () => {
    mockGlob([RAW_ENTRIES[0]!]);
    renderPicker({ query: '  ' });
    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(screen.getByText('Type to search files in cwd')).toBeInTheDocument();
  });

  it('moves the highlight with arrow keys and inserts with Enter', async () => {
    mockGlob();
    const { onSelect, onCancel } = renderPicker();
    await screen.findByText('a.ts');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({
      path: 'src/b.ts',
      displayName: 'b.ts',
      sizeBytes: 20,
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('clamps arrow navigation at both ends of the list', async () => {
    mockGlob();
    renderPicker();
    await screen.findByText('a.ts');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    for (let i = 0; i < 6; i += 1) fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('inserts the highlighted entry with Tab', async () => {
    mockGlob();
    const { onSelect } = renderPicker();
    await screen.findByText('a.ts');

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(onSelect).toHaveBeenCalledWith({
      path: 'src/a.ts',
      displayName: 'a.ts',
      sizeBytes: 10,
    });
  });

  it('dismisses on Escape', async () => {
    mockGlob();
    const { onSelect, onCancel } = renderPicker();
    await screen.findByText('a.ts');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('dismisses instead of inserting when Enter is pressed with no matches', async () => {
    mockGlob([]);
    const { onSelect, onCancel } = renderPicker({ query: 'zzz' });
    expect(await screen.findByText(/No files matched/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('surfaces a listing failure distinctly from "no matches"', async () => {
    mockIPC((cmd) => {
      if (cmd === 'glob_files') throw new Error('cwd does not exist');
      return undefined;
    });
    const { onSelect, onCancel } = renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not list files: cwd does not exist',
    );
    expect(screen.getByText('listing failed')).toBeInTheDocument();
    expect(screen.queryByText(/No files matched/)).not.toBeInTheDocument();

    // Enter has nothing to insert — dismiss, same as the empty state.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clears the error state once a later query succeeds', async () => {
    let fail = true;
    mockIPC((cmd) => {
      if (cmd !== 'glob_files') return undefined;
      if (fail) throw new Error('transient');
      return RAW_ENTRIES;
    });
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <FilePicker cwd="/repo" query="src" onSelect={onSelect} onCancel={onCancel} />,
    );
    await screen.findByRole('alert');

    fail = false;
    rerender(<FilePicker cwd="/repo" query="docs" onSelect={onSelect} onCancel={onCancel} />);
    expect(await screen.findByText('a.ts')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('3 matches')).toBeInTheDocument();
  });

  it('selects an entry on mousedown and highlights on hover', async () => {
    mockGlob();
    const { onSelect } = renderPicker();
    await screen.findByText('a.ts');

    const rows = screen.getAllByRole('option');
    fireEvent.mouseEnter(rows[2]!);
    await waitFor(() => expect(rows[2]).toHaveAttribute('aria-selected', 'true'));
    fireEvent.mouseDown(rows[2]!);
    expect(onSelect).toHaveBeenCalledWith({
      path: 'docs/notes.md',
      displayName: 'notes.md',
      sizeBytes: 30,
    });
  });

  it('refetches when the query prop changes', async () => {
    const calls = mockGlob();
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <FilePicker cwd="/repo" query="src" onSelect={onSelect} onCancel={onCancel} />,
    );
    await screen.findByText('a.ts');

    rerender(<FilePicker cwd="/repo" query="docs" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() =>
      expect(calls).toEqual([
        { cwd: '/repo', query: 'src', limit: 25 },
        { cwd: '/repo', query: 'docs', limit: 25 },
      ]),
    );
    expect(screen.getByText('@docs')).toBeInTheDocument();
  });
});
