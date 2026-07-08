import { describe, expect, it } from 'vitest';
import type { ToolRun } from '../../lib/grok';
import {
  formatOutput,
  grokInspectCount,
  grokInspectLine,
  grokInspectSection,
  grokTrust,
  makeId,
  nativeUnavailable,
  parseAvailableModels,
  statusTone,
  terminalClass,
  terminalPrefix,
  terminalText,
  timeLabel,
} from '../format';

function run(overrides: Partial<ToolRun> = {}): ToolRun {
  return {
    ok: true,
    command: 'grok',
    cwd: '/tmp',
    exit_code: 0,
    duration_ms: 12,
    timed_out: false,
    output: '',
    stderr: '',
    ...overrides,
  };
}

describe('makeId', () => {
  it('prefixes and produces distinct ids', () => {
    const a = makeId('u');
    const b = makeId('u');
    expect(a.startsWith('u-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('parseAvailableModels', () => {
  it('returns [] for empty or headerless output', () => {
    expect(parseAvailableModels('')).toEqual([]);
    expect(parseAvailableModels('no models here\n- grok-build')).toEqual([]);
  });

  it('collects bulleted model ids after the header, deduped', () => {
    const output = [
      'Available models:',
      '  * grok-build',
      '  - grok-4-fast-reasoning',
      '  • grok-build',
      '',
      '  * not-part-of-list',
    ].join('\n');
    expect(parseAvailableModels(output)).toEqual(['grok-build', 'grok-4-fast-reasoning']);
  });

  it('skips prose lines before the first bullet but stops after the list ends', () => {
    const output = [
      'Available models',
      'these are yours:',
      '- grok-build',
      'plain text ends the list',
      '- grok-latest',
    ].join('\n');
    expect(parseAvailableModels(output)).toEqual(['grok-build']);
  });
});

describe('timeLabel', () => {
  it('formats a timestamp as a short time string', () => {
    const label = timeLabel(Date.UTC(2026, 0, 1, 12, 34));
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});

describe('nativeUnavailable', () => {
  it('produces a failed run pointing at the desktop shell', () => {
    const result = nativeUnavailable('grok login');
    expect(result.ok).toBe(false);
    expect(result.command).toBe('grok login');
    expect(result.stderr).toContain('tauri:dev');
  });
});

describe('formatOutput', () => {
  it('prefers explicit terminal output', () => {
    expect(formatOutput(run({ output: 'ignored' }), 'live output')).toBe('live output');
  });

  it('handles missing run and silent runs', () => {
    expect(formatOutput(null)).toBe('No run yet.');
    expect(formatOutput(run())).toBe('Command finished without output.');
  });

  it('returns output for successful runs and stderr for silent failures', () => {
    expect(formatOutput(run({ output: 'done' }))).toBe('done');
    expect(formatOutput(run({ ok: false, stderr: 'boom' }))).toBe('boom');
  });

  it('appends stderr to output for failed runs with both streams', () => {
    expect(formatOutput(run({ ok: false, output: 'partial', stderr: 'boom' }))).toBe(
      'partial\n\nstderr:\nboom',
    );
    expect(formatOutput(run({ ok: false, output: 'only-out' }))).toBe('only-out');
  });
});

describe('terminal line helpers', () => {
  it('classifies error, system, code, and plain lines', () => {
    expect(terminalClass('[err] failure')).toBe('terminal-line terminal-error');
    expect(terminalClass('[sys] note')).toBe('terminal-line terminal-system');
    expect(terminalClass('[out] diff --git a b')).toBe('terminal-line terminal-code');
    expect(terminalClass('[out] + added line')).toBe('terminal-line terminal-code');
    expect(terminalClass('[out] plain text')).toBe('terminal-line');
  });

  it('strips and extracts prefixes', () => {
    expect(terminalText('[out] hello')).toBe('hello');
    expect(terminalText('[err] bad')).toBe('bad');
    expect(terminalText('no prefix')).toBe('no prefix');
    expect(terminalPrefix('[err] bad')).toBe('err');
    expect(terminalPrefix('[sys] note')).toBe('sys');
    expect(terminalPrefix('bare line')).toBe('out');
  });
});

describe('statusTone', () => {
  it('maps undefined/installed/missing states', () => {
    expect(statusTone(undefined)).toBe('idle');
    expect(statusTone({ id: 'grok', label: '', command: '', installed: true, detail: '' })).toBe('ready');
    expect(statusTone({ id: 'grok', label: '', command: '', installed: false, detail: '' })).toBe('missing');
  });
});

describe('grok inspect parsing', () => {
  const inspectOutput = [
    'Project trusted: Yes',
    '',
    'Skills (3)',
    '- code-review',
    '1. release-notes',
    '• deploy   helper',
    '',
    'MCP Servers (1)',
    '- filesystem',
    '',
    'Model: grok-build',
  ].join('\n');

  it('extracts section counts with a fallback of 0', () => {
    expect(grokInspectCount(inspectOutput, 'Skills')).toBe('3');
    expect(grokInspectCount(inspectOutput, 'Plugins')).toBe('0');
  });

  it('lists section items with bullets/numbering stripped and whitespace collapsed', () => {
    expect(grokInspectSection(inspectOutput, 'Skills')).toEqual([
      'code-review',
      'release-notes',
      'deploy helper',
    ]);
  });

  it('stops at the next heading and respects the item limit', () => {
    expect(grokInspectSection(inspectOutput, 'Skills', 2)).toEqual(['code-review', 'release-notes']);
    expect(grokInspectSection(inspectOutput, 'MCP Servers')).toEqual(['filesystem']);
    expect(grokInspectSection(inspectOutput, 'Hooks')).toEqual([]);
  });

  it('extracts single lines with a fallback', () => {
    expect(grokInspectLine(inspectOutput, /Model:\s*(.+)/)).toBe('grok-build');
    expect(grokInspectLine(inspectOutput, /Missing:\s*(.+)/)).toBe('unknown');
    expect(grokInspectLine(inspectOutput, /Missing:\s*(.+)/, 'n/a')).toBe('n/a');
  });

  it('reads the project-trust line case-insensitively', () => {
    expect(grokTrust(inspectOutput)).toBe('Yes');
    expect(grokTrust('nothing useful')).toBe('unknown');
  });
});
