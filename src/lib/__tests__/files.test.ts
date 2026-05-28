import { describe, expect, it } from 'vitest';
import { extractFileMentions } from '../files';

describe('extractFileMentions', () => {
  it('returns empty for no mentions', () => {
    expect(extractFileMentions('plain prompt with no at-signs')).toEqual([]);
  });

  it('parses a single mention at the start', () => {
    expect(extractFileMentions('@src/lib/grok.ts please review')).toEqual([
      'src/lib/grok.ts',
    ]);
  });

  it('parses multiple mentions separated by whitespace', () => {
    expect(
      extractFileMentions('compare @src/a.ts and @src/b.ts please'),
    ).toEqual(['src/a.ts', 'src/b.ts']);
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
    expect(extractFileMentions('first line\n@second/file.ts ok')).toEqual([
      'second/file.ts',
    ]);
  });
});
