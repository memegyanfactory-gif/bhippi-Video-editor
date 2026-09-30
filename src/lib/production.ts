// The production record: phases, gates, the asset manifest and frame QA geometry.
//
// A production is the comp's plan seen as a state machine. The model writes the plan, the user
// presses Start generating, the model gathers every planned shot, the user presses Start
// editing, the model assembles and polishes. Everything here is pure so the workflow guard,
// the tools and the chat UI agree on what "ready" means, and so it can be tested without a
// browser. Mutations return a new comp; nothing here touches history.
import type { Box } from './layout';
import { frameOf, safeArea } from './layout';
import { findStyle } from './captionStyles';
import { parseRbStyle } from './reactbits';
import type { Clip, Comp, Production, ProductionBeat, ProductionPhase, ProductionShot, StoryboardScene, VideoBlueprintScene } from './types';

export const PHASES: ProductionPhase[] = ['planning', 'plan-ready', 'gathering', 'gathered', 'editing', 'polishing', 'done'];

export const PHASE_LABEL: Record<ProductionPhase, string> = {
  planning: 'Planning',
  'plan-ready': 'Plan ready',
  gathering: 'Gathering',
  gathered: 'Gathered',
  editing: 'Editing',
  polishing: 'Polishing',
  done: 'Done',
};

/** The scenes a production plans, whichever plan type it uses. */
export function planScenes(comp: Comp): (ProductionBeat & { start: number; end: number })[] {
  const production = comp.production;
  if (!production) return [];
  return production.mode === 'scratch' ? (comp.videoBlueprint?.scenes ?? []) : (comp.storyboard ?? []);
}

/** A fresh production record for a plan that was just saved. */
export function newProduction(mode: Production['mode'], fields: Partial<Production> = {}): Production {
  const now = Date.now();
  return {
    phase: 'plan-ready',
    mode,
    gates: { planReadyAt: now },
    updatedAt: now,
    ...fields,
    ...(fields.gates ? { gates: { ...fields.gates, planReadyAt: fields.gates.planReadyAt ?? now } } : {}),
  };
}

/** Moves the production to `phase`, stamping the matching gate. */
export function advance(production: Production, phase: ProductionPhase): Production {
  const now = Date.now();
  const gates = { ...production.gates };
  if (phase === 'plan-ready') gates.planReadyAt = now;
  if (phase === 'gathering') gates.generateApprovedAt = now;
  if (phase === 'gathered') gates.gatheredAt = now;
  if (phase === 'editing') gates.editApprovedAt = now;
  if (phase === 'polishing') gates.editedAt = now;
  if (phase === 'done') gates.doneAt = now;
  return { ...production, phase, gates, updatedAt: now };
}

/** Which phase the user's button moves the production to, or null when there is no button. */
export function userAdvance(phase: ProductionPhase | null | undefined): ProductionPhase | null {
  if (phase === 'plan-ready') return 'gathering';
  if (phase === 'gathered') return 'editing';
  return null;
}

type SceneMutation = (scene: ProductionBeat & Record<string, unknown>) => ProductionBeat & Record<string, unknown>;

function mapScene(comp: Comp, sceneIndex: number, change: SceneMutation): Comp {
  const production = comp.production;
  if (!production) return comp;
  if (production.mode === 'scratch') {
    const blueprint = comp.videoBlueprint;
    if (!blueprint) return comp;
    return { ...comp, videoBlueprint: { ...blueprint, scenes: blueprint.scenes.map((scene, i) => (i === sceneIndex ? (change(scene as ProductionBeat & Record<string, unknown>) as VideoBlueprintScene) : scene)) } };
  }
  return { ...comp, storyboard: (comp.storyboard ?? []).map((scene, i) => (i === sceneIndex ? (change(scene as ProductionBeat & Record<string, unknown>) as StoryboardScene) : scene)) };
}

/**
 * A shot's media: an imported asset, or a layered "[Motion]" comp — a scene a model rendered
 * itself and delivered in passes (renderPasses.ts), which a clip nests instead of playing a file.
 */
export type ShotMedia = { assetId: string } | { compId: string };

/** A shot, or a blueprint scene standing for one. */
type MediaHolder = { assetId?: unknown; compId?: unknown; [key: string]: unknown };

/** Whether a shot (or a blueprint scene standing for one) has its media. */
export const hasMedia = (shot: MediaHolder): boolean => !!(shot.assetId || shot.compId);

/** `entry` holding `media` in place of whatever it held before, marked ready. */
function withMedia<T extends MediaHolder>(entry: T, media: ShotMedia): T {
  const rest = { ...entry };
  delete rest.assetId;
  delete rest.compId;
  return { ...rest, ...media, status: 'ready' };
}

/**
 * Records that a shot's media exists. With a `shotIndex` the shot is updated; without one the
 * first pending shot of the matching kind is used, and a scene planned with the legacy
 * `mediaSource` field gets its `assetId` directly. Music attaches to the production itself.
 */
export function attachAsset(comp: Comp, target: { sceneIndex: number; shotIndex?: number | null; kind?: string | null }, assetId: string): { comp: Comp; attached: string } | null {
  return attachMedia(comp, target, { assetId });
}

/** attachAsset for either kind of media; a comp (render passes) only ever stands for a picture, never the music. */
export function attachMedia(comp: Comp, target: { sceneIndex: number; shotIndex?: number | null; kind?: string | null }, media: ShotMedia): { comp: Comp; attached: string } | null {
  const production = comp.production;
  if (!production) return null;
  const now = Date.now();
  if (target.kind === 'music' || target.sceneIndex < 0) {
    if (!('assetId' in media)) return null;
    const music = { ...(production.music ?? { source: 'generate' as const }), assetId: media.assetId, status: 'ready' as const };
    return { comp: { ...comp, production: { ...production, music, updatedAt: now } }, attached: 'music' };
  }
  const scenes = planScenes(comp);
  const scene = scenes[target.sceneIndex];
  if (!scene) return null;
  const shots = scene.shots ?? [];
  let shotIndex = target.shotIndex ?? null;
  if (shotIndex === null) {
    shotIndex = shots.findIndex((shot) => !hasMedia(shot) && (!target.kind || shot.kind === target.kind || (target.kind === 'video' && shot.kind === 'download')));
    if (shotIndex < 0) shotIndex = shots.findIndex((shot) => !hasMedia(shot));
  }
  if (shotIndex !== null && shotIndex >= 0 && shots[shotIndex]) {
    const next = mapScene(comp, target.sceneIndex, (current) => {
      const updated = { ...current, shots: (current.shots ?? []).map((shot, i) => (i === shotIndex ? withMedia(shot, media) : shot)) };
      return 'mediaSource' in current && !hasMedia(current) ? withMedia(updated, media) : updated;
    });
    return { comp: { ...next, production: { ...production, updatedAt: now } }, attached: `scene ${target.sceneIndex + 1} shot ${shotIndex + 1}` };
  }
  // A blueprint scene without an explicit shot list: the scene itself is the shot.
  const next = mapScene(comp, target.sceneIndex, (current) => withMedia(current, media));
  return { comp: { ...next, production: { ...production, updatedAt: now } }, attached: `scene ${target.sceneIndex + 1}` };
}

/** What still has to be gathered before the editing phase may open. */
export function gatherReport(comp: Comp): { ready: number; total: number; missing: string[] } {
  const production = comp.production;
  if (!production) return { ready: 0, total: 0, missing: [] };
  const missing: string[] = [];
  let ready = 0;
  let total = 0;
  planScenes(comp).forEach((scene, i) => {
    const shots = scene.shots ?? [];
    const legacy = scene as { mediaSource?: string; assetId?: string; compId?: string };
    if (!shots.length && legacy.mediaSource && legacy.mediaSource !== 'existing') {
      total++;
      if (hasMedia(legacy)) ready++; else missing.push(`scene ${i + 1} (${legacy.mediaSource})`);
    }
    shots.forEach((shot: ProductionShot, j) => {
      if (shot.kind === 'existing' || shot.kind === 'sfx') return;
      total++;
      if (hasMedia(shot)) ready++; else missing.push(`scene ${i + 1} shot ${j + 1} (${shot.kind}${shot.script ? `: ${shot.script.slice(0, 40)}` : ''})`);
    });
  });
  if (production.music && production.music.source !== 'none' && production.music.source !== 'existing') {
    total++;
    if (production.music.assetId) ready++; else missing.push('music');
  }
  return { ready, total, missing };
}

// ───────────────────────────── frame QA geometry ─────────────────────────────

/**
 * Something QA measures on screen. `picture` is footage or a still reduced to a card or a
 * picture-in-picture; `behind` is type drawn under the cut-out subject (it cannot cover the
 * face); layers that share a `group` (one motion scene) are designed together and never
 * reported as overlapping each other.
 */
export type QaLayer = { clipId: string; name: string; kind: 'graphic' | 'text' | 'caption' | 'subject' | 'picture'; box: Box; from: number; to: number; behind?: boolean; group?: string };
export type QaIssue = { at: number; a: string; b: string; kind: 'covers-subject' | 'graphic-overlap' | 'outside-safe' | 'off-frame' | 'caption-collision' | 'blank-frame' | 'black-edges' | 'small-text' | 'low-contrast'; overlap: number; suggestion: string };

const intersection = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * Where a text clip draws, as a fraction of the frame, from its preset (or its caption style)
 * and transform. Scale is about the box's own centre, as the export scales text at its anchor.
 */
export function textBox(clip: Clip, comp: Comp): Box | null {
  if (clip.source.type !== 'text') return null;
  const scale = clip.transform.scale / 100;
  // A styled caption is drawn centred at the style's posY, `size`% of the frame height per line,
  // wrapped at `maxWidth` of the frame width (Overlay's .cap-anchor, caption_styles.rs).
  const style = clip.source.preset === 'caption' ? findStyle(parseRbStyle(clip.source.style).base ?? clip.source.style) : undefined;
  if (style) {
    const size = style.size / 100;
    const perLine = Math.max(1, Math.floor((style.maxWidth * comp.width) / (size * comp.height * 0.55)));
    const lines = clip.source.text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
    const width = style.maxWidth * scale;
    const height = size * 1.18 * lines * scale;
    const cx = 0.5 + clip.transform.x;
    const cy = style.posY / 100 + clip.transform.y;
    return { x: cx - width / 2, y: cy - height / 2, width, height };
  }
  const base: Box = clip.source.preset === 'lower-third'
    ? { x: 0.05, y: 0.72, width: 0.45, height: 0.16 }
    : clip.source.preset === 'caption'
      ? { x: 0.15, y: 0.8, width: 0.7, height: 0.12 }
      : clip.source.preset === 'kinetic'
        ? { x: 0.15, y: 0.35, width: 0.7, height: 0.3 }
        : { x: 0.15, y: 0.38, width: 0.7, height: 0.24 };
  const width = base.width * scale;
  const height = base.height * scale * (comp.width / comp.height) / (16 / 9);
  const cx = base.x + base.width / 2 + clip.transform.x;
  const cy = base.y + base.height / 2 + clip.transform.y;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * Overlap and safe-area check over sampled times. `layers` carry their own visibility window;
 * subject boxes come from roto subject tracks. Returns issues ordered by time then severity.
 */
export function frameQa(comp: Comp, layers: QaLayer[], times: number[]): QaIssue[] {
  const issues: QaIssue[] = [];
  const safe = safeArea(frameOf(comp));
  for (const at of times) {
    const live = layers.filter((layer) => at >= layer.from && at < layer.to);
    const subjects = live.filter((layer) => layer.kind === 'subject');
    const graphics = live.filter((layer) => layer.kind !== 'subject');
    for (const graphic of graphics) {
      const area = graphic.box.width * graphic.box.height;
      if (area <= 0) continue;
      for (const subject of subjects) {
        // Type set behind the cut-out subject cannot cover them; a card of the subject's own footage is them.
        if (graphic.behind || graphic.clipId === subject.clipId) continue;
        // The face and hands live in the upper two thirds of the subject box; covering that
        // is the fault, brushing the shoulders is not.
        const head: Box = { x: subject.box.x, y: subject.box.y, width: subject.box.width, height: subject.box.height * 0.66 };
        const covered = intersection(graphic.box, head) / Math.max(1e-6, head.width * head.height);
        if (covered > 0.08) {
          const side = subject.box.x + subject.box.width / 2 > 0.5 ? 'left' : 'right';
          issues.push({ at, a: graphic.name, b: subject.name, kind: 'covers-subject', overlap: covered, suggestion: `Move "${graphic.name}" to the ${side} side (layout_clip / mogrt layout side-panel-${side}), shrink it, or put it behind the subject with add_text_behind_subject.` });
        }
      }
      for (const other of graphics) {
        if (other === graphic || other.clipId <= graphic.clipId || (graphic.group && graphic.group === other.group)) continue;
        const shared = intersection(graphic.box, other.box) / Math.min(area, other.box.width * other.box.height);
        if (shared > 0.15) {
          const kind = graphic.kind === 'caption' || other.kind === 'caption' ? 'caption-collision' : 'graphic-overlap';
          issues.push({ at, a: graphic.name, b: other.name, kind, overlap: shared, suggestion: kind === 'caption-collision' ? `Raise the caption zone or shorten "${graphic.kind === 'caption' ? other.name : graphic.name}" so captions keep a clear lane.` : `Stagger "${graphic.name}" and "${other.name}" in time or give them different slots; one idea per frame.` });
        }
      }
      // Type too small to read on a phone: its box shorter than ~2% of a landscape frame
      // (21 px at 1080p), ~1.3% of a vertical one.
      const minHeight = comp.height > comp.width ? 0.013 : 0.02;
      if ((graphic.kind === 'text' || graphic.kind === 'caption') && graphic.box.width > 0.03 && graphic.box.height < minHeight) {
        issues.push({ at, a: graphic.name, b: 'reading size', kind: 'small-text', overlap: 1 - graphic.box.height / minHeight, suggestion: `"${graphic.name}" is ${Math.round(graphic.box.height * comp.height)} px tall: too small to read on a phone. Make it at least ${Math.ceil(minHeight * comp.height)} px (larger size or scale), or cut the words.` });
      }
      const inside = intersection(graphic.box, safe) / area;
      const onFrame = intersection(graphic.box, { x: 0, y: 0, width: 1, height: 1 }) / area;
      const how = graphic.kind === 'picture' ? 'layout_clip (its slots sit inside the safe area) or a smaller scale / x' : graphic.group ? 'update_motion_scene (patch the layer position, or rebuild — scenes are fitted to the safe area)' : 'its layout or position';
      if (onFrame < 0.995) {
        issues.push({ at, a: graphic.name, b: 'frame edge', kind: 'off-frame', overlap: 1 - onFrame, suggestion: `"${graphic.name}" runs ${Math.round((1 - onFrame) * 100)}% outside the picture; bring it back inside the safe area with ${how}.` });
      } else if (inside < 0.97) {
        issues.push({ at, a: graphic.name, b: 'safe area', kind: 'outside-safe', overlap: 1 - inside, suggestion: `"${graphic.name}" crosses the safe margins; pull it inside ${Math.round(safe.x * 100)}% / ${Math.round((1 - safe.x - safe.width) * 100)}% from the edges with ${how}.` });
      }
    }
  }
  const order: Record<QaIssue['kind'], number> = { 'blank-frame': 0, 'black-edges': 1, 'covers-subject': 2, 'off-frame': 3, 'low-contrast': 4, 'caption-collision': 5, 'small-text': 6, 'graphic-overlap': 7, 'outside-safe': 8 };
  return issues.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || b.overlap - a.overlap);
}

/** Sample times for QA: every scene start plus a point every `step` seconds, capped. */
export function qaTimes(comp: Comp, duration: number, step = 1.5, cap = 40): number[] {
  const times = new Set<number>();
  for (const scene of planScenes(comp)) times.add(Math.min(duration - 1e-3, scene.start + 0.4));
  for (let t = 0.2; t < duration; t += step) times.add(Math.round(t * 100) / 100);
  return [...times].filter((t) => t >= 0 && t < duration).sort((a, b) => a - b).slice(0, cap);
}
