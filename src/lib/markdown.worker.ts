import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';

marked.setOptions({
  gfm: true,
  breaks: false,
});

marked.use({
  renderer: {
    // Raw HTML embedded in the markdown is rendered as escaped text, never
    // injected. The parsed output goes straight into dangerouslySetInnerHTML
    // inside the app WebView, so letting model/tool output smuggle live
    // <script>/<img onerror>/<iframe> tags through would be an injection
    // vector. Markdown-generated formatting (headings, lists, code, links)
    // is unaffected.
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
    // Remote images are never fetched inside the WebView: the CSP's img-src
    // ('self' data:) blocks them, and fetching attacker-chosen URLs on render
    // would be a zero-click tracking/exfiltration channel (markdown is
    // untrusted model/tool output). Render a link instead — the click
    // interceptor in main.tsx routes it to the system browser. Local and
    // data: images fall through to the default renderer.
    image({ href, text }: { href: string; text: string }) {
      if (/^(https?:)?\/\//i.test(href)) {
        const label = text.trim() || href;
        return `<a href="${escapeAttr(href)}" title="Image — opens in your browser">${escapeHtml(label)}</a>`;
      }
      return false;
    },
    code({ text, lang }: { text: string; lang?: string }) {
      let highlighted = escapeHtml(text);
      if (text.length > 50000) {
        // Skip hljs on huge blocks — keep them readable but unstyled.
      } else if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      } else {
        try {
          highlighted = hljs.highlightAuto(text).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      }
      const langClass = lang ? ` language-${lang}` : '';
      return `<pre class="code-block"><code class="hljs${langClass}">${highlighted}</code></pre>`;
    },
  },
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Attribute-position escaping also needs quotes covered, or an image URL
// containing `"` could break out of the href attribute.
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface ParseRequest {
  runId: string;
  text: string;
}

interface ParseResponse {
  runId: string;
  html: string;
}

// Workers don't have access to Window globals, but `self` is the worker scope.
// We cast to `any` to avoid pulling the WebWorker lib into the global tsconfig.
const workerSelf = self as unknown as { postMessage: (data: ParseResponse) => void };

self.addEventListener('message', (e: MessageEvent<ParseRequest>) => {
  const { runId, text } = e.data;
  try {
    const html = marked.parse(text, { async: false }) as string;
    workerSelf.postMessage({ runId, html });
  } catch {
    const safe = escapeHtml(text);
    workerSelf.postMessage({ runId, html: `<pre>${safe}</pre>` });
  }
});

export {};
