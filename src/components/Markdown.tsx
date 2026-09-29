// Model markdown rendered as sanitized HTML with copyable code blocks (adapted from the Bhippi desktop app).
//
// Code the AI writes sits in its own small window — a fixed height that scrolls inside, so a long
// file never pushes the words around it apart. While the answer streams the window follows the
// newest line, the way an editor does while someone types; afterwards Expand opens it in full.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { copyText } from '../lib/clipboard';

marked.setOptions({ gfm: true, breaks: true });

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Lines a code window shows before it scrolls; more than this earns an Expand button. */
const WINDOW_LINES = 12;

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const label = (lang ?? '').trim().split(/\s+/)[0] || 'code';
      const lines = text.replace(/\n$/, '').split('\n').length;
      const expand = lines > WINDOW_LINES ? '<button type="button" class="md-code-toggle">Expand</button>' : '';
      return `<div class="md-code"><div class="md-code-bar"><span class="md-code-dots"><i></i><i></i><i></i></span><span class="md-code-lang">${escapeHtml(label)}</span><span class="md-code-lines">${lines} ${lines === 1 ? 'line' : 'lines'}</span>${expand}<button type="button" class="md-code-copy">Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
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

/** The code windows under `root`, in order; a window is remembered by its place in this list. */
const windowsIn = (root: ParentNode | null): Element[] => [...(root?.querySelectorAll('.md-code') ?? [])];

/** Expands or collapses the window `button` sits in, and remembers which are open in `opened`. */
export function toggleWindow(button: Element, root: ParentNode | null, opened: Set<number>) {
  const window_ = button.closest('.md-code');
  if (!window_) return;
  const open = window_.classList.toggle('open');
  const index = windowsIn(root).indexOf(window_);
  if (open) opened.add(index);
  else opened.delete(index);
  button.textContent = open ? 'Collapse' : 'Expand';
}

/**
 * Re-opens the windows the user expanded after the HTML under `root` was replaced — it is
 * rebuilt whole on every streamed chunk — and, while `live`, keeps each closed one on its newest
 * line.
 */
export function restoreWindows(root: ParentNode | null, opened: ReadonlySet<number>, live: boolean) {
  windowsIn(root).forEach((window_, index) => {
    if (opened.has(index)) {
      window_.classList.add('open');
      const button = window_.querySelector('.md-code-toggle');
      if (button) button.textContent = 'Collapse';
    } else if (live) {
      const pre = window_.querySelector('pre');
      if (pre) pre.scrollTop = pre.scrollHeight;
    }
  });
}

/** Words brought in per chunk at most; a bigger jump (a pasted block, a reload) just appears. */
const MAX_FADING_WORDS = 90;

/**
 * Wraps the words after the first `from` characters of `root`'s text in `<span class="w">`, so only
 * what has just arrived fades in (chat-messages.css). The HTML is rebuilt whole on every chunk, so
 * the words already on screen come back as plain text and do not animate again. Code is left
 * alone: it scrolls in its own window and never animates.
 */
export function fadeNewWords(root: HTMLElement, from: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const fresh: { node: Text; start: number }[] = [];
  let seen = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (seen + length > from && !node.parentElement?.closest('pre, code, button')) fresh.push({ node, start: Math.max(0, from - seen) });
    seen += length;
  }
  let words = 0;
  for (const { node } of fresh) words += node.data.split(/\s+/).filter(Boolean).length;
  if (words > MAX_FADING_WORDS) return;
  let index = 0;
  for (const { node, start } of fresh) {
    const head = node.data.slice(0, start);
    const tail = node.data.slice(start);
    const parts = document.createDocumentFragment();
    if (head) parts.append(head);
    for (const piece of tail.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { parts.append(piece); continue; }
      const word = document.createElement('span');
      word.className = 'w';
      // A short stagger across the chunk, never more than a third of a second behind the stream.
      word.style.animationDelay = `${Math.min(index * 14, 320)}ms`;
      word.textContent = piece;
      parts.append(word);
      index++;
    }
    node.replaceWith(parts);
  }
}

/** `live`: the text is still streaming, so every code window keeps its newest line in view and new words fade in. */
export const Markdown = memo(function Markdown({ text, live = false }: { text: string; live?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const opened = useRef(new Set<number>());
  /** How much of the text was on screen after the last chunk. */
  const shown = useRef(0);
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
  useLayoutEffect(() => {
    restoreWindows(root.current, opened.current, live);
    const node = root.current;
    if (!node) return;
    const total = node.textContent?.length ?? 0;
    if (live && total > shown.current) fadeNewWords(node, shown.current);
    shown.current = total;
  }, [html, live]);
  return (
    <div
      ref={root}
      className="markdown"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const button = target.closest('.md-code-copy, .md-code-toggle');
        if (button instanceof HTMLElement) {
          event.preventDefault();
          if (button.classList.contains('md-code-copy')) copy(button);
          else toggleWindow(button, root.current, opened.current);
        }
        // Links would navigate the app's own window away; keep the user in the editor.
        if (target.closest('a')) event.preventDefault();
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
