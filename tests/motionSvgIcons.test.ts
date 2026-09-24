import { describe, expect, it } from 'vitest';
import { parseTransform, svgToShape } from '../src/motion/vector/svg';
import { expandIcons, searchIcons, unknownIcons } from '../src/motion/vector/icons';
import { parseSvgPath, pathBounds } from '../src/motion/vector/path';
import { validateScene } from '../src/motion/validate';
import type { MotionScene, ShapeItem } from '../src/motion/types';

const near = (a: number, b: number, eps = 0.6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const boxOf = (items: ShapeItem[]) => pathBounds(items.flatMap((it) => parseSvgPath(it.d ?? '')))!;

describe('SVG import', () => {
  it('reads an Illustrator-style logo: classes, groups, transforms, primitives, gradients', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <defs><style>.a{fill:#1d7cc9}.b{fill:none;stroke:#111;stroke-width:4}</style>
        <linearGradient id="g" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
      <!-- mark -->
      <g transform="translate(10 10)"><rect class="a" width="40" height="40" rx="8"/><circle class="b" cx="20" cy="20" r="10"/></g>
      <path d="M60 10 L190 10 L190 50 L60 50 Z" fill="url(#g)"/>
      <line x1="60" y1="80" x2="190" y2="80" stroke="#333" stroke-width="2"/>
    </svg>`;
    const r = svgToShape(svg);
    expect(r.groups).toHaveLength(4);
    expect(r.groups[0].fill).toBe('#1d7cc9');
    expect(r.groups[1].fill).toBeNull();
    expect(r.groups[1].stroke?.width).toBe(4);
    expect(typeof r.groups[2].fill).toBe('object');
    // Content moved to the origin: the rect starts at (10,10) in the drawing.
    const box = boxOf(r.groups);
    near(box.x, 0); near(box.y, 0);
    near(r.bounds[0], 180); near(r.bounds[1], 70);
  });
  it('scales to fit and keeps proportions', () => {
    const r = svgToShape('<svg viewBox="0 0 24 24"><path d="M0 0H24V12H0Z"/></svg>', { fit: [240, 240] });
    near(r.bounds[0], 240); near(r.bounds[1], 120);
  });
  it('parses SVG transform lists', () => {
    expect(parseTransform('translate(10,20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    const rot = parseTransform('rotate(90 10 10)');
    near(rot[4], 20); near(rot[5], 0);
  });
});

describe('Lucide icons', () => {
  it('finds icons by name words', async () => {
    const names = await searchIcons('shield check');
    expect(names).toContain('shield-check');
    expect((await searchIcons('chart')).length).toBeGreaterThan(5);
  });
  it('expands icon items into stroked paths sized as asked, and flags unknown names', async () => {
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 1, layers: [
      { id: 'i', type: 'shape', shape: { shape: 'path', groups: [{ kind: 'icon', icon: 'shield-check', iconSize: 240, color: '#8ae6ff', position: [120, 120] }] } },
    ] };
    expect(await unknownIcons(scene)).toEqual([]);
    const out = await expandIcons(scene);
    const group = (out.layers[0] as { shape: { groups: ShapeItem[] } }).shape.groups[0];
    expect(group.kind).toBe('group');
    expect(group.items!.length).toBe(2);
    expect(group.stroke).toMatchObject({ paint: '#8ae6ff', width: 2, cap: 'round' });
    expect(validateScene(out)).toEqual([]);
    const bad = { ...scene, layers: [{ id: 'i', type: 'shape', shape: { shape: 'path', groups: [{ kind: 'icon', icon: 'no-such-thing' }] } }] } as MotionScene;
    expect(await unknownIcons(bad)).toEqual(['no-such-thing']);
  });
});
