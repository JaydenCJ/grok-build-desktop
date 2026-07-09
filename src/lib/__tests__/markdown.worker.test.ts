// Behavior tests for the markdown web worker. jsdom has no dedicated worker
// scope — `self` IS the window — so importing the module registers its
// message handler on window. Tests drive it by dispatching MessageEvents and
// capturing what it posts back through a stubbed global postMessage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';
import '../markdown.worker';

interface ParseResponse {
  runId: string;
  html: string;
}

let posted: ParseResponse[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal('postMessage', (msg: ParseResponse) => {
    posted.push(msg);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Send one ParseRequest at the worker and return its single reply. */
function parse(runId: string, text: string): ParseResponse {
  const before = posted.length;
  window.dispatchEvent(new MessageEvent('message', { data: { runId, text } }));
  expect(posted.length).toBe(before + 1);
  return posted[posted.length - 1]!;
}

describe('markdown.worker message handling', () => {
  it('parses markdown and replies with html tagged by the same runId', () => {
    const res = parse('run-42', '# Title\n\nHello *world*.');
    expect(res.runId).toBe('run-42');
    expect(res.html).toContain('<h1>Title</h1>');
    expect(res.html).toContain('<em>world</em>');
  });

  it('answers every request independently, in order', () => {
    const a = parse('a', 'first message');
    const b = parse('b', 'second message');
    expect(a.html).toContain('first message');
    expect(b.html).toContain('second message');
    expect(posted.map((p) => p.runId)).toEqual(['a', 'b']);
  });

  it('renders gfm tables (gfm option is on)', () => {
    const res = parse('t', '| a | b |\n| - | - |\n| 1 | 2 |');
    expect(res.html).toContain('<table>');
    expect(res.html).toContain('<td>1</td>');
  });

  it('highlights fenced code blocks with a known language', () => {
    const res = parse('r1', '```js\nconst x = 1;\n```');
    expect(res.html).toContain('<pre class="code-block">');
    expect(res.html).toContain('language-js');
    // `const` got tokenized by highlight.js
    expect(res.html).toContain('hljs-keyword');
  });

  it('auto-highlights unknown languages and never leaks raw html', () => {
    const res = parse('r1', '```notalang\n<b>bold</b> & more\n```');
    // The declared language is kept on the class even when hljs has no
    // grammar for it (highlightAuto handles the body instead).
    expect(res.html).toContain('language-notalang');
    expect(res.html).not.toContain('<b>bold</b>');
  });

  it('renders unlabelled code fences with the plain hljs class', () => {
    const res = parse('r1', '```\nplaintextbody\n```');
    expect(res.html).toContain('<code class="hljs">');
    expect(res.html).not.toContain('language-');
    expect(res.html).toContain('plaintextbody');
  });

  it('skips highlighting for huge code blocks but still escapes them', () => {
    const line = 'const dangerous = "<script>";\n';
    const huge = line.repeat(Math.ceil(50001 / line.length));
    expect(huge.length).toBeGreaterThan(50000);

    const res = parse('big', '```js\n' + huge + '```');
    // Language class survives, but the body is escaped verbatim with no
    // token spans — hljs must not run on oversized payloads.
    expect(res.html).toContain('language-js');
    expect(res.html).toContain('&lt;script&gt;');
    expect(res.html).not.toContain('hljs-keyword');
  });

  it('falls back to an escaped <pre> when parsing throws', () => {
    vi.spyOn(marked, 'parse').mockImplementationOnce(() => {
      throw new Error('parser exploded');
    });
    const res = parse('boom', '<script>alert(1)</script> & co');
    expect(res.runId).toBe('boom');
    expect(res.html).toBe('<pre>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</pre>');
  });
});
