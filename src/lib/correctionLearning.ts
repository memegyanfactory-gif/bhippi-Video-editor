// Learnings suggested from the user's own corrections (opt-in; Settings › Brand kit › Learnings).
// When the user changes what an AI turn just made in a way that reads as a preference, Bhippi
// offers — never saves on its own — to remember it for the brand kit. Pure, so it is tested.
import type { NewLearning } from './brandKit/learnings';
import { clipEnd } from './timeline';
import type { Clip, Project } from './types';

export type Suggestion = { key: string; learning: NewLearning; why: string };

const clipsOf = (project: Project) => new Map(project.comps.flatMap((comp) => comp.clips.map((clip) => [clip.id, clip] as const)));
const isMusic = (clip: Clip) => clip.audioType === 'music' || /music|score|bed|song|track/i.test(clip.name ?? '');

/**
 * What the user's correction since the AI turn says, if anything: `afterTurn` is the project as
 * the turn left it, `now` after the user's edits, `aiClips` what the turn added or changed.
 */
export function suggestFromCorrection(afterTurn: Project, now: Project, aiClips: ReadonlySet<string>): Suggestion | null {
  const before = clipsOf(afterTurn);
  const after = clipsOf(now);

  // A different caption style on the AI's captions.
  for (const id of aiClips) {
    const was = before.get(id);
    const is = after.get(id);
    if (was?.source.type === 'text' && is?.source.type === 'text' && was.source.preset === 'caption' && is.source.style && is.source.style !== was.source.style) {
      return { key: `captions:${is.source.style}`, why: `You switched the AI's captions to “${is.source.style}”.`, learning: { area: 'captions', text: `Captions in the “${is.source.style}” style`, value: { captionStyle: is.source.style }, confidence: 0.6 } };
    }
  }

  // The music bed the AI laid, deleted.
  const removedMusic = [...aiClips].map((id) => before.get(id)).filter((clip): clip is Clip => !!clip && clip.source.type === 'media' && !after.has(clip.id) && isMusic(clip));
  if (removedMusic.length) {
    return { key: 'dont:music-bed', why: 'You deleted the music bed the AI added.', learning: { area: 'dont', text: 'No music bed unless the user asks for one', confidence: 0.55 } };
  }

  // The AI's titles resized the same way, at least twice.
  const ratios = [...aiClips].flatMap((id) => {
    const was = before.get(id);
    const is = after.get(id);
    if (was?.source.type !== 'text' || is?.source.type !== 'text' || was.source.preset === 'caption' || clipEnd(is) <= 0) return [];
    const ratio = is.transform.scale / Math.max(1, was.transform.scale);
    return Math.abs(ratio - 1) > 0.15 ? [ratio] : [];
  });
  if (ratios.length >= 2 && (ratios.every((r) => r > 1) || ratios.every((r) => r < 1))) {
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const percent = Math.round(Math.abs(mean - 1) * 100);
    return { key: `type:scale:${mean > 1 ? 'up' : 'down'}`, why: `You made ${ratios.length} of the AI's titles about ${percent}% ${mean > 1 ? 'bigger' : 'smaller'}.`, learning: { area: 'type', text: `Titles about ${percent}% ${mean > 1 ? 'bigger' : 'smaller'} than the templates' default size`, value: { titleScale: Math.round(mean * 100) / 100 }, confidence: 0.55 } };
  }
  return null;
}
