// Bhippi's own finishing pass for a production a model left unfinished.
//
// Real turn traces (2026-09/10) show about half of the multi-edit turns, on every provider and
// Claude Opus included, end without verify_edit_workflow, and most with no frame QA or loudness
// pass. A model that ran out of steam should still hand over a clean cut, so when a turn ends
// unverified Bhippi runs the deterministic checks itself and fixes only what is safe to fix:
//
//   - black frame edges (a picture reduced or moved with nothing behind it): fill_background;
//   - a cut with no sound at all is reported (music is a creative choice, never added unasked),
//     so the finishing round or the user decides;
//   - a finished mix off the -16 LUFS target: level_audio at the target the measurement asks for, once;
//   - then the Judge (frame QA, council, pacing) scores the cut and its list is reported.
//
// It never touches a creative choice: no graphic is moved, no cut changed, no word rewritten. Every
// step is an ordinary undoable tool call, and the report names what was done and what is still open.
import { mixFindings, type MixReading } from './reviewFrames';
import { compDuration } from './timeline';
import type { Asset, Comp, Project } from './types';

export type PolishResult = { ok: boolean; summary?: string; error?: string; [key: string]: unknown };
/** Runs one Bhippi tool (the same entry the model's calls take). */
export type PolishRun = (name: string, args: Record<string, unknown>) => Promise<PolishResult>;

export type PolishHost = {
  run: PolishRun;
  project: () => Project;
  assets: () => Map<string, Asset>;
  /** The finished mix as the export renders it; null when it cannot be measured. */
  mix?: (compId: string) => Promise<MixReading | null>;
};

export type PolishReport = {
  /** What Bhippi changed. */
  fixed: string[];
  /** What is still open (the Judge's list, trimmed). */
  open: string[];
  score: number | null;
  pass: boolean | null;
  /** One short message for the chat. */
  message: string;
};

const first = (text: string | undefined) => (text ?? '').split('\n')[0].trim();

/** True when the comp has something on screen to polish. */
function hasPicture(comp: Comp): boolean {
  return comp.clips.some((clip) => clip.enabled && (clip.source.type === 'media' || clip.source.type === 'comp' || clip.source.type === 'motion' || clip.source.type === 'html' || clip.source.type === 'text'));
}

/** True when anything sounds: an audio clip, a cue, or footage that carries its own audio. */
function hasSound(comp: Comp, assets: Map<string, Asset>): boolean {
  return comp.clips.some((clip) => {
    if (!clip.enabled) return false;
    if (clip.source.type === 'sfx') return true;
    if (clip.source.type !== 'media') return false;
    const asset = assets.get(clip.source.assetId);
    return !!asset && (asset.kind === 'audio' || (!!asset.hasAudio && clip.volume > 0));
  });
}

/** Footage with a voice of its own: a bed would fight it, so none is added without being asked. */
function hasFootageAudio(comp: Comp, assets: Map<string, Asset>): boolean {
  return comp.clips.some((clip) => {
    if (!clip.enabled || clip.source.type !== 'media') return false;
    const asset = assets.get(clip.source.assetId);
    return asset?.kind === 'video' && !!asset.hasAudio;
  });
}

/**
 * Runs the pass on `compId` (default the active comp). Returns null when there is nothing to
 * polish (an empty timeline). Never throws: a step that fails is reported as open.
 */
export async function autoPolish(host: PolishHost, compId?: string): Promise<PolishReport | null> {
  const project = host.project();
  const comp = project.comps.find((c) => c.id === (compId ?? project.activeCompId));
  if (!comp || compDuration(comp) <= 0 || !hasPicture(comp)) return null;
  const fixed: string[] = [];
  const open: string[] = [];
  const step = async (name: string, args: Record<string, unknown>): Promise<PolishResult> => {
    try { return await host.run(name, { compId: comp.id, ...args }); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };

  // 1. Black edges: the one defect that is always a mistake, fixed with a plate behind the picture.
  const filled = await step('fill_background', {});
  if (filled.ok && Array.isArray(filled.filled) && filled.filled.length) fixed.push(`filled black frame edges (${filled.filled.length} span${filled.filled.length === 1 ? '' : 's'})`);
  else if (!filled.ok && filled.error) open.push(`black edges could not be filled: ${first(filled.error)}`);

  // 2. No sound at all: whether a cut should have music is a creative choice (a silent piece may be
  // meant), so it is reported for the model or the user to decide, never added unasked.
  const assets = host.assets();
  const live = host.project().comps.find((c) => c.id === comp.id) ?? comp;
  if (!hasSound(live, assets) && !hasFootageAudio(live, assets)) {
    open.push('the cut has no sound at all: add music or sound (compose_music, find_free_media) unless it is meant to be silent');
  }

  // 3. The mix: off target is corrected once, at the level the measurement asks for.
  if (host.mix) {
    try {
      const reading = await host.mix(comp.id);
      if (reading && mixFindings(reading).some((f) => f.kind === 'mix-loudness')) {
        const voice = Math.round((-16 - (reading.integratedLufs + 16)) * 10) / 10;
        const levelled = await step('level_audio', { targetLufs: Math.max(-30, Math.min(-8, voice)) });
        if (levelled.ok) fixed.push(`levelled the mix (it was ${reading.integratedLufs.toFixed(1)} LUFS, target -16)`);
        else open.push(`mix at ${reading.integratedLufs.toFixed(1)} LUFS: ${first(levelled.error)}`);
      }
    } catch {
      // A mix that cannot be measured (no sound, no FFmpeg) is left to the Judge's note.
    }
  }

  // 4. The Judge: frame QA, the council and pacing in one deterministic score, and its list.
  const judged = await step('judge_edit', {});
  let score: number | null = null;
  let pass: boolean | null = null;
  if (judged.ok) {
    score = typeof judged.score === 'number' ? judged.score : null;
    pass = typeof judged.pass === 'boolean' ? judged.pass : null;
    const fixes = Array.isArray(judged.fixes) ? (judged.fixes as unknown[]).filter((f): f is string => typeof f === 'string') : [];
    open.push(...fixes.slice(0, 4));
  } else open.push(`the Judge could not score it: ${first(judged.error)}`);

  const head = fixed.length ? `Bhippi polished the cut itself: ${fixed.join('; ')}.` : 'Bhippi checked the cut itself and found nothing safe to fix.';
  const judge = score !== null ? ` The Judge scores it ${score}/100${pass ? ' (passes)' : ''}.` : '';
  const left = open.length ? ` Still open: ${open.slice(0, 4).join(' | ')}.` : '';
  return { fixed, open, score, pass, message: `${head}${judge}${left}` };
}
