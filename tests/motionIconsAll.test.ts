import { it, expect } from 'vitest';
import { parseSvgPath, pathBounds } from '../src/motion/vector/path';
import { elementPath } from '../src/motion/vector/svg';
it('every Lucide icon parses inside its 24 box', async () => {
  const { icons } = await import('lucide') as unknown as { icons: Record<string, [string, Record<string, string | number>][]> };
  const bad: string[] = [];
  let count = 0;
  for (const [name, node] of Object.entries(icons)) {
    for (const [tag, attrs] of node) {
      const d = elementPath(tag, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])));
      if (!d) continue;
      count++;
      const b = pathBounds(parseSvgPath(d));
      if (!b || b.x < -0.6 || b.y < -0.6 || b.x + b.width > 24.6 || b.y + b.height > 24.6 || !Number.isFinite(b.width)) bad.push(`${name}:${tag}:${d.slice(0, 40)}`);
    }
  }
  process.stdout.write(`ELEMENTS ${count} BAD ${bad.length}\n${bad.slice(0, 10).join('\n')}\n`);
  expect(bad.length).toBe(0);
});
