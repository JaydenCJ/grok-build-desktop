import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';

marked.setOptions({
  gfm: true,
  breaks: false,
});

marked.use({
  renderer: {
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
