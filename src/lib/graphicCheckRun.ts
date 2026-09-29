// The render check a template graphic gets before it lands (docs/IMPROVEMENT-TODO.md item 50): the
// graphic mounted off-screen at its hold frame, its text measured (graphicCheck.ts), and when a
// slot spills out of its card or the frame, that slot set smaller for one rebuild. Only where there
// is a DOM to lay out in (the app); elsewhere (tests, the backend) it reports nothing.
import { layoutIssues, type LayoutIssue } from './graphicCheck';
import { MIN_FIT } from './templateFix';

/** The layout problems of `bundle` drawn on `canvas` at its hold frame, or null without a DOM. */
export async function checkGraphic(bundle: { html: string; css: string }, canvas: { width: number; height: number }, seconds: number): Promise<LayoutIssue[] | null> {
  if (typeof document === 'undefined' || !document.body || typeof document.createRange !== 'function') return null;
  const host = document.createElement('div');
  host.className = 'mgt-layer';
  // After the entrances, before the exit: where the viewer reads it.
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;pointer-events:none;contain:strict;--elapsed:${(seconds * 0.72).toFixed(2)};--duration:${seconds}s;--u:${(canvas.width / 1920).toFixed(4)}`;
  host.innerHTML = `<style>${bundle.css}</style><div class="mgt-canvas" style="position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px">${bundle.html}</div>`;
  document.body.appendChild(host);
  try {
    await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 800))]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return layoutIssues(host.querySelector('.mgt-canvas') as HTMLElement, canvas);
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

/**
 * The type scales for one more build: each slot that spills out of its card or the frame set
 * smaller by what it spilled (at least 12%, never under MIN_FIT). A problem no slot owns — a card
 * grown past the safe area, text of its own pushed out — shrinks what grows the card: the rows,
 * else the subtitle, else the title (of `present`, the slots the graphic has). Null when nothing
 * can change.
 */
export function refit(fit: Record<string, number>, issues: LayoutIssue[], canvas: { width: number; height: number }, present: string[] = []): Record<string, number> | null {
  const next = { ...fit };
  let changed = false;
  const grower = ['rows', 'subtitle', 'title'].find((slot) => present.includes(slot));
  for (const issue of issues) {
    const slot = issue.slot && issue.problem !== 'outside-safe' ? issue.slot : grower;
    if (!slot) continue;
    const current = next[slot] ?? 1;
    const spill = Math.min(0.5, issue.by / (canvas.width * 0.4));
    // A card grown too tall sheds height only through its text, so the grower takes a bigger step.
    const scale = Math.max(MIN_FIT, Math.floor(current * Math.min(slot === issue.slot ? 0.88 : 0.8, 1 - spill) * 100) / 100);
    if (scale < current) { next[slot] = scale; changed = true; }
  }
  return changed ? next : null;
}

/** The problems as a sentence for the tool result. */
export const issuesText = (issues: LayoutIssue[]) => issues.map((issue) => `${issue.slot ?? `"${issue.text.slice(0, 24)}"`} ${issue.problem === 'overflows-panel' ? 'spills out of its card' : issue.problem === 'off-frame' ? 'runs off the frame' : 'sits outside the safe area'} by ${issue.by}px`).join('; ');
