import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { sanitizeHtml } from '../sanitizeHtml';

// Mirrors the pipeline: assistant text → marked (worker) → sanitizeHtml →
// dangerouslySetInnerHTML in MessageItem. marked passes raw HTML through
// unmodified, so hostile markup in a model/tool response must be stripped
// here — while normal markdown (code blocks, links, tables) survives.
const hostileMarkdown = [
  '# Report',
  '',
  '<script>window.__pwned = true;</script>',
  '',
  '<img src="x" onerror="window.__pwned = true" />',
  '',
  '<a href="javascript:alert(1)">totally safe link</a>',
  '',
  '```ts',
  'const x: number = 1;',
  '```',
  '',
  '| name | value |',
  '| ---- | ----- |',
  '| a    | 1     |',
  '',
  '[docs](https://example.com/docs)',
].join('\n');

function parse(md: string): string {
  return marked.parse(md, { async: false, gfm: true }) as string;
}

describe('sanitizeHtml', () => {
  it('strips script tags and inline event handlers from parsed markdown', () => {
    const html = parse(hostileMarkdown);
    // Sanity: marked really does let the raw HTML through untouched.
    expect(html).toContain('<script>');
    expect(html).toContain('onerror');

    const safe = sanitizeHtml(html);
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('__pwned');
    expect(safe).not.toContain('onerror');
    expect(safe).not.toContain('javascript:');
  });

  it('keeps normal markdown output: headings, code blocks, tables, links', () => {
    const safe = sanitizeHtml(parse(hostileMarkdown));
    expect(safe).toContain('<h1');
    expect(safe).toContain('<pre');
    expect(safe).toContain('<code');
    expect(safe).toContain('const x: number = 1;');
    expect(safe).toContain('<table');
    expect(safe).toContain('<td>a</td>');
    expect(safe).toMatch(/<a[^>]+href="https:\/\/example\.com\/docs"/);
  });

  it('keeps highlight.js code-block markup (classes and spans)', () => {
    const highlighted =
      '<pre class="code-block"><code class="hljs language-ts">' +
      '<span class="hljs-keyword">const</span> x = 1;</code></pre>';
    const safe = sanitizeHtml(highlighted);
    expect(safe).toContain('class="hljs language-ts"');
    expect(safe).toContain('<span class="hljs-keyword">const</span>');
  });
});
