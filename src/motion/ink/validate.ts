// Checks a drawing the AI wrote and says exactly what is wrong, in words it can act on.
import { parseSvgPath } from '../vector/path';
import { FACES, ITEM_KINDS, LOOKS, PEN_TOOLS, PRINTS, type DrawItem, type DrawingData } from './types';

const KINDS = new Set<string>(ITEM_KINDS);
const NEEDS_POINTS = new Set(['line', 'trail', 'constellation']);

export function drawingProblems(data: DrawingData | undefined, name: string): string[] {
  if (!data || typeof data !== 'object') return [`${name}: drawing needs {look, items}.`];
  const out: string[] = [];
  if (!(LOOKS as readonly string[]).includes(data.look)) out.push(`${name}: drawing.look must be one of ${LOOKS.join(', ')}.`);
  if (!Array.isArray(data.items)) return [...out, `${name}: drawing.items must be a list of items.`];
  if (data.inks && (!Array.isArray(data.inks) || data.inks.some((c) => typeof c !== 'string'))) out.push(`${name}: drawing.inks must be a list of colours.`);
  if (data.look === 'riso' && data.inks && (data.inks.length < 1 || data.inks.length > 4)) out.push(`${name}: a riso drawing prints 1–4 inks.`);
  if (data.step !== undefined && !(data.step >= 1 && data.step <= 6)) out.push(`${name}: drawing.step is frames per drawing, 1–6 (2 = on twos).`);
  const ids = new Set<string>();
  const walk = (items: DrawItem[], where: string, depth: number) => {
    if (depth > 8) { out.push(`${name}: ${where} nests too deep (8 levels max).`); return; }
    items.forEach((it, i) => {
      const at = `${where}[${i}]`;
      if (!it || typeof it !== 'object' || !KINDS.has(it.kind)) { out.push(`${name}: ${at}.kind must be one of ${ITEM_KINDS.join(', ')}.`); return; }
      if (it.id) { if (ids.has(it.id)) out.push(`${name}: ${at} repeats id "${it.id}".`); ids.add(it.id); }
      if (it.kind === 'path' && (typeof it.d !== 'string' || !parseSvgPath(it.d).some((sp) => sp.v.length > 1))) out.push(`${name}: ${at} (path) needs d, SVG path data that draws something.`);
      if (it.kind === 'icon' && !it.icon && !it.d) out.push(`${name}: ${at} (icon) needs icon, a Lucide icon name (search_icons finds them).`);
      if (NEEDS_POINTS.has(it.kind) && !(Array.isArray(it.points) && it.points.length >= 4)) out.push(`${name}: ${at} (${it.kind}) needs points [x0, y0, x1, y1, …] with at least two points.`);
      if (it.kind === 'write' && typeof it.text !== 'string') out.push(`${name}: ${at} (write) needs text.`);
      if (it.kind === 'pen' && it.tool && !(PEN_TOOLS as readonly string[]).includes(it.tool)) out.push(`${name}: ${at}.tool must be one of ${PEN_TOOLS.join(', ')}.`);
      if (it.print && !(PRINTS as readonly string[]).includes(it.print)) out.push(`${name}: ${at}.print must be one of ${PRINTS.join(', ')}.`);
      for (const [k, f] of (it.faces ?? []).entries()) if (!(FACES as readonly string[]).includes(f?.face) || typeof f?.t !== 'number') out.push(`${name}: ${at}.faces[${k}] needs {t, face} with face one of ${FACES.join(', ')}.`);
      if (typeof it.in === 'number' && typeof it.out === 'number' && !(it.out > it.in)) out.push(`${name}: ${at} out must be after in.`);
      if (it.kind === 'group') walk(it.items ?? [], `${at}.items`, depth + 1);
    });
  };
  walk(data.items, 'drawing.items', 0);
  // The pen follows ids that exist.
  const check = (items: DrawItem[]) => items.forEach((it) => {
    if (it?.kind === 'pen') for (const id of it.follow ?? []) if (!ids.has(id)) out.push(`${name}: pen follows "${id}", which no item has as its id.`);
    if (it?.items) check(it.items);
  });
  check(data.items);
  return out;
}
