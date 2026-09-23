// Code windows in model markdown: an expanded window stays expanded when the HTML is rebuilt,
// which happens on every streamed chunk.
import { describe, expect, it } from 'vitest';
import { restoreWindows, toggleWindow } from '../src/components/Markdown';

/** Just enough of an element for the code-window helpers: class selectors and tag names. */
class El {
  parent: El | null = null;
  textContent = '';
  scrollTop = 0;
  scrollHeight = 480;
  readonly classList;
  constructor(readonly tag: string, readonly classes: string[], readonly children: El[] = [], text = '') {
    this.textContent = text;
    for (const child of children) child.parent = this;
    const set = new Set(classes);
    this.classList = {
      add: (name: string) => void set.add(name),
      contains: (name: string) => set.has(name),
      toggle: (name: string) => (set.delete(name) ? false : (set.add(name), true)),
    };
  }
  matches(selector: string) {
    return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tag === selector;
  }
  closest(selector: string): El | null {
    return this.matches(selector) ? this : (this.parent?.closest(selector) ?? null);
  }
  querySelectorAll(selector: string): El[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** The answer's HTML as the renderer builds it: every window closed, every button saying Expand. */
const rendered = () =>
  new El('div', ['markdown'], [0, 1, 2].map(() => new El('div', ['md-code'], [
    new El('div', ['md-code-bar'], [new El('button', ['md-code-toggle'], [], 'Expand'), new El('button', ['md-code-copy'], [], 'Copy')]),
    new El('pre', []),
  ])));
const windows = (root: El) => root.querySelectorAll('.md-code');
const toggleOf = (root: El, index: number) => windows(root)[index].querySelector('.md-code-toggle')!;
const asRoot = (root: El) => root as unknown as ParentNode;

describe('code windows', () => {
  it('keeps an expanded window open across re-renders while the answer streams', () => {
    const opened = new Set<number>();
    const first = rendered();
    toggleWindow(toggleOf(first, 1) as unknown as Element, asRoot(first), opened);
    expect(windows(first)[1].classList.contains('open')).toBe(true);
    expect(toggleOf(first, 1).textContent).toBe('Collapse');

    // The next chunk replaces the HTML: fresh windows, all closed.
    const next = rendered();
    restoreWindows(asRoot(next), opened, true);
    expect(windows(next).map((w) => w.classList.contains('open'))).toEqual([false, true, false]);
    expect(toggleOf(next, 1).textContent).toBe('Collapse');
    // Closed windows follow their newest line; the open one is left where the user put it.
    expect(windows(next).map((w) => w.querySelector('pre')!.scrollTop)).toEqual([480, 0, 480]);

    toggleWindow(toggleOf(next, 1) as unknown as Element, asRoot(next), opened);
    expect(toggleOf(next, 1).textContent).toBe('Expand');
    const settled = rendered();
    restoreWindows(asRoot(settled), opened, false);
    expect(windows(settled).some((w) => w.classList.contains('open'))).toBe(false);
    expect(windows(settled).map((w) => w.querySelector('pre')!.scrollTop)).toEqual([0, 0, 0]);
  });
});
