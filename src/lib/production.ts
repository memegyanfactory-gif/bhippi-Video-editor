// The production record: phases, gates, the asset manifest and frame QA geometry.
//
// A production is the comp's plan seen as a state machine. The model writes the plan, the user
// presses Start generating, the model gathers every planned shot, the user presses Start
// editing, the model assembles and polishes. Everything here is pure so the workflow guard,
// the tools and the chat UI agree on what "ready" means, and so it can be tested without a
// browser. Mutations return a new comp; nothing here touches history.
import type { Box } from './layout';
import { frameOf, safeArea } from './layout';
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
 * Records that a shot's media exists. With a `shotIndex` the shot is updated; without one the
 * first pending shot of the matching kind is used, and a scene planned with the legacy
 * `mediaSource` field gets its `assetId` directly. Music attaches to the production itself.
 */
export function attachAsset(comp: Comp, target: { sceneIndex: number; shotIndex?: number | null; kind?: string | null }, assetId: string): { comp: Comp; attached: string } | null {
  const production = comp.production;
  if (!production) return null;
  const now = Date.now();
  if (target.kind === 'music' || target.sceneIndex < 0) {
    const music = { ...(production.music ?? { source: 'generate' as const }), assetId, status: 'ready' as const };
    return { comp: { ...comp, production: { ...production, music, updatedAt: now } }, attached: 'music' };
  }
  const scenes = planScenes(comp);
  const scene = scenes[target.sceneIndex];
  if (!scene) return null;
  const shots = scene.shots ?? [];
  let shotIndex = target.shotIndex ?? null;
  if (shotIndex === null) {
    shotIndex = shots.findIndex((shot) => !shot.assetId && (!target.kind || shot.kind === target.kind || (target.kind === 'video' && shot.kind === 'download')));
    if (shotIndex < 0) shotIndex = shots.findIndex((shot) => !shot.assetId);
  }
  if (shotIndex !== null && shotIndex >= 0 && shots[shotIndex]) {
    const next = mapScene(comp, target.sceneIndex, (current) => ({
      ...current,
      shots: (current.shots ?? []).map((shot, i) => (i === shotIndex ? { ...shot, assetId, status: 'ready' as const } : shot)),
      ...('mediaSource' in current && !current.assetId ? { assetId, status: 'ready' } : {}),
    }));
    return { comp: { ...next, production: { ...production, updatedAt: now } }, attached: `scene ${target.sceneIndex + 1} shot ${shotIndex + 1}` };
  }
  // A blueprint scene without an explicit shot list: the scene itself is the shot.
  const next = mapScene(comp, target.sceneIndex, (current) => ({ ...current, assetId, status: 'ready' }));
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
    const legacy = scene as { mediaSource?: string; assetId?: string };
    if (!shots.length && legacy.mediaSource && legacy.mediaSource !== 'existing') {
      total++;
      if (legacy.assetId) ready++; else missing.push(`scene ${i + 1} (${legacy.mediaSource})`);
    }
    shots.forEach((shot: ProductionShot, j) => {
      if (shot.kind === 'existing' || shot.kind === 'sfx') return;
      total++;
      if (shot.assetId) ready++; else missing.push(`scene ${i + 1} shot ${j + 1} (${shot.kind}${shot.script ? `: ${shot.script.slice(0, 40)}` : ''})`);
    });
  });
  if (production.music && production.music.source !== 'none' && production.music.source !== 'existing') {
    total++;
    if (production.music.assetId) ready++; else missing.push('music');
  }
  return { ready, total, missing };
}

// ───────────────────────────── frame QA geometry ─────────────────────────────

export type QaLayer = { clipId: string; name: string; kind: 'graphic' | 'text' | 'caption' | 'subject'; box: Box; from: number; to: number };
export type QaIssue = { at: number; a: string; b: string; kind: 'covers-subject' | 'graphic-overlap' | 'outside-safe' | 'caption-collision'; overlap: number; suggestion: string };

const intersection = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Where a text clip draws, as a fraction of the frame, from its preset and transform. */
export function textBox(clip: Clip, comp: Comp): Box | null {
  if (clip.source.type !== 'text') return null;
  const scale = clip.transform.scale / 100;
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
        if (other === graphic || other.clipId <= graphic.clipId) continue;
        const shared = intersection(graphic.box, other.box) / Math.min(area, other.box.width * other.box.height);
        if (shared > 0.15) {
          const kind = graphic.kind === 'caption' || other.kind === 'caption' ? 'caption-collision' : 'graphic-overlap';
          issues.push({ at, a: graphic.name, b: other.name, kind, overlap: shared, suggestion: kind === 'caption-collision' ? `Raise the caption zone or shorten "${graphic.kind === 'caption' ? other.name : graphic.name}" so captions keep a clear lane.` : `Stagger "${graphic.name}" and "${other.name}" in time or give them different slots; one idea per frame.` });
        }
      }
      const inside = intersection(graphic.box, safe) / area;
      if (inside < 0.97) {
        issues.push({ at, a: graphic.name, b: 'safe area', kind: 'outside-safe', overlap: 1 - inside, suggestion: `"${graphic.name}" crosses the safe margins; pull it inside ${Math.round(safe.x * 100)}% / ${Math.round((1 - safe.x - safe.width) * 100)}% from the edges.` });
      }
    }
  }
  const order: Record<QaIssue['kind'], number> = { 'covers-subject': 0, 'caption-collision': 1, 'graphic-overlap': 2, 'outside-safe': 3 };
  return issues.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || b.overlap - a.overlap);
}

/** Sample times for QA: every scene start plus a point every `step` seconds, capped. */
export function qaTimes(comp: Comp, duration: number, step = 1.5, cap = 40): number[] {
  const times = new Set<number>();
  for (const scene of planScenes(comp)) times.add(Math.min(duration - 1e-3, scene.start + 0.4));
  for (let t = 0.2; t < duration; t += step) times.add(Math.round(t * 100) / 100);
  return [...times].filter((t) => t >= 0 && t < duration).sort((a, b) => a - b).slice(0, cap);
}
