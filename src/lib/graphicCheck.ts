// A layout check for a mounted HTML graphic (docs/IMPROVEMENT-TODO.md items 48 and 50): its text
// measured as laid out — off the frame, outside the safe area, or spilling out of the card it sits
// in. Cheaper than frame QA and exact about text, so the tools run it on every template graphic
// and fix what it finds before the user sees it (lib/graphicCheckRun.ts), and the template lab
// (template-lab.html) shows it for every template at once.

export type LayoutProblem = 'off-frame' | 'outside-safe' | 'overflows-panel';
export type LayoutIssue = { text: string; problem: LayoutProblem; /** Design pixels past the edge. */ by: number; /** The slot it belongs to, when the markup says (data-slot). */ slot?: string };

type Rect = { left: number; top: number; right: number; bottom: number };
const union = (rects: Iterable<DOMRect>): Rect | null => {
  let out: Rect | null = null;
  for (const r of rects) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    out = out ? { left: Math.min(out.left, r.left), top: Math.min(out.top, r.top), right: Math.max(out.right, r.right), bottom: Math.max(out.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return out;
};
const past = (inner: Rect, outer: Rect) => Math.max(outer.left - inner.left, outer.top - inner.top, inner.right - outer.right, inner.bottom - outer.bottom, 0);

/**
 * The layout problems of the graphic drawn in `stage` (its design canvas is `canvas`, the stage may
 * be scaled on screen). `safe`: the safe margin as a share of the frame. Hidden text is skipped.
 */
export function layoutIssues(stage: HTMLElement, canvas: { width: number; height: number }, safe = 0.03): LayoutIssue[] {
  const frame = stage.getBoundingClientRect();
  const k = frame.width / canvas.width || 1;
  const frameRect: Rect = { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom };
  const safeRect: Rect = { left: frame.left + frame.width * safe, top: frame.top + frame.height * safe, right: frame.right - frame.width * safe, bottom: frame.bottom - frame.height * safe };
  const issues: LayoutIssue[] = [];
  const doc = stage.ownerDocument;
  const walker = doc.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const owner = node.parentElement;
    // Decoration (data-deco: floor numerals, reflections) may bleed by design.
    if (!text || !owner || owner.closest('style,script,svg,[data-deco],[aria-hidden="true"]')) continue;
    const view = doc.defaultView;
    const style = view?.getComputedStyle(owner);
    if (style && (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05)) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rect = union(Array.from(range.getClientRects()));
    if (!rect) continue;
    const block = owner.closest('[data-slot]') ?? owner.parentElement ?? owner;
    if (seen.has(block) && issues.some((issue) => issue.text === text)) continue;
    seen.add(block);
    const slot = owner.closest('[data-slot]')?.getAttribute('data-slot') ?? undefined;
    const off = past(rect, frameRect);
    if (off > 2) { issues.push({ text, problem: 'off-frame', by: Math.round(off / k), slot }); continue; }
    const panel = owner.closest('.glass');
    if (panel) {
      const box = panel.getBoundingClientRect();
      const spill = past(rect, { left: box.left, top: box.top, right: box.right, bottom: box.bottom });
      if (spill > 2) { issues.push({ text, problem: 'overflows-panel', by: Math.round(spill / k), slot }); continue; }
    }
    const unsafe = past(rect, safeRect);
    if (unsafe > 2) issues.push({ text, problem: 'outside-safe', by: Math.round(unsafe / k), slot });
  }
  // One entry per run of text: the words of one line are one problem, not ten.
  return issues.filter((issue, i) => issues.findIndex((other) => other.problem === issue.problem && other.slot === issue.slot && (other.slot ? true : other.text === issue.text)) === i);
}
