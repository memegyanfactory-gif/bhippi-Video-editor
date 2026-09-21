export type ColorParams = Record<string, number | boolean | string>;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const number = (p: ColorParams, key: string, fallback = 0) => typeof p[key] === 'number' && Number.isFinite(p[key]) ? p[key] as number : fallback;
export function curveValue(text: unknown, x: number): number {
  if (typeof text !== 'string' || !text.trim()) return x;
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length < 2 || values.some(v => !Number.isFinite(v))) return x;
  const at = clamp(x) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(at));
  return clamp(values[i] + (values[i + 1] - values[i]) * (at - i));
}
export function wheelRGB(hue: number): number[] {
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs(h % 2 - 1);
  return (h < 1 ? [1,x,0] : h < 2 ? [x,1,0] : h < 3 ? [0,1,x] : h < 4 ? [0,x,1] : h < 5 ? [x,0,1] : [1,0,x]).map(v => v - 0.5);
}
/** Channel curves are evaluated in display sRGB; alpha is never graded. */
export function gradeChannel(input: number, channel: number, p: ColorParams): number {
  let x = clamp(input * Math.pow(2, number(p, 'exposure')));
  x = clamp((x - 0.5) * Math.max(0, 1 + number(p, 'contrast') / 100) + 0.5);
  const shadow = (1-x)*(1-x), highlight=x*x, mid=4*x*(1-x);
  x += (number(p,'shadows')*shadow + number(p,'highlights')*highlight) / 200;
  x += (number(p,'blacks')*Math.pow(1-x,4) + number(p,'whites')*Math.pow(x,4)) / 200;
  const temperature = number(p,'temperature') / 500, tint=number(p,'tint')/500;
  x += [temperature+tint/2,-tint,-temperature+tint/2][channel];
  for (const [band, weight] of [['shadow',shadow],['midtone',mid],['highlight',highlight]] as const) {
    x += wheelRGB(number(p,band+'Hue'))[channel] * number(p,band+'Amount') / 100 * weight;
    x += number(p,band+'Luma') / 200 * weight;
  }
  x=curveValue(p[['rTable','gTable','bTable'][channel]] ?? p.tableValues, clamp(x));
  return clamp(x);
}
export function gradeTables(p: ColorParams): string[] {
  return [0,1,2].map(c => Array.from({length:256},(_,i)=>gradeChannel(i/255,c,p).toFixed(6)).join(' '));
}
