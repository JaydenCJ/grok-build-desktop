// Central sanitizer for HTML that reaches `dangerouslySetInnerHTML`.
//
// The markdown worker parses assistant text with `marked`, which does NOT
// sanitize its output — raw HTML embedded in a model/tool response (or in a
// restored legacy message) passes straight through. Strip anything executable
// (script tags, inline event handlers, javascript: URLs) before it touches
// the DOM. DOMPurify's defaults handle all of that while preserving normal
// markdown output: headings, links, tables, and highlight.js code markup.
import DOMPurify from 'dompurify';

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
