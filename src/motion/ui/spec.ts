// UI screens (docs/REFERENCE-FILMS-PLAN.md P3, B1): a product screen the AI writes in HTML, whose
// parts can be typed into, clicked, lifted, highlighted, counted and zoomed into — the living UI of
// the SaaS reference films (Workly, Virgil, Limelight, Solair, WasteProtection).
//
// The HTML is rasterised once when the scene is built (raster.ts): the screen without its parts,
// and every element marked `data-part="name"` as its own picture with its box. compile.ts turns
// the actions into ordinary engine keyframes on those pictures, so a UI screen previews, exports
// and edits exactly like any other motion scene.

/** A part name (`data-part`), or a point [x, y] in screen CSS pixels. */
export type UiTarget = string;
export type UiPoint = UiTarget | [number, number];

export type UiAction =
  /** The cursor clicks into the field, then types (30 cps, the SaaS field rate). The field's own text is the placeholder until then. */
  | { t: number; type: 'type'; target: UiTarget; text: string; cps?: number; color?: string; chunk?: 'char' | 'word'; click?: boolean }
  /** Types then deletes and retypes: [{type:'…'},{wait:0.4},{backspace:5},{type:'…'}]. */
  | { t: number; type: 'type-script'; target: UiTarget; script: ({ type: string } | { backspace: number } | { wait: number })[]; cps?: number; color?: string; click?: boolean }
  /** Cursor glides there and presses; the part dips and a ripple spreads. */
  | { t: number; type: 'click'; target: UiTarget; ripple?: boolean }
  /** Cursor glides there without pressing. */
  | { t: number; type: 'hover' | 'cursor'; target: UiPoint }
  /** The part lifts (×1.088, shadow) while the others dim (32%): 9 f in, `hold` s, 8 f out (measured). */
  | { t: number; type: 'hover-lift'; target: UiTarget; scale?: number; dimOthers?: number; hold?: number }
  /** The cursor scans a list: hover-lifts each target in turn every `every` s. */
  | { t: number; type: 'sweep'; targets: UiTarget[]; every?: number }
  /** A persistent tinted selection behind the part. */
  | { t: number; type: 'select'; target: UiTarget; color?: string }
  /** An outline glow around the part: `pulse` beats twice, `focus` stays, `highlight` shows for `duration`. */
  | { t: number; type: 'highlight' | 'pulse' | 'focus'; target: UiTarget; color?: string; duration?: number }
  /** A number in the part counts up to `to` (its text gives the format: "$12,400" → "${n}"). */
  | { t: number; type: 'count'; target: UiTarget; to: number; from?: number; duration?: number; decimals?: number }
  /** A small card pops above the part (`tooltip`), or slides in at the screen's top-right (`notify`). */
  | { t: number; type: 'tooltip' | 'notify'; target?: UiTarget; text: string; duration?: number }
  /** Every part assembles into place, nearest the centre first (WasteProtection). */
  | { t: number; type: 'assemble'; order?: 'distance' | 'dom'; stagger?: number }
  /** The part is dragged by the cursor to another part or point. */
  | { t: number; type: 'drag'; target: UiTarget; to: UiPoint; duration?: number }
  /** Swap to another state of the screen (a page change). */
  | { t: number; type: 'state'; to: string; transition?: 'cut' | 'fade' | 'slide' }
  /** Camera push into a part (`zoom`, default 2) — or back out to the whole screen when no target. */
  | { t: number; type: 'zoom'; target?: UiTarget; zoom?: number; duration?: number };

export type UiDevice = 'none' | 'browser' | 'phone' | 'laptop' | 'glass-card';

/** A part marked on a screenshot, in the screenshot's CSS px. */
export type UiShotPart = {
  id: string;
  box: [number, number, number, number];
  parent?: string;
  radius?: number;
  /** Text the engine draws live (typing, counters): what the field shows now, and its look. Its area is painted over with the field colour. */
  text?: { value?: string; size?: number; color?: string; weight?: number; font?: string; align?: 'left' | 'center' | 'right'; inset?: number };
};

export type UiScreenSpec = {
  /** The screen's HTML. Mark every element that moves with `data-part="name"`; parts may nest. */
  html: string;
  /** Instead of html: a screenshot (a captured product page or the user's picture) with its parts marked by box. */
  screenshot?: string;
  /** Screenshot pixels per CSS px (default: its width ÷ `width`, or 2 for a capture). */
  screenshotScale?: number;
  parts?: UiShotPart[];
  css?: string;
  /** Screen size in CSS pixels (default 1440 × 900; a phone 390 × 844). */
  width?: number;
  height?: number;
  /** Page background (default white, or #0f1117 in the dark theme). */
  background?: string;
  theme?: 'light' | 'dark';
  /** The colour of selections, outlines, ripples and the caret (default indigo #5b5bf0, or the brand accent). */
  accent?: string;
  /** Further pages, switched to by `state` actions. */
  states?: { id: string; html: string }[];
  device?: UiDevice;
  /** The address shown in the browser frame. */
  url?: string;
  cursor?: false | { style?: 'arrow' | 'hand' | 'dot'; size?: number; color?: string; /** Where it enters from (screen CSS px); default below the right edge. */ from?: [number, number]; /** Seconds after the last action it fades (default 1). */ hideAfter?: number };
  actions?: UiAction[];
  /** 'ticks': frame-synced UI ticks (voice-over films); 'none': silent UI (music-only films). */
  sfx?: 'ticks' | 'none';
  /** Where the screen sits in the comp. */
  place?: {
    /** Screen width as a share of the comp width (default 0.72; capped so it fits 84% of the height). */
    width?: number;
    /** Comp pixels of the screen centre (default the comp centre). */
    position?: [number, number];
    /** Tilted UI plane: [rotationX, rotationY] degrees (e.g. [14, -18]). */
    tilt?: [number, number];
    /** How it arrives: rise (default), scale, fade or none; at `enterAt` seconds. */
    enter?: 'rise' | 'scale' | 'fade' | 'none';
    enterAt?: number;
    /** Seconds the screen leaves (fades and sinks), if it should before the scene ends. */
    exitAt?: number;
  };
  /** Pixels per CSS pixel of the rendered pictures (default 2, sharp under a 2× zoom). */
  resolution?: number;
  /** Scene length; default the last action + 1.5 s (at least 3 s). */
  duration?: number;
};

/** Text of a part that the engine draws live (typing and counters), measured from the DOM. */
export type UiText = {
  value: string;
  font: string;
  size: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Anchor point in screen CSS px: the content box's left (or centre / right) edge, vertically centred. */
  x: number;
  y: number;
  width: number;
};

export type UiRasterPart = {
  id: string;
  /** [x, y, w, h] in screen CSS px. */
  box: [number, number, number, number];
  /** The part's picture: its box grown by `margin` on every side (room for shadows). */
  path: string;
  margin: number;
  parent?: string;
  /** Parts with the same group share a DOM container (a list's items): a hover-lift dims only these. */
  group?: string;
  radius: number;
  text?: UiText;
};

export type UiRasterState = { id: string; base: string; parts: UiRasterPart[] };
export type UiRaster = { width: number; height: number; scale: number; background: string; states: UiRasterState[] };

export const UI_ACTION_TYPES = ['type', 'type-script', 'click', 'hover', 'cursor', 'hover-lift', 'sweep', 'select', 'highlight', 'pulse', 'focus', 'count', 'tooltip', 'notify', 'assemble', 'drag', 'state', 'zoom'] as const;

/** Actions whose target's own text is drawn live by the engine (so the picture leaves it out). */
export function liveTextTargets(spec: Pick<UiScreenSpec, 'actions'>): Set<string> {
  const out = new Set<string>();
  for (const action of spec.actions ?? []) if (action.type === 'type' || action.type === 'type-script' || action.type === 'count') out.add(action.target);
  return out;
}

/** Problems with a spec, in words the AI can act on (the part names are checked after rasterising). */
export function checkUiSpec(spec: UiScreenSpec): string[] {
  const problems: string[] = [];
  if (spec.screenshot) {
    for (const [i, part] of (spec.parts ?? []).entries()) if (!part.id || !Array.isArray(part.box) || part.box.length !== 4 || part.box.some((n) => typeof n !== 'number') || part.box[2] < 1 || part.box[3] < 1) problems.push(`parts[${i}]: needs an id and box [x, y, w, h] in screenshot CSS px.`);
  } else if (typeof spec.html !== 'string' || !spec.html.trim()) problems.push('html (or a screenshot with parts) is required.');
  if (/<script[\s>]/i.test(spec.html ?? '') || (spec.states ?? []).some((s) => /<script[\s>]/i.test(s.html))) problems.push('UI screens are static HTML + CSS: no <script>.');
  const w = spec.width ?? 1440;
  const h = spec.height ?? 900;
  if (!(w >= 200 && w <= 3840 && h >= 200 && h <= 3840)) problems.push('width and height must be 200–3840 CSS px.');
  const states = new Set(['main', ...(spec.states ?? []).map((s) => s.id)]);
  if (states.size !== 1 + (spec.states ?? []).length) problems.push('state ids must be unique and not "main".');
  for (const [i, action] of (spec.actions ?? []).entries()) {
    if (!UI_ACTION_TYPES.includes(action.type)) { problems.push(`actions[${i}]: unknown type "${(action as { type: string }).type}" (${UI_ACTION_TYPES.join(', ')}).`); continue; }
    if (!(typeof action.t === 'number' && action.t >= 0)) problems.push(`actions[${i}]: t must be seconds ≥ 0.`);
    if (action.type === 'state' && !states.has(action.to)) problems.push(`actions[${i}]: no state "${action.to}".`);
    if ((action.type === 'type') && typeof action.text !== 'string') problems.push(`actions[${i}]: type needs text.`);
    if (action.type === 'count' && typeof action.to !== 'number') problems.push(`actions[${i}]: count needs a number "to".`);
    if (action.type === 'sweep' && !action.targets?.length) problems.push(`actions[${i}]: sweep needs targets.`);
  }
  return problems;
}

/** Part names the actions use that no state has. */
export function missingParts(spec: UiScreenSpec, raster: UiRaster): string[] {
  const known = new Set(raster.states.flatMap((s) => s.parts.map((p) => p.id)));
  const wanted = new Set<string>();
  for (const action of spec.actions ?? []) {
    if ('target' in action && typeof action.target === 'string') wanted.add(action.target);
    if (action.type === 'sweep') action.targets.forEach((t) => wanted.add(t));
    if (action.type === 'drag' && typeof action.to === 'string') wanted.add(action.to);
  }
  return [...wanted].filter((name) => !known.has(name));
}
