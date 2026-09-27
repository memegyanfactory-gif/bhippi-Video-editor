// The Judge: one score for the finished edit, against what this kind of video needs.
//
// The crew (docs/AI-CREW-PLAN.md): the Director plans, the Editor looks at every frame
// (run_frame_qa), the Token Council keeps the bill down, and the Judge scores the result 0–100.
// Below the pass mark the Judge's fixes go back to the Director and the loop runs again, at most
// JUDGE_ROUNDS times; the Token Council will not pay for more.
//
// Everything here is measured from the timeline — the council's seats, frame QA, pacing against
// the genre's films, the plan's coverage, motion density and the genre's own must-haves — so a
// score is free, repeatable and cannot be talked up. The model still gets the contact frames to
// judge what geometry cannot (taste, contrast, reading).
import type { CouncilReview } from './council';
import type { PacingReport } from './pacing';
import type { Genre } from './toolRouter';
import type { Comp, Project } from './types';
import type { Layer, MotionScene } from '../motion/types';

export const PASS_MARK = 80;
/** Judge passes per production turn before the council stops paying for more. */
export const JUDGE_ROUNDS = 3;

export type Criterion = { id: string; label: string; weight: number; score: number; notes: string[] };
export type Verdict = { score: number; pass: boolean; criteria: Criterion[]; fixes: string[]; genres: Genre[] };

export type JudgeInput = {
  project: Project;
  comp: Comp;
  review: CouncilReview;
  pacing: PacingReport;
  qa: { ran: boolean; issues: { kind: string; a: string; suggestion?: string }[] };
  genres: Genre[];
};

/** How much of the timeline should carry designed motion, by kind of video. */
const MOTION_TARGET: Record<Genre, number> = { saas: 0.75, motion: 0.8, character2d: 0.75, '3d': 0.7, documentary: 0.35, meme: 0.5, edit: 0.3, shorts: 0.35 };

const visualClip = (comp: Comp) => (clip: Comp['clips'][number]) => clip.enabled !== false && comp.tracks.find((t) => t.id === clip.trackId)?.kind === 'video';

/** Every motion layer on the timeline (inside nested comps and precomps too). */
function layersOf(project: Project, comp: Comp, seen = new Set<string>()): { layer: Layer; scene: MotionScene }[] {
  if (seen.has(comp.id)) return [];
  seen.add(comp.id);
  const out: { layer: Layer; scene: MotionScene }[] = [];
  const walk = (scene: MotionScene) => {
    for (const layer of scene.layers) {
      out.push({ layer, scene });
      if (layer.type === 'precomp') walk(layer.scene);
    }
  };
  for (const clip of comp.clips) {
    if (clip.source.type === 'motion') walk(clip.source.scene);
    else if (clip.source.type === 'comp') {
      const sub = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
      if (sub) {
        out.push(...layersOf(project, sub, seen));
        for (const inner of sub.clips) if (inner.source.type === 'motion') walk(inner.source.scene);
      }
    }
  }
  return out;
}

function scenesOf(project: Project, comp: Comp, seen = new Set<string>()): MotionScene[] {
  if (seen.has(comp.id)) return [];
  seen.add(comp.id);
  return comp.clips.flatMap((clip) => {
    if (clip.source.type === 'motion') return [clip.source.scene];
    if (clip.source.type === 'comp') {
      const sub = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
      return sub ? scenesOf(project, sub, seen) : [];
    }
    return [];
  });
}

const duration = (comp: Comp) => comp.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);

/** Text shown on the timeline (text clips and motion text layers), for the end-card check. */
function textsNear(project: Project, comp: Comp, from: number): string[] {
  const out: string[] = [];
  for (const clip of comp.clips) {
    if (clip.start + clip.duration < from) continue;
    if (clip.source.type === 'text') out.push(`${clip.source.text} ${clip.source.subtitle}`);
    if (clip.source.type === 'html' && clip.source.title) out.push(clip.source.title);
    if (clip.name) out.push(clip.name);
    if (clip.source.type === 'comp') {
      const sub = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
      if (sub) out.push(sub.name, ...sub.clips.map((c) => c.name ?? ''));
    }
    if (clip.source.type === 'motion') {
      for (const layer of clip.source.scene.layers) if (layer.type === 'text') out.push(JSON.stringify(layer.text).slice(0, 200));
    }
  }
  return out;
}

const hasVoice = (comp: Comp) =>
  !!comp.production?.script ||
  comp.clips.some((clip) => clip.enabled !== false && comp.tracks.find((t) => t.id === clip.trackId)?.kind === 'audio' && /voice|vo\b|narrat|speech|elevenlabs|dialog/i.test(clip.name ?? ''));

/** The must-haves of each kind of video: [what, met]. */
export function genreChecks(project: Project, comp: Comp, genre: Genre): [string, boolean][] {
  const layers = layersOf(project, comp);
  const scenes = scenesOf(project, comp);
  const end = duration(comp);
  const texts = () => textsNear(project, comp, end * 0.8).join(' ');
  switch (genre) {
    case 'character2d': {
      const characters = layers.filter(({ layer }) => layer.type === 'character').map(({ layer }) => layer as Layer & { type: 'character' });
      const acting = characters.filter((c) => (c.character.actions ?? []).length >= 2);
      const talking = characters.some((c) => (c.character.actions ?? []).some((a) => a.do === 'talk'));
      return [
        ['a character on screen', characters.length > 0],
        ['every character acts (2+ timed actions, not a static pose)', characters.length > 0 && acting.length === characters.length],
        ['spoken lines are lip-synced (lip_sync_character)', !hasVoice(comp) || talking],
      ];
    }
    case 'saas':
      return [
        ['the product UI is shown in use (create_ui_screen)', scenes.some((scene) => scene.template?.id === 'ui-screen')],
        ['an end card with the call to action in the last 20%', /download|try|sign ?up|get|start|free|link|visit|join|buy|book/i.test(texts())],
        ['the brand appears (logo sting, end card or brand template)', scenes.some((scene) => /brand|logo|end-card/.test(scene.template?.id ?? '')) || /logo/i.test(texts())],
      ];
    case 'motion':
      return [
        ['motion scenes carry the film', scenes.length >= 2],
        ['type is animated (text layers in motion scenes)', layers.some(({ layer }) => layer.type === 'text')],
      ];
    case '3d':
      return [['a 3D render or 3D scene is on the timeline', comp.clips.some((clip) => clip.source.type === 'scene3d' || /3d|render/i.test(clip.name ?? ''))]];
    case 'documentary':
      return [
        ['speakers are named (lower thirds)', scenes.some((scene) => /lower-third/.test(scene.template?.id ?? '')) || comp.clips.some((clip) => clip.source.type === 'text' && clip.source.preset === 'lower-third')],
        ['claims are covered with b-roll (2+ video sources)', new Set(comp.clips.filter(visualClip(comp)).map((clip) => (clip.source.type === 'media' ? clip.source.assetId : ''))).size >= 3],
      ];
    case 'meme':
      return [['memes or reaction media are placed', comp.clips.some((clip) => /meme|reaction/i.test(clip.name ?? '')) || !!comp.roast]];
    case 'edit':
      return [
        ['captions for the speech', !hasVoice(comp) && !comp.clips.some((c) => c.source.type === 'media') || comp.clips.some((clip) => clip.source.type === 'text' && clip.source.preset === 'caption')],
        ['a music bed or sound design', comp.clips.some((clip) => clip.source.type === 'sfx') || comp.tracks.filter((t) => t.kind === 'audio' && comp.clips.some((c) => c.trackId === t.id)).length > 1],
      ];
    case 'shorts':
      return [
        ['vertical frame', comp.height > comp.width],
        // Most shorts are watched muted: the words have to be on screen.
        ['captions on the speech', !hasVoice(comp) && !comp.clips.some((c) => c.source.type === 'media') || comp.clips.some((clip) => clip.source.type === 'text' && clip.source.preset === 'caption')],
      ];
  }
}

/** The plan realised: every storyboard beat has picture for at least half its span. */
function planCoverage(comp: Comp): { share: number; missing: string[] } {
  const beats = comp.storyboard ?? [];
  if (!beats.length) return { share: -1, missing: [] };
  const visuals = comp.clips.filter(visualClip(comp));
  const missing: string[] = [];
  for (const beat of beats) {
    const span = Math.max(0.01, beat.end - beat.start);
    let covered = 0;
    for (const clip of visuals) covered += Math.max(0, Math.min(beat.end, clip.start + clip.duration) - Math.max(beat.start, clip.start));
    if (covered / span < 0.5) missing.push(`${beat.start.toFixed(1)}–${beat.end.toFixed(1)} s "${beat.intent.slice(0, 50)}"`);
  }
  return { share: (beats.length - missing.length) / beats.length, missing };
}

export function judge(input: JudgeInput): Verdict {
  const { project, comp, review, pacing, qa, genres } = input;
  const criteria: Criterion[] = [];

  // The Editor's pass: every frame clear.
  const qaNotes = qa.ran ? qa.issues.slice(0, 5).map((issue) => `${issue.kind} "${issue.a}"${issue.suggestion ? `: ${issue.suggestion}` : ''}`) : ['Frames were not checked.'];
  criteria.push({ id: 'frames', label: 'Every frame clean (Editor)', weight: 20, score: !qa.ran ? 0 : Math.max(0, 1 - qa.issues.length * 0.15), notes: qa.issues.length || !qa.ran ? qaNotes : [] });

  const blocks = review.notes.filter((note) => note.severity === 'block');
  const fixes = review.notes.filter((note) => note.severity === 'fix');
  criteria.push({
    id: 'council', label: 'The council signs off', weight: 20,
    score: blocks.length ? 0 : Math.max(0, 1 - fixes.length * 0.08),
    notes: [...blocks, ...fixes].slice(0, 5).map((note) => `${note.member}: ${note.text} → ${note.fix}`),
  });

  const total = pacing.checks.length;
  const ok = pacing.checks.filter((check) => check.ok).length;
  criteria.push({ id: 'pacing', label: 'Pacing matches the genre\'s films', weight: 15, score: total ? ok / total : 0.7, notes: pacing.checks.filter((check) => !check.ok).map((check) => `${check.token}: ${check.measured} (target ${check.target})${check.note ? ` — ${check.note}` : ''}`) });

  const plan = planCoverage(comp);
  criteria.push({ id: 'plan', label: 'Every planned beat is on screen', weight: 15, score: plan.share < 0 ? 0.6 : plan.share, notes: plan.share < 0 ? ['No storyboard: the edit cannot be held to a plan (save_storyboard).'] : plan.missing.slice(0, 5).map((beat) => `Beat with no picture: ${beat}`) });

  const target = Math.max(...genres.map((genre) => MOTION_TARGET[genre]));
  criteria.push({ id: 'motion', label: 'Designed motion on screen', weight: 10, score: Math.min(1, review.motionDensity / target), notes: review.motionDensity < target ? [`Motion on ${Math.round(review.motionDensity * 100)}% of the timeline; this kind of video wants ~${Math.round(target * 100)}%. Fill the static stretches.`] : [] });

  const checks = genres.flatMap((genre) => genreChecks(project, comp, genre));
  const met = checks.filter(([, pass]) => pass).length;
  criteria.push({ id: 'genre', label: `What a ${genres.join(' + ')} video needs`, weight: 20, score: checks.length ? met / checks.length : 1, notes: checks.filter(([, pass]) => !pass).map(([what]) => `Missing: ${what}.`) });

  const score = Math.round(criteria.reduce((sum, c) => sum + c.weight * c.score, 0));
  const ranked = [...criteria].sort((a, b) => b.weight * (1 - b.score) - a.weight * (1 - a.score));
  return {
    score,
    pass: score >= PASS_MARK && !blocks.length,
    criteria: criteria.map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 })),
    fixes: ranked.filter((c) => c.score < 0.95).flatMap((c) => c.notes).slice(0, 10),
    genres,
  };
}

/** The kinds of video a timeline looks like, when the model does not say. */
export function inferGenres(project: Project, comp: Comp): Genre[] {
  const layers = layersOf(project, comp);
  const scenes = scenesOf(project, comp);
  const found: Genre[] = [];
  if (layers.some(({ layer }) => layer.type === 'character')) found.push('character2d');
  if (scenes.some((scene) => scene.template?.id === 'ui-screen')) found.push('saas');
  if (comp.clips.some((clip) => clip.source.type === 'scene3d')) found.push('3d');
  if (comp.roast) found.push('meme');
  if (comp.height > comp.width) found.push('shorts');
  if (scenes.length >= 2) found.push('motion');
  if (!found.length) found.push('edit');
  return found;
}
