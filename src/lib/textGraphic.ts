// A text clip as the caption and title renderers take it: timeline times, the transcript's word
// timings mapped through the clip's trimmed head and speed, and which caption look draws it. The
// Program monitor and the export build it here, so they cannot disagree about a caption.
import type { Clip, Graphic, Project } from './types';

type TextClip = Clip & { source: Extract<Clip['source'], { type: 'text' }> };

export const isTextClip = (clip: Clip): clip is TextClip => clip.source.type === 'text';

export function textGraphic(project: Pick<Project, 'captionLook'>, clip: TextClip): Graphic {
  const source = clip.source;
  // Caption time → timeline, through a trimmed head (`in`) and the clip's speed.
  const onTimeline = (offset: number) => clip.start + (offset - clip.in) / (clip.speed || 1);
  return {
    id: clip.id, text: source.text, subtitle: source.subtitle, preset: source.preset, color: source.color, style: source.style,
    start: clip.start, duration: clip.duration,
    wordStarts: source.words?.map(onTimeline),
    wordEnds: source.wordEnds?.map(onTimeline),
    look: project.captionLook === 'fiwn' ? 'fiwn' : 'classic',
  };
}
