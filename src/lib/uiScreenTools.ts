// create_ui_screen / update_ui_screen / list_ui_kinds (docs/REFERENCE-FILMS-PLAN.md P3, B1): a
// living product screen as a motion scene. The HTML (the AI's own, or a ready-made kind) is
// rasterised here in the webview, its pictures saved to the project, and the actions compiled into
// keyframes (src/motion/ui). The result is placed through create_motion_scene, so it opens as a
// layered "[Motion]" comp like every other scene.
import type { MotionScene } from '../motion/types';
import { compileUi } from '../motion/ui/compile';
import { findUiKind, UI_KINDS, uiTheme } from '../motion/ui/kinds';
import { rasterizeUi } from '../motion/ui/raster';
import { checkUiSpec, missingParts, UI_ACTION_TYPES, type UiRaster, type UiScreenSpec } from '../motion/ui/spec';
import { api, errorText, fileSrc } from './ipc';
import type { ToolResult } from './types';
import type { MotionToolContext } from './motionTools';

type Args = Record<string, unknown>;
type Run = (name: string, args: Args, ctx: MotionToolContext) => Promise<ToolResult>;

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);

/** Spec fields a call may set directly. */
const SPEC_KEYS = ['html', 'screenshot', 'screenshotScale', 'parts', 'css', 'width', 'height', 'background', 'theme', 'accent', 'states', 'device', 'url', 'cursor', 'actions', 'sfx', 'place', 'resolution', 'duration'] as const;
/** Changing any of these needs the pictures made again. */
const LOOK_KEYS = ['html', 'screenshot', 'screenshotScale', 'parts', 'assetId', 'css', 'width', 'height', 'background', 'theme', 'states', 'resolution', 'kind', 'content'];

function specFrom(args: Args, ctx: MotionToolContext, previous?: UiScreenSpec): UiScreenSpec | string {
  const brand = ctx.brand;
  const theme = (str(args, 'theme') as 'light' | 'dark' | undefined) ?? previous?.theme;
  const accent = str(args, 'accent') ?? previous?.accent ?? brand?.colors.accent;
  let spec: Partial<UiScreenSpec> = previous ? { ...previous } : {};
  const kindId = str(args, 'kind');
  if (kindId) {
    const kind = findUiKind(kindId);
    if (!kind) return `No UI kind "${kindId}". Kinds: ${UI_KINDS.map((k) => k.id).join(', ')}.`;
    spec = { ...spec, ...kind.build((args.content as Record<string, unknown>) ?? {}, uiTheme({ theme, accent, font: brand?.fonts.body })) };
  }
  for (const key of SPEC_KEYS) if (args[key] !== undefined) (spec as Record<string, unknown>)[key] = args[key];
  const assetId = str(args, 'assetId');
  if (assetId) {
    const asset = ctx.assets.get(assetId);
    if (!asset || asset.kind !== 'image') return `No image asset ${assetId}.`;
    spec.screenshot = asset.path;
  }
  if (spec.screenshot && !spec.html) spec.html = '';
  if (theme) spec.theme = theme;
  if (accent) spec.accent = accent;
  if (!spec.html && !spec.screenshot) return 'Give a kind (list_ui_kinds) with content, or html with data-part="name" on every element that moves.';
  return spec as UiScreenSpec;
}

/** The screenshot at CSS size with a labelled 100 px grid, as a JPEG the model can read boxes off. */
export async function gridPreview(path: string, width: number, height: number): Promise<string | null> {
  try {
    const image = new Image();
    image.src = fileSrc(path);
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, width, height);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    for (let x = 100; x < width; x += 100) {
      ctx.fillStyle = x % 500 ? '#ff00aa40' : '#ff00aa90';
      ctx.fillRect(x, 0, 1, height);
      ctx.fillStyle = '#ff00aa';
      ctx.fillText(String(x), x + 3, 12);
    }
    for (let y = 100; y < height; y += 100) {
      ctx.fillStyle = y % 500 ? '#ff00aa40' : '#ff00aa90';
      ctx.fillRect(0, y, width, 1);
      ctx.fillStyle = '#ff00aa';
      ctx.fillText(String(y), 3, y - 3);
    }
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

const partList = (raster: UiRaster) => raster.states.map((s) => `${raster.states.length > 1 ? `${s.id}: ` : ''}${s.parts.map((p) => p.id + (p.text ? ` ("${p.text.value.slice(0, 24)}")` : '')).join(', ')}`).join(' | ');

async function build(spec: UiScreenSpec, comp: { width: number; height: number }, title: string, stage: string | undefined, reuse?: UiRaster): Promise<{ scene: MotionScene; raster: UiRaster } | string> {
  const problems = checkUiSpec(spec);
  if (problems.length) return problems.join(' ');
  let raster = reuse;
  if (!raster) {
    const screen = `ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      raster = await rasterizeUi(spec, (bytes, name) => api.uiScreenSave(screen, name, bytes), fileSrc);
    } catch (error) {
      return `The screen could not be rendered: ${errorText(error)}`;
    }
  }
  const missing = missingParts(spec, raster);
  if (missing.length) return `The actions name parts the HTML does not have: ${missing.join(', ')}. Parts: ${partList(raster)}. Mark elements with data-part="name".`;
  const built = compileUi(spec, raster, comp, { name: `UI · ${title}` });
  const layers: MotionScene['layers'] = [];
  if (stage && stage !== 'none') layers.push({ id: 'stage', name: 'Stage', type: 'solid', color: stage });
  layers.push(built.layer);
  const scene: MotionScene = {
    version: 1, width: comp.width, height: comp.height, duration: built.duration, layers,
    ...(built.cues.length ? { cues: built.cues } : {}),
    template: { id: 'ui-screen', params: { spec, raster, stage: stage ?? 'none', title } },
  };
  return { scene, raster };
}

export async function runUiScreenTool(name: string, args: Args, ctx: MotionToolContext, run: Run): Promise<ToolResult> {
  switch (name) {
    case 'list_ui_kinds':
      return done(`${UI_KINDS.length} ready-made screens. Build one with create_ui_screen {"kind":"<id>","content":{…},"actions":[…]}; or write your own html with data-part="name" on everything that moves. Actions: ${UI_ACTION_TYPES.join(', ')} — each {t, type, target, …} in seconds from the scene start.`, {
        kinds: UI_KINDS.map(({ id, label, use, content, parts }) => ({ id, label, use, content, parts })),
      });

    case 'capture_product_ui': {
      const url = str(args, 'url');
      if (!url) return fail('Give the page address, e.g. {"url":"https://app.example.com/dashboard"}.');
      let shot;
      try {
        shot = await api.uiCapture(url, typeof args.width === 'number' ? args.width : undefined, typeof args.height === 'number' ? args.height : undefined, args.theme === 'dark');
      } catch (error) {
        return fail(`Could not capture ${url}: ${errorText(error)}`);
      }
      const preview = await gridPreview(shot.path, shot.width, shot.height);
      return done(`Captured ${url} at ${shot.width}×${shot.height} (2× pixels). The picture follows with a 100 px grid. Mark the parts to animate by their boxes in these CSS px and build it: create_ui_screen {"screenshot":${JSON.stringify(shot.path)},"width":${shot.width},"height":${shot.height},"parts":[{"id":"search","box":[x,y,w,h],"radius":12,"text":{"value":"…","size":16,"color":"#6b7280"}}, …],"actions":[…]}. Give "text" only to fields you type into or numbers you count (their area is painted clean and the engine draws the text).`, { screenshot: shot.path, width: shot.width, height: shot.height, ...(preview ? { images: [preview] } : {}) });
    }

    case 'create_ui_screen': {
      const comp = ctx.pickComp(ctx.project, args);
      if (!comp) return fail('There is no composition to place the screen in.');
      const spec = specFrom(args, ctx);
      if (typeof spec === 'string') return fail(spec);
      const title = str(args, 'title') ?? (str(args, 'kind') ? findUiKind(str(args, 'kind')!)!.label : 'UI screen');
      const made = await build(spec, comp, title, str(args, 'stage'));
      if (typeof made === 'string') return fail(made);
      const placed = await run('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene: made.scene, start: args.start ?? 0, title, duration: made.scene.duration, fit: false, useBrand: false, sfx: spec.sfx !== 'none' }, ctx);
      if (!placed.ok) return placed;
      return done(`${placed.summary} The screen's parts: ${partList(made.raster)}. Change the actions, placement or look with update_ui_screen {"clipId":"${(placed as { clipId?: string }).clipId}", …}.`, { ...placed, parts: made.raster.states.map((s) => ({ state: s.id, parts: s.parts.map((p) => ({ id: p.id, parent: p.parent, box: p.box.map(Math.round), text: p.text?.value })) })) });
    }

    case 'update_ui_screen': {
      const clipId = str(args, 'clipId') ?? str(args, 'compId');
      if (!clipId) return fail('Give the clipId of the UI screen (the result of create_ui_screen).');
      const current = await run('get_motion_scene', { clipId, full: true }, ctx);
      const scene = (current as { scene?: MotionScene }).scene;
      const template = scene?.template;
      if (!current.ok || !scene || template?.id !== 'ui-screen') return fail('That clip is not a UI screen made by create_ui_screen.');
      const params = template.params as { spec: UiScreenSpec; raster: UiRaster; stage: string; title: string };
      const spec = specFrom(args, ctx, params.spec);
      if (typeof spec === 'string') return fail(spec);
      const again = LOOK_KEYS.some((key) => args[key] !== undefined);
      const made = await build(spec, { width: scene.width, height: scene.height }, params.title, str(args, 'stage') ?? params.stage, again ? undefined : params.raster);
      if (typeof made === 'string') return fail(made);
      const updated = await run('update_motion_scene', { clipId, scene: made.scene }, ctx);
      if (!updated.ok) return updated;
      return done(`Updated the UI screen${again ? ' (re-rendered its pictures)' : ''}: ${made.scene.duration.toFixed(2)} s, parts ${partList(made.raster)}.`, { ...updated });
    }
  }
  return fail(`Unknown UI tool ${name}.`);
}
