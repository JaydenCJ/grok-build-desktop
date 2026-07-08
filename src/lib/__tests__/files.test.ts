import { describe, expect, it, vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import { extractFileMentions, globFiles, readFileSafe } from '../files';

describe('extractFileMentions', () => {
  it('returns empty for no mentions', () => {
    expect(extractFileMentions('plain prompt with no at-signs')).toEqual([]);
  });

  it('parses a single mention at the start', () => {
    expect(extractFileMentions('@src/lib/grok.ts please review')).toEqual(['src/lib/grok.ts']);
  });

  it('parses multiple mentions separated by whitespace', () => {
    expect(extractFileMentions('compare @src/a.ts and @src/b.ts please')).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('dedupes repeated mentions', () => {
    expect(extractFileMentions('@x.ts and again @x.ts')).toEqual(['x.ts']);
  });

  it('ignores @ inside words (e.g. emails)', () => {
    // 'user@domain.com' — the @ here is NOT preceded by whitespace, so it
    // shouldn't kick off a file mention.
    expect(extractFileMentions('email me at user@domain.com please')).toEqual([]);
  });

  it('handles newlines as whitespace', () => {
    expect(extractFileMentions('first line\n@second/file.ts ok')).toEqual(['second/file.ts']);
  });

  it('parses quoted mentions with spaces in the path', () => {
    expect(extractFileMentions('review @"My Project/notes.md" please')).toEqual([
      'My Project/notes.md',
    ]);
  });

  it('mixes quoted and bare mentions', () => {
    expect(extractFileMentions('@"a dir/x.ts" and @plain/y.ts together')).toEqual([
      'a dir/x.ts',
      'plain/y.ts',
    ]);
  });
});

describe('globFiles', () => {
  it('returns empty without the Tauri runtime', async () => {
    // No mockIPC installed — window.__TAURI_INTERNALS__ is absent.
    await expect(globFiles('/repo', 'src')).resolves.toEqual([]);
  });

  it('trims the cwd and maps snake_case entries to the frontend shape', async () => {
    const payloads: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd !== 'glob_files') return undefined;
      payloads.push(payload);
      return [{ path: 'src/a.ts', display_name: 'a.ts', size_bytes: 42 }];
    });
    await expect(globFiles('  /repo  ', 'a', 10)).resolves.toEqual([
      { path: 'src/a.ts', displayName: 'a.ts', sizeBytes: 42 },
    ]);
    expect(payloads).toEqual([{ cwd: '/repo', query: 'a', limit: 10 }]);
  });

  it('returns empty for a blank cwd without invoking the backend', async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return undefined;
    });
    await expect(globFiles('   ', 'src')).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('swallows backend errors into an empty list with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockIPC((cmd) => {
      if (cmd === 'glob_files') throw new Error('walk failed');
      return undefined;
    });
    await expect(globFiles('/repo', 'src')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith('[grok-desktop] glob_files failed', expect.anything());
    warn.mockRestore();
  });
});

describe('readFileSafe', () => {
  it('returns null without the Tauri runtime', async () => {
    await expect(readFileSafe('/repo', 'a.ts')).resolves.toBeNull();
  });

  it('returns the file body and forwards the byte cap', async () => {
    const payloads: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd !== 'read_file_safe') return undefined;
      payloads.push(payload);
      return 'file body';
    });
    await expect(readFileSafe('/repo', 'a.ts', 1_000)).resolves.toBe('file body');
    expect(payloads).toEqual([{ cwd: '/repo', path: 'a.ts', maxBytes: 1_000 }]);
  });

  it('normalizes a missing file (backend null) to null', async () => {
    mockIPC((cmd) => (cmd === 'read_file_safe' ? null : undefined));
    await expect(readFileSafe('/repo', 'gone.ts')).resolves.toBeNull();
  });

  it('swallows backend errors into null with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockIPC((cmd) => {
      if (cmd === 'read_file_safe') throw new Error('outside cwd');
      return undefined;
    });
    await expect(readFileSafe('/repo', '../etc/passwd')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('[grok-desktop] read_file_safe failed', expect.anything());
    warn.mockRestore();
  });
});
