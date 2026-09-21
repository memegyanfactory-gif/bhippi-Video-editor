// Model markdown rendered as sanitized HTML with copyable code blocks (adapted from Bhippi).
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { memo, useMemo } from 'react';
import { copyText } from '../lib/clipboard';

marked.setOptions({ gfm: true, breaks: true });

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const label = (lang ?? '').trim().split(/\s+/)[0] || 'code';
      return `<div class="md-code"><div class="md-code-bar"><span>${escapeHtml(label)}</span><button type="button" class="md-code-copy">Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
    },
  },
});

function copy(button: HTMLElement) {
  const text = button.closest('.md-code')?.querySelector('pre')?.textContent ?? '';
  if (!text) return;
  void copyText(text).then((done) => {
    button.textContent = done ? 'Copied' : 'Select + Ctrl+C';
    window.setTimeout(() => (button.textContent = 'Copy'), 1400);
  });
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
        FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'img'],
        FORBID_ATTR: ['style'],
        ADD_TAGS: ['button'],
        ADD_ATTR: ['type'],
      }),
    [text],
  );
  return (
    <div
      className="markdown"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const button = target.closest('.md-code-copy');
        if (button instanceof HTMLElement) {
          event.preventDefault();
          copy(button);
        }
        // Links would navigate the app's own window away; keep the user in the editor.
        if (target.closest('a')) event.preventDefault();
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
